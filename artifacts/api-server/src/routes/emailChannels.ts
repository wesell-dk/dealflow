import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import {
  emailChannelsTable,
  userMailboxConnectionsTable,
  auditLogTable,
} from "@workspace/db/schema";

import { activeScopeSnapshot, getScope } from "../lib/scope";
import { encryptSecret } from "../lib/secretCrypto";
import { logger } from "../lib/logger";
import {
  dispatchUsingChannel,
  isValidChannelType,
  listAvailableSenders,
} from "../lib/email/dispatcher";
import type { EmailMessage } from "../lib/email/types";
import {
  buildAuthorizeUrl,
  isProviderConfigured,
  type MailboxProvider,
} from "../lib/email/oauth";

const router: IRouter = Router();

// ── helpers ──────────────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response): boolean {
  const scope = getScope(req);
  if (!scope.tenantWide) {
    res.status(403).json({ error: "admin rights required" });
    return false;
  }
  return true;
}

async function audit(
  req: Request,
  args: {
    entityType: string;
    entityId: string;
    action: string;
    summary: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  // Inline insert (rather than re-exporting writeAudit from dealflow.ts) so
  // this router has no compile-time dependency on the giant routes/dealflow
  // module — important for keeping bundle/test isolation manageable.
  const scope = getScope(req);
  const id = `au_${randomUUID().slice(0, 10)}`;
  const snapshot = activeScopeSnapshot(scope);
  await db.insert(auditLogTable).values({
    id,
    tenantId: scope.tenantId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    actor: scope.user.id,
    beforeJson: args.before === undefined ? null : JSON.stringify(args.before),
    afterJson: args.after === undefined ? null : JSON.stringify(args.after),
    summary: args.summary,
    activeScopeJson: snapshot ? JSON.stringify(snapshot) : null,
    at: new Date(),
  });
}

function newId(): string {
  // 24 chars after prefix is plenty of entropy and matches existing ids.
  return `ch_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

// ── shared schemas ───────────────────────────────────────────────────────

const ChannelTypeEnum = z.enum([
  "system",
  "smtp",
  "microsoft_graph",
  "gmail_api",
  "webhook",
]);

const SmtpConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().default(false),
  user: z.string().min(1),
  requireTls: z.boolean().optional(),
});

const WebhookConfigSchema = z.object({
  url: z.string().url(),
  signingHeader: z.string().min(1).optional(),
});

const ChannelConfigSchema = z.union([
  z.object({}).passthrough(),
  SmtpConfigSchema,
  WebhookConfigSchema,
]);

const CreateChannelBody = z.object({
  type: ChannelTypeEnum,
  name: z.string().min(1).max(80),
  brandId: z.string().nullish(),
  fromEmail: z.string().email(),
  fromName: z.string().max(120).nullish(),
  replyTo: z.string().email().nullish(),
  isActive: z.boolean().optional().default(true),
  isDefaultTransactional: z.boolean().optional().default(false),
  isDefaultPersonal: z.boolean().optional().default(false),
  config: ChannelConfigSchema.optional(),
  // Plain-text secrets — the route encrypts them before persisting.
  // We never echo this back in responses.
  credentials: z
    .object({
      password: z.string().optional(),
      signingSecret: z.string().optional(),
    })
    .optional(),
});

const UpdateChannelBody = CreateChannelBody.partial();

function toApi(row: typeof emailChannelsTable.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    isActive: row.isActive,
    brandId: row.brandId,
    userId: row.userId,
    isDefaultTransactional: row.isDefaultTransactional,
    isDefaultPersonal: row.isDefaultPersonal,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    replyTo: row.replyTo,
    config: row.config ?? {},
    hasCredentials: !!row.credentialsCipher,
    lastTestStatus: row.lastTestStatus,
    lastTestAt: row.lastTestAt?.toISOString() ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}

// ── tenant admin endpoints ───────────────────────────────────────────────

router.get("/orgs/tenant/email-channels", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const rows = await db
    .select()
    .from(emailChannelsTable)
    .where(eq(emailChannelsTable.tenantId, scope.tenantId))
    .orderBy(desc(emailChannelsTable.createdAt));
  res.json({ items: rows.map(toApi) });
});

router.post("/orgs/tenant/email-channels", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = CreateChannelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
    return;
  }
  const scope = getScope(req);
  const body = parsed.data;
  if (!isValidChannelType(body.type)) {
    res.status(400).json({ error: `unknown channel type ${body.type}` });
    return;
  }
  if (
    (body.type === "smtp" && (!body.config || !("host" in body.config)))
    || (body.type === "webhook" && (!body.config || !("url" in body.config)))
  ) {
    res.status(400).json({ error: `${body.type} channel requires config` });
    return;
  }
  const id = newId();
  const credCipher = body.credentials && Object.keys(body.credentials).length > 0
    ? encryptSecret(body.credentials)
    : null;
  await db.insert(emailChannelsTable).values({
    id,
    tenantId: scope.tenantId,
    type: body.type,
    name: body.name,
    isActive: body.isActive ?? true,
    brandId: body.brandId ?? null,
    userId: null,
    isDefaultTransactional: body.isDefaultTransactional ?? false,
    isDefaultPersonal: body.isDefaultPersonal ?? false,
    fromEmail: body.fromEmail,
    fromName: body.fromName ?? null,
    replyTo: body.replyTo ?? null,
    config: (body.config ?? {}) as Record<string, unknown>,
    credentialsCipher: credCipher,
    createdBy: scope.user.id,
  });
  const [created] = await db
    .select()
    .from(emailChannelsTable)
    .where(eq(emailChannelsTable.id, id));
  await audit(req, {
    entityType: "email_channel",
    entityId: id,
    action: "email_channel.created",
    summary: `E-Mail-Kanal "${body.name}" (${body.type}) angelegt`,
    after: { type: body.type, name: body.name, brandId: body.brandId, fromEmail: body.fromEmail },
  });
  res.status(201).json(toApi(created));
});

router.patch("/orgs/tenant/email-channels/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = UpdateChannelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
    return;
  }
  const scope = getScope(req);
  const id = String(req.params["id"]);
  const [existing] = await db
    .select()
    .from(emailChannelsTable)
    .where(and(eq(emailChannelsTable.id, id), eq(emailChannelsTable.tenantId, scope.tenantId)));
  if (!existing) {
    res.status(404).json({ error: "channel not found" });
    return;
  }
  const body = parsed.data;
  const patch: Partial<typeof emailChannelsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.name !== undefined) patch.name = body.name;
  if (body.isActive !== undefined) patch.isActive = body.isActive;
  if (body.brandId !== undefined) patch.brandId = body.brandId ?? null;
  if (body.fromEmail !== undefined) patch.fromEmail = body.fromEmail;
  if (body.fromName !== undefined) patch.fromName = body.fromName ?? null;
  if (body.replyTo !== undefined) patch.replyTo = body.replyTo ?? null;
  if (body.isDefaultTransactional !== undefined) patch.isDefaultTransactional = body.isDefaultTransactional;
  if (body.isDefaultPersonal !== undefined) patch.isDefaultPersonal = body.isDefaultPersonal;
  if (body.config !== undefined) patch.config = body.config as Record<string, unknown>;
  if (body.credentials && Object.keys(body.credentials).length > 0) {
    patch.credentialsCipher = encryptSecret(body.credentials);
  }
  await db.update(emailChannelsTable).set(patch).where(eq(emailChannelsTable.id, id));
  const [updated] = await db
    .select()
    .from(emailChannelsTable)
    .where(eq(emailChannelsTable.id, id));
  await audit(req, {
    entityType: "email_channel",
    entityId: id,
    action: "email_channel.updated",
    summary: `E-Mail-Kanal "${existing.name}" aktualisiert`,
    before: { name: existing.name, isActive: existing.isActive },
    after: { name: updated.name, isActive: updated.isActive },
  });
  res.json(toApi(updated));
});

router.delete("/orgs/tenant/email-channels/:id", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const id = String(req.params["id"]);
  const [existing] = await db
    .select()
    .from(emailChannelsTable)
    .where(and(eq(emailChannelsTable.id, id), eq(emailChannelsTable.tenantId, scope.tenantId)));
  if (!existing) {
    res.status(404).json({ error: "channel not found" });
    return;
  }
  // Refuse to delete a per-user OAuth channel here; the user must disconnect
  // their mailbox via /orgs/me/mailbox so the OAuth row is also cleaned up.
  if (existing.userId) {
    res.status(409).json({ error: "per-user mailbox channel — disconnect via profile page" });
    return;
  }
  await db.delete(emailChannelsTable).where(eq(emailChannelsTable.id, id));
  await audit(req, {
    entityType: "email_channel",
    entityId: id,
    action: "email_channel.deleted",
    summary: `E-Mail-Kanal "${existing.name}" gelöscht`,
    before: { name: existing.name, type: existing.type },
  });
  res.json({ ok: true });
});

const TestSendBody = z.object({
  to: z.string().email(),
});

router.post("/orgs/tenant/email-channels/:id/test", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const parsed = TestSendBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid body", details: parsed.error.flatten() });
    return;
  }
  const scope = getScope(req);
  const id = String(req.params["id"]);
  const [row] = await db
    .select()
    .from(emailChannelsTable)
    .where(and(eq(emailChannelsTable.id, id), eq(emailChannelsTable.tenantId, scope.tenantId)));
  if (!row) {
    res.status(404).json({ error: "channel not found" });
    return;
  }
  const message: EmailMessage = {
    to: [parsed.data.to],
    subject: `[DealFlow] Test-E-Mail von Kanal "${row.name}"`,
    text: `Hallo,\n\ndies ist eine Test-E-Mail aus DealFlow One für den E-Mail-Kanal "${row.name}" (Typ: ${row.type}).\n\nWenn Du diese Nachricht erhältst, ist die Konfiguration erfolgreich.\n\n— DealFlow One`,
    html: `<p>Hallo,</p><p>dies ist eine Test-E-Mail aus DealFlow One für den E-Mail-Kanal <strong>${row.name}</strong> (Typ: <code>${row.type}</code>).</p><p>Wenn Du diese Nachricht erhältst, ist die Konfiguration erfolgreich.</p><p>— DealFlow One</p>`,
    tags: { kind: "channel_test" },
  };
  let status = "ok";
  let detail: string | null = null;
  try {
    const out = await dispatchUsingChannel(row, message);
    detail = out.providerMessageId ?? null;
  } catch (err) {
    status = "failed";
    detail = err instanceof Error ? err.message : String(err);
    logger.warn({ channelId: id, err: detail }, "email channel test failed");
  }
  await db
    .update(emailChannelsTable)
    .set({
      lastTestStatus: status === "ok" ? `ok: ${detail ?? "sent"}` : `failed: ${detail ?? "unknown"}`,
      lastTestAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(emailChannelsTable.id, id));
  await audit(req, {
    entityType: "email_channel",
    entityId: id,
    action: status === "ok" ? "email_channel.test_ok" : "email_channel.test_failed",
    summary:
      status === "ok"
        ? `Test-E-Mail an ${parsed.data.to} via "${row.name}" erfolgreich`
        : `Test-E-Mail an ${parsed.data.to} via "${row.name}" fehlgeschlagen: ${detail}`,
    after: { status, providerMessageId: detail },
  });
  if (status === "ok") {
    res.json({ ok: true, providerMessageId: detail });
  } else {
    res.status(502).json({ ok: false, error: detail });
  }
});

// ── Available senders for a "Send as ..." dropdown. ──────────────────────

router.get("/email-channels/available-senders", async (req, res) => {
  const scope = getScope(req);
  const brandId = typeof req.query["brandId"] === "string" ? req.query["brandId"] : null;
  const useCase = req.query["useCase"] === "transactional" ? "transactional" : "personal";
  const items = await listAvailableSenders({
    tenantId: scope.tenantId,
    userId: scope.user.id,
    brandId,
    useCase,
  });
  res.json({ items });
});

// ── Per-user mailbox status (for the profile page). ──────────────────────

router.get("/orgs/me/mailbox", async (req, res) => {
  const scope = getScope(req);
  const rows = await db
    .select()
    .from(userMailboxConnectionsTable)
    .where(eq(userMailboxConnectionsTable.userId, scope.user.id));
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      email: r.email,
      displayName: r.displayName,
      scope: r.scope,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      channelId: r.channelId,
    })),
  });
});

// ── OAuth connect: protected start endpoint. ─────────────────────────────
// The matching callback lives in routes/mailboxOauth.ts and is mounted at
// /api/auth/mailbox/:provider/callback (public — no session cookie required
// because the third-party redirect cannot guarantee it). State is HMAC-bound
// to the initiating user so the callback can authenticate without a cookie.

function stateSecret(): string {
  return process.env["SESSION_SECRET"] || "dealflow-dev-mailbox-state-secret";
}

export function buildOauthState(userId: string, tenantId: string): string {
  const nonce = randomUUID();
  const expIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const payload = `${userId}.${tenantId}.${nonce}.${expIso}`;
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`, "utf8").toString("base64url");
}

export function verifyOauthState(
  raw: string,
): { userId: string; tenantId: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const lastDot = decoded.lastIndexOf(".");
  if (lastDot < 0) return null;
  const payload = decoded.slice(0, lastDot);
  const sig = decoded.slice(lastDot + 1);
  const expected = createHmac("sha256", stateSecret()).update(payload).digest("hex");
  // timingSafeEqual requires equal-length buffers; if lengths differ it's a
  // mismatch by construction.
  if (sig.length !== expected.length) return null;
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, tenantId, , expIso] = payload.split(".");
  if (!userId || !tenantId || !expIso) return null;
  if (Date.parse(expIso) < Date.now()) return null;
  return { userId, tenantId };
}

export function callbackUrl(req: Request, provider: MailboxProvider): string {
  // Use the artifact's public base URL when available (Replit dev domain in
  // the workspace, custom domain in deployment) so the redirect_uri matches
  // exactly what the OAuth app is registered with.
  const explicit = process.env["PUBLIC_BASE_URL"]?.trim();
  if (explicit) return `${explicit.replace(/\/$/, "")}/api/auth/mailbox/${provider}/callback`;
  const replit = process.env["REPLIT_DEV_DOMAIN"]?.trim();
  if (replit) return `https://${replit}/api/auth/mailbox/${provider}/callback`;
  // Fallback: best-effort reconstruction from the request. May be wrong
  // behind certain proxies; admins should set PUBLIC_BASE_URL.
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) || req.get("host") || "";
  return `${proto}://${host}/api/auth/mailbox/${provider}/callback`;
}

router.post("/orgs/me/mailbox/connect/:provider", async (req, res) => {
  const provider = String(req.params["provider"]) as MailboxProvider;
  if (provider !== "microsoft" && provider !== "google") {
    res.status(400).json({ error: "unknown provider" });
    return;
  }
  if (!isProviderConfigured(provider)) {
    res.status(503).json({
      error: `${provider} OAuth client not configured (set ${
        provider === "microsoft" ? "MS_OAUTH_CLIENT_ID/MS_OAUTH_CLIENT_SECRET" : "GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET"
      })`,
    });
    return;
  }
  const scope = getScope(req);
  const state = buildOauthState(scope.user.id, scope.tenantId);
  const url = buildAuthorizeUrl(provider, {
    redirectUri: callbackUrl(req, provider),
    state,
    loginHint: scope.user.email ?? undefined,
  });
  res.json({ authorizeUrl: url });
});

router.delete("/orgs/me/mailbox/:provider", async (req, res) => {
  const scope = getScope(req);
  const provider = String(req.params["provider"]);
  if (provider !== "microsoft" && provider !== "google") {
    res.status(400).json({ error: "unknown provider" });
    return;
  }
  const rows = await db
    .select()
    .from(userMailboxConnectionsTable)
    .where(
      and(
        eq(userMailboxConnectionsTable.userId, scope.user.id),
        eq(userMailboxConnectionsTable.provider, provider),
      ),
    );
  if (!rows.length) {
    res.json({ ok: true });
    return;
  }
  for (const r of rows) {
    if (r.channelId) {
      await db.delete(emailChannelsTable).where(eq(emailChannelsTable.id, r.channelId));
    }
    await db.delete(userMailboxConnectionsTable).where(eq(userMailboxConnectionsTable.id, r.id));
    await audit(req, {
      entityType: "user_mailbox_connection",
      entityId: r.id,
      action: "user_mailbox.disconnected",
      summary: `Mailbox-Verbindung (${provider}) entfernt`,
      before: { email: r.email, provider: r.provider },
    });
  }
  res.json({ ok: true });
});

export default router;

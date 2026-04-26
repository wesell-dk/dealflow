import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  auditLogTable,
  brandsTable,
  companiesTable,
  leadsTable,
  notificationChannelsTable,
  usersTable,
} from "@workspace/db";
import { decryptSecret, encryptSecret } from "./secretCrypto";
import { assertSafeResolvedUrl } from "./webhooks";
import { logger } from "./logger";

/**
 * Slack/Teams notification dispatcher (Task #263).
 *
 * Design notes
 * ============
 * - Per-Brand: every channel row has a `tenantId` AND a `brandId`. Lookups
 *   are always filtered by both — there is no global tenant-wide channel,
 *   which keeps blast-radius small and matches the brand-form admin UI.
 * - Webhook URL is sensitive (Slack incoming webhooks contain a bearer
 *   token in the path; Teams webhooks are equivalent). We persist only the
 *   AES-256-GCM ciphertext via {@link encryptSecret} and never return it
 *   raw. {@link maskWebhookUrl} produces a UI-safe preview.
 * - SSRF: every outbound POST runs through {@link assertSafeResolvedUrl},
 *   the same guard used by the generic webhook dispatcher. This blocks
 *   private/loopback/link-local addresses including DNS-rebinding.
 * - Failure surfacing: dispatch errors update `lastErrorMessage`/
 *   `lastErrorAt` AND write an audit-log row scoped to the affected lead
 *   (`entityType: "lead"`, `action: "notification_dispatch_failed"`) so the
 *   user sees the failure both in the channel-list and in the lead
 *   timeline. We deliberately do NOT throw out of `dispatchLeadEvent` —
 *   the caller (e.g. widget submit) must always succeed independently.
 * - Test button: {@link sendTest} sends a synthetic message and writes
 *   `lastTestStatus`/`lastTestAt`; it does throw so the admin route can
 *   surface the failure inline.
 * - Retry: {@link retryLeadEvent} re-runs dispatch for a specific lead +
 *   event tuple. Used by the audit/timeline "retry" action.
 *
 * Out of scope (per task spec)
 * - Bidirectional Slack/Teams bots (no slash-commands, no message updates).
 * - Multi-workspace OAuth installations — incoming webhook URL is enough.
 * - Events other than `lead.created` and `lead.appointment_booked`.
 */

export type LeadEvent = "lead.created" | "lead.appointment_booked";

export const SUPPORTED_EVENTS: LeadEvent[] = [
  "lead.created",
  "lead.appointment_booked",
];

export type NotificationKind = "slack" | "teams";

export interface DispatchContext {
  tenantId: string;
  brandId: string;
  event: LeadEvent;
  leadId: string;
  /**
   * Optional source-label, e.g. "website_widget" / "manual" / "import".
   * Used for the "Quelle" line in the message. Falls back to lead.source.
   */
  source?: string | null;
  /**
   * Optional Cal.com booking metadata (only relevant for
   * `lead.appointment_booked`).
   */
  calBooking?: {
    startTime?: string | null;
    endTime?: string | null;
    meetingUrl?: string | null;
    eventType?: string | null;
    bookingId?: string | null;
  } | null;
}

export interface DispatchResult {
  channelId: string;
  ok: boolean;
  status?: number;
  error?: string;
}

/**
 * UI-safe preview of a webhook URL: keep scheme + host + last path segment,
 * mask the rest. We never serve the raw URL back to the client.
 *
 *   https://hooks.slack.com/services/T0/B0/abcdefXYZ
 *     -> https://hooks.slack.com/STAR/abcdefXYZ
 *   https://acme.webhook.office.com/webhookb2/00000000.../IncomingWebhook/abc/def
 *     -> https://acme.webhook.office.com/STAR/def
 */
export function maskWebhookUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const segs = u.pathname.split("/").filter(Boolean);
    const tail = segs[segs.length - 1] ?? "";
    const tailMasked = tail.length > 6 ? `${tail.slice(0, 3)}…${tail.slice(-3)}` : "***";
    return `${u.protocol}//${u.host}/****/${tailMasked}`;
  } catch {
    return "****";
  }
}

/**
 * Encrypt the webhook URL after running the admin-time SSRF guard. The
 * caller must already have verified the URL is well-formed; we re-validate
 * here so a bug in any caller cannot land an unsafe URL in the DB.
 */
export async function prepareWebhookUrlForStorage(raw: string): Promise<string> {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("webhook URL required");
  }
  await assertSafeResolvedUrl(raw.trim());
  return encryptSecret(raw.trim());
}

function readWebhookUrl(cipher: string): string {
  const raw = decryptSecret<string>(cipher);
  if (typeof raw !== "string") throw new Error("notification channel: ciphertext is not a string");
  return raw;
}

// ───────────────────────── Message builders ─────────────────────────

interface BuildContext {
  brand: typeof brandsTable.$inferSelect;
  company: typeof companiesTable.$inferSelect | null;
  lead: typeof leadsTable.$inferSelect;
  owner: typeof usersTable.$inferSelect | null;
  ctx: DispatchContext;
  /** Optional Slack mention token from channel.config (e.g. "<!channel>"). */
  slackMention?: string | null;
}

function appBaseUrl(): string {
  const canonical = process.env["APP_BASE_URL"]?.trim();
  if (canonical) return canonical.replace(/\/$/, "");
  // Local-dev fallback. The link still works because the web app uses the
  // same host under /dealflow-web/ in dev.
  return "";
}

function leadDeepLink(leadId: string): string {
  const base = appBaseUrl();
  return base ? `${base}/dealflow-web/#/leads/${leadId}` : `/dealflow-web/#/leads/${leadId}`;
}

function eventTitle(event: LeadEvent, brandName: string): string {
  if (event === "lead.appointment_booked") return `Termin gebucht — ${brandName}`;
  return `Neuer Lead — ${brandName}`;
}

function fmtCalLine(b: DispatchContext["calBooking"]): string | null {
  if (!b) return null;
  const parts: string[] = [];
  if (b.startTime) parts.push(`Start: ${b.startTime}`);
  if (b.endTime) parts.push(`Ende: ${b.endTime}`);
  if (b.eventType) parts.push(`Typ: ${b.eventType}`);
  if (b.meetingUrl) parts.push(`Meeting: ${b.meetingUrl}`);
  return parts.length ? parts.join(" · ") : null;
}

function buildSlackPayload(b: BuildContext): Record<string, unknown> {
  const { brand, company, lead, owner, ctx, slackMention } = b;
  const link = leadDeepLink(lead.id);
  const lines: string[] = [];
  if (company?.name) lines.push(`*Unternehmen:* ${company.name}`);
  if (lead.companyName && lead.companyName !== company?.name) lines.push(`*Lead-Firma:* ${lead.companyName}`);
  const contactName = lead.name;
  const contactEmail = lead.email;
  const contactPhone = lead.phone;
  if (contactName) lines.push(`*Kontakt:* ${contactName}${contactEmail ? ` <${contactEmail}>` : ""}`);
  if (contactPhone) lines.push(`*Telefon:* ${contactPhone}`);
  const source = ctx.source ?? lead.source;
  if (source) lines.push(`*Quelle:* ${source}`);
  if (lead.aiSummary) lines.push(`*KI-Zusammenfassung:*\n${truncate(lead.aiSummary, 600)}`);
  const calLine = fmtCalLine(ctx.calBooking);
  if (calLine) lines.push(`*Termin:* ${calLine}`);
  const ownerLine = owner ? `${owner.name}${owner.email ? ` <${owner.email}>` : ""}` : "_kein Owner zugewiesen_";
  lines.push(`*Owner:* ${ownerLine}`);
  lines.push(`<${link}|→ Lead in DealFlow öffnen>`);

  const text = `${eventTitle(ctx.event, brand.name)}: ${lead.name}`;
  const mentionPrefix = slackMention ? `${slackMention} ` : "";
  const blocks: Record<string, unknown>[] = [
    { type: "header", text: { type: "plain_text", text: eventTitle(ctx.event, brand.name) } },
    { type: "section", text: { type: "mrkdwn", text: `${mentionPrefix}*${lead.name}*` } },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ];
  return { text, blocks };
}

function buildTeamsPayload(b: BuildContext): Record<string, unknown> {
  const { brand, company, lead, owner, ctx } = b;
  const link = leadDeepLink(lead.id);
  const facts: { name: string; value: string }[] = [];
  if (company?.name) facts.push({ name: "Unternehmen", value: company.name });
  if (lead.companyName && lead.companyName !== company?.name) {
    facts.push({ name: "Lead-Firma", value: lead.companyName });
  }
  const contactName = lead.name;
  const contactEmail = lead.email;
  const contactPhone = lead.phone;
  if (contactName) facts.push({ name: "Kontakt", value: contactEmail ? `${contactName} <${contactEmail}>` : contactName });
  if (contactPhone) facts.push({ name: "Telefon", value: contactPhone });
  const source = ctx.source ?? lead.source;
  if (source) facts.push({ name: "Quelle", value: source });
  facts.push({ name: "Owner", value: owner ? (owner.email ? `${owner.name} <${owner.email}>` : owner.name) : "kein Owner zugewiesen" });
  const calLine = fmtCalLine(ctx.calBooking);
  if (calLine) facts.push({ name: "Termin", value: calLine });

  const sections: Record<string, unknown>[] = [
    { activityTitle: lead.name, facts },
  ];
  if (lead.aiSummary) sections.push({ text: truncate(lead.aiSummary, 800) });
  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    themeColor: "0F4C81",
    summary: `${eventTitle(ctx.event, brand.name)}: ${lead.name}`,
    title: eventTitle(ctx.event, brand.name),
    sections,
    potentialAction: [
      {
        "@type": "OpenUri",
        name: "Lead in DealFlow öffnen",
        targets: [{ os: "default", uri: link }],
      },
    ],
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

// ───────────────────────── HTTP send ─────────────────────────

async function postWebhook(url: string, payload: unknown): Promise<{ status: number }> {
  // Re-validate just-in-time to defeat DNS rebinding between the admin-edit
  // and the actual fetch.
  await assertSafeResolvedUrl(url);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10_000);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
      redirect: "manual",
    });
    if (r.status >= 300 && r.status < 400) {
      // Slack/Teams never legitimately redirect; treat as failure to avoid
      // following a redirect to an unvalidated host.
      throw new Error(`unexpected redirect status ${r.status}`);
    }
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`HTTP ${r.status}${body ? `: ${truncate(body, 200)}` : ""}`);
    }
    return { status: r.status };
  } finally {
    clearTimeout(t);
  }
}

// ───────────────────────── Public API ─────────────────────────

async function loadBuildContext(ctx: DispatchContext): Promise<BuildContext | null> {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, ctx.leadId));
  if (!lead || lead.tenantId !== ctx.tenantId || lead.brandId !== ctx.brandId) return null;
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, ctx.brandId));
  if (!brand) return null;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, brand.companyId));
  let owner: typeof usersTable.$inferSelect | null = null;
  if (lead.ownerId) {
    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, lead.ownerId));
    owner = u ?? null;
  }
  return { brand, company: company ?? null, lead, owner, ctx };
}

async function recordChannelOk(channelId: string): Promise<void> {
  await db.update(notificationChannelsTable)
    .set({ lastErrorMessage: null, lastErrorAt: null, updatedAt: new Date() })
    .where(eq(notificationChannelsTable.id, channelId));
}

async function recordChannelFailure(args: {
  channelId: string;
  tenantId: string;
  brandId: string;
  leadId: string | null;
  event: LeadEvent | "test";
  error: string;
}): Promise<void> {
  const at = new Date();
  await db.update(notificationChannelsTable)
    .set({ lastErrorMessage: truncate(args.error, 500), lastErrorAt: at, updatedAt: at })
    .where(eq(notificationChannelsTable.id, args.channelId));
  // Audit row: scope to the lead so it appears in the lead timeline.
  // Tests use a synthetic leadId — fall back to brand entity in that case.
  await db.insert(auditLogTable).values({
    id: `au_${randomUUID().slice(0, 10)}`,
    tenantId: args.tenantId,
    entityType: args.leadId ? "lead" : "brand",
    entityId: args.leadId ?? args.brandId,
    action: "notification_dispatch_failed",
    actor: "Notification-Dispatcher",
    summary: `${args.event} an Channel ${args.channelId} fehlgeschlagen: ${truncate(args.error, 200)}`,
    beforeJson: null,
    afterJson: JSON.stringify({ channelId: args.channelId, event: args.event, error: args.error }),
    activeScopeJson: null,
    at,
  });
}

async function dispatchToChannel(
  channel: typeof notificationChannelsTable.$inferSelect,
  build: BuildContext,
): Promise<DispatchResult> {
  try {
    const url = readWebhookUrl(channel.webhookUrlCipher);
    const slackMention = (channel.config as { mention?: unknown } | null)?.mention;
    const payload = channel.kind === "teams"
      ? buildTeamsPayload({ ...build, slackMention: null })
      : buildSlackPayload({ ...build, slackMention: typeof slackMention === "string" ? slackMention : null });
    const r = await postWebhook(url, payload);
    await recordChannelOk(channel.id);
    return { channelId: channel.id, ok: true, status: r.status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ channelId: channel.id, leadId: build.lead.id, event: build.ctx.event, err: msg }, "notification dispatch failed");
    await recordChannelFailure({
      channelId: channel.id,
      tenantId: channel.tenantId,
      brandId: channel.brandId,
      leadId: build.lead.id,
      event: build.ctx.event,
      error: msg,
    });
    return { channelId: channel.id, ok: false, error: msg };
  }
}

/**
 * Dispatch a lead event to every active channel of the brand that has the
 * event enabled. Never throws — the caller (widget submit, cal-webhook,
 * etc.) must complete its primary work regardless of notification status.
 */
export async function dispatchLeadEvent(ctx: DispatchContext): Promise<DispatchResult[]> {
  try {
    const build = await loadBuildContext(ctx);
    if (!build) return [];
    const channels = await db.select().from(notificationChannelsTable)
      .where(and(
        eq(notificationChannelsTable.tenantId, ctx.tenantId),
        eq(notificationChannelsTable.brandId, ctx.brandId),
        eq(notificationChannelsTable.isActive, true),
      ));
    const matching = channels.filter((c) => Array.isArray(c.eventsEnabled) && c.eventsEnabled.includes(ctx.event));
    if (matching.length === 0) return [];
    const results: DispatchResult[] = [];
    for (const ch of matching) {
      // Sequential — Slack/Teams incoming webhooks are rate-limited per
      // workspace, and we want deterministic ordering for the audit log.
      results.push(await dispatchToChannel(ch, build));
    }
    return results;
  } catch (err) {
    // Defensive: an unexpected DB error must not propagate.
    logger.error({ ctx, err }, "dispatchLeadEvent unexpected failure");
    return [];
  }
}

/**
 * Send a synthetic test message. Throws on failure so the admin "Test"
 * button can show the error inline.
 */
export async function sendTest(args: {
  channelId: string;
  tenantId: string;
}): Promise<{ status: number }> {
  const [channel] = await db.select().from(notificationChannelsTable)
    .where(and(
      eq(notificationChannelsTable.id, args.channelId),
      eq(notificationChannelsTable.tenantId, args.tenantId),
    ));
  if (!channel) throw new Error("channel not found");
  const url = readWebhookUrl(channel.webhookUrlCipher);
  const at = new Date();
  try {
    const fakePayload = channel.kind === "teams"
      ? {
          "@type": "MessageCard",
          "@context": "http://schema.org/extensions",
          themeColor: "0F4C81",
          summary: "DealFlow Test-Benachrichtigung",
          title: "DealFlow Test-Benachrichtigung",
          sections: [{ text: "Wenn du das siehst, ist der Channel korrekt verbunden." }],
        }
      : {
          text: "DealFlow Test-Benachrichtigung",
          blocks: [
            { type: "header", text: { type: "plain_text", text: "DealFlow Test-Benachrichtigung" } },
            { type: "section", text: { type: "mrkdwn", text: "Wenn du das siehst, ist der Channel korrekt verbunden." } },
          ],
        };
    const r = await postWebhook(url, fakePayload);
    await db.update(notificationChannelsTable).set({
      lastTestStatus: "ok",
      lastTestAt: at,
      lastErrorMessage: null,
      lastErrorAt: null,
      updatedAt: at,
    }).where(eq(notificationChannelsTable.id, channel.id));
    return r;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(notificationChannelsTable).set({
      lastTestStatus: `error: ${truncate(msg, 200)}`,
      lastTestAt: at,
      lastErrorMessage: truncate(msg, 500),
      lastErrorAt: at,
      updatedAt: at,
    }).where(eq(notificationChannelsTable.id, channel.id));
    await recordChannelFailure({
      channelId: channel.id,
      tenantId: channel.tenantId,
      brandId: channel.brandId,
      leadId: null,
      event: "test",
      error: msg,
    });
    throw err;
  }
}

/**
 * Re-dispatch a lead event for ONE specific channel — used by the
 * audit-row "retry" action. Returns the dispatch result so the route can
 * surface it inline.
 */
export async function retryLeadEvent(args: {
  tenantId: string;
  channelId: string;
  leadId: string;
  event: LeadEvent;
  source?: string | null;
  calBooking?: DispatchContext["calBooking"];
}): Promise<DispatchResult> {
  const [channel] = await db.select().from(notificationChannelsTable)
    .where(and(
      eq(notificationChannelsTable.id, args.channelId),
      eq(notificationChannelsTable.tenantId, args.tenantId),
    ));
  if (!channel) throw new Error("channel not found");
  const build = await loadBuildContext({
    tenantId: args.tenantId,
    brandId: channel.brandId,
    event: args.event,
    leadId: args.leadId,
    source: args.source ?? null,
    calBooking: args.calBooking ?? null,
  });
  if (!build) throw new Error("lead not found in this brand");
  return dispatchToChannel(channel, build);
}

import { createHash, randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  emailChannelsTable,
  emailSendLogTable,
  type emailChannelsTable as _ECT,
} from "@workspace/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { logger } from "../logger";
import { decryptSecret } from "../secretCrypto";
import type {
  AdapterContext,
  AdapterResult,
  EmailAdapter,
  EmailChannelRow,
  EmailChannelType,
  EmailMessage,
  EmailUseCase,
} from "./types";
import { systemAdapter } from "./adapters/system";
import { smtpAdapter } from "./adapters/smtp";
import { microsoftGraphAdapter } from "./adapters/microsoftGraph";
import { gmailApiAdapter } from "./adapters/gmailApi";
import { webhookAdapter } from "./adapters/webhook";

type EmailChannelDbRow = typeof _ECT.$inferSelect;

const ADAPTERS: Record<EmailChannelType, EmailAdapter> = {
  system: systemAdapter,
  smtp: smtpAdapter,
  microsoft_graph: microsoftGraphAdapter,
  gmail_api: gmailApiAdapter,
  webhook: webhookAdapter,
};

const ALLOWED_TYPES: ReadonlySet<EmailChannelType> = new Set([
  "system",
  "smtp",
  "microsoft_graph",
  "gmail_api",
  "webhook",
]);

export function isValidChannelType(t: string): t is EmailChannelType {
  return ALLOWED_TYPES.has(t as EmailChannelType);
}

export interface DispatchContext {
  tenantId: string;
  /** Use-case decides which default channel applies when no override is set. */
  useCase: EmailUseCase;
  /** Brand the message is associated with (drives brand-specific defaults). */
  brandId?: string | null;
  /** User initiating the send (drives "personal mailbox" use cases). */
  userId?: string | null;
  /** Explicit channel override from the UI ("Send as ..."). */
  channelIdOverride?: string | null;
  /** Free-form context for the audit trail (e.g. {entityType:"quote",entityId:"q_…"}). */
  contextEntityType?: string | null;
  contextEntityId?: string | null;
}

export interface DispatchResult {
  ok: boolean;
  channelId: string | null;
  channelType: EmailChannelType;
  providerMessageId: string | null;
  error?: string | null;
}

const SYSTEM_FALLBACK: EmailChannelRow = {
  id: "ch_system_fallback",
  tenantId: "*",
  type: "system",
  name: "System",
  brandId: null,
  userId: null,
  fromEmail: process.env["MAIL_FROM_EMAIL"]?.trim() || "no-reply@dealflow.local",
  fromName: process.env["MAIL_FROM_NAME"]?.trim() || "DealFlow",
  replyTo: null,
  config: {},
  credentials: null,
};

function rowToChannel(row: EmailChannelDbRow): EmailChannelRow {
  let creds: Record<string, unknown> | null = null;
  if (row.credentialsCipher) {
    try {
      creds = decryptSecret<Record<string, unknown>>(row.credentialsCipher);
    } catch (err) {
      logger.warn(
        {
          channelId: row.id,
          tenantId: row.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        "email channel credentials could not be decrypted — adapter will likely fail",
      );
    }
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: (isValidChannelType(row.type) ? row.type : "system") as EmailChannelType,
    name: row.name,
    brandId: row.brandId,
    userId: row.userId,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    replyTo: row.replyTo,
    config: (row.config ?? {}) as Record<string, unknown>,
    credentials: creds,
  };
}

async function loadActiveChannels(tenantId: string): Promise<EmailChannelDbRow[]> {
  return db
    .select()
    .from(emailChannelsTable)
    .where(and(eq(emailChannelsTable.tenantId, tenantId), eq(emailChannelsTable.isActive, true)));
}

function pickDefault(
  rows: EmailChannelDbRow[],
  useCase: EmailUseCase,
  brandId: string | null | undefined,
): EmailChannelDbRow | null {
  const flagKey = useCase === "personal" ? "isDefaultPersonal" : "isDefaultTransactional";
  const isFlagged = (r: EmailChannelDbRow): boolean =>
    Boolean((r as unknown as Record<string, boolean>)[flagKey]);
  // Prefer a flagged channel scoped to the brand…
  if (brandId) {
    const brandFlagged = rows.find((r) => r.brandId === brandId && r.userId === null && isFlagged(r));
    if (brandFlagged) return brandFlagged;
  }
  // …then a tenant-wide flagged channel…
  const tenantFlagged = rows.find((r) => r.brandId === null && r.userId === null && isFlagged(r));
  if (tenantFlagged) return tenantFlagged;
  // …otherwise any tenant-wide channel of any type.
  return rows.find((r) => r.brandId === null && r.userId === null) ?? null;
}

async function resolveChannel(ctx: DispatchContext): Promise<EmailChannelRow> {
  if (ctx.channelIdOverride) {
    const rows = await db
      .select()
      .from(emailChannelsTable)
      .where(
        and(
          eq(emailChannelsTable.id, ctx.channelIdOverride),
          eq(emailChannelsTable.tenantId, ctx.tenantId),
          eq(emailChannelsTable.isActive, true),
        ),
      );
    if (!rows.length) {
      throw new Error(`email channel ${ctx.channelIdOverride} not found or inactive`);
    }
    const row = rows[0];
    // If the channel is per-user, only the owner may select it. This prevents
    // user A from sending "as user B" by guessing a channel id.
    if (row.userId && row.userId !== ctx.userId) {
      throw new Error(`email channel ${ctx.channelIdOverride} is not available to this user`);
    }
    return rowToChannel(row);
  }
  const rows = await loadActiveChannels(ctx.tenantId);
  if (rows.length === 0) {
    return { ...SYSTEM_FALLBACK, tenantId: ctx.tenantId };
  }
  // For "personal" use-case, prefer the user's own connected mailbox.
  if (ctx.useCase === "personal" && ctx.userId) {
    const personal = rows.find((r) => r.userId === ctx.userId);
    if (personal) return rowToChannel(personal);
  }
  const def = pickDefault(rows, ctx.useCase, ctx.brandId);
  if (def) return rowToChannel(def);
  return { ...SYSTEM_FALLBACK, tenantId: ctx.tenantId };
}

function subjectFingerprint(subject: string): string {
  // Keep enough entropy to correlate sends but never log full subject lines
  // (they may contain customer/quote names that the audit reader does not
  // need to see). Truncated SHA-256 is plenty for a fingerprint.
  return createHash("sha256").update(subject, "utf8").digest("hex").slice(0, 16);
}

export async function dispatchEmail(
  message: EmailMessage,
  ctx: DispatchContext,
): Promise<DispatchResult> {
  const correlationId = randomUUID();
  let channel: EmailChannelRow;
  try {
    channel = await resolveChannel(ctx);
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        tenantId: ctx.tenantId,
        useCase: ctx.useCase,
      },
      "email dispatcher: channel resolution failed",
    );
    return {
      ok: false,
      channelId: null,
      channelType: "system",
      providerMessageId: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const adapter = ADAPTERS[channel.type];
  let outcome: AdapterResult | null = null;
  let error: string | null = null;
  try {
    outcome = await adapter.send(message, {
      tenantId: ctx.tenantId,
      channel,
      correlationId,
    });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.warn(
      {
        err: error,
        channelId: channel.id,
        channelType: channel.type,
        useCase: ctx.useCase,
      },
      "email dispatcher: adapter send failed",
    );
  }
  // Best-effort send-log insert. Failure here must NOT break the caller —
  // every email already routes through the dispatcher and a downed log table
  // would otherwise block all outbound mail.
  try {
    await db.insert(emailSendLogTable).values({
      id: `mail_${correlationId.replace(/-/g, "").slice(0, 24)}`,
      tenantId: ctx.tenantId,
      channelId: channel.id === SYSTEM_FALLBACK.id ? null : channel.id,
      channelType: channel.type,
      useCase: ctx.useCase,
      contextEntityType: ctx.contextEntityType ?? null,
      contextEntityId: ctx.contextEntityId ?? null,
      brandId: ctx.brandId ?? null,
      initiatedByUserId: ctx.userId ?? null,
      fromEmail: channel.fromEmail,
      toJson: JSON.stringify(message.to),
      ccJson: message.cc?.length ? JSON.stringify(message.cc) : null,
      subjectHash: subjectFingerprint(message.subject),
      status: error ? "failed" : "sent",
      providerMessageId: outcome?.providerMessageId ?? null,
      errorMessage: error,
      attachmentsCount: message.attachments?.length ?? 0,
      attachmentsBytes:
        message.attachments?.reduce((s, a) => s + a.content.length, 0) ?? 0,
    });
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        channelId: channel.id,
      },
      "email dispatcher: failed to write email_send_log",
    );
  }
  return {
    ok: !error,
    channelId: channel.id === SYSTEM_FALLBACK.id ? null : channel.id,
    channelType: channel.type,
    providerMessageId: outcome?.providerMessageId ?? null,
    error,
  };
}

/**
 * Returns the list of channels the given (tenantId, userId) is allowed to
 * pick in a "Send as ..." dropdown. Includes the system fallback when no
 * tenant channel exists, so the dialog is never empty.
 */
export async function listAvailableSenders(args: {
  tenantId: string;
  userId: string;
  brandId?: string | null;
  useCase: EmailUseCase;
}): Promise<
  Array<{
    id: string | null;
    type: EmailChannelType;
    name: string;
    fromEmail: string;
    fromName: string | null;
    isPersonal: boolean;
    isDefault: boolean;
  }>
> {
  const rows = await loadActiveChannels(args.tenantId);
  const result: Array<{
    id: string | null;
    type: EmailChannelType;
    name: string;
    fromEmail: string;
    fromName: string | null;
    isPersonal: boolean;
    isDefault: boolean;
  }> = [];
  // Always offer the system default.
  result.push({
    id: null,
    type: "system",
    name: "System (Default)",
    fromEmail: SYSTEM_FALLBACK.fromEmail,
    fromName: SYSTEM_FALLBACK.fromName,
    isPersonal: false,
    isDefault: rows.length === 0,
  });
  const def = pickDefault(rows, args.useCase, args.brandId ?? null);
  for (const r of rows) {
    // Per-user channels: only show to the owner.
    if (r.userId && r.userId !== args.userId) continue;
    // Brand-scoped channels: only show when the brand matches (or unspecified).
    if (r.brandId && args.brandId && r.brandId !== args.brandId) continue;
    result.push({
      id: r.id,
      type: r.type as EmailChannelType,
      name: r.name,
      fromEmail: r.fromEmail,
      fromName: r.fromName,
      isPersonal: r.userId === args.userId,
      isDefault: def?.id === r.id,
    });
  }
  return result;
}

/** Public for the "Send test email" admin action. */
export async function dispatchUsingChannel(
  channelRow: EmailChannelDbRow,
  message: EmailMessage,
): Promise<AdapterResult> {
  const channel = rowToChannel(channelRow);
  const adapter = ADAPTERS[channel.type];
  return adapter.send(message, {
    tenantId: channelRow.tenantId,
    channel,
    correlationId: randomUUID(),
  });
}
// silence unused-import lint for re-exported helpers
void isNull;

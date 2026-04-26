/**
 * Shared types for the multi-channel email subsystem.
 *
 * Adapter contract is intentionally narrow: the dispatcher hands the adapter
 * a fully-rendered `EmailMessage` plus the matching channel row, the adapter
 * returns either a success result with provider metadata or throws.
 */

import type { EmailAttachment, SendEmailInput } from "../email";

export type EmailChannelType =
  | "system"
  | "smtp"
  | "microsoft_graph"
  | "gmail_api"
  | "webhook";

export type EmailUseCase =
  | "transactional" // owner notifications, system alerts
  | "personal" // user-initiated send (collab invite, quote send)
  | "test"; // admin "Send test email" button

export interface EmailMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  attachments?: EmailAttachment[];
  /** Provider-neutral tags (Resend/Graph treat them differently). */
  tags?: Record<string, string>;
}

export interface ResolvedSender {
  email: string;
  name: string | null;
  replyTo?: string | null;
}

export interface EmailChannelRow {
  id: string;
  tenantId: string;
  type: EmailChannelType;
  name: string;
  brandId: string | null;
  userId: string | null;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  config: Record<string, unknown>;
  /** Decrypted secrets — never persist this, never return it from the API. */
  credentials: Record<string, unknown> | null;
}

export interface AdapterContext {
  tenantId: string;
  channel: EmailChannelRow;
  /** A redacted message-id surrogate for log correlation. */
  correlationId: string;
}

export interface AdapterResult {
  providerMessageId: string | null;
  /** Optional opaque provider response for debugging (never returned to UI). */
  providerInfo?: Record<string, unknown>;
}

export interface EmailAdapter {
  type: EmailChannelType;
  send(message: EmailMessage, ctx: AdapterContext): Promise<AdapterResult>;
}

/**
 * Convenience converter for adapters that fall back to the legacy
 * `sendEmail` helper (notably the system/Resend channel).
 */
export function toLegacySendInput(message: EmailMessage, sender: ResolvedSender): SendEmailInput {
  return {
    to: message.to,
    cc: message.cc,
    from: { email: sender.email, name: sender.name ?? undefined },
    subject: message.subject,
    html: message.html,
    text: message.text,
    replyTo: message.replyTo ?? sender.replyTo ?? null,
    tags: message.tags,
    attachments: message.attachments,
  };
}

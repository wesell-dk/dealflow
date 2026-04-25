import { logger } from "./logger";

/**
 * Generic outbound-mail service.
 *
 * Strategy:
 *  - If RESEND_API_KEY is set, send via Resend's HTTP API (no SDK dependency).
 *  - Otherwise the "log" provider is used: the message is written to the
 *    structured logger so dev/test environments stay fully functional and
 *    auditors can still see exactly what would have been sent.
 *
 * The function never throws: it always resolves with a result object so
 * callers can decide whether to surface the failure to the user without
 * blocking the underlying business action (e.g. magic-link creation).
 */

export interface SendEmailInput {
  to: string;
  from: { email: string; name?: string | null };
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  tags?: Record<string, string>;
}

export interface SendEmailResult {
  ok: boolean;
  provider: "resend" | "log";
  messageId?: string | null;
  error?: string | null;
}

function fromHeader(from: SendEmailInput["from"]): string {
  if (from.name && from.name.trim()) {
    const cleaned = from.name.replace(/[\r\n"]/g, "").trim();
    return `${cleaned} <${from.email}>`;
  }
  return from.email;
}

async function sendViaResend(input: SendEmailInput, apiKey: string): Promise<SendEmailResult> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: fromHeader(input.from),
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo ?? undefined,
        tags: input.tags
          ? Object.entries(input.tags).map(([name, value]) => ({ name, value }))
          : undefined,
      }),
    });
    if (!res.ok) {
      // SECURITY: never log the recipient address or response body — provider
      // error responses can echo request payloads (which contain magic-link
      // tokens). Log only status + recipient domain.
      await res.text().catch(() => "");
      logger.warn(
        { provider: "resend", status: res.status, recipientDomain: recipientDomain(input.to) },
        "email send failed",
      );
      return { ok: false, provider: "resend", error: `resend ${res.status}` };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { ok: true, provider: "resend", messageId: json.id ?? null };
  } catch (err) {
    logger.warn(
      {
        provider: "resend",
        err: err instanceof Error ? err.message : String(err),
        recipientDomain: recipientDomain(input.to),
      },
      "email send threw",
    );
    return {
      ok: false,
      provider: "resend",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function recipientDomain(to: string): string {
  const at = to.lastIndexOf("@");
  return at >= 0 ? to.slice(at + 1).toLowerCase() : "unknown";
}

function sendViaLog(input: SendEmailInput): SendEmailResult {
  // SECURITY: never log the email body, subject details, or recipient address —
  // invite emails contain magic-link tokens (bearer credentials) and recipient
  // PII. Log only minimal, non-credential metadata so dev/test runs stay
  // observable without leaking auth material into centralized logs.
  logger.info(
    {
      provider: "log",
      recipientDomain: recipientDomain(input.to),
      fromDomain: recipientDomain(input.from.email),
      subjectLength: input.subject.length,
      htmlLength: input.html.length,
      textLength: input.text.length,
      tagNames: input.tags ? Object.keys(input.tags) : null,
    },
    "outbound email (log provider — no real delivery configured)",
  );
  return { ok: true, provider: "log", messageId: null };
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (apiKey && apiKey.trim()) {
    return sendViaResend(input, apiKey.trim());
  }
  return sendViaLog(input);
}

export function activeEmailProvider(): "resend" | "log" {
  const apiKey = process.env["RESEND_API_KEY"];
  return apiKey && apiKey.trim() ? "resend" : "log";
}

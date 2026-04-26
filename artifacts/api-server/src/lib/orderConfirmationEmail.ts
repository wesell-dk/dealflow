import { type SendEmailResult, type EmailAttachment } from "./email";
import { dispatchEmail } from "./email/dispatcher";

export interface OcEmailTemplateInput {
  number: string;
  customer: string;
  brand: string;
}

const FALLBACK_SUBJECT_DE = "Auftragsbestätigung {{number}} – {{brand}}";
const FALLBACK_BODY_DE = [
  "Sehr geehrte Damen und Herren,",
  "",
  "anbei finden Sie die Auftragsbestätigung {{number}} zu Ihrem Auftrag.",
  "Bitte prüfen Sie die Bestätigung und melden Sie sich bei Rückfragen.",
  "",
  "Im Anschluss erhalten Sie den dazugehörigen Vertrag separat zur Gegenzeichnung.",
  "",
  "Mit freundlichen Grüßen",
  "{{brand}}",
].join("\n");

const FALLBACK_SUBJECT_EN = "Order confirmation {{number}} – {{brand}}";
const FALLBACK_BODY_EN = [
  "Dear Sir or Madam,",
  "",
  "please find attached order confirmation {{number}} for your order.",
  "Kindly review the confirmation and reach out should you have any questions.",
  "",
  "The corresponding contract will follow separately for counter-signature.",
  "",
  "Kind regards",
  "{{brand}}",
].join("\n");

function applyPlaceholders(template: string, vars: OcEmailTemplateInput): string {
  return template
    .replace(/\{\{\s*number\s*\}\}/g, vars.number)
    .replace(/\{\{\s*customer\s*\}\}/g, vars.customer)
    .replace(/\{\{\s*brand\s*\}\}/g, vars.brand);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainTextToHtml(s: string): string {
  return escapeHtml(s).replace(/\n/g, "<br />");
}

/**
 * Resolve subject/body for the order-confirmation customer mail.
 * Order of precedence:
 *  1. Caller-provided subject/note (note is appended below the default body).
 *  2. Built-in default for the chosen language.
 */
export function resolveOcEmailDefaults(args: {
  language: "de" | "en";
  vars: OcEmailTemplateInput;
  note?: string | null;
}): { subject: string; body: string } {
  const lang = args.language;
  const subject = applyPlaceholders(
    lang === "en" ? FALLBACK_SUBJECT_EN : FALLBACK_SUBJECT_DE,
    args.vars,
  );
  let body = applyPlaceholders(
    lang === "en" ? FALLBACK_BODY_EN : FALLBACK_BODY_DE,
    args.vars,
  );
  const trimmedNote = args.note?.trim();
  if (trimmedNote) {
    const intro = lang === "en" ? "Additional note from your sales contact:" : "Zusatzhinweis Ihres Ansprechpartners:";
    body = `${body}\n\n— ${intro}\n${trimmedNote}`;
  }
  return { subject, body };
}

/**
 * Wraps the order-confirmation email body in a minimal branded HTML envelope
 * (mirrors `buildQuoteEmailHtml` so customers see a consistent presentation).
 */
export function buildOcEmailHtml(args: {
  brandName: string;
  legalEntityName: string | null;
  addressLine: string | null;
  primaryColor: string | null;
  body: string;
  language: "de" | "en";
}): string {
  const accent = args.primaryColor && /^#[0-9a-fA-F]{6}$/.test(args.primaryColor)
    ? args.primaryColor
    : "#2563eb";
  const eyebrow = args.language === "en" ? "Order confirmation" : "Auftragsbestätigung";
  const footer = [args.legalEntityName, args.addressLine]
    .filter(Boolean)
    .map((s) => escapeHtml(String(s)))
    .join(" · ");
  return `<!doctype html>
<html lang="${args.language}">
  <body style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#0b1220">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <tr>
        <td style="padding:24px 28px;border-bottom:3px solid ${accent}">
          <div style="font-size:13px;color:#64748b;letter-spacing:0.04em;text-transform:uppercase">${escapeHtml(eyebrow)}</div>
          <div style="font-size:20px;font-weight:600;margin-top:4px;color:${accent}">${escapeHtml(args.brandName)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px;font-size:14px;line-height:1.6;color:#0b1220">
          ${plainTextToHtml(args.body)}
        </td>
      </tr>
      ${footer
        ? `<tr><td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #f1f5f9;font-size:12px;color:#64748b">${footer}</td></tr>`
        : ""}
    </table>
  </body>
</html>`;
}

export interface SendOcEmailInput {
  to: string;
  subject: string;
  body: string;
  language: "de" | "en";
  brandName: string;
  legalEntityName: string | null;
  addressLine: string | null;
  primaryColor: string | null;
  replyTo: string | null;
  pdf: { filename: string; bytes: Buffer };
  ocNumber: string;
  ocId: string;
  channel: {
    tenantId: string;
    userId: string | null;
    brandId: string | null;
    channelIdOverride?: string | null;
  };
}

export async function sendOrderConfirmationEmail(
  input: SendOcEmailInput,
): Promise<SendEmailResult> {
  const html = buildOcEmailHtml({
    brandName: input.brandName,
    legalEntityName: input.legalEntityName,
    addressLine: input.addressLine,
    primaryColor: input.primaryColor,
    body: input.body,
    language: input.language,
  });
  const attachments: EmailAttachment[] = [
    {
      filename: input.pdf.filename,
      content: input.pdf.bytes,
      contentType: "application/pdf",
    },
  ];
  const result = await dispatchEmail(
    {
      to: [input.to],
      subject: input.subject,
      html,
      text: input.body,
      replyTo: input.replyTo,
      tags: { kind: "order_confirmation_send", ocId: input.ocId, ocNumber: input.ocNumber },
      attachments,
    },
    {
      tenantId: input.channel.tenantId,
      brandId: input.channel.brandId,
      userId: input.channel.userId,
      useCase: "personal",
      channelIdOverride: input.channel.channelIdOverride ?? null,
      contextEntityType: "order_confirmation",
      contextEntityId: input.ocId,
    },
  );
  return {
    ok: result.ok,
    provider: result.channelType === "system" ? "log" : "resend",
    messageId: result.providerMessageId,
    error: result.error ?? null,
  };
}

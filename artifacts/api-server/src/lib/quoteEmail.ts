import { sendEmail, type SendEmailResult, type EmailAttachment } from "./email";

export interface QuoteEmailTemplateInput {
  number: string;
  customer: string;
  brand: string;
  validUntil: string;
}

export interface QuoteEmailContent {
  subject: string;
  text: string;
  html: string;
}

const FALLBACK_SUBJECT_DE = "Angebot {{number}} – {{brand}}";
const FALLBACK_BODY_DE = [
  "Sehr geehrte Damen und Herren,",
  "",
  "anbei finden Sie unser Angebot {{number}}.",
  "Das Angebot ist gültig bis {{validUntil}}.",
  "",
  "Bei Rückfragen stehen wir Ihnen gerne zur Verfügung.",
  "",
  "Mit freundlichen Grüßen",
  "{{brand}}",
].join("\n");

const FALLBACK_SUBJECT_EN = "Quote {{number}} – {{brand}}";
const FALLBACK_BODY_EN = [
  "Dear Sir or Madam,",
  "",
  "please find attached our quote {{number}}.",
  "The quote is valid until {{validUntil}}.",
  "",
  "Should you have any questions, please feel free to reach out.",
  "",
  "Kind regards",
  "{{brand}}",
].join("\n");

function applyPlaceholders(
  template: string,
  vars: QuoteEmailTemplateInput,
): string {
  return template
    .replace(/\{\{\s*number\s*\}\}/g, vars.number)
    .replace(/\{\{\s*customer\s*\}\}/g, vars.customer)
    .replace(/\{\{\s*brand\s*\}\}/g, vars.brand)
    .replace(/\{\{\s*validUntil\s*\}\}/g, vars.validUntil);
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
 * Resolve subject and body for the "send quote" email.
 *
 * Order of precedence:
 *  1. Caller-provided subject/message (always wins — comes from the dialog).
 *  2. Brand-specific template (`brands.quoteEmailSubjectTemplate` /
 *     `quoteEmailBodyTemplate`).
 *  3. Built-in default for the chosen language.
 *
 * Both subject and body run through placeholder substitution so the brand
 * template author can use {{number}}, {{customer}}, {{brand}}, {{validUntil}}.
 */
export function resolveQuoteEmailDefaults(args: {
  language: "de" | "en";
  brandSubjectTemplate: string | null;
  brandBodyTemplate: string | null;
  vars: QuoteEmailTemplateInput;
}): { subject: string; body: string } {
  const lang = args.language;
  const subjectTpl = args.brandSubjectTemplate?.trim()
    ? args.brandSubjectTemplate
    : lang === "en"
      ? FALLBACK_SUBJECT_EN
      : FALLBACK_SUBJECT_DE;
  const bodyTpl = args.brandBodyTemplate?.trim()
    ? args.brandBodyTemplate
    : lang === "en"
      ? FALLBACK_BODY_EN
      : FALLBACK_BODY_DE;
  return {
    subject: applyPlaceholders(subjectTpl, args.vars),
    body: applyPlaceholders(bodyTpl, args.vars),
  };
}

/**
 * Wraps a plain-text quote message into a minimal branded HTML envelope.
 * Mirrors the visual style of the collaborator emails so the customer sees
 * a consistent "from this company" presentation.
 */
export function buildQuoteEmailHtml(args: {
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
  const eyebrow = args.language === "en" ? "Commercial quote" : "Angebot";
  const footer = [args.legalEntityName, args.addressLine]
    .filter(Boolean)
    .map(s => escapeHtml(String(s)))
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

function senderName(brandName: string): { name: string; email: string } {
  const fromEmail =
    process.env["MAIL_FROM_EMAIL"]?.trim() || "no-reply@dealflow.local";
  const baseName = process.env["MAIL_FROM_NAME"]?.trim() || "DealFlow";
  if (brandName.trim()) {
    return { name: `${baseName} · ${brandName.trim()}`, email: fromEmail };
  }
  return { name: baseName, email: fromEmail };
}

export interface SendQuoteEmailInput {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  language: "de" | "en";
  brandName: string;
  legalEntityName: string | null;
  addressLine: string | null;
  primaryColor: string | null;
  replyTo: string | null;
  pdf: { filename: string; bytes: Buffer };
  quoteNumber: string;
  quoteId: string;
}

export async function sendQuoteEmail(
  input: SendQuoteEmailInput,
): Promise<SendEmailResult> {
  const html = buildQuoteEmailHtml({
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
  const from = senderName(input.brandName);
  return sendEmail({
    to: input.to,
    cc: input.cc,
    from,
    subject: input.subject,
    html,
    text: input.body,
    replyTo: input.replyTo,
    tags: { kind: "quote_send", quoteId: input.quoteId, quoteNumber: input.quoteNumber },
    attachments,
  });
}

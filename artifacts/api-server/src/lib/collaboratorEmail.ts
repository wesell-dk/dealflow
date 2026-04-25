import { sendEmail, type SendEmailResult } from "./email";

export interface CollaboratorEmailInput {
  recipientEmail: string;
  recipientName: string | null;
  organization: string | null;
  inviterName: string;
  inviterEmail: string | null;
  brandName: string | null;
  contractTitle: string;
  capabilities: ReadonlyArray<"view" | "comment" | "edit_fields" | "sign_party">;
  expiresAt: Date;
  magicLinkUrl: string;
  ipAllowlistCount: number;
}

const CAP_LABEL_DE: Record<string, string> = {
  view: "Lesen",
  comment: "Kommentieren",
  edit_fields: "Felder bearbeiten",
  sign_party: "Mitzeichnen",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateDe(d: Date): string {
  // 24.05.2026
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${d.getUTCFullYear()}`;
}

function senderName(brandName: string | null): { name: string; email: string } {
  const fromEmail = process.env["MAIL_FROM_EMAIL"]?.trim() || "no-reply@dealflow.local";
  const baseName = process.env["MAIL_FROM_NAME"]?.trim() || "DealFlow";
  if (brandName && brandName.trim()) {
    return { name: `${baseName} · ${brandName.trim()}`, email: fromEmail };
  }
  return { name: baseName, email: fromEmail };
}

export function buildCollaboratorInviteContent(input: CollaboratorEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const greetingName = input.recipientName?.trim() || input.recipientEmail;
  const brandLine = input.brandName ? input.brandName : "DealFlow";
  const subject = input.brandName
    ? `${input.brandName}: Vertragsfreigabe für ${input.contractTitle}`
    : `Vertragsfreigabe für ${input.contractTitle}`;

  const capLabels = input.capabilities.map((c) => CAP_LABEL_DE[c] ?? c).join(", ");
  const expiresStr = formatDateDe(input.expiresAt);
  const inviterLine = input.inviterEmail
    ? `${input.inviterName} (${input.inviterEmail})`
    : input.inviterName;
  const ipLine =
    input.ipAllowlistCount > 0
      ? `Hinweis: Der Zugriff ist auf ${input.ipAllowlistCount} freigegebene IP-Adresse${input.ipAllowlistCount === 1 ? "" : "n"} beschränkt.`
      : null;

  const text = [
    `Hallo ${greetingName},`,
    "",
    `${inviterLine} hat Sie als externe/n Mitwirkende/n für den Vertrag „${input.contractTitle}“ freigegeben${input.organization ? ` (${input.organization})` : ""}.`,
    "",
    `Berechtigungen: ${capLabels}`,
    `Gültig bis: ${expiresStr}`,
    ...(ipLine ? [ipLine] : []),
    "",
    "Öffnen Sie den Vertrag über folgenden Link:",
    input.magicLinkUrl,
    "",
    "Der Link ist persönlich und sollte nicht weitergegeben werden. Bei Fragen antworten Sie einfach auf diese E-Mail.",
    "",
    `— ${brandLine} via DealFlow`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="de">
  <body style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#0b1220">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <tr>
        <td style="padding:24px 28px;border-bottom:1px solid #f1f5f9">
          <div style="font-size:13px;color:#64748b;letter-spacing:0.04em;text-transform:uppercase">${escapeHtml(brandLine)}</div>
          <div style="font-size:20px;font-weight:600;margin-top:4px">Vertragsfreigabe</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px">
          <p style="margin:0 0 12px">Hallo ${escapeHtml(greetingName)},</p>
          <p style="margin:0 0 12px">
            <strong>${escapeHtml(inviterLine)}</strong> hat Sie als externe/n Mitwirkende/n für den Vertrag
            „<strong>${escapeHtml(input.contractTitle)}</strong>“ freigegeben${input.organization ? ` (${escapeHtml(input.organization)})` : ""}.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px;color:#0b1220">
            <tr>
              <td style="padding:4px 12px 4px 0;color:#64748b">Berechtigungen</td>
              <td style="padding:4px 0">${escapeHtml(capLabels)}</td>
            </tr>
            <tr>
              <td style="padding:4px 12px 4px 0;color:#64748b">Gültig bis</td>
              <td style="padding:4px 0">${escapeHtml(expiresStr)}</td>
            </tr>
            ${
              ipLine
                ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">IP-Beschränkung</td><td style="padding:4px 0">${escapeHtml(ipLine)}</td></tr>`
                : ""
            }
          </table>
          <p style="margin:24px 0">
            <a href="${escapeHtml(input.magicLinkUrl)}"
               style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">
              Vertrag öffnen
            </a>
          </p>
          <p style="margin:0 0 8px;font-size:12px;color:#64748b">
            Falls der Button nicht funktioniert, kopieren Sie folgenden Link in den Browser:
          </p>
          <p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#1d4ed8">
            ${escapeHtml(input.magicLinkUrl)}
          </p>
          <p style="margin:24px 0 0;font-size:12px;color:#64748b">
            Der Link ist persönlich und sollte nicht weitergegeben werden. Bei Fragen antworten Sie einfach auf diese E-Mail.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 28px;background:#f8fafc;border-top:1px solid #f1f5f9;font-size:12px;color:#64748b">
          ${escapeHtml(brandLine)} via DealFlow
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

export async function sendCollaboratorInviteEmail(
  input: CollaboratorEmailInput,
): Promise<SendEmailResult> {
  const { subject, html, text } = buildCollaboratorInviteContent(input);
  const from = senderName(input.brandName);
  return sendEmail({
    to: input.recipientEmail,
    from,
    subject,
    html,
    text,
    replyTo: input.inviterEmail,
    tags: {
      kind: "external_collaborator_invite",
    },
  });
}

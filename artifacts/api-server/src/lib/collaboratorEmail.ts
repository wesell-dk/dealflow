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
  view: "View",
  comment: "Comment",
  edit_fields: "Edit fields",
  sign_party: "Countersign",
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
  // 2026-05-24
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}-${day}`;
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
    ? `${input.brandName}: Contract access for ${input.contractTitle}`
    : `Contract access for ${input.contractTitle}`;

  const capLabels = input.capabilities.map((c) => CAP_LABEL_DE[c] ?? c).join(", ");
  const expiresStr = formatDateDe(input.expiresAt);
  const inviterLine = input.inviterEmail
    ? `${input.inviterName} (${input.inviterEmail})`
    : input.inviterName;
  const ipLine =
    input.ipAllowlistCount > 0
      ? `Note: Access is restricted to ${input.ipAllowlistCount} approved IP address${input.ipAllowlistCount === 1 ? "" : "es"}.`
      : null;

  const text = [
    `Hello ${greetingName},`,
    "",
    `${inviterLine} has shared the contract "${input.contractTitle}" with you as an external collaborator${input.organization ? ` (${input.organization})` : ""}.`,
    "",
    `Permissions: ${capLabels}`,
    `Valid until: ${expiresStr}`,
    ...(ipLine ? [ipLine] : []),
    "",
    "Open the contract using the following link:",
    input.magicLinkUrl,
    "",
    "This link is personal and should not be shared. If you have any questions, simply reply to this email.",
    "",
    `— ${brandLine} via DealFlow`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#0b1220">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <tr>
        <td style="padding:24px 28px;border-bottom:1px solid #f1f5f9">
          <div style="font-size:13px;color:#64748b;letter-spacing:0.04em;text-transform:uppercase">${escapeHtml(brandLine)}</div>
          <div style="font-size:20px;font-weight:600;margin-top:4px">Contract access</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px">
          <p style="margin:0 0 12px">Hello ${escapeHtml(greetingName)},</p>
          <p style="margin:0 0 12px">
            <strong>${escapeHtml(inviterLine)}</strong> has shared the contract
            "<strong>${escapeHtml(input.contractTitle)}</strong>" with you as an external collaborator${input.organization ? ` (${escapeHtml(input.organization)})` : ""}.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px;color:#0b1220">
            <tr>
              <td style="padding:4px 12px 4px 0;color:#64748b">Permissions</td>
              <td style="padding:4px 0">${escapeHtml(capLabels)}</td>
            </tr>
            <tr>
              <td style="padding:4px 12px 4px 0;color:#64748b">Valid until</td>
              <td style="padding:4px 0">${escapeHtml(expiresStr)}</td>
            </tr>
            ${
              ipLine
                ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">IP restriction</td><td style="padding:4px 0">${escapeHtml(ipLine)}</td></tr>`
                : ""
            }
          </table>
          <p style="margin:24px 0">
            <a href="${escapeHtml(input.magicLinkUrl)}"
               style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">
              Open contract
            </a>
          </p>
          <p style="margin:0 0 8px;font-size:12px;color:#64748b">
            If the button does not work, copy the following link into your browser:
          </p>
          <p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#1d4ed8">
            ${escapeHtml(input.magicLinkUrl)}
          </p>
          <p style="margin:24px 0 0;font-size:12px;color:#64748b">
            This link is personal and should not be shared. If you have any questions, simply reply to this email.
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

// ─────────────────────────────────────────────────────────────────────────
// Counter-signature confirmation e-mails.
// Sent after a successful POST /external/:token/sign so that:
//  a) the external lawyer keeps a paper trail outside our app, and
//  b) the internal contract owner is notified that the counter-signature
//     came in (mirror of the in-app timeline entry).
// ─────────────────────────────────────────────────────────────────────────

export interface CollaboratorSignConfirmationInput {
  recipientEmail: string;
  signerName: string;
  organization: string | null;
  brandName: string | null;
  contractTitle: string;
  dealName: string | null;
  signedAt: Date;
  magicLinkUrl: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
}

function formatDateTimeDe(d: Date): string {
  // 2026-05-24, 14:32 (UTC)
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}, ${hh}:${mm} (UTC)`;
}

export function buildCollaboratorSignConfirmationContent(
  input: CollaboratorSignConfirmationInput,
): { subject: string; html: string; text: string } {
  const brandLine = input.brandName ? input.brandName : "DealFlow";
  const subject = input.brandName
    ? `${input.brandName}: Countersignature confirmed – ${input.contractTitle}`
    : `Countersignature confirmed – ${input.contractTitle}`;
  const signedStr = formatDateTimeDe(input.signedAt);
  const dealLine = input.dealName ? input.dealName : null;
  const ownerLine = input.ownerName
    ? input.ownerEmail
      ? `${input.ownerName} (${input.ownerEmail})`
      : input.ownerName
    : null;
  const orgLine = input.organization ?? null;

  const text = [
    `Hello ${input.signerName},`,
    "",
    `Your countersignature for the contract "${input.contractTitle}" has been received.`,
    "",
    `Countersigner: ${input.signerName}${orgLine ? ` (${orgLine})` : ""}`,
    `Received at: ${signedStr}`,
    ...(dealLine ? [`Deal: ${dealLine}`] : []),
    ...(ownerLine ? [`Internal owner: ${ownerLine}`] : []),
    "",
    ...(input.magicLinkUrl
      ? [
          "You can continue to view the contract using the following link:",
          input.magicLinkUrl,
          "",
        ]
      : []),
    "This email serves as a confirmation of receipt. If you have any questions, simply reply.",
    "",
    `— ${brandLine} via DealFlow`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#0b1220">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <tr>
        <td style="padding:24px 28px;border-bottom:1px solid #f1f5f9">
          <div style="font-size:13px;color:#64748b;letter-spacing:0.04em;text-transform:uppercase">${escapeHtml(brandLine)}</div>
          <div style="font-size:20px;font-weight:600;margin-top:4px">Countersignature confirmed</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px">
          <p style="margin:0 0 12px">Hello ${escapeHtml(input.signerName)},</p>
          <p style="margin:0 0 12px">
            Your countersignature for the contract
            "<strong>${escapeHtml(input.contractTitle)}</strong>" has been received.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px;color:#0b1220">
            <tr>
              <td style="padding:4px 12px 4px 0;color:#64748b">Countersigner</td>
              <td style="padding:4px 0">${escapeHtml(input.signerName)}${orgLine ? ` (${escapeHtml(orgLine)})` : ""}</td>
            </tr>
            <tr>
              <td style="padding:4px 12px 4px 0;color:#64748b">Received at</td>
              <td style="padding:4px 0">${escapeHtml(signedStr)}</td>
            </tr>
            ${
              dealLine
                ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Deal</td><td style="padding:4px 0">${escapeHtml(dealLine)}</td></tr>`
                : ""
            }
            ${
              ownerLine
                ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Internal owner</td><td style="padding:4px 0">${escapeHtml(ownerLine)}</td></tr>`
                : ""
            }
          </table>
          ${
            input.magicLinkUrl
              ? `<p style="margin:24px 0">
                  <a href="${escapeHtml(input.magicLinkUrl)}"
                     style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:8px">
                    Open contract
                  </a>
                </p>
                <p style="margin:0 0 8px;font-size:12px;color:#64748b">
                  If the button does not work, copy the following link into your browser:
                </p>
                <p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#1d4ed8">
                  ${escapeHtml(input.magicLinkUrl)}
                </p>`
              : ""
          }
          <p style="margin:24px 0 0;font-size:12px;color:#64748b">
            This email serves as a confirmation of receipt. If you have any questions, simply reply.
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

export async function sendCollaboratorSignConfirmationEmail(
  input: CollaboratorSignConfirmationInput,
): Promise<SendEmailResult> {
  const { subject, html, text } = buildCollaboratorSignConfirmationContent(input);
  const from = senderName(input.brandName);
  return sendEmail({
    to: input.recipientEmail,
    from,
    subject,
    html,
    text,
    replyTo: input.ownerEmail,
    tags: {
      kind: "external_collaborator_sign_confirmation",
    },
  });
}

export interface OwnerCounterSignNotificationInput {
  recipientEmail: string;
  recipientName: string | null;
  signerName: string;
  signerEmail: string;
  organization: string | null;
  brandName: string | null;
  contractTitle: string;
  dealName: string | null;
  signedAt: Date;
  magicLinkUrl: string | null;
}

export function buildOwnerCounterSignNotificationContent(
  input: OwnerCounterSignNotificationInput,
): { subject: string; html: string; text: string } {
  const brandLine = input.brandName ? input.brandName : "DealFlow";
  const subject = input.brandName
    ? `${input.brandName}: External countersignature – ${input.contractTitle}`
    : `External countersignature – ${input.contractTitle}`;
  const signedStr = formatDateTimeDe(input.signedAt);
  const greetingName = input.recipientName?.trim() || input.recipientEmail;
  const signerLine = input.organization
    ? `${input.signerName} (${input.organization}, ${input.signerEmail})`
    : `${input.signerName} (${input.signerEmail})`;

  const text = [
    `Hello ${greetingName},`,
    "",
    `An external countersignature for the contract "${input.contractTitle}" has been received.`,
    "",
    `Countersigner: ${signerLine}`,
    `Received at: ${signedStr}`,
    ...(input.dealName ? [`Deal: ${input.dealName}`] : []),
    "",
    ...(input.magicLinkUrl
      ? [
          "External reviewer link (same token as the countersigner):",
          input.magicLinkUrl,
          "",
        ]
      : []),
    "Please check the further signature and order confirmation status in DealFlow.",
    "",
    `— DealFlow`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="font-family:system-ui,Segoe UI,Helvetica,Arial,sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#0b1220">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <tr>
        <td style="padding:24px 28px;border-bottom:1px solid #f1f5f9">
          <div style="font-size:13px;color:#64748b;letter-spacing:0.04em;text-transform:uppercase">${escapeHtml(brandLine)}</div>
          <div style="font-size:20px;font-weight:600;margin-top:4px">External countersignature received</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px">
          <p style="margin:0 0 12px">Hello ${escapeHtml(greetingName)},</p>
          <p style="margin:0 0 12px">
            An external countersignature has been received for the contract
            "<strong>${escapeHtml(input.contractTitle)}</strong>".
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px;color:#0b1220">
            <tr>
              <td style="padding:4px 12px 4px 0;color:#64748b">Countersigner</td>
              <td style="padding:4px 0">${escapeHtml(signerLine)}</td>
            </tr>
            <tr>
              <td style="padding:4px 12px 4px 0;color:#64748b">Received at</td>
              <td style="padding:4px 0">${escapeHtml(signedStr)}</td>
            </tr>
            ${
              input.dealName
                ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Deal</td><td style="padding:4px 0">${escapeHtml(input.dealName)}</td></tr>`
                : ""
            }
          </table>
          ${
            input.magicLinkUrl
              ? `<p style="margin:0 0 8px;font-size:12px;color:#64748b">
                  External reviewer link (same token as the countersigner):
                </p>
                <p style="margin:0 0 16px;font-size:12px;word-break:break-all;color:#1d4ed8">
                  ${escapeHtml(input.magicLinkUrl)}
                </p>`
              : ""
          }
          <p style="margin:24px 0 0;font-size:12px;color:#64748b">
            Please check the further signature and order confirmation status in DealFlow.
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

export async function sendOwnerCounterSignNotificationEmail(
  input: OwnerCounterSignNotificationInput,
): Promise<SendEmailResult> {
  const { subject, html, text } = buildOwnerCounterSignNotificationContent(input);
  const from = senderName(input.brandName);
  return sendEmail({
    to: input.recipientEmail,
    from,
    subject,
    html,
    text,
    replyTo: input.signerEmail,
    tags: {
      kind: "external_collaborator_sign_owner_notification",
    },
  });
}

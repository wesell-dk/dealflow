import type {
  AdapterContext,
  AdapterResult,
  EmailAdapter,
  EmailMessage,
} from "../types";
import { db } from "@workspace/db";
import { userMailboxConnectionsTable, emailChannelsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret } from "../../secretCrypto";
import { refreshAccessToken } from "../oauth";

interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAtIso: string;
  scope?: string | null;
}

async function loadTokens(ctx: AdapterContext): Promise<GoogleTokens> {
  const channelCreds = (ctx.channel.credentials ?? {}) as Partial<GoogleTokens>;
  if (channelCreds.accessToken) {
    return {
      accessToken: channelCreds.accessToken,
      refreshToken: channelCreds.refreshToken ?? null,
      expiresAtIso: channelCreds.expiresAtIso ?? new Date(0).toISOString(),
      scope: channelCreds.scope ?? null,
    };
  }
  if (!ctx.channel.userId) {
    throw new Error("gmail_api adapter: no credentials and no user mailbox link");
  }
  const rows = await db
    .select()
    .from(userMailboxConnectionsTable)
    .where(eq(userMailboxConnectionsTable.userId, ctx.channel.userId));
  const row = rows.find((r) => r.provider === "google" && r.tenantId === ctx.tenantId);
  if (!row) throw new Error("gmail_api adapter: user mailbox not connected");
  return decryptSecret<GoogleTokens>(row.tokensCipher);
}

async function persistRefreshedTokens(
  ctx: AdapterContext,
  tokens: GoogleTokens,
): Promise<void> {
  const cipher = encryptSecret(tokens);
  if (ctx.channel.userId) {
    await db
      .update(userMailboxConnectionsTable)
      .set({
        tokensCipher: cipher,
        expiresAt: new Date(tokens.expiresAtIso),
        updatedAt: new Date(),
      })
      .where(eq(userMailboxConnectionsTable.userId, ctx.channel.userId));
  }
  await db
    .update(emailChannelsTable)
    .set({ credentialsCipher: cipher, updatedAt: new Date() })
    .where(eq(emailChannelsTable.id, ctx.channel.id));
}

async function ensureFreshAccessToken(ctx: AdapterContext): Promise<string> {
  const tokens = await loadTokens(ctx);
  const expires = new Date(tokens.expiresAtIso).getTime();
  if (expires - Date.now() > 60_000) return tokens.accessToken;
  if (!tokens.refreshToken) {
    throw new Error("gmail_api adapter: access token expired and no refresh token available");
  }
  const refreshed = await refreshAccessToken("google", tokens.refreshToken);
  const next: GoogleTokens = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAtIso: refreshed.expiresAtIso,
    scope: refreshed.scope,
  };
  await persistRefreshedTokens(ctx, next);
  return next.accessToken;
}

function encodeHeaderValue(v: string): string {
  // RFC 2047 encoded-word for non-ASCII headers (subject, from name).
  if (/^[\x20-\x7e]*$/.test(v)) return v;
  return `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

function buildRfc822(message: EmailMessage, ctx: AdapterContext): string {
  const boundary = `dfb_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  const fromHeader = ctx.channel.fromName
    ? `${encodeHeaderValue(ctx.channel.fromName)} <${ctx.channel.fromEmail}>`
    : ctx.channel.fromEmail;
  const headers: string[] = [
    `From: ${fromHeader}`,
    `To: ${message.to.join(", ")}`,
  ];
  if (message.cc?.length) headers.push(`Cc: ${message.cc.join(", ")}`);
  if (message.bcc?.length) headers.push(`Bcc: ${message.bcc.join(", ")}`);
  const replyTo = message.replyTo ?? ctx.channel.replyTo ?? null;
  if (replyTo) headers.push(`Reply-To: ${replyTo}`);
  headers.push(`Subject: ${encodeHeaderValue(message.subject)}`);
  headers.push("MIME-Version: 1.0");

  const attachments = message.attachments ?? [];
  if (attachments.length === 0) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const body = [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(message.text, "utf8").toString("base64"),
      `--${boundary}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(message.html, "utf8").toString("base64"),
      `--${boundary}--`,
      "",
    ].join("\r\n");
    return `${headers.join("\r\n")}\r\n\r\n${body}`;
  }

  const altBoundary = `${boundary}_alt`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts: string[] = [];
  parts.push(`--${boundary}`);
  parts.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);
  parts.push("");
  parts.push(`--${altBoundary}`);
  parts.push("Content-Type: text/plain; charset=UTF-8");
  parts.push("Content-Transfer-Encoding: base64");
  parts.push("");
  parts.push(Buffer.from(message.text, "utf8").toString("base64"));
  parts.push(`--${altBoundary}`);
  parts.push("Content-Type: text/html; charset=UTF-8");
  parts.push("Content-Transfer-Encoding: base64");
  parts.push("");
  parts.push(Buffer.from(message.html, "utf8").toString("base64"));
  parts.push(`--${altBoundary}--`);
  for (const a of attachments) {
    parts.push(`--${boundary}`);
    parts.push(
      `Content-Type: ${a.contentType ?? "application/octet-stream"}; name="${a.filename}"`,
    );
    parts.push(`Content-Disposition: attachment; filename="${a.filename}"`);
    parts.push("Content-Transfer-Encoding: base64");
    parts.push("");
    parts.push(a.content.toString("base64"));
  }
  parts.push(`--${boundary}--`);
  parts.push("");
  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
}

function toBase64Url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const gmailApiAdapter: EmailAdapter = {
  type: "gmail_api",
  async send(message: EmailMessage, ctx: AdapterContext): Promise<AdapterResult> {
    const accessToken = await ensureFreshAccessToken(ctx);
    const raw = toBase64Url(buildRfc822(message, ctx));
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`gmail_api adapter: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    return { providerMessageId: json.id ?? null };
  },
};

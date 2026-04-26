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

interface GraphTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAtIso: string;
  scope?: string | null;
}

async function loadTokens(ctx: AdapterContext): Promise<GraphTokens> {
  const channelCreds = (ctx.channel.credentials ?? {}) as Partial<GraphTokens>;
  if (channelCreds.accessToken) {
    return {
      accessToken: channelCreds.accessToken,
      refreshToken: channelCreds.refreshToken ?? null,
      expiresAtIso: channelCreds.expiresAtIso ?? new Date(0).toISOString(),
      scope: channelCreds.scope ?? null,
    };
  }
  // Fallback: tokens live on user_mailbox_connections (per-user).
  if (!ctx.channel.userId) {
    throw new Error("microsoft_graph adapter: no credentials and no user mailbox link");
  }
  const rows = await db
    .select()
    .from(userMailboxConnectionsTable)
    .where(eq(userMailboxConnectionsTable.userId, ctx.channel.userId));
  const row = rows.find((r) => r.provider === "microsoft" && r.tenantId === ctx.tenantId);
  if (!row) throw new Error("microsoft_graph adapter: user mailbox not connected");
  return decryptSecret<GraphTokens>(row.tokensCipher);
}

async function persistRefreshedTokens(
  ctx: AdapterContext,
  tokens: GraphTokens,
): Promise<void> {
  const cipher = encryptSecret(tokens);
  // Per-user connection row update (tokens are the source of truth).
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
  // Mirror onto the channel row so the in-memory cred dict stays consistent.
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
    throw new Error("microsoft_graph adapter: access token expired and no refresh token available");
  }
  const refreshed = await refreshAccessToken("microsoft", tokens.refreshToken);
  const next: GraphTokens = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAtIso: refreshed.expiresAtIso,
    scope: refreshed.scope,
  };
  await persistRefreshedTokens(ctx, next);
  return next.accessToken;
}

function buildGraphPayload(message: EmailMessage, ctx: AdapterContext) {
  return {
    message: {
      subject: message.subject,
      body: { contentType: "HTML", content: message.html || message.text },
      toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
      ccRecipients: (message.cc ?? []).map((address) => ({ emailAddress: { address } })),
      bccRecipients: (message.bcc ?? []).map((address) => ({ emailAddress: { address } })),
      replyTo: message.replyTo
        ? [{ emailAddress: { address: message.replyTo } }]
        : ctx.channel.replyTo
          ? [{ emailAddress: { address: ctx.channel.replyTo } }]
          : undefined,
      attachments: (message.attachments ?? []).map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.filename,
        contentType: a.contentType ?? "application/octet-stream",
        contentBytes: a.content.toString("base64"),
      })),
      from: {
        emailAddress: {
          address: ctx.channel.fromEmail,
          ...(ctx.channel.fromName ? { name: ctx.channel.fromName } : {}),
        },
      },
    },
    saveToSentItems: true,
  };
}

export const microsoftGraphAdapter: EmailAdapter = {
  type: "microsoft_graph",
  async send(message: EmailMessage, ctx: AdapterContext): Promise<AdapterResult> {
    const accessToken = await ensureFreshAccessToken(ctx);
    const mailbox = (ctx.channel.config as { mailbox?: string }).mailbox || ctx.channel.fromEmail;
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/sendMail`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildGraphPayload(message, ctx)),
    });
    if (!res.ok && res.status !== 202) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`microsoft_graph adapter: HTTP ${res.status}${errBody ? ` — ${errBody.slice(0, 200)}` : ""}`);
    }
    // Graph /sendMail returns 202 Accepted with no body and no message-id.
    return { providerMessageId: null, providerInfo: { status: res.status } };
  },
};

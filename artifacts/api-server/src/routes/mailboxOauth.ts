import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { emailChannelsTable, userMailboxConnectionsTable } from "@workspace/db/schema";

import { logger } from "../lib/logger";
import { encryptSecret } from "../lib/secretCrypto";
import {
  decodeEmailClaim,
  exchangeCodeForTokens,
  fetchMailboxIdentity,
  type MailboxProvider,
} from "../lib/email/oauth";
import { callbackUrl, verifyOauthState } from "./emailChannels";

const router: IRouter = Router();

/**
 * Public callback for OAuth mailbox connect.
 *
 * Flow:
 *   1. User triggers `/orgs/me/mailbox/connect/:provider` — server returns
 *      the provider's authorize URL with a signed state.
 *   2. Provider redirects back here with `?code=…&state=…`.
 *   3. We verify the state HMAC (binds to userId/tenantId), exchange the
 *      code for tokens, encrypt them, and create-or-update the connection
 *      row plus a matching `email_channels` row of type microsoft_graph
 *      or gmail_api.
 *   4. We redirect the browser to /profile?connected=<provider>.
 *
 * The route is public because the third-party redirect cannot carry a
 * session cookie reliably — instead the state token authenticates the user.
 */

function escapeRedirect(value: string): string {
  // Tight whitelist for the success/error parameter (alphanum + dash).
  return value.replace(/[^a-z0-9_-]/gi, "");
}

router.get("/auth/mailbox/:provider/callback", async (req, res) => {
  const provider = String(req.params["provider"]) as MailboxProvider;
  if (provider !== "microsoft" && provider !== "google") {
    res.status(400).send("unknown provider");
    return;
  }
  const code = typeof req.query["code"] === "string" ? req.query["code"] : null;
  const state = typeof req.query["state"] === "string" ? req.query["state"] : null;
  const providerError =
    typeof req.query["error"] === "string" ? req.query["error"] : null;

  // Most front-ends mount under the artifact's BASE_URL (e.g. "/dealflow-web/")
  // — we fall back to "/" if not configured.
  const webBase = (process.env["WEB_APP_BASE_URL"]?.trim() || "/dealflow-web/").replace(/\/$/, "/");
  const success = (p: string) => `${webBase}profile?connected=${escapeRedirect(p)}`;
  const failure = (reason: string) =>
    `${webBase}profile?error=${encodeURIComponent(reason)}`;

  if (providerError) {
    logger.warn({ provider, providerError }, "mailbox OAuth provider returned error");
    res.redirect(failure(`provider:${providerError}`));
    return;
  }
  if (!code || !state) {
    res.redirect(failure("missing code or state"));
    return;
  }
  const verified = verifyOauthState(state);
  if (!verified) {
    res.redirect(failure("state validation failed"));
    return;
  }
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(provider, code, callbackUrl(req, provider));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ provider, err: msg }, "mailbox OAuth code exchange failed");
    res.redirect(failure(`exchange:${msg.slice(0, 80)}`));
    return;
  }
  // Identify the mailbox: prefer the userinfo endpoint, fall back to
  // the id_token claim (when present).
  const identity = await fetchMailboxIdentity(provider, tokens.accessToken);
  const email =
    identity.email
    ?? decodeEmailClaim((tokens as unknown as { idToken?: string }).idToken)
    ?? null;
  if (!email) {
    res.redirect(failure("mailbox email could not be determined"));
    return;
  }
  const tokensCipher = encryptSecret({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAtIso: tokens.expiresAtIso,
    scope: tokens.scope,
  });
  const channelType = provider === "microsoft" ? "microsoft_graph" : "gmail_api";
  const channelName =
    provider === "microsoft" ? `Outlook · ${email}` : `Gmail · ${email}`;

  // Upsert connection row (one per (userId, provider)).
  const existingConn = await db
    .select()
    .from(userMailboxConnectionsTable)
    .where(
      and(
        eq(userMailboxConnectionsTable.userId, verified.userId),
        eq(userMailboxConnectionsTable.provider, provider),
      ),
    );
  const now = new Date();
  let channelId: string;
  if (existingConn.length > 0) {
    const conn = existingConn[0];
    channelId = conn.channelId
      ?? `ch_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
    await db
      .update(userMailboxConnectionsTable)
      .set({
        email,
        displayName: identity.name,
        scope: tokens.scope,
        tokensCipher,
        expiresAt: new Date(tokens.expiresAtIso),
        channelId,
        updatedAt: now,
      })
      .where(eq(userMailboxConnectionsTable.id, conn.id));
  } else {
    channelId = `ch_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
    await db.insert(userMailboxConnectionsTable).values({
      id: `umc_${Math.random().toString(36).slice(2, 10)}`,
      tenantId: verified.tenantId,
      userId: verified.userId,
      provider,
      email,
      displayName: identity.name,
      scope: tokens.scope,
      tokensCipher,
      expiresAt: new Date(tokens.expiresAtIso),
      channelId,
    });
  }

  // Upsert matching channel row. The dispatcher loads the credentials from
  // the connection row at send time, but we also mirror them onto the
  // channel so test sends from the admin UI work without indirection.
  const existingCh = await db
    .select()
    .from(emailChannelsTable)
    .where(eq(emailChannelsTable.id, channelId));
  if (existingCh.length > 0) {
    await db
      .update(emailChannelsTable)
      .set({
        name: channelName,
        fromEmail: email,
        fromName: identity.name,
        config: { mailbox: email },
        credentialsCipher: tokensCipher,
        isActive: true,
        updatedAt: now,
      })
      .where(eq(emailChannelsTable.id, channelId));
  } else {
    await db.insert(emailChannelsTable).values({
      id: channelId,
      tenantId: verified.tenantId,
      type: channelType,
      name: channelName,
      isActive: true,
      brandId: null,
      userId: verified.userId,
      isDefaultTransactional: false,
      isDefaultPersonal: false,
      fromEmail: email,
      fromName: identity.name,
      replyTo: null,
      config: { mailbox: email },
      credentialsCipher: tokensCipher,
      createdBy: verified.userId,
    });
  }

  res.redirect(success(provider));
});

export default router;

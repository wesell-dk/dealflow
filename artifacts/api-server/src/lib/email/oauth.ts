/**
 * Shared OAuth helpers for Microsoft Graph and Gmail API mailbox connections.
 *
 * The provider-specific routes only need to call:
 *  - buildAuthorizeUrl(provider, opts)
 *  - exchangeCodeForTokens(provider, code, redirectUri)
 *  - refreshAccessToken(provider, refreshToken)
 *
 * Credentials live in env vars (resolved per-call so a developer can rotate
 * a value without restarting the API):
 *
 *   MS_OAUTH_CLIENT_ID       OAuth Application (single-tenant or common)
 *   MS_OAUTH_CLIENT_SECRET   Application secret
 *   MS_OAUTH_TENANT          Optional override of the AAD tenant in the URL
 *
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 */

export type MailboxProvider = "microsoft" | "google";

export interface OAuthEnv {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
}

const MS_TOKEN_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const MS_AUTH_URL = (tenant: string) =>
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;

const MS_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://graph.microsoft.com/Mail.Send",
];

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
];

export function getOAuthEnv(provider: MailboxProvider): OAuthEnv {
  if (provider === "microsoft") {
    const clientId = process.env["MS_OAUTH_CLIENT_ID"]?.trim() ?? "";
    const clientSecret = process.env["MS_OAUTH_CLIENT_SECRET"]?.trim() ?? "";
    const tenant = process.env["MS_OAUTH_TENANT"]?.trim() || "common";
    return {
      clientId,
      clientSecret,
      authUrl: MS_AUTH_URL(tenant),
      tokenUrl: MS_TOKEN_URL(tenant),
      scopes: MS_SCOPES,
    };
  }
  const clientId = process.env["GOOGLE_OAUTH_CLIENT_ID"]?.trim() ?? "";
  const clientSecret = process.env["GOOGLE_OAUTH_CLIENT_SECRET"]?.trim() ?? "";
  return {
    clientId,
    clientSecret,
    authUrl: GOOGLE_AUTH_URL,
    tokenUrl: GOOGLE_TOKEN_URL,
    scopes: GOOGLE_SCOPES,
  };
}

export function isProviderConfigured(provider: MailboxProvider): boolean {
  const env = getOAuthEnv(provider);
  return env.clientId.length > 0 && env.clientSecret.length > 0;
}

export interface AuthorizeUrlOpts {
  redirectUri: string;
  state: string;
  loginHint?: string;
}

export function buildAuthorizeUrl(provider: MailboxProvider, opts: AuthorizeUrlOpts): string {
  const env = getOAuthEnv(provider);
  if (!env.clientId) {
    throw new Error(`${provider} OAuth client not configured`);
  }
  const params = new URLSearchParams({
    client_id: env.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: env.scopes.join(" "),
    state: opts.state,
  });
  if (provider === "google") {
    // Google requires explicit prompt + access_type for refresh tokens.
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    params.set("include_granted_scopes", "true");
  }
  if (opts.loginHint) {
    params.set("login_hint", opts.loginHint);
  }
  return `${env.authUrl}?${params.toString()}`;
}

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresAtIso: string;
  scope: string | null;
  tokenType: string;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

function normalize(raw: RawTokenResponse): OAuthTokenResponse {
  if (!raw.access_token) {
    throw new Error(
      raw.error_description || raw.error || "OAuth token response missing access_token",
    );
  }
  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : 3600;
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAtIso: new Date(Date.now() + Math.max(60, expiresIn - 30) * 1000).toISOString(),
    scope: raw.scope ?? null,
    tokenType: raw.token_type ?? "Bearer",
  };
}

async function postForm(url: string, body: URLSearchParams): Promise<RawTokenResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });
  // Token endpoints may return 4xx with a JSON body — surface the structured
  // error so the caller can show the operator what went wrong.
  const text = await res.text();
  let raw: RawTokenResponse = {};
  try {
    raw = text ? (JSON.parse(text) as RawTokenResponse) : {};
  } catch {
    raw = { error: `non-json response (status ${res.status})` };
  }
  if (!res.ok) {
    throw new Error(raw.error_description || raw.error || `HTTP ${res.status}`);
  }
  return raw;
}

export async function exchangeCodeForTokens(
  provider: MailboxProvider,
  code: string,
  redirectUri: string,
): Promise<OAuthTokenResponse> {
  const env = getOAuthEnv(provider);
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  return normalize(await postForm(env.tokenUrl, body));
}

export async function refreshAccessToken(
  provider: MailboxProvider,
  refreshToken: string,
): Promise<OAuthTokenResponse> {
  const env = getOAuthEnv(provider);
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  // Google omits refresh_token from refresh responses; carry it forward.
  const raw = await postForm(env.tokenUrl, body);
  if (!raw.refresh_token) raw.refresh_token = refreshToken;
  return normalize(raw);
}

/** Decodes the `email` claim from an unverified ID token, when present. */
export function decodeEmailClaim(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { email?: string };
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/**
 * Calls the provider's "userinfo" / "/me" endpoint to enrich the locally
 * stored mailbox display name. Failure is non-fatal — we just leave the name
 * unset.
 */
export async function fetchMailboxIdentity(
  provider: MailboxProvider,
  accessToken: string,
): Promise<{ email: string | null; name: string | null }> {
  try {
    if (provider === "microsoft") {
      const res = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) return { email: null, name: null };
      const j = (await res.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
      return {
        email: j.mail ?? j.userPrincipalName ?? null,
        name: j.displayName ?? null,
      };
    }
    const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { email: null, name: null };
    const j = (await res.json()) as { email?: string; name?: string };
    return { email: j.email ?? null, name: j.name ?? null };
  } catch {
    return { email: null, name: null };
  }
}

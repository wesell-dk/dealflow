/**
 * Build the absolute Magic-Link URL embedded in the invite e-mail.
 *
 * SECURITY: The base URL is server-trusted, NOT derived from caller-controlled
 * request headers (`Host`, `X-Forwarded-Proto`). Header-based fallback would
 * let an attacker who can spoof the `Host` header craft invite emails sent
 * from our infrastructure but pointing to attacker-controlled origins.
 *
 * Resolution order (first match wins):
 *  1. If `APP_BASE_URL` env is set → that is the only canonical origin.
 *     A caller-provided `magicLinkBaseUrl` is accepted only if its host
 *     matches `APP_BASE_URL`'s host (allows callers to pass the Web-App
 *     sub-path so the link resolves correctly under non-root routing).
 *     Cross-host bases are silently dropped → falls back to the canonical
 *     base. We deliberately do NOT return null so a misconfigured client
 *     cannot block invite delivery — the link is just rewritten to safe.
 *  2. If `APP_BASE_URL` is NOT set (local dev / test):
 *     a. caller-provided `magicLinkBaseUrl` is accepted as long as it is
 *        http(s); host validation is skipped because there is no canonical
 *        origin to compare against. The route still requires an
 *        authenticated tenant user, so this is acceptable in dev/test.
 *     b. otherwise we fall back to the request `host` header purely so
 *        local dev workflows don't break — this branch only runs when no
 *        canonical base is configured.
 *
 * Returns null when the input is non-http(s), malformed, or no base can be
 * resolved at all.
 */

export interface MagicLinkRequestLike {
  headers: { host?: string | undefined };
  protocol: string;
}

export function buildMagicLinkUrl(
  req: MagicLinkRequestLike,
  rawBase: unknown,
  token: string,
): string | null {
  const tokenSeg = `/external/${token}`;
  const canonicalRaw = process.env["APP_BASE_URL"]?.trim();
  let canonical: URL | null = null;
  if (canonicalRaw) {
    try {
      const u = new URL(canonicalRaw);
      if (u.protocol === "http:" || u.protocol === "https:") canonical = u;
    } catch {
      canonical = null;
    }
  }

  if (typeof rawBase === "string" && rawBase.trim()) {
    let parsed: URL;
    try {
      parsed = new URL(rawBase.trim());
    } catch {
      return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    if (canonical) {
      if (parsed.host.toLowerCase() === canonical.host.toLowerCase()) {
        return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}${tokenSeg}`;
      }
      // fallthrough to canonical
    } else {
      return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}${tokenSeg}`;
    }
  }

  if (canonical) {
    const path = canonical.pathname.replace(/\/$/, "");
    return `${canonical.origin}${path}${tokenSeg}`;
  }

  // Last resort: dev/test only. Header fallback runs when no APP_BASE_URL is
  // configured AND the caller didn't pass a usable magicLinkBaseUrl.
  const host = req.headers.host;
  if (!host) return null;
  const proto = req.protocol === "https" ? "https" : "http";
  return `${proto}://${host}${tokenSeg}`;
}

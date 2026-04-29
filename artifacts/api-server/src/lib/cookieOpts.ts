import type { CookieOptions } from "express";

/**
 * Cookie-Attribute für Auth-/Scope-Cookies.
 *
 * Damit die App in einem Cross-Origin-iframe (z. B. der Beta-Test-Plattform
 * unter https://betahub.returnz.one) funktioniert, müssen die Cookies in
 * Production mit `SameSite=None; Secure` ausgeliefert werden — sonst verwirft
 * der Browser sie im Third-Party-Kontext und der Login schlägt nach dem
 * Redirect "stillschweigend" fehl.
 *
 * In Development (HTTP, kein TLS) ist `SameSite=None; Secure` nicht zulässig,
 * dort fallen wir auf `Lax` (ohne Secure) zurück.
 */
const isProd = process.env.NODE_ENV === "production";

type Extras = {
  maxAge?: number;
  /** Cookies, die per JS lesbar sein müssen (z. B. UI-State), setzen httpOnly=false. */
  httpOnly?: boolean;
};

function baseOptions(extras: Extras): CookieOptions {
  return {
    httpOnly: extras.httpOnly ?? true,
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    path: "/",
    ...(extras.maxAge !== undefined ? { maxAge: extras.maxAge } : {}),
  };
}

/** Optionen für den HttpOnly-Session-Cookie (Auth). */
export function authCookieOptions(extras: { maxAge?: number } = {}): CookieOptions {
  return baseOptions({ ...extras, httpOnly: true });
}

/** Optionen für JS-lesbare State-Cookies (Active-Scope etc.). */
export function clientReadableCookieOptions(
  extras: { maxAge?: number } = {},
): CookieOptions {
  return baseOptions({ ...extras, httpOnly: false });
}

/**
 * Optionen für `res.clearCookie(...)`. Browser löschen nur dann, wenn
 * `path`, `sameSite` und `secure` zum ursprünglichen Set-Cookie passen.
 */
export function clearCookieOptions(): CookieOptions {
  return {
    sameSite: isProd ? "none" : "lax",
    secure: isProd,
    path: "/",
  };
}

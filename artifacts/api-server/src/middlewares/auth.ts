import type { Request, Response, NextFunction } from "express";
import { getUserBySession, SESSION_COOKIE } from "../lib/auth";
import { buildScope, type Scope } from "../lib/scope";

export interface AuthedRequest extends Request {
  scope?: Scope;
}

/** Whitelist of paths that bypass auth (already mounted under /api). */
const PUBLIC_PATHS = new Set<string>([
  "/auth/login",
  "/auth/logout",
  "/auth/me",
  "/health",
  "/healthz",
]);

export async function requireAuth(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // req.path inside /api router does not include the /api prefix.
  if (PUBLIC_PATHS.has(req.path)) {
    next();
    return;
  }
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
  const sid = cookies[SESSION_COOKIE];
  if (!sid) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const user = await getUserBySession(sid);
  if (!user) {
    res.status(401).json({ error: "session invalid or expired" });
    return;
  }
  req.scope = buildScope(user);
  next();
}

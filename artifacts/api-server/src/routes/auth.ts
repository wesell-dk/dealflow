import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  createSession,
  destroySession,
  getUserBySession,
  SESSION_COOKIE,
  verifyPassword,
} from "../lib/auth";
import { buildScope } from "../lib/scope";

const router: IRouter = Router();

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

function publicUser(u: typeof usersTable.$inferSelect) {
  const scope = buildScope(u);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    initials: u.initials,
    avatarColor: u.avatarColor,
    tenantId: u.tenantId,
    tenantWide: scope.tenantWide,
    companyIds: scope.companyIds,
    brandIds: scope.brandIds,
  };
}

router.post("/login", async (req, res) => {
  const b = req.body as { email?: string; password?: string };
  const email = (b?.email ?? "").trim().toLowerCase();
  const password = b?.password ?? "";
  if (!email || !password) {
    res.status(400).json({ error: "email und password erforderlich" });
    return;
  }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!u || !u.isActive || !verifyPassword(password, u.passwordHash)) {
    res.status(401).json({ error: "Login fehlgeschlagen" });
    return;
  }
  const sid = await createSession(u.id);
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SEVEN_DAYS,
    path: "/",
  });
  res.json({ user: publicUser(u) });
});

router.post("/logout", async (req, res) => {
  const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {};
  const sid = cookies[SESSION_COOKIE];
  if (sid) await destroySession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

router.get("/me", async (req, res) => {
  const cookies = (req as { cookies?: Record<string, string> }).cookies ?? {};
  const sid = cookies[SESSION_COOKIE];
  if (!sid) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }
  const u = await getUserBySession(sid);
  if (!u) {
    res.status(401).json({ error: "session invalid" });
    return;
  }
  res.json({ user: publicUser(u) });
});

export default router;

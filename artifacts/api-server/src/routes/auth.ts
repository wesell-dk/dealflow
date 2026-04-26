import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, brandsTable, companiesTable } from "@workspace/db";
import {
  createSession,
  destroySession,
  getUserBySession,
  SESSION_COOKIE,
  verifyPassword,
} from "../lib/auth";
import { buildScope, hasActiveScopeFilter } from "../lib/scope";

const router: IRouter = Router();

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/**
 * Vollständige Public-User-Repräsentation inkl. erlaubtem (Permission) und
 * aktivem (UI-Wahl) Scope. Wird für /auth/login, /auth/me genutzt.
 */
async function publicUser(u: typeof usersTable.$inferSelect) {
  const scope = buildScope(u);
  // Permitted set für Picker-Anzeige (raw, ohne aktiven Filter).
  // Tenant-weite User: alle Companies/Brands des Tenants. Restricted: explizite
  // Companies + Companies aller explizit erlaubten Brands.
  let permittedCompanyIds: string[];
  let permittedBrandIds: string[];
  if (scope.tenantWide) {
    const cs = await db.select({ id: companiesTable.id }).from(companiesTable)
      .where(eq(companiesTable.tenantId, scope.tenantId));
    permittedCompanyIds = cs.map(c => c.id);
    const bs = await db.select({ id: brandsTable.id })
      .from(brandsTable).innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
      .where(eq(companiesTable.tenantId, scope.tenantId));
    permittedBrandIds = bs.map(b => b.id);
  } else {
    // Restricted: explizite Companies + Companies aller explizit erlaubten
    // Brands. Anschließend tenant-gefiltert, damit keine Cross-Tenant-IDs aus
    // korrupten User-Records den Picker erreichen.
    const compSet = new Set<string>(scope.companyIds);
    const brandSet = new Set<string>(scope.brandIds);
    if (scope.brandIds.length) {
      const bs = await db.select().from(brandsTable).where(inArray(brandsTable.id, scope.brandIds));
      for (const b of bs) compSet.add(b.companyId);
    }
    if (scope.companyIds.length) {
      const bs = await db.select().from(brandsTable).where(inArray(brandsTable.companyId, scope.companyIds));
      for (const b of bs) brandSet.add(b.id);
    }
    // Tenant-Whitelist einmalig laden und Schnittmenge bilden.
    const tenantComps = await db.select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.tenantId, scope.tenantId));
    const tenantCompSet = new Set(tenantComps.map(c => c.id));
    const tenantBrands = await db.select({ id: brandsTable.id })
      .from(brandsTable)
      .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
      .where(eq(companiesTable.tenantId, scope.tenantId));
    const tenantBrandSet = new Set(tenantBrands.map(b => b.id));
    permittedCompanyIds = [...compSet].filter(id => tenantCompSet.has(id));
    permittedBrandIds = [...brandSet].filter(id => tenantBrandSet.has(id));
  }
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    initials: u.initials,
    avatarColor: u.avatarColor,
    tenantId: u.tenantId,
    tenantWide: scope.tenantWide,
    isPlatformAdmin: u.isPlatformAdmin,
    companyIds: scope.companyIds,
    brandIds: scope.brandIds,
    allowedScope: {
      tenantWide: scope.tenantWide,
      companyIds: permittedCompanyIds,
      brandIds: permittedBrandIds,
    },
    activeScope: {
      companyIds: scope.activeCompanyIds,
      brandIds: scope.activeBrandIds,
      filtered: hasActiveScopeFilter(scope),
    },
  };
}

router.post("/login", async (req, res) => {
  const b = req.body as { email?: string; password?: string };
  const email = (b?.email ?? "").trim().toLowerCase();
  const password = b?.password ?? "";
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!u || !u.isActive || !verifyPassword(password, u.passwordHash)) {
    res.status(401).json({ error: "Login failed" });
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
  res.json({ user: await publicUser(u) });
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
  res.json({ user: await publicUser(u) });
});

export default router;

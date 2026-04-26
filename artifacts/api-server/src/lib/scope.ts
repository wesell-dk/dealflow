import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import {
  db,
  dealsTable,
  accountsTable,
  companiesTable,
  brandsTable,
  quotesTable,
  contractsTable,
  contractAmendmentsTable,
  negotiationsTable,
  signaturePackagesTable,
  approvalsTable,
  orderConfirmationsTable,
  pricePositionsTable,
  priceIncreaseLettersTable,
  leadsTable,
  usersTable,
} from "@workspace/db";
import type { Request } from "express";

export interface Scope {
  user: typeof usersTable.$inferSelect;
  tenantId: string;
  tenantWide: boolean;
  /** User-Permissions (raw, ohne aktiven Filter). */
  companyIds: string[];
  /** User-Permissions (raw, ohne aktiven Filter). */
  brandIds: string[];
  /**
   * Aktiver Scope-Filter (UI-Wahl). NULL = "alle erlaubten" (kein zusätzlicher
   * Filter). Server intersected diesen IMMER mit den erlaubten Permissions —
   * Restricted User können nie über ihre Berechtigungen hinaus filtern.
   */
  activeCompanyIds: string[] | null;
  activeBrandIds: string[] | null;
}

function safeParseList(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function safeParseListOrNull(s: string | null | undefined): string[] | null {
  if (s === null || s === undefined) return null;
  try {
    const v = JSON.parse(s);
    if (!Array.isArray(v)) return null;
    return v.filter((x) => typeof x === "string");
  } catch {
    return null;
  }
}

export function buildScope(user: typeof usersTable.$inferSelect): Scope {
  return {
    user,
    tenantId: user.tenantId,
    tenantWide: user.tenantWide,
    companyIds: safeParseList(user.scopeCompanyIds),
    brandIds: safeParseList(user.scopeBrandIds),
    activeCompanyIds: safeParseListOrNull(user.activeScopeCompanyIds),
    activeBrandIds: safeParseListOrNull(user.activeScopeBrandIds),
  };
}

export function getScope(req: Request): Scope {
  const s = (req as Request & { scope?: Scope }).scope;
  if (!s) throw new Error("scope missing — auth middleware not applied");
  return s;
}

/**
 * True wenn der aktive Scope einen Filter setzt (mind. eine Liste != null).
 */
export function hasActiveScopeFilter(scope: Scope): boolean {
  return scope.activeCompanyIds !== null || scope.activeBrandIds !== null;
}

/**
 * SQL constraint that restricts deals to the user's tenant. The deals table
 * does not have a tenantId column, so we use a subquery against companies.
 * Always combine this with dealScopeSql to enforce both tenant + scope.
 */
export function dealsTenantSql(scope: Scope): SQL {
  return inArray(
    dealsTable.companyId,
    db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.tenantId, scope.tenantId)),
  );
}

/**
 * Combined where clause: tenant constraint AND (Permission ∩ Active).
 * Use this for any /deals query instead of dealScopeSql alone.
 */
export function dealsWhereSql(scope: Scope): SQL {
  const t = dealsTenantSql(scope);
  const s = dealScopeSql(scope);
  return s ? and(t, s)! : t;
}

/**
 * SQL where clause for tables that have companyId+brandId columns (deals).
 * Kombiniert Permission-Filter (sofern nicht tenantWide) mit aktivem
 * Scope-Filter (sofern gesetzt). Returns undefined → keine Einschränkung.
 *
 * Hinweis: Diese Funktion fügt KEINEN tenantId-Filter hinzu. Für /deals-Queries
 * bitte dealsWhereSql(scope) verwenden, das tenant + scope kombiniert.
 */
export function dealScopeSql(scope: Scope): SQL | undefined {
  const conditions: SQL[] = [];
  // 1) Permission-Filter (entfällt für tenantWide)
  if (!scope.tenantWide) {
    const parts: SQL[] = [];
    if (scope.companyIds.length > 0) {
      parts.push(inArray(dealsTable.companyId, scope.companyIds));
    }
    if (scope.brandIds.length > 0) {
      parts.push(inArray(dealsTable.brandId, scope.brandIds));
    }
    if (parts.length === 0) {
      // Empty permission scope → match nothing
      return eq(dealsTable.id, "__no_match__");
    }
    conditions.push(parts.length === 1 ? parts[0] : or(...parts)!);
  }
  // 2) Aktiver Scope-Filter
  if (hasActiveScopeFilter(scope)) {
    const aParts: SQL[] = [];
    if (scope.activeCompanyIds && scope.activeCompanyIds.length > 0) {
      aParts.push(inArray(dealsTable.companyId, scope.activeCompanyIds));
    }
    if (scope.activeBrandIds && scope.activeBrandIds.length > 0) {
      aParts.push(inArray(dealsTable.brandId, scope.activeBrandIds));
    }
    if (aParts.length === 0) {
      // Aktiver Scope explizit leer → keine Treffer
      return eq(dealsTable.id, "__no_match__");
    }
    conditions.push(aParts.length === 1 ? aParts[0] : or(...aParts)!);
  }
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : and(...conditions);
}

/**
 * Returns all dealIds visible to the scope. Cached on req.
 */
export async function allowedDealIds(req: Request): Promise<Set<string>> {
  const r = req as Request & { _allowedDealIds?: Set<string>; scope?: Scope };
  if (r._allowedDealIds) return r._allowedDealIds;
  const scope = getScope(req);
  // Tenant-bound for every user: always JOIN deals→companies on tenantId. This
  // is belt-and-suspenders — scope.companyIds/brandIds should never point
  // outside the user's tenant, but we enforce it in SQL regardless.
  if (
    !scope.tenantWide &&
    scope.companyIds.length === 0 &&
    scope.brandIds.length === 0
  ) {
    const set = new Set<string>();
    r._allowedDealIds = set;
    return set;
  }
  const conditions: SQL[] = [eq(companiesTable.tenantId, scope.tenantId)];
  const userScope = dealScopeSql(scope);
  if (userScope) conditions.push(userScope);
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  const rows = await db
    .select({ id: dealsTable.id })
    .from(dealsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, dealsTable.companyId))
    .where(where);
  const set = new Set(rows.map((r2) => r2.id));
  r._allowedDealIds = set;
  return set;
}

/**
 * Returns all accountIds visible to the scope — derived from visible deals.
 * tenantWide is still tenant-bound (via allowedDealIds which joins on
 * companies.tenantId). Cached on req.
 */
export async function allowedAccountIds(req: Request): Promise<Set<string>> {
  const r = req as Request & { _allowedAccountIds?: Set<string>; scope?: Scope };
  if (r._allowedAccountIds) return r._allowedAccountIds;
  const scope = getScope(req);
  const dealIds = await allowedDealIds(req);
  const accIds = new Set<string>();
  if (dealIds.size > 0) {
    const rows = await db
      .select({ accountId: dealsTable.accountId })
      .from(dealsTable)
      .where(inArray(dealsTable.id, [...dealIds]));
    for (const d of rows) accIds.add(d.accountId);
  }
  // Include accounts owned by users in the same tenant. Accounts have no
  // direct tenantId / companyId; this allows freshly-created accounts (no
  // deals yet) to remain visible to their tenant. For tenantWide users this
  // surfaces all tenant accounts; for restricted users it surfaces only
  // accounts they personally created (until a deal links them into scope).
  if (scope.tenantWide) {
    const owned = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .innerJoin(usersTable, eq(usersTable.id, accountsTable.ownerId))
      .where(eq(usersTable.tenantId, scope.tenantId));
    for (const a of owned) accIds.add(a.id);
  } else {
    const owned = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(eq(accountsTable.ownerId, scope.user.id));
    for (const a of owned) accIds.add(a.id);
  }
  r._allowedAccountIds = accIds;
  return accIds;
}

export function isAccountAllowed(accountIds: Set<string>, id: string): boolean {
  return accountIds.has(id);
}

/**
 * Permission-only company-IDs (ohne aktiven Scope-Filter). Wird genutzt für:
 *  - Validierung des PATCH /orgs/me/active-scope (Restricted User darf
 *    aktiven Scope nur als Teilmenge der erlaubten setzen)
 *  - UI-Tree im ScopeSwitcher (zeigt alle erlaubten Companies)
 */
export async function permittedCompanyIds(req: Request): Promise<string[]> {
  const scope = getScope(req);
  const tenantCompanies = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.tenantId, scope.tenantId));
  const tenantSet = new Set(tenantCompanies.map((c) => c.id));
  if (scope.tenantWide) return [...tenantSet];
  const result = new Set<string>(scope.companyIds.filter((c) => tenantSet.has(c)));
  if (scope.brandIds.length > 0) {
    const brands = await db
      .select({ companyId: brandsTable.companyId })
      .from(brandsTable)
      .where(inArray(brandsTable.id, scope.brandIds));
    for (const b of brands) if (tenantSet.has(b.companyId)) result.add(b.companyId);
  }
  return [...result];
}

/**
 * Permission-only brand-IDs (ohne aktiven Scope-Filter). Wird genutzt für:
 *  - Validierung des PATCH /orgs/me/active-scope
 *  - UI-Tree im ScopeSwitcher
 */
export async function permittedBrandIds(req: Request): Promise<string[]> {
  const scope = getScope(req);
  if (scope.tenantWide) {
    const rows = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
      .where(eq(companiesTable.tenantId, scope.tenantId));
    return rows.map((b) => b.id);
  }
  const companyBrands = scope.companyIds.length
    ? await db
        .select({ id: brandsTable.id })
        .from(brandsTable)
        .where(inArray(brandsTable.companyId, scope.companyIds))
    : [];
  const set = new Set<string>([...companyBrands.map((b) => b.id), ...scope.brandIds]);
  return [...set];
}

/**
 * Returns brandIds visible to the scope (Permission ∩ Active).
 */
export async function allowedBrandIds(req: Request): Promise<string[]> {
  const scope = getScope(req);
  const permitted = new Set(await permittedBrandIds(req));
  if (!hasActiveScopeFilter(scope)) return [...permitted];
  // Aktiver Filter: brand muss in activeBrandIds ODER in einer Brand
  // einer activeCompany sein.
  const activeBrandSet = new Set(scope.activeBrandIds ?? []);
  const activeCompanyBrands = scope.activeCompanyIds && scope.activeCompanyIds.length
    ? await db
        .select({ id: brandsTable.id })
        .from(brandsTable)
        .where(inArray(brandsTable.companyId, scope.activeCompanyIds))
    : [];
  const activeAllowed = new Set<string>([
    ...activeBrandSet,
    ...activeCompanyBrands.map((b) => b.id),
  ]);
  return [...permitted].filter((id) => activeAllowed.has(id));
}

/**
 * Returns all companyIds in the user's tenant that the user may access
 * (Permission ∩ Active).
 */
export async function allowedCompanyIds(req: Request): Promise<string[]> {
  const scope = getScope(req);
  const permitted = new Set(await permittedCompanyIds(req));
  if (!hasActiveScopeFilter(scope)) return [...permitted];
  // Aktiver Filter: company muss in activeCompanyIds ODER ihre Brand muss in
  // activeBrandIds sein.
  const activeCompanySet = new Set(scope.activeCompanyIds ?? []);
  const activeBrandCompanies = scope.activeBrandIds && scope.activeBrandIds.length
    ? await db
        .select({ companyId: brandsTable.companyId })
        .from(brandsTable)
        .where(inArray(brandsTable.id, scope.activeBrandIds))
    : [];
  const activeAllowed = new Set<string>([
    ...activeCompanySet,
    ...activeBrandCompanies.map((b) => b.companyId),
  ]);
  return [...permitted].filter((id) => activeAllowed.has(id));
}

/** Filters in-memory rows by allowed dealIds. */
export function filterByDealId<T extends { dealId: string | null | undefined }>(
  rows: T[],
  ids: Set<string>,
): T[] {
  return rows.filter((r) => (r.dealId ? ids.has(r.dealId) : false));
}

/**
 * Returns true if the user may access (read) the given entity.
 * For unrecognised types we deny by default (safe).
 */
export type ScopeStatus = "missing" | "forbidden" | "ok";

/**
 * Tri-state scope check that distinguishes truly-missing entities from
 * out-of-scope access. Callers should map:
 *   missing   -> 404
 *   forbidden -> 403
 *   ok        -> proceed
 */
export async function entityScopeStatus(
  req: Request,
  entityType: string,
  entityId: string,
): Promise<ScopeStatus> {
  const scope = getScope(req);
  // allowedDealIds/allowedAccountIds are now always tenant-bound (for tenantWide
  // users they JOIN deals→companies on tenantId). So these sets fully enforce
  // tenant-isolation on their own — no tenantWide shortcut needed.
  const dealIds = await allowedDealIds(req);
  const accIds = await allowedAccountIds(req);
  const accOk = (id: string) => accIds.has(id);
  const dealOk = (id: string) => dealIds.has(id);
  void scope;

  switch (entityType) {
    case "deal": {
      const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, entityId));
      if (!d) return "missing";
      return dealOk(d.id) ? "ok" : "forbidden";
    }
    case "account": {
      const [a] = await db.select().from(accountsTable).where(eq(accountsTable.id, entityId));
      if (!a) return "missing";
      return accOk(a.id) ? "ok" : "forbidden";
    }
    case "quote": {
      const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, entityId));
      if (!q) return "missing";
      return dealOk(q.dealId) ? "ok" : "forbidden";
    }
    case "contract": {
      const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, entityId));
      if (!c) return "missing";
      return dealOk(c.dealId) ? "ok" : "forbidden";
    }
    case "negotiation": {
      const [n] = await db.select().from(negotiationsTable).where(eq(negotiationsTable.id, entityId));
      if (!n) return "missing";
      return dealOk(n.dealId) ? "ok" : "forbidden";
    }
    case "signature":
    case "signature_package": {
      const [s] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, entityId));
      if (!s) return "missing";
      return dealOk(s.dealId) ? "ok" : "forbidden";
    }
    case "approval": {
      const [a] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, entityId));
      if (!a) return "missing";
      return dealOk(a.dealId) ? "ok" : "forbidden";
    }
    case "order":
    case "order_confirmation": {
      const [o] = await db.select().from(orderConfirmationsTable).where(eq(orderConfirmationsTable.id, entityId));
      if (!o) return "missing";
      return dealOk(o.dealId) ? "ok" : "forbidden";
    }
    case "price":
    case "price_position": {
      const [p] = await db.select().from(pricePositionsTable).where(eq(pricePositionsTable.id, entityId));
      if (!p) return "missing";
      // Tenant-bound: verify the position's company belongs to the user's tenant.
      const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, p.companyId));
      if (!co || co.tenantId !== scope.tenantId) return "forbidden";
      // Permission check
      const permittedC = new Set(await permittedCompanyIds(req));
      const permittedB = new Set(await permittedBrandIds(req));
      const permittedOk =
        scope.tenantWide ||
        (p.brandId && permittedB.has(p.brandId)) ||
        (p.companyId && permittedC.has(p.companyId));
      if (!permittedOk) return "forbidden";
      // Active scope check
      if (hasActiveScopeFilter(scope)) {
        const activeC = new Set(scope.activeCompanyIds ?? []);
        const activeB = new Set(scope.activeBrandIds ?? []);
        const activeOk =
          (p.brandId && activeB.has(p.brandId)) ||
          (p.companyId && activeC.has(p.companyId));
        if (!activeOk) return "forbidden";
      }
      return "ok";
    }
    case "contract_amendment":
    case "amendment": {
      const [a] = await db.select().from(contractAmendmentsTable).where(eq(contractAmendmentsTable.id, entityId));
      if (!a) return "missing";
      const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, a.originalContractId));
      if (!c) return "forbidden";
      return dealOk(c.dealId) ? "ok" : "forbidden";
    }
    case "letter":
    case "price_increase_letter": {
      const [l] = await db.select().from(priceIncreaseLettersTable).where(eq(priceIncreaseLettersTable.id, entityId));
      if (!l) return "missing";
      return accOk(l.accountId) ? "ok" : "forbidden";
    }
    case "lead": {
      // Leads sind tenant-scoped; restricted-User sehen nur eigene (ownerId).
      // tenantWide-User sehen alle Leads ihres Tenants — auch unzugewiesene.
      const [l] = await db.select().from(leadsTable).where(eq(leadsTable.id, entityId));
      if (!l) return "missing";
      if (l.tenantId !== scope.tenantId) return "forbidden";
      if (scope.tenantWide) return "ok";
      return l.ownerId === scope.user.id ? "ok" : "forbidden";
    }
    default:
      // Unknown entity types: deny everyone.
      return "forbidden";
  }
}

/** Convenience boolean wrapper around entityScopeStatus. */
export async function entityInScope(
  req: Request,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  return (await entityScopeStatus(req, entityType, entityId)) === "ok";
}

/**
 * Parse the `scope` field of a copilot thread (e.g. "deal:dl_001", "global",
 * "account:ac_001", "tenant") and decide whether the current user may see it
 * within their tenant.
 *
 * Tenant boundary is now enforced at the SQL layer in /copilot/threads via
 * the `tenantId` column on copilot_threads — this helper assumes the row
 * already belongs to the caller's tenant and only decides whether the row
 * is in their company/brand scope:
 *   "" or "global"        → visible to every user in the tenant
 *   "deal:<id>"           → only if the deal is in scope (entityInScope)
 *   "account:<id>"        → only if the account is in scope
 *   "tenant:<id>"         → never visible (intentional)
 *   "garbage-no-colon"    → never visible
 */
export async function copilotThreadVisible(req: Request, scopeField: string): Promise<boolean> {
  if (!scopeField || scopeField === "global") return true;
  const [kind, id] = scopeField.split(":");
  if (!kind || !id) return false;
  if (kind === "tenant") return false;
  return entityInScope(req, kind, id);
}

/**
 * Snapshot des aktiven Scopes für Audit-Log. Liefert null wenn keine
 * Einschränkung gesetzt ist (oder wirft wenn Scope unscoped tenantWide ist).
 */
export function activeScopeSnapshot(scope: Scope): {
  tenantWide: boolean;
  companyIds: string[] | null;
  brandIds: string[] | null;
} | null {
  if (!hasActiveScopeFilter(scope)) return null;
  return {
    tenantWide: scope.tenantWide,
    companyIds: scope.activeCompanyIds,
    brandIds: scope.activeBrandIds,
  };
}

// re-export for convenience
export { and, eq };

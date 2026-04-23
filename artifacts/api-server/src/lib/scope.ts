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
  type usersTable,
} from "@workspace/db";
import type { Request } from "express";

export interface Scope {
  user: typeof usersTable.$inferSelect;
  tenantId: string;
  tenantWide: boolean;
  companyIds: string[];
  brandIds: string[];
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

export function buildScope(user: typeof usersTable.$inferSelect): Scope {
  return {
    user,
    tenantId: user.tenantId,
    tenantWide: user.tenantWide,
    companyIds: safeParseList(user.scopeCompanyIds),
    brandIds: safeParseList(user.scopeBrandIds),
  };
}

export function getScope(req: Request): Scope {
  const s = (req as Request & { scope?: Scope }).scope;
  if (!s) throw new Error("scope missing — auth middleware not applied");
  return s;
}

/**
 * SQL where clause for tables that have companyId+brandId columns
 * (deals, pricePositions). Returns undefined if user is tenant-wide.
 */
export function dealScopeSql(scope: Scope): SQL | undefined {
  if (scope.tenantWide) return undefined;
  const parts: SQL[] = [];
  if (scope.companyIds.length > 0) {
    parts.push(inArray(dealsTable.companyId, scope.companyIds));
  }
  if (scope.brandIds.length > 0) {
    parts.push(inArray(dealsTable.brandId, scope.brandIds));
  }
  if (parts.length === 0) {
    // Empty scope → match nothing
    return eq(dealsTable.id, "__no_match__");
  }
  return parts.length === 1 ? parts[0] : or(...parts);
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
  if (!scope.tenantWide && scope.companyIds.length === 0 && scope.brandIds.length === 0) {
    const set = new Set<string>();
    r._allowedDealIds = set;
    return set;
  }
  const conditions: SQL[] = [eq(companiesTable.tenantId, scope.tenantId)];
  if (!scope.tenantWide) {
    const userScope = dealScopeSql(scope);
    if (userScope) conditions.push(userScope);
  }
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
  const dealIds = await allowedDealIds(req);
  const accIds = new Set<string>();
  if (dealIds.size > 0) {
    const rows = await db
      .select({ accountId: dealsTable.accountId })
      .from(dealsTable)
      .where(inArray(dealsTable.id, [...dealIds]));
    for (const d of rows) accIds.add(d.accountId);
  }
  r._allowedAccountIds = accIds;
  return accIds;
}

export function isAccountAllowed(accountIds: Set<string>, id: string): boolean {
  return accountIds.has(id);
}

/**
 * Returns brandIds visible to the scope. tenantWide → all brands of the
 * user's tenant (companies.tenantId = scope.tenantId). Otherwise brands of
 * scope.companyIds plus explicit scope.brandIds.
 */
export async function allowedBrandIds(req: Request): Promise<string[]> {
  const scope = getScope(req);
  if (scope.tenantWide) {
    const rows = await db
      .select({ id: brandsTable.id })
      .from(brandsTable)
      .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
      .where(eq(companiesTable.tenantId, scope.tenantId));
    return rows.map((b) => b.id);
  }
  // Brands of allowed companies + explicit brandIds
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
 * Returns all companyIds in the user's tenant that the user may access.
 * tenantWide → all tenant companies. Otherwise: scope.companyIds ∩ tenant
 * plus companies that own any scope.brandIds.
 */
export async function allowedCompanyIds(req: Request): Promise<string[]> {
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
      if (scope.tenantWide) return "ok";
      const brands = new Set(scope.brandIds);
      const companies = new Set(scope.companyIds);
      if (p.brandId && brands.has(p.brandId)) return "ok";
      if (p.companyId && companies.has(p.companyId)) return "ok";
      return "forbidden";
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
 * "account:ac_001", "tenant") and decide whether the current user may see it.
 */
export async function copilotThreadVisible(req: Request, scopeField: string): Promise<boolean> {
  const s = getScope(req);
  if (s.tenantWide) return true;
  if (!scopeField || scopeField === "global") return true;
  const [kind, id] = scopeField.split(":");
  if (!kind || !id) return false;
  if (kind === "tenant") return false;
  return entityInScope(req, kind, id);
}

// re-export for convenience
export { and, eq };

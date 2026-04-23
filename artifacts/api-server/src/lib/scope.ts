import { and, eq, inArray, or, type SQL } from "drizzle-orm";
import {
  db,
  dealsTable,
  brandsTable,
  quotesTable,
  contractsTable,
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
  if (scope.tenantWide) {
    const rows = await db.select({ id: dealsTable.id }).from(dealsTable);
    const set = new Set(rows.map((r2) => r2.id));
    r._allowedDealIds = set;
    return set;
  }
  if (scope.companyIds.length === 0 && scope.brandIds.length === 0) {
    const set = new Set<string>();
    r._allowedDealIds = set;
    return set;
  }
  const where = dealScopeSql(scope);
  const rows = await db.select({ id: dealsTable.id }).from(dealsTable).where(where);
  const set = new Set(rows.map((r2) => r2.id));
  r._allowedDealIds = set;
  return set;
}

/**
 * Returns all accountIds visible to the scope (accounts that have at least one
 * visible deal, plus accounts owned by the user). Cached on req.
 */
export async function allowedAccountIds(req: Request): Promise<Set<string>> {
  const r = req as Request & { _allowedAccountIds?: Set<string>; scope?: Scope };
  if (r._allowedAccountIds) return r._allowedAccountIds;
  const scope = getScope(req);
  if (scope.tenantWide) {
    // tenantWide → all accounts visible. Caller should not filter; return null-marker via large fallback.
    const set = new Set<string>(["__tenant_wide__"]);
    r._allowedAccountIds = set;
    return set;
  }
  const dealIds = await allowedDealIds(req);
  const rows = await db.select().from(dealsTable);
  const accIds = new Set<string>();
  for (const d of rows) if (dealIds.has(d.id)) accIds.add(d.accountId);
  r._allowedAccountIds = accIds;
  return accIds;
}

export function isAccountAllowed(accountIds: Set<string>, id: string): boolean {
  return accountIds.has("__tenant_wide__") || accountIds.has(id);
}

/**
 * Returns brandIds visible to the scope. Tenant-wide users see all brands.
 */
export async function allowedBrandIds(req: Request): Promise<string[]> {
  const scope = getScope(req);
  if (scope.tenantWide) {
    const rows = await db.select({ id: brandsTable.id }).from(brandsTable);
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
export async function entityInScope(
  req: Request,
  entityType: string,
  entityId: string,
): Promise<boolean> {
  const scope = getScope(req);
  if (scope.tenantWide) return true;

  const dealIds = await allowedDealIds(req);
  const accIds = await allowedAccountIds(req);

  switch (entityType) {
    case "deal":
      return dealIds.has(entityId);
    case "account":
      return isAccountAllowed(accIds, entityId);
    case "quote": {
      const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, entityId));
      return !!q && dealIds.has(q.dealId);
    }
    case "contract": {
      const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, entityId));
      return !!c && dealIds.has(c.dealId);
    }
    case "negotiation": {
      const [n] = await db.select().from(negotiationsTable).where(eq(negotiationsTable.id, entityId));
      return !!n && dealIds.has(n.dealId);
    }
    case "signature":
    case "signature_package": {
      const [s] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, entityId));
      return !!s && dealIds.has(s.dealId);
    }
    case "approval": {
      const [a] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, entityId));
      return !!a && dealIds.has(a.dealId);
    }
    case "order":
    case "order_confirmation": {
      const [o] = await db.select().from(orderConfirmationsTable).where(eq(orderConfirmationsTable.id, entityId));
      return !!o && dealIds.has(o.dealId);
    }
    case "price":
    case "price_position": {
      const [p] = await db.select().from(pricePositionsTable).where(eq(pricePositionsTable.id, entityId));
      if (!p) return false;
      const brands = new Set(scope.brandIds);
      const companies = new Set(scope.companyIds);
      if (p.brandId && brands.has(p.brandId)) return true;
      if (p.companyId && companies.has(p.companyId)) return true;
      return false;
    }
    case "letter":
    case "price_increase_letter": {
      const [l] = await db.select().from(priceIncreaseLettersTable).where(eq(priceIncreaseLettersTable.id, entityId));
      return !!l && isAccountAllowed(accIds, l.accountId);
    }
    default:
      // Unknown entity types are visible only to tenantWide users.
      return false;
  }
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

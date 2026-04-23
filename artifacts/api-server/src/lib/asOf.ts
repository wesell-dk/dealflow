import { and, asc, desc, eq, gt, lte } from "drizzle-orm";
import { db, entityVersionsTable } from "@workspace/db";

export interface AsOfResult<T> {
  data: T;
  validFrom: string | null;
  validTo: string | null;
  source: "live" | "version";
  version?: number;
}

/**
 * Parse `asOf` query param into a Date, or null if absent.
 * Accepts ISO 8601 (YYYY-MM-DD or full datetime).
 */
export function parseAsOf(raw: unknown): Date | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Return true iff the caller sent an `asOf` param but it failed to parse as
 * a valid date. Endpoints use this to reject malformed `asOf` with 422
 * instead of silently falling back to live data.
 */
export function isInvalidAsOf(raw: unknown): boolean {
  if (typeof raw !== "string" || raw.length === 0) return false;
  return Number.isNaN(new Date(raw).getTime());
}

/**
 * Resolve a historical snapshot from entity_versions for a given entity at
 * or before `at`. Returns null if no snapshot at/before that timestamp is
 * available.
 */
export async function resolveSnapshot<T = unknown>(
  entityType: string,
  entityId: string,
  at: Date,
): Promise<AsOfResult<T> | null> {
  const [row] = await db
    .select()
    .from(entityVersionsTable)
    .where(
      and(
        eq(entityVersionsTable.entityType, entityType),
        eq(entityVersionsTable.entityId, entityId),
        lte(entityVersionsTable.createdAt, at),
      ),
    )
    .orderBy(desc(entityVersionsTable.createdAt))
    .limit(1);
  if (!row) return null;
  // validTo = createdAt of the immediate successor version (if any).
  const [next] = await db
    .select()
    .from(entityVersionsTable)
    .where(
      and(
        eq(entityVersionsTable.entityType, entityType),
        eq(entityVersionsTable.entityId, entityId),
        gt(entityVersionsTable.createdAt, row.createdAt),
      ),
    )
    .orderBy(asc(entityVersionsTable.createdAt))
    .limit(1);
  let parsed: T;
  try {
    parsed = JSON.parse(row.snapshot) as T;
  } catch {
    return null;
  }
  return {
    data: parsed,
    validFrom: row.createdAt.toISOString(),
    validTo: next ? next.createdAt.toISOString() : null,
    source: "version",
    version: row.version,
  };
}

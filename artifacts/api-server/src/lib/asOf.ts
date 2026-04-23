import { and, desc, eq, lte } from "drizzle-orm";
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
  // Find the next version (valid-to) to establish the open/closed range.
  const [next] = await db
    .select()
    .from(entityVersionsTable)
    .where(
      and(
        eq(entityVersionsTable.entityType, entityType),
        eq(entityVersionsTable.entityId, entityId),
      ),
    )
    .orderBy(desc(entityVersionsTable.version))
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
    validTo: next && next.version !== row.version ? next.createdAt.toISOString() : null,
    source: "version",
    version: row.version,
  };
}

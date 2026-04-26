import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  checkRateLimit,
  _resetRateLimit,
  DEFAULT_RATE_LIMIT,
} from "../src/lib/widget";

/**
 * Task #270 — geteilter Rate-Limit-Store für das Brand-Lead-Widget.
 *
 * Vorher lebte der Counter in einer in-process Map; nach einem Restart oder
 * auf einer zweiten Replika konnte ein Angreifer das Limit pro Brand+IP
 * trivial umgehen.
 *
 * Diese Tests sichern ab, dass:
 *   1. Der Counter in der gemeinsamen Postgres-Tabelle landet.
 *   2. Ein simulierter "Restart" (re-import des Moduls) den Counter NICHT
 *      zurücksetzt.
 *   3. Verschiedene Brand+IP-Kombinationen unabhängig limitiert werden.
 *   4. Nach Ablauf des Fensters wieder zugelassen wird (Rollover-Reset)
 *      — auch nach einem Restart, mit persistierter alter Row.
 *   5. Mehrere "Replikas" (parallele Aufrufe gegen denselben Store) das
 *      globale 10/min-Budget gemeinsam einhalten — kein n*max-Bypass.
 */

const BRAND = "br_widget_rl_test";
const IP_A = "203.0.113.7";
const IP_B = "203.0.113.8";

async function clearForBrand(brandId: string): Promise<void> {
  await db.execute(sql`DELETE FROM widget_rate_limits WHERE "key" LIKE ${brandId + "|%"}`);
}

describe("widget rate-limit — shared Postgres store (Task #270)", () => {
  before(async () => {
    // Ensure the table exists even when running against a stale DB.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "widget_rate_limits" (
        "key" text PRIMARY KEY,
        "count" integer NOT NULL DEFAULT 1,
        "expires_at" timestamp with time zone NOT NULL
      )
    `);
  });

  beforeEach(async () => {
    await clearForBrand(BRAND);
  });

  after(async () => {
    await clearForBrand(BRAND);
  });

  it("allows up to the configured maximum and rejects further submits", async () => {
    for (let i = 1; i <= DEFAULT_RATE_LIMIT.max; i++) {
      const r = await checkRateLimit(BRAND, IP_A);
      assert.equal(r.allowed, true, `submit #${i} should be allowed`);
      assert.equal(r.remaining, DEFAULT_RATE_LIMIT.max - i);
    }
    const blocked = await checkRateLimit(BRAND, IP_A);
    assert.equal(blocked.allowed, false, "11th submit should be blocked");
    assert.ok(blocked.retryAfterSeconds > 0, "retry-after must be positive");
    assert.equal(blocked.remaining, 0);
  });

  it("persists state across a re-imported module (simulated restart)", async () => {
    // Burn the budget through the imported helper.
    for (let i = 0; i < DEFAULT_RATE_LIMIT.max; i++) {
      await checkRateLimit(BRAND, IP_A);
    }

    // Simulate a fresh process: re-import the module so any in-memory
    // bucket map would be empty. The shared Postgres counter must survive.
    const fresh = await import(`../src/lib/widget.ts?reload=${Date.now()}`);
    const result = await fresh.checkRateLimit(BRAND, IP_A);
    assert.equal(
      result.allowed,
      false,
      "after re-import the limit must still be enforced",
    );
    assert.ok(result.retryAfterSeconds > 0);
  });

  it("keeps brand+IP buckets independent", async () => {
    for (let i = 0; i < DEFAULT_RATE_LIMIT.max; i++) {
      await checkRateLimit(BRAND, IP_A);
    }
    const otherIp = await checkRateLimit(BRAND, IP_B);
    assert.equal(otherIp.allowed, true, "different IP must have own bucket");
    assert.equal(otherIp.remaining, DEFAULT_RATE_LIMIT.max - 1);
  });

  it("starts a new window once the previous one expires", async () => {
    const tinyWindow = { max: 3, windowMs: 250 };
    for (let i = 0; i < tinyWindow.max; i++) {
      const r = await checkRateLimit(BRAND, IP_A, tinyWindow);
      assert.equal(r.allowed, true);
    }
    const blocked = await checkRateLimit(BRAND, IP_A, tinyWindow);
    assert.equal(blocked.allowed, false);

    await new Promise((res) => setTimeout(res, 350));
    const after = await checkRateLimit(BRAND, IP_A, tinyWindow);
    assert.equal(after.allowed, true, "should be allowed after window expires");
    assert.equal(after.remaining, tinyWindow.max - 1);
  });

  it("resets count after window rollover even with a persisted maxed-out row", async () => {
    // Pre-populate an expired row that already hit the cap, simulating a
    // brand+IP that was fully throttled before a server restart and whose
    // window has since ticked over. The next call must NOT carry the old
    // count forward — the new window should start at 1.
    const tinyWindow = { max: 3, windowMs: 200 };
    const expiredAt = new Date(Date.now() - 1_000); // 1 s ago, already expired
    await db.execute(sql`
      INSERT INTO widget_rate_limits ("key", "count", "expires_at")
      VALUES (${BRAND + "|" + IP_A}, 999, ${expiredAt})
    `);

    const fresh = await checkRateLimit(BRAND, IP_A, tinyWindow);
    assert.equal(
      fresh.allowed,
      true,
      "expired window must reset, not carry the old maxed-out count forward",
    );
    assert.equal(fresh.remaining, tinyWindow.max - 1);

    const stored = await db.execute<{ count: number }>(
      sql`SELECT "count" FROM widget_rate_limits WHERE "key" = ${BRAND + "|" + IP_A}`,
    );
    assert.equal(
      Number(stored.rows[0]!.count),
      1,
      "persisted count must have been reset to 1",
    );
  });

  it("enforces a global cap across multiple concurrent replicas", async () => {
    // Simulate two replicas hammering the same brand+IP in parallel. The
    // shared store must cap the *total* allowed submits at max, not at
    // max per replica — that was the original bypass.
    const tinyWindow = { max: 5, windowMs: 1_000 };
    const total = tinyWindow.max * 4; // 20 attempts across "replicas"
    const calls = Array.from({ length: total }, () =>
      checkRateLimit(BRAND, IP_A, tinyWindow),
    );
    const results = await Promise.all(calls);
    const allowed = results.filter((r) => r.allowed).length;
    const blocked = results.filter((r) => !r.allowed).length;
    assert.equal(
      allowed,
      tinyWindow.max,
      `exactly ${tinyWindow.max} submits should pass globally; got ${allowed}`,
    );
    assert.equal(
      blocked,
      total - tinyWindow.max,
      `the rest must be 429-blocked; got ${blocked}`,
    );
    // And every blocked response must carry a positive retry-after.
    for (const r of results.filter((x) => !x.allowed)) {
      assert.ok(r.retryAfterSeconds > 0);
    }
  });

  it("_resetRateLimit clears the shared store", async () => {
    await checkRateLimit(BRAND, IP_A);
    await _resetRateLimit();
    const rows = await db.execute<{ key: string }>(
      sql`SELECT "key" FROM widget_rate_limits WHERE "key" LIKE ${BRAND + "|%"}`,
    );
    assert.equal(rows.rows.length, 0, "store should be empty after reset");
  });
});

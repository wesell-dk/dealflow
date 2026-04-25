import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  contractsTable,
  renewalOpportunitiesTable,
  usersTable,
  auditLogTable,
  obligationsTable,
} from "@workspace/db";
import {
  createTestWorld,
  destroyTestWorlds,
  sweepStaleTestData,
  type TestWorld,
} from "./helpers";
import {
  loginClient,
  startTestServer,
  type AuthedClient,
  type TestServer,
} from "./server";

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

async function makeRenewalReadyContract(
  world: TestWorld,
  opts: { effectiveTo: Date; noticeDays: number; healthScore?: number; openObligations?: number },
): Promise<void> {
  await db.update(contractsTable).set({
    status: "signed",
    autoRenewal: true,
    effectiveTo: fmtDate(opts.effectiveTo),
    renewalNoticeDays: opts.noticeDays,
    accountId: world.accountId,
    brandId: world.brandId,
    tenantId: world.tenantId,
    valueAmount: "120000",
    valueCurrency: "EUR",
  }).where(eq(contractsTable.id, world.contractId));

  if (opts.openObligations && opts.openObligations > 0) {
    for (let i = 0; i < opts.openObligations; i++) {
      await db.insert(obligationsTable).values({
        id: `${world.runId}_ob${i}`,
        tenantId: world.tenantId,
        contractId: world.contractId,
        type: "deliverable",
        description: `Open obligation ${i + 1}`,
        status: "pending",
        ownerRole: "Account Executive",
      });
    }
  }
}

describe("renewals — engine, scope, lifecycle", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let worldB: TestWorld;
  let alice: AuthedClient;       // worldA, regular AE
  let aliceAdmin: AuthedClient;  // worldA, after upgrading to Tenant Admin
  let bob: AuthedClient;         // worldB
  const seededObligationIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    worldA = await createTestWorld("rn_a");
    worldB = await createTestWorld("rn_b");
    alice = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    bob = await loginClient(server.baseUrl, worldB.userEmail, worldB.password);

    // Set up renewal-ready contracts in both worlds
    await makeRenewalReadyContract(worldA, {
      effectiveTo: addDays(120),
      noticeDays: 90,
      openObligations: 3,
    });
    await makeRenewalReadyContract(worldB, {
      effectiveTo: addDays(150),
      noticeDays: 90,
    });
    for (let i = 0; i < 3; i++) seededObligationIds.push(`${worldA.runId}_ob${i}`);
  });

  after(async () => {
    if (seededObligationIds.length > 0) {
      await db.delete(obligationsTable).where(inArray(obligationsTable.id, seededObligationIds));
    }
    if (worldA && worldB) {
      await db.delete(renewalOpportunitiesTable).where(inArray(
        renewalOpportunitiesTable.tenantId, [worldA.tenantId, worldB.tenantId],
      ));
      await destroyTestWorlds(worldA, worldB);
    }
    await server?.close();
  });

  it("POST /renewals/run — only Tenant Admins may trigger", async () => {
    const denied = await alice.post("/api/renewals/run");
    assert.equal(denied.status, 403, "Account Executive must be rejected");

    // Promote alice to Tenant Admin (also tenantWide so isTenantAdmin passes)
    await db.update(usersTable)
      .set({ role: "Tenant Admin", tenantWide: true })
      .where(eq(usersTable.id, worldA.userId));
    aliceAdmin = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    const ok = await aliceAdmin.post("/api/renewals/run");
    assert.equal(ok.status, 200, `expected 200, got ${ok.status}: ${JSON.stringify(ok.body)}`);
    const res = ok.body as { scanned: number; created: number };
    assert.ok(res.scanned >= 1, "must scan at least one candidate");
    assert.ok(res.created >= 1, "must create at least one opportunity");
  });

  it("materialization is idempotent — second run creates 0", async () => {
    const before = await db.select().from(renewalOpportunitiesTable)
      .where(eq(renewalOpportunitiesTable.tenantId, worldA.tenantId));
    const second = await aliceAdmin.post("/api/renewals/run");
    assert.equal(second.status, 200);
    const result = second.body as { created: number };
    assert.equal(result.created, 0, "second run must not create duplicates");
    const after = await db.select().from(renewalOpportunitiesTable)
      .where(eq(renewalOpportunitiesTable.tenantId, worldA.tenantId));
    assert.equal(after.length, before.length, "row count must remain stable");
  });

  it("risk score includes obligations factor with correct point contribution", async () => {
    const rows = await db.select().from(renewalOpportunitiesTable).where(and(
      eq(renewalOpportunitiesTable.tenantId, worldA.tenantId),
      eq(renewalOpportunitiesTable.contractId, worldA.contractId),
    ));
    assert.equal(rows.length, 1);
    const opp = rows[0]!;
    const factors = (opp.riskFactors as Array<{ key: string; points: number }>) ?? [];
    const obFactor = factors.find(f => f.key === "openObligations");
    assert.ok(obFactor, "openObligations factor must be present");
    // 3 open obligations × 5 points = 15
    assert.equal(obFactor!.points, 15);
    // 15 obligations + healthScore (test-account=80 → 10 pts) = 25 (no baseline)
    assert.ok(opp.riskScore >= 25, `expected score >= 25, got ${opp.riskScore}`);
    // No baseline factor anymore — score must come only from real factors
    assert.ok(!factors.find(f => f.key === "baseline"), "baseline factor must not exist");
  });

  it("brand scope: tenant A user cannot see tenant B's renewals", async () => {
    // Trigger run for tenant B too — promote bob and run
    await db.update(usersTable)
      .set({ role: "Tenant Admin", tenantWide: true })
      .where(eq(usersTable.id, worldB.userId));
    const bobAdmin = await loginClient(server.baseUrl, worldB.userEmail, worldB.password);
    await bobAdmin.post("/api/renewals/run");

    const aRes = await aliceAdmin.get("/api/renewals");
    assert.equal(aRes.status, 200);
    const aIds = ((aRes.body as Array<{ id: string; tenantId: string }>) ?? []).map(r => r.tenantId);
    assert.ok(aIds.every(t => t === worldA.tenantId), "must only see tenant A renewals");

    const bRes = await bobAdmin.get("/api/renewals");
    assert.equal(bRes.status, 200);
    const bIds = ((bRes.body as Array<{ id: string; tenantId: string }>) ?? []).map(r => r.tenantId);
    assert.ok(bIds.every(t => t === worldB.tenantId), "must only see tenant B renewals");
  });

  it("GET /renewals/_trend returns 12 month buckets, sums per dueDate month, splits at-risk", async () => {
    const trendRes = await aliceAdmin.get("/api/renewals/_trend?horizonMonths=12");
    assert.equal(trendRes.status, 200);
    const buckets = trendRes.body as Array<{
      ym: string;
      count: number;
      value: number;
      atRiskCount: number;
      atRiskValue: number;
    }>;
    assert.equal(buckets.length, 12, "must return one bucket per month for 12 months");

    // Buckets are contiguous, sorted, and start at the current month
    const now = new Date();
    const expectedFirst = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    assert.equal(buckets[0]!.ym, expectedFirst);

    // Tenant A's renewal opportunity has dueDate ≈ today + 120 days, valueAmount=120000.
    // It must appear in exactly one bucket within the 12-month horizon and the
    // sum across buckets must equal that opportunity's value.
    const opps = await db.select().from(renewalOpportunitiesTable)
      .where(eq(renewalOpportunitiesTable.tenantId, worldA.tenantId));
    const expectedTotal = opps.reduce(
      (s, o) => s + (o.valueAmount == null ? 0 : Number(o.valueAmount)),
      0,
    );
    const expectedCount = opps.length;
    const sumValue = buckets.reduce((s, b) => s + b.value, 0);
    const sumCount = buckets.reduce((s, b) => s + b.count, 0);
    assert.equal(sumCount, expectedCount, "count across buckets must match seeded opps");
    assert.equal(sumValue, expectedTotal, "value across buckets must match seeded opps");

    // atRiskValue must never exceed value in any bucket
    for (const b of buckets) {
      assert.ok(b.atRiskValue <= b.value, `atRiskValue must be <= value for ${b.ym}`);
      assert.ok(b.atRiskCount <= b.count, `atRiskCount must be <= count for ${b.ym}`);
    }
  });

  it("PATCH /renewals/:id snooze sets status + snoozedUntil and writes audit", async () => {
    const list = await aliceAdmin.get("/api/renewals");
    assert.equal(list.status, 200);
    const opp = ((list.body as Array<{ id: string }>) ?? [])[0];
    assert.ok(opp, "expected at least one renewal in tenant A");
    const snoozeUntil = fmtDate(addDays(14));
    const upd = await aliceAdmin.patch(`/api/renewals/${opp.id}`, {
      status: "snoozed",
      snoozedUntil: snoozeUntil,
      notes: "Customer wants to talk in 2 weeks.",
    });
    assert.equal(upd.status, 200, `expected 200, got ${upd.status}: ${JSON.stringify(upd.body)}`);
    const after = upd.body as { status: string; snoozedUntil: string | null; notes: string | null };
    assert.equal(after.status, "snoozed");
    assert.equal(after.snoozedUntil, snoozeUntil);

    const audit = await db.select().from(auditLogTable).where(and(
      eq(auditLogTable.entityType, "renewal_opportunity"),
      eq(auditLogTable.entityId, opp.id),
    ));
    assert.ok(audit.length >= 1, "expected audit row for renewal patch");
  });
});

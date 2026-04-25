import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  contractsTable,
  contractClausesTable,
  renewalOpportunitiesTable,
  usersTable,
  auditLogTable,
  obligationsTable,
  externalContractsTable,
  uploadedObjectsTable,
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
  const seededFollowupContractIds: string[] = [];

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
    if (seededFollowupContractIds.length > 0) {
      await db.delete(contractClausesTable).where(
        inArray(contractClausesTable.contractId, seededFollowupContractIds),
      );
      await db.delete(auditLogTable).where(and(
        eq(auditLogTable.entityType, "contract"),
        inArray(auditLogTable.entityId, seededFollowupContractIds),
      ));
      await db.delete(contractsTable).where(inArray(contractsTable.id, seededFollowupContractIds));
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

    // No groupBy → no per-brand/per-owner breakdowns.
    for (const b of buckets) {
      assert.equal((b as { byBrand?: unknown }).byBrand, undefined,
        `byBrand must not be present without groupBy for ${b.ym}`);
      assert.equal((b as { byOwner?: unknown }).byOwner, undefined,
        `byOwner must not be present without groupBy for ${b.ym}`);
    }
  });

  it("GET /renewals/_trend?groupBy=brand,owner aufsplitten — Summen identisch zur Gesamt-Aggregation", async () => {
    const trendRes = await aliceAdmin.get("/api/renewals/_trend?horizonMonths=12&groupBy=brand,owner");
    assert.equal(trendRes.status, 200);
    type Breakdown = {
      brandId?: string | null;
      ownerId?: string | null;
      name: string;
      value: number;
      count: number;
      atRiskCount: number;
      atRiskValue: number;
    };
    const buckets = trendRes.body as Array<{
      ym: string;
      count: number;
      value: number;
      atRiskCount: number;
      atRiskValue: number;
      byBrand: Breakdown[];
      byOwner: Breakdown[];
    }>;
    assert.equal(buckets.length, 12);
    let sawBrandSplit = false;
    let sawOwnerSplit = false;
    for (const b of buckets) {
      assert.ok(Array.isArray(b.byBrand), `byBrand muss ein Array sein für ${b.ym}`);
      assert.ok(Array.isArray(b.byOwner), `byOwner muss ein Array sein für ${b.ym}`);
      // Spaltensummen müssen exakt der Bucket-Summe entsprechen
      const brandSumValue = b.byBrand.reduce((s, x) => s + x.value, 0);
      const brandSumCount = b.byBrand.reduce((s, x) => s + x.count, 0);
      const ownerSumValue = b.byOwner.reduce((s, x) => s + x.value, 0);
      const ownerSumCount = b.byOwner.reduce((s, x) => s + x.count, 0);
      assert.equal(brandSumValue, b.value, `byBrand value-Summe muss Bucket value entsprechen (${b.ym})`);
      assert.equal(brandSumCount, b.count, `byBrand count-Summe muss Bucket count entsprechen (${b.ym})`);
      assert.equal(ownerSumValue, b.value, `byOwner value-Summe muss Bucket value entsprechen (${b.ym})`);
      assert.equal(ownerSumCount, b.count, `byOwner count-Summe muss Bucket count entsprechen (${b.ym})`);
      // value desc Sortierung
      for (let i = 1; i < b.byBrand.length; i++) {
        assert.ok(b.byBrand[i - 1]!.value >= b.byBrand[i]!.value,
          `byBrand muss nach value desc sortiert sein (${b.ym})`);
      }
      for (let i = 1; i < b.byOwner.length; i++) {
        assert.ok(b.byOwner[i - 1]!.value >= b.byOwner[i]!.value,
          `byOwner muss nach value desc sortiert sein (${b.ym})`);
      }
      if (b.byBrand.length > 0) sawBrandSplit = true;
      if (b.byOwner.length > 0) sawOwnerSplit = true;
    }
    assert.ok(sawBrandSplit, "Mindestens ein Bucket muss byBrand-Einträge liefern (Seed-Renewal mit Brand)");
    assert.ok(sawOwnerSplit, "Mindestens ein Bucket muss byOwner-Einträge liefern (Seed-Renewal mit Owner)");
  });

  it("GET /renewals/_trend?groupBy=brand respektiert Tenant-Isolation in der Aufschlüsselung", async () => {
    // Bob darf NICHT die Brands/Owner aus tenant A im byBrand/byOwner-Stream
    // sehen. Wir prüfen das, indem wir alle Breakdown-Einträge in Bobs
    // Antwort gegen die Brand-/User-IDs aus Tenant A abgleichen.
    const trendRes = await bob.get("/api/renewals/_trend?horizonMonths=12&groupBy=brand,owner");
    assert.equal(trendRes.status, 200);
    type Breakdown = { brandId?: string | null; ownerId?: string | null };
    const buckets = trendRes.body as Array<{ byBrand: Breakdown[]; byOwner: Breakdown[] }>;
    for (const b of buckets) {
      for (const x of b.byBrand) {
        assert.notEqual(x.brandId, worldA.brandId,
          "Tenant B darf Brand aus Tenant A nicht in byBrand sehen");
      }
      for (const x of b.byOwner) {
        assert.notEqual(x.ownerId, worldA.userId,
          "Tenant B darf Owner aus Tenant A nicht in byOwner sehen");
      }
    }
  });

  it("POST /renewals/:id/issue-followup creates successor + flips status to in_progress", async () => {
    // Seed two clauses + an accepted quote linkage on the predecessor so we
    // can verify both the clause snapshot and the quote-context inheritance.
    await db.insert(contractClausesTable).values([
      {
        id: `${worldA.runId}_pcl1`,
        contractId: worldA.contractId,
        family: "Liability",
        variant: "Standard",
        severity: "low",
        summary: "Standard liability cap.",
      },
      {
        id: `${worldA.runId}_pcl2`,
        contractId: worldA.contractId,
        family: "Termination",
        variant: "30-day notice",
        severity: "low",
        summary: "Either party may terminate with 30 days notice.",
      },
    ]);
    await db.update(contractsTable).set({
      acceptedQuoteVersionId: worldA.quoteId,
    }).where(eq(contractsTable.id, worldA.contractId));

    const list = await aliceAdmin.get("/api/renewals?status=open");
    assert.equal(list.status, 200);
    const opp = ((list.body as Array<{ id: string; contractId: string; status: string }>) ?? [])
      .find(r => r.contractId === worldA.contractId);
    assert.ok(opp, "expected an open renewal for worldA");
    assert.equal(opp!.status, "open");

    const res = await aliceAdmin.post(`/api/renewals/${opp!.id}/issue-followup`);
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as {
      renewal: { id: string; status: string; followupContractId: string | null; decidedAt: string | null };
      contract: { id: string; status: string; predecessorContractId: string | null; dealId: string };
    };
    assert.equal(body.renewal.status, "in_progress");
    assert.equal(body.renewal.followupContractId, body.contract.id);
    assert.equal(body.renewal.decidedAt, null, "in_progress must not set decidedAt");
    assert.equal(body.contract.status, "drafting");
    assert.equal(body.contract.predecessorContractId, worldA.contractId);
    assert.equal(body.contract.dealId, worldA.dealId);
    seededFollowupContractIds.push(body.contract.id);

    // Quote-context preserved at DB level (not part of the mapped Contract DTO,
    // but must be carried over so the AE keeps the same pricing baseline).
    const [newRow] = await db.select().from(contractsTable)
      .where(eq(contractsTable.id, body.contract.id));
    assert.equal(newRow!.acceptedQuoteVersionId, worldA.quoteId,
      "acceptedQuoteVersionId must be inherited from predecessor");

    // Clauses copied 1:1
    const newClauses = await db.select().from(contractClausesTable)
      .where(eq(contractClausesTable.contractId, body.contract.id));
    assert.equal(newClauses.length, 2, "must copy both predecessor clauses");
    const families = newClauses.map(c => c.family).sort();
    assert.deepEqual(families, ["Liability", "Termination"]);

    // Audit row written
    const audit = await db.select().from(auditLogTable).where(and(
      eq(auditLogTable.entityType, "renewal_opportunity"),
      eq(auditLogTable.entityId, opp!.id),
      eq(auditLogTable.action, "followup_issued"),
    ));
    assert.ok(audit.length >= 1, "expected followup_issued audit row");

    // GET /renewals/:id reflects the in_progress + followup link
    const reload = await aliceAdmin.get(`/api/renewals/${opp!.id}`);
    assert.equal(reload.status, 200);
    const reloaded = reload.body as { status: string; followupContractId: string | null };
    assert.equal(reloaded.status, "in_progress");
    assert.equal(reloaded.followupContractId, body.contract.id);
  });

  it("POST /renewals/:id/issue-followup — concurrent duplicate is blocked by unique index", async () => {
    // Reset to an open renewal with no successor so we can race two issues.
    if (seededFollowupContractIds.length > 0) {
      await db.delete(contractClausesTable).where(
        inArray(contractClausesTable.contractId, seededFollowupContractIds),
      );
      await db.delete(contractsTable).where(
        inArray(contractsTable.id, seededFollowupContractIds),
      );
      seededFollowupContractIds.length = 0;
    }
    await db.update(renewalOpportunitiesTable).set({
      status: "open",
      decidedAt: null,
      decidedBy: null,
    }).where(and(
      eq(renewalOpportunitiesTable.tenantId, worldA.tenantId),
      eq(renewalOpportunitiesTable.contractId, worldA.contractId),
    ));

    const list = await aliceAdmin.get("/api/renewals?status=open");
    const opp = ((list.body as Array<{ id: string; contractId: string }>) ?? [])
      .find(r => r.contractId === worldA.contractId);
    assert.ok(opp, "expected open renewal for race test");

    // Fire two issue calls in parallel — exactly one must win, the other must
    // 409 (either via the read-then-insert guard or the unique-constraint
    // catch). Either way, only ONE successor must exist in the DB.
    const [r1, r2] = await Promise.all([
      aliceAdmin.post(`/api/renewals/${opp!.id}/issue-followup`),
      aliceAdmin.post(`/api/renewals/${opp!.id}/issue-followup`),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [201, 409],
      `expected exactly one 201 + one 409, got ${JSON.stringify(statuses)}`);

    const successors = await db.select().from(contractsTable).where(and(
      eq(contractsTable.tenantId, worldA.tenantId),
      eq(contractsTable.predecessorContractId, worldA.contractId),
    ));
    assert.equal(successors.length, 1, "exactly one follow-up contract must exist");
    seededFollowupContractIds.push(successors[0]!.id);
  });

  it("POST /renewals/:id/issue-followup is idempotent — second call returns 409", async () => {
    const list = await aliceAdmin.get("/api/renewals?status=in_progress");
    assert.equal(list.status, 200);
    const opp = ((list.body as Array<{ id: string; contractId: string }>) ?? [])
      .find(r => r.contractId === worldA.contractId);
    assert.ok(opp, "expected the in_progress renewal from previous test");
    const res = await aliceAdmin.post(`/api/renewals/${opp!.id}/issue-followup`);
    assert.equal(res.status, 409, `expected 409 (status != open), got ${res.status}`);
  });

  it("POST /renewals/:id/issue-followup is tenant-scoped — bob cannot issue alice's followup", async () => {
    // Reset worldA renewal back to open + remove the stub successor so the test
    // doesn't conflict with the previous one. We delete the previously created
    // followup contract to clear the "already issued" guard.
    if (seededFollowupContractIds.length > 0) {
      await db.delete(contractClausesTable).where(
        inArray(contractClausesTable.contractId, seededFollowupContractIds),
      );
      await db.delete(contractsTable).where(
        inArray(contractsTable.id, seededFollowupContractIds),
      );
    }
    await db.update(renewalOpportunitiesTable).set({
      status: "open",
      decidedAt: null,
      decidedBy: null,
    }).where(and(
      eq(renewalOpportunitiesTable.tenantId, worldA.tenantId),
      eq(renewalOpportunitiesTable.contractId, worldA.contractId),
    ));

    // Find alice's renewal id, then attempt as bob → must 404 (scope hides it).
    const listAlice = await aliceAdmin.get("/api/renewals?status=open");
    const aliceOpp = ((listAlice.body as Array<{ id: string; contractId: string }>) ?? [])
      .find(r => r.contractId === worldA.contractId);
    assert.ok(aliceOpp, "expected an open renewal for worldA");

    const bobAdmin = await loginClient(server.baseUrl, worldB.userEmail, worldB.password);
    const denied = await bobAdmin.post(`/api/renewals/${aliceOpp!.id}/issue-followup`);
    assert.equal(denied.status, 404, `expected 404 (tenant-scope), got ${denied.status}`);

    // Cleanup: re-issue as alice so the seededFollowupContractIds list captures
    // the eventual contract for `after` cleanup. Then we re-record it.
    const ok = await aliceAdmin.post(`/api/renewals/${aliceOpp!.id}/issue-followup`);
    assert.equal(ok.status, 201);
    const okBody = ok.body as { contract: { id: string } };
    seededFollowupContractIds.length = 0;
    seededFollowupContractIds.push(okBody.contract.id);
  });

  it("external contracts with autoRenewal+effectiveTo are materialised by the engine", async () => {
    // Externer Bestandsvertrag im Notice-Korridor anlegen.
    const objectPath = `/objects/test-rn-ext-${worldA.runId}`;
    await db.insert(uploadedObjectsTable).values({
      objectPath,
      tenantId: worldA.tenantId,
      userId: worldA.userId,
      kind: "document",
      contentType: "application/pdf",
      size: 1024,
    }).onConflictDoNothing();
    const extId = `${worldA.runId}_xct`;
    await db.insert(externalContractsTable).values({
      id: extId,
      tenantId: worldA.tenantId,
      accountId: worldA.accountId,
      brandId: worldA.brandId,
      objectPath,
      fileName: "ext-renewal.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
      status: "confirmed",
      title: "Externer Renewal-Vertrag",
      parties: [{ role: "customer", name: "Acme GmbH" }],
      currency: "EUR",
      valueAmount: "75000",
      effectiveTo: fmtDate(addDays(120)),
      autoRenewal: true,
      renewalNoticeDays: 90,
      uploadedBy: worldA.userId,
    });

    try {
      const run = await aliceAdmin.post("/api/renewals/run");
      assert.equal(run.status, 200, `expected 200, got ${run.status}: ${JSON.stringify(run.body)}`);

      // Renewal-Opportunity für externen Vertrag muss existieren
      const rows = await db.select().from(renewalOpportunitiesTable).where(and(
        eq(renewalOpportunitiesTable.tenantId, worldA.tenantId),
        eq(renewalOpportunitiesTable.externalContractId, extId),
      ));
      assert.equal(rows.length, 1, "exactly one external renewal opportunity must be created");
      const opp = rows[0]!;
      assert.equal(opp.contractId, null, "contractId must be null for external renewals");
      assert.equal(opp.accountId, worldA.accountId);
      assert.equal(opp.brandId, worldA.brandId);
      assert.equal(opp.status, "open");

      // Liste liefert kind=external + externalContractTitle
      const list = await aliceAdmin.get("/api/renewals");
      assert.equal(list.status, 200);
      const externalRow = (list.body as Array<{
        id: string;
        kind: string;
        externalContractId: string | null;
        externalContractTitle: string | null;
        contractId: string | null;
      }>).find(r => r.id === opp.id);
      assert.ok(externalRow, "external renewal must appear in /renewals list");
      assert.equal(externalRow!.kind, "external");
      assert.equal(externalRow!.externalContractId, extId);
      assert.equal(externalRow!.externalContractTitle, "Externer Renewal-Vertrag");
      assert.equal(externalRow!.contractId, null);

      // Idempotenz: zweiter Run erzeugt keine Dublette
      const second = await aliceAdmin.post("/api/renewals/run");
      assert.equal(second.status, 200);
      const after = await db.select().from(renewalOpportunitiesTable).where(and(
        eq(renewalOpportunitiesTable.tenantId, worldA.tenantId),
        eq(renewalOpportunitiesTable.externalContractId, extId),
      ));
      assert.equal(after.length, 1, "second run must not duplicate external renewals");
    } finally {
      await db.delete(renewalOpportunitiesTable).where(eq(renewalOpportunitiesTable.externalContractId, extId));
      await db.delete(externalContractsTable).where(eq(externalContractsTable.id, extId));
      await db.delete(uploadedObjectsTable).where(eq(uploadedObjectsTable.objectPath, objectPath));
    }
  });

  it("PATCH /renewals/:id snooze sets status + snoozedUntil and writes audit", async () => {
    // Issue-followup test left the renewal as in_progress with a successor; reset
    // so the snooze test still sees a snoozable open renewal.
    await db.update(renewalOpportunitiesTable).set({
      status: "open",
      decidedAt: null,
      decidedBy: null,
    }).where(and(
      eq(renewalOpportunitiesTable.tenantId, worldA.tenantId),
      eq(renewalOpportunitiesTable.contractId, worldA.contractId),
    ));
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

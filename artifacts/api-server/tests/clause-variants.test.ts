import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  brandsTable,
  contractsTable,
  contractClausesTable,
  clauseVariantsTable,
  clauseFamiliesTable,
  brandClauseVariantOverridesTable,
  clauseVariantCompatibilityTable,
  usersTable,
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

const VARIANT_LIAB_STD = "cv_liab_3";
const VARIANT_LIAB_HARD = "cv_liab_5";
const VARIANT_TERM_STD = "cv_term_3";
const VARIANT_TERM_HARD = "cv_term_5";

describe("clause variants — brand overrides + compatibility", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let worldB: TestWorld;
  let alice: AuthedClient;
  let aliceAdmin: AuthedClient;
  let bob: AuthedClient;
  let bobAdmin: AuthedClient;
  const seededOverrideIds: string[] = [];
  const seededRuleIds: string[] = [];
  const seededContractIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    worldA = await createTestWorld("cv_a");
    worldB = await createTestWorld("cv_b");
    alice = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    bob = await loginClient(server.baseUrl, worldB.userEmail, worldB.password);

    // Promote both alice and bob to Tenant Admin tenant-wide for the
    // CRUD-heavy paths. Where we explicitly need an AE, we keep `alice`
    // (which still works because user state is per-session in the DB but the
    // session cookie is upgraded on next login).
    await db.update(usersTable)
      .set({ role: "Tenant Admin", tenantWide: true })
      .where(eq(usersTable.id, worldA.userId));
    aliceAdmin = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    await db.update(usersTable)
      .set({ role: "Tenant Admin", tenantWide: true })
      .where(eq(usersTable.id, worldB.userId));
    bobAdmin = await loginClient(server.baseUrl, worldB.userEmail, worldB.password);

    // Make sure the test brand has a default clause variants map so contract
    // creation actually materialises clauses.
    await db.update(brandsTable).set({
      defaultClauseVariants: {
        cf_liab: VARIANT_LIAB_STD,
        cf_term: VARIANT_TERM_STD,
      } as Record<string, string>,
    }).where(eq(brandsTable.id, worldA.brandId));
    await db.update(brandsTable).set({
      defaultClauseVariants: {
        cf_liab: VARIANT_LIAB_STD,
        cf_term: VARIANT_TERM_STD,
      } as Record<string, string>,
    }).where(eq(brandsTable.id, worldB.brandId));
  });

  after(async () => {
    if (seededRuleIds.length > 0) {
      await db.delete(clauseVariantCompatibilityTable)
        .where(inArray(clauseVariantCompatibilityTable.id, seededRuleIds));
    }
    if (seededOverrideIds.length > 0) {
      await db.delete(brandClauseVariantOverridesTable)
        .where(inArray(brandClauseVariantOverridesTable.id, seededOverrideIds));
    }
    if (seededContractIds.length > 0) {
      await db.delete(contractClausesTable)
        .where(inArray(contractClausesTable.contractId, seededContractIds));
      await db.delete(contractsTable)
        .where(inArray(contractsTable.id, seededContractIds));
    }
    await destroyTestWorlds(worldA, worldB);
    await server.close();
  });

  it("PUT /brands/:brandId/clause-overrides/:baseVariantId requires Tenant Admin", async () => {
    await db.update(usersTable)
      .set({ role: "Account Executive", tenantWide: false })
      .where(eq(usersTable.id, worldA.userId));
    try {
      const aeClient = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
      const denied = await aeClient.put(
        `/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_LIAB_STD}`,
        { summary: "AE attempt", body: "should fail" },
      );
      assert.equal(denied.status, 403);
    } finally {
      await db.update(usersTable)
        .set({ role: "Tenant Admin", tenantWide: true })
        .where(eq(usersTable.id, worldA.userId));
      aliceAdmin = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    }
  });

  it("PUT /brands/:brandId/clause-overrides/:baseVariantId upserts an override", async () => {
    const res = await aliceAdmin.put(
      `/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_LIAB_STD}`,
      {
        name: "Brand-spezifischer Liability-Cap",
        summary: "Cap auf 1.5x Jahresgebuehr (Brand-Override).",
        body: "Die Haftung ist auf das 1,5-fache der Jahresgebuehren begrenzt.",
        tone: "moderat",
        severity: "high",
        severityScore: 2,
      },
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = res.body as { id: string; brandId: string; baseVariantId: string; severityScore: number };
    assert.equal(row.brandId, worldA.brandId);
    assert.equal(row.baseVariantId, VARIANT_LIAB_STD);
    assert.equal(row.severityScore, 2);
    seededOverrideIds.push(row.id);

    // Re-PUT updates instead of creating a new row
    const res2 = await aliceAdmin.put(
      `/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_LIAB_STD}`,
      { summary: "Updated summary" },
    );
    assert.equal(res2.status, 200);
    const row2 = res2.body as { id: string };
    assert.equal(row2.id, row.id, "upsert must reuse the same id");
  });

  it("PUT /brands/:brandId/clause-overrides/:baseVariantId rejects invalid severityScore + severity", async () => {
    // Out of range — must NOT silently clamp
    const r1 = await aliceAdmin.put(
      `/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_LIAB_STD}`,
      { severityScore: 100 },
    );
    assert.equal(r1.status, 400, "severityScore=100 must be rejected, not clamped");

    const r2 = await aliceAdmin.put(
      `/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_LIAB_STD}`,
      { severityScore: 0 },
    );
    assert.equal(r2.status, 400);

    const r3 = await aliceAdmin.put(
      `/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_LIAB_STD}`,
      { severityScore: 2.5 },
    );
    assert.equal(r3.status, 400, "non-integer severityScore must be rejected");

    const r4 = await aliceAdmin.put(
      `/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_LIAB_STD}`,
      { severity: "extreme" },
    );
    assert.equal(r4.status, 400, "invalid severity enum must be rejected");

    // Verify clamping has not happened — current row still has severityScore=2 from prior test
    const list = await aliceAdmin.get(`/api/brands/${worldA.brandId}/clause-overrides`);
    const row = (list.body as Array<{ baseVariantId: string; severityScore: number | null }>)
      .find(o => o.baseVariantId === VARIANT_LIAB_STD);
    assert.ok(row, "override row must still exist");
    assert.equal(row!.severityScore, 2, "row severityScore must be unchanged after rejected requests");
  });

  it("GET /brands/:brandId/clause-overrides is brand-scoped — bob does not see alice's overrides", async () => {
    const aRes = await aliceAdmin.get(`/api/brands/${worldA.brandId}/clause-overrides`);
    assert.equal(aRes.status, 200);
    const aList = aRes.body as Array<{ id: string }>;
    assert.ok(aList.length >= 1, "alice must see her own override");

    // bob asking for alice's brand → 403 (brandVisible fails)
    const denied = await bobAdmin.get(`/api/brands/${worldA.brandId}/clause-overrides`);
    assert.equal(denied.status, 403);

    // bob asking for his own brand → empty list
    const bRes = await bobAdmin.get(`/api/brands/${worldB.brandId}/clause-overrides`);
    assert.equal(bRes.status, 200);
    const bList = bRes.body as Array<unknown>;
    assert.equal(bList.length, 0);
  });

  it("Contract materialisation snapshots brand-override text instead of base", async () => {
    const res = await aliceAdmin.post("/api/contracts", {
      dealId: worldA.dealId,
      title: "Override-test contract",
      template: "Master Services Agreement",
      brandId: worldA.brandId,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const ctr = res.body as { id: string };
    seededContractIds.push(ctr.id);

    const clauses = await db.select().from(contractClausesTable)
      .where(eq(contractClausesTable.contractId, ctr.id));
    const liab = clauses.find(c => c.familyId === "cf_liab");
    const term = clauses.find(c => c.familyId === "cf_term");
    assert.ok(liab, "liability clause must be materialised");
    assert.ok(term, "term clause must be materialised");

    // Liability used the override (name from test 2 + summary updated to "Updated summary")
    assert.equal(liab!.variant, "Brand-spezifischer Liability-Cap");
    assert.equal(liab!.summary, "Updated summary");
    assert.equal(liab!.severity, "high");

    // Term has NO override → falls back to base
    const baseTerm = await db.select().from(clauseVariantsTable)
      .where(eq(clauseVariantsTable.id, VARIANT_TERM_STD)).then(r => r[0]!);
    assert.equal(term!.variant, baseTerm.name, "term must fall back to base name");
    assert.equal(term!.summary, baseTerm.summary, "term must fall back to base summary");
  });

  it("PATCH /contract-clauses/:id also applies brand-override on variant switch", async () => {
    // Create a fresh contract (brandless override for hard variant)
    const res = await aliceAdmin.post("/api/contracts", {
      dealId: worldA.dealId,
      title: "Override-switch contract",
      template: "Master Services Agreement",
      brandId: worldA.brandId,
    });
    assert.equal(res.status, 201);
    const ctr = res.body as { id: string };
    seededContractIds.push(ctr.id);

    // Add an override for the HARD liab variant
    const ovRes = await aliceAdmin.put(
      `/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_LIAB_HARD}`,
      { summary: "Brand-OV summary fuer hart", name: "Brand HARD" },
    );
    assert.equal(ovRes.status, 200);
    seededOverrideIds.push((ovRes.body as { id: string }).id);

    const clauses = await db.select().from(contractClausesTable)
      .where(eq(contractClausesTable.contractId, ctr.id));
    const liab = clauses.find(c => c.familyId === "cf_liab")!;

    const patch = await aliceAdmin.patch(`/api/contract-clauses/${liab.id}`, {
      variantId: VARIANT_LIAB_HARD,
    });
    assert.equal(patch.status, 200, JSON.stringify(patch.body));

    const [after] = await db.select().from(contractClausesTable).where(eq(contractClausesTable.id, liab.id));
    assert.equal(after!.variant, "Brand HARD");
    assert.equal(after!.summary, "Brand-OV summary fuer hart");
  });

  it("DELETE /brands/:brandId/clause-overrides/:baseVariantId removes the row", async () => {
    // Add a throwaway override and delete it
    const create = await aliceAdmin.put(
      `/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_TERM_STD}`,
      { summary: "Throwaway" },
    );
    assert.equal(create.status, 200);
    const id = (create.body as { id: string }).id;

    const del = await aliceAdmin.delete(`/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_TERM_STD}`);
    assert.equal(del.status, 204);

    const [row] = await db.select().from(brandClauseVariantOverridesTable)
      .where(eq(brandClauseVariantOverridesTable.id, id));
    assert.equal(row, undefined, "row must be gone");

    // Second delete → 404
    const del2 = await aliceAdmin.delete(`/api/brands/${worldA.brandId}/clause-overrides/${VARIANT_TERM_STD}`);
    assert.equal(del2.status, 404);
  });

  it("POST /clause-compatibility validates fromVariantId/toVariantId/kind", async () => {
    const bad1 = await aliceAdmin.post("/api/clause-compatibility", {
      fromVariantId: "cv_does_not_exist", toVariantId: VARIANT_TERM_HARD, kind: "conflicts",
    });
    assert.equal(bad1.status, 400);

    const bad2 = await aliceAdmin.post("/api/clause-compatibility", {
      fromVariantId: VARIANT_LIAB_HARD, toVariantId: VARIANT_LIAB_HARD, kind: "conflicts",
    });
    assert.equal(bad2.status, 400, "must reject equal from/to");

    const bad3 = await aliceAdmin.post("/api/clause-compatibility", {
      fromVariantId: VARIANT_LIAB_HARD, toVariantId: VARIANT_TERM_HARD, kind: "lol",
    });
    assert.equal(bad3.status, 400, "must reject invalid kind");

    // Non-tenant-admin denied
    await db.update(usersTable)
      .set({ role: "Account Executive", tenantWide: false })
      .where(eq(usersTable.id, worldA.userId));
    const aeClient = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    const denied = await aeClient.post("/api/clause-compatibility", {
      fromVariantId: VARIANT_LIAB_HARD, toVariantId: VARIANT_TERM_HARD, kind: "conflicts",
    });
    assert.equal(denied.status, 403);
    await db.update(usersTable)
      .set({ role: "Tenant Admin", tenantWide: true })
      .where(eq(usersTable.id, worldA.userId));
    aliceAdmin = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
  });

  it("Compatibility validator surfaces conflicts and open requirements per clause", async () => {
    // Conflict: liab_hard ↔ term_hard. Requires: liab_std → term_std.
    const r1 = await aliceAdmin.post("/api/clause-compatibility", {
      fromVariantId: VARIANT_LIAB_HARD, toVariantId: VARIANT_TERM_HARD, kind: "conflicts",
      note: "Both sides cannot be hardline",
    });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    seededRuleIds.push((r1.body as { id: string }).id);

    const r2 = await aliceAdmin.post("/api/clause-compatibility", {
      fromVariantId: VARIANT_LIAB_STD, toVariantId: VARIANT_TERM_STD, kind: "requires",
    });
    assert.equal(r2.status, 201);
    seededRuleIds.push((r2.body as { id: string }).id);

    // GET listing returns both
    const list = await aliceAdmin.get("/api/clause-compatibility");
    assert.equal(list.status, 200);
    const rows = list.body as Array<{ id: string }>;
    assert.ok(rows.length >= 2);

    // --- Build a contract where both are HARD → conflict ---
    const ctrRes = await aliceAdmin.post("/api/contracts", {
      dealId: worldA.dealId,
      title: "Compat-conflict contract",
      template: "Master Services Agreement",
      brandId: worldA.brandId,
    });
    assert.equal(ctrRes.status, 201);
    const ctr = ctrRes.body as { id: string };
    seededContractIds.push(ctr.id);

    const cls = await db.select().from(contractClausesTable)
      .where(eq(contractClausesTable.contractId, ctr.id));
    const liab = cls.find(c => c.familyId === "cf_liab")!;
    const term = cls.find(c => c.familyId === "cf_term")!;
    await aliceAdmin.patch(`/api/contract-clauses/${liab.id}`, { variantId: VARIANT_LIAB_HARD });
    await aliceAdmin.patch(`/api/contract-clauses/${term.id}`, { variantId: VARIANT_TERM_HARD });

    const compatRes = await aliceAdmin.get(`/api/contracts/${ctr.id}/clauses/_compatibility`);
    assert.equal(compatRes.status, 200);
    const report = compatRes.body as {
      contractId: string;
      items: Array<{
        familyId: string | null;
        status: string;
        conflicts: Array<{ withVariantId: string; withVariantName: string }>;
        requiresOpen: Array<{ requiredVariantId: string }>;
      }>;
    };
    const liabReport = report.items.find(i => i.familyId === "cf_liab")!;
    assert.equal(liabReport.status, "conflict");
    assert.equal(liabReport.conflicts.length, 1);
    assert.equal(liabReport.conflicts[0]!.withVariantId, VARIANT_TERM_HARD);

    // --- Switch back to STD on both → requirement satisfied → ok ---
    await aliceAdmin.patch(`/api/contract-clauses/${liab.id}`, { variantId: VARIANT_LIAB_STD });
    await aliceAdmin.patch(`/api/contract-clauses/${term.id}`, { variantId: VARIANT_TERM_STD });
    const okRes = await aliceAdmin.get(`/api/contracts/${ctr.id}/clauses/_compatibility`);
    const okReport = okRes.body as {
      items: Array<{ familyId: string | null; status: string; requiresOk: Array<unknown> }>;
    };
    const liabOk = okReport.items.find(i => i.familyId === "cf_liab")!;
    assert.equal(liabOk.status, "ok");
    assert.ok(liabOk.requiresOk.length >= 1, "satisfied requirement must be listed");

    // --- Only liab=STD; term=HARD → liab requires term=STD which is missing → warning ---
    await aliceAdmin.patch(`/api/contract-clauses/${term.id}`, { variantId: VARIANT_TERM_HARD });
    const warnRes = await aliceAdmin.get(`/api/contracts/${ctr.id}/clauses/_compatibility`);
    const warnReport = warnRes.body as {
      items: Array<{ familyId: string | null; status: string; requiresOpen: Array<{ requiredVariantId: string; requiredFamilyName: string }> }>;
    };
    const liabWarn = warnReport.items.find(i => i.familyId === "cf_liab")!;
    assert.equal(liabWarn.status, "warning");
    assert.equal(liabWarn.requiresOpen.length, 1);
    assert.equal(liabWarn.requiresOpen[0]!.requiredVariantId, VARIANT_TERM_STD);
  });

  it("Compatibility rules are tenant-scoped — bob cannot see/delete tenant A's rules", async () => {
    const bobList = await bobAdmin.get("/api/clause-compatibility");
    assert.equal(bobList.status, 200);
    const bobRows = bobList.body as Array<{ id: string }>;
    for (const r of seededRuleIds) {
      assert.ok(!bobRows.some(x => x.id === r), `tenant B must not see rule ${r}`);
    }
    // bob trying to delete tenant A's rule → 404 (tenant filter)
    if (seededRuleIds[0]) {
      const denied = await bobAdmin.delete(`/api/clause-compatibility/${seededRuleIds[0]}`);
      assert.equal(denied.status, 404);
    }
  });

  it("DELETE /clause-compatibility/:id removes the rule", async () => {
    if (!seededRuleIds[0]) return;
    const id = seededRuleIds[0];
    const del = await aliceAdmin.delete(`/api/clause-compatibility/${id}`);
    assert.equal(del.status, 204);
    const [row] = await db.select().from(clauseVariantCompatibilityTable)
      .where(eq(clauseVariantCompatibilityTable.id, id));
    assert.equal(row, undefined);
    seededRuleIds.shift();
  });
});

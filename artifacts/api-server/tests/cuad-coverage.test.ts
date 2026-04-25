import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, and } from "drizzle-orm";
import {
  db,
  brandsTable,
  contractsTable,
  contractClausesTable,
  usersTable,
  contractTypesTable,
  contractTypeCuadExpectationsTable,
  clauseFamilyCuadCategoriesTable,
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

interface CuadCoverage {
  contractId: string;
  contractTypeId: string | null;
  contractTypeName: string | null;
  totalExpected: number;
  totalRecommended: number;
  coveredExpected: number;
  coveredRecommended: number;
  covered: Array<{
    cuadCategoryId: string;
    code: string;
    name: string;
    requirement: "expected" | "recommended";
    coveredByFamilyIds: string[];
  }>;
  missing: Array<{
    cuadCategoryId: string;
    code: string;
    name: string;
    requirement: "expected" | "recommended";
    suggestedFamilyIds: string[];
  }>;
  missingExpectedCount: number;
  missingRecommendedCount: number;
}

describe("CUAD coverage — deterministic gap-check", () => {
  let server: TestServer;
  let world: TestWorld;
  let alice: AuthedClient;
  const seededContractIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    world = await createTestWorld("cuad");

    // Promote alice to Tenant Admin so she can hit admin PUT endpoints.
    await db.update(usersTable)
      .set({ role: "Tenant Admin", tenantWide: true })
      .where(eq(usersTable.id, world.userId));
    alice = await loginClient(server.baseUrl, world.userEmail, world.password);

    // Brand defaults: cf_liab + cf_term + cf_ip so contracts get those clauses
    // materialised on creation. cf_pay intentionally omitted so we can verify
    // it shows up as missing/uncovered in the MSA recommended scenario.
    await db.update(brandsTable).set({
      defaultClauseVariants: {
        cf_liab: "cv_liab_3",
        cf_term: "cv_term_3",
        cf_ip: "cv_ip_3",
      } as Record<string, string>,
    }).where(eq(brandsTable.id, world.brandId));
  });

  after(async () => {
    if (seededContractIds.length > 0) {
      await db.delete(contractClausesTable)
        .where(inArray(contractClausesTable.contractId, seededContractIds));
      await db.delete(contractsTable)
        .where(inArray(contractsTable.id, seededContractIds));
    }
    // Tenant-override mappings created during tests
    await db.delete(clauseFamilyCuadCategoriesTable)
      .where(eq(clauseFamilyCuadCategoriesTable.tenantId, world.tenantId));
    await destroyTestWorlds(world);
    await server.close();
  });

  it("GET /cuad/categories returns the seeded CUAD taxonomy (>=41 entries)", async () => {
    const res = await alice.get("/api/cuad/categories");
    assert.equal(res.status, 200);
    const cats = res.body as Array<{ id: string; code: string; name: string }>;
    assert.ok(Array.isArray(cats));
    assert.ok(cats.length >= 41, `expected >=41 CUAD categories, got ${cats.length}`);
    const codes = new Set(cats.map(c => c.code));
    for (const required of ["PARTIES", "CAP_ON_LIABILITY", "GOVERNING_LAW", "AUDIT_RIGHTS", "EXPIRATION_DATE"]) {
      assert.ok(codes.has(required), `missing CUAD code ${required}`);
    }
  });

  it("NDA scenario: expects parties/effective_date/expiration_date/governing_law; cf_term covers expiration_date", async () => {
    // Build an NDA contract: create with default brand defaults, then bind to ct_nda.
    const created = await alice.post("/api/contracts", {
      dealId: world.dealId,
      title: "NDA — coverage test",
      template: "Mutual NDA",
      brandId: world.brandId,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const ctrId = (created.body as { id: string }).id;
    seededContractIds.push(ctrId);
    await db.update(contractsTable)
      .set({ contractTypeId: "ct_nda" })
      .where(eq(contractsTable.id, ctrId));

    const res = await alice.get(`/api/contracts/${ctrId}/cuad-coverage`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const cov = res.body as CuadCoverage;

    assert.equal(cov.contractTypeId, "ct_nda");
    // 4 expected (parties, effective_date, expiration_date, governing_law) +
    // 2 recommended (audit_rights, anti_assignment) per seeded NDA defaults.
    assert.equal(cov.totalExpected, 4, "NDA must have 4 expected categories");
    assert.equal(cov.totalRecommended, 2, "NDA must have 2 recommended categories");

    const coveredCodes = new Set(cov.covered.map(c => c.code));
    const missingCodes = new Set(cov.missing.map(m => m.code));

    // cf_term is materialised → expiration_date must be covered.
    assert.ok(coveredCodes.has("EXPIRATION_DATE"), "EXPIRATION_DATE must be covered via cf_term");
    const expEntry = cov.covered.find(c => c.code === "EXPIRATION_DATE")!;
    assert.deepEqual(expEntry.coveredByFamilyIds, ["cf_term"]);
    assert.equal(expEntry.requirement, "expected");

    // The other expected categories have no clause family backing them in the
    // default seed → must show up as missing.
    for (const code of ["PARTIES", "EFFECTIVE_DATE", "GOVERNING_LAW"]) {
      assert.ok(missingCodes.has(code), `${code} should be missing for NDA`);
    }
    assert.equal(cov.missingExpectedCount, 3);
    assert.equal(cov.coveredExpected, 1);

    // Missing list is sorted: expected first, then recommended.
    const firstReq = cov.missing[0]?.requirement;
    assert.equal(firstReq, "expected", "missing[] must list 'expected' before 'recommended'");
  });

  it("MSA scenario: cf_liab/cf_term/cf_ip clauses cover their CUAD categories; warranty/audit/parties missing", async () => {
    const created = await alice.post("/api/contracts", {
      dealId: world.dealId,
      title: "MSA — coverage test",
      template: "Master Services Agreement",
      brandId: world.brandId,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const ctrId = (created.body as { id: string }).id;
    seededContractIds.push(ctrId);
    await db.update(contractsTable)
      .set({ contractTypeId: "ct_msa" })
      .where(eq(contractsTable.id, ctrId));

    const res = await alice.get(`/api/contracts/${ctrId}/cuad-coverage`);
    assert.equal(res.status, 200);
    const cov = res.body as CuadCoverage;
    assert.equal(cov.contractTypeId, "ct_msa");
    // Seeded MSA expectations: 13 expected + 3 recommended.
    assert.equal(cov.totalExpected, 13);
    assert.equal(cov.totalRecommended, 3);

    const coveredCodes = new Set(cov.covered.map(c => c.code));
    const missingCodes = new Set(cov.missing.map(m => m.code));

    // cf_liab covers CAP_ON_LIABILITY; cf_term covers expiration/renewal/notice/term-conv;
    // cf_ip covers ip_ownership_assignment + license_grant.
    for (const code of [
      "CAP_ON_LIABILITY",
      "EXPIRATION_DATE",
      "RENEWAL_TERM",
      "NOTICE_PERIOD_TO_TERMINATE_RENEWAL",
      "TERMINATION_FOR_CONVENIENCE",
      "IP_OWNERSHIP_ASSIGNMENT",
      "LICENSE_GRANT",
    ]) {
      assert.ok(coveredCodes.has(code), `MSA: ${code} must be covered`);
    }
    assert.equal(cov.coveredExpected, 7, "7 expected CUAD categories must be covered for MSA");

    // No cf_data, cf_sla → these MSA expectations remain missing.
    for (const code of ["PARTIES", "EFFECTIVE_DATE", "GOVERNING_LAW", "WARRANTY_DURATION", "AUDIT_RIGHTS", "ANTI_ASSIGNMENT"]) {
      assert.ok(missingCodes.has(code), `MSA: ${code} must be missing`);
    }
    assert.equal(cov.missingExpectedCount, 6);

    // Suggested-family hints must point at the families that map to the cuad id.
    const warranty = cov.missing.find(m => m.code === "WARRANTY_DURATION")!;
    assert.deepEqual(warranty.suggestedFamilyIds, ["cf_sla"]);
    const audit = cov.missing.find(m => m.code === "AUDIT_RIGHTS")!;
    assert.deepEqual(audit.suggestedFamilyIds, ["cf_data"]);
  });

  it("PUT /clause-families/:id/cuad-categories applies a tenant override to coverage", async () => {
    // Map cf_pay → governing_law for this tenant only (synthetic mapping just to
    // prove the override path is honoured by computeCuadCoverage).
    const put = await alice.put(`/api/clause-families/cf_pay/cuad-categories`, {
      cuadCategoryIds: ["cuad_governing_law"],
    });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const putBody = put.body as { isTenantOverride: boolean; cuadCategoryIds: string[] };
    assert.equal(putBody.isTenantOverride, true);
    assert.deepEqual(putBody.cuadCategoryIds, ["cuad_governing_law"]);

    // Build an MSA contract that includes cf_pay in the materialised clauses.
    await db.update(brandsTable).set({
      defaultClauseVariants: {
        cf_liab: "cv_liab_3",
        cf_term: "cv_term_3",
        cf_ip: "cv_ip_3",
        cf_pay: "cv_pay_3",
      } as Record<string, string>,
    }).where(eq(brandsTable.id, world.brandId));
    const created = await alice.post("/api/contracts", {
      dealId: world.dealId,
      title: "MSA — tenant override coverage",
      template: "Master Services Agreement",
      brandId: world.brandId,
    });
    assert.equal(created.status, 201);
    const ctrId = (created.body as { id: string }).id;
    seededContractIds.push(ctrId);
    // Tenant-scoped overrides only kick in when the contract carries the
    // tenant binding — set it here so loadFamilyCuadIndex picks the override.
    await db.update(contractsTable)
      .set({ contractTypeId: "ct_msa", tenantId: world.tenantId })
      .where(eq(contractsTable.id, ctrId));

    const cov = (await alice.get(`/api/contracts/${ctrId}/cuad-coverage`)).body as CuadCoverage;
    const gov = cov.covered.find(c => c.code === "GOVERNING_LAW");
    assert.ok(gov, "GOVERNING_LAW must be covered via the cf_pay tenant override");
    assert.deepEqual(gov!.coveredByFamilyIds, ["cf_pay"]);

    // GET reflects the override too.
    const getMap = await alice.get(`/api/clause-families/cf_pay/cuad-categories`);
    const m = getMap.body as { isTenantOverride: boolean; cuadCategoryIds: string[] };
    assert.equal(m.isTenantOverride, true);
    assert.deepEqual(m.cuadCategoryIds, ["cuad_governing_law"]);
  });

  it("Tenant override REPLACES system mapping for that family (removes default CUAD ids from coverage)", async () => {
    // Default cf_term system mapping covers EXPIRATION_DATE / RENEWAL_TERM /
    // NOTICE_PERIOD_TO_TERMINATE_RENEWAL / TERMINATION_FOR_CONVENIENCE.
    // Override cf_term with a single unrelated CUAD id — the four defaults
    // must NOT show up as covered/suggested anymore for this tenant.
    const put = await alice.put(`/api/clause-families/cf_term/cuad-categories`, {
      cuadCategoryIds: ["cuad_anti_assignment"],
    });
    assert.equal(put.status, 200);

    // Build an MSA contract that includes cf_term and bind it to the tenant.
    await db.update(brandsTable).set({
      defaultClauseVariants: {
        cf_liab: "cv_liab_3",
        cf_term: "cv_term_3",
        cf_ip: "cv_ip_3",
      } as Record<string, string>,
    }).where(eq(brandsTable.id, world.brandId));

    const created = await alice.post("/api/contracts", {
      dealId: world.dealId,
      title: "MSA — override-replaces-default",
      template: "Master Services Agreement",
      brandId: world.brandId,
    });
    assert.equal(created.status, 201);
    const ctrId = (created.body as { id: string }).id;
    seededContractIds.push(ctrId);
    await db.update(contractsTable)
      .set({ contractTypeId: "ct_msa", tenantId: world.tenantId })
      .where(eq(contractsTable.id, ctrId));

    const cov = (await alice.get(`/api/contracts/${ctrId}/cuad-coverage`)).body as CuadCoverage;

    const coveredCodes = new Set(cov.covered.map(c => c.code));
    const missingCodes = new Set(cov.missing.map(m => m.code));

    // Defaults that USED to be covered via cf_term must now appear as missing
    // (with empty suggested-family hints since no other family covers them).
    for (const code of ["EXPIRATION_DATE", "RENEWAL_TERM", "NOTICE_PERIOD_TO_TERMINATE_RENEWAL", "TERMINATION_FOR_CONVENIENCE"]) {
      assert.ok(!coveredCodes.has(code), `${code} must NOT be covered after cf_term override drops it`);
      assert.ok(missingCodes.has(code), `${code} must now be reported as missing`);
      const m = cov.missing.find(x => x.code === code)!;
      assert.deepEqual(m.suggestedFamilyIds, [], `cf_term must no longer be suggested for ${code}`);
    }

    // Other families with system-only mapping are unaffected.
    assert.ok(coveredCodes.has("CAP_ON_LIABILITY"), "cf_liab default mapping must still apply");
    assert.ok(coveredCodes.has("IP_OWNERSHIP_ASSIGNMENT"), "cf_ip default mapping must still apply");

    // Reset the override so the rest of the suite uses defaults again.
    await db.delete(clauseFamilyCuadCategoriesTable)
      .where(and(
        eq(clauseFamilyCuadCategoriesTable.tenantId, world.tenantId),
        eq(clauseFamilyCuadCategoriesTable.familyId, "cf_term"),
      ));
  });

  it("PUT /contract-types/:id/cuad-expectations only allowed on tenant-owned contract types", async () => {
    // Seeded contract types belong to tn_root → must 404 for our test tenant.
    const denied = await alice.put(`/api/contract-types/ct_msa/cuad-expectations`, {
      items: [{ cuadCategoryId: "cuad_parties", requirement: "expected" }],
    });
    assert.equal(denied.status, 404, "tn_root contract types must not be writeable from another tenant");

    // Create a contract type owned by this tenant directly in the DB and PUT against it.
    const ctId = `ct_test_${world.runId}`;
    await db.insert(contractTypesTable).values({
      id: ctId,
      tenantId: world.tenantId,
      code: "TEST",
      name: "Test Contract Type",
      active: true,
    });
    try {
      const ok = await alice.put(`/api/contract-types/${ctId}/cuad-expectations`, {
        items: [
          { cuadCategoryId: "cuad_parties", requirement: "expected" },
          { cuadCategoryId: "cuad_audit_rights", requirement: "recommended" },
        ],
      });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));

      const get = await alice.get(`/api/contract-types/${ctId}/cuad-expectations`);
      assert.equal(get.status, 200);
      const items = get.body as Array<{ cuadCategoryId: string; requirement: string }>;
      assert.equal(items.length, 2);
      const byId = new Map(items.map(i => [i.cuadCategoryId, i.requirement]));
      assert.equal(byId.get("cuad_parties"), "expected");
      assert.equal(byId.get("cuad_audit_rights"), "recommended");

      // Unknown category id is rejected with 422.
      const bad = await alice.put(`/api/contract-types/${ctId}/cuad-expectations`, {
        items: [{ cuadCategoryId: "cuad_does_not_exist", requirement: "expected" }],
      });
      assert.equal(bad.status, 422);

      // PUT replaces atomically (re-PUT with empty items wipes out the rows).
      const empty = await alice.put(`/api/contract-types/${ctId}/cuad-expectations`, { items: [] });
      assert.equal(empty.status, 200);
      const after = await alice.get(`/api/contract-types/${ctId}/cuad-expectations`);
      assert.deepEqual(after.body, []);
    } finally {
      await db.delete(contractTypeCuadExpectationsTable)
        .where(eq(contractTypeCuadExpectationsTable.contractTypeId, ctId));
      await db.delete(contractTypesTable).where(and(
        eq(contractTypesTable.id, ctId),
        eq(contractTypesTable.tenantId, world.tenantId),
      ));
    }
  });

  it("Contract without contractTypeId reports zero expectations and empty lists", async () => {
    // world.contractId is created by createTestWorld with no contract_type_id.
    const res = await alice.get(`/api/contracts/${world.contractId}/cuad-coverage`);
    assert.equal(res.status, 200);
    const cov = res.body as CuadCoverage;
    assert.equal(cov.contractTypeId, null);
    assert.equal(cov.totalExpected, 0);
    assert.equal(cov.totalRecommended, 0);
    assert.deepEqual(cov.covered, []);
    assert.deepEqual(cov.missing, []);
  });
});

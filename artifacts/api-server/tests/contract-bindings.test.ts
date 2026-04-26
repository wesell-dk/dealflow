import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  contractsTable,
  contractClausesTable,
  usersTable,
  contractTypesTable,
  brandsTable,
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

interface ContractResponse {
  id: string;
  tenantId: string | null;
  contractTypeId: string | null;
  title: string;
  template: string;
}

interface CuadCoverage {
  contractId: string;
  contractTypeId: string | null;
  totalExpected: number;
  coveredExpected: number;
  missingExpectedCount: number;
}

describe("Contract bindings — POST/PATCH set tenantId + contractTypeId", () => {
  let server: TestServer;
  let world: TestWorld;
  let alice: AuthedClient;
  const seededContractIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    world = await createTestWorld("ctbind");
    await db.update(usersTable)
      .set({ role: "Tenant Admin", tenantWide: true })
      .where(eq(usersTable.id, world.userId));
    alice = await loginClient(server.baseUrl, world.userEmail, world.password);
  });

  after(async () => {
    if (seededContractIds.length > 0) {
      await db.delete(contractClausesTable)
        .where(inArray(contractClausesTable.contractId, seededContractIds));
      await db.delete(contractsTable)
        .where(inArray(contractsTable.id, seededContractIds));
    }
    await destroyTestWorlds(world);
    await server.close();
  });

  it("POST /contracts derives contractTypeId from template heuristic and sets tenantId", async () => {
    const created = await alice.post("/api/contracts", {
      dealId: world.dealId,
      title: "MSA via heuristic",
      template: "Master Services Agreement",
      brandId: world.brandId,
      jurisdiction: "DE",
      practiceArea: "service",
     });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const body = created.body as ContractResponse;
    seededContractIds.push(body.id);
    assert.equal(body.contractTypeId, "ct_msa", "MSA template must auto-bind to ct_msa");
    assert.ok(body.tenantId, "tenantId must be set on creation");

    // CUAD coverage works immediately — no manual DB update needed.
    const cov = await alice.get(`/api/contracts/${body.id}/cuad-coverage`);
    assert.equal(cov.status, 200);
    const c = cov.body as CuadCoverage;
    assert.equal(c.contractTypeId, "ct_msa");
    assert.ok(c.totalExpected > 0, "MSA should report expected CUAD categories");
  });

  it("POST /contracts honours explicit contractTypeId and validates it", async () => {
    // Explicit ct_nda overrides any template heuristic.
    const created = await alice.post("/api/contracts", {
      dealId: world.dealId,
      title: "Explicit NDA",
      template: "Some random template name",
      brandId: world.brandId,
      contractTypeId: "ct_nda",
      jurisdiction: "DE",
      practiceArea: "service",
     });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const body = created.body as ContractResponse;
    seededContractIds.push(body.id);
    assert.equal(body.contractTypeId, "ct_nda");

    // Unknown contractTypeId → 422.
    const bad = await alice.post("/api/contracts", {
      dealId: world.dealId,
      title: "Bad type",
      template: "Mutual NDA",
      brandId: world.brandId,
      contractTypeId: "ct_does_not_exist",
      jurisdiction: "DE",
      practiceArea: "service",
     });
    assert.equal(bad.status, 422, JSON.stringify(bad.body));
  });

  it("POST /contracts rejects unmappable templates with 422 + actionable hint", async () => {
    const res = await alice.post("/api/contracts", {
      dealId: world.dealId,
      title: "Unknown template",
      template: "Some Bespoke Agreement With No Keywords",
      brandId: world.brandId,
      jurisdiction: "DE",
      practiceArea: "service",
     });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    const body = res.body as { error: string; details?: string };
    assert.match(body.error, /contractTypeId/i);
    assert.ok(body.details && /contractTypeId/i.test(body.details));
  });

  it("PATCH /contracts/:id retro-assigns contractTypeId and backfills tenantId", async () => {
    // Build a legacy contract (no contractTypeId, no tenantId) directly via DB
    // to simulate pre-binding rows.
    const legacyId = `${world.runId}_legacy`;
    await db.insert(contractsTable).values({
      id: legacyId,
      dealId: world.dealId,
      title: "Legacy unbound contract",
      status: "drafting",
      version: 1,
      riskLevel: "low",
      template: "old template",
      language: "de",
    });
    seededContractIds.push(legacyId);

    // Coverage starts empty (no contractTypeId).
    const before = await alice.get(`/api/contracts/${legacyId}/cuad-coverage`);
    assert.equal((before.body as CuadCoverage).contractTypeId, null);

    const patched = await alice.patch(`/api/contracts/${legacyId}`, {
      contractTypeId: "ct_msa",
    });
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
    const body = patched.body as ContractResponse;
    assert.equal(body.contractTypeId, "ct_msa");
    assert.equal(body.tenantId, world.tenantId, "PATCH must backfill tenantId on legacy rows");

    // Coverage now works deterministically.
    const after = await alice.get(`/api/contracts/${legacyId}/cuad-coverage`);
    const cov = after.body as CuadCoverage;
    assert.equal(cov.contractTypeId, "ct_msa");
    assert.ok(cov.totalExpected > 0);

    // PATCH null clears the binding.
    const cleared = await alice.patch(`/api/contracts/${legacyId}`, { contractTypeId: null });
    assert.equal(cleared.status, 200);
    assert.equal((cleared.body as ContractResponse).contractTypeId, null);
  });

  it("POST /contracts uses brand.defaultContractTypeId before falling back to template heuristic", async () => {
    // Pin the world brand to ct_msa explicitly. Template name says "Mutual NDA"
    // — heuristic alone would yield ct_nda — so seeing ct_msa proves the brand
    // default takes precedence.
    await db.update(brandsTable)
      .set({ defaultContractTypeId: "ct_msa" })
      .where(eq(brandsTable.id, world.brandId));
    try {
      const created = await alice.post("/api/contracts", {
        dealId: world.dealId,
        title: "Brand-default wins over heuristic",
        template: "Mutual NDA",
        brandId: world.brandId,
        jurisdiction: "DE",
        practiceArea: "service",
       });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const body = created.body as ContractResponse;
      seededContractIds.push(body.id);
      assert.equal(body.contractTypeId, "ct_msa", "brand default must beat the NDA heuristic");

      // Explicit contractTypeId still wins over the brand default.
      const explicit = await alice.post("/api/contracts", {
        dealId: world.dealId,
        title: "Explicit overrides brand default",
        template: "Mutual NDA",
        brandId: world.brandId,
        contractTypeId: "ct_nda",
        jurisdiction: "DE",
        practiceArea: "service",
       });
      assert.equal(explicit.status, 201);
      const eb = explicit.body as ContractResponse;
      seededContractIds.push(eb.id);
      assert.equal(eb.contractTypeId, "ct_nda");

      // Inactive brand default → heuristic kicks back in (defensive revalidation).
      await db.update(contractTypesTable).set({ active: false }).where(eq(contractTypesTable.id, "ct_msa"));
      try {
        const fallback = await alice.post("/api/contracts", {
          dealId: world.dealId,
          title: "Falls back to heuristic when brand default is inactive",
          template: "Mutual NDA",
          brandId: world.brandId,
          jurisdiction: "DE",
          practiceArea: "service",
         });
        assert.equal(fallback.status, 201, JSON.stringify(fallback.body));
        const fb = fallback.body as ContractResponse;
        seededContractIds.push(fb.id);
        assert.equal(fb.contractTypeId, "ct_nda", "must fall back to heuristic when brand default is inactive");
      } finally {
        await db.update(contractTypesTable).set({ active: true }).where(eq(contractTypesTable.id, "ct_msa"));
      }
    } finally {
      await db.update(brandsTable)
        .set({ defaultContractTypeId: null })
        .where(eq(brandsTable.id, world.brandId));
    }
  });

  it("PATCH /brands/:id sets and clears defaultContractTypeId with FK validation", async () => {
    // Set to a valid tn_root-seeded type.
    const set = await alice.patch(`/api/brands/${world.brandId}`, { defaultContractTypeId: "ct_msa" });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal((set.body as { defaultContractTypeId: string | null }).defaultContractTypeId, "ct_msa");

    // Unknown id → 422.
    const bad = await alice.patch(`/api/brands/${world.brandId}`, { defaultContractTypeId: "ct_nope" });
    assert.equal(bad.status, 422, JSON.stringify(bad.body));

    // Foreign-tenant type → 403.
    const foreignTypeId = `${world.runId}_foreign_dft`;
    await db.insert(contractTypesTable).values({
      id: foreignTypeId,
      tenantId: "tn_some_other_tenant_does_not_exist",
      code: "FORN2",
      name: "Foreign Default Type",
      active: true,
    });
    try {
      const denied = await alice.patch(`/api/brands/${world.brandId}`, {
        defaultContractTypeId: foreignTypeId,
      });
      assert.equal(denied.status, 403, JSON.stringify(denied.body));
    } finally {
      await db.delete(contractTypesTable).where(eq(contractTypesTable.id, foreignTypeId));
    }

    // Clearing with null returns to heuristic mode.
    const cleared = await alice.patch(`/api/brands/${world.brandId}`, { defaultContractTypeId: null });
    assert.equal(cleared.status, 200);
    assert.equal((cleared.body as { defaultContractTypeId: string | null }).defaultContractTypeId, null);
  });

  it("PATCH /contracts/:id rejects contractTypeId from other tenants", async () => {
    // Create a contract owned by world tenant.
    const created = await alice.post("/api/contracts", {
      dealId: world.dealId,
      title: "For tenant scope check",
      template: "Mutual NDA",
      brandId: world.brandId,
      jurisdiction: "DE",
      practiceArea: "service",
     });
    assert.equal(created.status, 201);
    const ctrId = (created.body as ContractResponse).id;
    seededContractIds.push(ctrId);

    // Build a foreign-tenant contract type and try to assign it.
    const foreignTypeId = `${world.runId}_foreign_ct`;
    await db.insert(contractTypesTable).values({
      id: foreignTypeId,
      tenantId: "tn_some_other_tenant_does_not_exist",
      code: "FORN",
      name: "Foreign Contract Type",
      active: true,
    });
    try {
      const denied = await alice.patch(`/api/contracts/${ctrId}`, {
        contractTypeId: foreignTypeId,
      });
      assert.equal(denied.status, 403, JSON.stringify(denied.body));
    } finally {
      await db.delete(contractTypesTable).where(eq(contractTypesTable.id, foreignTypeId));
    }
  });
});

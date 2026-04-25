import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, and } from "drizzle-orm";
import {
  db,
  brandsTable,
  contractsTable,
  contractClausesTable,
  auditLogTable,
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

describe("POST /contracts/:id/clauses — Quick-Add", () => {
  let server: TestServer;
  let world: TestWorld;
  let alice: AuthedClient;
  const seededContractIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    world = await createTestWorld("qaclause");
    alice = await loginClient(server.baseUrl, world.userEmail, world.password);

    // Brand has a default for cf_liab and cf_term, but NOT for cf_pay (so we
    // can verify the fallback to "first variant" path).
    await db.update(brandsTable).set({
      defaultClauseVariants: {
        cf_liab: "cv_liab_3",
        cf_term: "cv_term_3",
      } as Record<string, string>,
    }).where(eq(brandsTable.id, world.brandId));
  });

  after(async () => {
    if (seededContractIds.length > 0) {
      await db.delete(contractClausesTable)
        .where(inArray(contractClausesTable.contractId, seededContractIds));
      await db.delete(auditLogTable)
        .where(inArray(auditLogTable.entityId, seededContractIds));
      await db.delete(contractsTable)
        .where(inArray(contractsTable.id, seededContractIds));
    }
    await destroyTestWorlds(world);
    await server.close();
  });

  async function createContract(title: string): Promise<string> {
    const created = await alice.post("/api/contracts", {
      dealId: world.dealId,
      title,
      template: "Master Services Agreement",
      brandId: world.brandId,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = (created.body as { id: string }).id;
    seededContractIds.push(id);
    return id;
  }

  it("appends a clause from a brand-default variant when one exists", async () => {
    const ctrId = await createContract("Quick-Add — brand default");

    // Drop the auto-seeded cf_liab so we can re-add it via Quick-Add.
    await db.delete(contractClausesTable).where(and(
      eq(contractClausesTable.contractId, ctrId),
      eq(contractClausesTable.familyId, "cf_liab"),
    ));

    const res = await alice.post(`/api/contracts/${ctrId}/clauses`, {
      familyId: "cf_liab",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const body = res.body as {
      clause: { familyId: string; activeVariantId: string; family: string };
      contractRiskLevel: string;
      contractRiskScore: number;
      dealName: string;
    };
    assert.equal(body.clause.familyId, "cf_liab");
    assert.equal(body.clause.activeVariantId, "cv_liab_3", "must use brand default variant");
    assert.equal(body.clause.family, "Liability");
    assert.ok(typeof body.contractRiskScore === "number");

    // Persisted to DB.
    const rows = await db.select().from(contractClausesTable)
      .where(and(
        eq(contractClausesTable.contractId, ctrId),
        eq(contractClausesTable.familyId, "cf_liab"),
      ));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.activeVariantId, "cv_liab_3");

    // Audit-log entry written.
    const audit = await db.select().from(auditLogTable)
      .where(and(
        eq(auditLogTable.entityType, "contract"),
        eq(auditLogTable.entityId, ctrId),
        eq(auditLogTable.action, "clause_added"),
      ));
    assert.ok(audit.length >= 1, "audit log must contain clause_added entry");
  });

  it("falls back to the first variant of a family when no brand default", async () => {
    const ctrId = await createContract("Quick-Add — fallback first variant");

    // cf_pay has no brand default → endpoint must pick the highest-severity
    // variant of cf_pay (we order severityScore desc, then by name).
    const res = await alice.post(`/api/contracts/${ctrId}/clauses`, {
      familyId: "cf_pay",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const body = res.body as { clause: { familyId: string; activeVariantId: string } };
    assert.equal(body.clause.familyId, "cf_pay");
    assert.ok(body.clause.activeVariantId.startsWith("cv_pay_"), "must pick a cf_pay variant");
  });

  it("respects an explicit variantId when provided", async () => {
    const ctrId = await createContract("Quick-Add — explicit variant");

    const res = await alice.post(`/api/contracts/${ctrId}/clauses`, {
      familyId: "cf_pay",
      variantId: "cv_pay_2",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const body = res.body as { clause: { familyId: string; activeVariantId: string } };
    assert.equal(body.clause.activeVariantId, "cv_pay_2");
  });

  it("rejects with 400 when variant does not belong to the family", async () => {
    const ctrId = await createContract("Quick-Add — variant mismatch");

    const res = await alice.post(`/api/contracts/${ctrId}/clauses`, {
      familyId: "cf_pay",
      variantId: "cv_liab_3",
    });
    assert.equal(res.status, 400);
  });

  it("rejects with 409 when a clause for this family already exists", async () => {
    const ctrId = await createContract("Quick-Add — duplicate family");

    // Brand default already seeds cf_liab on contract creation.
    const res = await alice.post(`/api/contracts/${ctrId}/clauses`, {
      familyId: "cf_liab",
    });
    assert.equal(res.status, 409);
  });

  it("rejects unknown family id with 400", async () => {
    const ctrId = await createContract("Quick-Add — unknown family");

    const res = await alice.post(`/api/contracts/${ctrId}/clauses`, {
      familyId: "cf_does_not_exist",
    });
    assert.equal(res.status, 400);
  });

  it("returns 404 when the contract does not exist", async () => {
    const res = await alice.post(`/api/contracts/ctr_missing/clauses`, {
      familyId: "cf_liab",
    });
    assert.equal(res.status, 404);
  });
});

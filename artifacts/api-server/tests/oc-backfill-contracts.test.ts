// Task #274 — Backfill OC↔Vertrag-Links für bereits versandte
// Auftragsbestätigungen.
//
// Geprüft wird:
//  1. Eine OC in `in_onboarding` ohne contractId, an deren Deal noch ein
//     verwaister Bestandsvertrag hängt → Backfill adoptiert den Vertrag
//     (beide Seiten verlinkt, keine zweite Vertrags-Anlage).
//  2. Eine OC in `completed` ohne passenden Bestandsvertrag → Backfill legt
//     einen neuen Draft via createDraftContractFromOc an.
//  3. Eine bereits verlinkte OC bleibt unangetastet (kein Doppel-Audit, kein
//     zweiter Vertrag).
//  4. Idempotenz: zweiter Lauf findet keine Kandidaten mehr (scanned=0).
//  5. Tenant-Isolation: Backfill greift NIE auf OCs anderer Mandanten zu.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  orderConfirmationsTable,
  contractsTable,
  auditLogTable,
  timelineEventsTable,
} from "@workspace/db";
import {
  createTestWorld,
  destroyTestWorlds,
  sweepStaleTestData,
  type TestWorld,
} from "./helpers";
import { loginClient, startTestServer, type AuthedClient, type TestServer } from "./server";

interface BackfillResp {
  ok: boolean;
  scanned: number;
  linked: number;
  created: number;
  errors: Array<{ orderConfirmationId: string; reason: string }>;
}

describe("Task #274 — backfill draft contracts for already-sent OCs", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let worldB: TestWorld;
  let clientA: AuthedClient;
  let clientB: AuthedClient;

  // IDs we insert outside createTestWorld and need to clean up explicitly.
  const extraOcIds: string[] = [];
  const extraContractIds: string[] = [];

  // Deterministic suffixes for the test rows so cleanup can target them.
  const suf = randomBytes(4).toString("hex");
  const ocAdoptId = `oc_bf_adopt_${suf}`;
  const ocCreateId = `oc_bf_create_${suf}`;
  const ocAlreadyId = `oc_bf_already_${suf}`;
  const ocOtherTenantId = `oc_bf_other_${suf}`;
  const ctrOrphanId = `ctr_bf_orphan_${suf}`;
  const ctrAlreadyId = `ctr_bf_already_${suf}`;
  const ctrOtherTenantId = `ctr_bf_other_${suf}`;

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    [worldA, worldB] = await Promise.all([
      createTestWorld("oc_bf_a"),
      createTestWorld("oc_bf_b"),
    ]);
    [clientA, clientB] = await Promise.all([
      loginClient(server.baseUrl, worldA.userEmail, worldA.password),
      loginClient(server.baseUrl, worldB.userEmail, worldB.password),
    ]);

    // The default OC seeded by createTestWorld is in `in_preparation` status
    // and would be ignored by the backfill (status filter), but its companion
    // contract has no sourceOrderConfirmationId — i.e. it would look orphan
    // and could get accidentally adopted by one of our test OCs. Pre-link both
    // sides on each tenant so the only "orphan" candidate visible to the
    // backfill is the one we explicitly insert below.
    await Promise.all([
      db.update(contractsTable)
        .set({ sourceOrderConfirmationId: worldA.orderConfirmationId })
        .where(eq(contractsTable.id, worldA.contractId)),
      db.update(orderConfirmationsTable)
        .set({ contractId: worldA.contractId })
        .where(eq(orderConfirmationsTable.id, worldA.orderConfirmationId)),
      db.update(contractsTable)
        .set({ sourceOrderConfirmationId: worldB.orderConfirmationId })
        .where(eq(contractsTable.id, worldB.contractId)),
      db.update(orderConfirmationsTable)
        .set({ contractId: worldB.contractId })
        .where(eq(orderConfirmationsTable.id, worldB.orderConfirmationId)),
    ]);

    // Tenant A: orphan contract on the deal + an OC in `in_onboarding` that
    // should adopt it. The orphan contract has NO sourceOrderConfirmationId,
    // and the seed OC (in `in_preparation`) does not link to it either.
    await db.insert(contractsTable).values({
      id: ctrOrphanId,
      dealId: worldA.dealId,
      title: `Orphan Contract A ${suf}`,
      status: "drafting",
      version: 1,
      riskLevel: "low",
      template: "standard",
      tenantId: worldA.tenantId,
    });
    extraContractIds.push(ctrOrphanId);
    await db.insert(orderConfirmationsTable).values({
      id: ocAdoptId,
      dealId: worldA.dealId,
      number: `OC-BF-ADOPT-${suf}`,
      status: "in_onboarding",
      readinessScore: 100,
      totalAmount: "75000",
      currency: "EUR",
      slaDays: 7,
      sentToCustomerAt: new Date(),
    });
    extraOcIds.push(ocAdoptId);

    // Tenant A: OC in `completed` with NO orphan candidate → must create draft.
    await db.insert(orderConfirmationsTable).values({
      id: ocCreateId,
      // Use worldB.dealId so it doesn't share a deal with the adopt-OC and
      // there is definitely no orphan contract candidate for it. We need a
      // separate clean deal — re-using worldA.dealId would let it adopt the
      // orphan (which we don't want for this case). Instead we make a tiny
      // helper deal: inline below.
      dealId: worldA.dealId, // overwritten below
      number: `OC-BF-CREATE-${suf}`,
      status: "completed",
      readinessScore: 100,
      totalAmount: "50000",
      currency: "EUR",
      slaDays: 7,
      sentToCustomerAt: new Date(),
      completedAt: new Date(),
    });
    extraOcIds.push(ocCreateId);

    // Tenant A: an OC that's already linked to a contract → must be skipped.
    await db.insert(contractsTable).values({
      id: ctrAlreadyId,
      dealId: worldA.dealId,
      title: `Linked Contract A ${suf}`,
      status: "drafting",
      version: 1,
      riskLevel: "low",
      template: "standard",
      tenantId: worldA.tenantId,
      sourceOrderConfirmationId: ocAlreadyId,
    });
    extraContractIds.push(ctrAlreadyId);
    await db.insert(orderConfirmationsTable).values({
      id: ocAlreadyId,
      dealId: worldA.dealId,
      contractId: ctrAlreadyId,
      number: `OC-BF-ALREADY-${suf}`,
      status: "sent_to_customer",
      readinessScore: 100,
      totalAmount: "10000",
      currency: "EUR",
      slaDays: 7,
      sentToCustomerAt: new Date(),
    });
    extraOcIds.push(ocAlreadyId);

    // Tenant B: an OC in `in_onboarding` without contractId — must NOT be
    // touched when tenant A runs the backfill.
    await db.insert(contractsTable).values({
      id: ctrOtherTenantId,
      dealId: worldB.dealId,
      title: `Other-tenant Contract B ${suf}`,
      status: "drafting",
      version: 1,
      riskLevel: "low",
      template: "standard",
      tenantId: worldB.tenantId,
    });
    extraContractIds.push(ctrOtherTenantId);
    await db.insert(orderConfirmationsTable).values({
      id: ocOtherTenantId,
      dealId: worldB.dealId,
      number: `OC-BF-OTHER-${suf}`,
      status: "in_onboarding",
      readinessScore: 100,
      totalAmount: "20000",
      currency: "EUR",
      slaDays: 7,
      sentToCustomerAt: new Date(),
    });
    extraOcIds.push(ocOtherTenantId);
  });

  after(async () => {
    // Track auto-created drafts (from the "create" branch) for cleanup.
    const autoCreated = await db
      .select({ id: contractsTable.id })
      .from(contractsTable)
      .where(inArray(contractsTable.sourceOrderConfirmationId, [
        ocAdoptId,
        ocCreateId,
        ocOtherTenantId,
      ]));
    const autoCreatedIds = autoCreated.map((c) => c.id);

    // Audit + timeline rows for our extra OCs/contracts.
    if (extraOcIds.length) {
      await db
        .delete(auditLogTable)
        .where(and(
          eq(auditLogTable.entityType, "order_confirmation"),
          inArray(auditLogTable.entityId, extraOcIds),
        )!);
    }
    const allCtrIds = [...extraContractIds, ...autoCreatedIds];
    if (allCtrIds.length) {
      await db
        .delete(auditLogTable)
        .where(and(
          eq(auditLogTable.entityType, "contract"),
          inArray(auditLogTable.entityId, allCtrIds),
        )!);
    }
    await db
      .delete(auditLogTable)
      .where(and(
        eq(auditLogTable.action, "backfill_contracts_run"),
        inArray(auditLogTable.tenantId, [worldA.tenantId, worldB.tenantId]),
      )!);
    await db
      .delete(timelineEventsTable)
      .where(inArray(timelineEventsTable.dealId, [worldA.dealId, worldB.dealId]));
    if (extraOcIds.length) {
      await db
        .delete(orderConfirmationsTable)
        .where(inArray(orderConfirmationsTable.id, extraOcIds));
    }
    if (allCtrIds.length) {
      await db
        .delete(contractsTable)
        .where(inArray(contractsTable.id, allCtrIds));
    }
    await destroyTestWorlds(worldA, worldB);
    await server.close();
  });

  it("adopts an orphan contract on the same deal and creates a draft when none exists", async () => {
    const r = await clientA.post("/api/admin/order-confirmations/backfill-contracts");
    assert.equal(r.status, 200, `backfill failed: ${JSON.stringify(r.body)}`);
    const body = r.body as BackfillResp;
    assert.equal(body.ok, true);
    // adopt OC + create OC = 2 candidates in tenant A.
    assert.equal(body.scanned, 2, `scanned mismatch: ${JSON.stringify(body)}`);
    assert.equal(body.errors.length, 0, `unexpected errors: ${JSON.stringify(body.errors)}`);
    assert.equal(body.linked, 1, `expected 1 adoption, got ${body.linked}`);
    assert.equal(body.created, 1, `expected 1 new draft, got ${body.created}`);

    // Adopt-OC is now linked to the orphan contract.
    const [adoptOc] = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.id, ocAdoptId));
    assert.equal(adoptOc!.contractId, ctrOrphanId, "OC must point to orphan contract");
    const [orphan] = await db.select().from(contractsTable)
      .where(eq(contractsTable.id, ctrOrphanId));
    assert.equal(orphan!.sourceOrderConfirmationId, ocAdoptId,
      "orphan contract must point back to the OC");

    // Create-OC has a fresh draft now.
    const [createOc] = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.id, ocCreateId));
    assert.ok(createOc!.contractId, "create-OC must have a contractId after backfill");
    const [draft] = await db.select().from(contractsTable)
      .where(eq(contractsTable.id, createOc!.contractId!));
    assert.ok(draft, "auto-created draft must exist");
    assert.equal(draft!.status, "drafting");
    assert.equal(draft!.sourceOrderConfirmationId, ocCreateId);
    assert.equal(draft!.dealId, worldA.dealId);
  });

  it("leaves already-linked OCs untouched", async () => {
    const [linkedOc] = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.id, ocAlreadyId));
    assert.equal(linkedOc!.contractId, ctrAlreadyId, "pre-existing link must survive");
    const [linkedCtr] = await db.select().from(contractsTable)
      .where(eq(contractsTable.id, ctrAlreadyId));
    assert.equal(linkedCtr!.sourceOrderConfirmationId, ocAlreadyId,
      "pre-existing back-link must survive");
  });

  it("does not touch OCs from other tenants", async () => {
    const [otherOc] = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.id, ocOtherTenantId));
    assert.equal(otherOc!.contractId, null,
      "tenant A's backfill must not touch tenant B's OC");
    // And the other tenant's orphan stays orphan.
    const [otherCtr] = await db.select().from(contractsTable)
      .where(eq(contractsTable.id, ctrOtherTenantId));
    assert.equal(otherCtr!.sourceOrderConfirmationId, null);
  });

  it("is idempotent: a second run finds nothing to do", async () => {
    const r = await clientA.post("/api/admin/order-confirmations/backfill-contracts");
    assert.equal(r.status, 200, `second backfill failed: ${JSON.stringify(r.body)}`);
    const body = r.body as BackfillResp;
    assert.equal(body.scanned, 0, "second run must find no candidates");
    assert.equal(body.linked, 0);
    assert.equal(body.created, 0);
  });

  it("writes an audit row summarising the run", async () => {
    const audits = await db.select().from(auditLogTable)
      .where(and(
        eq(auditLogTable.tenantId, worldA.tenantId),
        eq(auditLogTable.action, "backfill_contracts_run"),
      )!);
    assert.ok(audits.length >= 1, "summary audit must be written");
    // Per-OC audit lines for the adopt + create cases.
    const perOc = await db.select().from(auditLogTable)
      .where(and(
        eq(auditLogTable.entityType, "order_confirmation"),
        eq(auditLogTable.action, "backfill_contract_link"),
        inArray(auditLogTable.entityId, [ocAdoptId, ocCreateId]),
      )!);
    assert.equal(perOc.length, 2, `expected 2 per-OC audit rows, got ${perOc.length}`);
  });

  it("a separate tenant's run only touches its own data", async () => {
    // Tenant B's seeded user is tenantWide=true (admin) so requireAdmin passes.
    // After tenant A's backfill, tenant B's orphan contract + OC must still be
    // intact and untouched. Now tenant B runs the backfill and the orphan gets
    // adopted — proving each tenant's run is properly scoped.
    const r = await clientB.post("/api/admin/order-confirmations/backfill-contracts");
    assert.equal(r.status, 200);
    const body = r.body as BackfillResp;
    assert.equal(body.scanned, 1, "tenant B sees only its own OC");
    // The other-tenant OC has an orphan contract on the same deal → adoption.
    assert.equal(body.linked, 1);
    assert.equal(body.created, 0);
    const [otherOc] = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.id, ocOtherTenantId));
    assert.equal(otherOc!.contractId, ctrOtherTenantId);
  });
});

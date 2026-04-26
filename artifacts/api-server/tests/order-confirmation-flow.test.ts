// Task #237 — reversierter OC↔Vertrag-Flow.
//
// Geprüft wird:
//  1. Quote-Accept ohne aktive Verhandlung → OC wird automatisch erzeugt.
//  2. Quote-Accept mit aktiver Verhandlung → OC wird aufgeschoben; nach
//     /negotiations/:id/conclude (outcome=accepted) entsteht sie.
//  3. POST /order-confirmations/:id/send ist idempotent und legt genau einen
//     Draft-Vertrag an, der via sourceOrderConfirmationId zurückverlinkt ist.
//  4. /send wird nur akzeptiert, wenn die OC im Status ready_for_handover ist.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  quotesTable,
  orderConfirmationsTable,
  orderConfirmationChecksTable,
  contractsTable,
  negotiationsTable,
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

interface OcResp {
  id: string;
  number: string;
  status: string;
  sourceQuoteId: string | null;
  contractId: string | null;
  contractNumber: string | null;
  sentToCustomerAt: string | null;
  sentToCustomerEmail: string | null;
}

describe("Task #237 — reversed OC↔Contract creation flow", () => {
  let server: TestServer;
  // World 1: Quote-Accept ohne aktive Verhandlung.
  let worldA: TestWorld;
  let clientA: AuthedClient;
  // World 2: Quote-Accept mit aktiver Verhandlung.
  let worldB: TestWorld;
  let clientB: AuthedClient;
  // World 3: /send-Idempotenz.
  let worldC: TestWorld;
  let clientC: AuthedClient;

  // Tracking für Cleanup von Tests-erzeugten Rows, die nicht zur TestWorld
  // gehören (Auto-OC, Auto-Contract, Audit, Timeline).
  const extraOcIds: string[] = [];
  const extraContractIds: string[] = [];
  const extraOcCheckIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    [worldA, worldB, worldC] = await Promise.all([
      createTestWorld("oc_flow_a"),
      createTestWorld("oc_flow_b"),
      createTestWorld("oc_flow_c"),
    ]);
    [clientA, clientB, clientC] = await Promise.all([
      loginClient(server.baseUrl, worldA.userEmail, worldA.password),
      loginClient(server.baseUrl, worldB.userEmail, worldB.password),
      loginClient(server.baseUrl, worldC.userEmail, worldC.password),
    ]);

    // Reset Quote-Status auf 'sent' (createTestWorld setzt 'sent' bereits, aber
    // wir wollen explizit sicher sein, dass /accept den Übergang fährt).
    await db.update(quotesTable).set({ status: "sent" }).where(
      inArray(quotesTable.id, [worldA.quoteId, worldB.quoteId, worldC.quoteId]),
    );

    // World A: Stelle sicher, dass keine Negotiation 'active' ist.
    await db.update(negotiationsTable).set({ status: "closed" }).where(
      eq(negotiationsTable.id, worldA.negotiationId),
    );

    // World B: Negotiation auf 'active' setzen, damit Auto-OC blockiert wird.
    await db.update(negotiationsTable).set({ status: "active" }).where(
      eq(negotiationsTable.id, worldB.negotiationId),
    );

    // World C: keine aktive Negotiation.
    await db.update(negotiationsTable).set({ status: "closed" }).where(
      eq(negotiationsTable.id, worldC.negotiationId),
    );

    // World A/B/C: die in createTestWorld vorab eingefügte OC stört unsere
    // Auto-OC-Erkennung. Wir löschen sie, damit nur die vom Endpoint erzeugte
    // OC am Deal hängt.
    await db.delete(orderConfirmationsTable).where(
      inArray(orderConfirmationsTable.id, [
        worldA.orderConfirmationId,
        worldB.orderConfirmationId,
        worldC.orderConfirmationId,
      ]),
    );
  });

  after(async () => {
    // Auto-erzeugte Vertrags-Drafts wegräumen.
    if (extraContractIds.length) {
      await db.delete(auditLogTable).where(
        and(eq(auditLogTable.entityType, "contract"), inArray(auditLogTable.entityId, extraContractIds))!,
      );
      await db.delete(contractsTable).where(inArray(contractsTable.id, extraContractIds));
    }
    // Auto-erzeugte OC-Checks und OCs wegräumen.
    if (extraOcCheckIds.length) {
      await db.delete(orderConfirmationChecksTable).where(
        inArray(orderConfirmationChecksTable.id, extraOcCheckIds),
      );
    }
    if (extraOcIds.length) {
      await db.delete(orderConfirmationChecksTable).where(
        inArray(orderConfirmationChecksTable.orderConfirmationId, extraOcIds),
      );
      await db.delete(auditLogTable).where(
        and(eq(auditLogTable.entityType, "order_confirmation"), inArray(auditLogTable.entityId, extraOcIds))!,
      );
      await db.delete(orderConfirmationsTable).where(inArray(orderConfirmationsTable.id, extraOcIds));
    }
    // Timeline-Events der Test-Deals (Handover/Negotiation/Contract) entsorgen.
    await db.delete(timelineEventsTable).where(
      inArray(timelineEventsTable.dealId, [worldA.dealId, worldB.dealId, worldC.dealId]),
    );
    await destroyTestWorlds(worldA, worldB, worldC);
    await server.close();
  });

  it("auto-creates an OC when a quote is accepted with no active negotiation", async () => {
    const r = await clientA.post(`/api/quotes/${worldA.quoteId}/accept`);
    assert.equal(r.status, 200, `accept failed: ${JSON.stringify(r.body)}`);

    // OC sollte jetzt am Deal hängen, mit sourceQuoteId = world.quoteId.
    const ocs = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.dealId, worldA.dealId));
    assert.equal(ocs.length, 1, `expected exactly 1 OC for deal, got ${ocs.length}`);
    assert.equal(ocs[0]!.sourceQuoteId, worldA.quoteId, "OC must link back to source quote");
    extraOcIds.push(ocs[0]!.id);

    // Idempotenz: erneutes /accept oder createOcFromQuote-Aufruf erzeugt keine
    // zweite OC. Wir simulieren einen erneuten Accept-Aufruf (Quote ist bereits
    // accepted; applyQuoteAccepted bleibt idempotent).
    const r2 = await clientA.post(`/api/quotes/${worldA.quoteId}/accept`);
    assert.equal(r2.status, 200);
    const ocs2 = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.dealId, worldA.dealId));
    assert.equal(ocs2.length, 1, "second accept must NOT create a duplicate OC");
  });

  it("defers OC creation while a negotiation is active and creates it on conclude(accepted)", async () => {
    // 1) Accept Quote → OC darf NICHT entstehen, weil active negotiation läuft.
    const r1 = await clientB.post(`/api/quotes/${worldB.quoteId}/accept`);
    assert.equal(r1.status, 200, `accept failed: ${JSON.stringify(r1.body)}`);

    const ocsBefore = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.dealId, worldB.dealId));
    assert.equal(ocsBefore.length, 0, "OC must NOT be created while negotiation is active");

    // 2) Conclude Negotiation mit outcome=accepted → OC entsteht jetzt nachträglich.
    const r2 = await clientB.post(`/api/negotiations/${worldB.negotiationId}/conclude`, {
      outcome: "accepted",
    });
    assert.equal(r2.status, 200, `conclude failed: ${JSON.stringify(r2.body)}`);

    const ocsAfter = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.dealId, worldB.dealId));
    assert.equal(ocsAfter.length, 1, "OC must be created on conclude(accepted)");
    assert.equal(ocsAfter[0]!.sourceQuoteId, worldB.quoteId);
    extraOcIds.push(ocsAfter[0]!.id);
  });

  it("POST /send sets sent_to_customer, creates exactly one draft contract, and is idempotent", async () => {
    // Quote akzeptieren → Auto-OC entsteht.
    const r1 = await clientC.post(`/api/quotes/${worldC.quoteId}/accept`);
    assert.equal(r1.status, 200);

    const [oc] = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.dealId, worldC.dealId));
    assert.ok(oc, "expected OC to exist after quote accept");
    extraOcIds.push(oc.id);

    // OC auf ready_for_handover hieven: alle Pflicht-Checks auf ok setzen,
    // status manuell auf ready_for_handover (kein eigener Endpoint dafür im
    // Test-Setup nötig).
    const checks = await db.select().from(orderConfirmationChecksTable)
      .where(eq(orderConfirmationChecksTable.orderConfirmationId, oc.id));
    if (checks.length === 0) {
      // Wenn das Seeding keine Checks produziert hat, einen Pflicht-Check
      // selbst anlegen, damit reconcileOcState überhaupt ein "ready" ableiten
      // könnte. Der /send-Endpoint prüft die Pflicht-Checks aber direkt.
      const ckId = `ck_${oc.id}_test`;
      await db.insert(orderConfirmationChecksTable).values({
        id: ckId,
        orderConfirmationId: oc.id,
        label: "Test pflicht-Check",
        required: true,
        status: "ok",
      });
      extraOcCheckIds.push(ckId);
    } else {
      await db.update(orderConfirmationChecksTable)
        .set({ status: "ok" })
        .where(eq(orderConfirmationChecksTable.orderConfirmationId, oc.id));
    }
    await db.update(orderConfirmationsTable)
      .set({ status: "ready_for_handover", readinessScore: 100 })
      .where(eq(orderConfirmationsTable.id, oc.id));

    // 1. /send → 200, OC.sent_to_customer + Vertrag-Draft entsteht.
    const send1 = await clientC.post(`/api/order-confirmations/${oc.id}/send`, {
      recipientEmail: "buyer@example.test",
      note: "Bitte gegenzeichnen.",
    });
    assert.equal(send1.status, 200, `send failed: ${JSON.stringify(send1.body)}`);
    const sentBody = send1.body as OcResp;
    assert.equal(sentBody.status, "sent_to_customer");
    assert.equal(sentBody.sentToCustomerEmail, "buyer@example.test");
    assert.ok(sentBody.sentToCustomerAt, "sentToCustomerAt must be set");
    assert.ok(sentBody.contractId, "OC must be linked to the auto-created contract");
    assert.ok(sentBody.contractNumber, "contract title should round-trip as contractNumber");

    const contractsAfter = await db.select().from(contractsTable)
      .where(eq(contractsTable.sourceOrderConfirmationId, oc.id));
    assert.equal(contractsAfter.length, 1, "exactly one draft contract per OC");
    assert.equal(contractsAfter[0]!.status, "drafting", "contract must be a draft");
    assert.equal(contractsAfter[0]!.dealId, worldC.dealId);
    extraContractIds.push(contractsAfter[0]!.id);

    // 2. Zweiter /send → 200 (no-op), kein zweiter Vertrag, OC.contractId stabil.
    const send2 = await clientC.post(`/api/order-confirmations/${oc.id}/send`, {
      recipientEmail: "buyer@example.test",
    });
    assert.equal(send2.status, 200, `idempotent send failed: ${JSON.stringify(send2.body)}`);
    const contractsAfter2 = await db.select().from(contractsTable)
      .where(eq(contractsTable.sourceOrderConfirmationId, oc.id));
    assert.equal(contractsAfter2.length, 1, "second /send must NOT create a duplicate contract");
    assert.equal(contractsAfter2[0]!.id, contractsAfter[0]!.id, "same contract id");
  });

  it("POST /send rejects when OC is not in ready_for_handover", async () => {
    // worldA's OC wurde im ersten Test erzeugt und ist im Status preparing.
    const [oc] = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.dealId, worldA.dealId));
    assert.ok(oc, "expected OC from worldA");
    assert.notEqual(oc.status, "ready_for_handover", "precondition: OC not yet ready");

    const r = await clientA.post(`/api/order-confirmations/${oc.id}/send`, {
      recipientEmail: "buyer@example.test",
    });
    assert.equal(r.status, 409, `expected 409, got ${r.status}: ${JSON.stringify(r.body)}`);
    const contractsAfter = await db.select().from(contractsTable)
      .where(eq(contractsTable.sourceOrderConfirmationId, oc.id));
    assert.equal(contractsAfter.length, 0, "no contract must be created when /send is rejected");
  });
});

// Task #275 — regression test for the OLD signature-completion path.
//
// Seit Task #237 erzeugt `maybeCompletePackageAndCreateOC` keine neue
// Auftragsbestätigung mehr (die OC-Anlage hängt jetzt am Quote-Accept).
// Dieser Test pinnt fest, was diese Funktion stattdessen weiterhin
// garantieren MUSS, sobald alle aktiven Signers eines Pakets unterschrieben
// haben:
//
//   1. signature_packages.status → 'completed'
//   2. Der zum Paket gehörende Vertrag wechselt auf 'signed' + signedAt
//   3. obligations werden aus den Klausel-Varianten abgeleitet
//   4. clause_deviations werden aus dem ContractType evaluiert
//   5. Eine offene Renewal-Opportunity am Vorvertrag wird auf 'won' gesetzt
//      (Renewal-Anchoring beim Folgevertrag)
//   6. Ein webhook_deliveries-Eintrag für 'contract.signed' wird einqueued
//   7. Auf diesem Pfad entsteht KEINE neue OC und KEIN neuer Vertrag
//
// Hintergrund: Eine künftige Refaktorierung könnte einen dieser Punkte
// stillschweigend wegregressen — der Test soll genau das verhindern.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  contractsTable,
  contractClausesTable,
  contractTypesTable,
  clauseFamiliesTable,
  clauseVariantsTable,
  clauseDeviationsTable,
  obligationsTable,
  signaturePackagesTable,
  signersTable,
  renewalOpportunitiesTable,
  webhooksTable,
  webhookDeliveriesTable,
  orderConfirmationsTable,
  legalPrecedentsTable,
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

describe("Task #275 — signature completion → contract signed → obligations + deviations + renewal + webhook", () => {
  let server: TestServer;
  let world: TestWorld;
  let client: AuthedClient;

  // IDs of test-only rows we insert ourselves and must clean up afterwards.
  const familyMissingId = `tnt_iso_t275_fam_missing_${Date.now().toString(36)}`;
  const familyPresentId = `tnt_iso_t275_fam_present_${Date.now().toString(36)}`;
  const variantId = `tnt_iso_t275_var_${Date.now().toString(36)}`;
  const contractTypeId = `tnt_iso_t275_ctype_${Date.now().toString(36)}`;
  const contractClauseId = `tnt_iso_t275_cl_${Date.now().toString(36)}`;
  const predecessorContractId = `tnt_iso_t275_pred_${Date.now().toString(36)}`;
  const renewalId = `tnt_iso_t275_rn_${Date.now().toString(36)}`;
  const webhookId = `tnt_iso_t275_wh_${Date.now().toString(36)}`;
  const signerId = `tnt_iso_t275_sn_${Date.now().toString(36)}`;

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    world = await createTestWorld("t275");
    client = await loginClient(server.baseUrl, world.userEmail, world.password);

    // 1) Klausel-Familien: eine die FEHLT (→ missing_required Deviation)
    //    und eine die DA ist (→ liefert obligations via Variant-Templates).
    await db.insert(clauseFamiliesTable).values([
      { id: familyMissingId, name: "Force Majeure (Test)", description: "Pflicht-Familie, die im Vertrag fehlt" },
      { id: familyPresentId, name: "SLA (Test)", description: "Familie mit Obligation-Templates" },
    ]);

    // 2) Klausel-Variante mit obligationTemplates → deriveObligations wird
    //    daraus genau eine pending Obligation mit dueOffsetDays=30 ableiten.
    await db.insert(clauseVariantsTable).values({
      id: variantId,
      familyId: familyPresentId,
      name: "SLA Standard",
      severity: "medium",
      severityScore: 3,
      summary: "SLA-Reporting monatlich an den Kunden senden.",
      body: "Anbieter erstellt einen monatlichen SLA-Report und stellt ihn dem Kunden bereit.",
      tone: "standard",
      obligationTemplates: [
        {
          type: "deliverable",
          description: "Monatlicher SLA-Report",
          dueOffsetDays: 30,
          recurrence: "monthly",
          ownerRole: "Account Executive",
        },
      ],
    });

    // 3) ContractType, der BEIDE Familien als Pflicht markiert.
    //    Da nur familyPresent im Vertrag steckt, muss familyMissing eine
    //    'missing_required' Deviation produzieren.
    await db.insert(contractTypesTable).values({
      id: contractTypeId,
      tenantId: world.tenantId,
      code: `t275_${world.runId}`,
      name: "T275 Test Contract Type",
      mandatoryClauseFamilyIds: [familyMissingId, familyPresentId],
      forbiddenClauseFamilyIds: [],
      active: true,
    });

    // 4) Contract aus dem TestWorld auf signing-bereit verdrahten:
    //    - tenantId/companyId/brandId/accountId, damit Renewal-Lookup +
    //      indexContractPrecedents (Tenant-Pin) sauber funktionieren.
    //    - contractTypeId für die Deviation-Evaluation.
    //    - predecessorContractId zeigt auf einen separaten Stub-Vertrag,
    //      damit das Renewal-Anchoring greift.
    await db.update(contractsTable).set({
      tenantId: world.tenantId,
      companyId: world.companyId,
      brandId: world.brandId,
      accountId: world.accountId,
      contractTypeId,
      predecessorContractId,
      valueAmount: "100000",
      valueCurrency: "EUR",
    }).where(eq(contractsTable.id, world.contractId));

    // 5) Klausel am Zielvertrag mit familyPresent + activeVariantId.
    await db.insert(contractClausesTable).values({
      id: contractClauseId,
      contractId: world.contractId,
      family: "SLA",
      familyId: familyPresentId,
      variant: "Standard",
      activeVariantId: variantId,
      severity: "medium",
      summary: "SLA-Standardklausel mit monatlichem Reporting.",
    });

    // 6) Vorvertrag (auf einem fremden Deal-Stub, damit die "genau ein
    //    Vertrag pro Deal"-Logik in maybeCompletePackageAndCreateOC nicht
    //    bricht). Für den Renewal-Lookup reicht die Vertrag-Row.
    await db.insert(contractsTable).values({
      id: predecessorContractId,
      dealId: `${world.runId}_pred_dl_stub`,
      title: "T275 Predecessor Contract",
      status: "signed",
      version: 1,
      riskLevel: "low",
      template: "standard",
      tenantId: world.tenantId,
      companyId: world.companyId,
      brandId: world.brandId,
      accountId: world.accountId,
    });

    // 7) Offene Renewal-Opportunity am Vorvertrag → muss beim Signieren
    //    des Folgevertrags automatisch auf 'won' gesetzt werden.
    await db.insert(renewalOpportunitiesTable).values({
      id: renewalId,
      tenantId: world.tenantId,
      contractId: predecessorContractId,
      accountId: world.accountId,
      brandId: world.brandId,
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      noticeDeadline: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      riskScore: 50,
      riskFactors: [],
      status: "in_progress",
      valueAmount: "100000",
      currency: "EUR",
    });

    // 8) Webhook-Subscription auf 'contract.signed'. Wir umgehen den
    //    Admin-CRUD-Endpoint und insertieren direkt — emitEvent prüft
    //    nur active+events, nicht die URL-Sicherheit. Die URL-Auflösung
    //    schlägt im Background-Dispatch fehl, das ist für diesen Test
    //    egal: wir prüfen nur, dass die delivery-Row enqueued wurde.
    await db.insert(webhooksTable).values({
      id: webhookId,
      tenantId: world.tenantId,
      url: "https://hooks.invalid.dealflow-test.example/contract-signed",
      events: ["contract.signed"],
      secret: "t275-secret",
      active: true,
      description: "Test #275 webhook",
    });

    // 9) Ein einzelner Signer am bereits 'in_progress' Paket. Wenn er
    //    unterschreibt, sind alle aktiven Signer signed → maybeComplete
    //    feuert.
    await db.insert(signersTable).values({
      id: signerId,
      packageId: world.signaturePackageId,
      name: `Signer ${world.runId}`,
      email: `signer-${world.runId}@example.test`,
      role: "Buyer",
      order: 1,
      status: "pending",
      sentAt: new Date(),
    });
  });

  after(async () => {
    // Reihenfolge: erst abgeleitete Daten, dann Stamm-Rows.
    await db.delete(legalPrecedentsTable).where(
      eq(legalPrecedentsTable.contractId, world.contractId),
    );
    await db.delete(obligationsTable).where(
      inArray(obligationsTable.contractId, [world.contractId, predecessorContractId]),
    );
    await db.delete(clauseDeviationsTable).where(
      inArray(clauseDeviationsTable.contractId, [world.contractId, predecessorContractId]),
    );
    await db.delete(contractClausesTable).where(
      eq(contractClausesTable.id, contractClauseId),
    );
    await db.delete(renewalOpportunitiesTable).where(
      eq(renewalOpportunitiesTable.id, renewalId),
    );
    await db.delete(webhookDeliveriesTable).where(
      eq(webhookDeliveriesTable.webhookId, webhookId),
    );
    await db.delete(webhooksTable).where(eq(webhooksTable.id, webhookId));
    await db.delete(signersTable).where(eq(signersTable.id, signerId));
    await db.delete(contractsTable).where(eq(contractsTable.id, predecessorContractId));
    await db.delete(contractTypesTable).where(eq(contractTypesTable.id, contractTypeId));
    await db.delete(clauseVariantsTable).where(eq(clauseVariantsTable.id, variantId));
    await db.delete(clauseFamiliesTable).where(
      inArray(clauseFamiliesTable.id, [familyMissingId, familyPresentId]),
    );
    // Audit/Timeline-Spuren, die maybeComplete für den Vertrag/das Paket
    // hinterlässt, gehören zur TestWorld und werden über destroyTestWorlds
    // (timeline_events.dealId-Filter, audit_log.id-Filter) und unsere
    // gezielten Filter unten weggeräumt.
    await db.delete(auditLogTable).where(and(
      eq(auditLogTable.entityType, "signature_package"),
      eq(auditLogTable.entityId, world.signaturePackageId),
    )!);
    await db.delete(auditLogTable).where(and(
      eq(auditLogTable.entityType, "renewal_opportunity"),
      eq(auditLogTable.entityId, renewalId),
    )!);
    await db.delete(timelineEventsTable).where(eq(timelineEventsTable.dealId, world.dealId));
    await destroyTestWorlds(world);
    await server.close();
  });

  it("signing the last signer drives the full contract→signed→obligations chain", async () => {
    // Snapshot: vor dem Signieren existieren genau 1 OC + 1 Vertrag im Deal
    // (beide aus createTestWorld). Der Pfad darf NICHTS davon vermehren.
    const ocsBefore = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.dealId, world.dealId));
    assert.equal(ocsBefore.length, 1, "precondition: testworld seeds exactly one OC");

    const contractsBefore = await db.select().from(contractsTable)
      .where(eq(contractsTable.dealId, world.dealId));
    assert.equal(contractsBefore.length, 1, "precondition: testworld seeds exactly one contract");

    // Akt: letzter (einziger) Signer unterschreibt.
    const r = await client.post(`/api/signers/${signerId}/sign`);
    assert.equal(r.status, 200, `sign failed: ${JSON.stringify(r.body)}`);

    // (1) Signature-Package ist 'completed'.
    const [pkg] = await db.select().from(signaturePackagesTable)
      .where(eq(signaturePackagesTable.id, world.signaturePackageId));
    assert.equal(pkg!.status, "completed", "package must transition to completed");

    // (2) Vertrag ist 'signed' und signedAt ist gesetzt.
    const [ctr] = await db.select().from(contractsTable)
      .where(eq(contractsTable.id, world.contractId));
    assert.equal(ctr!.status, "signed", "contract must transition to signed");
    assert.ok(ctr!.signedAt, "signedAt must be set on signing");

    // (3) Obligations wurden abgeleitet (source='derived', genau ein
    //     Template hängt an unserer Variante).
    const obligations = await db.select().from(obligationsTable)
      .where(eq(obligationsTable.contractId, world.contractId));
    assert.ok(obligations.length >= 1, "at least one obligation must be derived");
    const derived = obligations.filter(o => o.source === "derived");
    assert.equal(derived.length, 1, "exactly one derived obligation per template");
    assert.equal(derived[0]!.tenantId, world.tenantId, "obligation must inherit tenant");
    assert.equal(derived[0]!.type, "deliverable");
    assert.equal(derived[0]!.status, "pending");

    // (4) Deviations: familyMissing fehlt → genau eine 'missing_required'
    //     Deviation. (Variant-Path liefert hier nichts, weil kein Playbook
    //     gesetzt ist — bewusst so im Setup gehalten.)
    const deviations = await db.select().from(clauseDeviationsTable)
      .where(eq(clauseDeviationsTable.contractId, world.contractId));
    assert.ok(deviations.length >= 1, "at least one deviation must be created");
    const missing = deviations.filter(d => d.deviationType === "missing_required");
    assert.equal(missing.length, 1, "exactly one missing_required deviation");
    assert.equal(missing[0]!.familyId, familyMissingId);
    assert.equal(missing[0]!.tenantId, world.tenantId);

    // (5) Renewal am Vorvertrag wurde automatisch 'won'.
    const [renewal] = await db.select().from(renewalOpportunitiesTable)
      .where(eq(renewalOpportunitiesTable.id, renewalId));
    assert.equal(renewal!.status, "won", "renewal must auto-resolve to won");
    assert.equal(renewal!.decidedBy, "system", "decidedBy must be 'system'");
    assert.ok(renewal!.decidedAt, "decidedAt must be set on renewal closure");

    // (6) Webhook-Delivery für 'contract.signed' wurde enqueued. emitEvent
    //     wird in maybeComplete als void-Promise abgesetzt — wir warten
    //     kurz, bis die Row sichtbar ist (Polling, max 2s).
    const deadline = Date.now() + 2000;
    let deliveries: typeof webhookDeliveriesTable.$inferSelect[] = [];
    while (Date.now() < deadline) {
      deliveries = await db.select().from(webhookDeliveriesTable).where(and(
        eq(webhookDeliveriesTable.webhookId, webhookId),
        eq(webhookDeliveriesTable.event, "contract.signed"),
      )!);
      if (deliveries.length > 0) break;
      await new Promise<void>((res) => setTimeout(res, 50));
    }
    assert.equal(deliveries.length, 1, "exactly one contract.signed delivery enqueued");
    assert.equal(deliveries[0]!.tenantId, world.tenantId);
    const payload = deliveries[0]!.payload as { event: string; data: { dealId: string; signaturePackageId: string } };
    assert.equal(payload.event, "contract.signed");
    assert.equal(payload.data.dealId, world.dealId);
    assert.equal(payload.data.signaturePackageId, world.signaturePackageId);

    // (7) Auf diesem Pfad entsteht KEINE neue OC und KEIN neuer Vertrag
    //     im Deal — beide Counts bleiben stabil bei 1.
    const ocsAfter = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.dealId, world.dealId));
    assert.equal(ocsAfter.length, 1, "signature completion must NOT create a new OC");
    assert.equal(ocsAfter[0]!.id, ocsBefore[0]!.id, "OC identity must stay the same");

    const contractsAfter = await db.select().from(contractsTable)
      .where(eq(contractsTable.dealId, world.dealId));
    assert.equal(contractsAfter.length, 1, "signature completion must NOT create a new contract");
    assert.equal(contractsAfter[0]!.id, world.contractId, "contract identity must stay the same");
  });
});

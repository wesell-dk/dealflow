import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, and } from "drizzle-orm";
import {
  db,
  pool,
  aiRecommendationsTable,
  aiFeedbackTable,
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
import { recordRecommendation } from "../src/lib/ai/recommendations.js";

interface NegotiationStat {
  family: string;
  recommendedCount: number;
  acceptedCount: number;
  acceptanceRate: number | null;
  acceptedDe: number;
  acceptedEn: number;
  lastAcceptedAt: string | null;
}

/**
 * Task #279: Lerneffekt fuer den AI-Negotiation-Copilot. Wenn der Anwender
 * "Counter uebernehmen" klickt, schreibt der Server eine ai_feedback-Zeile,
 * markiert die Recommendation als accepted (sofern noch pending) und
 * aggregiert das Ergebnis pro Klauselfamilie.
 */
describe("ai negotiation counter acceptance learning (Task #279)", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let worldB: TestWorld;
  let alice: AuthedClient;
  let bob: AuthedClient;
  const createdRecIds: string[] = [];
  const createdClauseIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    worldA = await createTestWorld("nego_acc_a");
    worldB = await createTestWorld("nego_acc_b");
    alice = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    bob = await loginClient(server.baseUrl, worldB.userEmail, worldB.password);
  });

  after(async () => {
    if (createdRecIds.length > 0) {
      await db.delete(aiFeedbackTable)
        .where(inArray(aiFeedbackTable.recommendationId, createdRecIds));
      await db.delete(aiRecommendationsTable)
        .where(inArray(aiRecommendationsTable.id, createdRecIds));
    }
    if (createdClauseIds.length > 0) {
      await db.delete(contractClausesTable)
        .where(inArray(contractClausesTable.id, createdClauseIds));
    }
    await destroyTestWorlds(worldA, worldB);
    await server.close();
    await pool.end();
  });

  async function seedClause(
    world: TestWorld,
    suffix: string,
    family: string,
  ): Promise<string> {
    const id = `${world.runId}_clause_${suffix}`;
    await db.insert(contractClausesTable).values({
      id,
      contractId: world.contractId,
      family,
      variant: "Standard",
      severity: "low",
      summary: `${family} test clause`,
    });
    createdClauseIds.push(id);
    return id;
  }

  async function seedNegotiationRec(
    world: TestWorld,
    suggestion: { clauseStrategies: Array<{ family: string; contractClauseId: string }> },
  ): Promise<string> {
    const id = await recordRecommendation({
      tenantId: world.tenantId,
      promptKey: "contract.negotiation",
      suggestion,
      confidence: 0.8,
      entityType: "contract",
      entityId: world.contractId,
    });
    createdRecIds.push(id);
    return id;
  }

  it("PATCH /contract-clauses/:id with AI-Counter fields writes ai_feedback row and flips recommendation to accepted", async () => {
    const clauseId = await seedClause(worldA, "liab1", "Liability");
    const recId = await seedNegotiationRec(worldA, {
      clauseStrategies: [
        { family: "Liability", contractClauseId: clauseId },
      ],
    });
    const res = await alice.patch(`/api/v1/contract-clauses/${clauseId}`, {
      editedBody: "Counter-Liability-Body",
      editedReason: "AI Negotiation Copilot · DE Counter",
      aiRecommendationId: recId,
      aiCounterFamily: "Liability",
      aiCounterLocale: "de",
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Recommendation muss auf accepted gekippt sein.
    const [rec] = await db.select().from(aiRecommendationsTable)
      .where(eq(aiRecommendationsTable.id, recId));
    assert.equal(rec!.status, "accepted");
    // Feedback-Zeile mit Counter-Metadata.
    const fbRows = await db.select().from(aiFeedbackTable)
      .where(eq(aiFeedbackTable.recommendationId, recId));
    assert.equal(fbRows.length, 1);
    const fb = fbRows[0]!;
    assert.equal(fb.tenantId, worldA.tenantId);
    assert.equal(fb.promptKey, "contract.negotiation");
    assert.equal(fb.outcome, "accepted");
    const md = fb.metadata as { kind: string; family: string; locale: string; contractClauseId: string };
    assert.equal(md.kind, "negotiation_counter");
    assert.equal(md.family, "Liability");
    assert.equal(md.locale, "de");
    assert.equal(md.contractClauseId, clauseId);
    // Audit-Eintrag fuer die Akzeptanz.
    const audits = await db.select().from(auditLogTable).where(and(
      eq(auditLogTable.entityType, "ai_recommendation"),
      eq(auditLogTable.entityId, recId),
      eq(auditLogTable.action, "ai_negotiation_counter_accepted"),
    ));
    assert.ok(audits.length >= 1, "audit log entry expected");
  });

  it("PATCH without AI-Counter fields leaves recommendation untouched (no implicit tracking)", async () => {
    const clauseId = await seedClause(worldA, "liab2", "Liability");
    const recId = await seedNegotiationRec(worldA, {
      clauseStrategies: [
        { family: "Liability", contractClauseId: clauseId },
      ],
    });
    const res = await alice.patch(`/api/v1/contract-clauses/${clauseId}`, {
      editedBody: "Manual edit, kein Counter-Klick",
      editedReason: "Manuell",
    });
    assert.equal(res.status, 200);
    const [rec] = await db.select().from(aiRecommendationsTable)
      .where(eq(aiRecommendationsTable.id, recId));
    assert.equal(rec!.status, "pending");
    const fbRows = await db.select().from(aiFeedbackTable)
      .where(eq(aiFeedbackTable.recommendationId, recId));
    assert.equal(fbRows.length, 0);
  });

  it("GET /ai-recommendations/_negotiation-acceptance aggregates per family with locale split", async () => {
    const clauseLiab = await seedClause(worldA, "agg_liab", "Liability");
    const clauseTerm = await seedClause(worldA, "agg_term", "Termination");
    // Drei Negotiation-Runs: jeder schlaegt die beiden Familien einmal vor.
    // Erwartet: recommendedCount=3 pro Familie. Wir akzeptieren 2 von 3
    // bei Liability (1x DE, 1x EN) und 0 bei Termination.
    const recIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await seedNegotiationRec(worldA, {
        clauseStrategies: [
          { family: "Liability", contractClauseId: clauseLiab },
          { family: "Termination", contractClauseId: clauseTerm },
        ],
      });
      recIds.push(id);
    }
    // Akzeptanz #1: Liability DE.
    let r = await alice.patch(`/api/v1/contract-clauses/${clauseLiab}`, {
      editedBody: "DE counter",
      aiRecommendationId: recIds[0],
      aiCounterFamily: "Liability",
      aiCounterLocale: "de",
    });
    assert.equal(r.status, 200);
    // Akzeptanz #2: Liability EN (zweite Recommendation).
    r = await alice.patch(`/api/v1/contract-clauses/${clauseLiab}`, {
      editedBody: "EN counter",
      aiRecommendationId: recIds[1],
      aiCounterFamily: "Liability",
      aiCounterLocale: "en",
    });
    assert.equal(r.status, 200);

    const stats = (await alice.get("/api/v1/ai-recommendations/_negotiation-acceptance"))
      .body as NegotiationStat[];
    const liab = stats.find((s) => s.family === "Liability");
    const term = stats.find((s) => s.family === "Termination");
    assert.ok(liab, "Liability stat must exist");
    assert.ok(term, "Termination stat must exist");
    // recommendedCount enthaelt ggf. auch Vorschlaege aus den frueheren
    // Tests in dieser Suite — daher untere Schranken statt Gleichheit.
    assert.ok(liab!.recommendedCount >= 3, `liab recommended >= 3, got ${liab!.recommendedCount}`);
    assert.ok(term!.recommendedCount >= 3, `term recommended >= 3, got ${term!.recommendedCount}`);
    assert.ok(liab!.acceptedCount >= 2, `liab accepted >= 2, got ${liab!.acceptedCount}`);
    assert.equal(term!.acceptedCount, 0);
    assert.ok((liab!.acceptedDe ?? 0) >= 1);
    assert.ok((liab!.acceptedEn ?? 0) >= 1);
    assert.ok(liab!.acceptanceRate !== null && liab!.acceptanceRate > 0);
    assert.equal(term!.acceptanceRate, 0);
  });

  it("GET /ai-recommendations/_negotiation-acceptance is tenant-scoped", async () => {
    // Bob darf NICHTS aus Alice's Tenant sehen, auch wenn Familien-Namen
    // identisch sind (Liability ist eine generische Bezeichnung).
    const bobStats = (await bob.get("/api/v1/ai-recommendations/_negotiation-acceptance"))
      .body as NegotiationStat[];
    // Bob hat in dieser Suite keine eigenen Negotiation-Empfehlungen erzeugt,
    // also muss die Antwort leer sein.
    assert.equal(bobStats.length, 0,
      `bob must not see any negotiation acceptance stats from tenant A: ${JSON.stringify(bobStats)}`);
  });

  it("PATCH cross-tenant rejects AI-Counter tracking and skips feedback row", async () => {
    const clauseId = await seedClause(worldA, "cross", "Liability");
    const recId = await seedNegotiationRec(worldA, {
      clauseStrategies: [{ family: "Liability", contractClauseId: clauseId }],
    });
    const res = await bob.patch(`/api/v1/contract-clauses/${clauseId}`, {
      editedBody: "evil cross-tenant edit",
      aiRecommendationId: recId,
      aiCounterFamily: "Liability",
      aiCounterLocale: "de",
    });
    // Eines von beiden ist akzeptabel; entscheidend ist: NICHT 200, also wird
    // weder die Klausel veraendert noch ein ai_feedback-Lerneintrag erzeugt.
    assert.ok(res.status === 403 || res.status === 404,
      `expected 403/404 cross-tenant rejection, got ${res.status}`);
    const [rec] = await db.select().from(aiRecommendationsTable)
      .where(eq(aiRecommendationsTable.id, recId));
    assert.equal(rec!.status, "pending");
    const fb = await db.select().from(aiFeedbackTable)
      .where(eq(aiFeedbackTable.recommendationId, recId));
    assert.equal(fb.length, 0);
  });
});

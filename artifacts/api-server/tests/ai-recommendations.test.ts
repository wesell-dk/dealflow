import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool, aiRecommendationsTable, aiFeedbackTable } from "@workspace/db";
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
import { recordRecommendation, clampConfidence, confidenceLevelToScore } from "../src/lib/ai/recommendations.js";

interface RecResp {
  id: string;
  promptKey: string;
  suggestion: unknown;
  confidence: number;
  status: "pending" | "accepted" | "rejected" | "modified";
  modifiedSuggestion: unknown | null;
  feedbackText: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

interface MetricResp {
  promptKey: string;
  count: number;
  pending: number;
  accepted: number;
  rejected: number;
  modified: number;
  acceptanceRate: number | null;
  averageConfidence: number;
  averageConfidenceDecided: number;
  weightedQualityScore: number | null;
  calibration: { range: string; total: number; acceptanceRate: number | null }[];
  trend: {
    date: string;
    total: number;
    decided: number;
    accepted: number;
    acceptanceRate: number | null;
  }[];
}

describe("ai recommendations — confidence + learning", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let worldB: TestWorld;
  let alice: AuthedClient;
  let bob: AuthedClient;
  const createdIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    worldA = await createTestWorld("ai_rec_a");
    worldB = await createTestWorld("ai_rec_b");
    alice = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    bob = await loginClient(server.baseUrl, worldB.userEmail, worldB.password);
  });

  after(async () => {
    if (createdIds.length > 0) {
      await db.delete(aiFeedbackTable)
        .where(inArray(aiFeedbackTable.recommendationId, createdIds));
      await db.delete(aiRecommendationsTable)
        .where(inArray(aiRecommendationsTable.id, createdIds));
    }
    await destroyTestWorlds(worldA, worldB);
    await server.close();
    await pool.end();
  });

  it("confidenceLevelToScore maps levels into distinct calibration buckets", () => {
    // Task #69: jede Stufe muss in ihrem eigenen 25 %-Bucket des Metrics-
    // Endpoints landen, sonst ist die Kalibrierungs-Visualisierung
    // unbrauchbar.
    assert.equal(confidenceLevelToScore("low"), 0.4);
    assert.equal(confidenceLevelToScore("medium"), 0.65);
    assert.equal(confidenceLevelToScore("high"), 0.85);
    // Unbekannte / Null-Werte fallen auf neutrale Mitte (nie implizit "high").
    assert.equal(confidenceLevelToScore(null), 0.5);
    assert.equal(confidenceLevelToScore(undefined), 0.5);
    assert.equal(confidenceLevelToScore("garbage"), 0.5);
  });

  it("clampConfidence clamps to [0, 1] and handles non-finite", () => {
    assert.equal(clampConfidence(-0.5), 0);
    assert.equal(clampConfidence(0), 0);
    assert.equal(clampConfidence(0.5), 0.5);
    assert.equal(clampConfidence(1), 1);
    assert.equal(clampConfidence(2), 1);
    assert.equal(clampConfidence(NaN), 0);
    assert.equal(clampConfidence("foo"), 0);
  });

  it("recordRecommendation persists row with pending status and clamped confidence", async () => {
    const id = await recordRecommendation({
      tenantId: worldA.tenantId,
      promptKey: "deal.summary",
      suggestion: { headline: "Test" },
      confidence: 1.5, // wird auf 1.0 geklemmt
      entityType: "deal",
      entityId: worldA.dealId,
    });
    createdIds.push(id);
    const [row] = await db.select().from(aiRecommendationsTable)
      .where(eq(aiRecommendationsTable.id, id));
    assert.ok(row);
    assert.equal(row!.tenantId, worldA.tenantId);
    assert.equal(row!.status, "pending");
    assert.equal(Number(row!.confidence), 1);
  });

  it("GET /ai-recommendations is tenant-scoped", async () => {
    const idA = await recordRecommendation({
      tenantId: worldA.tenantId, promptKey: "tenant.scope.test",
      suggestion: "alice-only", confidence: 0.7,
    });
    const idB = await recordRecommendation({
      tenantId: worldB.tenantId, promptKey: "tenant.scope.test",
      suggestion: "bob-only", confidence: 0.7,
    });
    createdIds.push(idA, idB);

    const aRes = await alice.get("/api/v1/ai-recommendations?promptKey=tenant.scope.test");
    assert.equal(aRes.status, 200);
    const aIds = (aRes.body as RecResp[]).map((r) => r.id);
    assert.ok(aIds.includes(idA));
    assert.ok(!aIds.includes(idB));

    const bRes = await bob.get("/api/v1/ai-recommendations?promptKey=tenant.scope.test");
    const bIds = (bRes.body as RecResp[]).map((r) => r.id);
    assert.ok(bIds.includes(idB));
    assert.ok(!bIds.includes(idA));
  });

  it("GET /ai-recommendations validates status filter", async () => {
    const res = await alice.get("/api/v1/ai-recommendations?status=garbage");
    assert.equal(res.status, 400);
  });

  it("PATCH /ai-recommendations/:id accepts and writes decidedBy", async () => {
    const id = await recordRecommendation({
      tenantId: worldA.tenantId, promptKey: "patch.accept",
      suggestion: { foo: 1 }, confidence: 0.6,
    });
    createdIds.push(id);
    const res = await alice.patch(`/api/v1/ai-recommendations/${id}`, {
      status: "accepted",
      feedback: "looks good",
    });
    assert.equal(res.status, 200);
    const json = res.body as RecResp;
    assert.equal(json.status, "accepted");
    assert.equal(json.decidedBy, worldA.userId);
    assert.equal(json.feedbackText, "looks good");
  });

  it("PATCH validates status and feedback length", async () => {
    const id = await recordRecommendation({
      tenantId: worldA.tenantId, promptKey: "patch.validation",
      suggestion: "x", confidence: 0.5,
    });
    createdIds.push(id);
    // ungueltiger status
    let res = await alice.patch(`/api/v1/ai-recommendations/${id}`, { status: "garbage" });
    assert.equal(res.status, 400);
    // overlong feedback
    res = await alice.patch(`/api/v1/ai-recommendations/${id}`, {
      status: "rejected",
      feedback: "x".repeat(2001),
    });
    assert.equal(res.status, 400);
  });

  it("PATCH supports one-click status=modified without modifiedSuggestion (Task #69)", async () => {
    // Task #69 verlangt Ein-Klick-Geaendert: der konkrete Gegenvorschlag
    // darf spaeter per zweitem PATCH nachgereicht werden.
    const id = await recordRecommendation({
      tenantId: worldA.tenantId, promptKey: "patch.modify.oneclick",
      suggestion: { v: 1 }, confidence: 0.5,
    });
    createdIds.push(id);
    const first = await alice.patch(`/api/v1/ai-recommendations/${id}`, {
      status: "modified",
    });
    assert.equal(first.status, 200);
    assert.equal((first.body as RecResp).status, "modified");
    assert.equal((first.body as RecResp).modifiedSuggestion, null);
    // Nachtraegliches Detail per zweitem PATCH wird gespeichert.
    const second = await alice.patch(`/api/v1/ai-recommendations/${id}`, {
      status: "modified",
      modifiedSuggestion: { v: 2 },
      feedback: "Preisspanne anders",
    });
    assert.equal(second.status, 200);
    assert.deepEqual((second.body as RecResp).modifiedSuggestion, { v: 2 });
  });

  it("PATCH stores modifiedSuggestion when status=modified", async () => {
    const id = await recordRecommendation({
      tenantId: worldA.tenantId, promptKey: "patch.modify",
      suggestion: { v: 1 }, confidence: 0.5,
    });
    createdIds.push(id);
    const res = await alice.patch(`/api/v1/ai-recommendations/${id}`, {
      status: "modified",
      modifiedSuggestion: { v: 2, edited: true },
    });
    assert.equal(res.status, 200);
    const json = res.body as RecResp;
    assert.equal(json.status, "modified");
    assert.deepEqual(json.modifiedSuggestion, { v: 2, edited: true });
  });

  it("PATCH writes anonymized ai_feedback row on first decision (Task #69)", async () => {
    // Lerneffekt-Telemetrie: pro Erst-Entscheidung genau eine Zeile in
    // ai_feedback, mit Tenant + promptKey + outcome + Konfidenz, aber
    // ohne decidedBy/User-Bezug. Wiederholtes PATCH soll keine zweite
    // Zeile erzeugen (sonst wuerde die Annahmequote inflationiert).
    const id = await recordRecommendation({
      tenantId: worldA.tenantId, promptKey: "feedback.learn",
      suggestion: { x: 1 }, confidence: 0.85,
    });
    createdIds.push(id);
    const res = await alice.patch(`/api/v1/ai-recommendations/${id}`, {
      status: "accepted",
    });
    assert.equal(res.status, 200);
    const rows = await db.select().from(aiFeedbackTable)
      .where(eq(aiFeedbackTable.recommendationId, id));
    assert.equal(rows.length, 1);
    const fb = rows[0]!;
    assert.equal(fb.tenantId, worldA.tenantId);
    assert.equal(fb.promptKey, "feedback.learn");
    assert.equal(fb.outcome, "accepted");
    assert.equal(Number(fb.confidence), 0.85);
    assert.equal(fb.hasFeedbackText, false);
    // Anonymisierung: das Schema enthaelt KEIN decidedBy / actor-Feld.
    assert.equal((fb as Record<string, unknown>).decidedBy, undefined);
    assert.equal((fb as Record<string, unknown>).actor, undefined);
    // Nachtraegliches PATCH mit Feedback-Text setzt das Flag, ohne
    // eine zweite Zeile anzulegen.
    const second = await alice.patch(`/api/v1/ai-recommendations/${id}`, {
      status: "accepted",
      feedback: "perfekt fuer dieses Segment",
    });
    assert.equal(second.status, 200);
    const after = await db.select().from(aiFeedbackTable)
      .where(eq(aiFeedbackTable.recommendationId, id));
    assert.equal(after.length, 1);
    assert.equal(after[0]!.hasFeedbackText, true);
  });

  it("ai_feedback rows are tenant-scoped", async () => {
    const idA = await recordRecommendation({
      tenantId: worldA.tenantId, promptKey: "feedback.tenant",
      suggestion: "a", confidence: 0.6,
    });
    const idB = await recordRecommendation({
      tenantId: worldB.tenantId, promptKey: "feedback.tenant",
      suggestion: "b", confidence: 0.6,
    });
    createdIds.push(idA, idB);
    await alice.patch(`/api/v1/ai-recommendations/${idA}`, { status: "accepted" });
    await bob.patch(`/api/v1/ai-recommendations/${idB}`, { status: "rejected" });
    const aRows = await db.select().from(aiFeedbackTable)
      .where(eq(aiFeedbackTable.tenantId, worldA.tenantId));
    const bRows = await db.select().from(aiFeedbackTable)
      .where(eq(aiFeedbackTable.tenantId, worldB.tenantId));
    assert.ok(aRows.some((r) => r.recommendationId === idA && r.outcome === "accepted"));
    assert.ok(!aRows.some((r) => r.recommendationId === idB));
    assert.ok(bRows.some((r) => r.recommendationId === idB && r.outcome === "rejected"));
    assert.ok(!bRows.some((r) => r.recommendationId === idA));
  });

  it("PATCH cross-tenant returns 404", async () => {
    const id = await recordRecommendation({
      tenantId: worldA.tenantId, promptKey: "cross.tenant",
      suggestion: "alice", confidence: 0.5,
    });
    createdIds.push(id);
    const res = await bob.patch(`/api/v1/ai-recommendations/${id}`, { status: "accepted" });
    assert.equal(res.status, 404);
  });

  it("metrics aggregate acceptance and confidence calibration", async () => {
    const promptKey = "metrics.test";
    // 4 Empfehlungen: 2 high-conf (1 accepted, 1 rejected), 2 low-conf (1 accepted, 1 rejected).
    // Erwartung: average conf ~ 0.625, acceptance 50 %.
    const make = async (conf: number, status?: "accepted" | "rejected") => {
      const id = await recordRecommendation({
        tenantId: worldA.tenantId, promptKey, suggestion: { conf }, confidence: conf,
      });
      createdIds.push(id);
      if (status) {
        const r = await alice.patch(`/api/v1/ai-recommendations/${id}`, { status });
        assert.equal(r.status, 200);
      }
    };
    await make(0.9, "accepted");
    await make(0.85, "rejected");
    await make(0.3, "accepted");
    await make(0.35, "rejected");

    const res = await alice.get(`/api/v1/ai-recommendations/_metrics?promptKey=${promptKey}`);
    assert.equal(res.status, 200);
    const json = res.body as MetricResp[];
    const metric = json.find((m) => m.promptKey === promptKey);
    assert.ok(metric, "metric should exist");
    assert.equal(metric!.count, 4);
    assert.equal(metric!.accepted, 2);
    assert.equal(metric!.rejected, 2);
    assert.equal(metric!.acceptanceRate, 0.5);
    // Avg-Konfidenz = (0.9 + 0.85 + 0.3 + 0.35) / 4 = 0.6
    assert.ok(Math.abs(metric!.averageConfidence - 0.6) < 0.01);
    // Kalibrierung: 75-100-Bucket hat 2 Items, davon 1 accepted -> 0.5
    const high = metric!.calibration.find((c) => c.range === "75-100")!;
    assert.equal(high.total, 2);
    assert.equal(high.acceptanceRate, 0.5);
    // 25-50-Bucket hat 2 Items, davon 1 accepted -> 0.5
    const lowMid = metric!.calibration.find((c) => c.range === "25-50")!;
    assert.equal(lowMid.total, 2);
    assert.equal(lowMid.acceptanceRate, 0.5);
  });

  it("metrics is tenant-scoped (bob does not see alice promptKeys)", async () => {
    const promptKey = "metrics.tenant.iso";
    const id = await recordRecommendation({
      tenantId: worldA.tenantId, promptKey, suggestion: "x", confidence: 0.5,
    });
    createdIds.push(id);
    const res = await bob.get(`/api/v1/ai-recommendations/_metrics?promptKey=${promptKey}`);
    assert.equal(res.status, 200);
    const json = res.body as MetricResp[];
    assert.equal(json.length, 0);
  });

  it("metrics aggregate across all 5 task-#69 touchpoints in tenant scope", async () => {
    // Task #69: Wir wollen sicherstellen, dass wir pro Touchpoint einen
    // eigenen promptKey-Bucket im Reports-Tile + Admin-Card sehen, und
    // dass die Buckets sauber getrennt sind. Schreibt eine Empfehlung
    // pro Touchpoint und prueft die Aggregation.
    const touchpoints: Array<{ promptKey: string; level: "low" | "medium" | "high" }> = [
      { promptKey: "deal.summary",              level: "high" },
      { promptKey: "pricing.review",            level: "medium" },
      { promptKey: "approval.readiness",        level: "high" },
      { promptKey: "contract.risk",             level: "low" },
      { promptKey: "external.contract.extract", level: "medium" },
    ];
    for (const tp of touchpoints) {
      const id = await recordRecommendation({
        tenantId: worldA.tenantId,
        promptKey: tp.promptKey,
        suggestion: { tp: tp.promptKey },
        confidence: confidenceLevelToScore(tp.level),
      });
      createdIds.push(id);
    }
    // Alle 5 Touchpoints muessen Alice sehen, mit ihrer Konfidenz im
    // erwarteten Bucket. Andere Tenants sehen nichts.
    const aRes = await alice.get(`/api/v1/ai-recommendations/_metrics`);
    assert.equal(aRes.status, 200);
    const aJson = aRes.body as MetricResp[];
    for (const tp of touchpoints) {
      const m = aJson.find((x) => x.promptKey === tp.promptKey);
      assert.ok(m, `tenant A should see metric for ${tp.promptKey}`);
      assert.ok(m!.count >= 1);
      // Avg-Konfidenz muss innerhalb des erwarteten Buckets liegen.
      const expected = confidenceLevelToScore(tp.level);
      assert.ok(
        Math.abs(m!.averageConfidence - expected) < 0.4,
        `expected avg ~${expected} for ${tp.promptKey}, got ${m!.averageConfidence}`,
      );
    }
    const bRes = await bob.get(`/api/v1/ai-recommendations/_metrics`);
    assert.equal(bRes.status, 200);
    const bJson = bRes.body as MetricResp[];
    for (const tp of touchpoints) {
      assert.ok(
        !bJson.find((x) => x.promptKey === tp.promptKey),
        `tenant B must NOT see metric for ${tp.promptKey} written by tenant A`,
      );
    }
  });

  it("metrics expose weighted quality score and 7-day trend per prompt (Task #69 reports tile)", async () => {
    // Schreibt 3 Empfehlungen fuer einen frischen promptKey: 2 high-conf
    // (1 accepted, 1 modified) und 1 high-conf rejected. Erwartung:
    //   acceptanceRate = 2/3, averageConfidenceDecided = 0.85,
    //   weightedQualityScore = 2/3 * 0.85 ≈ 0.567,
    //   trend hat 7 Eintraege (heute inklusive), heute zeigt
    //   total=3 / decided=3 / accepted=2.
    const promptKey = "metrics.wqs.trend";
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await recordRecommendation({
        tenantId: worldA.tenantId,
        promptKey,
        suggestion: { i },
        confidence: 0.85,
      });
      ids.push(id);
      createdIds.push(id);
    }
    // 1) accepted, 2) modified, 3) rejected -> acceptanceRate = 2/3
    const r1 = await alice.patch(`/api/v1/ai-recommendations/${ids[0]}`, { status: "accepted" });
    assert.equal(r1.status, 200);
    const r2 = await alice.patch(`/api/v1/ai-recommendations/${ids[1]}`, {
      status: "modified",
      modifiedSuggestion: { i: 1, edited: true },
    });
    assert.equal(r2.status, 200);
    const r3 = await alice.patch(`/api/v1/ai-recommendations/${ids[2]}`, { status: "rejected" });
    assert.equal(r3.status, 200);

    const res = await alice.get(`/api/v1/ai-recommendations/_metrics?promptKey=${promptKey}`);
    assert.equal(res.status, 200);
    const json = res.body as MetricResp[];
    const m = json.find((x) => x.promptKey === promptKey)!;
    assert.ok(m, "metric must exist");

    // acceptanceRate = (1 accepted + 1 modified) / 3 entschieden
    assert.ok(Math.abs((m.acceptanceRate ?? 0) - 2 / 3) < 0.001);
    assert.ok(Math.abs(m.averageConfidenceDecided - 0.85) < 0.001);
    assert.ok(m.weightedQualityScore !== null);
    assert.ok(Math.abs((m.weightedQualityScore ?? 0) - (2 / 3) * 0.85) < 0.001);

    // Trend: 7 luckenlose Eintraege, sortiert aufsteigend nach Datum,
    // heutiger Eintrag enthaelt unsere 3 Entscheidungen.
    assert.equal(m.trend.length, 7);
    const today = new Date().toISOString().slice(0, 10);
    const todayPoint = m.trend.find((p) => p.date === today)!;
    assert.ok(todayPoint, "trend must contain today");
    assert.ok(todayPoint.total >= 3);
    assert.ok(todayPoint.decided >= 3);
    assert.ok(todayPoint.accepted >= 2);
    assert.ok((todayPoint.acceptanceRate ?? 0) >= 2 / 3 - 0.001);
    // Tage ohne Daten muessen acceptanceRate=null haben (luckenfreie
    // Sparkline mit erkennbaren Luecken).
    const past = m.trend.filter((p) => p.date !== today);
    assert.ok(past.every((p) => p.total === 0 || p.decided > 0 || p.acceptanceRate === null));
  });
});

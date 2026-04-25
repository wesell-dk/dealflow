import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { db, pool, aiRecommendationsTable } from "@workspace/db";
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
import { recordRecommendation, clampConfidence } from "../src/lib/ai/recommendations.js";

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
  calibration: { range: string; total: number; acceptanceRate: number | null }[];
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
      await db.delete(aiRecommendationsTable)
        .where(inArray(aiRecommendationsTable.id, createdIds));
    }
    await destroyTestWorlds(worldA, worldB);
    await server.close();
    await pool.end();
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

  it("PATCH validates status and modifiedSuggestion", async () => {
    const id = await recordRecommendation({
      tenantId: worldA.tenantId, promptKey: "patch.validation",
      suggestion: "x", confidence: 0.5,
    });
    createdIds.push(id);
    // ungueltiger status
    let res = await alice.patch(`/api/v1/ai-recommendations/${id}`, { status: "garbage" });
    assert.equal(res.status, 400);
    // status=modified ohne modifiedSuggestion
    res = await alice.patch(`/api/v1/ai-recommendations/${id}`, { status: "modified" });
    assert.equal(res.status, 400);
    // overlong feedback
    res = await alice.patch(`/api/v1/ai-recommendations/${id}`, {
      status: "rejected",
      feedback: "x".repeat(2001),
    });
    assert.equal(res.status, 400);
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
});

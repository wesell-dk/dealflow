import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import {
  createTestWorld,
  destroyTestWorlds,
  sweepStaleTestData,
  seedExtraDealflowItems,
  cleanupExtraDealflowItems,
  type TestWorld,
} from "./helpers";
import { loginClient, startTestServer, type AuthedClient, type TestServer } from "./server";

interface IdEntry {
  id: string;
}

interface DealResp extends IdEntry {
  name: string;
}

interface PipelineResp {
  stages: Array<{
    stage: string;
    deals: DealResp[];
    count: number;
  }>;
}

interface DashboardResp {
  openDealsCount: number;
  recentEvents: Array<{ id: string; dealId: string | null }>;
  stageBreakdown: Array<{ stage: string; count: number }>;
  openApprovals: number;
  signaturesPending: number;
  quotesAwaitingResponse: number;
}

interface PerformanceResp {
  byOwner: Array<{ ownerId: string; deals: number }>;
}

interface ActivityResp extends Array<{ id: string; dealId: string | null }> {}

interface AuditResp extends Array<{ id: string; entityId: string }> {}

function ids<T extends IdEntry>(rows: T[]): string[] {
  return rows.map((r) => r.id);
}

function ok(status: number) {
  return status >= 200 && status < 300;
}

describe("tenant isolation — list, report, audit, activity", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let worldB: TestWorld;
  let clientA: AuthedClient;
  let clientB: AuthedClient;

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    worldA = await createTestWorld("A");
    worldB = await createTestWorld("B");
    clientA = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    clientB = await loginClient(server.baseUrl, worldB.userEmail, worldB.password);
  });

  after(async () => {
    try {
      await destroyTestWorlds(worldA, worldB);
    } finally {
      if (server) await server.close();
      // Closing the pg pool lets `node --test` exit cleanly.
      await pool.end().catch(() => {});
    }
  });

  it("GET /deals — each tenant only sees own deals", async () => {
    const a = await clientA.get("/api/deals");
    const b = await clientB.get("/api/deals");
    assert.ok(ok(a.status), `A status ${a.status}`);
    assert.ok(ok(b.status), `B status ${b.status}`);
    const aIds = ids(a.body as DealResp[]);
    const bIds = ids(b.body as DealResp[]);
    assert.ok(aIds.includes(worldA.dealId), "A must see own deal");
    assert.ok(!aIds.includes(worldB.dealId), `A leaked B's deal: ${aIds.join(",")}`);
    assert.ok(bIds.includes(worldB.dealId), "B must see own deal");
    assert.ok(!bIds.includes(worldA.dealId), `B leaked A's deal: ${bIds.join(",")}`);
  });

  it("GET /deals/pipeline — each tenant only sees own deals", async () => {
    const a = await clientA.get("/api/deals/pipeline");
    const b = await clientB.get("/api/deals/pipeline");
    assert.ok(ok(a.status), `A status ${a.status}`);
    assert.ok(ok(b.status), `B status ${b.status}`);
    const aDeals = (a.body as PipelineResp).stages.flatMap((s) => s.deals);
    const bDeals = (b.body as PipelineResp).stages.flatMap((s) => s.deals);
    const aIds = ids(aDeals);
    const bIds = ids(bDeals);
    assert.ok(aIds.includes(worldA.dealId), "A pipeline must contain own deal");
    assert.ok(!aIds.includes(worldB.dealId), `A pipeline leaked B's deal`);
    assert.ok(bIds.includes(worldB.dealId), "B pipeline must contain own deal");
    assert.ok(!bIds.includes(worldA.dealId), `B pipeline leaked A's deal`);
  });

  it("GET /reports/dashboard — counts and recentEvents are tenant-scoped", async () => {
    const a = await clientA.get("/api/reports/dashboard");
    const b = await clientB.get("/api/reports/dashboard");
    assert.ok(ok(a.status), `A status ${a.status}`);
    assert.ok(ok(b.status), `B status ${b.status}`);
    const aBody = a.body as DashboardResp;
    const bBody = b.body as DashboardResp;
    const aEventIds = aBody.recentEvents.map((e) => e.id);
    const bEventIds = bBody.recentEvents.map((e) => e.id);

    // Each tenant must see its own deal-bound timeline event.
    assert.ok(aEventIds.includes(worldA.timelineEventId), "A dashboard missing own event");
    assert.ok(bEventIds.includes(worldB.timelineEventId), "B dashboard missing own event");

    // Strict isolation: never the other tenant's events.
    assert.ok(!aEventIds.includes(worldB.timelineEventId), "A dashboard leaked B event");
    assert.ok(!bEventIds.includes(worldA.timelineEventId), "B dashboard leaked A event");

    // NULL-dealId events from BOTH tenants must be filtered out — they have no
    // tenant binding and previously leaked across tenants.
    assert.ok(!aEventIds.includes(worldA.nullTimelineEventId), "A dashboard leaked NULL-dealId own event");
    assert.ok(!aEventIds.includes(worldB.nullTimelineEventId), "A dashboard leaked NULL-dealId B event");
    assert.ok(!bEventIds.includes(worldB.nullTimelineEventId), "B dashboard leaked NULL-dealId own event");
    assert.ok(!bEventIds.includes(worldA.nullTimelineEventId), "B dashboard leaked NULL-dealId A event");

    // Counts must include each tenant's own contributions.
    assert.ok(aBody.openApprovals >= 1, "A openApprovals must include own pending approval");
    assert.ok(aBody.signaturesPending >= 1, "A signaturesPending must include own in_progress pkg");
    assert.ok(aBody.quotesAwaitingResponse >= 1, "A quotesAwaiting must include own sent quote");

    // Idempotency baseline.
    const aOnly = await clientA.get("/api/reports/dashboard");
    assert.equal(
      (aOnly.body as DashboardResp).openApprovals,
      aBody.openApprovals,
      "dashboard not idempotent",
    );

    // Precision check for cross-tenant count leakage: insert N extra pending
    // approvals + in_progress signature packages + sent quotes against B's
    // deal, then re-fetch A's dashboard. A's counts MUST be unchanged. B's
    // counts MUST grow by exactly N. Without this delta check a regression
    // that double-counts across tenants could pass the loose ">=1" asserts.
    const N = 3;
    const extraIds = await seedExtraDealflowItems(worldB.dealId, worldB.userId, N);
    try {
      const a2 = await clientA.get("/api/reports/dashboard");
      const b2 = await clientB.get("/api/reports/dashboard");
      const a2Body = a2.body as DashboardResp;
      const b2Body = b2.body as DashboardResp;

      assert.equal(
        a2Body.openApprovals,
        aBody.openApprovals,
        `A openApprovals leaked B inserts (was ${aBody.openApprovals}, now ${a2Body.openApprovals})`,
      );
      assert.equal(
        a2Body.signaturesPending,
        aBody.signaturesPending,
        `A signaturesPending leaked B inserts`,
      );
      assert.equal(
        a2Body.quotesAwaitingResponse,
        aBody.quotesAwaitingResponse,
        `A quotesAwaitingResponse leaked B inserts`,
      );
      assert.equal(
        a2Body.openDealsCount,
        aBody.openDealsCount,
        `A openDealsCount changed unexpectedly`,
      );

      assert.equal(
        b2Body.openApprovals - bBody.openApprovals,
        N,
        `B openApprovals delta wrong: expected +${N}, got ${b2Body.openApprovals - bBody.openApprovals}`,
      );
      assert.equal(
        b2Body.signaturesPending - bBody.signaturesPending,
        N,
        `B signaturesPending delta wrong`,
      );
      assert.equal(
        b2Body.quotesAwaitingResponse - bBody.quotesAwaitingResponse,
        N,
        `B quotesAwaitingResponse delta wrong`,
      );
    } finally {
      await cleanupExtraDealflowItems(extraIds);
    }
  });

  it("GET /reports/performance — byOwner does not list other tenant's owners", async () => {
    const a = await clientA.get("/api/reports/performance");
    const b = await clientB.get("/api/reports/performance");
    assert.ok(ok(a.status), `A status ${a.status}`);
    assert.ok(ok(b.status), `B status ${b.status}`);
    const aOwners = (a.body as PerformanceResp).byOwner.map((o) => o.ownerId);
    const bOwners = (b.body as PerformanceResp).byOwner.map((o) => o.ownerId);
    assert.ok(aOwners.includes(worldA.userId), "A perf missing own owner");
    assert.ok(bOwners.includes(worldB.userId), "B perf missing own owner");
    assert.ok(!aOwners.includes(worldB.userId), `A perf leaked B owner: ${aOwners.join(",")}`);
    assert.ok(!bOwners.includes(worldA.userId), `B perf leaked A owner: ${bOwners.join(",")}`);
  });

  it("GET /audit — entries are filtered to the requester's tenant", async () => {
    const a = await clientA.get(`/api/audit?entityType=deal&limit=200`);
    const b = await clientB.get(`/api/audit?entityType=deal&limit=200`);
    assert.ok(ok(a.status), `A status ${a.status}`);
    assert.ok(ok(b.status), `B status ${b.status}`);
    const aEntities = (a.body as AuditResp).map((r) => r.entityId);
    const bEntities = (b.body as AuditResp).map((r) => r.entityId);
    assert.ok(aEntities.includes(worldA.dealId), "A audit missing own deal entry");
    assert.ok(bEntities.includes(worldB.dealId), "B audit missing own deal entry");
    assert.ok(!aEntities.includes(worldB.dealId), `A audit leaked B entry`);
    assert.ok(!bEntities.includes(worldA.dealId), `B audit leaked A entry`);
  });

  it("GET /activity — own deal events visible, foreign + NULL-dealId filtered out", async () => {
    const a = await clientA.get("/api/activity");
    const b = await clientB.get("/api/activity");
    assert.ok(ok(a.status), `A status ${a.status}`);
    assert.ok(ok(b.status), `B status ${b.status}`);
    const aIds = (a.body as ActivityResp).map((r) => r.id);
    const bIds = (b.body as ActivityResp).map((r) => r.id);
    assert.ok(aIds.includes(worldA.timelineEventId), "A activity missing own event");
    assert.ok(bIds.includes(worldB.timelineEventId), "B activity missing own event");
    assert.ok(!aIds.includes(worldB.timelineEventId), `A activity leaked B event`);
    assert.ok(!bIds.includes(worldA.timelineEventId), `B activity leaked A event`);
    // NULL-dealId from both tenants — must not appear anywhere.
    assert.ok(!aIds.includes(worldA.nullTimelineEventId), "A activity leaked own NULL-dealId");
    assert.ok(!aIds.includes(worldB.nullTimelineEventId), "A activity leaked B NULL-dealId");
    assert.ok(!bIds.includes(worldB.nullTimelineEventId), "B activity leaked own NULL-dealId");
    assert.ok(!bIds.includes(worldA.nullTimelineEventId), "B activity leaked A NULL-dealId");
    // Sanity: no row in /activity should have a null dealId at all.
    for (const r of a.body as ActivityResp) {
      assert.ok(r.dealId, `A activity row ${r.id} has null dealId`);
    }
    for (const r of b.body as ActivityResp) {
      assert.ok(r.dealId, `B activity row ${r.id} has null dealId`);
    }
  });

  it("GET /deals/:id — direct access to foreign deal is forbidden", async () => {
    // Defense-in-depth: even if a future endpoint is added or misconfigured,
    // direct ID access across tenants must not return data.
    const aSeesB = await clientA.get(`/api/deals/${worldB.dealId}`);
    const bSeesA = await clientB.get(`/api/deals/${worldA.dealId}`);
    assert.ok(
      aSeesB.status === 403 || aSeesB.status === 404,
      `A direct access to B deal returned ${aSeesB.status}`,
    );
    assert.ok(
      bSeesA.status === 403 || bSeesA.status === 404,
      `B direct access to A deal returned ${bSeesA.status}`,
    );
  });
});

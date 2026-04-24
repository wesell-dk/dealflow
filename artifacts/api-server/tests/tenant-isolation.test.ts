import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool, usersTable, contactsTable } from "@workspace/db";
import { hashPassword } from "../src/lib/auth";
import {
  createTestWorld,
  destroyTestWorlds,
  sweepStaleTestData,
  seedExtraDealflowItems,
  cleanupExtraDealflowItems,
  seedThreadScopeVariants,
  cleanupThreadScopeVariants,
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

    // NULL-dealId events are now properly tenant-scoped via the new
    // tenant_id column on timeline_events. They MUST be visible to their
    // own tenant (tenantWide users see all rows in tenant) and MUST NOT
    // leak to other tenants. Previously they were filtered out everywhere
    // because there was no way to tell which tenant they belonged to.
    assert.ok(aEventIds.includes(worldA.nullTimelineEventId), "A dashboard missing own NULL-dealId event");
    assert.ok(bEventIds.includes(worldB.nullTimelineEventId), "B dashboard missing own NULL-dealId event");
    assert.ok(!aEventIds.includes(worldB.nullTimelineEventId), "A dashboard leaked NULL-dealId B event");
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

  it("schema — INSERT without tenant_id (omitted column) fails fast", async () => {
    // Defence-in-depth for the structural-isolation guarantee: the
    // tenant_id column is NOT NULL with NO database default, so any
    // future code path that simply forgets to set the column gets a hard
    // error instead of silently landing in tn_root.
    let timelineRejected = false;
    try {
      await db.execute(sql`
        INSERT INTO timeline_events (id, type, title, description, actor)
        VALUES ('tl_omit_fail', 'test', 'x', 'x', 'x')
      `);
    } catch {
      timelineRejected = true;
    } finally {
      await db.execute(sql`DELETE FROM timeline_events WHERE id = 'tl_omit_fail'`);
    }
    assert.ok(timelineRejected, "timeline_events: omitted tenant_id must fail");

    let auditRejected = false;
    try {
      await db.execute(sql`
        INSERT INTO audit_log (id, entity_type, entity_id, action, actor, summary)
        VALUES ('au_omit_fail', 'x', 'x', 'x', 'x', 'x')
      `);
    } catch {
      auditRejected = true;
    } finally {
      await db.execute(sql`DELETE FROM audit_log WHERE id = 'au_omit_fail'`);
    }
    assert.ok(auditRejected, "audit_log: omitted tenant_id must fail");
  });

  it("GET /audit — restricted user (non-tenantWide) is denied in-tenant out-of-scope rows", async () => {
    // The SQL tenant_id filter prevents cross-tenant leakage; this test
    // proves the SECOND layer — entityInScope post-filter — still runs
    // for restricted users so an audit row for an entity outside their
    // company/brand scope is hidden even though it shares the tenant.
    //
    // We promote a restricted user into worldA's tenant with empty
    // scope (companyIds=[], brandIds=[]). Their allowedDealIds is the
    // empty set, so EVERY in-tenant audit row tied to a deal must be
    // hidden — including worldA.auditId.
    const restrictedId = `${worldA.runId}_restricted`;
    const restrictedEmail = `${restrictedId}@example.test`.toLowerCase();
    const restrictedPw = "restricted-pw-123!";
    await db.insert(usersTable).values({
      id: restrictedId,
      name: "Restricted User",
      email: restrictedEmail,
      role: "Account Executive",
      scope: `tenant:${worldA.tenantId}`,
      initials: "RU",
      passwordHash: hashPassword(restrictedPw),
      isActive: true,
      tenantId: worldA.tenantId,
      tenantWide: false,
      scopeCompanyIds: "[]",
      scopeBrandIds: "[]",
    });
    try {
      const restricted = await loginClient(server.baseUrl, restrictedEmail, restrictedPw);
      const r = await restricted.get(`/api/audit?entityType=deal&limit=200`);
      assert.ok(ok(r.status), `restricted status ${r.status}`);
      const ids = (r.body as AuditResp).map((x) => x.id);
      // worldA.auditId is a same-tenant deal audit row. SQL tenant filter
      // alone would let it through; only the entityInScope post-filter
      // hides it.
      assert.ok(
        !ids.includes(worldA.auditId),
        `restricted user saw same-tenant out-of-scope audit row: ${worldA.auditId}`,
      );
    } finally {
      await db.delete(usersTable).where(eq(usersTable.id, restrictedId));
    }
  });

  it("GET /activity — own-tenant events visible (incl. NULL-dealId), cross-tenant hidden", async () => {
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
    // NULL-dealId rows: own-tenant visible (the row carries tenant_id),
    // cross-tenant strictly hidden. Tenant-wide users (which both test
    // worlds use) see all rows in their tenant including NULL-dealId.
    assert.ok(aIds.includes(worldA.nullTimelineEventId), "A activity missing own NULL-dealId event");
    assert.ok(bIds.includes(worldB.nullTimelineEventId), "B activity missing own NULL-dealId event");
    assert.ok(!aIds.includes(worldB.nullTimelineEventId), "A activity leaked B NULL-dealId");
    assert.ok(!bIds.includes(worldA.nullTimelineEventId), "B activity leaked A NULL-dealId");
    // Cross-tenant safety: every row returned to A must belong to A's
    // tenant (either tied to a deal in A's company, or a NULL-dealId row
    // we just confirmed is A's). Same for B.
    const aWorldIds = new Set([
      worldA.timelineEventId,
      worldA.nullTimelineEventId,
      worldB.timelineEventId,
      worldB.nullTimelineEventId,
    ]);
    for (const r of a.body as ActivityResp) {
      if (aWorldIds.has(r.id)) {
        assert.ok(
          r.id === worldA.timelineEventId || r.id === worldA.nullTimelineEventId,
          `A activity returned a non-A test row: ${r.id}`,
        );
      }
    }
    for (const r of b.body as ActivityResp) {
      if (aWorldIds.has(r.id)) {
        assert.ok(
          r.id === worldB.timelineEventId || r.id === worldB.nullTimelineEventId,
          `B activity returned a non-B test row: ${r.id}`,
        );
      }
    }
  });

  // ── List endpoints scoped via dealId ──
  // For each route that returns rows joined to deals via dealId, verify that
  // tenant A only sees its own seeded entity and never tenant B's. Same in
  // reverse. These cover the routes called out in task #53.
  async function assertListIsolated(
    path: string,
    aOwnId: string,
    bOwnId: string,
    extract: (body: unknown) => string[] = (body) => ids(body as IdEntry[]),
  ) {
    const a = await clientA.get(path);
    const b = await clientB.get(path);
    assert.ok(ok(a.status), `${path} A status ${a.status}`);
    assert.ok(ok(b.status), `${path} B status ${b.status}`);
    const aIds = extract(a.body);
    const bIds = extract(b.body);
    assert.ok(aIds.includes(aOwnId), `A ${path} missing own id ${aOwnId}`);
    assert.ok(bIds.includes(bOwnId), `B ${path} missing own id ${bOwnId}`);
    assert.ok(
      !aIds.includes(bOwnId),
      `A ${path} leaked B id ${bOwnId} (got ${aIds.join(",")})`,
    );
    assert.ok(
      !bIds.includes(aOwnId),
      `B ${path} leaked A id ${aOwnId} (got ${bIds.join(",")})`,
    );
  }

  it("GET /quotes — each tenant only sees own quotes", async () => {
    await assertListIsolated("/api/quotes", worldA.quoteId, worldB.quoteId);
  });

  it("GET /approvals — each tenant only sees own approvals", async () => {
    await assertListIsolated("/api/approvals", worldA.approvalId, worldB.approvalId);
  });

  it("GET /signatures — each tenant only sees own signature packages", async () => {
    await assertListIsolated(
      "/api/signatures",
      worldA.signaturePackageId,
      worldB.signaturePackageId,
    );
  });

  it("GET /contracts — each tenant only sees own contracts", async () => {
    await assertListIsolated("/api/contracts", worldA.contractId, worldB.contractId);
  });

  it("GET /negotiations — each tenant only sees own negotiations", async () => {
    await assertListIsolated(
      "/api/negotiations",
      worldA.negotiationId,
      worldB.negotiationId,
    );
  });

  it("GET /order-confirmations — each tenant only sees own order confirmations", async () => {
    await assertListIsolated(
      "/api/order-confirmations",
      worldA.orderConfirmationId,
      worldB.orderConfirmationId,
    );
  });

  it("GET /copilot/insights — each tenant only sees own insights", async () => {
    await assertListIsolated(
      "/api/copilot/insights",
      worldA.copilotInsightId,
      worldB.copilotInsightId,
    );
  });

  it("GET /copilot/threads — each tenant only sees own threads (deal-scoped)", async () => {
    await assertListIsolated(
      "/api/copilot/threads",
      worldA.copilotThreadId,
      worldB.copilotThreadId,
    );
  });

  it("GET /price-positions — each tenant only sees own positions (company-scoped)", async () => {
    // /price-positions does NOT use the dealId pipeline; it joins through
    // companies.tenantId. Verify the alternate scoping path isolates rows
    // exactly the same way.
    await assertListIsolated(
      "/api/price-positions",
      worldA.pricePositionId,
      worldB.pricePositionId,
    );
  });

  it("GET /copilot/threads — visibility matrix across scope variants", async () => {
    // Pin down `copilotThreadVisible` AND the SQL tenant filter together,
    // for every kind of scope value:
    //   "global"             → visible to all users IN THE SAME TENANT
    //   ""                   → same as "global" (visible IN THE SAME TENANT)
    //   "deal:<id>"          → only the owning tenant + in scope
    //   "account:<id>"       → only the owning tenant + in scope
    //   "tenant:<id>"        → never visible (intentional)
    //   "garbage-no-colon"   → invalid → never visible
    //
    // Task #55 hardens this: the tenant_id column on copilot_threads now
    // SQL-filters globals/empties as well, so a second tenant must not see
    // the other tenant's "global" / "" threads either.
    const aVar = await seedThreadScopeVariants(worldA);
    const bVar = await seedThreadScopeVariants(worldB);
    try {
      const a = (await clientA.get("/api/copilot/threads")).body as IdEntry[];
      const b = (await clientB.get("/api/copilot/threads")).body as IdEntry[];
      const aIds = ids(a);
      const bIds = ids(b);

      // Globals + empties: now strictly tenant-scoped. Each tenant sees
      // ONLY its own globals/empties.
      assert.ok(aIds.includes(aVar.global), "A missing own global thread");
      assert.ok(aIds.includes(aVar.empty), "A missing own empty-scope thread");
      assert.ok(bIds.includes(bVar.global), "B missing own global thread");
      assert.ok(bIds.includes(bVar.empty), "B missing own empty-scope thread");
      assert.ok(!aIds.includes(bVar.global), "A leaked B global thread");
      assert.ok(!aIds.includes(bVar.empty), "A leaked B empty-scope thread");
      assert.ok(!bIds.includes(aVar.global), "B leaked A global thread");
      assert.ok(!bIds.includes(aVar.empty), "B leaked A empty-scope thread");

      // deal/account variants: must NOT leak across tenants.
      assert.ok(!aIds.includes(bVar.deal), `A leaked B deal-scoped thread`);
      assert.ok(!aIds.includes(bVar.account), `A leaked B account-scoped thread`);
      assert.ok(!bIds.includes(aVar.deal), `B leaked A deal-scoped thread`);
      assert.ok(!bIds.includes(aVar.account), `B leaked A account-scoped thread`);

      // Owners must still see their own deal/account variants.
      assert.ok(aIds.includes(aVar.deal), "A missing own deal thread");
      assert.ok(aIds.includes(aVar.account), "A missing own account thread");

      // tenant:<id> and malformed: never visible — to anyone, including owner.
      for (const v of [aVar.tenant, aVar.malformed, bVar.tenant, bVar.malformed]) {
        assert.ok(!aIds.includes(v), `A should not see ${v}`);
        assert.ok(!bIds.includes(v), `B should not see ${v}`);
      }
    } finally {
      await cleanupThreadScopeVariants(aVar, bVar);
    }
  });

  it("GET /accounts — each tenant only sees own accounts", async () => {
    await assertListIsolated("/api/accounts", worldA.accountId, worldB.accountId);
  });

  it("GET /contacts — each tenant only sees own contacts (via account scope)", async () => {
    // Seed one contact per tenant against each tenant's account so the
    // /contacts list endpoint has rows to filter. Contacts have no
    // tenant_id of their own — they piggyback on accountId scope, which
    // resolves to deal→company→tenant.
    const aContact = `${worldA.runId}_ct`;
    const bContact = `${worldB.runId}_ct`;
    await db.insert(contactsTable).values({
      id: aContact, accountId: worldA.accountId,
      name: `Test Contact A`, email: `${aContact}@example.test`,
      role: "buyer",
    });
    await db.insert(contactsTable).values({
      id: bContact, accountId: worldB.accountId,
      name: `Test Contact B`, email: `${bContact}@example.test`,
      role: "buyer",
    });
    try {
      await assertListIsolated("/api/contacts", aContact, bContact);
    } finally {
      await db.delete(contactsTable).where(inArray(contactsTable.id, [aContact, bContact]));
    }
  });

  it("GET /gdpr/subjects — each tenant only sees own subjects (via account scope)", async () => {
    // /gdpr/subjects searches contacts by name/email and is scoped through
    // allowedAccountIds. We seed one contact per tenant with a name that
    // matches q="GDPR" and ensure each tenant only sees its own.
    const aContact = `${worldA.runId}_gd`;
    const bContact = `${worldB.runId}_gd`;
    await db.insert(contactsTable).values({
      id: aContact, accountId: worldA.accountId,
      name: `GDPRSubjectA`, email: `${aContact}@example.test`,
      role: "buyer",
    });
    await db.insert(contactsTable).values({
      id: bContact, accountId: worldB.accountId,
      name: `GDPRSubjectB`, email: `${bContact}@example.test`,
      role: "buyer",
    });
    try {
      const path = `/api/gdpr/subjects?subjectType=contact&q=GDPR`;
      const extract = (body: unknown) =>
        ((body as { results?: IdEntry[] }).results ?? []).map((r) => r.id);
      await assertListIsolated(path, aContact, bContact, extract);
    } finally {
      await db.delete(contactsTable).where(inArray(contactsTable.id, [aContact, bContact]));
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

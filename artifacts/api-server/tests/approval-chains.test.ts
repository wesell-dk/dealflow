import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db, pool,
  usersTable,
  approvalsTable,
  approvalChainTemplatesTable,
  userDelegationsTable,
  type ApprovalStage,
} from "@workspace/db";
import { hashPassword } from "../src/lib/auth";
import {
  createTestWorld,
  destroyTestWorlds,
  sweepStaleTestData,
  type TestWorld,
} from "./helpers";
import { loginClient, startTestServer, type AuthedClient, type TestServer } from "./server";

interface ExtraUser {
  id: string;
  email: string;
  password: string;
  role: string;
}

async function createUser(world: TestWorld, role: string, suffix: string): Promise<ExtraUser> {
  const id = `${world.runId}_u_${suffix}`;
  const email = `${id}@example.test`.toLowerCase();
  const password = "test-pw-123!";
  await db.insert(usersTable).values({
    id,
    name: `User ${suffix}`,
    email,
    role,
    scope: `tenant:${world.tenantId}`,
    initials: suffix.slice(0, 2).toUpperCase(),
    passwordHash: hashPassword(password),
    isActive: true,
    tenantId: world.tenantId,
    tenantWide: true,
    scopeCompanyIds: "[]",
    scopeBrandIds: "[]",
  });
  return { id, email, password, role };
}

async function makeStagedApproval(world: TestWorld, stages: ApprovalStage[]): Promise<string> {
  const apId = `${world.runId}_apS_${randomBytes(3).toString("hex")}`;
  await db.insert(approvalsTable).values({
    id: apId,
    dealId: world.dealId,
    type: "clause_change",
    reason: "Test staged approval",
    requestedBy: world.userId,
    status: "pending",
    priority: "medium",
    impactValue: "1000",
    currency: "EUR",
    stages,
    currentStageIdx: 0,
  });
  return apId;
}

const baseStages = (legalId: string, financeId: string): ApprovalStage[] => [
  { order: 1, label: "Legal", approverRole: null, approverUserId: legalId, status: "pending" },
  { order: 2, label: "Finance", approverRole: null, approverUserId: financeId, status: "pending" },
];

describe("approval chains — multi-stage + delegation", () => {
  let server: TestServer;
  let world: TestWorld;
  let owner: AuthedClient;
  let legalUser: ExtraUser;
  let financeUser: ExtraUser;
  let legal: AuthedClient;
  let finance: AuthedClient;
  let deputyUser: ExtraUser;
  let deputy: AuthedClient;
  let strangerUser: ExtraUser;
  let stranger: AuthedClient;

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    world = await createTestWorld("chain");
    owner = await loginClient(server.baseUrl, world.userEmail, world.password);
    legalUser = await createUser(world, "legal", "legal");
    financeUser = await createUser(world, "finance", "fin");
    deputyUser = await createUser(world, "legal", "dep");
    strangerUser = await createUser(world, "sales_rep", "str");
    legal = await loginClient(server.baseUrl, legalUser.email, legalUser.password);
    finance = await loginClient(server.baseUrl, financeUser.email, financeUser.password);
    deputy = await loginClient(server.baseUrl, deputyUser.email, deputyUser.password);
    stranger = await loginClient(server.baseUrl, strangerUser.email, strangerUser.password);
  });

  after(async () => {
    try {
      // Hard cleanup tenant-scoped chain rows
      await db.delete(approvalChainTemplatesTable)
        .where(eq(approvalChainTemplatesTable.tenantId, world.tenantId));
      await db.delete(userDelegationsTable)
        .where(eq(userDelegationsTable.tenantId, world.tenantId));
      await db.delete(usersTable).where(inArray(usersTable.id, [
        legalUser.id, financeUser.id, deputyUser.id, strangerUser.id,
      ]));
      await destroyTestWorlds(world);
    } finally {
      if (server) await server.close();
      await pool.end().catch(() => {});
    }
  });

  it("Stage-Progression: erster Approve rückt currentStageIdx vor, bleibt pending", async () => {
    const apId = await makeStagedApproval(world, baseStages(legalUser.id, financeUser.id));
    const r = await legal.post(`/api/approvals/${apId}/decide`, { decision: "approve" });
    assert.equal(r.status, 200, `expected 200 got ${r.status}: ${JSON.stringify(r.body)}`);
    const [row] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, apId));
    assert.equal(row.status, "pending", "should still be pending after stage 1 approve");
    assert.equal(row.currentStageIdx, 1, "should advance to stage idx 1");
    const stages = row.stages as ApprovalStage[];
    assert.equal(stages[0].status, "approved");
    assert.equal(stages[0].decidedBy, legalUser.id);
    assert.equal(stages[1].status, "pending");
  });

  it("Letzter Stage-Approve schaltet Gesamt-Approval auf approved", async () => {
    const apId = await makeStagedApproval(world, baseStages(legalUser.id, financeUser.id));
    let r = await legal.post(`/api/approvals/${apId}/decide`, { decision: "approve" });
    assert.equal(r.status, 200);
    r = await finance.post(`/api/approvals/${apId}/decide`, { decision: "approve" });
    assert.equal(r.status, 200);
    const [row] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, apId));
    assert.equal(row.status, "approved", "overall must be approved after last stage");
    const stages = row.stages as ApprovalStage[];
    assert.ok(stages.every(s => s.status === "approved"));
  });

  it("Reject in einer Stage beendet die Chain als rejected", async () => {
    const apId = await makeStagedApproval(world, baseStages(legalUser.id, financeUser.id));
    let r = await legal.post(`/api/approvals/${apId}/decide`, { decision: "approve" });
    assert.equal(r.status, 200);
    r = await finance.post(`/api/approvals/${apId}/decide`, { decision: "reject", comment: "zu teuer" });
    assert.equal(r.status, 200);
    const [row] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, apId));
    assert.equal(row.status, "rejected", "overall must be rejected on stage reject");
    const stages = row.stages as ApprovalStage[];
    assert.equal(stages[0].status, "approved");
    assert.equal(stages[1].status, "rejected");
  });

  it("Fremder User ohne Approver-Rolle/-ID darf nicht entscheiden", async () => {
    const apId = await makeStagedApproval(world, baseStages(legalUser.id, financeUser.id));
    const r = await stranger.post(`/api/approvals/${apId}/decide`, { decision: "approve" });
    assert.ok(r.status === 403 || r.status === 401, `expected 403/401 got ${r.status}`);
    const [row] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, apId));
    assert.equal(row.status, "pending", "stranger must not change status");
    assert.equal(row.currentStageIdx, 0);
  });

  it("Falsche Stage: Stage-2-Approver darf Stage 1 nicht entscheiden", async () => {
    const apId = await makeStagedApproval(world, baseStages(legalUser.id, financeUser.id));
    const r = await finance.post(`/api/approvals/${apId}/decide`, { decision: "approve" });
    assert.equal(r.status, 403, `expected 403 got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  it("Vertretung greift im Zeitfenster — deputy darf für legal entscheiden, decidedBy=deputy + delegatedFrom=legal", async () => {
    const now = Date.now();
    const delId = `${world.runId}_del_${randomBytes(3).toString("hex")}`;
    await db.insert(userDelegationsTable).values({
      id: delId,
      tenantId: world.tenantId,
      fromUserId: legalUser.id,
      toUserId: deputyUser.id,
      validFrom: new Date(now - 60_000),
      validUntil: new Date(now + 60 * 60_000),
      active: true,
    });
    try {
      const apId = await makeStagedApproval(world, baseStages(legalUser.id, financeUser.id));
      const r = await deputy.post(`/api/approvals/${apId}/decide`, { decision: "approve" });
      assert.equal(r.status, 200, `deputy should be allowed, got ${r.status}: ${JSON.stringify(r.body)}`);
      const [row] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, apId));
      assert.equal(row.currentStageIdx, 1);
      const stages = row.stages as ApprovalStage[];
      assert.equal(stages[0].status, "approved");
      assert.equal(stages[0].decidedBy, deputyUser.id);
      assert.equal(stages[0].delegatedFrom, legalUser.id, "delegatedFrom must be set on stage");
    } finally {
      await db.delete(userDelegationsTable).where(eq(userDelegationsTable.id, delId));
    }
  });

  it("Vertretung greift NICHT außerhalb des Zeitfensters", async () => {
    const past = Date.now() - 24 * 3600_000;
    const delId = `${world.runId}_del_${randomBytes(3).toString("hex")}`;
    await db.insert(userDelegationsTable).values({
      id: delId,
      tenantId: world.tenantId,
      fromUserId: legalUser.id,
      toUserId: deputyUser.id,
      validFrom: new Date(past - 3600_000),
      validUntil: new Date(past),
      active: true,
    });
    try {
      const apId = await makeStagedApproval(world, baseStages(legalUser.id, financeUser.id));
      const r = await deputy.post(`/api/approvals/${apId}/decide`, { decision: "approve" });
      assert.equal(r.status, 403, `expired delegation must be rejected, got ${r.status}`);
    } finally {
      await db.delete(userDelegationsTable).where(eq(userDelegationsTable.id, delId));
    }
  });

  it("Deaktivierte Vertretung greift nicht", async () => {
    const now = Date.now();
    const delId = `${world.runId}_del_${randomBytes(3).toString("hex")}`;
    await db.insert(userDelegationsTable).values({
      id: delId,
      tenantId: world.tenantId,
      fromUserId: legalUser.id,
      toUserId: deputyUser.id,
      validFrom: new Date(now - 60_000),
      validUntil: new Date(now + 3600_000),
      active: false,
    });
    try {
      const apId = await makeStagedApproval(world, baseStages(legalUser.id, financeUser.id));
      const r = await deputy.post(`/api/approvals/${apId}/decide`, { decision: "approve" });
      assert.equal(r.status, 403, `inactive delegation must be rejected, got ${r.status}`);
    } finally {
      await db.delete(userDelegationsTable).where(eq(userDelegationsTable.id, delId));
    }
  });

  it("Original-Approver bleibt zusätzlich entscheidungsberechtigt trotz aktiver Vertretung", async () => {
    const now = Date.now();
    const delId = `${world.runId}_del_${randomBytes(3).toString("hex")}`;
    await db.insert(userDelegationsTable).values({
      id: delId,
      tenantId: world.tenantId,
      fromUserId: legalUser.id,
      toUserId: deputyUser.id,
      validFrom: new Date(now - 60_000),
      validUntil: new Date(now + 3600_000),
      active: true,
    });
    try {
      const apId = await makeStagedApproval(world, baseStages(legalUser.id, financeUser.id));
      const r = await legal.post(`/api/approvals/${apId}/decide`, { decision: "approve" });
      assert.equal(r.status, 200, "original approver must still be allowed");
      const [row] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, apId));
      const stages = row.stages as ApprovalStage[];
      assert.equal(stages[0].decidedBy, legalUser.id);
      assert.ok(!stages[0].delegatedFrom, "no delegatedFrom when original approver decides");
    } finally {
      await db.delete(userDelegationsTable).where(eq(userDelegationsTable.id, delId));
    }
  });

  it("Single-Stage-Legacy: Approval ohne stages funktioniert wie zuvor", async () => {
    // world.approvalId ist ein single-stage Approval (stages=[]), requestedBy=world.userId.
    const r = await owner.post(`/api/approvals/${world.approvalId}/decide`, { decision: "approve" });
    assert.equal(r.status, 200, `legacy single-stage should still work, got ${r.status}: ${JSON.stringify(r.body)}`);
    const [row] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, world.approvalId));
    assert.equal(row.status, "approved");
    assert.equal((row.stages as ApprovalStage[]).length, 0);
  });

  it("/me/delegations CRUD: User legt Vertretung an, sieht sie in outgoing, kann updaten und löschen", async () => {
    const post = await legal.post(`/api/me/delegations`, {
      toUserId: deputyUser.id,
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validUntil: new Date(Date.now() + 3600_000).toISOString(),
      reason: "Urlaub",
    });
    assert.equal(post.status, 201, `create failed: ${JSON.stringify(post.body)}`);
    const created = post.body as { id: string; toUserId: string };
    assert.equal(created.toUserId, deputyUser.id);

    const list = await legal.get(`/api/me/delegations`);
    assert.equal(list.status, 200);
    const body = list.body as { outgoing: { id: string }[]; incoming: { id: string }[] };
    assert.ok(body.outgoing.some(d => d.id === created.id), "outgoing must contain delegation");

    const incoming = await deputy.get(`/api/me/delegations`);
    const inBody = incoming.body as { outgoing: unknown[]; incoming: { id: string }[] };
    assert.ok(inBody.incoming.some(d => d.id === created.id), "deputy must see incoming");

    const patch = await legal.patch(`/api/me/delegations/${created.id}`, { active: false });
    assert.equal(patch.status, 200);
    const patched = patch.body as { active: boolean };
    assert.equal(patched.active, false);

    const del = await legal.delete(`/api/me/delegations/${created.id}`);
    assert.ok(del.status === 200 || del.status === 204, `delete failed: ${del.status}`);
  });

  it("/me/delegations: User darf keine fremde Vertretung patchen", async () => {
    const post = await legal.post(`/api/me/delegations`, {
      toUserId: deputyUser.id,
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      validUntil: new Date(Date.now() + 3600_000).toISOString(),
    });
    assert.equal(post.status, 201);
    const created = post.body as { id: string };
    try {
      const r = await stranger.patch(`/api/me/delegations/${created.id}`, { active: false });
      assert.equal(r.status, 404, "stranger must not see legal's delegation");
    } finally {
      await db.delete(userDelegationsTable).where(eq(userDelegationsTable.id, created.id));
    }
  });

  it("decide mit ungültigem decision auf staged approval liefert 400", async () => {
    const apId = await makeStagedApproval(world, baseStages(legalUser.id, financeUser.id));
    const r = await legal.post(`/api/approvals/${apId}/decide`, { decision: "maybe" });
    assert.equal(r.status, 400);
  });
});

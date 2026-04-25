import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, and } from "drizzle-orm";
import {
  db,
  brandsTable,
  contractsTable,
  contractClausesTable,
  usersTable,
  approvalsTable,
  auditLogTable,
} from "@workspace/db";
import {
  createTestWorld,
  destroyTestWorlds,
  sweepStaleTestData,
  type TestWorld,
} from "./helpers";
import { hashPassword } from "../src/lib/auth";
import {
  loginClient,
  startTestServer,
  type AuthedClient,
  type TestServer,
} from "./server";

describe("POST /contracts/:id/request-approval — CUAD-gated approval flow", () => {
  let server: TestServer;
  let world: TestWorld;
  let admin: AuthedClient;
  let regular: AuthedClient;
  let regularUserId: string;
  const seededContractIds: string[] = [];
  const createdApprovalIds: string[] = [];

  async function cleanupApprovalsForContract(contractId: string) {
    const all = await db.select().from(approvalsTable)
      .where(eq(approvalsTable.dealId, world.dealId));
    const ids = all
      .filter(a => a.reason.startsWith(`Vertrag ${contractId}:`))
      .map(a => a.id);
    if (ids.length) {
      await db.delete(approvalsTable).where(inArray(approvalsTable.id, ids));
    }
  }

  async function createNdaContract(title: string): Promise<string> {
    const created = await admin.post("/api/contracts", {
      dealId: world.dealId,
      title,
      template: "Mutual NDA",
      brandId: world.brandId,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = (created.body as { id: string }).id;
    seededContractIds.push(id);
    // Bind to ct_nda — NDA expects 4 categories; default seed only covers
    // EXPIRATION_DATE via cf_term, so 3 expected remain missing → blocked.
    await db.update(contractsTable)
      .set({ contractTypeId: "ct_nda", tenantId: world.tenantId })
      .where(eq(contractsTable.id, id));
    return id;
  }

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    world = await createTestWorld("approval-gate");

    // Admin user (alice) — promote to Tenant Admin so override works.
    await db.update(usersTable)
      .set({ role: "Tenant Admin", tenantWide: true })
      .where(eq(usersTable.id, world.userId));
    admin = await loginClient(server.baseUrl, world.userEmail, world.password);

    // Create a regular non-admin user in the same tenant for the 403 path.
    regularUserId = `usr_reg_${world.runId}`;
    const regularEmail = `regular_${world.runId}@dealflow.test`;
    await db.insert(usersTable).values({
      id: regularUserId,
      tenantId: world.tenantId,
      email: regularEmail,
      name: "Regular User",
      role: "Account Executive",
      scope: `tenant:${world.tenantId}`,
      initials: "RU",
      passwordHash: hashPassword(world.password),
      isActive: true,
      tenantWide: false,
      scopeCompanyIds: "[]",
      scopeBrandIds: "[]",
    });
    regular = await loginClient(server.baseUrl, regularEmail, world.password);

    // Default brand clause variants — cf_term is materialised so EXPIRATION_DATE
    // is covered but the other NDA expectations stay missing.
    await db.update(brandsTable).set({
      defaultClauseVariants: {
        cf_term: "cv_term_3",
      } as Record<string, string>,
    }).where(eq(brandsTable.id, world.brandId));
  });

  after(async () => {
    if (createdApprovalIds.length > 0) {
      await db.delete(approvalsTable)
        .where(inArray(approvalsTable.id, createdApprovalIds));
    }
    if (seededContractIds.length > 0) {
      await db.delete(approvalsTable)
        .where(eq(approvalsTable.dealId, world.dealId));
      await db.delete(auditLogTable)
        .where(inArray(auditLogTable.entityId, seededContractIds));
      await db.delete(contractClausesTable)
        .where(inArray(contractClausesTable.contractId, seededContractIds));
      await db.delete(contractsTable)
        .where(inArray(contractsTable.id, seededContractIds));
    }
    if (regularUserId) {
      await db.delete(usersTable).where(eq(usersTable.id, regularUserId));
    }
    await destroyTestWorlds(world);
    await server.close();
  });

  it("blocks with 409 cuad_required_missing when expected categories missing and no override", async () => {
    const ctrId = await createNdaContract("NDA — block path");

    const res = await admin.post(`/api/contracts/${ctrId}/request-approval`, {
      override: false,
    });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    const body = res.body as {
      error: string;
      code: string;
      missingExpectedCount: number;
      missing: Array<{ code: string; cuadCategoryId: string; name: string }>;
      contractTypeId: string | null;
      contractTypeName: string | null;
    };
    assert.equal(body.code, "cuad_required_missing");
    assert.ok(body.missingExpectedCount >= 3, `expected ≥3 missing, got ${body.missingExpectedCount}`);
    const codes = new Set(body.missing.map(m => m.code));
    for (const required of ["PARTIES", "EFFECTIVE_DATE", "GOVERNING_LAW"]) {
      assert.ok(codes.has(required), `missing list must include ${required}`);
    }
    // Must not have created an approval row.
    const approvals = await db.select().from(approvalsTable)
      .where(and(
        eq(approvalsTable.dealId, world.dealId),
        eq(approvalsTable.type, "contract_review"),
      ));
    const dupe = approvals.find(a => a.reason.startsWith(`Vertrag ${ctrId}:`));
    assert.equal(dupe, undefined, "no approval row may be created on block");
  });

  it("rejects override with 422 when overrideReason is shorter than 10 chars", async () => {
    const ctrId = await createNdaContract("NDA — short reason");
    const res = await admin.post(`/api/contracts/${ctrId}/request-approval`, {
      override: true,
      overrideReason: "too short",
    });
    // Schema validation runs first — orval/zod returns 422 for invalid body.
    assert.equal(res.status, 422, JSON.stringify(res.body));
  });

  it("blocks 403 when non-admin attempts override (even with valid reason)", async () => {
    const ctrId = await createNdaContract("NDA — non-admin override");
    const res = await regular.post(`/api/contracts/${ctrId}/request-approval`, {
      override: true,
      overrideReason: "Regular user trying to bypass — should fail.",
    });
    assert.equal(res.status, 403, JSON.stringify(res.body));
    const approvals = await db.select().from(approvalsTable)
      .where(eq(approvalsTable.dealId, world.dealId));
    const dupe = approvals.find(a => a.reason.startsWith(`Vertrag ${ctrId}:`));
    assert.equal(dupe, undefined, "non-admin override must not create approval");
  });

  it("admin override creates approval (201), tags reason, and writes structured audit entry", async () => {
    const ctrId = await createNdaContract("NDA — admin override path");
    const reason = "Parties+Governing Law im Side Letter geregelt — Eskalation an Legal-Lead per Mail.";

    const res = await admin.post(`/api/contracts/${ctrId}/request-approval`, {
      override: true,
      overrideReason: reason,
      priority: "high",
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const body = res.body as {
      approvalId: string;
      override: boolean;
      overrideReason: string | null;
      missingExpectedCount: number;
    };
    assert.ok(body.approvalId.startsWith("ap_"));
    assert.equal(body.override, true);
    assert.equal(body.overrideReason, reason);
    assert.ok(body.missingExpectedCount >= 3);
    createdApprovalIds.push(body.approvalId);

    // Verify approval row exists with the override reason marker in reason.
    const [row] = await db.select().from(approvalsTable)
      .where(eq(approvalsTable.id, body.approvalId));
    assert.ok(row, "approval row must exist");
    assert.equal(row.type, "contract_review");
    assert.equal(row.status, "pending");
    assert.equal(row.priority, "high");
    assert.match(row.reason, /Override/, "reason must mention Override");
    assert.match(row.reason, new RegExp(`Vertrag ${ctrId}:`));

    // Verify audit log entry contains structured override metadata.
    const logs = await db.select().from(auditLogTable)
      .where(and(
        eq(auditLogTable.entityType, "contract"),
        eq(auditLogTable.entityId, ctrId),
        eq(auditLogTable.action, "approval_requested"),
      ));
    assert.ok(logs.length >= 1, "must have at least one approval_requested audit row");
    const log = logs[logs.length - 1];
    assert.ok(log.afterJson, "afterJson must be populated");
    const after = JSON.parse(log.afterJson!) as {
      approvalId: string;
      override: boolean;
      overrideReason: string | null;
      missingExpectedCount: number;
      missingExpected: string[];
    };
    assert.equal(after.approvalId, body.approvalId);
    assert.equal(after.override, true);
    assert.equal(after.overrideReason, reason);
    assert.ok(after.missingExpectedCount >= 3);
    assert.ok(Array.isArray(after.missingExpected) && after.missingExpected.length >= 3,
      "audit must list missing CUAD codes");
  });

  it("dedupes: second request returns 409 already_pending with existing approvalId", async () => {
    const ctrId = await createNdaContract("NDA — dedupe path");
    const reason = "Override-Begründung für Dedupe-Test mit ausreichend Zeichen.";
    const first = await admin.post(`/api/contracts/${ctrId}/request-approval`, {
      override: true,
      overrideReason: reason,
    });
    assert.equal(first.status, 201);
    const firstId = (first.body as { approvalId: string }).approvalId;
    createdApprovalIds.push(firstId);

    const second = await admin.post(`/api/contracts/${ctrId}/request-approval`, {
      override: true,
      overrideReason: reason,
    });
    assert.equal(second.status, 409);
    const body = second.body as { code: string; approvalId: string };
    assert.equal(body.code, "already_pending");
    assert.equal(body.approvalId, firstId);
  });

  it("succeeds (201) for fully-covered contract without override", async () => {
    // Contract without contractTypeId → coverage reports 0 expected → unblocked.
    const created = await admin.post("/api/contracts", {
      dealId: world.dealId,
      title: "Generic — fully covered",
      template: "Mutual NDA",
      brandId: world.brandId,
    });
    const ctrId = (created.body as { id: string }).id;
    seededContractIds.push(ctrId);
    // Leave contractTypeId null so totalExpected = 0.

    const res = await admin.post(`/api/contracts/${ctrId}/request-approval`, {
      override: false,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const body = res.body as { approvalId: string; override: boolean; missingExpectedCount: number };
    assert.equal(body.override, false);
    assert.equal(body.missingExpectedCount, 0);
    createdApprovalIds.push(body.approvalId);
    await cleanupApprovalsForContract(ctrId);
  });
});

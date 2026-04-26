import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  accountsTable,
  dealsTable,
  usersTable,
  timelineEventsTable,
  auditLogTable,
  sessionsTable,
} from "@workspace/db";
import { hashPassword } from "../src/lib/auth";
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

interface SecondOwner {
  userId: string;
  userName: string;
  userEmail: string;
  accountId: string;
  dealId: string;
  dealName: string;
}

/**
 * Add a second tenant-wide user + their own account + deal in the SAME tenant
 * as `world`, so we can exercise the cross-owner duplicate path: user A copies
 * a quote out of her own deal into a deal owned by user B.
 */
async function seedSecondOwnerInTenant(
  world: TestWorld,
  label: string,
): Promise<SecondOwner> {
  const userId = `${world.runId}_u2_${label}`;
  const accountId = `${world.runId}_ac2_${label}`;
  const dealId = `${world.runId}_dl2_${label}`;
  const userName = `Second Owner ${label}`;
  const dealName = `Cross-Owner Target Deal ${label}`;
  const userEmail = `${userId}@example.test`.toLowerCase();
  await db.insert(usersTable).values({
    id: userId,
    name: userName,
    email: userEmail,
    role: "Account Executive",
    scope: `tenant:${world.tenantId}`,
    initials: "SO",
    passwordHash: hashPassword("test-pw-123!"),
    isActive: true,
    tenantId: world.tenantId,
    tenantWide: true,
    scopeCompanyIds: "[]",
    scopeBrandIds: "[]",
  });
  await db.insert(accountsTable).values({
    id: accountId,
    name: `Second Account ${label}`,
    industry: "Test",
    country: "DE",
    healthScore: 75,
    ownerId: userId,
  });
  await db.insert(dealsTable).values({
    id: dealId,
    name: dealName,
    accountId,
    stage: "qualified",
    value: "50000",
    currency: "EUR",
    probability: 30,
    expectedCloseDate: new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10),
    ownerId: userId,
    brandId: world.brandId,
    companyId: world.companyId,
    riskLevel: "low",
    nextStep: null,
  });
  return { userId, userName, userEmail, accountId, dealId, dealName };
}

async function destroySecondOwner(o: SecondOwner): Promise<void> {
  await db.delete(timelineEventsTable).where(eq(timelineEventsTable.dealId, o.dealId));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, o.userId));
  await db.delete(dealsTable).where(eq(dealsTable.id, o.dealId));
  await db.delete(accountsTable).where(eq(accountsTable.id, o.accountId));
  await db.delete(usersTable).where(eq(usersTable.id, o.userId));
}

describe("POST /quotes/:id/duplicate — cross-owner notification", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let alice: AuthedClient;
  let owner2: SecondOwner;
  // IDs of artefacts we created during the cross-owner duplicate so we can
  // delete them in `after()` even if assertions fail.
  const newQuoteIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    worldA = await createTestWorld("xowner");
    owner2 = await seedSecondOwnerInTenant(worldA, "alpha");
    alice = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
  });

  after(async () => {
    if (newQuoteIds.length) {
      // Quote rows + audit rows for the new IDs are scoped via tenantId; let
      // sweepStaleTestData clean the rest. Audit rows do not have the prefix
      // so we delete them explicitly here by entityId.
      await db
        .delete(auditLogTable)
        .where(inArray(auditLogTable.entityId, newQuoteIds));
    }
    await destroySecondOwner(owner2);
    await destroyTestWorlds(worldA);
    await server.close();
    await sweepStaleTestData();
  });

  it("notifies the target deal owner via timeline + audit when duplicating cross-owner", async () => {
    const res = await alice.post(`/api/quotes/${worldA.quoteId}/duplicate`, {
      targetDealId: owner2.dealId,
      includeAttachments: false,
      includeNotes: false,
      includeDiscount: false,
      includeValidUntil: false,
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as {
      id: string;
      number: string;
      dealId: string;
      ownerNotified: boolean;
      targetDealOwnerId: string | null;
      targetDealOwnerName: string | null;
    };
    newQuoteIds.push(body.id);

    // 1) Response carries the cross-owner signals so the UI can react.
    assert.equal(body.dealId, owner2.dealId, "new quote must land on target deal");
    assert.equal(body.ownerNotified, true, "ownerNotified must be true for cross-owner copy");
    assert.equal(body.targetDealOwnerId, owner2.userId);
    assert.equal(body.targetDealOwnerName, owner2.userName);

    // 2) Timeline event landed on the target deal so the owner sees it in
    //    their activity feed without needing email.
    const tl = await db
      .select()
      .from(timelineEventsTable)
      .where(
        and(
          eq(timelineEventsTable.dealId, owner2.dealId),
          eq(timelineEventsTable.type, "quote"),
        )!,
      );
    assert.ok(
      tl.some((e) => /kopiert/i.test(e.title) || /kopiert/i.test(e.description ?? "")),
      `expected a 'kopiert' timeline event on target deal, got: ${JSON.stringify(tl)}`,
    );
    const notif = tl.find((e) => /kopiert/i.test(e.title))!;
    assert.equal(notif.tenantId, worldA.tenantId, "timeline event must be tenant-scoped");
    assert.ok(
      notif.description?.includes(body.number),
      "timeline description must mention new quote number",
    );

    // 3) Audit row records BOTH source and target dealIds plus the owner
    //    switch flags, so the owner change is reconstructable from the log.
    const audits = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.entityType, "quote"),
          eq(auditLogTable.entityId, body.id),
          eq(auditLogTable.action, "duplicate"),
        )!,
      );
    assert.equal(audits.length, 1, "exactly one duplicate-audit row expected");
    const audit = audits[0]!;
    assert.equal(audit.tenantId, worldA.tenantId);
    assert.match(
      audit.summary,
      /benachrichtigt/i,
      `summary should mention notification, got: ${audit.summary}`,
    );
    assert.match(
      audit.summary,
      new RegExp(owner2.dealName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "summary should mention the target deal name",
    );

    const before = JSON.parse(audit.beforeJson ?? "{}") as {
      sourceQuoteId?: string;
      sourceDealId?: string;
      sourceDealOwnerId?: string | null;
    };
    const after = JSON.parse(audit.afterJson ?? "{}") as {
      newQuoteId?: string;
      targetDealId?: string;
      targetDealOwnerId?: string | null;
      targetDealOwnerName?: string | null;
      crossDeal?: boolean;
      crossOwner?: boolean;
      ownerNotified?: boolean;
    };
    assert.equal(before.sourceQuoteId, worldA.quoteId);
    assert.equal(before.sourceDealId, worldA.dealId);
    assert.equal(before.sourceDealOwnerId, worldA.userId);
    assert.equal(after.newQuoteId, body.id);
    assert.equal(after.targetDealId, owner2.dealId);
    assert.equal(after.targetDealOwnerId, owner2.userId);
    assert.equal(after.targetDealOwnerName, owner2.userName);
    assert.equal(after.crossDeal, true);
    assert.equal(after.crossOwner, true);
    assert.equal(after.ownerNotified, true);
  });

  it("does NOT notify when duplicating into the user's own deal (same owner)", async () => {
    const before = await db
      .select()
      .from(timelineEventsTable)
      .where(
        and(
          eq(timelineEventsTable.dealId, worldA.dealId),
          eq(timelineEventsTable.type, "quote"),
        )!,
      );

    const res = await alice.post(`/api/quotes/${worldA.quoteId}/duplicate`, {
      // No targetDealId -> defaults to source deal (still owned by Alice).
      includeAttachments: false,
      includeNotes: false,
      includeDiscount: false,
      includeValidUntil: false,
    });
    assert.equal(res.status, 201);
    const body = res.body as {
      id: string;
      ownerNotified: boolean;
      targetDealOwnerId: string | null;
      targetDealOwnerName: string | null;
    };
    newQuoteIds.push(body.id);

    assert.equal(body.ownerNotified, false, "same-owner duplicate must NOT notify");
    assert.equal(body.targetDealOwnerId, worldA.userId);
    assert.equal(body.targetDealOwnerName, "Test User xowner");

    const after = await db
      .select()
      .from(timelineEventsTable)
      .where(
        and(
          eq(timelineEventsTable.dealId, worldA.dealId),
          eq(timelineEventsTable.type, "quote"),
        )!,
      );
    assert.equal(
      after.length,
      before.length,
      "same-owner duplicate must not add a 'quote'-type timeline event",
    );

    // Audit row is still written but without the cross-owner / notification
    // flags — the audit log is a complete trail regardless.
    const audits = await db
      .select()
      .from(auditLogTable)
      .where(
        and(
          eq(auditLogTable.entityType, "quote"),
          eq(auditLogTable.entityId, body.id),
          eq(auditLogTable.action, "duplicate"),
        )!,
      );
    assert.equal(audits.length, 1);
    const afterJson = JSON.parse(audits[0]!.afterJson ?? "{}") as {
      crossDeal?: boolean;
      crossOwner?: boolean;
      ownerNotified?: boolean;
    };
    assert.equal(afterJson.crossDeal, false);
    assert.equal(afterJson.crossOwner, false);
    assert.equal(afterJson.ownerNotified, false);
  });
});

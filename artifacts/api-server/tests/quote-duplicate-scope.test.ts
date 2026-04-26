import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  dealsTable,
  quotesTable,
  quoteVersionsTable,
  lineItemsTable,
  quoteAttachmentsTable,
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

/**
 * POST /api/quotes/:id/duplicate must enforce scope on BOTH the source quote
 * (its underlying deal) and an optional `targetDealId` body argument. Without
 * a test, a future scope refactor could silently let an AE in tenant A copy a
 * quote into tenant B's deal — a cross-tenant data leak. This file pins down:
 *
 *   1. Default behaviour (no targetDealId) → new quote keeps source.dealId.
 *   2. targetDealId pointing at a deal the user CAN see → 201, new quote is
 *      attached to the target deal.
 *   3. targetDealId pointing at a cross-tenant deal → no quote created, the
 *      handler must reject with 403/404.
 *
 * Plus the "Was übernehmen?" flag matrix:
 *   - includeAttachments=false → no quote_attachments row is created.
 *   - includeDiscount=false    → unitPrice falls back to listPrice and the
 *                                version totalAmount is recomputed.
 */
describe("quote duplicate — scope + flags", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let worldB: TestWorld;
  let alice: AuthedClient;

  // Resources we manually seed on top of the standard TestWorld so we can
  // exercise both the line-item discount path and the attachments path.
  let secondDealId = "";
  let qvId = "";
  let lineItemIds: string[] = [];
  let attachmentId = "";
  // Track every duplicated quote so cleanup wipes downstream rows too.
  const dupQuoteIds: string[] = [];
  const dupQuoteVersionIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    worldA = await createTestWorld("dup_a");
    worldB = await createTestWorld("dup_b");
    alice = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);

    // Second deal in tenant A — same brand/company/owner so alice can see it
    // without changing scope. Used as the "visible target" for case 2.
    secondDealId = `${worldA.runId}_dl2`;
    await db.insert(dealsTable).values({
      id: secondDealId,
      name: `Test Deal A second`,
      accountId: worldA.accountId,
      stage: "qualified",
      value: "50000",
      currency: "EUR",
      probability: 25,
      expectedCloseDate: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
      ownerId: worldA.userId,
      brandId: worldA.brandId,
      companyId: worldA.companyId,
      riskLevel: "low",
      nextStep: null,
    });

    // Seed a version + two line items with a real discount (unitPrice <
    // listPrice) so we can prove that includeDiscount=false rebases unitPrice
    // back to listPrice and recomputes totalAmount.
    qvId = `${worldA.runId}_qv1`;
    await db.insert(quoteVersionsTable).values({
      id: qvId,
      quoteId: worldA.quoteId,
      version: 1,
      totalAmount: "1500",      // discounted total: 10*100 + 5*100 = 1500
      discountPct: "50",
      marginPct: "30",
      status: "draft",
      notes: "Original notes — must be preserved when includeNotes is true.",
    });
    lineItemIds = [
      `${worldA.runId}_li1`,
      `${worldA.runId}_li2`,
    ];
    await db.insert(lineItemsTable).values([
      {
        id: lineItemIds[0]!,
        quoteVersionId: qvId,
        name: "Product A",
        description: "Test product A",
        quantity: "10",
        unitPrice: "100",       // discounted from 200
        listPrice: "200",
        discountPct: "50",
        total: "1000",          // 10 * 100
      },
      {
        id: lineItemIds[1]!,
        quoteVersionId: qvId,
        name: "Product B",
        description: "Test product B",
        quantity: "5",
        unitPrice: "100",       // discounted from 200
        listPrice: "200",
        discountPct: "50",
        total: "500",           // 5 * 100
      },
    ]);

    // One attachment so we can prove includeAttachments=false skips it.
    attachmentId = `${worldA.runId}_qatt1`;
    await db.insert(quoteAttachmentsTable).values({
      id: attachmentId,
      quoteVersionId: qvId,
      libraryAssetId: null,
      name: "spec.pdf",
      mimeType: "application/pdf",
      size: 1024,
      objectPath: `/objects/test-dup-${worldA.runId}/spec.pdf`,
      label: "Spezifikation",
      order: 0,
    });
  });

  after(async () => {
    // Hard-delete every row we created on top of the standard TestWorld.
    // Order matters: child rows (line items, attachments) before parents
    // (quote versions), and dup quotes before the second deal that owns them.
    const allQvIds = [qvId, ...dupQuoteVersionIds].filter(Boolean);
    if (allQvIds.length) {
      await db.delete(lineItemsTable).where(
        inArray(lineItemsTable.quoteVersionId, allQvIds),
      );
      await db.delete(quoteAttachmentsTable).where(
        inArray(quoteAttachmentsTable.quoteVersionId, allQvIds),
      );
      await db.delete(quoteVersionsTable).where(
        inArray(quoteVersionsTable.id, allQvIds),
      );
    }
    if (dupQuoteIds.length) {
      await db.delete(quotesTable).where(inArray(quotesTable.id, dupQuoteIds));
    }
    if (secondDealId) {
      await db.delete(quotesTable).where(eq(quotesTable.dealId, secondDealId));
      await db.delete(dealsTable).where(eq(dealsTable.id, secondDealId));
    }
    if (worldA && worldB) {
      await destroyTestWorlds(worldA, worldB);
    }
    await server?.close();
  });

  it("ohne targetDealId → neuer Quote bleibt am Quell-Deal hängen", async () => {
    const res = await alice.post(`/api/quotes/${worldA.quoteId}/duplicate`);
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { id: string; number: string; dealId: string };
    assert.equal(body.dealId, worldA.dealId, "default target must equal source dealId");
    dupQuoteIds.push(body.id);

    // Sanity: the quote actually persists with the source dealId.
    const [row] = await db.select().from(quotesTable).where(eq(quotesTable.id, body.id));
    assert.ok(row, "duplicated quote must exist in DB");
    assert.equal(row!.dealId, worldA.dealId);
    // Track the version so cleanup can wipe its line items/attachments.
    const [ver] = await db.select().from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.quoteId, body.id));
    assert.ok(ver, "duplicated quote must have exactly one version");
    dupQuoteVersionIds.push(ver!.id);
  });

  it("targetDealId auf sichtbaren Deal → 201, neuer Quote hängt am Ziel-Deal", async () => {
    const res = await alice.post(`/api/quotes/${worldA.quoteId}/duplicate`, {
      targetDealId: secondDealId,
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { id: string; dealId: string };
    assert.equal(body.dealId, secondDealId, "new quote must be attached to the target deal");
    dupQuoteIds.push(body.id);

    const [row] = await db.select().from(quotesTable).where(eq(quotesTable.id, body.id));
    assert.equal(row!.dealId, secondDealId, "DB row must point at the target deal");
    const [ver] = await db.select().from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.quoteId, body.id));
    dupQuoteVersionIds.push(ver!.id);
  });

  it("targetDealId auf fremden Tenant-Deal → 403/404 und KEIN Quote angelegt", async () => {
    // Snapshot the count of quotes that point at worldB's deal before the
    // attempt — must remain unchanged afterwards. (Cleanup-resilient.)
    const beforeRows = await db.select().from(quotesTable)
      .where(eq(quotesTable.dealId, worldB.dealId));
    const beforeCount = beforeRows.length;

    const res = await alice.post(`/api/quotes/${worldA.quoteId}/duplicate`, {
      targetDealId: worldB.dealId,
    });
    assert.ok(
      res.status === 403 || res.status === 404,
      `expected 403 or 404 for cross-tenant target, got ${res.status}: ${JSON.stringify(res.body)}`,
    );

    const afterRows = await db.select().from(quotesTable)
      .where(eq(quotesTable.dealId, worldB.dealId));
    assert.equal(
      afterRows.length, beforeCount,
      "cross-tenant copy attempt must NOT create a quote on the target deal",
    );
  });

  it("includeAttachments=false → keine quote_attachments-Zeile wird angelegt", async () => {
    const res = await alice.post(`/api/quotes/${worldA.quoteId}/duplicate`, {
      includeAttachments: false,
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { id: string };
    dupQuoteIds.push(body.id);

    const [ver] = await db.select().from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.quoteId, body.id));
    assert.ok(ver, "duplicated quote must have a version");
    dupQuoteVersionIds.push(ver!.id);

    const atts = await db.select().from(quoteAttachmentsTable)
      .where(eq(quoteAttachmentsTable.quoteVersionId, ver!.id));
    assert.equal(atts.length, 0,
      "includeAttachments=false must skip every quote_attachments row");

    // Sanity: line items DO carry over by default.
    const lis = await db.select().from(lineItemsTable)
      .where(eq(lineItemsTable.quoteVersionId, ver!.id));
    assert.equal(lis.length, 2, "line items must still be copied");
  });

  it("includeDiscount=false → unitPrice fällt auf listPrice zurück, totalAmount neu berechnet", async () => {
    const res = await alice.post(`/api/quotes/${worldA.quoteId}/duplicate`, {
      includeDiscount: false,
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    const body = res.body as { id: string };
    dupQuoteIds.push(body.id);

    const [ver] = await db.select().from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.quoteId, body.id));
    assert.ok(ver, "duplicated quote must have a version");
    dupQuoteVersionIds.push(ver!.id);

    // Version-level: discount cleared and totalAmount recomputed at list price.
    assert.equal(Number(ver!.discountPct), 0, "discountPct must be reset to 0");
    // Two lines × 200 list × (10 + 5) qty = 3000.
    assert.equal(Number(ver!.totalAmount), 3000,
      "totalAmount must equal sum of (qty * listPrice) across all lines");

    // Per-line: every position must now sit at listPrice with no discount.
    const lis = await db.select().from(lineItemsTable)
      .where(eq(lineItemsTable.quoteVersionId, ver!.id));
    assert.equal(lis.length, 2, "both line items must be copied");
    for (const li of lis) {
      assert.equal(
        Number(li.unitPrice), Number(li.listPrice),
        `line ${li.name}: unitPrice must equal listPrice when includeDiscount=false`,
      );
      assert.equal(Number(li.discountPct), 0,
        `line ${li.name}: discountPct must be reset to 0`);
      assert.equal(
        Number(li.total), Number(li.quantity) * Number(li.listPrice),
        `line ${li.name}: total must be recomputed as qty * listPrice`,
      );
    }
  });
});

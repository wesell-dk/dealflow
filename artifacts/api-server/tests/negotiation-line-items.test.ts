import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  quoteVersionsTable,
  lineItemsTable,
  negotiationsTable,
  customerReactionsTable,
} from "@workspace/db";
import {
  createTestWorld,
  destroyTestWorlds,
  sweepStaleTestData,
  type TestWorld,
} from "./helpers";
import { loginClient, startTestServer, type AuthedClient, type TestServer } from "./server";

interface NegotiationResp {
  id: string;
  dealId: string;
  status: string;
  round: number;
  outcome?: string | null;
  concludedAt?: string | null;
}

interface ReactionResp {
  id: string;
  affectedLineItems?: { lineItemId: string; action: string; newPrice?: number }[];
  linkedQuoteVersionId?: string | null;
}

interface ImpactResp {
  reactionId: string;
  priceDeltaPct?: number | null;
  newTotalAmount?: number | null;
  affectedLineItemsCount?: number;
}

describe("Negotiations — idempotent create + line-item impact + create-version", () => {
  let server: TestServer;
  let world: TestWorld;
  let client: AuthedClient;
  const createdNegotiationIds: string[] = [];
  const createdVersionIds: string[] = [];
  const createdLineItemIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    world = await createTestWorld("neg_li");
    client = await loginClient(server.baseUrl, world.userEmail, world.password);

    // Seed quote version v1 with two line items so create-version has
    // something to copy. The TestWorld quote already has currentVersion=1.
    const v1Id = `${world.runId}_qv1`;
    await db.insert(quoteVersionsTable).values({
      id: v1Id,
      quoteId: world.quoteId,
      version: 1,
      totalAmount: "1000",
      discountPct: "0",
      marginPct: "30",
      status: "draft",
      notes: "test",
    });
    createdVersionIds.push(v1Id);

    const liA = `${world.runId}_li_a`;
    const liB = `${world.runId}_li_b`;
    await db.insert(lineItemsTable).values([
      {
        id: liA, quoteVersionId: v1Id, kind: "item", sortOrder: 0,
        name: "Line A", quantity: "10", unitPrice: "50", listPrice: "60",
        discountPct: "0", total: "500",
      },
      {
        id: liB, quoteVersionId: v1Id, kind: "item", sortOrder: 1,
        name: "Line B", quantity: "5", unitPrice: "100", listPrice: "100",
        discountPct: "0", total: "500",
      },
    ]);
    createdLineItemIds.push(liA, liB);
  });

  after(async () => {
    if (createdNegotiationIds.length) {
      await db.delete(customerReactionsTable).where(
        inArray(customerReactionsTable.negotiationId, createdNegotiationIds),
      );
      await db.delete(negotiationsTable).where(
        inArray(negotiationsTable.id, createdNegotiationIds),
      );
    }
    if (createdLineItemIds.length) {
      await db.delete(lineItemsTable).where(inArray(lineItemsTable.id, createdLineItemIds));
    }
    if (createdVersionIds.length) {
      // line items copied into newer versions are caught by the LIKE-cleanup
      // below — but guard against orphans first.
      await db.delete(lineItemsTable).where(
        inArray(lineItemsTable.quoteVersionId, createdVersionIds),
      );
      await db.delete(quoteVersionsTable).where(
        inArray(quoteVersionsTable.id, createdVersionIds),
      );
    }
    await destroyTestWorlds(world);
    await server.close();
  });

  it("POST /negotiations is idempotent: second call returns the same active negotiation", async () => {
    const r1 = await client.post(`/api/negotiations`, { dealId: world.dealId });
    assert.equal(r1.status, 201, `expected 201, got ${r1.status} body=${JSON.stringify(r1.body)}`);
    const n1 = r1.body as NegotiationResp;
    assert.equal(n1.dealId, world.dealId);
    assert.equal(n1.status, "active");
    createdNegotiationIds.push(n1.id);

    const r2 = await client.post(`/api/negotiations`, { dealId: world.dealId });
    assert.equal(r2.status, 200, `expected 200 on idempotent re-call, got ${r2.status}`);
    const n2 = r2.body as NegotiationResp;
    assert.equal(n2.id, n1.id, "expected idempotent POST to return same negotiation id");
  });

  it("POST /:id/reactions accepts affectedLineItems and impact reflects scope + price math", async () => {
    const negId = createdNegotiationIds[0]!;
    const liA = `${world.runId}_li_a`;
    const liB = `${world.runId}_li_b`;

    const r = await client.post(`/api/negotiations/${negId}/reactions`, {
      type: "objection",
      topic: "Preisreduktion auf zwei Positionen",
      summary: "Kunde fordert -20% auf Line A und -10% Rabatt auf Line B.",
      source: "E-Mail CFO",
      priority: "high",
      affectedLineItems: [
        { lineItemId: liA, action: "price", newPrice: 40 },     // 10×40 = 400 (was 500)
        { lineItemId: liB, action: "discount", discountPct: 10 }, // 5×100×0.9 = 450 (was 500)
      ],
    });
    assert.equal(r.status, 201, `reaction create failed: ${r.status} ${JSON.stringify(r.body)}`);
    const reaction = r.body as ReactionResp;
    assert.ok(Array.isArray(reaction.affectedLineItems), "affectedLineItems should be returned");
    assert.equal(reaction.affectedLineItems!.length, 2);

    const i = await client.get(`/api/negotiations/${negId}/impact`);
    assert.equal(i.status, 200);
    const body = i.body as { impacts: ImpactResp[] };
    const impact = body.impacts.find(x => x.reactionId === reaction.id);
    assert.ok(impact, "impact for new reaction must be present");
    assert.equal(impact!.affectedLineItemsCount, 2, "scope must reflect 2 affected line items");
    // Old total = 1000; new total = 400 + 450 = 850 → -15%
    assert.equal(impact!.newTotalAmount, 850, `expected newTotal=850 got ${impact!.newTotalAmount}`);
    assert.ok(impact!.priceDeltaPct != null && impact!.priceDeltaPct < 0, "price delta must be negative");
    assert.ok(Math.abs(impact!.priceDeltaPct! + 15) < 0.01, `expected ~ -15% got ${impact!.priceDeltaPct}`);
  });

  it("POST /:id/reactions/:rid/create-version creates a new version with adjusted line-items", async () => {
    const negId = createdNegotiationIds[0]!;
    // Re-fetch reactions so we have the id.
    const detail = await client.get(`/api/negotiations/${negId}`);
    assert.equal(detail.status, 200);
    const detailBody = detail.body as { reactions: { id: string; affectedLineItems?: unknown[] }[] };
    const reaction = detailBody.reactions.find(x => Array.isArray(x.affectedLineItems) && x.affectedLineItems.length > 0);
    assert.ok(reaction, "reaction with affectedLineItems must exist");

    const cv = await client.post(`/api/negotiations/${negId}/reactions/${reaction!.id}/create-version`);
    assert.equal(cv.status, 201, `create-version failed: ${cv.status} ${JSON.stringify(cv.body)}`);
    const cvBody = cv.body as { quoteVersionId: string };
    assert.ok(cvBody.quoteVersionId, "expected quoteVersionId in response");
    createdVersionIds.push(cvBody.quoteVersionId);

    // Verify new version exists with the expected total and copied line items.
    const [newVersion] = await db.select().from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.id, cvBody.quoteVersionId));
    assert.ok(newVersion, "new quote version row must exist");
    assert.equal(Number(newVersion!.totalAmount), 850, "new version total must reflect line-item changes");

    const newLines = await db.select().from(lineItemsTable)
      .where(eq(lineItemsTable.quoteVersionId, cvBody.quoteVersionId));
    assert.equal(newLines.length, 2, "both items should be copied");
    for (const li of newLines) createdLineItemIds.push(li.id);

    const lineA = newLines.find(li => li.name === "Line A");
    const lineB = newLines.find(li => li.name === "Line B");
    assert.ok(lineA && lineB, "both line items should be present in new version");
    assert.equal(Number(lineA!.unitPrice), 40, "Line A unit price should be 40 (price action)");
    assert.equal(Number(lineA!.total), 400);
    assert.equal(Number(lineB!.discountPct), 10, "Line B discount should be 10 (discount action)");
    assert.equal(Number(lineB!.total), 450);
  });

  it("POST /:id/conclude with outcome=accepted closes the negotiation", async () => {
    const negId = createdNegotiationIds[0]!;
    const r = await client.post(`/api/negotiations/${negId}/conclude`, { outcome: "accepted" });
    assert.equal(r.status, 200, `conclude failed: ${r.status} ${JSON.stringify(r.body)}`);
    const n = r.body as NegotiationResp;
    assert.equal(n.status, "closed");
    assert.equal(n.outcome, "accepted");
    assert.ok(n.concludedAt, "concludedAt should be set");

    // Idempotent: second conclude returns 200 with same outcome.
    const r2 = await client.post(`/api/negotiations/${negId}/conclude`, { outcome: "rejected" });
    assert.equal(r2.status, 200);
    const n2 = r2.body as NegotiationResp;
    assert.equal(n2.outcome, "accepted", "should not overwrite already-concluded outcome");
  });
});

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  quotesTable,
  quoteVersionsTable,
  contactsTable,
  auditLogTable,
} from "@workspace/db";
import {
  createTestWorld,
  destroyTestWorlds,
  sweepStaleTestData,
  type TestWorld,
} from "./helpers";
import { loginClient, startTestServer, type AuthedClient, type TestServer } from "./server";

interface QuoteResp {
  id: string;
  status: string;
  sentAt: string | null;
  sentTo: string | null;
}

describe("POST /quotes/:id/send — quote email send flow", () => {
  let server: TestServer;
  let world: TestWorld;
  let client: AuthedClient;
  // Track contact rows created by tests so we can clean them up afterwards.
  const extraContactIds: string[] = [];
  // Track quote_version rows created here too.
  const extraVersionIds: string[] = [];

  before(async () => {
    delete process.env["RESEND_API_KEY"]; // force "log" provider — no real send
    await sweepStaleTestData();
    server = await startTestServer();
    world = await createTestWorld("quote_send");
    client = await loginClient(server.baseUrl, world.userEmail, world.password);

    // helpers' world creates a quote with status='sent' already; reset to 'draft'
    // so we can validate the draft → sent transition explicitly.
    await db
      .update(quotesTable)
      .set({ status: "draft", sentAt: null, sentTo: null })
      .where(eq(quotesTable.id, world.quoteId));

    // Quote needs at least one version row for the PDF renderer.
    const vId = `${world.runId}_qv_send`;
    await db.insert(quoteVersionsTable).values({
      id: vId,
      quoteId: world.quoteId,
      version: 1,
      totalAmount: "1000",
      discountPct: "0",
      marginPct: "30",
      status: "draft",
      notes: "test",
    });
    extraVersionIds.push(vId);
  });

  after(async () => {
    if (extraContactIds.length) {
      await db.delete(contactsTable).where(inArray(contactsTable.id, extraContactIds));
    }
    if (extraVersionIds.length) {
      await db.delete(quoteVersionsTable).where(inArray(quoteVersionsTable.id, extraVersionIds));
    }
    // audit_log rows for the test quote are wiped by destroyTestWorlds via
    // the entityId-based sweep below (defense in depth).
    await db
      .delete(auditLogTable)
      .where(and(eq(auditLogTable.entityType, "quote"), eq(auditLogTable.entityId, world.quoteId)));
    await destroyTestWorlds(world);
    await server.close();
  });

  it("rejects when `to` is missing or invalid", async () => {
    const r1 = await client.post(`/api/quotes/${world.quoteId}/send`, {
      subject: "x",
      message: "y",
    });
    assert.equal(r1.status, 422);

    const r2 = await client.post(`/api/quotes/${world.quoteId}/send`, {
      to: ["not-an-email"],
      subject: "x",
      message: "y",
    });
    assert.equal(r2.status, 422);

    const r3 = await client.post(`/api/quotes/${world.quoteId}/send`, {
      to: ["customer@example.test"],
      subject: "",
      message: "y",
    });
    assert.equal(r3.status, 422);
  });

  it("returns 404 for unknown quote", async () => {
    const r = await client.post(`/api/quotes/qt_does_not_exist/send`, {
      to: ["customer@example.test"],
      subject: "x",
      message: "y",
    });
    assert.equal(r.status, 404);
  });

  it("sends the quote, flips draft→sent, persists sentAt/sentTo and writes audit log", async () => {
    const to = ["alice@customer.test", "bob@customer.test"];
    const cc = ["cc@customer.test"];
    const before = Date.now();
    const r = await client.post(`/api/quotes/${world.quoteId}/send`, {
      to,
      cc,
      subject: `Angebot ${world.quoteId}`,
      message: "Sehr geehrte Damen und Herren, anbei das Angebot.",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const body = r.body as QuoteResp;
    assert.equal(body.status, "sent", "draft must flip to sent on first send");
    assert.ok(body.sentAt, "sentAt must be populated");
    assert.equal(body.sentTo, to.join(", "));
    assert.ok(new Date(body.sentAt!).getTime() >= before - 1000);

    // Persisted in DB.
    const [row] = await db.select().from(quotesTable).where(eq(quotesTable.id, world.quoteId));
    assert.equal(row?.status, "sent");
    assert.equal(row?.sentTo, to.join(", "));

    // Audit log: at least one "sent" entry for this quote.
    const audits = await db
      .select()
      .from(auditLogTable)
      .where(and(eq(auditLogTable.entityType, "quote"), eq(auditLogTable.entityId, world.quoteId)));
    const sentEntry = audits.find(a => a.action === "sent");
    assert.ok(sentEntry, "must have sent audit entry");
    const after = JSON.parse(sentEntry!.afterJson ?? "{}") as Record<string, unknown>;
    assert.deepEqual(after["to"], to);
    assert.deepEqual(after["cc"], cc);
    assert.equal(after["provider"], "log");
  });

  it("does not downgrade non-draft status on a second send", async () => {
    // Manually mark the quote as accepted, then re-send.
    await db
      .update(quotesTable)
      .set({ status: "accepted" })
      .where(eq(quotesTable.id, world.quoteId));

    const r = await client.post(`/api/quotes/${world.quoteId}/send`, {
      to: ["alice@customer.test"],
      subject: "Resend",
      message: "Anbei nochmals.",
    });
    assert.equal(r.status, 200);
    const body = r.body as QuoteResp;
    assert.equal(body.status, "accepted", "status must NOT regress to 'sent'");
    assert.equal(body.sentTo, "alice@customer.test");
  });
});

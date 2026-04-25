import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  externalCollaboratorsTable,
  externalCollaboratorEventsTable,
  contractCommentsTable,
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

interface CollabResp {
  id: string;
  email: string;
  status: "active" | "expired" | "revoked";
  capabilities: ("view" | "comment" | "sign_party")[];
  expiresAt: string;
  tokenPlaintext: string | null;
  lastUsedAt: string | null;
}

describe("external collaborators — magic-link flow", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let worldB: TestWorld;
  let alice: AuthedClient;
  let bob: AuthedClient;

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    worldA = await createTestWorld("ec_collab_a");
    worldB = await createTestWorld("ec_collab_b");
    alice = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    bob = await loginClient(server.baseUrl, worldB.userEmail, worldB.password);
  });

  after(async () => {
    // Clean rows from new tables that aren't owned by destroyTestWorlds.
    await db.delete(externalCollaboratorEventsTable).where(
      inArray(externalCollaboratorEventsTable.tenantId, [worldA.tenantId, worldB.tenantId]),
    );
    await db.delete(contractCommentsTable).where(
      inArray(contractCommentsTable.tenantId, [worldA.tenantId, worldB.tenantId]),
    );
    await db.delete(externalCollaboratorsTable).where(
      inArray(externalCollaboratorsTable.tenantId, [worldA.tenantId, worldB.tenantId]),
    );
    await server.close();
    await destroyTestWorlds(worldA, worldB);
    await pool.end();
  });

  it("creates magic-link, returns plaintext only once, returns active status", async () => {
    const r = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "lawyer-a@kanzlei.example",
      name: "Dr. Anna Anwalt",
      organization: "Kanzlei Müller & Partner",
      capabilities: ["view", "comment"],
      expiresInDays: 14,
    });
    assert.equal(r.status, 201);
    const c = r.body as CollabResp;
    assert.ok(c.id.startsWith("ec_"));
    assert.equal(c.status, "active");
    assert.deepEqual([...c.capabilities].sort(), ["comment", "view"]);
    assert.ok(c.tokenPlaintext && c.tokenPlaintext.length === 64, "token plaintext present + 64 hex chars");

    // Subsequent list MUST NOT leak plaintext.
    const list = await alice.get(`/api/v1/contracts/${worldA.contractId}/external-collaborators`);
    assert.equal(list.status, 200);
    const items = list.body as CollabResp[];
    const found = items.find((i) => i.id === c.id);
    assert.ok(found, "collab present in list");
    assert.equal(found!.tokenPlaintext, null, "plaintext token never re-disclosed");
  });

  it("rejects collaborator from wrong tenant with 404", async () => {
    const r = await bob.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "intruder@example.com",
      capabilities: ["view"],
    });
    assert.equal(r.status, 404, "cross-tenant contract leaks as 404");
  });

  it("validates input — bad email, bad caps, bad expiry", async () => {
    const bad1 = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "not-an-email",
      capabilities: ["view"],
    });
    assert.equal(bad1.status, 400);

    const bad2 = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "ok@example.com",
      capabilities: ["something_invalid"],
    });
    assert.equal(bad2.status, 400);

    const bad3 = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "ok2@example.com",
      capabilities: ["view"],
      expiresInDays: 999,
    });
    assert.equal(bad3.status, 400);
  });

  it("rejects duplicate active collaborator with 409", async () => {
    const r = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "lawyer-a@kanzlei.example", // same as test 1
      capabilities: ["view"],
    });
    assert.equal(r.status, 409);
  });

  it("public GET /external/:token returns contract snapshot, increments lastUsedAt + writes event", async () => {
    // Need a fresh collab to get plaintext.
    const created = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "view-only@example.com",
      capabilities: ["view"],
      expiresInDays: 7,
    });
    assert.equal(created.status, 201);
    const c = created.body as CollabResp;
    const token = c.tokenPlaintext!;

    // Public call without cookie.
    const pub = await fetch(`${server.baseUrl}/api/v1/external/${token}`);
    assert.equal(pub.status, 200);
    const view = (await pub.json()) as {
      collaborator: { id: string; email: string; capabilities: string[] };
      contract: { id: string; title: string };
      clauses: unknown[];
      comments: unknown[];
    };
    assert.equal(view.collaborator.id, c.id);
    assert.equal(view.contract.id, worldA.contractId);
    assert.ok(Array.isArray(view.clauses));

    // Verify lastUsedAt was set.
    const [refreshed] = await db
      .select()
      .from(externalCollaboratorsTable)
      .where(eq(externalCollaboratorsTable.id, c.id));
    assert.ok(refreshed?.lastUsedAt, "lastUsedAt set after view");

    // Verify viewed event was logged.
    const events = await db
      .select()
      .from(externalCollaboratorEventsTable)
      .where(eq(externalCollaboratorEventsTable.collaboratorId, c.id));
    assert.ok(events.some((e) => e.action === "viewed"), "viewed event recorded");
  });

  it("invalid token returns 404; revoked token returns 401", async () => {
    const bad = await fetch(`${server.baseUrl}/api/v1/external/${"f".repeat(64)}`);
    assert.equal(bad.status, 404);

    // Create + revoke + check 401.
    const created = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "revoke-me@example.com",
      capabilities: ["view", "comment"],
    });
    const c = created.body as CollabResp;
    const token = c.tokenPlaintext!;

    const del = await alice.delete(`/api/v1/external-collaborators/${c.id}`);
    assert.equal(del.status, 200);
    const after = del.body as CollabResp;
    assert.equal(after.status, "revoked");

    const pub = await fetch(`${server.baseUrl}/api/v1/external/${token}`);
    assert.equal(pub.status, 401);
  });

  it("expired token returns 401", async () => {
    // Create then manually push expiresAt into the past.
    const created = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "expired@example.com",
      capabilities: ["view"],
    });
    const c = created.body as CollabResp;
    const token = c.tokenPlaintext!;
    await db
      .update(externalCollaboratorsTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(externalCollaboratorsTable.id, c.id));

    const pub = await fetch(`${server.baseUrl}/api/v1/external/${token}`);
    assert.equal(pub.status, 401);
  });

  it("external comment requires comment capability", async () => {
    // view-only collab.
    const created = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "noncomment@example.com",
      capabilities: ["view"],
    });
    const c = created.body as CollabResp;
    const token = c.tokenPlaintext!;

    const fail = await fetch(`${server.baseUrl}/api/v1/external/${token}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "should not work" }),
    });
    assert.equal(fail.status, 403);

    // Now create a commenter and verify it works.
    const c2res = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "commenter@example.com",
      capabilities: ["view", "comment"],
    });
    const c2 = c2res.body as CollabResp;
    const t2 = c2.tokenPlaintext!;
    const ok = await fetch(`${server.baseUrl}/api/v1/external/${t2}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Hier mein Kommentar zur Klausel 4.2." }),
    });
    assert.equal(ok.status, 201);
    const cmt = (await ok.json()) as { authorType: string; authorName: string; body: string };
    assert.equal(cmt.authorType, "external");
    assert.equal(cmt.authorName, "commenter@example.com");

    // Internal user can list & sees the external comment.
    const lst = await alice.get(`/api/v1/contracts/${worldA.contractId}/comments`);
    assert.equal(lst.status, 200);
    const comments = lst.body as { authorType: string; body: string }[];
    assert.ok(comments.some((x) => x.authorType === "external" && x.body.includes("Klausel 4.2")));
  });

  it("internal user can post comment via session-auth route", async () => {
    const r = await alice.post(`/api/v1/contracts/${worldA.contractId}/comments`, {
      body: "Internes Memo: bitte mit Legal abstimmen.",
    });
    assert.equal(r.status, 201);
    const cmt = r.body as { authorType: string; authorName: string };
    assert.equal(cmt.authorType, "user");
    assert.ok(cmt.authorName.length > 0);
  });

  it("rejects empty/oversized comment body", async () => {
    const empty = await alice.post(`/api/v1/contracts/${worldA.contractId}/comments`, { body: "   " });
    assert.equal(empty.status, 400);

    const huge = await alice.post(`/api/v1/contracts/${worldA.contractId}/comments`, {
      body: "x".repeat(5000),
    });
    assert.equal(huge.status, 400);
  });

  it("cross-tenant: bob cannot list / revoke collabs of tenant A", async () => {
    const list = await bob.get(`/api/v1/contracts/${worldA.contractId}/external-collaborators`);
    assert.equal(list.status, 404);

    // Find an existing collab for A and try to revoke as bob.
    const aliceList = await alice.get(`/api/v1/contracts/${worldA.contractId}/external-collaborators`);
    const aliceItems = aliceList.body as CollabResp[];
    assert.ok(aliceItems.length > 0);
    const target = aliceItems[0]!;
    const del = await bob.delete(`/api/v1/external-collaborators/${target.id}`);
    assert.equal(del.status, 404);
  });
});

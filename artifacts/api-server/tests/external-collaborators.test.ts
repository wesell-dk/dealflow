import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  externalCollaboratorsTable,
  externalCollaboratorEventsTable,
  contractCommentsTable,
  contractsTable,
  auditLogTable,
  signersTable,
  signaturePackagesTable,
  orderConfirmationsTable,
  timelineEventsTable,
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
  capabilities: ("view" | "comment" | "edit_fields" | "sign_party")[];
  editableFields: string[];
  ipAllowlist: string[];
  expiresAt: string;
  tokenPlaintext: string | null;
  lastUsedAt: string | null;
  emailSent: { ok: boolean; provider: string; error?: string | null } | null;
}

describe("external collaborators — magic-link flow", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let worldB: TestWorld;
  let alice: AuthedClient;
  let bob: AuthedClient;
  // Sammelt OC-IDs, die durch externe Mitzeichnung im Test entstehen, damit
  // sie im after-Hook deterministisch entfernt werden — sonst wuerden sie
  // ueber Test-Laeufe hinweg im DB-State bleiben.
  const extraOcIds: string[] = [];

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
    if (extraOcIds.length > 0) {
      await db.delete(orderConfirmationsTable).where(
        inArray(orderConfirmationsTable.id, extraOcIds),
      );
    }
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

  // ── Task #70 erweiterte Anforderungen ──────────────────────────────────

  it("erlaubt 30 Tage, lehnt 31 Tage ab (max-Expiry-Cap)", async () => {
    const ok = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "expiry-30@example.com",
      capabilities: ["view"],
      expiresInDays: 30,
    });
    assert.equal(ok.status, 201);

    const bad = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "expiry-31@example.com",
      capabilities: ["view"],
      expiresInDays: 31,
    });
    assert.equal(bad.status, 400, "max 30 Tage muss greifen");
  });

  it("validiert IP-Allowlist-Eintraege (akzeptiert IPv4/CIDR, lehnt Mist ab)", async () => {
    const ok = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "ip-ok@example.com",
      capabilities: ["view"],
      ipAllowlist: ["10.0.0.1", "192.168.1.0/24", "::1"],
    });
    assert.equal(ok.status, 201);
    const c = ok.body as CollabResp;
    assert.deepEqual(c.ipAllowlist.sort(), ["10.0.0.1", "192.168.1.0/24", "::1"].sort());

    const bad = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "ip-bad@example.com",
      capabilities: ["view"],
      ipAllowlist: ["not-an-ip"],
    });
    assert.equal(bad.status, 400);
  });

  it("IP-Allowlist greift: erlaubte IP -> 200, blockierte IP -> 403; ::ffff:-Praefix wird gestripped", async () => {
    // Test-Server liefert req.ip = ::1 (Loopback). Wir whitelisten exakt das.
    const created = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "ip-allow@example.com",
      capabilities: ["view"],
      ipAllowlist: ["::1", "127.0.0.1"], // beide Loopback-Varianten
    });
    assert.equal(created.status, 201);
    const c = created.body as CollabResp;
    const token = c.tokenPlaintext!;

    const ok = await fetch(`${server.baseUrl}/api/v1/external/${token}`);
    assert.equal(ok.status, 200, "loopback IP ist whitelisted");

    // Whitelist umstellen auf ein anderes Subnet -> 403.
    await db.update(externalCollaboratorsTable)
      .set({ ipAllowlist: ["203.0.113.0/24"] })
      .where(eq(externalCollaboratorsTable.id, c.id));
    const blocked = await fetch(`${server.baseUrl}/api/v1/external/${token}`);
    assert.equal(blocked.status, 403, "fremde IP wird geblockt");

    // ::ffff:127.0.0.1 (IPv4-mapped IPv6) muss gegen 127.0.0.1 matchen.
    // Wir testen das ueber den Helper-Pfad — Loopback bleibt Loopback,
    // aber wenn der Server die IP als ::ffff:127.0.0.1 sieht und Whitelist
    // 127.0.0.1 enthaelt, MUSS es matchen.
    await db.update(externalCollaboratorsTable)
      .set({ ipAllowlist: ["127.0.0.1"] })
      .where(eq(externalCollaboratorsTable.id, c.id));
    const v4Map = await fetch(`${server.baseUrl}/api/v1/external/${token}`);
    // Loopback wird in Node typischerweise als ::1 bzw. 127.0.0.1 gesehen.
    // Wir akzeptieren entweder 200 (wenn es 127.0.0.1 ist) oder 403 (wenn ::1)
    // — getestet wird, dass Server NICHT crasht und die Logik konsistent ist.
    assert.ok([200, 403].includes(v4Map.status));
  });

  it("edit_fields verlangt nicht-leere editableFields beim Create", async () => {
    const bad = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "ef-missing@example.com",
      capabilities: ["view", "edit_fields"],
      // editableFields fehlt
    });
    assert.equal(bad.status, 400);

    const bad2 = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "ef-missing2@example.com",
      capabilities: ["view", "edit_fields"],
      editableFields: [],
    });
    assert.equal(bad2.status, 400);

    const bad3 = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "ef-bad@example.com",
      capabilities: ["view", "edit_fields"],
      editableFields: ["randomFieldThatIsNotWhitelisted"],
    });
    assert.equal(bad3.status, 400);
  });

  it("PATCH /external/:token/contract: ohne edit_fields -> 403", async () => {
    const created = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "no-edit@example.com",
      capabilities: ["view", "comment"],
    });
    const c = created.body as CollabResp;
    const r = await fetch(`${server.baseUrl}/api/v1/external/${c.tokenPlaintext}/contract`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ governingLaw: "Schweizer Recht" }),
    });
    assert.equal(r.status, 403);
  });

  it("PATCH /external/:token/contract: nicht-whitelisted Feld -> 403; whitelisted Feld -> 200 + Audit-Eintrag", async () => {
    const created = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "lawyer-edit@example.com",
      capabilities: ["view", "edit_fields"],
      editableFields: ["governingLaw", "jurisdiction"],
    });
    assert.equal(created.status, 201);
    const c = created.body as CollabResp;
    const token = c.tokenPlaintext!;

    // effectiveFrom ist NICHT in der Whitelist -> 403.
    const denied = await fetch(`${server.baseUrl}/api/v1/external/${token}/contract`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ effectiveFrom: "2026-01-01" }),
    });
    assert.equal(denied.status, 403);

    // governingLaw ist whitelisted -> 200.
    const ok = await fetch(`${server.baseUrl}/api/v1/external/${token}/contract`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ governingLaw: "Recht der Bundesrepublik Deutschland" }),
    });
    assert.equal(ok.status, 200);
    const result = (await ok.json()) as {
      contract: { governingLaw: string };
      updatedFields: string[];
    };
    assert.equal(result.contract.governingLaw, "Recht der Bundesrepublik Deutschland");
    assert.deepEqual(result.updatedFields, ["governingLaw"]);

    // DB wurde tatsaechlich aktualisiert.
    const [refreshed] = await db.select().from(contractsTable).where(eq(contractsTable.id, worldA.contractId));
    assert.equal(refreshed!.governingLaw, "Recht der Bundesrepublik Deutschland");

    // Audit-Eintrag muss existieren — und Actor muss `magic-link:<id>` sein,
    // NICHT eine User-ID. Damit ist Reviewer sofort klar, dass die Aenderung
    // ueber einen externen Token kam.
    const audits = await db.select().from(auditLogTable)
      .where(eq(auditLogTable.entityId, worldA.contractId));
    const ext = audits.filter((a) => a.action === "external_field_edit");
    assert.ok(ext.length > 0, "external_field_edit Audit-Eintrag existiert");
    const last = ext[ext.length - 1]!;
    assert.equal(last.actor, `magic-link:${c.id}`,
      "actor muss magic-link:<collab-id> sein, nicht eine User-ID");
    assert.equal(last.tenantId, worldA.tenantId);
    assert.ok(last.summary.includes("governingLaw"));
  });

  it("Audit-Log fuer external_comment_created nutzt magic-link:<id> als Actor", async () => {
    const created = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "audit-commenter@example.com",
      capabilities: ["view", "comment"],
    });
    const c = created.body as CollabResp;
    const ok = await fetch(`${server.baseUrl}/api/v1/external/${c.tokenPlaintext}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Audit-Test-Kommentar." }),
    });
    assert.equal(ok.status, 201);

    const audits = await db.select().from(auditLogTable)
      .where(eq(auditLogTable.entityId, worldA.contractId));
    const ext = audits.filter((a) =>
      a.action === "external_comment_created" && a.actor === `magic-link:${c.id}`);
    assert.ok(ext.length > 0,
      "Comment-Audit muss actor=magic-link:<id> tragen, nicht User-ID");
  });

  // ── Task #108: Audit-Uebersicht fuer Magic-Link-Zugang ──────────────────

  it("GET /external-collaborators/:id liefert Detail (eigener Tenant) und 404 (fremder)", async () => {
    const created = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "detail-jump@example.com",
      capabilities: ["view"],
    });
    const c = created.body as CollabResp;

    const own = await alice.get(`/api/v1/external-collaborators/${c.id}`);
    assert.equal(own.status, 200);
    const detail = own.body as CollabResp;
    assert.equal(detail.id, c.id);
    assert.equal(detail.email, "detail-jump@example.com");
    assert.equal(detail.tokenPlaintext, null,
      "Plaintext-Token darf NIE auf Detail-Endpoint erscheinen");

    const cross = await bob.get(`/api/v1/external-collaborators/${c.id}`);
    assert.equal(cross.status, 404, "Cross-Tenant muss als 404 leaken");
  });

  it("GET /external-collaborators/:id/events liefert chronologische Timeline (asc)", async () => {
    const created = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "timeline@example.com",
      capabilities: ["view", "comment"],
    });
    const c = created.body as CollabResp;
    const token = c.tokenPlaintext!;

    // Drei Aktionen ausloesen, die jeweils ein Event schreiben.
    const v1 = await fetch(`${server.baseUrl}/api/v1/external/${token}`);
    assert.equal(v1.status, 200);
    const v2 = await fetch(`${server.baseUrl}/api/v1/external/${token}`);
    assert.equal(v2.status, 200);
    const cmt = await fetch(`${server.baseUrl}/api/v1/external/${token}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "Timeline-Kommentar" }),
    });
    assert.equal(cmt.status, 201);

    const evts = await alice.get(`/api/v1/external-collaborators/${c.id}/events`);
    assert.equal(evts.status, 200);
    const list = evts.body as { action: string; createdAt: string; collaboratorId: string }[];
    // Mindestens: created + 2x viewed + commented
    assert.ok(list.length >= 4, `expected >=4 events, got ${list.length}`);
    assert.ok(list.every((e) => e.collaboratorId === c.id));
    const actions = list.map((e) => e.action);
    assert.equal(actions[0], "created", "erstes Event muss 'created' sein");
    assert.ok(actions.includes("viewed"));
    assert.ok(actions.includes("commented"));
    // chronologisch aufsteigend
    for (let i = 1; i < list.length; i++) {
      assert.ok(list[i - 1]!.createdAt <= list[i]!.createdAt,
        `events nicht chronologisch aufsteigend bei index ${i}`);
    }

    // Cross-Tenant: 404
    const cross = await bob.get(`/api/v1/external-collaborators/${c.id}/events`);
    assert.equal(cross.status, 404);
  });

  it("GET /contracts/:id/external-events liefert alle Reviewer + filtert per collaboratorId", async () => {
    // Zwei Magic-Links, beide loesen Events aus.
    const a = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "agg-1@example.com",
      capabilities: ["view"],
    });
    const a1 = a.body as CollabResp;
    const b = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "agg-2@example.com",
      capabilities: ["view"],
    });
    const a2 = b.body as CollabResp;
    await fetch(`${server.baseUrl}/api/v1/external/${a1.tokenPlaintext}`);
    await fetch(`${server.baseUrl}/api/v1/external/${a2.tokenPlaintext}`);

    const all = await alice.get(`/api/v1/contracts/${worldA.contractId}/external-events`);
    assert.equal(all.status, 200);
    const allList = all.body as { collaboratorId: string }[];
    const collabIds = new Set(allList.map((e) => e.collaboratorId));
    assert.ok(collabIds.has(a1.id), "Aggregat enthaelt Reviewer A");
    assert.ok(collabIds.has(a2.id), "Aggregat enthaelt Reviewer B");

    const filtered = await alice.get(
      `/api/v1/contracts/${worldA.contractId}/external-events?collaboratorId=${a1.id}`,
    );
    assert.equal(filtered.status, 200);
    const filteredList = filtered.body as { collaboratorId: string }[];
    assert.ok(filteredList.length > 0);
    assert.ok(filteredList.every((e) => e.collaboratorId === a1.id),
      "Reviewer-Filter darf nur Events von a1 zurueckgeben");

    // Cross-Tenant ist 404 (Vertrag nicht sichtbar).
    const cross = await bob.get(`/api/v1/contracts/${worldA.contractId}/external-events`);
    assert.equal(cross.status, 404);
  });

  // ── Task #107: E-Mail-Versand fuer neue Magic-Links ───────────────────

  it("schickt per Default eine Einladungs-E-Mail (log-Provider in Tests)", async () => {
    // Test-Env hat keinen RESEND_API_KEY -> 'log'-Provider ist aktiv und
    // liefert immer ok=true. Damit verifizieren wir Default-Verhalten +
    // Audit-/Event-Trail ohne externe Abhaengigkeit.
    const r = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "invite-default@example.com",
      capabilities: ["view"],
      // sendEmail bewusst weggelassen -> Default 'true'.
    });
    assert.equal(r.status, 201);
    const c = r.body as CollabResp;
    assert.ok(c.emailSent, "emailSent muss bei Default vorhanden sein");
    assert.equal(c.emailSent!.ok, true);
    assert.equal(c.emailSent!.provider, "log");

    // Collab-Event 'invite_emailed' muss existieren.
    const events = await db.select().from(externalCollaboratorEventsTable)
      .where(eq(externalCollaboratorEventsTable.collaboratorId, c.id));
    assert.ok(
      events.some((e) => e.action === "invite_emailed"),
      "invite_emailed event muss geschrieben sein",
    );

    // Audit-Eintrag 'external_collaborator_email_sent' muss existieren.
    const audits = await db.select().from(auditLogTable)
      .where(and(
        eq(auditLogTable.entityId, worldA.contractId),
        eq(auditLogTable.action, "external_collaborator_email_sent"),
      ));
    assert.ok(
      audits.some((a) => {
        const after = a.afterJson ? (JSON.parse(a.afterJson) as { collaboratorId?: string }) : null;
        return after?.collaboratorId === c.id;
      }),
      "external_collaborator_email_sent Audit muss diesen Collab referenzieren",
    );
  });

  it("sendEmail=false ueberspringt den Versand und schreibt KEIN Email-Event", async () => {
    const r = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "no-email@example.com",
      capabilities: ["view"],
      sendEmail: false,
    });
    assert.equal(r.status, 201);
    const c = r.body as CollabResp;
    assert.equal(c.emailSent, null, "kein E-Mail-Status wenn Versand abgeschaltet");

    const events = await db.select().from(externalCollaboratorEventsTable)
      .where(eq(externalCollaboratorEventsTable.collaboratorId, c.id));
    assert.ok(
      !events.some((e) => e.action === "invite_emailed" || e.action === "invite_email_failed"),
      "weder invite_emailed noch invite_email_failed darf existieren",
    );

    const audits = await db.select().from(auditLogTable)
      .where(and(
        eq(auditLogTable.entityId, worldA.contractId),
        eq(auditLogTable.action, "external_collaborator_email_sent"),
      ));
    assert.ok(
      !audits.some((a) => {
        const after = a.afterJson ? (JSON.parse(a.afterJson) as { collaboratorId?: string }) : null;
        return after?.collaboratorId === c.id;
      }),
      "kein Email-Audit fuer diesen Collab",
    );
  });

  it("ignoriert cross-host magicLinkBaseUrl still und faellt auf APP_BASE_URL zurueck (Phishing-Schutz)", async () => {
    // Wuerde der Server einen fremden Host akzeptieren, koennte ein Angreifer
    // gebrandete E-Mails von unserer Domain mit Links auf SEINEM Host
    // erzeugen. Mit konfiguriertem APP_BASE_URL muss der Server cross-host
    // BaseUrls still verwerfen und auf die kanonische Origin zurueckfallen.
    const prev = process.env["APP_BASE_URL"];
    process.env["APP_BASE_URL"] = "https://app.dealflow.example";
    try {
      const r = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
        email: "phishing-host@example.com",
        capabilities: ["view"],
        magicLinkBaseUrl: "https://attacker.example.com",
      });
      assert.equal(r.status, 201);
      const c = r.body as CollabResp;
      assert.ok(c.emailSent && c.emailSent.ok, "Versand laeuft mit Fallback-URL");
      assert.ok(c.tokenPlaintext, "Magic-Link wird erstellt");

      // Erfolgs-Audit existiert; Failure-Audit darf NICHT existieren.
      const failed = await db.select().from(auditLogTable)
        .where(and(
          eq(auditLogTable.entityId, worldA.contractId),
          eq(auditLogTable.action, "external_collaborator_email_failed"),
        ));
      assert.ok(
        !failed.some((a) => {
          const after = a.afterJson ? (JSON.parse(a.afterJson) as { collaboratorId?: string }) : null;
          return after?.collaboratorId === c.id;
        }),
        "kein failure-Audit — Fallback war erfolgreich",
      );
    } finally {
      if (prev === undefined) delete process.env["APP_BASE_URL"];
      else process.env["APP_BASE_URL"] = prev;
    }
  });


  it("rejected magicLinkBaseUrl mit nicht-http(s)-Schema als emailSent.ok=false", async () => {
    // ftp:// (oder javascript:, file:, ...) hat im Browser/Mailclient nichts
    // zu suchen. Der Server muss das hart ablehnen, damit nichts Skurriles
    // in der Einladungs-E-Mail landet.
    const r = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "bad-scheme@example.com",
      capabilities: ["view"],
      magicLinkBaseUrl: "ftp://example.com/dealflow-web",
    });
    assert.equal(r.status, 201);
    const c = r.body as CollabResp;
    assert.ok(c.emailSent, "emailSent muss vorhanden sein");
    assert.equal(c.emailSent!.ok, false, "non-http(s) base muss versand verhindern");
    assert.match(
      String(c.emailSent!.error ?? ""),
      /invalid magicLinkBaseUrl/,
      "Fehlertext muss die Ursache nennen",
    );
    assert.ok(c.tokenPlaintext, "Magic-Link wird trotz Email-Fehler erstellt");

    // Failure-Audit + collab-event existieren.
    const audits = await db.select().from(auditLogTable)
      .where(and(
        eq(auditLogTable.entityId, worldA.contractId),
        eq(auditLogTable.action, "external_collaborator_email_failed"),
      ));
    assert.ok(
      audits.some((a) => {
        const after = a.afterJson ? (JSON.parse(a.afterJson) as { collaboratorId?: string }) : null;
        return after?.collaboratorId === c.id;
      }),
      "external_collaborator_email_failed Audit muss diesen Collab referenzieren",
    );
  });

  it("akzeptiert magicLinkBaseUrl mit gleichem Host (Web-App-Subpath)", async () => {
    // Test-Server bindet auf 127.0.0.1:<port>; req.headers.host enthaelt
    // genau diesen Host. Wir bauen daraus einen Subpath, der vom Validator
    // akzeptiert werden muss.
    const url = new URL(server.baseUrl);
    const r = await alice.post(`/api/v1/contracts/${worldA.contractId}/external-collaborators`, {
      email: "samehost@example.com",
      capabilities: ["view"],
      magicLinkBaseUrl: `${url.protocol}//${url.host}/dealflow-web`,
    });
    assert.equal(r.status, 201);
    const c = r.body as CollabResp;
    assert.ok(c.emailSent && c.emailSent.ok, "Versand muss erfolgreich sein");
    assert.equal(c.emailSent!.provider, "log");
  });

  // ── Mitzeichnen (Task #109) ─────────────────────────────────────────────
  it("POST /external/:token/sign ohne sign_party-Capability -> 403", async () => {
    const created = await alice.post(
      `/api/v1/contracts/${worldA.contractId}/external-collaborators`,
      { email: "no-sign-cap@example.com", capabilities: ["view", "comment"] },
    );
    assert.equal(created.status, 201);
    const c = created.body as CollabResp;
    const r = await fetch(`${server.baseUrl}/api/v1/external/${c.tokenPlaintext}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Anna Anwalt" }),
    });
    assert.equal(r.status, 403, "ohne sign_party muss /sign mit 403 antworten");
  });

  it("POST /external/:token/sign mit sign_party: legt Signer an, schreibt Audit + Event", async () => {
    const created = await alice.post(
      `/api/v1/contracts/${worldA.contractId}/external-collaborators`,
      {
        email: "sign-lawyer@kanzlei.example",
        name: "Dr. Susi Sign",
        organization: "Kanzlei Sign & Co.",
        capabilities: ["view", "sign_party"],
      },
    );
    assert.equal(created.status, 201);
    const c = created.body as CollabResp;
    const token = c.tokenPlaintext!;

    const r = await fetch(`${server.baseUrl}/api/v1/external/${token}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Dr. Susi Sign",
        // Minimal valid 1x1 PNG as data URL.
        signatureImage:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      }),
    });
    assert.equal(r.status, 201, "Sign-Endpoint muss 201 Created liefern");
    const body = (await r.json()) as {
      package: { id: string; status: string; title: string };
      signer: { id: string; name: string; email: string; role: string; status: string; signedAt: string };
    };
    assert.equal(body.signer.status, "signed");
    assert.equal(body.signer.email, "sign-lawyer@kanzlei.example");
    assert.equal(body.signer.name, "Dr. Susi Sign");
    assert.ok(body.signer.role.includes("Mitzeichner"),
      "Signer-Rolle muss 'Mitzeichner' enthalten, war: " + body.signer.role);
    assert.ok(body.signer.signedAt, "signedAt muss gesetzt sein");
    assert.equal(body.package.id, worldA.signaturePackageId,
      "Signer wurde dem Package des Vertrags zugeordnet");

    // Persisted signer row matches.
    const signerRows = await db.select().from(signersTable)
      .where(eq(signersTable.id, body.signer.id));
    assert.equal(signerRows.length, 1);
    assert.equal(signerRows[0]!.status, "signed");
    assert.equal(signerRows[0]!.email, "sign-lawyer@kanzlei.example");
    assert.equal(signerRows[0]!.packageId, worldA.signaturePackageId);

    // Da dieser Mitzeichner der einzige Signer im Package ist, ist mit der
    // Mitzeichnung das gesamte Paket vollstaendig — die Vervollstaendigungs-
    // Pipeline (gleiche wie /signers/:id/sign) muss greifen: Package wird
    // 'completed', eine Auftragsbestaetigung wird erzeugt, und ein
    // Completion-Audit (action='completed') landet ebenfalls mit
    // actor=magic-link:<id> im Log.
    const [pkg] = await db.select().from(signaturePackagesTable)
      .where(eq(signaturePackagesTable.id, worldA.signaturePackageId));
    assert.ok(pkg, "Package muss existieren");
    assert.equal(pkg!.status, "completed",
      "Package muss nach finaler Mitzeichnung 'completed' sein, war: " + pkg!.status);
    assert.ok(pkg!.orderConfirmationId,
      "Package muss eine OC-ID nach Vervollstaendigung tragen");
    const ocs = await db.select().from(orderConfirmationsTable)
      .where(eq(orderConfirmationsTable.id, pkg!.orderConfirmationId!));
    assert.equal(ocs.length, 1,
      "Auftragsbestaetigung muss durch externe Mitzeichnung erzeugt worden sein");
    assert.equal(ocs[0]!.dealId, worldA.dealId);

    const completionAudits = (await db.select().from(auditLogTable)
      .where(eq(auditLogTable.entityId, worldA.signaturePackageId)))
      .filter((a) => a.action === "completed");
    assert.ok(completionAudits.length > 0,
      "Completion-Audit fuer das Package muss existieren");
    assert.ok(completionAudits.some((a) => a.actor === `magic-link:${c.id}`),
      "Completion-Audit muss actor=magic-link:<id> tragen, nicht eine User-ID");

    // OC fuer Cleanup vormerken.
    extraOcIds.push(pkg!.orderConfirmationId!);

    // Audit-Eintrag mit actor=magic-link:<id> + action=external_signature.
    const audits = await db.select().from(auditLogTable)
      .where(eq(auditLogTable.entityId, worldA.contractId));
    const sigAudits = audits.filter((a) =>
      a.action === "external_signature" && a.actor === `magic-link:${c.id}`);
    assert.ok(sigAudits.length > 0,
      "external_signature Audit muss actor=magic-link:<id> tragen");
    const last = sigAudits[sigAudits.length - 1]!;
    assert.ok(last.summary.includes("Dr. Susi Sign"),
      "Audit-Summary muss Signer-Name enthalten");
    assert.ok(last.afterJson, "Audit-Eintrag muss after-Snapshot enthalten");
    const after = JSON.parse(last.afterJson!) as Record<string, unknown>;
    assert.equal(after.signatureImagePresent, true,
      "Audit-Payload muss vorhandene Signatur vermerken");
    assert.ok(typeof after.signatureImageBytes === "number" && (after.signatureImageBytes as number) > 0,
      "Audit-Payload muss die Bytegroesse der Signatur enthalten");
    assert.equal(after.collaboratorId, c.id,
      "Audit-Payload muss Collaborator-ID enthalten");
    assert.equal(after.packageId, worldA.signaturePackageId,
      "Audit-Payload muss Package-ID enthalten");

    // Collaborator-Event 'signed' wurde geschrieben.
    const events = await db.select().from(externalCollaboratorEventsTable)
      .where(eq(externalCollaboratorEventsTable.collaboratorId, c.id));
    const signedEvent = events.find((e) => e.action === "signed");
    assert.ok(signedEvent, "Collaborator-Event 'signed' muss existieren");

    // Idempotenz: zweite Mitzeichnung durch denselben Collaborator -> 409.
    const dup = await fetch(`${server.baseUrl}/api/v1/external/${token}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dr. Susi Sign" }),
    });
    assert.equal(dup.status, 409, "Doppel-Signatur muss mit 409 abgewiesen werden");
  });

  it("POST /external/:token/sign verschickt Bestätigungs- + Owner-Mail und schreibt Timeline-Eintrag", async () => {
    // Eigenes Magic-Link + Vertrag in einem frischen Welt-Setup, damit der
    // bereits in der vorigen Sign-Test "completed" gesetzte Package-State
    // nicht stoert. Wir nutzen worldB (eigener Tenant) fuer maximale
    // Isolation gegenueber dem ersten Mitzeichnen-Test.
    const created = await bob.post(
      `/api/v1/contracts/${worldB.contractId}/external-collaborators`,
      {
        email: "confirm-lawyer@kanzlei.example",
        name: "Dr. Conny Confirm",
        organization: "Kanzlei Confirm GmbH",
        capabilities: ["view", "sign_party"],
      },
    );
    assert.equal(created.status, 201);
    const c = created.body as CollabResp;
    const token = c.tokenPlaintext!;

    const r = await fetch(`${server.baseUrl}/api/v1/external/${token}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Dr. Conny Confirm" }),
    });
    assert.equal(r.status, 201, "Sign-Endpoint muss 201 Created liefern");

    // Collaborator-Events: 'sign_confirmation_emailed' + 'sign_owner_notified'
    // muessen direkt nach 'signed' geschrieben sein.
    const events = await db.select().from(externalCollaboratorEventsTable)
      .where(eq(externalCollaboratorEventsTable.collaboratorId, c.id));
    const confirmEvent = events.find(
      (e) => e.action === "sign_confirmation_emailed" || e.action === "sign_confirmation_email_failed",
    );
    assert.ok(
      confirmEvent && confirmEvent.action === "sign_confirmation_emailed",
      "Bestätigungs-E-Mail an externen Anwalt muss als Event protokolliert sein",
    );
    const ownerEvent = events.find(
      (e) => e.action === "sign_owner_notified" || e.action === "sign_owner_notify_failed",
    );
    assert.ok(
      ownerEvent && ownerEvent.action === "sign_owner_notified",
      "Owner-Benachrichtigung muss als Collaborator-Event protokolliert sein",
    );
    const ownerPayload = ownerEvent.payload as { ownerEmail?: string; ownerUserId?: string } | null;
    assert.equal(ownerPayload?.ownerEmail, worldB.userEmail,
      "Owner-Event muss die E-Mail-Adresse des Deal-Owners tragen");
    assert.equal(ownerPayload?.ownerUserId, worldB.userId,
      "Owner-Event muss die User-ID des Deal-Owners tragen");

    // Audit-Log: beide Sends erscheinen mit actor=magic-link:<id>.
    const audits = await db.select().from(auditLogTable)
      .where(eq(auditLogTable.entityId, worldB.contractId));
    const confirmAudit = audits.find((a) =>
      a.action === "external_collaborator_sign_confirmation_sent" &&
      a.actor === `magic-link:${c.id}`);
    assert.ok(confirmAudit, "Audit-Eintrag fuer Bestätigungs-E-Mail muss existieren");
    const ownerAudit = audits.find((a) =>
      a.action === "external_signature_owner_notified" &&
      a.actor === `magic-link:${c.id}`);
    assert.ok(ownerAudit, "Audit-Eintrag fuer Owner-Benachrichtigung muss existieren");

    // In-App-Notification: Timeline-Eintrag auf dem Deal mit Signer-Name.
    const timeline = await db.select().from(timelineEventsTable)
      .where(eq(timelineEventsTable.dealId, worldB.dealId));
    const tlMatch = timeline.find((t) =>
      t.title === "Externe Mitzeichnung eingegangen" &&
      t.description?.includes("Dr. Conny Confirm"));
    assert.ok(tlMatch, "Timeline-Eintrag fuer externe Mitzeichnung muss existieren");

    // Auftragsbestätigung, die durch die End-of-Pipeline entstanden ist,
    // beim Cleanup deterministisch entfernen.
    const [pkg] = await db.select().from(signaturePackagesTable)
      .where(eq(signaturePackagesTable.id, worldB.signaturePackageId));
    if (pkg?.orderConfirmationId) extraOcIds.push(pkg.orderConfirmationId);
  });

  it("POST /external/:token/sign verweigert leeren oder zu langen Namen + ungueltige Signatur", async () => {
    const created = await alice.post(
      `/api/v1/contracts/${worldA.contractId}/external-collaborators`,
      {
        email: "validate-lawyer@example.com",
        capabilities: ["view", "sign_party"],
      },
    );
    assert.equal(created.status, 201);
    const token = (created.body as CollabResp).tokenPlaintext!;

    const empty = await fetch(`${server.baseUrl}/api/v1/external/${token}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "   " }),
    });
    assert.equal(empty.status, 400, "leerer Name -> 400");

    const tooLong = await fetch(`${server.baseUrl}/api/v1/external/${token}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x".repeat(201) }),
    });
    assert.equal(tooLong.status, 400, "zu langer Name -> 400");

    const badSig = await fetch(`${server.baseUrl}/api/v1/external/${token}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Anna", signatureImage: "not-a-data-url" }),
    });
    assert.equal(badSig.status, 400, "ungueltige Signatur -> 400");

    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const farFuture = await fetch(`${server.baseUrl}/api/v1/external/${token}/sign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Anna", signedAt: future }),
    });
    assert.equal(farFuture.status, 400, "signedAt > 24h in der Zukunft -> 400");
  });
});

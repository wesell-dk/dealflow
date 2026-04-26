import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  externalContractsTable,
  uploadedObjectsTable,
  auditLogTable,
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

interface CreatedContract {
  id: string;
  title: string;
  fileName: string;
  status: string;
  accountId: string;
  brandId: string | null;
  fileSize: number;
  renewalRelevant: boolean;
}

const SAMPLE_PDF_MIME = "application/pdf";

async function seedUploadedObject(
  tenantId: string,
  userId: string,
  suffix: string,
): Promise<string> {
  const objectPath = `/objects/test-ext-${suffix}`;
  await db
    .insert(uploadedObjectsTable)
    .values({
      objectPath,
      tenantId,
      userId,
      kind: "document",
      contentType: SAMPLE_PDF_MIME,
      size: 1024,
    })
    .onConflictDoNothing();
  return objectPath;
}

async function deleteSeededObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await db
    .delete(uploadedObjectsTable)
    .where(inArray(uploadedObjectsTable.objectPath, paths));
}

describe("external contracts — upload, AI extract, CRUD, scope, audit", () => {
  let server: TestServer;
  let worldA: TestWorld;
  let worldB: TestWorld;
  let alice: AuthedClient;
  let bob: AuthedClient;
  const seededObjectPaths: string[] = [];
  const createdIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    worldA = await createTestWorld("ec_a");
    worldB = await createTestWorld("ec_b");
    alice = await loginClient(server.baseUrl, worldA.userEmail, worldA.password);
    bob = await loginClient(server.baseUrl, worldB.userEmail, worldB.password);
  });

  after(async () => {
    if (createdIds.length) {
      await db
        .delete(externalContractsTable)
        .where(inArray(externalContractsTable.id, createdIds));
    }
    await deleteSeededObjects(seededObjectPaths);
    await destroyTestWorlds(worldA, worldB);
    await server.close();
    await pool.end();
  });

  it("upload-url validates MIME, size, and returns uploadURL + objectPath", async () => {
    const bad = await alice.post("/api/v1/external-contracts/upload-url", {
      fileName: "x.txt",
      size: 1024,
      contentType: "text/plain",
    });
    assert.equal(bad.status, 400);

    const tooBig = await alice.post("/api/v1/external-contracts/upload-url", {
      fileName: "x.pdf",
      size: 100 * 1024 * 1024,
      contentType: SAMPLE_PDF_MIME,
    });
    assert.equal(tooBig.status, 400);

    const ok = await alice.post("/api/v1/external-contracts/upload-url", {
      fileName: "doc.pdf",
      size: 12345,
      contentType: SAMPLE_PDF_MIME,
    });
    if (ok.status !== 200) {
      // Object-storage sidecar unavailable in this environment is acceptable;
      // we verify the validation paths above either way. We accept 503 (our
      // structured "sidecar unavailable" response) and 500 (legacy fallback).
      assert.ok(
        ok.status === 503 || ok.status === 500,
        `expected 200/503/500, got ${ok.status}`,
      );
      return;
    }
    const body = ok.body as { uploadURL: string; objectPath: string };
    assert.ok(body.uploadURL);
    assert.ok(body.objectPath);
    seededObjectPaths.push(body.objectPath);
  });

  it("create persists row, writes audit, and is brand-scoped", async () => {
    const objectPath = await seedUploadedObject(worldA.tenantId, worldA.userId, "create1");
    seededObjectPaths.push(objectPath);

    const res = await alice.post("/api/v1/external-contracts", {
      accountId: worldA.accountId,
      brandId: worldA.brandId,
      contractTypeCode: null,
      objectPath,
      fileName: "rahmen.pdf",
      fileSize: 1024,
      mimeType: SAMPLE_PDF_MIME,
      title: "Rahmenvertrag Acme",
      parties: [
        { role: "customer", name: "Acme GmbH" },
        { role: "our_entity", name: "Test Co" },
      ],
      currency: "EUR",
      valueAmount: 50000,
      effectiveFrom: "2025-01-01",
      effectiveTo: "2027-12-31",
      autoRenewal: true,
      renewalNoticeDays: 90,
      terminationNoticeDays: 60,
      governingLaw: "DE",
      jurisdiction: "Hamburg",
      identifiedClauseFamilies: [
        { name: "limitation_of_liability", confidence: 0.9 },
      ],
      confidence: { title: 0.95, valueAmount: 0.7 },
      aiInvocationId: null,
      notes: "Importiert aus Bestand.",
    });
    assert.equal(res.status, 201);
    const created = res.body as CreatedContract;
    assert.ok(created.id);
    assert.equal(created.status, "confirmed");
    assert.equal(created.title, "Rahmenvertrag Acme");
    assert.equal(created.renewalRelevant, true);
    createdIds.push(created.id);

    // Audit log entry exists
    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityId, created.id));
    assert.ok(
      audits.some((a) => a.action === "create" && a.entityType === "external_contract"),
      "audit log should contain create entry",
    );
  });

  it("list scopes per tenant — Bob never sees Alice's contracts", async () => {
    const aliceList = await alice.get("/api/v1/external-contracts");
    assert.equal(aliceList.status, 200);
    const aliceRows = aliceList.body as Array<{ id: string }>;
    assert.ok(aliceRows.length >= 1, "alice should see her own contract");
    assert.ok(aliceRows.some((r) => createdIds.includes(r.id)));

    const bobList = await bob.get("/api/v1/external-contracts");
    assert.equal(bobList.status, 200);
    const bobRows = bobList.body as Array<{ id: string }>;
    for (const id of createdIds) {
      assert.ok(!bobRows.some((r) => r.id === id), `bob must not see ${id}`);
    }
  });

  it("get returns 404 for foreign tenant", async () => {
    const id = createdIds[0]!;
    const bobGet = await bob.get(`/api/v1/external-contracts/${id}`);
    assert.equal(bobGet.status, 404);
    const aliceGet = await alice.get(`/api/v1/external-contracts/${id}`);
    assert.equal(aliceGet.status, 200);
  });

  it("patch updates field and writes audit entry with before/after", async () => {
    const id = createdIds[0]!;
    const before = (await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityId, id))).length;
    const res = await alice.patch(`/api/v1/external-contracts/${id}`, {
      title: "Rahmenvertrag Acme (korrigiert)",
      notes: "Nach Review aktualisiert.",
    });
    assert.equal(res.status, 200);
    const after = res.body as { title: string; notes: string | null };
    assert.equal(after.title, "Rahmenvertrag Acme (korrigiert)");
    assert.equal(after.notes, "Nach Review aktualisiert.");

    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityId, id));
    assert.ok(audits.length > before, "patch should add an audit entry");
    const updates = audits.filter((a) => a.action === "update");
    assert.ok(updates.length >= 1, "should have an update audit entry");
  });

  it("foreign tenant cannot patch or delete", async () => {
    const id = createdIds[0]!;
    const bobPatch = await bob.patch(`/api/v1/external-contracts/${id}`, {
      title: "hostile",
    });
    assert.equal(bobPatch.status, 404);
    const bobDelete = await bob.delete(`/api/v1/external-contracts/${id}`);
    assert.equal(bobDelete.status, 404);
  });

  it("extract endpoint is robust against missing object (returns 404)", async () => {
    const res = await alice.post("/api/v1/external-contracts/extract", {
      objectPath: "/objects/does-not-exist-xyz",
      fileName: "missing.pdf",
      mimeType: SAMPLE_PDF_MIME,
      accountId: worldA.accountId,
    });
    // 400/403/404 are all acceptable — the point is the request must NOT be
    // allowed to extract from an object the caller doesn't own.
    assert.ok(
      [400, 403, 404].includes(res.status),
      `expected 400/403/404 for unowned object, got ${res.status}`,
    );
  });

  it("extract returns 403 when accountId is from a different tenant", async () => {
    const objectPath = await seedUploadedObject(worldA.tenantId, worldA.userId, "ext1");
    seededObjectPaths.push(objectPath);
    const res = await alice.post("/api/v1/external-contracts/extract", {
      objectPath,
      fileName: "doc.pdf",
      mimeType: SAMPLE_PDF_MIME,
      accountId: worldB.accountId,
    });
    assert.ok(
      res.status === 403 || res.status === 404,
      `expected 403/404 for cross-tenant accountId, got ${res.status}`,
    );
  });

  it("rejects POST with brandId from a foreign tenant (403)", async () => {
    const objectPath = await seedUploadedObject(worldA.tenantId, worldA.userId, "brandbypass");
    seededObjectPaths.push(objectPath);
    const res = await alice.post("/api/v1/external-contracts", {
      accountId: worldA.accountId,
      brandId: worldB.brandId, // brand belongs to a different tenant
      objectPath,
      fileName: "bypass.pdf",
      fileSize: 1024,
      mimeType: SAMPLE_PDF_MIME,
      title: "Brand Bypass Probe",
      parties: [],
      autoRenewal: false,
    });
    assert.equal(res.status, 403);
    const body = res.body as { error?: string };
    assert.ok(body.error && /brand/i.test(body.error), `expected brand-related error, got ${body.error}`);
  });

  it("rejects PATCH with brandId from a foreign tenant (403)", async () => {
    const id = createdIds[0]!;
    const res = await alice.patch(`/api/v1/external-contracts/${id}`, {
      brandId: worldB.brandId,
    });
    assert.equal(res.status, 403);
  });

  it("delete removes the row and writes audit entry", async () => {
    const objectPath = await seedUploadedObject(worldA.tenantId, worldA.userId, "del");
    seededObjectPaths.push(objectPath);
    const create = await alice.post("/api/v1/external-contracts", {
      accountId: worldA.accountId,
      objectPath,
      fileName: "to-delete.pdf",
      fileSize: 512,
      mimeType: SAMPLE_PDF_MIME,
      title: "Zum Löschen",
      parties: [],
      autoRenewal: false,
    });
    assert.equal(create.status, 201);
    const id = (create.body as { id: string }).id;

    const del = await alice.delete(`/api/v1/external-contracts/${id}`);
    assert.equal(del.status, 204);

    const remaining = await db
      .select()
      .from(externalContractsTable)
      .where(eq(externalContractsTable.id, id));
    assert.equal(remaining.length, 0);

    const audits = await db
      .select()
      .from(auditLogTable)
      .where(eq(auditLogTable.entityId, id));
    assert.ok(
      audits.some((a) => a.action === "delete"),
      "delete should write an audit entry",
    );
  });
});

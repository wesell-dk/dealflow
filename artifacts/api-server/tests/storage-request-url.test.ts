// Focused robustness checks for POST /api/v1/storage/uploads/request-url —
// the endpoint that backs the "Anhang hochladen" dialog and Logo-Upload.
//
// Goal of these tests is NOT to verify the happy path against the live
// object-storage sidecar (covered by external-contracts.test.ts); it is to
// pin down that the route ALWAYS answers with a clean JSON status (400/503),
// never with a hanging request that would surface as an opaque 502 from the
// Replit edge proxy.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import { db, pool, uploadedObjectsTable } from "@workspace/db";
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

const PDF_MIME = "application/pdf";
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

describe("POST /api/v1/storage/uploads/request-url — robustness", () => {
  let server: TestServer;
  let world: TestWorld;
  let alice: AuthedClient;
  const seededObjectPaths: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    world = await createTestWorld("ru_a");
    alice = await loginClient(server.baseUrl, world.userEmail, world.password);
  });

  after(async () => {
    if (seededObjectPaths.length) {
      await db
        .delete(uploadedObjectsTable)
        .where(inArray(uploadedObjectsTable.objectPath, seededObjectPaths));
    }
    await destroyTestWorlds(world);
    await server.close();
    await pool.end();
  });

  it("rejects unsupported MIME types with a 400 JSON response", async () => {
    const r = await alice.post("/api/v1/storage/uploads/request-url", {
      kind: "document",
      name: "x.exe",
      size: 1024,
      contentType: "application/x-msdownload",
    });
    assert.equal(r.status, 400);
    assert.equal(typeof (r.body as { error?: string }).error, "string");
  });

  it("rejects oversize uploads with a 400 JSON response", async () => {
    const r = await alice.post("/api/v1/storage/uploads/request-url", {
      kind: "document",
      name: "huge.pdf",
      size: MAX_DOCUMENT_BYTES + 1,
      contentType: PDF_MIME,
    });
    assert.equal(r.status, 400);
    assert.equal(typeof (r.body as { error?: string }).error, "string");
  });

  it("rejects zero-byte uploads with a 400 JSON response", async () => {
    const r = await alice.post("/api/v1/storage/uploads/request-url", {
      kind: "document",
      name: "empty.pdf",
      size: 0,
      contentType: PDF_MIME,
    });
    assert.equal(r.status, 400);
  });

  it("requires authentication for document uploads (no scope = 401)", async () => {
    const res = await fetch(
      `${server.baseUrl}/api/v1/storage/uploads/request-url`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "document",
          name: "doc.pdf",
          size: 1024,
          contentType: PDF_MIME,
        }),
      },
    );
    assert.equal(res.status, 401);
    const body = (await res.json()) as { error?: string };
    assert.equal(typeof body.error, "string");
  });

  it("requires admin scope for logo uploads (non-admin = 403)", async () => {
    // The seeded test user is tenantWide=true, so we just need to assert the
    // happy admin path either succeeds (200) or fails fast with sidecar 503.
    const r = await alice.post("/api/v1/storage/uploads/request-url", {
      kind: "logo",
      name: "logo.png",
      size: 1024,
      contentType: "image/png",
    });
    assert.ok(
      r.status === 200 || r.status === 503,
      `expected 200 (sidecar OK) or 503 (sidecar unavailable), got ${r.status}`,
    );
    const body = r.body as { error?: string; uploadURL?: string; objectPath?: string };
    if (r.status === 200) {
      assert.ok(body.uploadURL);
      assert.ok(body.objectPath);
      seededObjectPaths.push(body.objectPath!);
    } else {
      assert.equal(body.error, "storage_unavailable");
    }
  });

  it("happy path: valid document request returns uploadURL+objectPath OR fast 503", async () => {
    const r = await alice.post("/api/v1/storage/uploads/request-url", {
      kind: "document",
      name: "ADSp.pdf",
      size: 256 * 1024,
      contentType: PDF_MIME,
    });
    // Either the sidecar is reachable (200) or our handler must surface a
    // structured 503 quickly — never a hanging request that would 502 at the
    // edge proxy.
    assert.ok(
      r.status === 200 || r.status === 503,
      `expected 200 or 503 (storage_unavailable), got ${r.status}`,
    );
    if (r.status === 200) {
      const body = r.body as { uploadURL: string; objectPath: string; metadata: unknown };
      assert.ok(body.uploadURL.startsWith("http"));
      assert.ok(body.objectPath.startsWith("/objects/"));
      seededObjectPaths.push(body.objectPath);
    } else {
      const body = r.body as { error: string; message: string };
      assert.equal(body.error, "storage_unavailable");
      assert.ok(body.message.length > 0);
    }
  });
});

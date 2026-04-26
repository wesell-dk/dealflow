import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  brandsTable,
  companiesTable,
  dealsTable,
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
 * Task #226: POST /api/deals muss ablehnen, wenn die übermittelte
 * `companyId` nicht zur `brandId` passt. Jede Marke gehört im Datenmodell
 * (`brands.company_id` notNull) zu genau einer Company. Das Frontend leitet
 * die Company seit dem Task automatisch aus der Marke ab — die Backend-
 * Validierung ist die Sicherheitsschicht für direkte API-Clients.
 */
describe("POST /api/deals brand/company consistency (Task #226)", () => {
  let server: TestServer;
  let world: TestWorld;
  let client: AuthedClient;
  // Zweite Company + Brand im selben Tenant, um eine bewusst inkonsistente
  // Kombination (brandId aus World A, companyId aus World B) testen zu können.
  let otherCompanyId: string;
  let otherBrandId: string;
  const createdDealIds: string[] = [];

  before(async () => {
    await sweepStaleTestData();
    server = await startTestServer();
    world = await createTestWorld("brandcompany");
    client = await loginClient(server.baseUrl, world.userEmail, world.password);

    otherCompanyId = `${world.runId}_co2`;
    otherBrandId = `${world.runId}_br2`;
    await db.insert(companiesTable).values({
      id: otherCompanyId,
      tenantId: world.tenantId,
      name: "Second Co",
      legalName: "Second Co GmbH",
      country: "DE",
      currency: "EUR",
    });
    await db.insert(brandsTable).values({
      id: otherBrandId,
      companyId: otherCompanyId,
      name: "Second Brand",
      color: "#111111",
      voice: "neutral",
    });
  });

  after(async () => {
    if (createdDealIds.length) {
      await db.delete(dealsTable).where(inArray(dealsTable.id, createdDealIds));
    }
    await db.delete(brandsTable).where(eq(brandsTable.id, otherBrandId));
    await db.delete(companiesTable).where(eq(companiesTable.id, otherCompanyId));
    await destroyTestWorlds(world);
    await server.close();
  });

  it("rejects with 422 when companyId does not match the brand's company", async () => {
    const closeDate = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    const res = await client.post("/api/deals", {
      name: "Mismatch Deal",
      accountId: world.accountId,
      value: 1000,
      stage: "qualified",
      // brandId gehört zu world.companyId — wir senden bewusst die
      // andere Company, um die Konsistenzprüfung zu triggern.
      brandId: world.brandId,
      companyId: otherCompanyId,
      ownerId: world.userId,
      expectedCloseDate: closeDate,
    });
    assert.equal(res.status, 422, `expected 422, got ${res.status} body=${JSON.stringify(res.body)}`);
    const body = res.body as { error?: string; message?: string };
    assert.equal(body.error, "brand/company mismatch");
    assert.match(body.message ?? "", /Company.*Marke|Marke.*Company/i);
  });

  it("accepts when companyId matches the brand's company", async () => {
    const closeDate = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    const res = await client.post("/api/deals", {
      name: "Consistent Deal",
      accountId: world.accountId,
      value: 2000,
      stage: "qualified",
      brandId: world.brandId,
      companyId: world.companyId,
      ownerId: world.userId,
      expectedCloseDate: closeDate,
    });
    assert.equal(res.status, 201, `expected 201, got ${res.status} body=${JSON.stringify(res.body)}`);
    const body = res.body as { id: string; brandId: string; companyId: string };
    assert.ok(body.id);
    assert.equal(body.brandId, world.brandId);
    assert.equal(body.companyId, world.companyId);
    createdDealIds.push(body.id);
  });

  it("rejects with 422 when brandId does not exist", async () => {
    const closeDate = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    const res = await client.post("/api/deals", {
      name: "Bad Brand Deal",
      accountId: world.accountId,
      value: 1000,
      stage: "qualified",
      brandId: `${world.runId}_does_not_exist`,
      companyId: world.companyId,
      ownerId: world.userId,
      expectedCloseDate: closeDate,
    });
    assert.equal(res.status, 422, `expected 422, got ${res.status} body=${JSON.stringify(res.body)}`);
    const body = res.body as { error?: string };
    assert.equal(body.error, "invalid brandId");
  });

  describe("PATCH /api/deals/:id (Task #226)", () => {
    it("auto-derives companyId when brandId is changed", async () => {
      // Setup: bestehender Test-Deal nutzt world.brandId/world.companyId.
      // Wir wechseln auf otherBrandId — Server muss companyId automatisch
      // auf otherCompanyId setzen, ohne dass der Client companyId mitschickt.
      const res = await client.patch(`/api/deals/${world.dealId}`, {
        brandId: otherBrandId,
      });
      assert.equal(res.status, 200, `expected 200, got ${res.status} body=${JSON.stringify(res.body)}`);
      const body = res.body as { brandId: string; companyId: string };
      assert.equal(body.brandId, otherBrandId);
      assert.equal(body.companyId, otherCompanyId);

      // Persistenz prüfen — auch in der DB muss companyId mitgewandert sein.
      const [row] = await db.select().from(dealsTable).where(eq(dealsTable.id, world.dealId));
      assert.equal(row?.brandId, otherBrandId);
      assert.equal(row?.companyId, otherCompanyId);

      // Reset für nachfolgende Tests.
      await db.update(dealsTable)
        .set({ brandId: world.brandId, companyId: world.companyId })
        .where(eq(dealsTable.id, world.dealId));
    });

    it("rejects with 422 when brandId+companyId combo is inconsistent", async () => {
      const res = await client.patch(`/api/deals/${world.dealId}`, {
        brandId: world.brandId,
        // companyId aus der ANDEREN Welt — passt nicht zu world.brandId.
        companyId: otherCompanyId,
      });
      assert.equal(res.status, 422, `expected 422, got ${res.status} body=${JSON.stringify(res.body)}`);
      const body = res.body as { error?: string };
      assert.equal(body.error, "brand/company mismatch");
    });

    it("rejects with 422 when only companyId is sent (without matching brand)", async () => {
      // Deal hängt aktuell an world.brandId → world.companyId. Wir versuchen,
      // nur companyId auf otherCompanyId zu setzen — ohne den dazu passenden
      // Brand-Wechsel. Muss abgelehnt werden, sonst wäre die Beziehung
      // brand→company verletzt.
      const res = await client.patch(`/api/deals/${world.dealId}`, {
        companyId: otherCompanyId,
      });
      assert.equal(res.status, 422, `expected 422, got ${res.status} body=${JSON.stringify(res.body)}`);
      const body = res.body as { error?: string };
      assert.equal(body.error, "brand/company mismatch");
    });

    it("rejects with 422 when brandId points to a non-existent brand", async () => {
      const res = await client.patch(`/api/deals/${world.dealId}`, {
        brandId: `${world.runId}_no_such_brand`,
      });
      assert.equal(res.status, 422, `expected 422, got ${res.status} body=${JSON.stringify(res.body)}`);
      const body = res.body as { error?: string };
      assert.equal(body.error, "invalid brandId");
    });

    it("accepts brandId+companyId when both match", async () => {
      // Wechsel auf otherBrandId, dabei korrekte otherCompanyId mitsenden —
      // muss durchgehen.
      const res = await client.patch(`/api/deals/${world.dealId}`, {
        brandId: otherBrandId,
        companyId: otherCompanyId,
      });
      assert.equal(res.status, 200, `expected 200, got ${res.status} body=${JSON.stringify(res.body)}`);
      const body = res.body as { brandId: string; companyId: string };
      assert.equal(body.brandId, otherBrandId);
      assert.equal(body.companyId, otherCompanyId);

      // Reset.
      await db.update(dealsTable)
        .set({ brandId: world.brandId, companyId: world.companyId })
        .where(eq(dealsTable.id, world.dealId));
    });
  });
});

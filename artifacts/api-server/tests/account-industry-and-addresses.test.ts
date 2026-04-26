import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { seedIfEmpty } from "../src/lib/seed";
import {
  loginClient,
  startTestServer,
  type AuthedClient,
  type TestServer,
} from "./server";

// Targeted tests for Task #223:
//   • industry strict validation (code-shape but unknown WZ → 422)
//   • industry free-text → mapped on the fly (legacy compat)
//   • address invariants: at least one active billing address per account
//     across deactivate, type-change, and combinations
//   • legacy billingAddress mirror is reconciled from the address model
//     after PATCH /accounts (no drift to null while a primary billing
//     address still exists)
describe("Task #223 — industry validation + address invariants", () => {
  let server: TestServer;
  let client: AuthedClient;
  // Best-effort cleanup — Test seed uses a stable tenant; we soft-archive
  // accounts created here so the database stays tidy for other tests.
  const createdAccountIds: string[] = [];

  before(async () => {
    await seedIfEmpty();
    server = await startTestServer();
    client = await loginClient(server.baseUrl, "priya@helix.com", "dealflow");
  });

  after(async () => {
    for (const id of createdAccountIds) {
      // Hard delete via DELETE returns 204; ignore failures.
      await client.delete(`/api/accounts/${id}`).catch(() => {});
    }
    if (server) await server.close();
    await pool.end().catch(() => {});
  });

  async function createAccount(industry: string): Promise<{ status: number; id?: string; body: unknown }> {
    const r = await client.post(`/api/accounts`, {
      name: `WZ-Test ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      industry,
      country: "DE",
    });
    const body = r.body as { id?: string };
    if (r.status === 201 && body?.id) createdAccountIds.push(body.id);
    return { status: r.status, id: body?.id, body: r.body };
  }

  it("rejects code-shaped but unknown WZ value with 422", async () => {
    // 99.01 is not in the curated WZ-2008 list; only 99.99 (Sonstiges) is.
    const r = await createAccount("99.01");
    assert.equal(r.status, 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body)}`);
    const body = r.body as { error?: string; message?: string };
    assert.equal(body.error, "invalid industry");
    assert.match(body.message ?? "", /WZ-Code/);
  });

  it("accepts a valid WZ code as-is", async () => {
    const r = await createAccount("62.01");
    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    const body = r.body as { industry?: string; industryLabel?: string | null };
    assert.equal(body.industry, "62.01");
    assert.ok(body.industryLabel && body.industryLabel.length > 0);
  });

  it("maps free-text industry heuristically (legacy compat)", async () => {
    const r = await createAccount("Software Engineering");
    assert.equal(r.status, 201, `expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
    const body = r.body as { industry?: string };
    // Heuristic in wz2008.ts maps software/* to 62.01.
    assert.equal(body.industry, "62.01");
  });

  it("blocks PATCH that removes 'rechnungsadresse' from the only billing address", async () => {
    const created = await createAccount("62.01");
    assert.equal(created.status, 201);
    const accountId = created.id!;
    // Add an explicit billing+HQ standort.
    const add = await client.post(`/api/accounts/${accountId}/addresses`, {
      label: "Hauptsitz",
      types: ["hauptsitz", "rechnungsadresse"],
      isPrimary: true,
      street: "Teststr. 1",
      postalCode: "10115",
      city: "Berlin",
      country: "DE",
    });
    assert.equal(add.status, 201, `seed address failed: ${JSON.stringify(add.body)}`);
    const addrId = (add.body as { id: string }).id;

    // Try to drop 'rechnungsadresse' via type change → must 409.
    const patch = await client.patch(`/api/accounts/${accountId}/addresses/${addrId}`, {
      types: ["hauptsitz"],
    });
    assert.equal(patch.status, 409, `expected 409, got ${patch.status}: ${JSON.stringify(patch.body)}`);
    const body = patch.body as { error?: string; message?: string };
    assert.equal(body.error, "last billing address protected");
    assert.match(body.message ?? "", /Rechnungsadresse/);
  });

  it("blocks deactivating the last active billing address", async () => {
    const created = await createAccount("62.01");
    const accountId = created.id!;
    const add = await client.post(`/api/accounts/${accountId}/addresses`, {
      label: "Rechnung",
      types: ["rechnungsadresse"],
      isPrimary: true,
      street: "Teststr. 2",
      postalCode: "10115",
      city: "Berlin",
      country: "DE",
    });
    const addrId = (add.body as { id: string }).id;
    const patch = await client.patch(`/api/accounts/${accountId}/addresses/${addrId}`, {
      isActive: false,
    });
    assert.equal(patch.status, 409, `expected 409, got ${patch.status}: ${JSON.stringify(patch.body)}`);
  });

  it("rejects address creation without PLZ, Ort or Land (422)", async () => {
    const created = await createAccount("62.01");
    const accountId = created.id!;
    // Missing country → 422
    const r = await client.post(`/api/accounts/${accountId}/addresses`, {
      label: "Unvollständig",
      types: ["hauptsitz", "rechnungsadresse"],
      street: "Teststr. 1",
      postalCode: "10115",
      city: "Berlin",
      // country: undefined — fehlt absichtlich
    });
    assert.equal(r.status, 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body)}`);
    const body = r.body as { error?: string; message?: string };
    assert.equal(body.error, "incomplete address");
    assert.match(body.message ?? "", /PLZ.*Ort.*Land/);
  });

  it("first non-billing address requires existing billing — 422", async () => {
    // Account ohne Legacy-billingAddress (createAccount sendet kein billingAddress).
    const created = await createAccount("62.01");
    const accountId = created.id!;
    // Erster Standort, der KEINE Rechnungsadresse ist → muss abgelehnt werden,
    // damit die Account-weite Invariant "≥1 active billing" nicht verletzt wird.
    const r = await client.post(`/api/accounts/${accountId}/addresses`, {
      label: "Niederlassung Süd",
      types: ["niederlassung"],
      street: "Lagerweg 1",
      postalCode: "10115",
      city: "Berlin",
      country: "DE",
    });
    assert.equal(r.status, 422, `expected 422, got ${r.status}: ${JSON.stringify(r.body)}`);
    const body = r.body as { error?: string; message?: string };
    assert.equal(body.error, "first address must include billing");
    assert.match(body.message ?? "", /Rechnungsadresse/);
  });

  it("mirror falls back to remaining active billing after delete of primary", async () => {
    const created = await createAccount("62.01");
    const accountId = created.id!;
    // Primary billing.
    const a = await client.post(`/api/accounts/${accountId}/addresses`, {
      label: "Rechnung HQ",
      types: ["rechnungsadresse"],
      isPrimary: true,
      street: "HQ-Str. 1",
      postalCode: "10115",
      city: "Berlin",
      country: "DE",
    });
    assert.equal(a.status, 201);
    const primaryId = (a.body as { id: string }).id;
    // Zweite, NICHT-primäre, aber aktive Rechnungsadresse.
    const b = await client.post(`/api/accounts/${accountId}/addresses`, {
      label: "Rechnung Filiale",
      types: ["rechnungsadresse"],
      isPrimary: false,
      street: "Filial-Str. 7",
      postalCode: "70173",
      city: "Stuttgart",
      country: "DE",
    });
    assert.equal(b.status, 201);
    // Delete primary → Mirror muss auf die verbleibende aktive Rechnungs-
    // adresse fallback'en (nicht null bleiben).
    const del = await client.delete(`/api/accounts/${accountId}/addresses/${primaryId}`);
    assert.equal(del.status, 204);
    const acc = await client.get(`/api/accounts/${accountId}`);
    assert.equal(acc.status, 200);
    const after = acc.body as { billingAddress?: string | null };
    assert.ok(
      after.billingAddress && /Filial-Str\. 7/.test(after.billingAddress),
      `mirror should fall back to remaining active billing, got ${JSON.stringify(after.billingAddress)}`,
    );
  });

  it("legacy billingAddress mirror is restored from primary billing after PATCH /accounts", async () => {
    const created = await createAccount("62.01");
    const accountId = created.id!;
    // Create a primary billing standort — this should also populate the
    // legacy mirror via syncLegacyBillingFromAddresses.
    await client.post(`/api/accounts/${accountId}/addresses`, {
      label: "Rechnung",
      types: ["rechnungsadresse"],
      isPrimary: true,
      street: "Mirror-Str. 9",
      postalCode: "70173",
      city: "Stuttgart",
      country: "DE",
    });
    // Try to null the legacy mirror via PATCH /accounts — server must
    // restore it from the primary billing standort, not let it drift.
    const patch = await client.patch(`/api/accounts/${accountId}`, {
      billingAddress: null,
    });
    assert.equal(patch.status, 200);
    const after = patch.body as { billingAddress?: string | null };
    assert.ok(
      after.billingAddress && /Mirror-Str\. 9/.test(after.billingAddress),
      `mirror should be restored from primary billing, got ${JSON.stringify(after.billingAddress)}`,
    );
  });
});

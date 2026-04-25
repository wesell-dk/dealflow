import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  db,
  brandsTable,
  contractsTable,
  contractClausesTable,
  clauseVariantsTable,
  clauseVariantTranslationsTable,
  usersTable,
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
import { buildApprovalContext } from "../src/lib/ai/context";
import { buildScope } from "../src/lib/scope";
import { seedContractMvpAugmentationIdempotent } from "../src/lib/seed";

type Clause = {
  id: string;
  contractId: string;
  family: string;
  familyId: string | null;
  activeVariantId: string | null;
  variant: string;
  summary: string;
  body: string;
  translationLocale: "de" | "en";
  translationMissing: boolean;
};

type ContractDto = { id: string; language: "de" | "en" };

describe("contract language switching DE↔EN (E2E)", () => {
  let server: TestServer;
  let world: TestWorld;
  let client: AuthedClient;
  let createdContractId = "";
  let testVariantId = "";

  before(async () => {
    await sweepStaleTestData();
    // The test server boots from src/app and skips the boot-time seeding done
    // by src/index. Translations live in clause_variant_translations and are
    // populated by the contract-MVP augmentation seed. Run it idempotently
    // here so every fresh CI database carries DE+EN translations for the
    // baseline cv_liab_3 / cv_term_3 variants the test depends on.
    await seedContractMvpAugmentationIdempotent();
    server = await startTestServer();
    world = await createTestWorld("lng");

    // Make sure the test brand seeds clauses we know are bilingual: cv_liab_3
    // (Liability) and cv_term_3 (Term & Termination) both ship with DE+EN
    // translations via augmentClauseTranslations().
    await db.update(brandsTable).set({
      defaultClauseVariants: {
        cf_liab: "cv_liab_3",
        cf_term: "cv_term_3",
      } as Record<string, string>,
    }).where(eq(brandsTable.id, world.brandId));

    client = await loginClient(server.baseUrl, world.userEmail, world.password);
  });

  after(async () => {
    if (createdContractId) {
      await db.delete(contractClausesTable)
        .where(eq(contractClausesTable.contractId, createdContractId));
      await db.delete(contractsTable)
        .where(eq(contractsTable.id, createdContractId));
    }
    if (testVariantId) {
      await db.delete(clauseVariantTranslationsTable)
        .where(eq(clauseVariantTranslationsTable.variantId, testVariantId));
      await db.delete(clauseVariantsTable)
        .where(eq(clauseVariantsTable.id, testVariantId));
    }
    await destroyTestWorlds(world);
    await server.close();
  });

  it("creates a contract with German clause text by default", async () => {
    const res = await client.post("/api/v1/contracts", {
      dealId: world.dealId,
      title: "Lang-Switch Test Contract",
      template: "standard",
      brandId: world.brandId,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const body = res.body as ContractDto;
    assert.ok(body.id);
    createdContractId = body.id;
    assert.equal(body.language, "de");

    const cl = await client.get(`/api/v1/contracts/${createdContractId}/clauses`);
    assert.equal(cl.status, 200);
    const clauses = cl.body as Clause[];
    assert.ok(clauses.length >= 2, `expected ≥2 seeded clauses, got ${clauses.length}`);
    const term = clauses.find(c => c.familyId === "cf_term");
    assert.ok(term, "expected cf_term clause");
    assert.equal(term.translationLocale, "de");
    assert.equal(term.translationMissing, false);
    assert.match(
      term.body,
      /Mindestlaufzeit|Monate/,
      `expected German body for cf_term, got: ${term.body}`,
    );
  });

  it("switching the contract to EN renders English clause text", async () => {
    const patch = await client.patch(
      `/api/v1/contracts/${createdContractId}`,
      { language: "en" },
    );
    assert.equal(patch.status, 200);
    assert.equal((patch.body as ContractDto).language, "en");

    const cl = await client.get(`/api/v1/contracts/${createdContractId}/clauses`);
    assert.equal(cl.status, 200);
    const clauses = cl.body as Clause[];
    const term = clauses.find(c => c.familyId === "cf_term");
    assert.ok(term);
    assert.equal(term.translationLocale, "en");
    assert.equal(term.translationMissing, false);
    assert.match(
      term.body,
      /(months|opt-out|term)/i,
      `expected English body for cf_term, got: ${term.body}`,
    );
    // Negative-check: nothing recognisably German in the EN body. This is the
    // regression guard the task explicitly calls out — a snapshot/render
    // change must not silently leak DE clauses into an EN contract.
    assert.doesNotMatch(
      term.body,
      /Mindestlaufzeit|Vertragsstrafe|Geheimhaltung/,
      `EN clause body unexpectedly contains German: ${term.body}`,
    );
  });

  it("switching the contract back to DE restores German clause text", async () => {
    const patch = await client.patch(
      `/api/v1/contracts/${createdContractId}`,
      { language: "de" },
    );
    assert.equal(patch.status, 200);
    assert.equal((patch.body as ContractDto).language, "de");

    const cl = await client.get(`/api/v1/contracts/${createdContractId}/clauses`);
    const clauses = cl.body as Clause[];
    const term = clauses.find(c => c.familyId === "cf_term");
    assert.ok(term);
    assert.equal(term.translationLocale, "de");
    assert.equal(term.translationMissing, false);
    assert.match(term.body, /Mindestlaufzeit|Monate/);
  });

  it("flags clauses without EN translation as translationMissing in EN mode", async () => {
    // Insert a fresh test-only clause variant under cf_liab with NO EN
    // translation. The seed only covers numbered cv_liab_1..5, so a uniquely
    // suffixed test variant cannot collide with future seed data.
    testVariantId = `cv_test_lng_${world.runId}`;
    await db.insert(clauseVariantsTable).values({
      id: testVariantId,
      familyId: "cf_liab",
      tone: "moderat",
      severity: "neutral",
      severityScore: 2,
      name: "Test Variant ohne EN-Übersetzung",
      summary: "Diese Variante hat absichtlich keine EN-Übersetzung.",
      body: "Eine reine Test-Klausel ohne englische Fassung; Sprache=DE only.",
    });

    // Patch the cf_liab clause on our contract to use the new variant.
    const cl = await client.get(`/api/v1/contracts/${createdContractId}/clauses`);
    const liabClause = (cl.body as Clause[]).find(c => c.familyId === "cf_liab");
    assert.ok(liabClause, "expected a cf_liab clause to switch");
    const sw = await client.patch(
      `/api/v1/contract-clauses/${liabClause.id}`,
      { variantId: testVariantId },
    );
    assert.equal(sw.status, 200, JSON.stringify(sw.body));

    // Switch contract to EN — now the cf_liab clause must fall back to DE
    // and the API must flag translationMissing: true.
    const ptc = await client.patch(
      `/api/v1/contracts/${createdContractId}`,
      { language: "en" },
    );
    assert.equal(ptc.status, 200);
    assert.equal((ptc.body as ContractDto).language, "en");

    const cl2 = await client.get(`/api/v1/contracts/${createdContractId}/clauses`);
    const liabClause2 = (cl2.body as Clause[]).find(c => c.id === liabClause.id);
    assert.ok(liabClause2);
    assert.equal(
      liabClause2.translationLocale,
      "de",
      "fallback to DE when EN translation is absent",
    );
    assert.equal(liabClause2.translationMissing, true);
    assert.match(liabClause2.body, /Test-Klausel/);

    // The cf_term clause still has an EN translation — it must NOT be flagged.
    const termClause2 = (cl2.body as Clause[]).find(c => c.familyId === "cf_term");
    assert.ok(termClause2);
    assert.equal(termClause2.translationMissing, false);
  });

  it("approval-readiness context lists 'fehlende Übersetzung' for the missing-EN clause", async () => {
    // The HTTP route POST /copilot/approval-readiness/:approvalId is gated by
    // isAIConfigured(). The "Übersetzung [en] fehlt: <family>" line is
    // appended *deterministically* from ctx.missingTranslations regardless of
    // what the AI returns. We therefore test the source-of-truth function
    // directly so the regression guard works in CI without an AI key set.
    const [userRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, world.userId));
    assert.ok(userRow);
    const scope = buildScope(userRow);
    const reqLike = { scope } as unknown as Parameters<typeof buildApprovalContext>[0];

    const ctx = await buildApprovalContext(reqLike, world.approvalId);
    assert.ok(ctx.contract, "ctx.contract should resolve to the most-recent contract");
    assert.equal(ctx.contract.id, createdContractId);
    assert.equal(ctx.contract.language, "en");
    assert.ok(
      ctx.missingTranslations.length >= 1,
      `expected ≥1 missing-translation entry, got ${JSON.stringify(ctx.missingTranslations)}`,
    );
    const missingForLiab = ctx.missingTranslations.find(
      m => m.variantId === testVariantId,
    );
    assert.ok(
      missingForLiab,
      `expected a missing-translation entry for ${testVariantId}, got: ${JSON.stringify(ctx.missingTranslations)}`,
    );
    assert.equal(missingForLiab.locale, "en");
    assert.equal(missingForLiab.family, "Liability");

    // Re-derive the deterministic "Übersetzung [en] fehlt: <family>" line
    // exactly as dealflow.ts does in the approval-readiness route — this is
    // the human-readable Approval-Readiness "fehlende Übersetzung" message.
    const families = Array.from(
      new Set(ctx.missingTranslations.map(m => m.family)),
    ).sort();
    const lines = families.map(f => `Übersetzung [en] fehlt: ${f}`);
    assert.ok(
      lines.includes("Übersetzung [en] fehlt: Liability"),
      `expected readiness line for Liability, got: ${JSON.stringify(lines)}`,
    );
  });
});

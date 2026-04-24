import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { seedIfEmpty } from "../src/lib/seed";
import { loginClient, startTestServer, type AuthedClient, type TestServer } from "./server";

interface ValidationErrorBody {
  error?: string;
  issues?: unknown;
}

interface NegativeCase {
  name: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body: unknown;
}

const CASES: NegativeCase[] = [
  { name: "accounts.create.missing-name",   method: "POST", path: "/api/accounts",                                body: {} },
  { name: "deals.create.wrong-types",       method: "POST", path: "/api/deals",                                   body: { name: "x", value: "nan" } },
  { name: "quotes.create.missing-fields",   method: "POST", path: "/api/quotes",                                  body: {} },
  { name: "approvals.decide.bad-body",      method: "POST", path: "/api/approvals/a_1/decide",                    body: {} },
  { name: "contracts.create.missing",       method: "POST", path: "/api/contracts",                               body: {} },
  { name: "amendments.create.missing",      method: "POST", path: "/api/contracts/c_1/amendments",                body: {} },
  { name: "negotiations.counter.missing",   method: "POST", path: "/api/negotiations/n_1/counterproposal",        body: {} },
  { name: "signatures.escalate.missing",    method: "POST", path: "/api/signatures/s_1/escalate",                 body: {} },
  { name: "orders.handover.missing",        method: "POST", path: "/api/order-confirmations/oc_1/handover",       body: {} },
  { name: "copilot.message.missing",        method: "POST", path: "/api/copilot/threads/t_1/messages",            body: {} },
  { name: "gdpr.forget.missing",            method: "POST", path: "/api/gdpr/forget",                             body: {} },
  { name: "admin.roles.missing-name",       method: "POST", path: "/api/admin/roles",                             body: { description: "x" } },
  { name: "audit.manual.missing-fields",    method: "POST", path: "/api/audit/manual",                            body: {} },
];

describe("negative validation — bad bodies must return 422 with issues", () => {
  let server: TestServer;
  let client: AuthedClient;

  before(async () => {
    // The seed is idempotent — only inserts when the tenants table is empty.
    // Required so the demo login below resolves to a real user.
    await seedIfEmpty();
    server = await startTestServer();
    const email = process.env["LOGIN_EMAIL"] ?? "priya@helix.com";
    const password = process.env["LOGIN_PASSWORD"] ?? "dealflow";
    client = await loginClient(server.baseUrl, email, password);
  });

  after(async () => {
    if (server) await server.close();
    await pool.end().catch(() => {});
  });

  for (const c of CASES) {
    it(`${c.name} — ${c.method} ${c.path} → 422`, async () => {
      const res = await fetch(`${server.baseUrl}${c.path}`, {
        method: c.method,
        headers: { "content-type": "application/json", cookie: client.cookie },
        body: JSON.stringify(c.body),
      });
      const text = await res.text();
      let parsed: ValidationErrorBody | string = text;
      try {
        parsed = text ? (JSON.parse(text) as ValidationErrorBody) : {};
      } catch {
        // leave as text — the assertion below will surface it
      }
      assert.equal(
        res.status,
        422,
        `expected 422, got ${res.status} for ${c.method} ${c.path}; body=${text}`,
      );
      assert.equal(
        typeof parsed === "object" && parsed !== null ? parsed.error : undefined,
        "validation",
        `expected error="validation" in ${text}`,
      );
      assert.ok(
        typeof parsed === "object" && parsed !== null && "issues" in parsed,
        `expected an "issues" array in ${text}`,
      );
    });
  }
});

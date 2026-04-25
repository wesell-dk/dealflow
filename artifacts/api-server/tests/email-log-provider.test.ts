import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendEmail } from "../src/lib/email";
import { logger } from "../src/lib/logger";

/**
 * SECURITY-Regression: the local "log" email provider must NEVER write the
 * email body, subject, or recipient address to logs — invite emails contain
 * magic-link tokens that act as bearer credentials. Centralized logs are a
 * common credential-leak vector, so we enforce minimal-metadata logging.
 */
describe("email log provider — credential-safe logging", () => {
  let prevApiKey: string | undefined;
  let captured: Array<{ obj: unknown; msg?: string }> = [];
  let origInfo: typeof logger.info;
  let origWarn: typeof logger.warn;

  beforeEach(() => {
    prevApiKey = process.env["RESEND_API_KEY"];
    // Force the log provider — sendEmail picks Resend if RESEND_API_KEY is set.
    delete process.env["RESEND_API_KEY"];
    captured = [];
    origInfo = logger.info.bind(logger);
    origWarn = logger.warn.bind(logger);
    // Patch by overwriting; pino accepts (obj, msg?) — capture both.
    (logger as unknown as { info: (...a: unknown[]) => void }).info = (
      obj: unknown,
      msg?: unknown,
    ) => {
      captured.push({ obj, msg: typeof msg === "string" ? msg : undefined });
    };
    (logger as unknown as { warn: (...a: unknown[]) => void }).warn = (
      obj: unknown,
      msg?: unknown,
    ) => {
      captured.push({ obj, msg: typeof msg === "string" ? msg : undefined });
    };
  });

  afterEach(() => {
    (logger as unknown as { info: typeof origInfo }).info = origInfo;
    (logger as unknown as { warn: typeof origWarn }).warn = origWarn;
    if (prevApiKey === undefined) delete process.env["RESEND_API_KEY"];
    else process.env["RESEND_API_KEY"] = prevApiKey;
  });

  it("does NOT log the magic-link token, full URL, recipient address, subject, or body", async () => {
    const TOKEN = "deadbeef".repeat(8); // 64 hex
    const link = `https://app.dealflow.example/external/${TOKEN}`;
    const recipient = "lawyer-secret@kanzlei.example";
    const subject = "Vertragsfreigabe für Top-Secret-Deal";
    const body = `Bitte klicken Sie hier: ${link}\nDieser Link ist persönlich.`;

    const result = await sendEmail({
      to: recipient,
      from: { email: "no-reply@dealflow.example", name: "DealFlow" },
      subject,
      html: `<p>${body}</p>`,
      text: body,
      tags: { kind: "external_collaborator_invite" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.provider, "log");

    const dump = JSON.stringify(captured);
    assert.ok(captured.length > 0, "logger must record at least one entry");
    assert.ok(!dump.includes(TOKEN), `token must NOT appear in logs: ${dump}`);
    assert.ok(!dump.includes(link), `magic-link URL must NOT appear in logs: ${dump}`);
    assert.ok(
      !dump.includes(recipient),
      `recipient address must NOT appear in logs: ${dump}`,
    );
    assert.ok(
      !dump.includes("Top-Secret-Deal"),
      `subject content must NOT appear in logs: ${dump}`,
    );
    assert.ok(
      !dump.includes("persönlich"),
      `body content must NOT appear in logs: ${dump}`,
    );
  });
});

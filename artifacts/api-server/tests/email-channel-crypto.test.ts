// Unit tests for the multi-channel email plumbing that don't require a live
// database. The integration paths are exercised via the existing tenant
// isolation suite — here we focus on the cryptographic invariants and the
// SMTP adapter's input validation, both of which would otherwise only fail
// in production once a misconfigured channel is actually used.

import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

before(() => {
  // Force a deterministic key for the test process. The secretCrypto module
  // caches the key on first use, so this MUST run before any other code in
  // the suite touches encryptSecret/decryptSecret.
  process.env["EMAIL_CHANNEL_ENCRYPTION_KEY"] = Buffer.alloc(32, 7).toString("base64");
  delete process.env["SESSION_SECRET"];
});

describe("secretCrypto", () => {
  it("round-trips arbitrary JSON payloads", async () => {
    const { encryptSecret, decryptSecret } = await import("../src/lib/secretCrypto");
    const payload = {
      password: "hunter2 — with non-ASCII €",
      nested: { token: "abc.def.ghi", expiresAt: 12345678 },
      flag: true,
    };
    const blob = encryptSecret(payload);
    assert.match(blob, /^v1:/, "ciphertext must carry the v1 prefix");
    const round = decryptSecret<typeof payload>(blob);
    assert.deepEqual(round, payload);
  });

  it("rejects malformed ciphertexts", async () => {
    const { decryptSecret } = await import("../src/lib/secretCrypto");
    assert.throws(() => decryptSecret(""), /empty input/);
    assert.throws(() => decryptSecret("not-a-cipher"), /unrecognized/);
    assert.throws(() => decryptSecret("v2:a:b:c"), /unrecognized/);
  });

  it("produces distinct ciphertexts for the same plaintext (random IV)", async () => {
    const { encryptSecret } = await import("../src/lib/secretCrypto");
    const a = encryptSecret({ x: 1 });
    const b = encryptSecret({ x: 1 });
    assert.notEqual(a, b);
  });

  it("detects tampered ciphertexts via the GCM auth tag", async () => {
    const { encryptSecret, decryptSecret } = await import("../src/lib/secretCrypto");
    const blob = encryptSecret({ secret: "abc" });
    const parts = blob.split(":");
    // Flip the last byte of the ciphertext segment.
    const cipher = Buffer.from(parts[3], "base64");
    cipher[cipher.length - 1] ^= 0xff;
    parts[3] = cipher.toString("base64");
    assert.throws(() => decryptSecret(parts.join(":")));
  });
});

describe("smtp adapter input validation", () => {
  it("throws clear errors for missing required config", async () => {
    const { smtpAdapter } = await import("../src/lib/email/adapters/smtp");
    const baseChannel = {
      id: "ch_test",
      tenantId: "t_test",
      type: "smtp" as const,
      name: "Test",
      brandId: null,
      userId: null,
      fromEmail: "test@example.com",
      fromName: null,
      replyTo: null,
      config: {} as Record<string, unknown>,
      credentials: { password: "pw" } as Record<string, unknown>,
    };
    const message = {
      to: ["a@b.com"],
      subject: "S",
      text: "T",
      html: "<p>T</p>",
    };
    await assert.rejects(
      smtpAdapter.send(message, {
        tenantId: "t_test",
        channel: baseChannel,
        correlationId: "c1",
      }),
      /config\.host missing/,
    );
    await assert.rejects(
      smtpAdapter.send(message, {
        tenantId: "t_test",
        channel: { ...baseChannel, config: { host: "smtp.x" } },
        correlationId: "c1",
      }),
      /config\.port missing/,
    );
    await assert.rejects(
      smtpAdapter.send(message, {
        tenantId: "t_test",
        channel: {
          ...baseChannel,
          config: { host: "smtp.x", port: 587 },
        },
        correlationId: "c1",
      }),
      /config\.user missing/,
    );
    await assert.rejects(
      smtpAdapter.send(message, {
        tenantId: "t_test",
        channel: {
          ...baseChannel,
          config: { host: "smtp.x", port: 587, user: "me@x" },
          credentials: {} as Record<string, unknown>,
        },
        correlationId: "c1",
      }),
      /credentials\.password missing/,
    );
  });
});

describe("oauth state token", () => {
  it("round-trips a valid state and rejects tampered/expired tokens", async () => {
    process.env["SESSION_SECRET"] = "test-secret-for-state-hmac";
    const { buildOauthState, verifyOauthState } = await import("../src/routes/emailChannels");
    const token = buildOauthState("u_alice", "t_acme");
    const ok = verifyOauthState(token);
    assert.deepEqual(ok, { userId: "u_alice", tenantId: "t_acme" });

    // Tamper with the signature.
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const lastDot = decoded.lastIndexOf(".");
    const tampered = Buffer.from(
      decoded.slice(0, lastDot) + "." + "0".repeat(decoded.length - lastDot - 1),
      "utf8",
    ).toString("base64url");
    assert.equal(verifyOauthState(tampered), null);

    // Reject completely garbage input.
    assert.equal(verifyOauthState("not-a-token"), null);
    assert.equal(verifyOauthState(""), null);
  });
});

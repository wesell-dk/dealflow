import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMagicLinkUrl } from "../src/lib/magicLinkUrl";

const TOKEN = "deadbeef".repeat(8); // 64 hex chars, mirrors real tokens

function reqLike(host: string | undefined, protocol: string = "http") {
  return { headers: { host }, protocol };
}

describe("buildMagicLinkUrl — security guards", () => {
  let prevAppBaseUrl: string | undefined;

  before(() => {
    prevAppBaseUrl = process.env["APP_BASE_URL"];
  });

  after(() => {
    if (prevAppBaseUrl === undefined) delete process.env["APP_BASE_URL"];
    else process.env["APP_BASE_URL"] = prevAppBaseUrl;
  });

  it("uses APP_BASE_URL when configured and ignores spoofed Host header", () => {
    process.env["APP_BASE_URL"] = "https://app.dealflow.example";
    // The "request" claims an attacker-controlled host; that header MUST NOT
    // leak into the magic-link URL because we have a canonical base.
    const url = buildMagicLinkUrl(reqLike("evil.attacker.example", "http"), undefined, TOKEN);
    assert.equal(url, `https://app.dealflow.example/external/${TOKEN}`);
  });

  it("ignores spoofed protocol — APP_BASE_URL scheme wins", () => {
    process.env["APP_BASE_URL"] = "https://app.dealflow.example";
    // Even if the request claims to be HTTP, the canonical base is HTTPS.
    const url = buildMagicLinkUrl(reqLike("app.dealflow.example", "http"), undefined, TOKEN);
    assert.ok(url?.startsWith("https://"), `expected https://, got ${url}`);
  });

  it("silently drops cross-host magicLinkBaseUrl when APP_BASE_URL is set (phishing relay protection)", () => {
    process.env["APP_BASE_URL"] = "https://app.dealflow.example";
    const url = buildMagicLinkUrl(
      reqLike("app.dealflow.example", "https"),
      "https://attacker.example.com/dealflow-web",
      TOKEN,
    );
    // Falls back to canonical, not attacker.
    assert.equal(url, `https://app.dealflow.example/external/${TOKEN}`);
  });

  it("accepts same-host magicLinkBaseUrl (with sub-path) when host matches APP_BASE_URL", () => {
    process.env["APP_BASE_URL"] = "https://app.dealflow.example";
    const url = buildMagicLinkUrl(
      reqLike("app.dealflow.example", "https"),
      "https://app.dealflow.example/dealflow-web",
      TOKEN,
    );
    assert.equal(url, `https://app.dealflow.example/dealflow-web/external/${TOKEN}`);
  });

  it("rejects non-http(s) magicLinkBaseUrl with null", () => {
    process.env["APP_BASE_URL"] = "https://app.dealflow.example";
    const ftp = buildMagicLinkUrl(reqLike("app.dealflow.example", "https"), "ftp://x.example", TOKEN);
    assert.equal(ftp, null);
    const js = buildMagicLinkUrl(
      reqLike("app.dealflow.example", "https"),
      "javascript:alert(1)",
      TOKEN,
    );
    assert.equal(js, null);
  });

  it("rejects malformed magicLinkBaseUrl with null", () => {
    process.env["APP_BASE_URL"] = "https://app.dealflow.example";
    const url = buildMagicLinkUrl(reqLike("app.dealflow.example", "https"), "not a url", TOKEN);
    assert.equal(url, null);
  });

  it("falls back to request host only when APP_BASE_URL is NOT configured (dev/test)", () => {
    delete process.env["APP_BASE_URL"];
    const url = buildMagicLinkUrl(reqLike("127.0.0.1:5000", "http"), undefined, TOKEN);
    assert.equal(url, `http://127.0.0.1:5000/external/${TOKEN}`);
  });

  it("returns null when no APP_BASE_URL, no caller base, and no Host header", () => {
    delete process.env["APP_BASE_URL"];
    const url = buildMagicLinkUrl(reqLike(undefined, "https"), undefined, TOKEN);
    assert.equal(url, null);
  });
});

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric AES-256-GCM secret encryption for at-rest storage of credentials
 * (SMTP passwords, OAuth refresh tokens, webhook signing secrets, ...).
 *
 * Key resolution (first match wins):
 *   1. EMAIL_CHANNEL_ENCRYPTION_KEY  — base64 or hex of exactly 32 bytes
 *   2. SESSION_SECRET                — used to derive a 32-byte key via SHA-256
 *   3. Hard-coded development key    — only when NODE_ENV !== "production"
 *
 * Production deployments MUST set EMAIL_CHANNEL_ENCRYPTION_KEY explicitly.
 * The function below throws on first use if no usable key is configured in
 * production so we fail fast at boot/first encryption rather than silently
 * persisting unrecoverable ciphertext.
 */

let cachedKey: Buffer | null = null;

function deriveKeyFromString(s: string): Buffer {
  return createHash("sha256").update(s, "utf8").digest();
}

function tryParseRawKey(raw: string): Buffer | null {
  const trimmed = raw.trim();
  // hex (64 chars)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  // base64 (44 chars incl padding for 32 bytes; allow url-safe variants)
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 32) return buf;
  } catch {
    /* ignore */
  }
  return null;
}

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const explicit = process.env["EMAIL_CHANNEL_ENCRYPTION_KEY"];
  if (explicit && explicit.trim()) {
    const parsed = tryParseRawKey(explicit);
    if (parsed) {
      cachedKey = parsed;
      return cachedKey;
    }
    // Not a 32-byte raw key — derive from the supplied string so an admin
    // can paste a long passphrase without worrying about format.
    cachedKey = deriveKeyFromString(explicit);
    return cachedKey;
  }
  const sessionSecret = process.env["SESSION_SECRET"];
  if (sessionSecret && sessionSecret.trim()) {
    cachedKey = deriveKeyFromString(`email-channel-key:${sessionSecret}`);
    return cachedKey;
  }
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "EMAIL_CHANNEL_ENCRYPTION_KEY is not set. Configure a 32-byte (base64/hex) " +
        "key or a SESSION_SECRET to enable email-channel credential encryption.",
    );
  }
  cachedKey = deriveKeyFromString("dealflow-dev-email-channel-key-do-not-use-in-prod");
  return cachedKey;
}

/**
 * Encrypts an arbitrary JSON-serialisable value. Output format is a single
 * URL-safe string `v1:<iv-b64>:<tag-b64>:<cipher-b64>` so we can rotate the
 * scheme later without ambiguity.
 */
export function encryptSecret(value: unknown): string {
  const key = resolveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret<T = unknown>(blob: string): T {
  if (!blob || typeof blob !== "string") {
    throw new Error("decryptSecret: empty input");
  }
  const parts = blob.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("decryptSecret: unrecognized cipher format");
  }
  const key = resolveKey();
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ct = Buffer.from(parts[3], "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

/**
 * Stable masked preview for displaying "is something configured?" without
 * revealing the secret. Length-stable to avoid leaking secret length.
 */
export function maskedPreview(plain: string | null | undefined): string {
  if (!plain) return "";
  const last = plain.slice(-2).replace(/[^a-zA-Z0-9]/g, "•");
  return `••••${last}`;
}

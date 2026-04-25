import { createHmac, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP, isIPv4, isIPv6 } from "node:net";
import { and, asc, eq, lte, or, isNull } from "drizzle-orm";
import { db, webhooksTable, webhookDeliveriesTable } from "@workspace/db";
import { logger } from "./logger";

export type WebhookEvent =
  | "quote.accepted"
  | "contract.signed"
  | "approval.decided"
  | "approval.stage.decided"
  | "price_increase.responded"
  | "order.completed"
  | "external_contract.confirmed"
  | "renewal.created"
  | "renewal.due_soon";

/**
 * Hosts an admin may explicitly allowlist via env, e.g. for staging callbacks
 * that legitimately resolve to a private IP. Comma-separated, case-insensitive.
 */
function getHostAllowlist(): Set<string> {
  const raw = process.env.WEBHOOK_HOST_ALLOWLIST ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

/**
 * Returns a reason string when the IP literal falls into a blocked range,
 * otherwise null. Covers loopback, RFC1918, link-local, CGNAT, the AWS/GCP
 * metadata address, IPv6 loopback / ULA / link-local / IPv4-mapped variants.
 */
export function ipBlockReason(ip: string): string | null {
  if (isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0) return "reserved IP not allowed";
    if (a === 10) return "private IP not allowed";
    if (a === 127) return "loopback IP not allowed";
    if (a === 169 && b === 254) return "link-local / metadata IP not allowed";
    if (a === 172 && b >= 16 && b <= 31) return "private IP not allowed";
    if (a === 192 && b === 168) return "private IP not allowed";
    if (a === 100 && b >= 64 && b <= 127) return "CGNAT IP not allowed";
    if (a >= 224) return "multicast/reserved IP not allowed";
    return null;
  }
  if (isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return "IPv6 loopback/unspecified not allowed";
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4.
    const mappedDotted = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDotted) return ipBlockReason(mappedDotted[1]);
    // WHATWG URL normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1 — decode the
    // last two hextets back into dotted form and re-check.
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return ipBlockReason(v4);
    }
    // Link-local is fe80::/10 — first 10 bits 1111111010, i.e. fe80..febf.
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return "IPv6 link-local not allowed";
    // Unique-local fc00::/7 covers fc.. and fd..
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return "IPv6 unique-local not allowed";
    if (lower.startsWith("ff")) return "IPv6 multicast not allowed";
    return null;
  }
  return "not a valid IP";
}

function isHostnameBlocked(host: string): string | null {
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return "host not allowed";
  }
  return null;
}

/**
 * Synchronously reject obviously-unsafe webhook URLs at admin-CRUD time.
 * Performs scheme + hostname checks and IP-literal checks. DNS-based
 * resolution happens later in `assertSafeResolvedUrl` immediately before
 * the outbound fetch, since DNS answers can change between admin-edit and
 * dispatch (and to defeat DNS-rebinding tricks).
 */
export function assertSafeWebhookUrl(raw: string): void {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("invalid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("only http(s) URLs are allowed");
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allow = getHostAllowlist();
  if (allow.has(host)) return;
  const hostBlock = isHostnameBlocked(host);
  if (hostBlock) throw new Error(hostBlock);
  if (isIP(host)) {
    const reason = ipBlockReason(host);
    if (reason) throw new Error(reason);
  }
}

/**
 * Resolve the URL's hostname and ensure every returned address is a public
 * one. Throws on the first blocked address.
 *
 * Note: this does not pin the resolved IP for the subsequent fetch — there
 * is a residual DNS-rebinding window between the lookup and the connect.
 * True pinning would require a custom HTTP(S) agent that dials the
 * validated address while preserving Host/SNI; tracked as a follow-up.
 */
export async function assertSafeResolvedUrl(raw: string): Promise<void> {
  // Re-run the static checks so fields read from the DB are validated again.
  assertSafeWebhookUrl(raw);
  const u = new URL(raw);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allow = getHostAllowlist();
  if (allow.has(host)) return;
  if (isIP(host)) return; // Already validated in assertSafeWebhookUrl above.
  let addrs: { address: string; family: number }[];
  try {
    addrs = await dnsLookup(host, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(`DNS resolution failed: ${(err as Error).message}`);
  }
  if (addrs.length === 0) throw new Error("DNS resolution returned no addresses");
  for (const a of addrs) {
    const reason = ipBlockReason(a.address);
    if (reason) throw new Error(`resolved address blocked (${a.address}): ${reason}`);
  }
}

const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [0, 30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];

export function signPayload(secret: string, body: string, timestamp: number): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

/**
 * Queue webhook deliveries for all matching subscriptions of the tenant.
 * Runs a fire-and-forget dispatch.
 */
export async function emitEvent(
  tenantId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const hooks = await db
      .select()
      .from(webhooksTable)
      .where(and(eq(webhooksTable.tenantId, tenantId), eq(webhooksTable.active, true)));
    const matching = hooks.filter((h) => h.events.includes(event));
    if (matching.length === 0) return;
    const enriched = { event, tenantId, occurredAt: new Date().toISOString(), data: payload };
    for (const h of matching) {
      await db.insert(webhookDeliveriesTable).values({
        id: `wd_${randomUUID().slice(0, 8)}`,
        webhookId: h.id,
        tenantId,
        event,
        payload: enriched,
        status: "queued",
        attempt: 0,
        nextAttemptAt: new Date(),
      });
    }
    // Kick delivery loop without blocking the request.
    setImmediate(() => {
      void dispatchPending().catch((err) =>
        logger.warn({ err }, "webhook dispatch failed"),
      );
    });
  } catch (err) {
    logger.warn({ err, event }, "emitEvent failed");
  }
}

/**
 * Send all queued deliveries whose nextAttemptAt is in the past.
 */
export async function dispatchPending(): Promise<void> {
  const now = new Date();
  const pending = await db
    .select()
    .from(webhookDeliveriesTable)
    .where(
      and(
        eq(webhookDeliveriesTable.status, "queued"),
        or(isNull(webhookDeliveriesTable.nextAttemptAt), lte(webhookDeliveriesTable.nextAttemptAt, now)),
      ),
    )
    .orderBy(asc(webhookDeliveriesTable.createdAt))
    .limit(50);
  for (const d of pending) {
    const [hook] = await db.select().from(webhooksTable).where(eq(webhooksTable.id, d.webhookId));
    if (!hook || !hook.active) {
      await db
        .update(webhookDeliveriesTable)
        .set({ status: "failed", error: "subscription missing or inactive", deliveredAt: new Date() })
        .where(eq(webhookDeliveriesTable.id, d.id));
      continue;
    }
    const attempt = d.attempt + 1;
    const body = JSON.stringify(d.payload);
    const ts = Math.floor(Date.now() / 1000);
    const sig = signPayload(hook.secret, body, ts);
    try {
      // SSRF guard: resolve DNS and ensure no answer is internal. This runs
      // every dispatch (including retries) so DNS changes can't smuggle the
      // request to an internal target later.
      await assertSafeResolvedUrl(hook.url);
      const resp = await fetch(hook.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dealflow-event": d.event,
          "x-dealflow-delivery": d.id,
          "x-dealflow-signature": `sha256=${sig}`,
          "x-dealflow-timestamp": String(ts),
        },
        body,
        // Never auto-follow redirects: a public webhook receiver could
        // 302 us to http://169.254.169.254/ or another internal target,
        // bypassing the DNS check above. Treat any 3xx as a delivery
        // failure and require receivers to expose a stable URL.
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      const respBody = await resp.text().catch(() => "");
      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location") ?? "";
        await scheduleRetry(
          d.id,
          attempt,
          resp.status,
          respBody.slice(0, 2000),
          `redirects not followed (HTTP ${resp.status} -> ${loc.slice(0, 200)})`,
        );
        continue;
      }
      if (resp.ok) {
        await db
          .update(webhookDeliveriesTable)
          .set({
            status: "success",
            attempt,
            statusCode: resp.status,
            responseBody: respBody.slice(0, 2000),
            deliveredAt: new Date(),
            error: null,
          })
          .where(eq(webhookDeliveriesTable.id, d.id));
      } else {
        await scheduleRetry(d.id, attempt, resp.status, respBody.slice(0, 2000), `HTTP ${resp.status}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await scheduleRetry(d.id, attempt, null, null, msg);
    }
  }
}

async function scheduleRetry(
  id: string,
  attempt: number,
  statusCode: number | null,
  responseBody: string | null,
  error: string,
): Promise<void> {
  if (attempt >= MAX_ATTEMPTS) {
    await db
      .update(webhookDeliveriesTable)
      .set({
        status: "failed",
        attempt,
        statusCode,
        responseBody,
        error,
        deliveredAt: new Date(),
      })
      .where(eq(webhookDeliveriesTable.id, id));
    return;
  }
  const delay = BACKOFF_MS[attempt] ?? 30 * 60_000;
  await db
    .update(webhookDeliveriesTable)
    .set({
      status: "queued",
      attempt,
      statusCode,
      responseBody,
      error,
      nextAttemptAt: new Date(Date.now() + delay),
    })
    .where(eq(webhookDeliveriesTable.id, id));
}

export const WEBHOOK_EVENTS: WebhookEvent[] = [
  "quote.accepted",
  "contract.signed",
  "approval.decided",
  "approval.stage.decided",
  "price_increase.responded",
  "order.completed",
  "external_contract.confirmed",
  // Renewal-Engine (#66): "renewal.created" feuert beim Materialisieren einer
  // Opportunity, "renewal.due_soon" zusätzlich, wenn die Notice-Frist binnen
  // 30 Tagen liegt — typisches Trigger-Event für CRM-Folge-Workflows.
  "renewal.created",
  "renewal.due_soon",
];

/**
 * Start a background retry worker. Polls pending deliveries on a fixed
 * interval so queued retries fire even when no new events are emitted.
 * Returns the timer handle so tests/shutdown can cancel it.
 */
export function startWebhookWorker(intervalMs = 60_000): NodeJS.Timeout {
  const t = setInterval(() => {
    void dispatchPending().catch((err) =>
      logger.warn({ err }, "webhook worker dispatch failed"),
    );
  }, intervalMs);
  // Do not keep the event loop alive just for this worker.
  if (typeof t.unref === "function") t.unref();
  return t;
}

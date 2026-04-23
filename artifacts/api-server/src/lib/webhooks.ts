import { createHmac, randomUUID } from "node:crypto";
import { and, asc, eq, lte, or, isNull } from "drizzle-orm";
import { db, webhooksTable, webhookDeliveriesTable } from "@workspace/db";
import { logger } from "./logger";

export type WebhookEvent =
  | "quote.accepted"
  | "contract.signed"
  | "approval.decided"
  | "price_increase.responded"
  | "order.completed";

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
        signal: AbortSignal.timeout(10_000),
      });
      const respBody = await resp.text().catch(() => "");
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
  "price_increase.responded",
  "order.completed",
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

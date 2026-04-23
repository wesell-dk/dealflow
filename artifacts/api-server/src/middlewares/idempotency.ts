import type { Request, Response, NextFunction, RequestHandler } from "express";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db, idempotencyKeysTable } from "@workspace/db";
import { getScope } from "../lib/scope";
import { logger } from "../lib/logger";

const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const PENDING_STATUS = 0;

function hashRequest(body: unknown): string {
  const s = JSON.stringify(body ?? null);
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Idempotency middleware (atomic reserve-then-update).
 *
 * Applies to mutating methods (POST/PATCH/PUT/DELETE) that carry an
 * `Idempotency-Key` header. Reserves a row BEFORE executing the handler
 * using INSERT ... ON CONFLICT DO NOTHING against a unique index on
 * (tenant, user, key, route, method). If reservation conflicts, we read
 * the existing row and either replay a completed 2xx response, return 409
 * on body-hash mismatch, or return 425 when the original request is still
 * in flight. On successful 2xx response we persist the body; on non-2xx
 * we delete the reservation so the caller may retry.
 */
export function idempotency(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const method = req.method.toUpperCase();
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
      next();
      return;
    }
    const key = req.header("idempotency-key");
    if (!key) {
      next();
      return;
    }
    // Because the router is mounted under both /api and /api/v1, Express fires
    // prefix-matched middlewares twice for /api/v1 requests. Guard so the
    // idempotency machinery only runs once per HTTP request.
    const flag = req as unknown as { __idempotencyApplied?: boolean };
    if (flag.__idempotencyApplied) {
      next();
      return;
    }
    flag.__idempotencyApplied = true;
    let scope;
    try {
      scope = getScope(req);
    } catch {
      next();
      return;
    }
    const route = req.baseUrl + (req.route?.path ?? req.path);
    const requestHash = hashRequest(req.body);
    const reservationId = `ik_${randomUUID().slice(0, 8)}`;

    const whereClause = and(
      eq(idempotencyKeysTable.tenantId, scope.tenantId),
      eq(idempotencyKeysTable.userId, scope.user.id),
      eq(idempotencyKeysTable.key, key),
      eq(idempotencyKeysTable.route, route),
      eq(idempotencyKeysTable.method, method),
    );

    // Try to reserve by inserting; unique-index violation means an entry exists.
    let reserved = false;
    try {
      await db.insert(idempotencyKeysTable).values({
        id: reservationId,
        tenantId: scope.tenantId,
        userId: scope.user.id,
        key,
        route,
        method,
        requestHash,
        statusCode: PENDING_STATUS,
        responseBody: {},
      });
      reserved = true;
    } catch (err) {
      const e = err as { message?: string; cause?: unknown; code?: string; detail?: string; constraint?: string };
      const cause = e.cause as { message?: string; code?: string; detail?: string; constraint?: string } | undefined;
      logger.warn({
        msg: e.message, code: e.code ?? cause?.code, detail: e.detail ?? cause?.detail,
        constraint: e.constraint ?? cause?.constraint, causeMsg: cause?.message, route, key,
      }, "idempotency reserve insert failed — will attempt lookup");
    }

    if (!reserved) {
      const [existing] = await db.select().from(idempotencyKeysTable).where(whereClause);
      if (!existing) {
        logger.warn("idempotency reserve failed and no existing row — proceeding without idempotency");
        next();
        return;
      }
      if (existing.requestHash !== requestHash) {
        res.status(409).json({
          error: "idempotency_key_reused",
          message: "Idempotency-Key was used with a different request body.",
        });
        return;
      }
      if (existing.statusCode === PENDING_STATUS) {
        res.status(425).json({
          error: "idempotency_in_progress",
          message: "A request with this Idempotency-Key is still being processed.",
        });
        return;
      }
      res.status(existing.statusCode).json(existing.responseBody);
      return;
    }

    // We own the reservation. Intercept res.json to capture the JSON body and
    // fall back to res.on("finish") for non-JSON responses (res.end/send/204).
    const origJson = res.json.bind(res);
    let capturedBody: unknown = undefined;
    let bodyCaptured = false;
    res.json = (body: unknown) => {
      if (!bodyCaptured) {
        bodyCaptured = true;
        capturedBody = body;
      }
      return origJson(body);
    };
    let finalized = false;
    const finalize = (): void => {
      if (finalized) return;
      finalized = true;
      const code = res.statusCode;
      if (code >= 200 && code < 300) {
        void db
          .update(idempotencyKeysTable)
          .set({
            statusCode: code,
            responseBody: (bodyCaptured ? capturedBody : {}) as object,
          })
          .where(eq(idempotencyKeysTable.id, reservationId))
          .catch((err: unknown) => logger.warn({ err }, "idempotency finalize failed"));
      } else {
        // Non-2xx: drop the reservation so caller can retry.
        void db
          .delete(idempotencyKeysTable)
          .where(eq(idempotencyKeysTable.id, reservationId))
          .catch((err: unknown) => logger.warn({ err }, "idempotency rollback failed"));
      }
    };
    res.on("finish", finalize);
    res.on("close", () => {
      if (!res.writableEnded) {
        // Client disconnected before response finished — release reservation
        // so subsequent retries are not blocked.
        void db
          .delete(idempotencyKeysTable)
          .where(eq(idempotencyKeysTable.id, reservationId))
          .catch((err: unknown) => logger.warn({ err }, "idempotency abort rollback failed"));
      }
    });
    next();
  };
}

/** Background cleanup of idempotency rows older than 24h. */
export async function pruneIdempotencyKeys(): Promise<number> {
  const cutoff = new Date(Date.now() - MAX_AGE_MS);
  const rows = await db
    .delete(idempotencyKeysTable)
    .where(lt(idempotencyKeysTable.createdAt, cutoff))
    .returning({ id: idempotencyKeysTable.id });
  return rows.length;
}

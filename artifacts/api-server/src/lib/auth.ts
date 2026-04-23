import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db, sessionsTable, usersTable } from "@workspace/db";

const ITER = 100_000;
const KEYLEN = 32;
const DIGEST = "sha256";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, ITER, KEYLEN, DIGEST).toString("hex");
  return `${salt}:${ITER}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  const parts = stored.split(":");
  if (parts.length !== 3) return false;
  const [salt, iterStr, expected] = parts as [string, string, string];
  const iter = Number(iterStr);
  if (!Number.isFinite(iter) || iter <= 0) return false;
  const got = pbkdf2Sync(password, salt, iter, KEYLEN, DIGEST).toString("hex");
  const a = Buffer.from(got, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function createSession(userId: string): Promise<string> {
  const sid = randomBytes(32).toString("hex");
  await db.insert(sessionsTable).values({
    id: sid,
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return sid;
}

export async function destroySession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.id, sid));
}

export async function getUserBySession(
  sid: string,
): Promise<typeof usersTable.$inferSelect | null> {
  const [s] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, sid));
  if (!s) return null;
  if (s.expiresAt.getTime() < Date.now()) {
    await db.delete(sessionsTable).where(eq(sessionsTable.id, sid));
    return null;
  }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, s.userId));
  if (!u || !u.isActive) return null;
  return u;
}

export async function pruneExpiredSessions(): Promise<void> {
  await db.delete(sessionsTable).where(lt(sessionsTable.expiresAt, new Date()));
}

export const SESSION_COOKIE = "dfsid";

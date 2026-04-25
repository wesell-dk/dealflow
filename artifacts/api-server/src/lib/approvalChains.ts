import { and, eq, lte, gte } from "drizzle-orm";
import {
  db,
  approvalChainTemplatesTable,
  userDelegationsTable,
  usersTable,
  type ApprovalStage,
  type ApprovalChainStageDef,
  type ApprovalChainCondition,
} from "@workspace/db";

// Trigger-Payload, gegen den die `conditions` einer Chain ausgewertet werden.
// Werte können numerisch (discount_pct, deltaScore) oder String (priority,
// brandId) sein. Unbekannte Felder zählen als nicht-erfüllt.
export type ApprovalTriggerPayload = Record<string, number | string | null | undefined>;

function compareCondition(c: ApprovalChainCondition, v: number | string | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (typeof c.value === "number") {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return false;
    switch (c.op) {
      case "gt": return n > c.value;
      case "gte": return n >= c.value;
      case "lt": return n < c.value;
      case "lte": return n <= c.value;
      case "eq": return n === c.value;
    }
  } else {
    if (c.op !== "eq") return false;
    return String(v) === c.value;
  }
}

/**
 * Wählt das passendste aktive Chain-Template für (tenantId, triggerType,
 * payload). Alle conditions müssen matchen (AND). Bei mehreren Treffern
 * gewinnt die niedrigste `priority`-Zahl, dann das spezifischere Template
 * (mehr conditions). Liefert null, wenn keine Chain passt — in dem Fall
 * verhält sich das Approval wie ein klassisches Single-Stage-Approval.
 */
export async function resolveChain(
  tenantId: string,
  triggerType: string,
  payload: ApprovalTriggerPayload,
): Promise<typeof approvalChainTemplatesTable.$inferSelect | null> {
  const candidates = await db
    .select()
    .from(approvalChainTemplatesTable)
    .where(
      and(
        eq(approvalChainTemplatesTable.tenantId, tenantId),
        eq(approvalChainTemplatesTable.triggerType, triggerType),
        eq(approvalChainTemplatesTable.active, true),
      ),
    );
  const matching = candidates.filter((tpl) => {
    const conds = (tpl.conditions ?? []) as ApprovalChainCondition[];
    return conds.every((c) => compareCondition(c, payload[c.field]));
  });
  if (matching.length === 0) return null;
  matching.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ca = (a.conditions ?? []).length;
    const cb = (b.conditions ?? []).length;
    if (ca !== cb) return cb - ca;
    return a.createdAt < b.createdAt ? -1 : 1;
  });
  return matching[0]!;
}

/**
 * Snapshot der Stages anlegen — wird beim Approval-Insert in `stages`
 * gespeichert und während der Chain-Lebensdauer nicht mehr geändert (außer
 * decidedBy/decidedAt/Status der jeweiligen Stage).
 */
export function snapshotStages(stages: ApprovalChainStageDef[]): ApprovalStage[] {
  return [...stages]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      order: s.order,
      label: s.label,
      approverRole: s.approverRole ?? null,
      approverUserId: s.approverUserId ?? null,
      status: "pending" as const,
      decidedBy: null,
      decidedAt: null,
      delegatedFrom: null,
      comment: null,
    }));
}

/**
 * Prüft, ob `userId` die Stage entscheiden darf — direkt (Rolle/UserId) oder
 * via aktiver Vertretungsregel. Liefert delegatedFrom = User-ID des
 * eigentlich zuständigen Approvers, wenn die Berechtigung über eine
 * Vertretung kommt.
 */
export async function canUserDecideStage(
  userId: string,
  stage: ApprovalStage,
  tenantId: string,
  now: Date = new Date(),
): Promise<{ allowed: boolean; delegatedFrom: string | null }> {
  // 1) Direktberechtigung über approverUserId
  if (stage.approverUserId && stage.approverUserId === userId) {
    return { allowed: true, delegatedFrom: null };
  }
  // 2) Direktberechtigung über approverRole
  if (stage.approverRole) {
    const [u] = await db
      .select({ id: usersTable.id, role: usersTable.role, tenantId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (u && u.tenantId === tenantId && u.role === stage.approverRole) {
      return { allowed: true, delegatedFrom: null };
    }
  }
  // 3) Vertretung: Gibt es einen aktiven Delegator der approverUserId ist
  // (oder dessen Rolle der stage.approverRole entspricht), der userId vertritt?
  const delegations = await db
    .select()
    .from(userDelegationsTable)
    .where(
      and(
        eq(userDelegationsTable.tenantId, tenantId),
        eq(userDelegationsTable.toUserId, userId),
        eq(userDelegationsTable.active, true),
        lte(userDelegationsTable.validFrom, now),
        gte(userDelegationsTable.validUntil, now),
      ),
    );
  if (delegations.length === 0) return { allowed: false, delegatedFrom: null };
  // Direkter Approver wird vertreten?
  if (stage.approverUserId) {
    const hit = delegations.find((d) => d.fromUserId === stage.approverUserId);
    if (hit) return { allowed: true, delegatedFrom: hit.fromUserId };
  }
  // Rollen-Approver: irgendein Delegator hat die Rolle?
  if (stage.approverRole) {
    const fromIds = delegations.map((d) => d.fromUserId);
    const fromUsers = await db
      .select({ id: usersTable.id, role: usersTable.role })
      .from(usersTable)
      .where(eq(usersTable.tenantId, tenantId));
    const matching = fromUsers.find(
      (u) => u.role === stage.approverRole && fromIds.includes(u.id),
    );
    if (matching) {
      const hit = delegations.find((d) => d.fromUserId === matching.id);
      return { allowed: true, delegatedFrom: hit?.fromUserId ?? matching.id };
    }
  }
  return { allowed: false, delegatedFrom: null };
}

/**
 * Liefert eine kurze Beschreibung der aktuellen Stage — wird im Approval-
 * Listing/Details fürs UI gebraucht. Gibt null zurück wenn keine Stages
 * existieren oder der Index außerhalb liegt.
 */
export function currentStage(stages: ApprovalStage[], idx: number): ApprovalStage | null {
  if (!stages.length) return null;
  if (idx < 0 || idx >= stages.length) return null;
  return stages[idx]!;
}

/**
 * Liefert die Chain-Template-Felder für einen neuen Approval-Insert. Wenn
 * eine Chain matcht, wird ein Stage-Snapshot erzeugt; sonst leeres Array
 * (Single-Stage / Legacy).
 */
export async function buildApprovalStageFields(
  tenantId: string,
  triggerType: string,
  payload: ApprovalTriggerPayload,
): Promise<{
  chainTemplateId: string | null;
  stages: ApprovalStage[];
  currentStageIdx: number;
}> {
  const tpl = await resolveChain(tenantId, triggerType, payload);
  if (!tpl) return { chainTemplateId: null, stages: [], currentStageIdx: 0 };
  return {
    chainTemplateId: tpl.id,
    stages: snapshotStages(tpl.stages as ApprovalChainStageDef[]),
    currentStageIdx: 0,
  };
}

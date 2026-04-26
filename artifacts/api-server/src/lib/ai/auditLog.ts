/**
 * AI Audit & Cost Trace
 *
 * Schreibt jede AI-Invocation in ai_invocations. Tenant- und Scope-Snapshot
 * sind Pflicht — Auditierbarkeit ist nicht optional.
 */

import { randomUUID } from 'node:crypto';
import { db, aiInvocationsTable } from '@workspace/db';
import type { Scope } from '../scope.js';
import { activeScopeSnapshot } from '../scope.js';

export interface AIInvocationRecord {
  promptKey: string;
  model: string;
  scope: Scope;
  status: 'success' | 'validation_error' | 'provider_error' | 'config_error';
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  errorClass?: string | null;
  errorMessage?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  /**
   * KI-Zweitmeinung (Task #232): unterscheidet Primaer-Lauf vom parallelen
   * Cross-Check. Default 'primary' fuer alle Bestands-Aufrufer.
   */
  kind?: 'primary' | 'second_opinion';
}

export async function recordAIInvocation(args: AIInvocationRecord): Promise<string> {
  const id = `ai_${randomUUID().slice(0, 12)}`;
  // activeScopeSnapshot kann null liefern (z. B. Tenant-Admin ohne Filter).
  // In diesem Fall echtes SQL-NULL speichern statt der Zeichenkette "null"
  // — sonst sind spätere Audit-Queries (`WHERE active_scope_json IS NULL`)
  // unbrauchbar.
  const scopeSnapshot = activeScopeSnapshot(args.scope);
  await db.insert(aiInvocationsTable).values({
    id,
    actor: args.scope.user.id,
    tenantId: args.scope.tenantId,
    activeScopeJson: scopeSnapshot === null ? null : JSON.stringify(scopeSnapshot),
    promptKey: args.promptKey,
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    latencyMs: args.latencyMs,
    status: args.status,
    errorClass: args.errorClass ?? null,
    errorMessage: args.errorMessage ?? null,
    entityType: args.entityType ?? null,
    entityId: args.entityId ?? null,
    kind: args.kind ?? 'primary',
  });
  return id;
}

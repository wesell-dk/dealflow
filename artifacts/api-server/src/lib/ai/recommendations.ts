/**
 * AI-Empfehlungen mit Vertrauensanzeige + Lerneffekt (Task #69)
 *
 * recordRecommendation() persistiert eine soeben generierte AI-Suggestion
 * inkl. Konfidenz-Score und optionaler Bindung an die ai_invocations-Zeile.
 * Wird als Lern-Signal fuer Acceptance-Rate und Konfidenz-Kalibrierung
 * genutzt (siehe Admin-Dashboard "KI-Vertrauensgenauigkeit").
 *
 * Bewusst minimal — eine Recommendation ist immer pending bis ein User
 * via PATCH /ai-recommendations/:id eine Entscheidung trifft.
 */

import { randomUUID } from 'node:crypto';
import { db, aiRecommendationsTable } from '@workspace/db';

export interface RecordRecommendationArgs {
  tenantId: string;
  promptKey: string;
  suggestion: unknown;
  /** Konfidenz 0.0 - 1.0; ausserhalb wird auf [0,1] geklemmt. */
  confidence: number;
  entityType?: string | null;
  entityId?: string | null;
  /** Optionaler Verweis auf ai_invocations.id. */
  aiInvocationId?: string | null;
}

/**
 * Klemmt einen beliebigen Number-Wert auf das Intervall [0, 1].
 * Nicht-finite oder NaN-Werte werden zu 0.
 */
export function clampConfidence(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Persistiert eine Empfehlung. Liefert die generierte ID zurueck, damit
 * Aufrufer sie in die HTTP-Antwort einbetten koennen (Frontend referenziert
 * sie spaeter im PATCH).
 */
export async function recordRecommendation(args: RecordRecommendationArgs): Promise<string> {
  const id = `rec_${randomUUID().slice(0, 12)}`;
  const conf = clampConfidence(args.confidence);
  await db.insert(aiRecommendationsTable).values({
    id,
    tenantId: args.tenantId,
    promptKey: args.promptKey,
    entityType: args.entityType ?? null,
    entityId: args.entityId ?? null,
    suggestion: args.suggestion,
    // numeric() in drizzle erwartet string-ifiziertes Decimal.
    confidence: conf.toFixed(3),
    status: 'pending',
    aiInvocationId: args.aiInvocationId ?? null,
  });
  return id;
}

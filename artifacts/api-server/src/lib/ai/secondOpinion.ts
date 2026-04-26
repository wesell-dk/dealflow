/**
 * AI Second-Opinion (Task #232)
 *
 * Liefert die Cross-Check-Schicht fuer kritische Copilot-Workflows
 * (Drafting, Risk, Redline, Negotiation, Regulatory). Die Schicht ist:
 *
 *  - Pro Tenant + Prompt-Key konfigurierbar (off | optional | always)
 *  - Modellunabhaengig: zweites Modell + optional ergaenzter System-Prompt
 *    ("kritischer Reviewer") laeuft neben dem Primaer-Lauf
 *  - Deterministisch im Vergleich: kein zweiter LLM-Aufruf entscheidet ueber
 *    "stimmen ueberein", sondern Field-by-Field-Vergleich auf normalisierten
 *    Werten (Konfidenz-Bucket, Severity-Rang, Empfehlungs-String)
 *  - Vollstaendig auditiert: beide Inferenzen landen als eigene Zeilen in
 *    `ai_invocations` (kind=primary|second_opinion), das Diff-Resultat in
 *    `ai_second_opinions` (verknuepft mit `ai_recommendations`)
 *
 * Aufrufer (Routen) reichen ihre Vergleichspunkte (`comparePoints`) durch —
 * so bleibt der Differ generisch fuer beliebige Envelope-Shapes.
 */

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  db,
  tenantsTable,
  aiSecondOpinionsTable,
} from '@workspace/db';
import {
  ALLOWED_ANTHROPIC_MODELS,
  isAIConfigured,
  MissingProviderConfigError,
  getDefaultProvider,
  type AIProvider,
} from './provider.js';
import {
  PROMPT_REGISTRY,
  toolFor,
  type PromptDefinition,
  type PromptKey,
} from './promptRegistry.js';
import { validateStructured } from './structuredOutput.js';
import { recordAIInvocation } from './auditLog.js';
import { runStructured, AIOrchestrationError, type RunStructuredArgs, type RunStructuredResult } from './orchestrator.js';
import type { Scope } from '../scope.js';

// ─────────── Tenant-Konfiguration ───────────

export type SecondOpinionMode = 'off' | 'optional' | 'always';
export interface SecondOpinionPromptConfig {
  mode?: SecondOpinionMode;
  /** Optional: explizit zu nutzendes Zweit-Modell (sonst Auto-Pick). */
  model?: string | null;
  /** Optional: zusaetzlicher System-Suffix fuer den Reviewer-Lauf. */
  systemSuffix?: string | null;
}
export type SecondOpinionTenantConfig = Record<string, SecondOpinionPromptConfig>;

const DEFAULT_REVIEWER_SUFFIX =
  '\n\nDu agierst hier als KRITISCHER ZWEIT-REVIEWER. Deine Aufgabe ist es ' +
  'NICHT, die Erst-Bewertung zu bestaetigen — du suchst aktiv nach uebersehenen ' +
  'Risiken, alternativen Lesarten und Schwachstellen in der Argumentation. ' +
  'Wenn du andere Schwerpunkte siehst, stelle sie pointiert heraus. Bleibe ' +
  'aber strikt im vorgegebenen Tool-Schema.';

/**
 * Liste der Prompt-Keys, fuer die der Second-Opinion-Layer wirklich
 * orchestriert wird. MUSS deckungsgleich sein mit den Routen, die
 * `runStructuredWithSecondOpinion()` aufrufen — sonst kann der Admin
 * Modes fuer Workflows setzen, die nie einen Zweitlauf ausfuehren.
 */
export const ALL_SECOND_OPINION_PROMPT_KEYS: ReadonlyArray<string> = [
  'deal.summary',
  'pricing.review',
  'approval.readiness',
  'contract.risk',
];

/**
 * Liest die Tenant-Konfiguration. Liefert ein leeres Objekt zurueck, wenn
 * der Tenant keine Konfiguration hat — Default ist dann implizit "off"
 * fuer alle Prompt-Keys.
 */
export async function loadTenantSecondOpinionConfig(
  tenantId: string,
): Promise<SecondOpinionTenantConfig> {
  const [row] = await db
    .select({ cfg: tenantsTable.aiSecondOpinionConfig })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId));
  return (row?.cfg ?? {}) as SecondOpinionTenantConfig;
}

export async function saveTenantSecondOpinionConfig(
  tenantId: string,
  config: SecondOpinionTenantConfig,
): Promise<void> {
  await db
    .update(tenantsTable)
    .set({ aiSecondOpinionConfig: config })
    .where(eq(tenantsTable.id, tenantId));
}

/**
 * Validiert eine eingehende Konfiguration. Wirft bei ungueltigem Mode
 * oder unbekanntem Modell einen Fehler — der Caller mappt das auf 422.
 */
export function validateSecondOpinionConfig(
  raw: unknown,
): SecondOpinionTenantConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('config must be an object');
  }
  const out: SecondOpinionTenantConfig = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALL_SECOND_OPINION_PROMPT_KEYS.includes(key)) {
      throw new Error(`unknown promptKey "${key}"`);
    }
    if (!value || typeof value !== 'object') {
      throw new Error(`config["${key}"] must be an object`);
    }
    const v = value as Record<string, unknown>;
    const mode = v['mode'];
    if (mode !== undefined && mode !== 'off' && mode !== 'optional' && mode !== 'always') {
      throw new Error(`config["${key}"].mode must be off|optional|always`);
    }
    const model = v['model'];
    if (model !== undefined && model !== null) {
      if (typeof model !== 'string' || !ALLOWED_ANTHROPIC_MODELS.has(model)) {
        throw new Error(`config["${key}"].model "${String(model)}" not in allowlist`);
      }
    }
    const suffix = v['systemSuffix'];
    if (suffix !== undefined && suffix !== null && typeof suffix !== 'string') {
      throw new Error(`config["${key}"].systemSuffix must be string`);
    }
    if (suffix !== undefined && suffix !== null && (suffix as string).length > 2000) {
      throw new Error(`config["${key}"].systemSuffix too long (max 2000 chars)`);
    }
    out[key] = {
      mode: (mode as SecondOpinionMode | undefined) ?? 'off',
      model: model === undefined ? null : (model as string | null),
      systemSuffix: suffix === undefined ? null : (suffix as string | null),
    };
  }
  return out;
}

/**
 * Heuristik fuer ein automatisches Zweit-Modell, wenn der Admin keines
 * gesetzt hat. Ziel: anderes Modell als der Primaer-Lauf, moeglichst
 * komplementaere "Persoenlichkeit" (Opus ↔ Sonnet, Haiku → Sonnet).
 */
export function pickSecondaryModel(primaryModel: string): string {
  if (primaryModel.startsWith('claude-opus')) return 'claude-sonnet-4-6';
  if (primaryModel.startsWith('claude-sonnet')) return 'claude-opus-4-5';
  if (primaryModel.startsWith('claude-haiku')) return 'claude-sonnet-4-6';
  // Fallback: Sonnet ist der robusteste Allrounder.
  return 'claude-sonnet-4-6';
}

// ─────────── Deterministischer Vergleich ───────────

export type SeverityRank = 'info' | 'low' | 'minor' | 'medium' | 'major' | 'high' | 'critical';

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  minor: 1,
  medium: 2,
  high: 3,
  major: 3,
  critical: 4,
};

const CONFIDENCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

export interface ComparePoint {
  /** JSON-Pointer-aehnlicher Pfad in der Output-Struktur (z. B. "health"). */
  path: string;
  /** Anzeigename in der UI / im Audit-Log. */
  label: string;
  /**
   * 'scalar'           → strikter Stringvergleich nach toLowerCase().
   * 'confidence'       → Vergleich der Stufe (low/medium/high).
   * 'severity'         → Vergleich des Severity-Rangs.
   * 'severityListMax'  → max-Severity einer Liste an `path` (z. B. policyFlags
   *                      oder riskSignals — Felder mit `severity`-Key).
   * 'boolean'          → Vergleich von Wahrheitswerten.
   */
  kind: 'scalar' | 'confidence' | 'severity' | 'severityListMax' | 'boolean';
  /** Gewicht der Abweichung. Default: 'major' fuer harte Bewertungs-Felder. */
  severity?: 'minor' | 'major';
}

export interface SecondOpinionDiff {
  path: string;
  label: string;
  primary: unknown;
  secondary: unknown;
  severity: 'info' | 'minor' | 'major';
}

export interface SecondOpinionAgreement {
  level: 'high' | 'medium' | 'low';
  score: number;          // 0..100
  diffs: SecondOpinionDiff[];
}

function readPath(obj: unknown, path: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function severityRank(v: unknown): number {
  if (typeof v !== 'string') return 0;
  return SEVERITY_RANK[v.toLowerCase()] ?? 0;
}

function maxListSeverity(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  return list.reduce<number>((acc, item) => {
    if (item && typeof item === 'object') {
      const sev = (item as Record<string, unknown>)['severity'];
      return Math.max(acc, severityRank(sev));
    }
    return acc;
  }, 0);
}

function comparePoint(
  point: ComparePoint,
  primary: unknown,
  secondary: unknown,
): SecondOpinionDiff | null {
  const a = readPath(primary, point.path);
  const b = readPath(secondary, point.path);
  let equal = true;
  let aVal: unknown = a;
  let bVal: unknown = b;
  switch (point.kind) {
    case 'scalar': {
      const sa = typeof a === 'string' ? a.toLowerCase() : a;
      const sb = typeof b === 'string' ? b.toLowerCase() : b;
      equal = sa === sb;
      break;
    }
    case 'confidence': {
      const ra = CONFIDENCE_RANK[String(a).toLowerCase()] ?? -1;
      const rb = CONFIDENCE_RANK[String(b).toLowerCase()] ?? -1;
      equal = ra === rb;
      break;
    }
    case 'severity': {
      equal = severityRank(a) === severityRank(b);
      break;
    }
    case 'severityListMax': {
      const ra = maxListSeverity(a);
      const rb = maxListSeverity(b);
      aVal = ra;
      bVal = rb;
      equal = ra === rb;
      break;
    }
    case 'boolean': {
      equal = Boolean(a) === Boolean(b);
      break;
    }
  }
  if (equal) return null;
  return {
    path: point.path,
    label: point.label,
    primary: aVal,
    secondary: bVal,
    severity: point.severity ?? 'major',
  };
}

export function computeAgreement(
  comparePoints: ComparePoint[],
  primary: unknown,
  secondary: unknown,
): SecondOpinionAgreement {
  if (comparePoints.length === 0) {
    return { level: 'high', score: 100, diffs: [] };
  }
  const diffs: SecondOpinionDiff[] = [];
  for (const cp of comparePoints) {
    const d = comparePoint(cp, primary, secondary);
    if (d) diffs.push(d);
  }
  const total = comparePoints.length;
  const matches = total - diffs.length;
  const score = Math.round((matches / total) * 100);
  // Schwellen sind bewusst konservativ: ein einzelner harter (major) Diff
  // reicht, um aus 'high' herauszufallen — wir wollen, dass der UI-Badge
  // klar signalisiert "schau genauer hin".
  const hasMajor = diffs.some((d) => d.severity === 'major');
  let level: 'high' | 'medium' | 'low' = 'high';
  if (diffs.length === 0) level = 'high';
  else if (!hasMajor && diffs.length <= 1) level = 'medium';
  else if (diffs.length >= 3 || (hasMajor && diffs.length >= 2)) level = 'low';
  else level = 'medium';
  return { level, score, diffs };
}

// ─────────── Lauf-Layer ───────────

/**
 * Internal: fuehrt eine zweite Inferenz mit alternativem Modell + Reviewer-
 * Suffix aus, ohne den Standard-Lookup im PROMPT_REGISTRY zu veraendern.
 * Wirft AIOrchestrationError bei Provider-/Validierungsfehlern und schreibt
 * dabei einen `kind='second_opinion'` Audit-Eintrag.
 */
async function runSecondaryStructured<I, O>(args: {
  prompt: PromptDefinition<I, O>;
  modelOverride: string;
  systemSuffix: string;
  input: I;
  scope: Scope;
  entityRef?: { entityType: string; entityId: string };
  provider: AIProvider;
}): Promise<RunStructuredResult<O>> {
  const { prompt, modelOverride, systemSuffix, input, scope, entityRef, provider } = args;
  const startedAt = Date.now();
  const system = systemSuffix ? `${prompt.system}${systemSuffix}` : prompt.system;
  try {
    const messages = prompt.buildMessages
      ? prompt.buildMessages(input)
      : [{ role: 'user' as const, content: prompt.buildUser(input) }];
    const result = await provider.complete({
      config: { model: modelOverride },
      system,
      messages,
      tool: toolFor(prompt),
    });
    const latencyMs = Date.now() - startedAt;
    const toolCall = result.toolCalls.find((t) => t.name === prompt.toolName);
    if (!toolCall) {
      const invocationId = await recordAIInvocation({
        promptKey: prompt.key,
        model: result.rawModel,
        scope,
        status: 'validation_error',
        latencyMs,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        errorClass: 'NoToolCall',
        errorMessage: `Second-opinion model did not call "${prompt.toolName}"`,
        entityType: entityRef?.entityType ?? null,
        entityId: entityRef?.entityId ?? null,
        kind: 'second_opinion',
      });
      throw new AIOrchestrationError(
        `Second-opinion missing tool_use (invocation ${invocationId})`,
        'no_tool_call',
      );
    }
    let validated: O;
    try {
      const rawInput = prompt.coerceInput ? prompt.coerceInput(toolCall.input) : toolCall.input;
      validated = validateStructured(prompt.outputSchema, rawInput);
    } catch (e) {
      const invocationId = await recordAIInvocation({
        promptKey: prompt.key,
        model: result.rawModel,
        scope,
        status: 'validation_error',
        latencyMs,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        errorClass: 'StructuredOutputValidationError',
        errorMessage: (e as Error).message,
        entityType: entityRef?.entityType ?? null,
        entityId: entityRef?.entityId ?? null,
        kind: 'second_opinion',
      });
      throw new AIOrchestrationError(
        `Second-opinion validation failed (invocation ${invocationId}): ${(e as Error).message}`,
        'validation_error',
        e,
      );
    }
    const invocationId = await recordAIInvocation({
      promptKey: prompt.key,
      model: result.rawModel,
      scope,
      status: 'success',
      latencyMs,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      entityType: entityRef?.entityType ?? null,
      entityId: entityRef?.entityId ?? null,
      kind: 'second_opinion',
    });
    return {
      output: validated,
      invocationId,
      latencyMs,
      model: result.rawModel,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    };
  } catch (e) {
    if (e instanceof AIOrchestrationError) throw e;
    const latencyMs = Date.now() - startedAt;
    const isConfigError =
      e instanceof MissingProviderConfigError ||
      (e as Error).name === 'DisallowedModelError';
    await recordAIInvocation({
      promptKey: prompt.key,
      model: modelOverride,
      scope,
      status: isConfigError ? 'config_error' : 'provider_error',
      latencyMs,
      inputTokens: 0,
      outputTokens: 0,
      errorClass: (e as Error).name || 'ProviderError',
      errorMessage: (e as Error).message,
      entityType: entityRef?.entityType ?? null,
      entityId: entityRef?.entityId ?? null,
      kind: 'second_opinion',
    });
    throw new AIOrchestrationError(
      `Second-opinion provider call failed: ${(e as Error).message}`,
      isConfigError ? 'config_error' : 'provider_error',
      e,
    );
  }
}

export type SecondOpinionStatus =
  | 'disabled'    // Tenant hat mode='off' fuer diesen promptKey
  | 'skipped'    // Caller hat opt-in nicht gesetzt (mode='optional')
  | 'unavailable' // Provider nicht konfiguriert oder Modell-Allowlist
  | 'failed'     // Lauf hat einen Fehler geworfen
  | 'completed'; // Diff persistiert

export interface SecondOpinionEnvelope<O> {
  status: SecondOpinionStatus;
  /** Maschinenlesbarer Grund bei status != 'completed'. */
  reason?: string;
  /** ai_second_opinions.id — fuer User-Decision-PATCH. */
  secondOpinionId?: string;
  /** ai_invocations.id der zweiten Inferenz. */
  invocationId?: string;
  /** Tatsaechlich genutztes Zweit-Modell (rawModel). */
  model?: string;
  agreementLevel?: 'high' | 'medium' | 'low';
  agreementScore?: number;
  diffs?: SecondOpinionDiff[];
  /** Validierter Output des Zweit-Modells. */
  output?: O;
  decision?: 'pending' | 'keep_primary' | 'adopt_secondary' | 'manual';
}

export interface RunWithSecondOpinionArgs<I, O> extends RunStructuredArgs<I> {
  /** Vergleichspunkte fuer den deterministischen Field-by-Field-Diff. */
  comparePoints: ComparePoint[];
  /** Wenn `mode='optional'` ist, MUSS der Caller dies auf `true` setzen. */
  requestSecondOpinion?: boolean;
}

export interface RunWithSecondOpinionResult<O> extends RunStructuredResult<O> {
  secondOpinion: SecondOpinionEnvelope<O>;
}

/**
 * High-Level-Wrapper: Primaer-Lauf wie gewohnt; je nach Tenant-Konfig laeuft
 * parallel ein zweites Modell. Ergebnis: validierter Primaer-Output PLUS
 * Vergleichs-Envelope mit Diff/Agreement.
 *
 * Wichtig:
 *  - Schlaegt der Primaer-Lauf fehl, wirft die Funktion AIOrchestrationError
 *    (kein Mocking — fail-closed wie der Original-Orchestrator).
 *  - Schlaegt nur der Sekundaer-Lauf fehl, wird das im Envelope als
 *    `status='failed'` zurueckgegeben — der Primaer-Lauf gilt als gueltig.
 */
export async function runStructuredWithSecondOpinion<I, O>(
  args: RunWithSecondOpinionArgs<I, O>,
): Promise<RunWithSecondOpinionResult<O>> {
  const prompt = PROMPT_REGISTRY[args.promptKey] as PromptDefinition<I, O> | undefined;
  if (!prompt) {
    throw new AIOrchestrationError(
      `Unknown promptKey "${args.promptKey}"`,
      'unknown_prompt',
    );
  }

  // Tenant-Konfig vor Primaer-Lauf laden — wir starten beide Inferenzen
  // parallel, sobald wir wissen, dass die Zweitmeinung gefragt ist.
  const tenantCfg = await loadTenantSecondOpinionConfig(args.scope.tenantId);
  const promptCfg = tenantCfg[args.promptKey] ?? { mode: 'off' as SecondOpinionMode };
  const mode: SecondOpinionMode = promptCfg.mode ?? 'off';

  let runSecondary = false;
  let skippedReason: string | undefined;
  if (mode === 'always') runSecondary = true;
  else if (mode === 'optional' && args.requestSecondOpinion === true) runSecondary = true;
  else if (mode === 'off') skippedReason = 'tenant config: off';
  else skippedReason = 'optional opt-in not requested';

  if (!isAIConfigured()) {
    // Primaer-Lauf wird gleich selbst mit config_error abbrechen — wir
    // delegieren das an runStructured. Second-Opinion bleibt 'unavailable'.
    runSecondary = false;
  }

  const provider = args.provider ?? getDefaultProvider();

  // Primaer-Lauf
  const primaryPromise = runStructured<I, O>(args);

  // Sekundaer-Lauf (parallel)
  const secondaryModel = runSecondary
    ? promptCfg.model || pickSecondaryModel(prompt.model)
    : null;
  const secondarySuffix = runSecondary
    ? (promptCfg.systemSuffix && promptCfg.systemSuffix.trim().length > 0
        ? `\n\n${promptCfg.systemSuffix.trim()}`
        : DEFAULT_REVIEWER_SUFFIX)
    : '';

  const secondaryPromise = runSecondary && secondaryModel
    ? runSecondaryStructured<I, O>({
        prompt,
        modelOverride: secondaryModel,
        systemSuffix: secondarySuffix,
        input: args.input,
        scope: args.scope,
        entityRef: args.entityRef,
        provider,
      }).then(
        (r) => ({ ok: true as const, result: r }),
        (e: unknown) => ({ ok: false as const, error: e }),
      )
    : Promise.resolve(null);

  // Primaer wird strikt awaited — Fehler propagieren (fail-closed).
  const [primary, secondary] = await Promise.all([primaryPromise, secondaryPromise]);

  // Default-Envelope wenn nichts lief
  let envelope: SecondOpinionEnvelope<O>;
  if (!runSecondary) {
    envelope = {
      status: !isAIConfigured() ? 'unavailable' : (mode === 'off' ? 'disabled' : 'skipped'),
      reason: !isAIConfigured() ? 'AI provider not configured' : skippedReason,
    };
  } else if (!secondary) {
    // Defensive: should not happen since runSecondary && secondaryModel
    envelope = { status: 'unavailable', reason: 'no secondary model resolved' };
  } else if (!secondary.ok) {
    const err = secondary.error as Error;
    console.error('[second-opinion]', args.promptKey, err.message);
    envelope = {
      status: 'failed',
      reason: err instanceof AIOrchestrationError
        ? `secondary ${err.code}`
        : 'secondary call failed',
    };
  } else {
    const secResult = secondary.result;
    const agreement = computeAgreement(
      args.comparePoints,
      primary.output,
      secResult.output,
    );
    // Persistiere ai_second_opinions.
    const id = `aiso_${randomUUID().slice(0, 12)}`;
    try {
      await db.insert(aiSecondOpinionsTable).values({
        id,
        tenantId: args.scope.tenantId,
        // PromptKey widens to `string | number` because PROMPT_REGISTRY uses
        // computed string keys; the column is text, so coerce explicitly.
        promptKey: String(args.promptKey),
        primaryInvocationId: primary.invocationId,
        secondaryInvocationId: secResult.invocationId,
        primaryModel: primary.model,
        secondaryModel: secResult.model,
        agreementLevel: agreement.level,
        agreementScore: agreement.score,
        diffs: agreement.diffs,
        primaryOutput: primary.output as unknown,
        secondaryOutput: secResult.output as unknown,
        entityType: args.entityRef?.entityType ?? null,
        entityId: args.entityRef?.entityId ?? null,
        decision: 'pending',
      });
      envelope = {
        status: 'completed',
        secondOpinionId: id,
        invocationId: secResult.invocationId,
        model: secResult.model,
        agreementLevel: agreement.level,
        agreementScore: agreement.score,
        diffs: agreement.diffs,
        output: secResult.output,
        decision: 'pending',
      };
    } catch (e) {
      console.error('[second-opinion persist]', args.promptKey, (e as Error).message);
      envelope = {
        status: 'failed',
        reason: 'persist error',
      };
    }
  }

  return { ...primary, secondOpinion: envelope };
}

/**
 * Sucht den ai_second_opinions-Eintrag, der zur uebergebenen Recommendation
 * gehoert. Wird vom Decision-Endpoint genutzt, damit der User auch ueber
 * die Recommendation-ID die Zweitmeinung abschliessen kann.
 */
export async function findSecondOpinionByPrimaryInvocation(
  tenantId: string,
  primaryInvocationId: string,
) {
  const [row] = await db
    .select()
    .from(aiSecondOpinionsTable)
    .where(and(
      eq(aiSecondOpinionsTable.tenantId, tenantId),
      eq(aiSecondOpinionsTable.primaryInvocationId, primaryInvocationId),
    ));
  return row ?? null;
}

export async function recordSecondOpinionDecision(args: {
  secondOpinionId: string;
  tenantId: string;
  decision: 'keep_primary' | 'adopt_secondary' | 'manual';
  decidedBy: string;
}): Promise<typeof aiSecondOpinionsTable.$inferSelect | null> {
  await db
    .update(aiSecondOpinionsTable)
    .set({
      decision: args.decision,
      decidedBy: args.decidedBy,
      decidedAt: new Date(),
    })
    .where(and(
      eq(aiSecondOpinionsTable.id, args.secondOpinionId),
      eq(aiSecondOpinionsTable.tenantId, args.tenantId),
    ));
  const [row] = await db
    .select()
    .from(aiSecondOpinionsTable)
    .where(and(
      eq(aiSecondOpinionsTable.id, args.secondOpinionId),
      eq(aiSecondOpinionsTable.tenantId, args.tenantId),
    ));
  return row ?? null;
}

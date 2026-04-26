/**
 * Prompt Registry
 *
 * Zentrale Sammlung aller AI-Prompt-Templates. Phase 1 Schritt 1 enthält
 * absichtlich nur einen einzigen "diagnostic.ping"-Prompt für den Health-
 * Check. Use-Case-Prompts (deal.summary, contract.risk, negotiation.summary
 * etc.) folgen in Phase 1 Schritt 3 / Phase 2.
 *
 * Konvention: Jeder Prompt hat einen stabilen Key (für Audit/Cost-Tracking),
 * ein system-Prompt und ein zod-Schema für strukturierten Output (siehe
 * structuredOutput.ts).
 */

import { z } from 'zod';
import type { MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages';
import { zodToToolSchema } from './structuredOutput.js';

export interface PromptDefinition<TInput, TOutput> {
  /** Stabiler Key für Audit/Cost-Tracking. Niemals umbenennen. */
  key: string;
  /** Default-Modell für diesen Prompt. */
  model: string;
  /** System-Prompt — definiert Rolle, Sprache, Sicherheitsregeln. */
  system: string;
  /** Baut das User-Message-Pair aus dem typsicheren Input. */
  buildUser(input: TInput): string;
  /**
   * Optional: vollständiger messages-Array Override. Wird vom Orchestrator
   * BEVORZUGT vor `buildUser`, wenn vorhanden. Genutzt für Vision/Document
   * Content Blocks (z. B. Brand-Layout-Extract: PDF als `document` Block).
   */
  buildMessages?: (input: TInput) => MessageParam[];
  /** Zod-Schema, das die AI strukturiert füllen MUSS (via tool_use). */
  outputSchema: z.ZodType<TOutput>;
  /** Tool-Beschreibung für Anthropic — kurze Erläuterung was zurückkommt. */
  toolDescription: string;
  /** Tool-Name — wird Anthropic als forced tool_choice übergeben. */
  toolName: string;
  /**
   * Optionaler Sanitizer für die rohe Tool-Antwort, die der Provider liefert.
   * Wird VOR der zod-Validierung aufgerufen und darf "kosmetisch" reparieren
   * (z. B. zu lange Notes truncaten, leere Einträge entfernen). Der Hook darf
   * KEINE inhaltlichen Felder erfinden — er hilft nur dabei, harmlose
   * Schema-Verletzungen abzufangen, statt den ganzen Job mit
   * `validation_error` abzubrechen.
   */
  coerceInput?: (raw: unknown) => unknown;
}

/**
 * Hilfsfunktion: liefert den Anthropic-Tool-Descriptor aus einem Prompt.
 */
export function toolFor<I, O>(p: PromptDefinition<I, O>): Tool {
  return {
    name: p.toolName,
    description: p.toolDescription,
    input_schema: zodToToolSchema(p.outputSchema) as Tool['input_schema'],
  };
}

// ───────────────────────── Prompts ─────────────────────────

const DiagnosticPingInput = z.object({
  echo: z.string().min(1).max(120),
});
type DiagnosticPingInputT = z.infer<typeof DiagnosticPingInput>;

const DiagnosticPingOutput = z.object({
  ok: z.boolean(),
  echoed: z.string(),
  note: z.string(),
});

export const diagnosticPing: PromptDefinition<
  DiagnosticPingInputT,
  z.infer<typeof DiagnosticPingOutput>
> = {
  key: 'diagnostic.ping',
  // Haiku — günstig, schnell, ausreichend für einen Health-Roundtrip.
  model: 'claude-haiku-4-5',
  system:
    'You are the health probe for DealFlow.One. Respond exclusively via the ' +
    'provided tool. Set ok=true, copy echoed exactly from the input, and write ' +
    'a single short English sentence (max. 80 characters) in note confirming ' +
    'that the AI connection is working. No additional fields. No marketing ' +
    'language.',
  buildUser: (input) =>
    `Please run a health check.\nInput echo: "${input.echo}"`,
  outputSchema: DiagnosticPingOutput,
  toolDescription:
    'Confirms a successful AI roundtrip. Sets ok=true, echoed = input echo, ' +
    'note = short English confirmation sentence.',
  toolName: 'report_health',
};

// 10 Copilot-Modi der Spec — siehe ./prompts/dealflow.ts
import { DEALFLOW_PROMPTS } from './prompts/dealflow.js';
// Brand-Vorlagen-Analyse (Vision: PDF → Layout-Profil) — siehe ./prompts/brandTemplate.ts
import { brandDocumentLayoutExtract } from './prompts/brandTemplate.js';

/**
 * Map aller Prompts. Wird vom Orchestrator über key gelookuped.
 */
export const PROMPT_REGISTRY = {
  [diagnosticPing.key]: diagnosticPing,
  ...DEALFLOW_PROMPTS,
  [brandDocumentLayoutExtract.key]: brandDocumentLayoutExtract,
} as const;

export type PromptKey = keyof typeof PROMPT_REGISTRY;

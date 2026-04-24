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
import type { Tool } from '@anthropic-ai/sdk/resources/messages';
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
  /** Zod-Schema, das die AI strukturiert füllen MUSS (via tool_use). */
  outputSchema: z.ZodType<TOutput>;
  /** Tool-Beschreibung für Anthropic — kurze Erläuterung was zurückkommt. */
  toolDescription: string;
  /** Tool-Name — wird Anthropic als forced tool_choice übergeben. */
  toolName: string;
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
    'Du bist der Health-Probe für DealFlow.One. Antworte ausschließlich über ' +
    'das bereitgestellte Tool. Setze ok=true, kopiere echoed exakt aus dem ' +
    'Input und schreibe einen einzigen kurzen deutschen Satz (max. 80 Zeichen) ' +
    'in note, der bestätigt, dass die AI-Verbindung funktioniert. Keine ' +
    'weiteren Felder. Keine Marketing-Sprache.',
  buildUser: (input) =>
    `Bitte führe einen Health-Check aus.\nInput-Echo: "${input.echo}"`,
  outputSchema: DiagnosticPingOutput,
  toolDescription:
    'Bestätigt erfolgreichen AI-Roundtrip. Setzt ok=true, echoed = Input-Echo, ' +
    'note = kurzer deutscher Bestätigungssatz.',
  toolName: 'report_health',
};

/**
 * Map aller Prompts. Wird vom Orchestrator über key gelookuped.
 */
export const PROMPT_REGISTRY = {
  [diagnosticPing.key]: diagnosticPing,
} as const;

export type PromptKey = keyof typeof PROMPT_REGISTRY;

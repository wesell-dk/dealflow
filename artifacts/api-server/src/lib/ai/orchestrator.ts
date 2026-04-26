/**
 * AI Orchestration Layer
 *
 * Zentrale Eintrittsstelle für alle strukturierten AI-Aufrufe. Bündelt:
 *  - Prompt-Lookup (Registry)
 *  - Provider-Aufruf
 *  - Strukturierte Output-Validierung
 *  - Audit + Cost-Tracking (ai_invocations)
 *  - Fehlerklassifizierung (config / provider / validation)
 *
 * Nutzungsregel: Routen rufen NIE direkt den Provider — immer über runStructured.
 */

import type { z } from 'zod';
import {
  getDefaultProvider,
  isAIConfigured,
  MissingProviderConfigError,
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
import type { Scope } from '../scope.js';

export interface RunStructuredArgs<I> {
  promptKey: PromptKey;
  input: I;
  scope: Scope;
  /** Optional: an welche Entität ist die Inferenz gebunden (für Audit). */
  entityRef?: { entityType: string; entityId: string };
  /** Optional: Provider-Override — Default ist Anthropic via Replit Integration. */
  provider?: AIProvider;
}

export interface RunStructuredResult<O> {
  output: O;
  invocationId: string;
  latencyMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export class AIOrchestrationError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'config_error'
      | 'provider_error'
      | 'validation_error'
      | 'unknown_prompt'
      | 'no_tool_call'
      | 'audit_unavailable',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AIOrchestrationError';
  }
}

/**
 * Audit ist Pflicht (Spec): wenn der Audit-Schreibvorgang fehlschlägt,
 * brechen wir fail-closed mit `audit_unavailable` ab — niemals AI-Output
 * ungeloggt zurückgeben. Wir wickeln Audit-Schreiber durch diesen Helper,
 * damit Fehler eindeutig klassifiziert und nicht versehentlich verschluckt
 * werden.
 */
async function auditOrFail(
  fn: () => Promise<string>,
  context: string,
): Promise<string> {
  try {
    return await fn();
  } catch (e) {
    throw new AIOrchestrationError(
      `Audit write failed (${context}): ${(e as Error).message}`,
      'audit_unavailable',
      e,
    );
  }
}

/**
 * Führt einen registrierten Prompt aus und liefert das validierte Ergebnis.
 *
 * - Wirft AIOrchestrationError("config_error") wenn keine env vars gesetzt
 *   sind. Das Schreiben des Audit-Eintrags wird best-effort versucht; der
 *   Caller MUSS den Fehler behandeln (z. B. 503 zurückgeben).
 * - Wirft AIOrchestrationError("provider_error") bei API-/Netzwerk-Fehlern.
 * - Wirft AIOrchestrationError("validation_error") wenn die AI ein Tool-Input
 *   liefert, das das zod-Schema verletzt.
 */
export async function runStructured<I, O>(
  args: RunStructuredArgs<I>,
): Promise<RunStructuredResult<O>> {
  const prompt = PROMPT_REGISTRY[args.promptKey] as
    | PromptDefinition<I, O>
    | undefined;
  if (!prompt) {
    throw new AIOrchestrationError(
      `Unknown promptKey "${args.promptKey}"`,
      'unknown_prompt',
    );
  }

  if (!isAIConfigured()) {
    // Audit ist Pflicht — fail-closed wenn der DB-Schreibvorgang scheitert.
    await auditOrFail(
      () =>
        recordAIInvocation({
          promptKey: prompt.key,
          model: prompt.model,
          scope: args.scope,
          status: 'config_error',
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          errorClass: 'MissingProviderConfigError',
          errorMessage: 'AI_INTEGRATIONS_ANTHROPIC_* env vars missing',
          entityType: args.entityRef?.entityType ?? null,
          entityId: args.entityRef?.entityId ?? null,
        }),
      'config_error',
    );
    throw new AIOrchestrationError(
      'AI provider not configured',
      'config_error',
    );
  }

  const provider = args.provider ?? getDefaultProvider();
  const startedAt = Date.now();

  try {
    // Vision/Document-Override: Prompts wie brand.documentLayout.extract
    // brauchen einen vollen messages-Array (mit `document` Content Block fürs
    // PDF). Wenn das Prompt einen `buildMessages`-Hook setzt, nutzen wir den
    // — sonst der klassische Single-User-Message-Pfad.
    const messages = prompt.buildMessages
      ? prompt.buildMessages(args.input)
      : [{ role: 'user' as const, content: prompt.buildUser(args.input) }];
    const result = await provider.complete({
      config: { model: prompt.model },
      system: prompt.system,
      messages,
      tool: toolFor(prompt),
    });
    const latencyMs = Date.now() - startedAt;

    const toolCall = result.toolCalls.find((t) => t.name === prompt.toolName);
    if (!toolCall) {
      const invocationId = await auditOrFail(
        () =>
          recordAIInvocation({
            promptKey: prompt.key,
            model: result.rawModel,
            scope: args.scope,
            status: 'validation_error',
            latencyMs,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            errorClass: 'NoToolCall',
            errorMessage: `AI did not return a tool_use block for "${prompt.toolName}"`,
            entityType: args.entityRef?.entityType ?? null,
            entityId: args.entityRef?.entityId ?? null,
          }),
        'no_tool_call',
      );
      throw new AIOrchestrationError(
        `AI did not return a tool_use block for "${prompt.toolName}" (invocation ${invocationId})`,
        'no_tool_call',
      );
    }

    let validated: O;
    try {
      // Optional sanitizer-Hook: erlaubt Prompts, harmlose Verletzungen
      // (z. B. zu lange notes-Einträge) zu reparieren, bevor zod streng
      // validiert. Der Hook darf nicht halluzinieren — er fixt nur Format.
      const rawInput = prompt.coerceInput
        ? prompt.coerceInput(toolCall.input)
        : toolCall.input;
      validated = validateStructured(prompt.outputSchema, rawInput);
    } catch (e) {
      const invocationId = await auditOrFail(
        () =>
          recordAIInvocation({
            promptKey: prompt.key,
            model: result.rawModel,
            scope: args.scope,
            status: 'validation_error',
            latencyMs,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            errorClass: 'StructuredOutputValidationError',
            errorMessage: (e as Error).message,
            entityType: args.entityRef?.entityType ?? null,
            entityId: args.entityRef?.entityId ?? null,
          }),
        'validation_error',
      );
      throw new AIOrchestrationError(
        `Structured output validation failed (invocation ${invocationId}): ${(e as Error).message}`,
        'validation_error',
        e,
      );
    }

    const invocationId = await auditOrFail(
      () =>
        recordAIInvocation({
          promptKey: prompt.key,
          model: result.rawModel,
          scope: args.scope,
          status: 'success',
          latencyMs,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          entityType: args.entityRef?.entityType ?? null,
          entityId: args.entityRef?.entityId ?? null,
        }),
      'success',
    );

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
    const errorClass = isConfigError
      ? (e as Error).name
      : (e as Error).name || 'ProviderError';
    await auditOrFail(
      () =>
        recordAIInvocation({
          promptKey: prompt.key,
          model: prompt.model,
          scope: args.scope,
          status: isConfigError ? 'config_error' : 'provider_error',
          latencyMs,
          inputTokens: 0,
          outputTokens: 0,
          errorClass,
          errorMessage: (e as Error).message,
          entityType: args.entityRef?.entityType ?? null,
          entityId: args.entityRef?.entityId ?? null,
        }),
      isConfigError ? 'config_error' : 'provider_error',
    );
    throw new AIOrchestrationError(
      `AI provider call failed: ${(e as Error).message}`,
      isConfigError ? 'config_error' : 'provider_error',
      e,
    );
  }
}

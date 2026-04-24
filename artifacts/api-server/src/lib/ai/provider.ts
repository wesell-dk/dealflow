/**
 * AI Provider Layer
 *
 * Schmaler Adapter über die Replit AI Integration für Anthropic. Kein eigener
 * API-Key nötig — env vars AI_INTEGRATIONS_ANTHROPIC_BASE_URL und
 * AI_INTEGRATIONS_ANTHROPIC_API_KEY werden automatisch vom Replit-Sidecar
 * gesetzt. Der Adapter ist bewusst minimal und auf Erweiterung um weitere
 * Provider (OpenAI, Gemini) ausgelegt.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages';

export type AIProviderName = 'anthropic';

/**
 * Hart geführte Modell-Allowlist (Pflicht laut Spec: "Modelle nur aus
 * erlaubter Liste"). Quelle: ai-integrations-anthropic Skill.
 *
 * Niemals ein Modell einsetzen, das hier NICHT steht — der Replit-Proxy
 * würde es ablehnen, und wir verlieren Cost-/Compliance-Kontrolle.
 */
export const ALLOWED_ANTHROPIC_MODELS = new Set<string>([
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
]);

export class DisallowedModelError extends Error {
  constructor(model: string) {
    super(
      `Disallowed AI model "${model}". Allowed: ${[...ALLOWED_ANTHROPIC_MODELS].join(', ')}`,
    );
    this.name = 'DisallowedModelError';
  }
}

export function assertAllowedModel(model: string): void {
  if (!ALLOWED_ANTHROPIC_MODELS.has(model)) {
    throw new DisallowedModelError(model);
  }
}

export interface AIProviderConfig {
  /** Modell-Identifier laut AI Integrations Skill (z. B. claude-sonnet-4-6). */
  model: string;
  /** Default 8192 (per Skill — niemals niedriger setzen ohne expliziten Grund). */
  maxTokens?: number;
}

export interface AIToolCall {
  name: string;
  input: unknown;
  /** Anthropic-spezifische tool_use-ID — Pflicht für tool_result mapping
   *  in Multi-Tool-Agent-Loops. Bei klassischem single-tool runStructured
   *  wird sie ignoriert. */
  id?: string;
}

export interface AIInvocationResult {
  text: string;
  toolCalls: AIToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string | null;
  rawModel: string;
}

export interface AIProvider {
  name: AIProviderName;
  /**
   * Führt eine strukturierte Anfrage aus. Wenn `tool` gesetzt ist, wird
   * Anthropic über tool_use gezwungen, das Schema zu erfüllen — wir nutzen
   * das als JSON-Mode-Ersatz. Alternativ kann `tools` mit mehreren Tools
   * gesetzt werden — dann entscheidet das Modell selbst, ob/welches es
   * aufruft (Agent-Loop).
   */
  complete(args: {
    config: AIProviderConfig;
    system: string;
    messages: MessageParam[];
    tool?: Tool;
    tools?: Tool[];
  }): Promise<AIInvocationResult>;
}

class MissingProviderConfigError extends Error {
  constructor(missing: string[]) {
    super(
      `AI provider not configured — missing env vars: ${missing.join(', ')}. ` +
        `Run setupReplitAIIntegrations for "anthropic" to provision.`,
    );
    this.name = 'MissingProviderConfigError';
  }
}

let cachedAnthropic: Anthropic | null = null;
let cachedAnthropicKey: string | null = null;

function getAnthropicClient(): Anthropic {
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY;
  const missing: string[] = [];
  if (!baseURL) missing.push('AI_INTEGRATIONS_ANTHROPIC_BASE_URL');
  if (!apiKey) missing.push('AI_INTEGRATIONS_ANTHROPIC_API_KEY');
  if (missing.length) throw new MissingProviderConfigError(missing);
  // Re-instantiate if env changed at runtime (rare, but cheap to check).
  const cacheKey = `${baseURL}::${apiKey!.slice(0, 8)}`;
  if (!cachedAnthropic || cachedAnthropicKey !== cacheKey) {
    cachedAnthropic = new Anthropic({ baseURL, apiKey });
    cachedAnthropicKey = cacheKey;
  }
  return cachedAnthropic;
}

class AnthropicProvider implements AIProvider {
  readonly name: AIProviderName = 'anthropic';

  async complete(args: {
    config: AIProviderConfig;
    system: string;
    messages: MessageParam[];
    tool?: Tool;
    tools?: Tool[];
  }): Promise<AIInvocationResult> {
    // Hard policy guard: niemals ein Modell außerhalb der Allowlist an den
    // Provider geben. Wirft DisallowedModelError, der vom Orchestrator als
    // config_error klassifiziert wird.
    assertAllowedModel(args.config.model);
    const client = getAnthropicClient();
    const toolsExtra = args.tool
      ? {
          tools: [args.tool],
          tool_choice: { type: 'tool' as const, name: args.tool.name },
        }
      : args.tools && args.tools.length > 0
        ? { tools: args.tools, tool_choice: { type: 'auto' as const } }
        : {};
    const response = await client.messages.create({
      model: args.config.model,
      max_tokens: args.config.maxTokens ?? 8192,
      system: args.system,
      messages: args.messages,
      ...toolsExtra,
    });

    let text = '';
    const toolCalls: AIToolCall[] = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({ name: block.name, input: block.input, id: block.id });
      }
    }
    return {
      text,
      toolCalls,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason ?? null,
      rawModel: response.model,
    };
  }
}

let defaultProviderInstance: AIProvider | null = null;

/**
 * Liefert den Standardprovider (Anthropic). Lazy — kein Fehler beim Import,
 * sondern erst beim ersten Aufruf, wenn env vars wirklich fehlen.
 */
export function getDefaultProvider(): AIProvider {
  if (!defaultProviderInstance) {
    defaultProviderInstance = new AnthropicProvider();
  }
  return defaultProviderInstance;
}

/**
 * Schneller Boolean-Check für Diagnose-Endpoints und Feature-Flags. Wirft nie.
 */
export function isAIConfigured(): boolean {
  return Boolean(
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL &&
      process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  );
}

export { MissingProviderConfigError };

/**
 * AI Agent Loop
 *
 * Tool-using Agent für DealFlow.One. Im Gegensatz zu runStructured (single
 * tool, forced) lässt der Agent das Modell selbst entscheiden, ob/welches
 * Tool aus einer Registry aufgerufen wird, und führt eine Loop aus, bis das
 * Modell stop_reason='end_turn' liefert oder maxSteps erreicht ist.
 *
 * Pflichten dieser Schicht:
 *  - Tools werden als Anthropic-Tool-Descriptors aus zod-Schemas generiert.
 *  - Jedes Tool wird scope-bewusst ausgeführt (siehe handler-Signatur).
 *  - Jeder Schritt (Modell-Antwort + Tool-Ergebnis) wird als Trace erfasst,
 *    damit Frontend / Audit erklären können, was der Agent gemacht hat.
 *  - Eine einzige ai_invocations-Zeile fasst die Konversation zusammen
 *    (Token-Summe, Latenz). Tool-Aufrufe selbst landen zusätzlich im
 *    Audit-Log durch den Tool-Handler (writeAuditFromReq), da sie mutierend
 *    sein können.
 */
import type { z } from 'zod';
import type { Request } from 'express';
import type { MessageParam, Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages';
import {
  getDefaultProvider,
  isAIConfigured,
  MissingProviderConfigError,
  type AIProvider,
} from './provider.js';
import { recordAIInvocation } from './auditLog.js';
import { zodToToolSchema, validateStructured } from './structuredOutput.js';
import { AIOrchestrationError } from './orchestrator.js';
import type { Scope } from '../scope.js';

export interface AgentTool<TInput, TResult> {
  /** Tool-Name — Anthropic erwartet [a-zA-Z0-9_-]{1,64}. */
  name: string;
  /** Kurze, modellfreundliche Beschreibung. Was, wann, was kommt zurück. */
  description: string;
  /** Zod-Schema für Tool-Input — wird in JSON-Schema konvertiert. */
  inputSchema: z.ZodType<TInput>;
  /**
   * Ausführung des Tools. Bekommt den validierten Input, den HTTP-Request
   * (für Scope-Lookup, Audit) und den Scope.
   * Muss ein JSON-serialisierbares Result liefern, das dem Modell als
   * tool_result zurückgegeben wird.
   */
  execute(args: { input: TInput; req: Request; scope: Scope }): Promise<TResult>;
  /** Markiert mutierende Tools (für Logging / spätere Confirm-Flows). */
  mutating?: boolean;
}

export type AnyAgentTool = AgentTool<unknown, unknown>;

export interface AgentTrace {
  kind: 'message' | 'tool_call' | 'tool_error';
  /** Modelltext (kind=message) oder kurze Trace-Notiz. */
  text?: string;
  tool?: string;
  /** Validierter Input (oder roher Input bei validation_error). */
  arguments?: unknown;
  /** Ergebnis des Tools (gekürzt für Frontend-Anzeige). */
  result?: unknown;
  /** Fehlerklasse bei tool_error. */
  errorClass?: string;
  errorMessage?: string;
}

export interface RunAgentArgs {
  promptKey: string;
  model: string;
  system: string;
  /** Initial user message — die folgende Konversation entsteht durch Tool-Loop. */
  userMessage: string;
  /** Optionaler History-Vortext (kompakte Vorgeschichte). */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: AnyAgentTool[];
  scope: Scope;
  req: Request;
  maxSteps?: number;
  provider?: AIProvider;
}

export interface RunAgentResult {
  /** Letzte Text-Antwort des Modells. */
  reply: string;
  traces: AgentTrace[];
  invocationId: string;
  latencyMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  steps: number;
}

function toolDescriptor(tool: AnyAgentTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: zodToToolSchema(tool.inputSchema as z.ZodType<unknown>) as Tool['input_schema'],
  };
}

/** Kürzt JSON-Strukturen, damit Tool-Results das Modell-Kontextfenster nicht
 *  sprengen. Arrays werden auf 25 Einträge gestutzt. */
function clampForModel(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((v) => clampForModel(v, depth + 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = clampForModel(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 600) {
    return value.slice(0, 600) + '…';
  }
  return value;
}

/**
 * Führt den Agent-Loop aus. Wirft AIOrchestrationError mit klassifiziertem
 * code, sodass Aufrufer (z.B. /copilot/help) auf Fallback umschalten können.
 */
export async function runAgent(args: RunAgentArgs): Promise<RunAgentResult> {
  const maxSteps = args.maxSteps ?? 6;
  if (!isAIConfigured()) {
    await recordAIInvocation({
      promptKey: args.promptKey,
      model: args.model,
      scope: args.scope,
      status: 'config_error',
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      errorClass: 'MissingProviderConfigError',
      errorMessage: 'AI_INTEGRATIONS_ANTHROPIC_* env vars missing',
    }).catch(() => undefined);
    throw new AIOrchestrationError('AI provider not configured', 'config_error');
  }
  const provider = args.provider ?? getDefaultProvider();
  const toolsByName = new Map<string, AnyAgentTool>();
  for (const t of args.tools) toolsByName.set(t.name, t);
  const toolDescriptors = args.tools.map(toolDescriptor);

  // Prepend kurze History als plain text in der ersten User-Message,
  // damit wir keine eigene Multi-Turn-Persistenz brauchen.
  const histText = (args.history ?? []).slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n');
  const messages: MessageParam[] = [
    {
      role: 'user',
      content: histText
        ? `Bisheriger Verlauf:\n${histText}\n\nNeue Frage: ${args.userMessage}`
        : args.userMessage,
    },
  ];

  const traces: AgentTrace[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let modelUsed = args.model;
  let lastReply = '';
  let step = 0;
  const startedAt = Date.now();

  try {
    while (step < maxSteps) {
      step++;
      const result = await provider.complete({
        config: { model: args.model },
        system: args.system,
        messages,
        tools: toolDescriptors,
      });
      totalIn += result.usage.inputTokens;
      totalOut += result.usage.outputTokens;
      modelUsed = result.rawModel;
      if (result.text) {
        traces.push({ kind: 'message', text: result.text });
        lastReply = result.text;
      }

      if (result.toolCalls.length === 0) {
        // end_turn ohne Tool — Antwort ist final.
        break;
      }

      // Anthropic verlangt: assistant-message mit den content-Blocks der
      // Antwort, dann user-message mit tool_result-Blocks für JEDEN tool_use.
      const assistantBlocks: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_use'; id: string; name: string; input: unknown }
      > = [];
      if (result.text) assistantBlocks.push({ type: 'text', text: result.text });
      for (const tc of result.toolCalls) {
        // Anthropic-SDK gibt id zurück; wir haben sie im AIToolCall nicht
        // extrahiert. Holen wir uns die ID, indem wir das Provider-Layer
        // umgehen ist nicht ideal — Lösung: AIToolCall um id erweitern.
        // Für jetzt: synthesize, aber wir bauen Provider gleich zurecht.
        const id = (tc as { id?: string }).id ?? `toolu_${step}_${tc.name}`;
        assistantBlocks.push({ type: 'tool_use', id, name: tc.name, input: tc.input });
      }
      messages.push({ role: 'assistant', content: assistantBlocks });

      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];
      for (const block of assistantBlocks) {
        if (block.type !== 'tool_use') continue;
        const tool = toolsByName.get(block.name);
        if (!tool) {
          traces.push({ kind: 'tool_error', tool: block.name, errorClass: 'UnknownTool', errorMessage: 'no such tool' });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: 'unknown tool' }), is_error: true });
          continue;
        }
        try {
          const validated = validateStructured(tool.inputSchema as z.ZodType<unknown>, block.input);
          const out = await tool.execute({ input: validated, req: args.req, scope: args.scope });
          const clamped = clampForModel(out);
          traces.push({ kind: 'tool_call', tool: tool.name, arguments: validated, result: out });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(clamped) });
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          traces.push({ kind: 'tool_error', tool: tool.name, arguments: block.input, errorClass: (e as Error).name, errorMessage: msg });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify({ error: msg }), is_error: true });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    const latencyMs = Date.now() - startedAt;
    const invocationId = await recordAIInvocation({
      promptKey: args.promptKey,
      model: modelUsed,
      scope: args.scope,
      status: 'success',
      latencyMs,
      inputTokens: totalIn,
      outputTokens: totalOut,
    });
    return {
      reply: lastReply,
      traces,
      invocationId,
      latencyMs,
      model: modelUsed,
      inputTokens: totalIn,
      outputTokens: totalOut,
      steps: step,
    };
  } catch (e) {
    const latencyMs = Date.now() - startedAt;
    const isConfigError =
      e instanceof MissingProviderConfigError ||
      (e as Error).name === 'DisallowedModelError';
    await recordAIInvocation({
      promptKey: args.promptKey,
      model: modelUsed,
      scope: args.scope,
      status: isConfigError ? 'config_error' : 'provider_error',
      latencyMs,
      inputTokens: totalIn,
      outputTokens: totalOut,
      errorClass: (e as Error).name || 'AgentError',
      errorMessage: (e as Error).message,
    }).catch(() => undefined);
    if (e instanceof AIOrchestrationError) throw e;
    throw new AIOrchestrationError(
      `Agent loop failed: ${(e as Error).message}`,
      isConfigError ? 'config_error' : 'provider_error',
      e,
    );
  }
}

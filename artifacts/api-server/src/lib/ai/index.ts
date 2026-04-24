/**
 * AI Layer Barrel.
 *
 * Routen importieren ausschließlich von hier — keine tieferen Pfade in
 * dealflow.ts oder anderen Routen-Dateien.
 */

export { runStructured, AIOrchestrationError } from './orchestrator.js';
export type { RunStructuredArgs, RunStructuredResult } from './orchestrator.js';

export { PROMPT_REGISTRY } from './promptRegistry.js';
export type { PromptKey } from './promptRegistry.js';

export { isAIConfigured, getDefaultProvider } from './provider.js';
export type { AIProvider, AIInvocationResult } from './provider.js';

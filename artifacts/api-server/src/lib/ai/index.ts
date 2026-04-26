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

export { isAIConfigured, getDefaultProvider, ALLOWED_ANTHROPIC_MODELS } from './provider.js';
export type { AIProvider, AIInvocationResult } from './provider.js';

// Task #232: KI-Zweitmeinung
export {
  runStructuredWithSecondOpinion,
  computeAgreement,
  loadTenantSecondOpinionConfig,
  saveTenantSecondOpinionConfig,
  validateSecondOpinionConfig,
  pickSecondaryModel,
  findSecondOpinionByPrimaryInvocation,
  recordSecondOpinionDecision,
  ALL_SECOND_OPINION_PROMPT_KEYS,
} from './secondOpinion.js';
export type {
  ComparePoint,
  SecondOpinionEnvelope,
  SecondOpinionAgreement,
  SecondOpinionDiff,
  SecondOpinionMode,
  SecondOpinionPromptConfig,
  SecondOpinionTenantConfig,
  RunWithSecondOpinionArgs,
  RunWithSecondOpinionResult,
  SecondOpinionStatus,
} from './secondOpinion.js';

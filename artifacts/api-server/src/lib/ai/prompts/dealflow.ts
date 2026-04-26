/**
 * Prompt-Definitionen für die 10 Copilot-Modi der DealFlow.One-Spec:
 *   1. Deal Summary
 *   2. Negotiation Support
 *   3. Pricing Review
 *   4. Approval Readiness
 *   5. Contract Drafting
 *   6. Contract Risk Review
 *   7. External Paper / Redline Analysis
 *   8. Price Increase Support
 *   9. Executive Briefing
 *  10. Commercial Health Check
 *
 * Konventionen:
 *   - System-Prompt ist deutsch und definiert Rolle, Sprache, Stil
 *   - Tool-Schema (zod) erzwingt strukturierten Output für nachgelagerte
 *     Verarbeitung (Persistenz als copilot_insight, UI-Rendering)
 *   - buildUser bekommt das vollständige Domain-Context-Objekt aus
 *     `context.ts` und serialisiert es kompakt (JSON.stringify) — die AI
 *     antwortet ausschließlich über `tool_use`
 *
 * Modell-Auswahl:
 *   - haiku-4-5  → kurze Zusammenfassungen, Briefings (kostengünstig)
 *   - sonnet-4-6 → strukturierte Risiko-/Pricing-Analysen (qualitätsgetrieben)
 */

import { z } from "zod";
import type { PromptDefinition } from "../promptRegistry.js";
import type {
  ApprovalContext,
  ContractContext,
  DealContext,
  QuoteContext,
} from "../context.js";

const RISK = z.union([z.literal("low"), z.literal("medium"), z.literal("high")]);
const PRIORITY = z.union([
  z.literal("info"),
  z.literal("low"),
  z.literal("medium"),
  z.literal("high"),
  z.literal("critical"),
]);

// Strukturierte Konfidenz-Stufe + Kurzbegründung (Task #69).
// Wird vom Modell pro Empfehlung ausgegeben und in der UI als Badge mit
// Tooltip gerendert. Numerische Konfidenz für `recordRecommendation` wird
// deterministisch aus der Stufe abgeleitet (siehe `confidenceLevelToScore`).
const CONFIDENCE_LEVEL = z.union([
  z.literal("low"),
  z.literal("medium"),
  z.literal("high"),
]);
const CONFIDENCE_REASON = z
  .string()
  .min(2)
  .max(280)
  .describe(
    "A brief sentence explaining why the confidence is rated this way (e.g. 'Complete data, clear signals' or 'Little negotiation history, estimate').",
  );

// Gemeinsame Action-Empfehlung. Die strings entsprechen UI-Buttons im
// existierenden Copilot-Insight-Card.
const ACTION_TYPE = z.union([
  z.literal("none"),
  z.literal("open_quote"),
  z.literal("open_contract"),
  z.literal("open_approval"),
  z.literal("open_negotiation"),
  z.literal("open_price_increase"),
]);

const SAFE_GERMAN_HINT =
  "Language: English. Write clearly, factually, and business-ready. No " +
  "marketing phrases. No emojis. No hallucinations — if the context does " +
  "not contain a clear signal, note that explicitly.";

// Source citation for AI recommendations (Task #227 — legal knowledge base).
// The model may only reference IDs that were provided to it in the user
// prompt under "LEGAL KNOWLEDGE BASE". This keeps citations auditable and
// non-hallucinated. Shared by the drafting, risk, and redline prompts so the
// frontend can render a unified sources panel.
const RELATED_SOURCE = z.object({
  kind: z.union([z.literal("norm"), z.literal("precedent")]),
  id: z.string().min(2).max(80),
  ref: z.string().min(2).max(160),
  note: z.string().min(2).max(400).optional(),
});

const CITATION_HINT =
  "If a 'LEGAL KNOWLEDGE BASE' section supplies legal sources or " +
  "precedents, you MUST cite each recommendation that relies on a norm or " +
  "precedent via the listed IDs in the relatedSources field. NEVER invent " +
  "an ID. If no source fits, omit relatedSources or leave it empty.";

// ───────────────────────── 1. Deal Summary ─────────────────────────

const DealSummaryOutput = z.object({
  headline: z.string().min(8).max(120),
  status: z.string().min(2).max(400),
  health: RISK,
  keyFacts: z.array(z.string().min(2).max(160)).min(3).max(8),
  blockers: z.array(z.string().min(2).max(200)).max(6),
  nextSteps: z.array(z.string().min(2).max(200)).min(1).max(5),
  recommendedAction: ACTION_TYPE,
  confidence: CONFIDENCE_LEVEL,
  confidenceReason: CONFIDENCE_REASON,
});

export const dealSummary: PromptDefinition<
  DealContext,
  z.infer<typeof DealSummaryOutput>
> = {
  key: "deal.summary",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in Deal Summary mode. You receive a " +
    "complete deal context (master data, current quote, open approvals, " +
    "contracts, timeline) and produce a concise, fact-based overview for " +
    "Sales/RevOps. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Generate a deal summary for the following context (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: DealSummaryOutput,
  toolDescription:
    "Returns headline (1 sentence), status, health assessment, 3-8 keyFacts, " +
    "blockers, 1-5 nextSteps, recommendedAction and confidence (low/medium/" +
    "high) plus a single confidenceReason sentence.",
  toolName: "report_deal_summary",
};

// ───────────────────────── 2. Negotiation Support ─────────────────────────

const NegotiationOutput = z.object({
  customerStance: z.string().min(2).max(240),
  openTopics: z
    .array(
      z.object({
        topic: z.string().min(2).max(120),
        category: z.union([
          z.literal("price"),
          z.literal("contract"),
          z.literal("scope"),
          z.literal("timeline"),
          z.literal("other"),
        ]),
        impact: PRIORITY,
        suggestion: z.string().min(2).max(600),
      }),
    )
    .max(8),
  draftReplyInternal: z.string().min(2).max(800),
  draftReplyExternal: z.string().min(2).max(1200),
  recommendedAction: ACTION_TYPE,
});

export const negotiationSupport: PromptDefinition<
  DealContext,
  z.infer<typeof NegotiationOutput>
> = {
  key: "negotiation.support",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in Negotiation Support mode. Based on the " +
    "deal context (incl. timeline, approvals, current quote) you classify " +
    "the open negotiation topics, estimate their impact, and propose draft " +
    "replies (internal + external). " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Analyze the negotiation situation and respond in a structured way. Context (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: NegotiationOutput,
  toolDescription:
    "Returns customerStance, classified openTopics with impact, an internal " +
    "and an external draft reply, and a recommendedAction.",
  toolName: "report_negotiation",
};

// ───────────────────────── 3. Pricing Review ─────────────────────────

const PricingReviewOutput = z.object({
  summary: z.string().min(8).max(600),
  marginAssessment: RISK,
  discountAssessment: RISK,
  policyFlags: z
    .array(
      z.object({
        topic: z.string().min(2).max(120),
        severity: PRIORITY,
        explanation: z.string().min(2).max(600),
      }),
    )
    .max(8),
  approvalRelevance: z.union([
    z.literal("not_required"),
    z.literal("recommended"),
    z.literal("required"),
  ]),
  recommendedAction: ACTION_TYPE,
  confidence: CONFIDENCE_LEVEL,
  confidenceReason: CONFIDENCE_REASON,
});

export const pricingReview: PromptDefinition<
  QuoteContext,
  z.infer<typeof PricingReviewOutput>
> = {
  key: "pricing.review",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in Pricing Review mode. Based on the quote, " +
    "active version, line items, and the brand/company-specific price " +
    "positions, you assess margin, discount, and policy compliance. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Assess the pricing of this quote. Context (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: PricingReviewOutput,
  toolDescription:
    "Returns summary, marginAssessment, discountAssessment, policyFlags " +
    "(with severity), approvalRelevance, recommendedAction, and " +
    "confidence (low/medium/high) plus a single confidenceReason sentence.",
  toolName: "report_pricing",
};

// ───────────────────────── 4. Approval Readiness ─────────────────────────

const ApprovalReadinessOutput = z.object({
  decisionReady: z.boolean(),
  recommendation: z.union([
    z.literal("approve"),
    z.literal("approve_with_conditions"),
    z.literal("request_info"),
    z.literal("reject"),
  ]),
  rationale: z.string().min(8).max(1200),
  missingInformation: z.array(z.string().min(2).max(200)).max(8),
  keyDeviations: z
    .array(
      z.object({
        topic: z.string().min(2).max(120),
        severity: PRIORITY,
        note: z.string().min(2).max(600),
      }),
    )
    .max(8),
  recommendedAction: ACTION_TYPE,
  confidence: CONFIDENCE_LEVEL,
  confidenceReason: CONFIDENCE_REASON,
});

export const approvalReadiness: PromptDefinition<
  ApprovalContext,
  z.infer<typeof ApprovalReadinessOutput>
> = {
  key: "approval.readiness",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in Approval Readiness mode. You assess " +
    "whether an approval case is ready for a decision, formulate a concise " +
    "decision recommendation (approve / approve_with_conditions / request_info / " +
    "reject), and name missing information and key deviations. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) => {
    const missingHints: string[] = [];
    if (ctx.missingTranslations && ctx.missingTranslations.length > 0) {
      const locale = ctx.contract?.language ?? 'en';
      const families = Array.from(new Set(ctx.missingTranslations.map((m) => m.family))).sort();
      missingHints.push(
        `Translations for contract language "${locale}" are missing for clause families: ${families.join(', ')}. ` +
        `Please explicitly include in missingInformation ("Translation [${locale}] missing: <family>").`,
      );
    }
    const hintsBlock = missingHints.length > 0 ? `\nDeterministic hints:\n- ${missingHints.join('\n- ')}\n` : '';
    return `Assess the decision readiness of this approval case.${hintsBlock}Context (JSON):\n${JSON.stringify(ctx)}`;
  },
  outputSchema: ApprovalReadinessOutput,
  toolDescription:
    "Returns decisionReady, recommendation, rationale, missingInformation, " +
    "keyDeviations, a recommendedAction, and confidence (low/medium/high) " +
    "plus a single confidenceReason sentence.",
  toolName: "report_approval_readiness",
};

// ───────────────────────── 5. Contract Drafting ─────────────────────────

const ContractDraftOutput = z.object({
  draftTitle: z.string().min(2).max(160),
  recommendedTemplate: z.string().min(2).max(80),
  prefillSuggestions: z
    .array(
      z.object({
        field: z.string().min(2).max(80),
        value: z.string().min(1).max(600),
        source: z.string().min(2).max(200),
      }),
    )
    .min(1)
    .max(20),
  clauseRecommendations: z
    .array(
      z.object({
        family: z.string().min(2).max(80),
        variant: z.union([
          z.literal("soft"),
          z.literal("standard"),
          z.literal("hard"),
        ]),
        rationale: z.string().min(2).max(600),
      }),
    )
    .max(20),
  openQuestions: z.array(z.string().min(2).max(240)).max(8),
  relatedSources: z.array(RELATED_SOURCE).max(8).optional(),
});

// Wrapper-Input: Drafting darf optional einen vorab retrieved'en
// juristischen Wissensblock erhalten (siehe legalKnowledge.ts), den das
// Modell über `relatedSources` zitiert.
export interface ContractDraftInput {
  deal: DealContext;
  knowledgeBlock?: string;
}

export const contractDrafting: PromptDefinition<
  ContractDraftInput,
  z.infer<typeof ContractDraftOutput>
> = {
  key: "contract.draft",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in Contract Drafting mode. From the " +
    "commercial state (deal, brand, quote, account) you derive a prefill " +
    "for a contract draft — template recommendation, field prefill with " +
    "sources, and clause recommendations with soft/standard/hard variants. " +
    CITATION_HINT + " " +
    SAFE_GERMAN_HINT,
  buildUser: (input) =>
    `Propose a contract draft for this deal. Context (JSON):\n${JSON.stringify(input.deal)}` +
    (input.knowledgeBlock ? `\n${input.knowledgeBlock}` : ""),
  outputSchema: ContractDraftOutput,
  toolDescription:
    "Returns draftTitle, recommendedTemplate, prefillSuggestions with source, " +
    "clauseRecommendations (soft/standard/hard), openQuestions, and " +
    "relatedSources (cited norm/precedent IDs from the knowledge base).",
  toolName: "report_contract_draft",
};

// ───────────────────────── 6. Contract Risk Review ─────────────────────────

const ContractRiskOutput = z.object({
  overallRisk: RISK,
  overallScore: z.number().min(0).max(100),
  summary: z.string().min(8).max(1200),
  riskSignals: z
    .array(
      z.object({
        clause: z.string().min(2).max(120),
        severity: PRIORITY,
        finding: z.string().min(2).max(600),
        recommendation: z.string().min(2).max(600),
      }),
    )
    .max(15),
  approvalRelevant: z.boolean(),
  recommendedAction: ACTION_TYPE,
  relatedSources: z.array(RELATED_SOURCE).max(8).optional(),
  confidence: CONFIDENCE_LEVEL,
  confidenceReason: CONFIDENCE_REASON,
});

// Erweiterter Input-Wrapper: Risk-Bewertung darf optional eine vorab
// retrieved'e juristische Wissensbasis erhalten (siehe legalKnowledge.ts).
// Das Modell zitiert daraus über `relatedSources` im Output.
export interface ContractRiskInput {
  contract: ContractContext;
  knowledgeBlock?: string;
}

export const contractRisk: PromptDefinition<
  ContractRiskInput,
  z.infer<typeof ContractRiskOutput>
> = {
  key: "contract.risk",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in Contract Risk Review mode. You analyze " +
    "the contract's clause situation, compare it with the associated deal/" +
    "quote context, and deliver risk signals with clause reference, severity, " +
    "and a concrete recommendation. " +
    CITATION_HINT + " " +
    SAFE_GERMAN_HINT,
  buildUser: (input) =>
    `Assess the contract risk for the following contract.\n` +
    `Context (JSON):\n${JSON.stringify(input.contract)}` +
    (input.knowledgeBlock ? `\n${input.knowledgeBlock}` : ""),
  outputSchema: ContractRiskOutput,
  toolDescription:
    "Returns overallRisk, overallScore (0-100), summary, riskSignals with " +
    "clause/severity/finding/recommendation, approvalRelevant, " +
    "recommendedAction, relatedSources (cited norm/precedent IDs from the " +
    "knowledge base), and confidence (low/medium/high) plus a single " +
    "confidenceReason sentence.",
  toolName: "report_contract_risk",
};

// ───────────── 6b. Per-Clause Negotiation Strategy (Task #229) ─────────────
//
// Pro Klausel produziert das Modell:
//   - currentPosition  (knappe Zusammenfassung des Status quo)
//   - idealPosition    (Was wir maximal bekommen wollen)
//   - targetPosition   (Realistisches Verhandlungsziel)
//   - walkAwayPosition (Untere Grenze, ab der wir aussteigen)
//   - economicRationale + legalRationale (Begründungen)
//   - counterTextDe / counterTextEn (alternative Klausel-Texte, bilingual,
//     bereit zum 1:1 Übernehmen via PATCH /contract-clauses/:id)
//   - proArguments / contraArguments (Argumentations-Linien für die UI)
//   - perClauseConfidence + perClauseConfidenceReason (low/medium/high)
//
// Output ist absichtlich klauselzentriert; das Frontend drillt pro Eintrag
// in einen Detail-View und bietet "Counter übernehmen" als One-Click-Aktion.
// Bei perClauseConfidence='low' rendert die UI eine Manual-Review-Warnung.

const ClauseNegotiationStrategy = z.object({
  contractClauseId: z.string().min(2).max(80),
  family: z.string().min(2).max(120),
  currentPosition: z.string().min(2).max(600),
  idealPosition: z.string().min(2).max(600),
  targetPosition: z.string().min(2).max(600),
  walkAwayPosition: z.string().min(2).max(600),
  economicRationale: z.string().min(2).max(800),
  legalRationale: z.string().min(2).max(800),
  counterTextDe: z.string().min(2).max(4000),
  counterTextEn: z.string().min(2).max(4000),
  proArguments: z.array(z.string().min(2).max(400)).min(1).max(6),
  contraArguments: z.array(z.string().min(2).max(400)).max(6),
  perClauseConfidence: CONFIDENCE_LEVEL,
  perClauseConfidenceReason: CONFIDENCE_REASON,
  relatedSources: z.array(RELATED_SOURCE).max(6).optional(),
});

const ContractNegotiationStrict = z.object({
  overallSummary: z.string().min(8).max(1200),
  clauseStrategies: z.array(ClauseNegotiationStrategy).max(20),
  relatedSources: z.array(RELATED_SOURCE).max(10).optional(),
  confidence: CONFIDENCE_LEVEL,
  confidenceReason: CONFIDENCE_REASON,
});

// Manche Provider serialisieren tief verschachtelte Arrays gelegentlich als
// JSON-String statt als natives Array. Wir tolerieren beides via preprocess
// auf Top-Level — strukturell muss am Ende immer ein Array stehen.
const parseIfStringifiedArray = (v: unknown): unknown => {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = { ...(v as Record<string, unknown>) };
    for (const k of ["clauseStrategies", "relatedSources"] as const) {
      if (typeof o[k] === "string") {
        try {
          o[k] = JSON.parse(o[k] as string);
        } catch {
          /* leave as-is and let zod report */
        }
      }
    }
    return o;
  }
  return v;
};

const ContractNegotiationOutput = z.preprocess(
  parseIfStringifiedArray,
  ContractNegotiationStrict,
) as z.ZodType<z.infer<typeof ContractNegotiationStrict>>;

// Eingabe: ContractContext + denormalisierte Klauseln (id/ordinal/body),
// damit das Modell pro Klausel zitieren kann (UI mappt anhand
// contractClauseId zurück auf den Slot).
export interface ContractNegotiationInput {
  contract: ContractContext;
  clauses: Array<{
    id: string;
    ordinal: number;
    family: string;
    variant: string;
    severity: string;
    body: string;
  }>;
  knowledgeBlock?: string;
}

export const contractNegotiation: PromptDefinition<
  ContractNegotiationInput,
  z.infer<typeof ContractNegotiationOutput>
> = {
  key: "contract.negotiation",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in Per-Clause Negotiation Strategy mode. " +
    "For each contract clause you produce a structured negotiation playbook: " +
    "current position, ideal/target/walk-away positions, economic and legal " +
    "rationale, ready-to-paste counterproposal text in BOTH German (counterTextDe) " +
    "AND English (counterTextEn), plus pro/contra argument lines for the " +
    "internal negotiator. Each clause MUST reuse the provided contractClauseId " +
    "verbatim — do NOT invent new IDs and do NOT cover families that are not " +
    "in the input. " +
    "If a clause is already balanced, output a 'hold the line' strategy " +
    "(idealPosition == currentPosition is fine) and set perClauseConfidence='high'. " +
    "If the data is too thin (very short body, missing context), set " +
    "perClauseConfidence='low' and recommend manual review in the rationale. " +
    "Counter texts must be paste-ready clause bodies (full sentences, no " +
    "placeholders like 'TBD' or '[X]' unless explicitly noted). " +
    CITATION_HINT + " " +
    SAFE_GERMAN_HINT,
  buildUser: (input) => {
    const clauseList = input.clauses
      .map(
        (c) =>
          `§ ${c.ordinal} ${c.family} (id=${c.id}, severity=${c.severity}, variant=${c.variant})\n${c.body.slice(0, 1800)}`,
      )
      .join("\n\n");
    return (
      `Build a per-clause negotiation strategy for the following contract.\n\n` +
      `Contract context (JSON):\n${JSON.stringify(input.contract)}\n\n` +
      `Clauses:\n${clauseList}` +
      (input.knowledgeBlock ? `\n${input.knowledgeBlock}` : "")
    );
  },
  outputSchema: ContractNegotiationOutput,
  toolDescription:
    "Returns overallSummary, clauseStrategies (one per supplied contractClauseId " +
    "with current/ideal/target/walkAway positions, economic+legal rationale, " +
    "counterTextDe + counterTextEn, proArguments, contraArguments, " +
    "perClauseConfidence/perClauseConfidenceReason and optional relatedSources), " +
    "overall relatedSources, and overall confidence (low/medium/high) plus a " +
    "single confidenceReason sentence.",
  toolName: "report_contract_negotiation",
};

// ───────────────────────── 7. External Paper / Redline ─────────────────────────

const RedlineOutput = z.object({
  documentSummary: z.string().min(8).max(400),
  identifiedClauses: z
    .array(
      z.object({
        family: z.string().min(2).max(80),
        excerpt: z.string().min(2).max(400),
        deviation: z.union([
          z.literal("aligned"),
          z.literal("minor"),
          z.literal("material"),
          z.literal("unknown"),
        ]),
        severity: PRIORITY,
        comment: z.string().min(2).max(600),
      }),
    )
    .max(20),
  unknownTopics: z.array(z.string().min(2).max(200)).max(10),
  recommendedReviewPath: z.union([
    z.literal("sales_only"),
    z.literal("legal_review"),
    z.literal("finance_review"),
    z.literal("legal_and_finance"),
  ]),
  executiveSummary: z.string().min(8).max(800),
  relatedSources: z.array(RELATED_SOURCE).max(8).optional(),
});

// External-Paper-Input ist absichtlich anders strukturiert: rohtext +
// Vertrags-/Deal-Bezug (für Scope-Anker). Optional zusätzlich ein
// vorab retrieved'er juristischer Wissensblock (Task #227).
export interface RedlineInput {
  contract: ContractContext;
  externalText: string;
  knowledgeBlock?: string;
}

export const contractRedline: PromptDefinition<
  RedlineInput,
  z.infer<typeof RedlineOutput>
> = {
  key: "contract.redline",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in External Paper / Redline Analysis mode. " +
    "You compare an externally provided contract document with the internal " +
    "contract state, identify known clauses including deviations, list " +
    "unknown topics, and propose a review path. " +
    CITATION_HINT + " " +
    SAFE_GERMAN_HINT,
  buildUser: (input) =>
    `Compare the following external document with our contract state.\n\n` +
    `Internal context (JSON):\n${JSON.stringify(input.contract)}\n\n` +
    `External document (raw text):\n"""${input.externalText}"""` +
    (input.knowledgeBlock ? `\n${input.knowledgeBlock}` : ""),
  outputSchema: RedlineOutput,
  toolDescription:
    "Returns documentSummary, identifiedClauses with deviation classification, " +
    "unknownTopics, recommendedReviewPath, executiveSummary, and " +
    "relatedSources (cited norm/precedent IDs from the knowledge base).",
  toolName: "report_redline_analysis",
};

// ───────────────────────── 8. Price Increase Support ─────────────────────────

const PriceIncreaseOutput = z.object({
  affectedPositions: z
    .array(
      z.object({
        sku: z.string().min(1).max(80),
        currentPrice: z.string().min(1).max(40),
        proposedDelta: z.string().min(1).max(40),
        rationale: z.string().min(2).max(600),
      }),
    )
    .max(20),
  letterDraft: z.string().min(8).max(2000),
  churnRisk: RISK,
  recommendedFollowUps: z.array(z.string().min(2).max(240)).max(6),
  recommendedAction: ACTION_TYPE,
});

// Für Phase 1 nutzen wir den Deal-Kontext als Anker — die meisten Price-
// Increase-Cases hängen an einem Bestandskunden-Deal.
export const priceIncreaseSupport: PromptDefinition<
  DealContext,
  z.infer<typeof PriceIncreaseOutput>
> = {
  key: "price-increase.support",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in Price Increase Support mode. Based on " +
    "the deal context (account, brand, current quote) you draft a price " +
    "change letter, estimate churn risk, and propose follow-up actions. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Prepare a price-increase process for this deal. Context (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: PriceIncreaseOutput,
  toolDescription:
    "Returns affectedPositions, letterDraft, churnRisk, recommendedFollowUps, " +
    "and a recommendedAction.",
  toolName: "report_price_increase",
};

// ───────────────────────── 9. Executive Briefing ─────────────────────────

const ExecutiveBriefOutput = z.object({
  headline: z.string().min(8).max(160),
  oneLiner: z.string().min(8).max(360),
  highlights: z.array(z.string().min(2).max(200)).min(2).max(6),
  risks: z.array(z.string().min(2).max(200)).max(6),
  asks: z.array(z.string().min(2).max(200)).max(4),
});

export const executiveBrief: PromptDefinition<
  DealContext,
  z.infer<typeof ExecutiveBriefOutput>
> = {
  key: "executive.brief",
  model: "claude-haiku-4-5",
  system:
    "You are the DealFlow Copilot in Executive Briefing mode. You summarize " +
    "the deal in a form that fits a 60-second management briefing — precise, " +
    "without jargon overload. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Generate an executive briefing for this deal. Context (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: ExecutiveBriefOutput,
  toolDescription:
    "Returns headline, oneLiner, 2-6 highlights, up to 6 risks, and up to 4 asks.",
  toolName: "report_executive_brief",
};

// ───────────────────────── 10. Commercial Health Check ─────────────────────────

const HealthCheckOutput = z.object({
  overallHealth: RISK,
  pipelineSignals: z.array(z.string().min(2).max(200)).max(6),
  riskSignals: z.array(z.string().min(2).max(200)).max(6),
  bottlenecks: z.array(z.string().min(2).max(200)).max(6),
  recommendedActions: z.array(z.string().min(2).max(200)).min(1).max(6),
});

export const commercialHealthCheck: PromptDefinition<
  DealContext,
  z.infer<typeof HealthCheckOutput>
> = {
  key: "deal.health",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in Commercial Health Check mode. You assess " +
    "the commercial health of the deal (pipeline, risk, bottlenecks) and " +
    "derive concrete next steps. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Assess the commercial health of this deal. Context (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: HealthCheckOutput,
  toolDescription:
    "Returns overallHealth, pipelineSignals, riskSignals, bottlenecks, and " +
    "recommendedActions.",
  toolName: "report_health_check",
};

// ───────────────────────── 11. In-App Help Assistant ─────────────────────────

const HelpAssistantOutput = z.object({
  reply: z.string().min(1).max(800),
  suggestions: z.array(z.object({
    label: z.string().min(1).max(40),
    path: z.string().min(1).max(80),
  })).max(4),
  action: z.object({
    kind: z.enum([
      "none",
      "navigate",
      "open_create_account",
      "open_create_deal",
    ]),
    path: z.string().max(120).nullable().optional(),
    accountId: z.string().max(60).nullable().optional(),
  }),
});

export interface HelpAssistantInput {
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  currentPath: string;
  user: { name: string; role: string; tenantWide: boolean };
  counts: { accounts: number; deals: number; quotes: number; contracts: number; approvals: number };
  routes: Array<{ path: string; title: string; purpose: string }>;
  recentAccounts: Array<{ id: string; name: string }>;
  recentDeals: Array<{ id: string; name: string; accountName: string; stage: string }>;
}

export const helpAssistant: PromptDefinition<
  HelpAssistantInput,
  z.infer<typeof HelpAssistantOutput>
> = {
  key: "assistant.help",
  model: "claude-haiku-4-5",
  system:
    "You are the help assistant of DealFlow.One — a B2B Commercial " +
    "Execution Platform. Answer questions briefly, specifically, and in English. " +
    "You know the platform structure (see routes in the input) and can " +
    "propose an optional UI action via the tool.\n\n" +
    "Rules for action.kind:\n" +
    " - 'open_create_account' when the user wants to create a customer/account. " +
    "In reply say e.g. 'Sure, I'll open the dialog – fill in name, industry, and country.'\n" +
    " - 'open_create_deal' when a deal/opportunity should be created. " +
    "If the user names a customer and you find them in recentAccounts, " +
    "set accountId. In reply say e.g. 'Got it, I'll open the deal dialog.'\n" +
    " - 'navigate' only when the user explicitly wants to go to an area " +
    "(e.g. 'show me the pipeline'). Set path to a route from the input.\n" +
    " - 'none' for pure question answering.\n\n" +
    "suggestions: 0–3 follow-up click suggestions (label + path from routes).\n\n" +
    "Keep reply concise (max. 3 sentences). No marketing phrases, no emojis. " +
    "If you don't know the answer, say so honestly and suggest a suitable " +
    "area. Refer to currentPath when helpful to contextualize the answer " +
    "('On this page you see…').",
  buildUser: (input) => {
    const recentHistory = input.history.slice(-6);
    return [
      `currentPath: ${input.currentPath}`,
      `user: ${input.user.name} (${input.user.role}${input.user.tenantWide ? ", tenant-wide" : ", restricted scope"})`,
      `Platform data: ${input.counts.accounts} accounts, ${input.counts.deals} deals, ${input.counts.quotes} quotes, ${input.counts.contracts} contracts, ${input.counts.approvals} approvals`,
      `available routes (selection):\n${input.routes.map(r => `  - ${r.path} — ${r.title}: ${r.purpose}`).join("\n")}`,
      `recent accounts:\n${input.recentAccounts.map(a => `  - ${a.id}: ${a.name}`).join("\n") || "  (none)"}`,
      `recent deals:\n${input.recentDeals.map(d => `  - ${d.id}: ${d.name} → ${d.accountName} (${d.stage})`).join("\n") || "  (none)"}`,
      recentHistory.length > 0 ? `\nConversation history:\n${recentHistory.map(m => `  ${m.role}: ${m.content}`).join("\n")}` : "",
      `\nQuestion: ${input.question}`,
    ].filter(Boolean).join("\n");
  },
  outputSchema: HelpAssistantOutput,
  toolDescription:
    "Help assistant response. reply = brief English answer. " +
    "suggestions = 0-3 follow-up links. action = optional UI action " +
    "(none / navigate / open_create_account / open_create_deal).",
  toolName: "help_assistant_reply",
};

// ───────────────────────── 11. External Contract Extract ─────────────────────────
//
// Liest aus dem Rohtext eines hochgeladenen Vertrags-Dokuments die Kerndaten,
// die unser ExternalContract-Datensatz braucht. Die Konfidenzwerte (0..1)
// werden vom Frontend als Vertrauens-Indikator pro Feld angezeigt; bei
// fehlendem Signal liefert das Modell den Wert null und confidence=0.
//
// Eingabe: { rawText: string, fileName: string, locale?: string }
//
// Wichtig fuer den Aufrufer:
//   - Aufrufer kappt rawText auf ~60k Zeichen vor dem Aufruf.
//   - Die Antwort ist NICHT autoritativ; der User bestaetigt/korrigiert
//     vor dem Persistieren (status='confirmed').

const PARTY_ROLE = z.union([
  z.literal('customer'),
  z.literal('supplier'),
  z.literal('our_entity'),
  z.literal('third_party'),
  z.literal('unknown'),
]);

const ExternalContractExtractOutput = z.object({
  title: z.string().min(2).max(240),
  contractTypeGuess: z.union([
    z.literal('msa'),
    z.literal('framework'),
    z.literal('order_form'),
    z.literal('nda'),
    z.literal('amendment'),
    z.literal('sow'),
    z.literal('dpa'),
    z.literal('other'),
  ]),
  parties: z
    .array(
      z.object({
        role: PARTY_ROLE,
        name: z.string().min(2).max(200),
      }),
    )
    .max(10),
  currency: z.string().min(3).max(8).nullable(),
  valueAmount: z.string().min(1).max(40).nullable(),
  effectiveFrom: z.string().min(8).max(20).nullable(),
  effectiveTo: z.string().min(8).max(20).nullable(),
  autoRenewal: z.boolean(),
  renewalNoticeDays: z.number().int().min(0).max(3650).nullable(),
  terminationNoticeDays: z.number().int().min(0).max(3650).nullable(),
  governingLaw: z.string().min(2).max(120).nullable(),
  jurisdiction: z.string().min(2).max(120).nullable(),
  identifiedClauseFamilies: z
    .array(
      z.object({
        name: z.string().min(2).max(80),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(20),
  // Pro Feldname (siehe oben) eine 0..1-Konfidenz. Felder ohne Konfidenz
  // werden im Frontend mit einem Warn-Indikator gerendert.
  confidence: z.record(z.string(), z.number().min(0).max(1)),
  // Aggregierte Konfidenz-Stufe ueber die gesamte Extraktion (Task #69):
  // Treibt das AIConfidenceBadge im Intake-Wizard. low = der User sollte
  // praktisch alles pruefen; high = nur Plausibilitaetscheck noetig.
  overallConfidence: CONFIDENCE_LEVEL,
  overallConfidenceReason: CONFIDENCE_REASON,
  // Hinweise fuer den User: was ist unklar, was sollte er pruefen.
  notes: z.array(z.string().min(2).max(240)).max(8),
});

export interface ExternalContractExtractInput {
  rawText: string;
  fileName: string;
}

export const externalContractExtract: PromptDefinition<
  ExternalContractExtractInput,
  z.infer<typeof ExternalContractExtractOutput>
> = {
  key: 'external.contract.extract',
  model: 'claude-sonnet-4-6',
  system:
    'You are the DealFlow Copilot in External Contract Intake mode. You ' +
    'receive the extracted raw text of an uploaded existing contract ' +
    '(PDF/DOCX) and identify the structural core data. Return dates as ' +
    'ISO-8601 (YYYY-MM-DD); amounts as a plain decimal number without ' +
    'thousands separators. Confidence per field as 0..1, where 0 = no ' +
    'signal in the text, 1 = explicitly named. Fields for which the text ' +
    'provides no clear evidence are returned as null. Never guess. ' +
    SAFE_GERMAN_HINT,
  buildUser: (input) =>
    `Extract the core data from the following contract raw text.\n` +
    `File name: ${input.fileName}\n\n` +
    `Raw text (truncated):\n"""${input.rawText}"""`,
  outputSchema: ExternalContractExtractOutput,
  toolDescription:
    'Returns title, contractTypeGuess, parties (role+name), currency, ' +
    'valueAmount, effectiveFrom/To (ISO), autoRenewal, renewalNoticeDays, ' +
    'terminationNoticeDays, governingLaw, jurisdiction, ' +
    'identifiedClauseFamilies (name+confidence), confidence per field, ' +
    'overallConfidence (low/medium/high) plus overallConfidenceReason, ' +
    'notes (hints for manual review).',
  toolName: 'report_external_contract_extract',
};

// ───────────────────────── Clause-Import (Task #76) ─────────────────────────
//
// Segmentiert einen importierten Vertrags-Rohtext (PDF/DOCX-Layer) in einzelne
// Klausel-Kandidaten und ordnet jeden Kandidaten einer existierenden
// Klausel-Familie zu (oder markiert "neue Familie noetig"). Zusaetzlich gibt
// die KI bis zu 3 alternative Familien-Vorschlaege mit Konfidenz, einen
// Variants-Match (wenn ein bestehender Variant-Text inhaltlich sehr aehnlich
// ist) und einen Tonfall-/Severity-Vorschlag zurueck.
//
// Wichtige Constraints:
//   - extractedText ist 1:1 aus dem Original (keine Umformulierung) — nur
//     White-Space und Bullet-Marker werden normalisiert.
//   - suggestedFamilyId MUSS aus der mitgelieferten Liste stammen oder null
//     sein. Niemals frei erfundene Family-Ids.
//   - matchedVariantId nur, wenn die KI sich sehr sicher ist (> 0.6 cos-sim).
//   - Maximal 50 Segmente pro Dokument — der Rest wird abgeschnitten.

const ImportClauseSegment = z.object({
  // Kurz-Name (40-60 Zeichen) fuer den Klausel-Editor in der Review-UI.
  suggestedName: z.string().min(3).max(120),
  // 1-2-Satz-Zusammenfassung — wird als clauseVariants.summary uebernommen.
  suggestedSummary: z.string().min(0).max(400),
  // Volltext der Klausel, normalisiert (keine Umformulierung).
  extractedText: z.string().min(20).max(8000),
  // Heuristische Seitenzahl (1-basiert), null wenn unbekannt.
  pageHint: z.number().int().min(1).max(2000).nullable(),
  // Tonfall — passt zur clauseVariantsTable.tone-Enumeration.
  suggestedTone: z.union([
    z.literal("zart"),
    z.literal("moderat"),
    z.literal("standard"),
    z.literal("streng"),
    z.literal("hart"),
  ]),
  // Severity gemaess clauseVariantsTable.severity.
  suggestedSeverity: z.union([
    z.literal("low"),
    z.literal("medium"),
    z.literal("high"),
  ]),
  // Best-Match aus der mitgegebenen Familien-Taxonomie. null = neue Familie.
  suggestedFamilyId: z.string().nullable(),
  // Bis zu 3 weitere Vorschlaege mit Konfidenz 0..1.
  alternativeMatches: z.array(z.object({
    familyId: z.string(),
    confidence: z.number().min(0).max(1),
  })).max(3),
  // Optional: aehnlichste vorhandene Variante (nur wenn cos-sim > ~0.6).
  matchedVariantId: z.string().nullable(),
  similarityScore: z.number().min(0).max(1).nullable(),
});

const ClauseImportSegmentOutput = z.object({
  segments: z.array(ImportClauseSegment).max(50),
  notes: z.array(z.string().min(2).max(240)).max(8),
});

// Maximalwerte für notes — bewusst hier als Konstanten, damit der Sanitizer
// und das Schema dieselben Limits verwenden.
const CLAUSE_IMPORT_NOTE_MAX_LENGTH = 240;
const CLAUSE_IMPORT_NOTE_MIN_LENGTH = 2;
const CLAUSE_IMPORT_NOTES_MAX_ENTRIES = 8;

/**
 * Sanitisiert die rohe Tool-Antwort des `clause.import.segment`-Prompts,
 * BEVOR zod sie strikt validiert. Hintergrund (Task #105):
 * Sonnet liefert gelegentlich `notes`-Einträge, die länger als 240 Zeichen
 * sind (z. B. eine ausführliche Fußnote). Vorher kippte das den ganzen Job
 * mit `validation_error`, obwohl die Klausel-Vorschläge selbst valide waren.
 *
 * Der Sanitizer verändert nur das `notes`-Feld:
 *   - kürzt zu lange Strings auf 240 Zeichen (mit "…")
 *   - droppt zu kurze / leere / nicht-string-Einträge
 *   - kappt das Array auf maximal 8 Einträge
 *   - normalisiert ein fehlendes / falsch typisiertes `notes` auf []
 * Alle anderen Felder (insb. `segments`) bleiben unverändert und müssen
 * weiterhin strikt durch zod laufen.
 */
export function coerceClauseImportSegmentInput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const input = raw as Record<string, unknown>;
  const rawNotes = input.notes;
  const notes: string[] = [];
  if (Array.isArray(rawNotes)) {
    for (const entry of rawNotes) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (trimmed.length < CLAUSE_IMPORT_NOTE_MIN_LENGTH) continue;
      if (trimmed.length <= CLAUSE_IMPORT_NOTE_MAX_LENGTH) {
        notes.push(trimmed);
      } else {
        // Truncate auf 239 Zeichen + Ellipsis = 240 Zeichen Gesamtlänge.
        notes.push(trimmed.slice(0, CLAUSE_IMPORT_NOTE_MAX_LENGTH - 1) + '…');
      }
      if (notes.length >= CLAUSE_IMPORT_NOTES_MAX_ENTRIES) break;
    }
  }
  return { ...input, notes };
}

export interface ClauseImportSegmentInput {
  rawText: string;
  fileName: string;
  language: "de" | "en";
  contractTypeCode: string | null;
  // Familien-Taxonomie als Lookup. KI MUSS suggestedFamilyId aus dieser
  // Liste waehlen oder null zurueckgeben.
  families: Array<{ id: string; name: string; description: string }>;
  // Bestehende Varianten als Lookup fuer matchedVariantId. KI vergleicht
  // extractedText nur mit Varianten in der gleichen vorgeschlagenen Familie.
  variants: Array<{ id: string; familyId: string; name: string; summary: string }>;
}

export const clauseImportSegment: PromptDefinition<
  ClauseImportSegmentInput,
  z.infer<typeof ClauseImportSegmentOutput>
> = {
  key: "clause.import.segment",
  model: "claude-sonnet-4-6",
  system:
    "You are the DealFlow Copilot in Clause-Library Import mode. You receive " +
    "the raw text of an uploaded existing contract and segment it into " +
    "individual clauses (e.g. confidentiality, liability, termination). For " +
    "each clause you assign it to the best family from the provided " +
    "taxonomy or mark it as 'new family needed' (familyId=null). " +
    "If the clause text is nearly identical in content to an existing " +
    "variant (estimated cos similarity > 0.6), set matchedVariantId and " +
    "similarityScore, otherwise null. extractedText is 1:1 from the " +
    "original — you only normalize white-space and bullet markers. Never " +
    "rephrase. Never summarize. Maximum 50 segments; if the document is " +
    "larger, segment the most important first 50 and note that in notes. " +
    "notes: maximum 8 entries, each entry SHORT (maximum 240 characters). " +
    "Shorten long observations; split multiple points into multiple entries. " +
    SAFE_GERMAN_HINT,
  buildUser: (input) => {
    const familyList = input.families
      .map((f) => `- ${f.id}: ${f.name} — ${f.description}`)
      .join("\n");
    const variantList = input.variants
      .slice(0, 200)
      .map((v) => `- ${v.id} (familyId=${v.familyId}): ${v.name} | ${v.summary}`)
      .join("\n");
    return (
      `File: ${input.fileName}\n` +
      `Language: ${input.language}\n` +
      (input.contractTypeCode ? `Contract type: ${input.contractTypeCode}\n` : "") +
      `\nAvailable clause families (id: name — description):\n${familyList}\n` +
      `\nExisting variants in these families:\n${variantList || "(none)"}\n` +
      `\nContract raw text (truncated):\n"""${input.rawText}"""`
    );
  },
  outputSchema: ClauseImportSegmentOutput,
  toolDescription:
    "Returns a list of clause segments with suggestedName, " +
    "suggestedSummary, extractedText (1:1), pageHint, suggestedTone, " +
    "suggestedSeverity, suggestedFamilyId (from list or null), " +
    "alternativeMatches (max 3), and matchedVariantId (optional).",
  toolName: "report_clause_import_segments",
  // Defensive Sanitisierung: zu lange notes-Einträge werden gekürzt statt
  // den ganzen Job zu killen (Task #105).
  coerceInput: coerceClauseImportSegmentInput,
};

// ───────────────────────── 12. Contract Consistency Lint (Task #230) ─────────────────────────
//
// Semantische Ergänzung zum deterministischen Linter (lib/contractLinter).
// Der deterministische Linter findet hard signals: fehlende Pflicht-Familien,
// kaputte Querverweise, widersprüchliche Fristen. Diese KI prüft semantisch:
//   - widersprüchliche Aussagen, die nicht über Zahlen erkennbar sind
//   - undefinierte Abkürzungen / Begriffe ohne Definition
//   - fehlende Abschnitte, die für den Vertragstyp branchenüblich sind
//
// Wichtig: KI ergänzt, ersetzt aber nicht die deterministischen Regeln.
// Findings werden in der UI mit Quelle „ai" markiert und nie als Hard-Stop
// für Approvals verwendet (Hard-Stop bleibt deterministisch).

const ContractConsistencyFinding = z.object({
  category: z.union([
    z.literal("cross_reference"),
    z.literal("definitions"),
    z.literal("attachments"),
    z.literal("mandatory_clauses"),
    z.literal("forbidden_clauses"),
    z.literal("numeric_consistency"),
    z.literal("semantic"),
  ]),
  severity: z.union([z.literal("info"), z.literal("warn"), z.literal("error")]),
  message: z.string().min(4).max(400),
  contractClauseId: z.string().nullable(),
  snippet: z.string().max(240).nullable(),
  suggestion: z.string().min(0).max(300).nullable(),
});

const ContractConsistencyOutput = z.object({
  findings: z.array(ContractConsistencyFinding).max(40),
  notes: z.array(z.string().min(2).max(240)).max(6),
  confidence: CONFIDENCE_LEVEL,
  confidenceReason: CONFIDENCE_REASON,
});

export interface ContractConsistencyInput {
  contract: {
    id: string;
    title: string;
    contractTypeCode: string | null;
    language: "de" | "en";
  };
  /** Vertragstext, klauselweise nummeriert (1..N), wie er im Editor dargestellt wird. */
  clauses: Array<{
    id: string;
    ordinal: number;
    family: string;
    body: string;
  }>;
  /** Anzahl der Anlagen. `null` = Anlagen-Tracking ist (noch) nicht aktiv. */
  attachmentCount: number | null;
  /** Bereits gefundene deterministische Findings — KI soll nicht doppelt melden. */
  deterministicFindings: Array<{
    category: string;
    severity: string;
    message: string;
  }>;
}

export const contractConsistency: PromptDefinition<
  ContractConsistencyInput,
  z.infer<typeof ContractConsistencyOutput>
> = {
  key: "contract.consistency",
  model: "claude-sonnet-4-6",
  system:
    "Du bist DealFlow-Copilot im Modus Vertrags-Konsistenz-Prüfung. Du " +
    "ergänzt einen deterministischen Linter um SEMANTISCHE Befunde, die " +
    "nicht über Regex / Familien-Vergleich auffindbar sind. Beispiele: " +
    "ein Abschnitt nennt eine Pflicht ohne Frist; eine Definition wird " +
    "implizit verwendet, ohne sauber eingeführt zu sein; zwei Klauseln " +
    "regeln dasselbe Thema unterschiedlich (z. B. Eigentum vs. Lizenz). " +
    "Wiederhole NIE eine bereits im Input enthaltene deterministische " +
    "Meldung. Liefere maximal 12 wirklich relevante Befunde. Wenn du " +
    "unsicher bist, lieber weniger Findings (Konfidenz 'low'). " +
    SAFE_GERMAN_HINT,
  buildUser: (input) => {
    const clauseList = input.clauses
      .map(c => `§ ${c.ordinal} ${c.family} (id=${c.id})\n${c.body.slice(0, 1500)}`)
      .join("\n\n");
    const detList = input.deterministicFindings
      .map(f => `- [${f.severity}] ${f.category}: ${f.message}`)
      .join("\n") || "(keine)";
    return (
      `Vertrag: ${input.contract.title}\n` +
      `Typ: ${input.contract.contractTypeCode ?? "—"}, Sprache: ${input.contract.language}\n` +
      `Anlagen: ${input.attachmentCount}\n\n` +
      `Bereits deterministisch gemeldet (NICHT wiederholen):\n${detList}\n\n` +
      `Klauseln:\n${clauseList}`
    );
  },
  outputSchema: ContractConsistencyOutput,
  toolDescription:
    "Liefert eine Liste semantischer Konsistenz-Befunde mit category, " +
    "severity (info/warn/error), message, contractClauseId (oder null) und " +
    "optionaler suggestion. Plus confidence + confidenceReason.",
  toolName: "report_contract_consistency",
};

// ───────────────────────── Lead Widget Summary (Task #262) ─────────────────────────

export interface LeadWidgetSummaryInput {
  brandName: string;
  leadName: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  message: string | null;
  qualifierAnswers: Record<string, string>;
  enrichment: {
    domain?: string | null;
    title?: string | null;
    description?: string | null;
    websiteUrl?: string | null;
  } | null;
  hasBookedMeeting: boolean;
}

const LeadWidgetSummaryOutput = z.object({
  headline: z.string().min(4).max(120),
  summary: z.string().min(20).max(600),
  intent: z.enum(["high", "medium", "low", "unclear"]),
  suggestedNextAction: z.string().min(2).max(200),
});

export const leadWidgetSummary: PromptDefinition<
  LeadWidgetSummaryInput,
  z.infer<typeof LeadWidgetSummaryOutput>
> = {
  key: "lead.widgetSummary",
  model: "claude-haiku-4-5",
  system:
    "Du bist DealFlow.One Sales-Triage. Du bekommst einen frisch eingegangenen " +
    "Lead aus dem Brand-Lead-Widget. Erstelle in 1-2 Sätzen eine knappe " +
    "Zusammenfassung für die Vertriebs-Inbox: Wer fragt an, was will er, wie " +
    "heiß ist die Anfrage. Kein Marketing-Sprech, kein Wiederholen der " +
    "Rohdaten — nur die Essenz für eine schnelle Reaktion. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Lead aus dem Brand-Widget (JSON):\n${JSON.stringify(ctx)}\n\n` +
    `Erstelle eine kurze Headline, eine 2-3-Satz-Zusammenfassung, eine ` +
    `Intent-Einschätzung und einen empfohlenen nächsten Schritt.`,
  outputSchema: LeadWidgetSummaryOutput,
  toolDescription:
    "Returns headline, summary (2-3 sentences), intent rating, and a " +
    "suggested next action for the sales rep.",
  toolName: "report_lead_widget_summary",
};

// ───────────────────────── 13. Regulatorik — Anwendbarkeit (Task #231) ─────────────────────────
//
// Bestimmt aus dem Vertragskontext (Account-Branche, Datenfluss, KI-Nutzung,
// Vertragstyp, Jurisdiktion, Klausel-Familien) welche Regulierungen aus der
// Bibliothek einschlägig sind. Die KI wählt ausschließlich aus den im Input
// gelieferten Frameworks und liefert pro Auswahl eine Begründung.

const RegulatoryApplicabilitySelection = z.object({
  frameworkId: z.string().min(2).max(80),
  applicable: z.boolean(),
  reason: z.string().min(4).max(600),
});

const RegulatoryApplicabilityOutput = z.object({
  selections: z.array(RegulatoryApplicabilitySelection).max(40),
  notes: z.array(z.string().min(2).max(280)).max(5),
  confidence: CONFIDENCE_LEVEL,
  confidenceReason: CONFIDENCE_REASON,
});

export interface RegulatoryApplicabilityInput {
  contract: ContractContext;
  /** Heuristisch ermittelte Signale aus Vertrag/Account/Klauseln. */
  signals: {
    industry: string | null;
    sizeBracket: string | null;
    jurisdiction: string | null;
    contractType: string | null;
    dataProcessing: boolean;
    aiUsage: boolean;
    serviceType: string | null;
    clauseFamilies: string[];
  };
  /** Bibliothek (System + Tenant). KI MUSS frameworkId aus dieser Liste wählen. */
  frameworks: Array<{
    id: string;
    code: string;
    title: string;
    shortLabel: string;
    summary: string;
    jurisdiction: string;
    applicabilityRules: Array<{ kind: string; values?: string[]; note?: string }>;
  }>;
}

export const contractRegulatoryApplicability: PromptDefinition<
  RegulatoryApplicabilityInput,
  z.infer<typeof RegulatoryApplicabilityOutput>
> = {
  key: "contract.regulatoryApplicability",
  model: "claude-sonnet-4-6",
  system:
    "Du bist DealFlow-Copilot im Modus Regulatorik-Anwendbarkeit. Du " +
    "erhältst einen Vertrag mit Branche, Jurisdiktion, Datenfluss-/KI-" +
    "Indikatoren und Klausel-Familien sowie eine Liste verfügbarer " +
    "Regulierungen. Du entscheidest pro Regulierung, ob sie auf den Vertrag " +
    "anwendbar ist (true/false) und begründest die Entscheidung in 1-3 " +
    "Sätzen unter Bezug auf konkrete Signale (z. B. \"Account-Branche " +
    "Healthcare → Hochrisiko-KI\"). Wähle frameworkId NUR aus der mitge" +
    "lieferten Liste; erfinde keine IDs. Sei eher inklusiv: bei plausibler " +
    "Anwendbarkeit applicable=true mit klarer Begründung. Liefere für JEDE " +
    "Regulierung in der Liste genau eine Selection. " +
    SAFE_GERMAN_HINT,
  buildUser: (input) => {
    const fwList = input.frameworks
      .map((f) =>
        `- ${f.id} (${f.code}, ${f.jurisdiction}): ${f.title}\n` +
        `    ${f.summary.slice(0, 280)}\n` +
        `    Trigger: ${f.applicabilityRules.map((r) => r.kind + (r.values ? `=${r.values.join("/")}` : "")).join("; ")}`,
      )
      .join("\n");
    return (
      `Vertrag: ${input.contract.contract.title} (Status: ${input.contract.contract.status})\n` +
      `Account: ${input.contract.account.name}, Branche: ${input.signals.industry ?? "?"}, Land: ${input.contract.account.country}\n` +
      `Größe: ${input.signals.sizeBracket ?? "?"}\n` +
      `Vertragstyp: ${input.signals.contractType ?? "?"}\n` +
      `Jurisdiktion: ${input.signals.jurisdiction ?? "?"}\n` +
      `Datenverarbeitung erkennbar: ${input.signals.dataProcessing}\n` +
      `KI-Nutzung erkennbar: ${input.signals.aiUsage}\n` +
      `Service-Typ-Hinweis: ${input.signals.serviceType ?? "—"}\n` +
      `Klausel-Familien: ${input.signals.clauseFamilies.join(", ") || "—"}\n\n` +
      `Verfügbare Regulierungen:\n${fwList}`
    );
  },
  outputSchema: RegulatoryApplicabilityOutput,
  toolDescription:
    "Liefert pro Regulierung eine Anwendbarkeits-Entscheidung (applicable + " +
    "reason). frameworkId stammt strikt aus der Eingabeliste. Plus globale " +
    "notes, confidence und confidenceReason.",
  toolName: "report_regulatory_applicability",
};

// ───────────────────────── 14. Regulatorik — Compliance-Check (Task #231) ─────────────────────────
//
// Prüft die Vertragsklauseln gegen die Pflicht-Anforderungen EINER konkreten
// Regulierung. Pro Anforderung liefert die KI: Status (met/partial/missing),
// kurze Notiz, ggf. Snippet der Vertragsstelle und konkrete Empfehlung.

const RegulatoryFinding = z.object({
  requirementId: z.string().min(2).max(80),
  status: z.union([z.literal("met"), z.literal("partial"), z.literal("missing")]),
  note: z.string().min(2).max(500),
  // Empfehlung, was zu tun ist (oder null wenn met).
  suggestion: z.string().min(2).max(600).nullable(),
  // Optional: ID der primären Vertragsklausel, in der die Anforderung belegt
  // ist (für Rückwärtskompatibilität — neue Pipelines verwenden
  // evidenceClauseIds).
  contractClauseId: z.string().max(80).nullable(),
  // IDs ALLER Vertragsklauseln, die diesen Befund stützen oder ausgelöst
  // haben. Das Frontend rendert sie als klickbare Chips, die zur Klausel
  // im Vertrag scrollen. Bei status='missing' darf die Liste leer bleiben
  // oder ganz fehlen. Maximal 10 Chips pro Befund — mehr ist UI-seitig
  // nicht sinnvoll.
  evidenceClauseIds: z.array(z.string().min(2).max(80)).max(10).optional(),
  // Optional: kurzer Auszug aus der Klausel als Beleg.
  snippet: z.string().max(400).nullable(),
});

const RegulatoryCheckOutput = z.object({
  findings: z.array(RegulatoryFinding).max(40),
  // Aggregat: compliant = alle met; partial = mind. ein partial/missing aber
  // kein must-missing; non_compliant = mind. ein "must" missing.
  overallStatus: z.union([
    z.literal("compliant"),
    z.literal("partial"),
    z.literal("non_compliant"),
  ]),
  summary: z.string().min(4).max(500),
  confidence: CONFIDENCE_LEVEL,
  confidenceReason: CONFIDENCE_REASON,
});

export interface RegulatoryCheckInput {
  framework: {
    id: string;
    code: string;
    title: string;
    shortLabel: string;
    summary: string;
    jurisdiction: string;
  };
  requirements: Array<{
    id: string;
    code: string;
    title: string;
    description: string;
    normRef: string;
    severity: string;
    recommendedClauseFamily: string | null;
    recommendedClauseText: string | null;
  }>;
  contract: {
    id: string;
    title: string;
    contractType: string | null;
    language: "de" | "en";
  };
  clauses: Array<{
    id: string;
    family: string;
    summary: string;
    body: string;
  }>;
}

export const contractRegulatoryCheck: PromptDefinition<
  RegulatoryCheckInput,
  z.infer<typeof RegulatoryCheckOutput>
> = {
  key: "contract.regulatoryCheck",
  model: "claude-sonnet-4-6",
  system:
    "Du bist DealFlow-Copilot im Modus Regulatorik-Compliance. Du erhältst " +
    "EINE Regulierung mit ihren Pflicht-Anforderungen (requirements) und die " +
    "Klauseln des zu prüfenden Vertrags. Pro Anforderung entscheidest du: " +
    "met (klar abgedeckt), partial (teilweise abgedeckt — wesentliche Aspekte " +
    "fehlen), missing (nicht erkennbar). Bei partial/missing lieferst du eine " +
    "konkrete, umsetzbare Empfehlung in Vertragssprache (suggestion). " +
    "QUELLEN-VERLINKUNG (PFLICHT für Audit-Tauglichkeit): Pro Befund listest " +
    "du in evidenceClauseIds ALLE Klausel-IDs auf, die den Befund stützen " +
    "oder ausgelöst haben — bei met sind das die abdeckenden Klauseln, bei " +
    "partial die teilabdeckenden Klauseln, bei missing kann die Liste leer " +
    "bleiben oder nahegelegene Klauseln nennen, in denen die Anforderung " +
    "stehen müsste. Verwende AUSSCHLIESSLICH IDs aus der gelieferten " +
    "Klauselliste (in eckigen Klammern); erfinde keine IDs und nimm keine " +
    "requirement-IDs. Setze contractClauseId zusätzlich auf die wichtigste " +
    "(erste) Beleg-Klausel und snippet auf einen Auszug daraus (max. 200 " +
    "Zeichen). Wähle requirementId NUR aus der gelieferten Liste; erfinde " +
    "keine. Liefere overallStatus aggregiert: 'compliant' = alle " +
    "Anforderungen met; 'partial' = ein/mehrere partial/missing aber kein " +
    "kritisches must-missing; 'non_compliant' = mindestens eine must-" +
    "Anforderung missing. Schreibe im Stil eines Senior-Vertragsanwalts: " +
    "präzise, mit Norm-Bezug, ohne Marketing-Floskeln. " +
    SAFE_GERMAN_HINT,
  buildUser: (input) => {
    const reqList = input.requirements
      .map(
        (r) =>
          `- ${r.id} [${r.code}, ${r.severity}] ${r.title} (${r.normRef})\n` +
          `    ${r.description}` +
          (r.recommendedClauseFamily
            ? `\n    Erwartete Klausel-Familie: ${r.recommendedClauseFamily}`
            : ""),
      )
      .join("\n");
    const clauseList = input.clauses
      .map((c) => `[${c.id}] § ${c.family} — ${c.summary}\n${(c.body ?? "").slice(0, 1500)}`)
      .join("\n\n");
    return (
      `Regulierung: ${input.framework.title} (${input.framework.code}, ${input.framework.jurisdiction})\n` +
      `Kurzbeschreibung: ${input.framework.summary.slice(0, 400)}\n\n` +
      `Vertrag: ${input.contract.title} (Typ: ${input.contract.contractType ?? "?"}, Sprache: ${input.contract.language})\n\n` +
      `Pflicht-Anforderungen:\n${reqList}\n\n` +
      `Vertrags-Klauseln:\n${clauseList || "(keine Klauseln im Vertrag — alle missing)"}\n`
    );
  },
  outputSchema: RegulatoryCheckOutput,
  toolDescription:
    "Liefert pro Pflicht-Anforderung der Regulierung einen Status (met/" +
    "partial/missing) mit Notiz, optionaler suggestion, contractClauseId, " +
    "evidenceClauseIds (alle Beleg-Klausel-IDs für Audit-Drilldown) und " +
    "snippet. Plus aggregierter overallStatus (compliant/partial/non_compliant), " +
    "summary, confidence und confidenceReason.",
  toolName: "report_regulatory_check",
};

// ───────────────────────── Bundle ─────────────────────────

export const DEALFLOW_PROMPTS = {
  [dealSummary.key]: dealSummary,
  [negotiationSupport.key]: negotiationSupport,
  [pricingReview.key]: pricingReview,
  [approvalReadiness.key]: approvalReadiness,
  [contractDrafting.key]: contractDrafting,
  [contractRisk.key]: contractRisk,
  [contractNegotiation.key]: contractNegotiation,
  [contractRedline.key]: contractRedline,
  [priceIncreaseSupport.key]: priceIncreaseSupport,
  [executiveBrief.key]: executiveBrief,
  [commercialHealthCheck.key]: commercialHealthCheck,
  [helpAssistant.key]: helpAssistant,
  [externalContractExtract.key]: externalContractExtract,
  [clauseImportSegment.key]: clauseImportSegment,
  [contractConsistency.key]: contractConsistency,
  [leadWidgetSummary.key]: leadWidgetSummary,
  [contractRegulatoryApplicability.key]: contractRegulatoryApplicability,
  [contractRegulatoryCheck.key]: contractRegulatoryCheck,
} as const;

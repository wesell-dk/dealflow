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
  "Sprache: deutsch. Formuliere klar, faktisch, geschäftstauglich. Keine " +
  "Marketing-Phrasen. Keine Emojis. Keine Halluzinationen — wenn der Kontext " +
  "kein eindeutiges Signal enthält, vermerke das explizit.";

// ───────────────────────── 1. Deal Summary ─────────────────────────

const DealSummaryOutput = z.object({
  headline: z.string().min(8).max(120),
  status: z.string().min(2).max(400),
  health: RISK,
  keyFacts: z.array(z.string().min(2).max(160)).min(3).max(8),
  blockers: z.array(z.string().min(2).max(200)).max(6),
  nextSteps: z.array(z.string().min(2).max(200)).min(1).max(5),
  recommendedAction: ACTION_TYPE,
});

export const dealSummary: PromptDefinition<
  DealContext,
  z.infer<typeof DealSummaryOutput>
> = {
  key: "deal.summary",
  model: "claude-sonnet-4-6",
  system:
    "Du bist DealFlow-Copilot im Modus Deal Summary. Du erhältst einen " +
    "vollständigen Deal-Kontext (Stammdaten, aktuelles Angebot, offene " +
    "Approvals, Verträge, Timeline) und lieferst eine prägnante, faktenbasierte " +
    "Übersicht für Sales/RevOps. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Erzeuge eine Deal-Zusammenfassung für folgenden Kontext (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: DealSummaryOutput,
  toolDescription:
    "Liefert headline (1 Satz), status, health-Einschätzung, 3-8 keyFacts, " +
    "blockers, 1-5 nextSteps und eine recommendedAction.",
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
    "Du bist DealFlow-Copilot im Modus Negotiation Support. Auf Basis des " +
    "Deal-Kontextes (inkl. Timeline, Approvals, aktuelles Angebot) " +
    "klassifizierst du die offenen Verhandlungsthemen, schätzt deren Impact " +
    "und schlägst Antwortentwürfe (intern + extern) vor. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Analysiere die Verhandlungslage und antworte strukturiert. Kontext (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: NegotiationOutput,
  toolDescription:
    "Liefert customerStance, klassifizierte openTopics mit Impact, einen " +
    "internen und einen externen Antwortentwurf sowie eine recommendedAction.",
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
});

export const pricingReview: PromptDefinition<
  QuoteContext,
  z.infer<typeof PricingReviewOutput>
> = {
  key: "pricing.review",
  model: "claude-sonnet-4-6",
  system:
    "Du bist DealFlow-Copilot im Modus Pricing Review. Auf Basis von Quote, " +
    "aktiver Version, Line-Items und der Brand-/Company-eigenen Preispositionen " +
    "bewertest du Marge, Rabatt und Policy-Konformität. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Bewerte das Pricing dieses Angebots. Kontext (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: PricingReviewOutput,
  toolDescription:
    "Liefert summary, marginAssessment, discountAssessment, policyFlags " +
    "(severity-eingestuft), approvalRelevance und recommendedAction.",
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
});

export const approvalReadiness: PromptDefinition<
  ApprovalContext,
  z.infer<typeof ApprovalReadinessOutput>
> = {
  key: "approval.readiness",
  model: "claude-sonnet-4-6",
  system:
    "Du bist DealFlow-Copilot im Modus Approval Readiness. Du bewertest, ob " +
    "ein Approval-Fall entscheidungsreif ist, formulierst eine prägnante " +
    "Entscheidungsempfehlung (approve / approve_with_conditions / request_info / " +
    "reject), nennst fehlende Informationen und Schlüssel-Abweichungen. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) => {
    const missingHints: string[] = [];
    if (ctx.missingTranslations && ctx.missingTranslations.length > 0) {
      const locale = ctx.contract?.language ?? 'en';
      const families = Array.from(new Set(ctx.missingTranslations.map((m) => m.family))).sort();
      missingHints.push(
        `Übersetzungen für Vertragssprache "${locale}" fehlen für Klauselfamilien: ${families.join(', ')}. ` +
        `Bitte explizit in missingInformation aufnehmen ("Übersetzung [${locale}] fehlt: <Familie>").`,
      );
    }
    const hintsBlock = missingHints.length > 0 ? `\nDeterministische Hinweise:\n- ${missingHints.join('\n- ')}\n` : '';
    return `Bewerte die Entscheidungsreife dieses Approval-Falls.${hintsBlock}Kontext (JSON):\n${JSON.stringify(ctx)}`;
  },
  outputSchema: ApprovalReadinessOutput,
  toolDescription:
    "Liefert decisionReady, recommendation, rationale, missingInformation, " +
    "keyDeviations und eine recommendedAction.",
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
});

export const contractDrafting: PromptDefinition<
  DealContext,
  z.infer<typeof ContractDraftOutput>
> = {
  key: "contract.draft",
  model: "claude-sonnet-4-6",
  system:
    "Du bist DealFlow-Copilot im Modus Contract Drafting. Du leitest aus dem " +
    "kommerziellen Status (Deal, Brand, Quote, Account) eine Vorbelegung für " +
    "einen Vertragsentwurf ab — Template-Empfehlung, Feld-Vorbelegung mit " +
    "Quellen, sowie Klausel-Empfehlungen mit soft/standard/hard-Variante. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Schlage einen Vertragsentwurf für diesen Deal vor. Kontext (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: ContractDraftOutput,
  toolDescription:
    "Liefert draftTitle, recommendedTemplate, prefillSuggestions mit Quelle, " +
    "clauseRecommendations (soft/standard/hard) und openQuestions.",
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
});

export const contractRisk: PromptDefinition<
  ContractContext,
  z.infer<typeof ContractRiskOutput>
> = {
  key: "contract.risk",
  model: "claude-sonnet-4-6",
  system:
    "Du bist DealFlow-Copilot im Modus Contract Risk Review. Du analysierst " +
    "die Klausel-Lage des Vertrages, vergleichst mit dem zugehörigen Deal/" +
    "Quote-Kontext, und lieferst Risikosignale mit Klausel-Bezug, Schweregrad " +
    "und konkreter Empfehlung. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Bewerte das Vertragsrisiko für folgenden Vertrag. Kontext (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: ContractRiskOutput,
  toolDescription:
    "Liefert overallRisk, overallScore (0-100), summary, riskSignals mit " +
    "Klausel/Severity/Finding/Recommendation, approvalRelevant, recommendedAction.",
  toolName: "report_contract_risk",
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
});

// External-Paper-Input ist absichtlich anders strukturiert: rohtext +
// Vertrags-/Deal-Bezug (für Scope-Anker).
export interface RedlineInput {
  contract: ContractContext;
  externalText: string;
}

export const contractRedline: PromptDefinition<
  RedlineInput,
  z.infer<typeof RedlineOutput>
> = {
  key: "contract.redline",
  model: "claude-sonnet-4-6",
  system:
    "Du bist DealFlow-Copilot im Modus External Paper / Redline Analysis. Du " +
    "vergleichst ein extern geliefertes Vertragsdokument mit dem internen " +
    "Vertrags-Stand, identifizierst bekannte Klauseln samt Abweichung, listest " +
    "unbekannte Themen und schlägst einen Review-Pfad vor. " +
    SAFE_GERMAN_HINT,
  buildUser: (input) =>
    `Vergleiche das folgende externe Dokument mit unserem Vertragsstand.\n\n` +
    `Interner Kontext (JSON):\n${JSON.stringify(input.contract)}\n\n` +
    `Externes Dokument (Rohtext):\n"""${input.externalText}"""`,
  outputSchema: RedlineOutput,
  toolDescription:
    "Liefert documentSummary, identifiedClauses mit Abweichungs-Klassifikation, " +
    "unknownTopics, recommendedReviewPath und executiveSummary.",
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
    "Du bist DealFlow-Copilot im Modus Price Increase Support. Auf Basis des " +
    "Deal-Kontextes (Account, Brand, aktuelles Angebot) entwirfst du ein " +
    "Preisänderungsschreiben, schätzt das Churn-Risiko und schlägst Folge-" +
    "Aktionen vor. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Bereite einen Price-Increase-Vorgang für diesen Deal vor. Kontext (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: PriceIncreaseOutput,
  toolDescription:
    "Liefert affectedPositions, letterDraft, churnRisk, recommendedFollowUps " +
    "und eine recommendedAction.",
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
    "Du bist DealFlow-Copilot im Modus Executive Briefing. Du fasst den Deal " +
    "in einer Form zusammen, die in einem 60-Sekunden-Management-Briefing " +
    "passt — präzise, ohne Fachjargon-Overload. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Erzeuge ein Executive Briefing zu diesem Deal. Kontext (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: ExecutiveBriefOutput,
  toolDescription:
    "Liefert headline, oneLiner, 2-6 highlights, bis zu 6 risks und bis zu 4 asks.",
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
    "Du bist DealFlow-Copilot im Modus Commercial Health Check. Du bewertest " +
    "die kommerzielle Gesundheit des Deals (Pipeline, Risiko, Engpässe) und " +
    "leitest konkrete nächste Schritte ab. " +
    SAFE_GERMAN_HINT,
  buildUser: (ctx) =>
    `Bewerte die Commercial Health dieses Deals. Kontext (JSON):\n${JSON.stringify(ctx)}`,
  outputSchema: HealthCheckOutput,
  toolDescription:
    "Liefert overallHealth, pipelineSignals, riskSignals, bottlenecks und " +
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
    "Du bist der Hilfe-Assistent von DealFlow.One — einer B2B Commercial " +
    "Execution Platform. Beantworte Fragen kurz, konkret und auf Deutsch. " +
    "Du kennst die Plattform-Struktur (siehe routes im Input) und kannst " +
    "über das Tool eine optionale UI-Aktion vorschlagen.\n\n" +
    "Regeln für action.kind:\n" +
    " - 'open_create_account' wenn der Nutzer einen Kunden/Account anlegen will. " +
    "Sage in reply z.B. 'Klar, ich öffne den Dialog – fülle Name, Branche und Land aus.'\n" +
    " - 'open_create_deal' wenn ein Deal/Opportunity angelegt werden soll. " +
    "Wenn der Nutzer einen Kunden namentlich nennt und du ihn in recentAccounts findest, " +
    "setze accountId. Sage in reply z.B. 'Alles klar, ich öffne den Deal-Dialog.'\n" +
    " - 'navigate' nur wenn der Nutzer explizit zu einem Bereich gehen will " +
    "(z.B. 'zeig mir die Pipeline'). Setze path auf eine Route aus dem Input.\n" +
    " - 'none' für reine Fragen-Beantwortung.\n\n" +
    "suggestions: 0–3 weiterführende Klick-Vorschläge (Label + Pfad aus routes).\n\n" +
    "Halte reply prägnant (max. 3 Sätze). Keine Marketing-Phrasen, keine Emojis. " +
    "Wenn du die Antwort nicht weißt, sag das ehrlich und schlage einen passenden " +
    "Bereich vor. Beziehe dich bei Bedarf auf currentPath, um die Antwort zu " +
    "kontextualisieren ('Auf dieser Seite siehst du…').",
  buildUser: (input) => {
    const recentHistory = input.history.slice(-6);
    return [
      `currentPath: ${input.currentPath}`,
      `user: ${input.user.name} (${input.user.role}${input.user.tenantWide ? ", tenant-weit" : ", eingeschränkter Scope"})`,
      `Plattform-Daten: ${input.counts.accounts} Kunden, ${input.counts.deals} Deals, ${input.counts.quotes} Angebote, ${input.counts.contracts} Verträge, ${input.counts.approvals} Approvals`,
      `verfügbare Routen (Auswahl):\n${input.routes.map(r => `  - ${r.path} — ${r.title}: ${r.purpose}`).join("\n")}`,
      `letzte Kunden:\n${input.recentAccounts.map(a => `  - ${a.id}: ${a.name}`).join("\n") || "  (keine)"}`,
      `letzte Deals:\n${input.recentDeals.map(d => `  - ${d.id}: ${d.name} → ${d.accountName} (${d.stage})`).join("\n") || "  (keine)"}`,
      recentHistory.length > 0 ? `\nGesprächsverlauf:\n${recentHistory.map(m => `  ${m.role}: ${m.content}`).join("\n")}` : "",
      `\nFrage: ${input.question}`,
    ].filter(Boolean).join("\n");
  },
  outputSchema: HelpAssistantOutput,
  toolDescription:
    "Antwort des Hilfe-Assistenten. reply = kurze deutsche Antwort. " +
    "suggestions = 0-3 weiterführende Links. action = optionale UI-Aktion " +
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
    'Du bist DealFlow-Copilot im Modus External Contract Intake. Du erhaelst ' +
    'den extrahierten Rohtext eines hochgeladenen Bestandsvertrags (PDF/DOCX) ' +
    'und identifizierst die strukturellen Kerndaten. Datumsangaben gibst du ' +
    'als ISO-8601 (YYYY-MM-DD) zurueck; Betraege als reine Dezimalzahl ohne ' +
    'Tausendertrennzeichen. Konfidenz pro Feld als 0..1, wobei 0 = kein ' +
    'Signal im Text, 1 = explizit benannt. Felder, fuer die der Text keinen ' +
    'klaren Beleg liefert, lieferst du als null. Niemals raten. ' +
    SAFE_GERMAN_HINT,
  buildUser: (input) =>
    `Extrahiere die Kerndaten aus folgendem Vertrags-Rohtext.\n` +
    `Dateiname: ${input.fileName}\n\n` +
    `Rohtext (gekuerzt):\n"""${input.rawText}"""`,
  outputSchema: ExternalContractExtractOutput,
  toolDescription:
    'Liefert title, contractTypeGuess, parties (role+name), currency, ' +
    'valueAmount, effectiveFrom/To (ISO), autoRenewal, renewalNoticeDays, ' +
    'terminationNoticeDays, governingLaw, jurisdiction, ' +
    'identifiedClauseFamilies (name+confidence), confidence pro Feld, ' +
    'notes (Hinweise fuer manuelle Pruefung).',
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
    "Du bist DealFlow-Copilot im Modus Clause-Library Import. Du erhaelst " +
    "den Rohtext eines hochgeladenen Bestandsvertrags und segmentierst ihn " +
    "in einzelne Klauseln (z. B. Vertraulichkeit, Haftung, Kuendigung). Pro " +
    "Klausel ordnest du sie der besten Familie aus der mitgelieferten " +
    "Taxonomie zu oder markierst sie als 'neue Familie noetig' (familyId=null). " +
    "Wenn der Klausel-Text inhaltlich nahezu identisch zu einer bestehenden " +
    "Variante ist (geschaetzte cos-Aehnlichkeit > 0.6), trag matchedVariantId " +
    "und similarityScore ein, sonst null. extractedText ist 1:1 aus dem " +
    "Original — nur White-Space und Bullet-Marker normalisierst du. Niemals " +
    "umformulieren. Niemals zusammenfassen. Maximal 50 Segmente; wenn das " +
    "Dokument groesser ist, segmentiere die wichtigsten ersten 50 und " +
    "vermerk das in notes. " +
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
      `Datei: ${input.fileName}\n` +
      `Sprache: ${input.language}\n` +
      (input.contractTypeCode ? `Vertrags-Typ: ${input.contractTypeCode}\n` : "") +
      `\nVerfuegbare Klausel-Familien (id: name — beschreibung):\n${familyList}\n` +
      `\nVorhandene Varianten in diesen Familien:\n${variantList || "(keine)"}\n` +
      `\nVertrags-Rohtext (gekuerzt):\n"""${input.rawText}"""`
    );
  },
  outputSchema: ClauseImportSegmentOutput,
  toolDescription:
    "Liefert eine Liste von Klausel-Segmenten mit suggestedName, " +
    "suggestedSummary, extractedText (1:1), pageHint, suggestedTone, " +
    "suggestedSeverity, suggestedFamilyId (aus Liste oder null), " +
    "alternativeMatches (max 3) und matchedVariantId (optional).",
  toolName: "report_clause_import_segments",
};

// ───────────────────────── Bundle ─────────────────────────

export const DEALFLOW_PROMPTS = {
  [dealSummary.key]: dealSummary,
  [negotiationSupport.key]: negotiationSupport,
  [pricingReview.key]: pricingReview,
  [approvalReadiness.key]: approvalReadiness,
  [contractDrafting.key]: contractDrafting,
  [contractRisk.key]: contractRisk,
  [contractRedline.key]: contractRedline,
  [priceIncreaseSupport.key]: priceIncreaseSupport,
  [executiveBrief.key]: executiveBrief,
  [commercialHealthCheck.key]: commercialHealthCheck,
  [helpAssistant.key]: helpAssistant,
  [externalContractExtract.key]: externalContractExtract,
  [clauseImportSegment.key]: clauseImportSegment,
} as const;

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useRunContractNegotiation,
  usePatchContractClause,
  useGetNegotiationAcceptanceStats,
  getListContractClausesQueryKey,
  getGetNegotiationAcceptanceStatsQueryKey,
  getGetNegotiationPlaybookPdfUrl,
  type ContractNegotiationStrategyEnvelope,
  type ClauseNegotiationStrategy,
  type ContractClause,
  type NegotiationAcceptanceStat,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Loader2, Sparkles, FileDown, AlertTriangle, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AIConfidenceBadge } from "@/components/copilot/ai-confidence-badge";
import { AIFeedbackButtons } from "@/components/copilot/ai-feedback-buttons";
import { SecondOpinionPanel } from "@/components/copilot/second-opinion-panel";
import {
  RelatedSourcesBlock,
  type RelatedSourceItem,
} from "@/components/copilot/related-sources-block";

/**
 * Verhandlungs-Strategie-Tab (Task #229).
 *
 * Pro Klausel:
 *   - Ideal- / Ziel- / Walk-Away-Position
 *   - Ökonomische + juristische Begründung
 *   - DE + EN Gegenvorschlag-Text mit Diff zur aktuellen Klausel
 *   - Pro/Contra-Argumente
 *   - Per-Klausel-Konfidenz; bei "low" → Manual-Review-Banner
 *
 * Akzeptieren übernimmt den Counter-Text via PATCH /contract-clauses/:id
 * (editedBody + editedReason) und invalidiert die Klausel-Liste.
 *
 * Quellenangaben aus der juristischen Wissensbasis (Task #227) werden
 * sowohl gesamt (am Footer) als auch pro Klausel (im Drill-Down)
 * angezeigt. Export liefert das Verhandlungs-Playbook als PDF.
 */
export function NegotiationStrategyTab({
  contractId,
  clauses,
}: {
  contractId: string;
  clauses: ReadonlyArray<ContractClause>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [envelope, setEnvelope] = useState<ContractNegotiationStrategyEnvelope | null>(null);
  const [errored, setErrored] = useState(false);

  const runMut = useRunContractNegotiation();
  const patchClause = usePatchContractClause();

  const clauseById = useMemo(
    () => new Map(clauses.map((c) => [c.id, c])),
    [clauses],
  );

  function trigger() {
    setErrored(false);
    runMut.mutate(
      { contractId },
      {
        onSuccess: (env) => setEnvelope(env),
        onError: () => setErrored(true),
      },
    );
  }

  async function acceptCounter(strategy: ClauseNegotiationStrategy, locale: "de" | "en") {
    const body = locale === "de" ? strategy.counterTextDe : strategy.counterTextEn;
    if (!body?.trim()) return;
    try {
      await patchClause.mutateAsync({
        id: strategy.contractClauseId,
        data: {
          editedBody: body,
          editedReason: `AI Negotiation Copilot · ${locale.toUpperCase()} Counter`,
          // Lerneffekt-Tracking (Task #279): Verknüpft die Akzeptanz mit der
          // ursprünglichen ai_recommendations-Zeile, damit der Server die
          // Acceptance-Rate pro Klauselfamilie auswerten kann.
          aiRecommendationId: envelope?.recommendationId ?? null,
          aiCounterFamily: strategy.family,
          aiCounterLocale: locale,
        },
      });
      await qc.invalidateQueries({
        queryKey: getListContractClausesQueryKey(contractId),
      });
      await qc.invalidateQueries({
        queryKey: getGetNegotiationAcceptanceStatsQueryKey(),
      });
      toast({ description: t("pages.contracts.negotiation.acceptCountered") });
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : t("pages.contracts.negotiation.acceptError"),
        variant: "destructive",
      });
    }
  }

  const isPending = runMut.isPending;
  const result = envelope?.result;

  // Acceptance-Rate pro Klauselfamilie (Task #279). Wir holen die Stats nur,
  // sobald die UI eine Strategie anzeigt, damit der Tab vor dem Run keine
  // unnötigen Requests feuert.
  const { data: acceptanceStats } = useGetNegotiationAcceptanceStats({
    query: {
      queryKey: getGetNegotiationAcceptanceStatsQueryKey(),
      enabled: Boolean(envelope?.result),
    },
  });
  const familyAcceptance = useMemo(() => {
    const m = new Map<string, NegotiationAcceptanceStat>();
    for (const s of acceptanceStats ?? []) m.set(s.family, s);
    return m;
  }, [acceptanceStats]);

  return (
    <Card data-testid="contract-negotiation-tab">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div className="space-y-1">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("pages.contracts.negotiation.title")}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t("pages.contracts.negotiation.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {envelope && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              asChild
              data-testid="contract-negotiation-export-pdf"
            >
              <a
                href={getGetNegotiationPlaybookPdfUrl(contractId)}
                target="_blank"
                rel="noreferrer"
              >
                <FileDown className="h-3.5 w-3.5 mr-1" />
                {t("pages.contracts.negotiation.exportPdf")}
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant={envelope ? "outline" : "default"}
            className="h-7 text-xs"
            onClick={trigger}
            disabled={isPending}
            data-testid="contract-negotiation-run"
          >
            {isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                {t("pages.contracts.negotiation.running")}
              </>
            ) : envelope ? (
              t("pages.contracts.negotiation.rerun")
            ) : (
              t("pages.contracts.negotiation.run")
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!envelope && !errored && !isPending && (
          <p className="text-xs text-muted-foreground italic" data-testid="contract-negotiation-empty">
            {t("pages.contracts.negotiation.empty")}
          </p>
        )}
        {errored && (
          <p className="text-xs text-destructive" data-testid="contract-negotiation-error">
            {t("pages.contracts.negotiation.error")}
          </p>
        )}
        {result && (
          <>
            <div className="text-sm" data-testid="contract-negotiation-summary">
              <div className="text-xs font-medium uppercase text-muted-foreground mb-1">
                {t("pages.contracts.negotiation.overallSummary")}
              </div>
              <div>{result.overallSummary}</div>
            </div>

            <Accordion type="multiple" className="w-full">
              {result.clauseStrategies.map((strategy) => {
                const clause = clauseById.get(strategy.contractClauseId);
                return (
                  <ClauseStrategyRow
                    key={strategy.contractClauseId}
                    strategy={strategy}
                    clause={clause}
                    busy={patchClause.isPending}
                    onAccept={acceptCounter}
                    familyStat={familyAcceptance.get(strategy.family)}
                  />
                );
              })}
            </Accordion>

            {(acceptanceStats?.length ?? 0) > 0 && (
              <NegotiationAcceptanceSummary
                stats={acceptanceStats ?? []}
                familiesInRun={result.clauseStrategies.map((s) => s.family)}
              />
            )}

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
              <AIConfidenceBadge
                level={envelope.confidenceLevel ?? undefined}
                numeric={envelope.confidence ?? undefined}
                reason={envelope.confidenceReason ?? undefined}
                agreementLevel={
                  envelope.secondOpinion?.status === "completed"
                    ? envelope.secondOpinion.agreementLevel ?? undefined
                    : undefined
                }
                showReason
                testId="contract-negotiation-confidence"
              />
              {envelope.recommendationId && (
                <AIFeedbackButtons
                  recommendationId={envelope.recommendationId}
                  testIdPrefix="contract-negotiation"
                />
              )}
            </div>
            <RelatedSourcesBlock
              sources={(result.relatedSources ?? []) as RelatedSourceItem[]}
              testIdPrefix="contract-negotiation-source"
            />
            {envelope.secondOpinion && (
              <SecondOpinionPanel
                envelope={envelope.secondOpinion}
                testIdPrefix="contract-negotiation-second-opinion"
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function diffWords(a: string, b: string): { text: string; kind: "same" | "add" | "del" }[] {
  const A = (a ?? "").split(/(\s+)/);
  const B = (b ?? "").split(/(\s+)/);
  const m = A.length;
  const n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: { text: string; kind: "same" | "add" | "del" }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      out.push({ text: A[i], kind: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ text: A[i], kind: "del" });
      i++;
    } else {
      out.push({ text: B[j], kind: "add" });
      j++;
    }
  }
  while (i < m) {
    out.push({ text: A[i++], kind: "del" });
  }
  while (j < n) {
    out.push({ text: B[j++], kind: "add" });
  }
  return out;
}

function ClauseStrategyRow({
  strategy,
  clause,
  busy,
  onAccept,
  familyStat,
}: {
  strategy: ClauseNegotiationStrategy;
  clause: ContractClause | undefined;
  busy: boolean;
  onAccept: (s: ClauseNegotiationStrategy, locale: "de" | "en") => void;
  familyStat?: NegotiationAcceptanceStat;
}) {
  const { t } = useTranslation();
  const currentBody = clause?.body ?? "";
  const isLow = strategy.perClauseConfidence === "low";
  const ratePct =
    familyStat && familyStat.acceptanceRate !== null
      ? Math.round(familyStat.acceptanceRate * 100)
      : null;

  return (
    <AccordionItem
      value={strategy.contractClauseId}
      data-testid={`contract-negotiation-clause-${strategy.contractClauseId}`}
    >
      <AccordionTrigger className="hover:no-underline">
        <div className="flex flex-1 items-center justify-between gap-3 pr-2">
          <div className="flex items-center gap-2 min-w-0">
            <Badge variant="outline" className="text-[10px] uppercase">
              {strategy.family}
            </Badge>
            <span className="text-sm font-medium truncate">
              {clause?.summary ?? clause?.variant ?? strategy.family}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {familyStat && familyStat.recommendedCount > 0 && (
              <span
                className="text-[10px] text-muted-foreground tabular-nums"
                title={t("pages.contracts.negotiation.familyAcceptanceTooltip", {
                  defaultValue:
                    "AI Counter für {{family}}: {{accepted}} von {{recommended}} akzeptiert",
                  family: strategy.family,
                  accepted: familyStat.acceptedCount,
                  recommended: familyStat.recommendedCount,
                })}
                data-testid={`contract-negotiation-family-accept-${strategy.contractClauseId}`}
              >
                {ratePct !== null ? `${ratePct}%` : "—"} ·{" "}
                {familyStat.acceptedCount}/{familyStat.recommendedCount}
              </span>
            )}
            <AIConfidenceBadge
              level={strategy.perClauseConfidence}
              reason={strategy.perClauseConfidenceReason}
              testId={`contract-negotiation-clause-conf-${strategy.contractClauseId}`}
            />
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-4">
        {isLow && (
          <div
            className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
            data-testid={`contract-negotiation-manual-review-${strategy.contractClauseId}`}
          >
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{t("pages.contracts.negotiation.manualReviewBanner")}</span>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <PositionBlock
            label={t("pages.contracts.negotiation.currentPosition")}
            tone="muted"
            text={strategy.currentPosition}
          />
          <PositionBlock
            label={t("pages.contracts.negotiation.ideal")}
            tone="success"
            text={strategy.idealPosition}
          />
          <PositionBlock
            label={t("pages.contracts.negotiation.target")}
            tone="info"
            text={strategy.targetPosition}
          />
          <PositionBlock
            label={t("pages.contracts.negotiation.walkAway")}
            tone="danger"
            text={strategy.walkAwayPosition}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2 text-xs">
          <div>
            <div className="font-medium uppercase text-muted-foreground mb-1">
              {t("pages.contracts.negotiation.economicRationale")}
            </div>
            <div>{strategy.economicRationale}</div>
          </div>
          <div>
            <div className="font-medium uppercase text-muted-foreground mb-1">
              {t("pages.contracts.negotiation.legalRationale")}
            </div>
            <div>{strategy.legalRationale}</div>
          </div>
        </div>

        {currentBody && (
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase text-muted-foreground">
              {t("pages.contracts.negotiation.currentText")}
            </div>
            <div className="rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
              {currentBody}
            </div>
          </div>
        )}

        <CounterBlock
          locale="de"
          label={t("pages.contracts.negotiation.counterDe")}
          acceptLabel={t("pages.contracts.negotiation.acceptCounterDe")}
          counter={strategy.counterTextDe}
          current={currentBody}
          busy={busy}
          onAccept={() => onAccept(strategy, "de")}
          testId={`contract-negotiation-counter-de-${strategy.contractClauseId}`}
        />
        <CounterBlock
          locale="en"
          label={t("pages.contracts.negotiation.counterEn")}
          acceptLabel={t("pages.contracts.negotiation.acceptCounterEn")}
          counter={strategy.counterTextEn}
          current={currentBody}
          busy={busy}
          onAccept={() => onAccept(strategy, "en")}
          testId={`contract-negotiation-counter-en-${strategy.contractClauseId}`}
        />

        <div className="grid gap-3 md:grid-cols-2 text-xs">
          <ArgList
            label={t("pages.contracts.negotiation.pro")}
            tone="success"
            items={strategy.proArguments}
          />
          <ArgList
            label={t("pages.contracts.negotiation.contra")}
            tone="danger"
            items={strategy.contraArguments}
          />
        </div>

        {strategy.relatedSources && strategy.relatedSources.length > 0 && (
          <RelatedSourcesBlock
            sources={strategy.relatedSources as RelatedSourceItem[]}
            testIdPrefix={`contract-negotiation-clause-source-${strategy.contractClauseId}`}
          />
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function PositionBlock({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone: "muted" | "success" | "info" | "danger";
}) {
  const cls =
    tone === "success"
      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
      : tone === "info"
        ? "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"
        : tone === "danger"
          ? "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30"
          : "border-muted bg-muted/30";
  return (
    <div className={`rounded-md border p-2 text-xs ${cls}`}>
      <div className="font-medium uppercase mb-1 opacity-80">{label}</div>
      <div className="whitespace-pre-wrap">{text}</div>
    </div>
  );
}

function CounterBlock({
  label,
  acceptLabel,
  counter,
  current,
  busy,
  onAccept,
  testId,
}: {
  locale: "de" | "en";
  label: string;
  acceptLabel: string;
  counter: string;
  current: string;
  busy: boolean;
  onAccept: () => void;
  testId: string;
}) {
  const { t } = useTranslation();
  const segments = useMemo(() => diffWords(current, counter), [current, counter]);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onAccept}
          disabled={busy || !counter?.trim()}
          data-testid={`${testId}-accept`}
        >
          <Check className="h-3.5 w-3.5 mr-1" />
          {acceptLabel}
        </Button>
      </div>
      <div className="rounded-md border p-2 text-xs whitespace-pre-wrap" data-testid={testId}>
        {counter}
      </div>
      {current && counter && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {t("pages.contracts.negotiation.diffPreview")}
          </summary>
          <div className="mt-1 rounded-md border bg-muted/20 p-2 leading-relaxed">
            {segments.map((seg, i) => (
              <span
                key={i}
                className={
                  seg.kind === "add"
                    ? "bg-emerald-200 dark:bg-emerald-900/60"
                    : seg.kind === "del"
                      ? "bg-rose-200 line-through dark:bg-rose-900/60"
                      : ""
                }
              >
                {seg.text}
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Tenant-weite Acceptance-Übersicht für AI-Negotiation-Counter (Task #279).
 * Zeigt eine kompakte Tabelle pro Klauselfamilie: wie oft hat der Copilot
 * im Tenant einen Counter generiert vs. wie oft wurde er übernommen?
 *
 * Die im aktuellen Run verwendeten Familien werden zuerst angezeigt, sodass
 * Verhandler*innen die Acceptance-Signal-Stärke für genau "ihre" Klauseln
 * sofort sehen.
 */
function NegotiationAcceptanceSummary({
  stats,
  familiesInRun,
}: {
  stats: ReadonlyArray<NegotiationAcceptanceStat>;
  familiesInRun: ReadonlyArray<string>;
}) {
  const { t } = useTranslation();
  const inRun = new Set(familiesInRun);
  const sorted = [...stats].sort((a, b) => {
    const aIn = inRun.has(a.family) ? 0 : 1;
    const bIn = inRun.has(b.family) ? 0 : 1;
    if (aIn !== bIn) return aIn - bIn;
    return b.recommendedCount - a.recommendedCount;
  });
  return (
    <details
      className="rounded-md border bg-muted/20 p-2 text-xs"
      data-testid="contract-negotiation-acceptance-summary"
    >
      <summary className="cursor-pointer text-muted-foreground">
        {t("pages.contracts.negotiation.acceptanceSummaryTitle", {
          defaultValue:
            "AI-Counter-Akzeptanz pro Klauselfamilie (alle Verträge dieses Tenants)",
        })}
      </summary>
      <table className="mt-2 w-full">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 pr-2 font-medium">
              {t("pages.contracts.negotiation.acceptanceCol.family", {
                defaultValue: "Familie",
              })}
            </th>
            <th className="py-1 pr-2 font-medium text-right">
              {t("pages.contracts.negotiation.acceptanceCol.recommended", {
                defaultValue: "Vorgeschlagen",
              })}
            </th>
            <th className="py-1 pr-2 font-medium text-right">
              {t("pages.contracts.negotiation.acceptanceCol.accepted", {
                defaultValue: "Übernommen",
              })}
            </th>
            <th className="py-1 pr-2 font-medium text-right">
              {t("pages.contracts.negotiation.acceptanceCol.rate", {
                defaultValue: "Rate",
              })}
            </th>
            <th className="py-1 pr-2 font-medium text-right">DE / EN</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((s) => {
            const ratePct =
              s.acceptanceRate !== null ? Math.round(s.acceptanceRate * 100) : null;
            const highlight = inRun.has(s.family);
            return (
              <tr
                key={s.family}
                className={`border-t ${highlight ? "font-medium" : ""}`}
                data-testid={`contract-negotiation-acceptance-row-${s.family}`}
              >
                <td className="py-1 pr-2 font-mono">{s.family}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {s.recommendedCount}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {s.acceptedCount}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {ratePct !== null ? `${ratePct}%` : "—"}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                  {s.acceptedDe} / {s.acceptedEn}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

function ArgList({
  label,
  items,
  tone,
}: {
  label: string;
  items: ReadonlyArray<string>;
  tone: "success" | "danger";
}) {
  if (!items || items.length === 0) return null;
  const dot = tone === "success" ? "text-emerald-600" : "text-rose-600";
  return (
    <div>
      <div className="font-medium uppercase text-muted-foreground mb-1">{label}</div>
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2">
            <span className={`shrink-0 ${dot}`}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

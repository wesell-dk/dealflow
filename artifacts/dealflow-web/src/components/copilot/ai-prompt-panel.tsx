import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useRunDealSummary,
  useRunPricingReview,
  useRunApprovalReadiness,
  useRunContractRisk,
  type DealSummaryEnvelope,
  type PricingReviewEnvelope,
  type ApprovalReadinessEnvelope,
  type ContractRiskEnvelope,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles } from "lucide-react";
import { AIConfidenceBadge } from "./ai-confidence-badge";
import { AIFeedbackButtons } from "./ai-feedback-buttons";
import { SecondOpinionPanel } from "./second-opinion-panel";
import { RelatedSourcesBlock, type RelatedSourceItem } from "./related-sources-block";

type Mode = "deal.summary" | "pricing.review" | "approval.readiness" | "contract.risk";

type EnvelopeFor<M extends Mode> =
  M extends "deal.summary" ? DealSummaryEnvelope :
  M extends "pricing.review" ? PricingReviewEnvelope :
  M extends "approval.readiness" ? ApprovalReadinessEnvelope :
  M extends "contract.risk" ? ContractRiskEnvelope :
  never;

interface BaseProps<M extends Mode> {
  mode: M;
  entityId: string;
  testIdPrefix?: string;
  onResult?: (envelope: EnvelopeFor<M>) => void;
}

const MODE_TITLE: Record<Mode, string> = {
  "deal.summary": "pages.copilot.aiPanelDealSummaryTitle",
  "pricing.review": "pages.copilot.aiPanelPricingReviewTitle",
  "approval.readiness": "pages.copilot.aiPanelApprovalReadinessTitle",
  "contract.risk": "pages.copilot.aiPanelContractRiskTitle",
};

/**
 * Inline-Panel für die vier Copilot-Touchpoints (Task #69):
 *   deal.summary, pricing.review, approval.readiness, contract.risk.
 *
 * Klick auf "KI-Analyse starten" feuert den jeweiligen Run-Endpunkt.
 * Das Ergebnis-Envelope enthält recommendationId/confidence/confidenceLevel/
 * confidenceReason; Panel rendert AIConfidenceBadge + AIFeedbackButtons.
 *
 * (Für external.contract.extract gibt es eine eigene Integration im Wizard,
 * weil die Extraktion mit dem Upload-Schritt verschmilzt.)
 */
export function AiPromptPanel<M extends Mode>(props: BaseProps<M>) {
  const { mode, entityId, testIdPrefix = `ai-panel-${mode.replace(/\./g, "-")}`, onResult } = props;
  const { t } = useTranslation();
  const [envelope, setEnvelope] = useState<EnvelopeFor<M> | null>(null);
  const [errored, setErrored] = useState(false);

  const dealMut = useRunDealSummary();
  const pricingMut = useRunPricingReview();
  const approvalMut = useRunApprovalReadiness();
  const contractMut = useRunContractRisk();

  const isPending =
    dealMut.isPending || pricingMut.isPending || approvalMut.isPending || contractMut.isPending;

  function trigger() {
    setErrored(false);
    const handle = (env: unknown) => {
      const e = env as EnvelopeFor<M>;
      setEnvelope(e);
      onResult?.(e);
    };
    const fail = () => setErrored(true);
    if (mode === "deal.summary") {
      dealMut.mutate({ dealId: entityId }, { onSuccess: handle, onError: fail });
    } else if (mode === "pricing.review") {
      pricingMut.mutate({ quoteId: entityId }, { onSuccess: handle, onError: fail });
    } else if (mode === "approval.readiness") {
      approvalMut.mutate({ approvalId: entityId }, { onSuccess: handle, onError: fail });
    } else if (mode === "contract.risk") {
      contractMut.mutate({ contractId: entityId }, { onSuccess: handle, onError: fail });
    }
  }

  return (
    <Card data-testid={testIdPrefix}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          {t(MODE_TITLE[mode])}
        </CardTitle>
        <Button
          size="sm"
          variant={envelope ? "outline" : "default"}
          className="h-7 text-xs"
          onClick={trigger}
          disabled={isPending}
          data-testid={`${testIdPrefix}-run`}
        >
          {isPending ? (
            <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />{t("pages.copilot.aiPanelRunning")}</>
          ) : envelope ? (
            t("pages.copilot.aiPanelRerun")
          ) : (
            t("pages.copilot.aiPanelRun")
          )}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!envelope && !errored && !isPending && (
          <p className="text-xs text-muted-foreground italic" data-testid={`${testIdPrefix}-empty`}>
            {t("pages.copilot.aiPanelEmpty")}
          </p>
        )}
        {errored && (
          <p className="text-xs text-destructive" data-testid={`${testIdPrefix}-error`}>
            {t("pages.copilot.aiPanelError")}
          </p>
        )}
        {envelope && (
          <>
            <ResultBody mode={mode} envelope={envelope} />
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
              <AIConfidenceBadge
                level={envelope.confidenceLevel ?? undefined}
                numeric={envelope.confidence ?? undefined}
                reason={envelope.confidenceReason ?? undefined}
                agreementLevel={envelope.secondOpinion?.status === "completed"
                  ? envelope.secondOpinion.agreementLevel ?? undefined
                  : undefined}
                showReason
                testId={`${testIdPrefix}-confidence`}
              />
              {envelope.recommendationId && (
                <AIFeedbackButtons
                  recommendationId={envelope.recommendationId}
                  testIdPrefix={testIdPrefix}
                />
              )}
            </div>
            {envelope.secondOpinion && (
              <SecondOpinionPanel
                envelope={envelope.secondOpinion}
                testIdPrefix={`${testIdPrefix}-second-opinion`}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ResultBody<M extends Mode>({
  mode,
  envelope,
}: {
  mode: M;
  envelope: EnvelopeFor<M>;
}) {
  const { t } = useTranslation();
  if (mode === "deal.summary") {
    const r = (envelope as DealSummaryEnvelope).result;
    return (
      <div className="space-y-2 text-sm">
        <div className="font-medium">{r.headline}</div>
        <div className="text-xs text-muted-foreground">{r.status}</div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {t("pages.copilot.aiPanelHealth")}: {r.health}
          </Badge>
          {r.recommendedAction !== "none" && (
            <Badge variant="secondary" className="text-[10px]">{r.recommendedAction}</Badge>
          )}
        </div>
        {r.keyFacts.length > 0 && (
          <BulletSection title={t("pages.copilot.aiPanelKeyFacts")} items={r.keyFacts} />
        )}
        {r.blockers.length > 0 && (
          <BulletSection title={t("pages.copilot.aiPanelBlockers")} items={r.blockers} />
        )}
        {r.nextSteps.length > 0 && (
          <BulletSection title={t("pages.copilot.aiPanelNextSteps")} items={r.nextSteps} />
        )}
      </div>
    );
  }
  if (mode === "pricing.review") {
    const r = (envelope as PricingReviewEnvelope).result;
    return (
      <div className="space-y-2 text-sm">
        <div>{r.summary}</div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {t("pages.copilot.aiPanelMargin")}: {r.marginAssessment}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {t("pages.copilot.aiPanelDiscount")}: {r.discountAssessment}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">{r.approvalRelevance}</Badge>
        </div>
        {r.policyFlags.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">{t("pages.copilot.aiPanelPolicyFlags")}</div>
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
              {r.policyFlags.map((f, i) => (
                <li key={i}><span className="uppercase mr-1">[{f.severity}]</span>{f.topic}: {f.explanation}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (mode === "approval.readiness") {
    const r = (envelope as ApprovalReadinessEnvelope).result;
    return (
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={r.decisionReady ? "default" : "secondary"} className="text-[10px]">
            {t("pages.copilot.aiPanelDecisionReady")}: {String(r.decisionReady)}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {t("pages.copilot.aiPanelDecisionRecommendation")}: {r.recommendation}
          </Badge>
        </div>
        <div className="text-xs">
          <div className="font-medium">{t("pages.copilot.aiPanelRationale")}:</div>
          <div className="text-muted-foreground">{r.rationale}</div>
        </div>
        {r.missingInformation.length > 0 && (
          <BulletSection title={t("pages.copilot.aiPanelMissingInfo")} items={r.missingInformation} />
        )}
        {r.keyDeviations.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">{t("pages.copilot.aiPanelDeviations")}</div>
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
              {r.keyDeviations.map((d, i) => (
                <li key={i}><span className="uppercase mr-1">[{d.severity}]</span>{d.topic}: {d.note}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }
  if (mode === "contract.risk") {
    const r = (envelope as ContractRiskEnvelope).result;
    return (
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            {t("pages.copilot.aiPanelOverallRisk")}: {r.overallRisk}
          </Badge>
        </div>
        {r.riskSignals && r.riskSignals.length > 0 && (
          <div>
            <div className="text-xs font-medium mb-1">{t("pages.copilot.aiPanelRiskSignals")}</div>
            <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
              {r.riskSignals.map((s, i) => (
                <li key={i}>
                  <span className="uppercase mr-1">[{s.severity}]</span>
                  <span className="font-medium">{s.clause}:</span> {s.finding} — <em>{s.recommendation}</em>
                </li>
              ))}
            </ul>
          </div>
        )}
        {/* Quellenangaben aus der juristischen Wissensbasis (Task #227).
            `relatedSources` ist optional, weil ältere Empfehlungen ohne
            Wissensbasis das Feld nicht enthalten. Klick öffnet den
            Originaltext in einem Side-Sheet. */}
        <RelatedSourcesBlock sources={(r.relatedSources ?? []) as RelatedSourceItem[]} />
      </div>
    );
  }
  return null;
}

function BulletSection({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs font-medium mb-1">{title}</div>
      <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  usePatchAiRecommendation,
  getListAiRecommendationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

export interface AIFeedbackButtonsProps {
  recommendationId: string;
  testIdPrefix?: string;
  onDecision?: (status: "accepted" | "rejected" | "modified") => void;
  allowModify?: boolean;
}

/**
 * One-click Akzeptieren / Geändert / Verworfen für KI-Empfehlungen (Task #69).
 *
 * Jeder Button speichert sofort den Status (PATCH /ai-recommendations/:id)
 * und invalidiert den Pending-Listen-Cache. Optional kann der Nutzer danach
 * eine Begründung / Modifikation nachreichen ("Begründung hinzufügen…"); die
 * Statussetzung passiert aber bereits beim ersten Klick.
 *
 * Verwendet:
 *   - im AI-Recommendations-Card (Copilot-Sidebar)
 *   - direkt unter Copilot-Insights (deal.summary, pricing.review,
 *     approval.readiness, contract.risk)
 *   - im External-Contract-Wizard (overallConfidence)
 */
export function AIFeedbackButtons({
  recommendationId,
  testIdPrefix = "ai-rec",
  onDecision,
  allowModify = true,
}: AIFeedbackButtonsProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const patch = usePatchAiRecommendation();
  const [decided, setDecided] = useState<"accepted" | "rejected" | "modified" | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [modifyText, setModifyText] = useState("");
  const [feedback, setFeedback] = useState("");

  function decide(status: "accepted" | "rejected" | "modified") {
    patch.mutate(
      {
        id: recommendationId,
        data: {
          status,
          feedback: feedback || null,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAiRecommendationsQueryKey() });
          setDecided(status);
          onDecision?.(status);
        },
      },
    );
  }

  function saveDetails() {
    if (!decided) return;
    let modifiedSuggestion: unknown = undefined;
    if (modifyText.trim()) {
      try { modifiedSuggestion = JSON.parse(modifyText); } catch { modifiedSuggestion = modifyText; }
    }
    patch.mutate(
      {
        id: recommendationId,
        data: {
          status: decided,
          modifiedSuggestion: modifiedSuggestion as never,
          feedback: feedback || null,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListAiRecommendationsQueryKey() });
          setShowDetails(false);
        },
      },
    );
  }

  if (decided) {
    return (
      <div className="space-y-2" data-testid={`${testIdPrefix}-feedback-${recommendationId}`}>
        <div
          className="flex items-center gap-2 text-xs text-muted-foreground"
          data-testid={`${testIdPrefix}-decided-${recommendationId}`}
        >
          <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
          <span>{t(`pages.copilot.aiRecDecided.${decided}`)}</span>
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0 text-xs"
            onClick={() => setShowDetails((v) => !v)}
            data-testid={`${testIdPrefix}-details-toggle-${recommendationId}`}
          >
            {showDetails
              ? <><ChevronUp className="h-3 w-3 mr-0.5" />{t("pages.copilot.aiRecHideDetails")}</>
              : <><ChevronDown className="h-3 w-3 mr-0.5" />{t("pages.copilot.aiRecAddDetails")}</>}
          </Button>
        </div>
        {showDetails && (
          <div className="space-y-1">
            {decided === "modified" && (
              <Textarea
                rows={3}
                placeholder={t("pages.copilot.aiRecModifyPlaceholder")}
                value={modifyText}
                onChange={(e) => setModifyText(e.target.value)}
                data-testid={`${testIdPrefix}-modify-text-${recommendationId}`}
              />
            )}
            <Input
              placeholder={t("pages.copilot.aiRecFeedbackPlaceholder")}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              data-testid={`${testIdPrefix}-feedback-input-${recommendationId}`}
            />
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={saveDetails}
              disabled={patch.isPending}
              data-testid={`${testIdPrefix}-details-save-${recommendationId}`}
            >
              {t("pages.copilot.aiRecDetailsSave")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid={`${testIdPrefix}-feedback-${recommendationId}`}>
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="default"
          className="h-7 text-xs"
          onClick={() => decide("accepted")}
          disabled={patch.isPending}
          data-testid={`${testIdPrefix}-accept-${recommendationId}`}
        >
          {t("pages.copilot.aiRecAccept")}
        </Button>
        {allowModify && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => decide("modified")}
            disabled={patch.isPending}
            data-testid={`${testIdPrefix}-modify-${recommendationId}`}
          >
            {t("pages.copilot.aiRecModify")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs"
          onClick={() => decide("rejected")}
          disabled={patch.isPending}
          data-testid={`${testIdPrefix}-reject-${recommendationId}`}
        >
          {t("pages.copilot.aiRecReject")}
        </Button>
      </div>
    </div>
  );
}

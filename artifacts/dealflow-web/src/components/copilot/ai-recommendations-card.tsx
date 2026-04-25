import { useTranslation } from "react-i18next";
import { useListAiRecommendations } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AIConfidenceBadge } from "./ai-confidence-badge";
import { AIFeedbackButtons } from "./ai-feedback-buttons";

/**
 * Persistierte Pending-Empfehlungen aus `ai_recommendations`.
 * Verwendet die Task-#69-Bausteine `AIConfidenceBadge` + `AIFeedbackButtons`,
 * damit dieselbe Optik überall im Produkt erscheint.
 */
export function AiRecommendationsCard() {
  const { t } = useTranslation();
  const { data: recs } = useListAiRecommendations({ status: "pending" });

  return (
    <Card data-testid="ai-recommendations-card">
      <CardHeader className="space-y-1 pb-2">
        <CardTitle className="text-base">{t("pages.copilot.aiRecTitle")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("pages.copilot.aiRecHint")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {(recs ?? []).length === 0 && (
          <p className="text-xs text-muted-foreground">{t("pages.copilot.aiRecEmpty")}</p>
        )}
        {(recs ?? []).slice(0, 8).map((r) => {
          const summary = typeof r.suggestion === "string"
            ? r.suggestion
            : JSON.stringify(r.suggestion).slice(0, 200);
          // Persistierte Zeilen tragen bisher nur den numerischen Score —
          // die Stufe wird beim Rendern aus diesem Wert abgeleitet.
          return (
            <div
              key={r.id}
              className="border-l-2 border-primary/40 pl-3 py-1"
              data-testid={`ai-rec-${r.id}`}
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[10px]">{r.promptKey}</Badge>
                <AIConfidenceBadge numeric={r.confidence} testId={`ai-rec-conf-${r.id}`} />
                {r.entityType && r.entityId && (
                  <span className="text-[10px] text-muted-foreground">
                    {r.entityType}/{r.entityId.slice(0, 8)}
                  </span>
                )}
              </div>
              <p className="text-xs text-foreground/80 line-clamp-3">{summary}</p>
              <div className="mt-2">
                <AIFeedbackButtons recommendationId={r.id} testIdPrefix="ai-rec" />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

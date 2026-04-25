import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useListAiRecommendations,
  usePatchAiRecommendation,
  getListAiRecommendationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type ConfBucket = "low" | "medium" | "high";

function bucket(conf: number): ConfBucket {
  if (conf >= 0.75) return "high";
  if (conf >= 0.5) return "medium";
  return "low";
}

/**
 * Pill mit Konfidenz-Wert. Drei Stufen (low/med/high) plus Prozentwert.
 * Farb-Tokens entsprechen dem dealflow-web Theme (siehe theme.css).
 */
export function ConfidencePill({ confidence }: { confidence: number }) {
  const { t } = useTranslation();
  const b = bucket(confidence);
  const pct = Math.round(confidence * 100);
  const label = b === "high"
    ? t("pages.copilot.aiRecConfHigh")
    : b === "medium"
      ? t("pages.copilot.aiRecConfMed")
      : t("pages.copilot.aiRecConfLow");
  // Farben: rot bei niedrig, gelb mittel, gruen hoch.
  const cls = b === "high"
    ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
    : b === "medium"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200";
  return (
    <span
      data-testid={`conf-pill-${b}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <span aria-hidden>●</span>
      {label} · {pct}%
    </span>
  );
}

export function AiRecommendationsCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: recs } = useListAiRecommendations({ status: "pending" });
  const patch = usePatchAiRecommendation();
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [modify, setModify] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);

  function decide(id: string, status: "accepted" | "rejected" | "modified", modifiedRaw?: string) {
    let modifiedSuggestion: unknown = undefined;
    if (status === "modified") {
      const raw = modifiedRaw ?? "";
      // Versucht JSON zu parsen, fallback auf String. So koennen User
      // strukturierte (z. B. Klausel-Objekt) UND freie Antworten geben.
      try { modifiedSuggestion = JSON.parse(raw); } catch { modifiedSuggestion = raw; }
    }
    patch.mutate({
      id,
      data: {
        status,
        modifiedSuggestion: modifiedSuggestion as never,
        feedback: feedback[id] ?? null,
      },
    }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListAiRecommendationsQueryKey() });
        setEditing(null);
      },
    });
  }

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
          return (
            <div
              key={r.id}
              className="border-l-2 border-primary/40 pl-3 py-1"
              data-testid={`ai-rec-${r.id}`}
            >
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <Badge variant="outline" className="text-[10px]">{r.promptKey}</Badge>
                <ConfidencePill confidence={r.confidence} />
                {r.entityType && r.entityId && (
                  <span className="text-[10px] text-muted-foreground">
                    {r.entityType}/{r.entityId.slice(0, 8)}
                  </span>
                )}
              </div>
              <p className="text-xs text-foreground/80 line-clamp-3">{summary}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs"
                  onClick={() => decide(r.id, "accepted")}
                  disabled={patch.isPending}
                  data-testid={`ai-rec-accept-${r.id}`}
                >
                  {t("pages.copilot.aiRecAccept")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => decide(r.id, "rejected")}
                  disabled={patch.isPending}
                  data-testid={`ai-rec-reject-${r.id}`}
                >
                  {t("pages.copilot.aiRecReject")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setEditing(editing === r.id ? null : r.id)}
                  data-testid={`ai-rec-modify-${r.id}`}
                >
                  {t("pages.copilot.aiRecModify")}
                </Button>
              </div>
              {editing === r.id && (
                <div className="space-y-1 mt-2">
                  <Textarea
                    rows={3}
                    placeholder={t("pages.copilot.aiRecModifyPlaceholder")}
                    value={modify[r.id] ?? ""}
                    onChange={(e) => setModify((m) => ({ ...m, [r.id]: e.target.value }))}
                    data-testid={`ai-rec-modify-text-${r.id}`}
                  />
                  <Input
                    placeholder={t("pages.copilot.aiRecFeedbackPlaceholder")}
                    value={feedback[r.id] ?? ""}
                    onChange={(e) => setFeedback((f) => ({ ...f, [r.id]: e.target.value }))}
                    data-testid={`ai-rec-feedback-${r.id}`}
                  />
                  <Button
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => decide(r.id, "modified", modify[r.id] ?? "")}
                    disabled={patch.isPending || !(modify[r.id] ?? "").trim()}
                    data-testid={`ai-rec-modify-save-${r.id}`}
                  >
                    {t("pages.copilot.aiRecModifySaved")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

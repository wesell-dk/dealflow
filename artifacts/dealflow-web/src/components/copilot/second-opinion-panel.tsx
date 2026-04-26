import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRecordAiSecondOpinionDecision,
  type SecondOpinionEnvelope,
  type SecondOpinionDiff,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

type Decision = "keep_primary" | "adopt_secondary" | "manual";

interface Props {
  envelope: SecondOpinionEnvelope;
  testIdPrefix?: string;
  onDecisionRecorded?: (decision: Decision) => void;
}

/**
 * Cross-Check-Anzeige fuer Task #232.
 *
 * Zeigt das Ergebnis des Zweitmodell-Laufs an: Agreement-Badge, optional
 * eine ausklappbare Liste der Feld-Diffs sowie drei Entscheidungs-Buttons
 * (Primaer behalten / Zweitmeinung uebernehmen / manuell entscheiden).
 *
 * Wenn das Backend keinen Vergleich gefahren hat (status != 'completed'),
 * wird je nach Status entweder gar nichts (disabled) oder ein dezenter
 * Status-Hinweis (failed/unavailable/skipped) gezeigt — der Primaer-Lauf
 * bleibt davon unberuehrt.
 */
export function SecondOpinionPanel({
  envelope,
  testIdPrefix = "second-opinion",
  onDecisionRecorded,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [decision, setDecision] = useState<Decision | null>(
    envelope.decision && envelope.decision !== "pending" ? envelope.decision : null,
  );
  const decisionMut = useRecordAiSecondOpinionDecision();

  if (envelope.status === "disabled") {
    return null;
  }

  if (envelope.status === "skipped" || envelope.status === "unavailable" || envelope.status === "failed") {
    const label =
      envelope.status === "failed" ? t("pages.copilot.secondOpinionStatusFailed")
      : envelope.status === "unavailable" ? t("pages.copilot.secondOpinionStatusUnavailable")
      : t("pages.copilot.secondOpinionStatusSkipped");
    return (
      <div
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground italic"
        data-testid={`${testIdPrefix}-${envelope.status}`}
      >
        <AlertTriangle className="h-3 w-3" />
        {label}
        {envelope.reason ? <span className="not-italic">— {envelope.reason}</span> : null}
      </div>
    );
  }

  // status === "completed" → render full cross-check
  const diffs: SecondOpinionDiff[] = envelope.diffs ?? [];
  const agreementLevel = envelope.agreementLevel ?? "low";
  const score = envelope.agreementScore ?? null;
  const id = envelope.secondOpinionId;

  async function handleDecision(next: Decision) {
    if (!id) return;
    try {
      await decisionMut.mutateAsync({ id, data: { decision: next } });
      setDecision(next);
      onDecisionRecorded?.(next);
      toast({ title: t("pages.copilot.secondOpinionDecisionRecorded") });
      // Invalidate any cached AI feedback / recommendation lists.
      await qc.invalidateQueries({ predicate: (q) => {
        const key = q.queryKey?.[0];
        return typeof key === "string" && (key.includes("ai-recommendations") || key.includes("ai-feedback"));
      }});
    } catch (err) {
      toast({
        title: t("pages.copilot.secondOpinionDecisionFailed"),
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <div
      className="rounded-md border bg-muted/30 p-2 space-y-2"
      data-testid={`${testIdPrefix}-completed`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium">{t("pages.copilot.secondOpinionTitle")}</span>
        <AgreementBadge level={agreementLevel} score={score} testId={`${testIdPrefix}-agreement`} />
        {envelope.model && (
          <span className="text-[10px] text-muted-foreground">
            {t("pages.copilot.secondOpinionModelLine", { model: envelope.model })}
          </span>
        )}
        {decision && (
          <Badge variant="outline" className="text-[10px]" data-testid={`${testIdPrefix}-decision-${decision}`}>
            <CheckCircle2 className="h-3 w-3 mr-1" />
            {t(`pages.copilot.secondOpinionDecided.${decision}`)}
          </Badge>
        )}
      </div>

      {diffs.length === 0 ? (
        <p className="text-[11px] text-muted-foreground" data-testid={`${testIdPrefix}-no-diffs`}>
          {t("pages.copilot.secondOpinionNoDiffs")}
        </p>
      ) : (
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1 text-[11px]"
            onClick={() => setExpanded((v) => !v)}
            data-testid={`${testIdPrefix}-toggle`}
          >
            {expanded
              ? <><ChevronDown className="h-3 w-3 mr-1" />{t("pages.copilot.secondOpinionHideDiff")}</>
              : <><ChevronRight className="h-3 w-3 mr-1" />{t("pages.copilot.secondOpinionShowDiff", { count: diffs.length })}</>}
          </Button>
          {expanded && (
            <ul className="space-y-1.5" data-testid={`${testIdPrefix}-diffs`}>
              {diffs.map((d, i) => <DiffRow key={`${d.path}-${i}`} diff={d} testId={`${testIdPrefix}-diff-${i}`} />)}
            </ul>
          )}
        </>
      )}

      {!decision && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t">
          <span className="text-[10px] text-muted-foreground mr-1">
            {t("pages.copilot.secondOpinionDecisionTitle")}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2"
            onClick={() => handleDecision("keep_primary")}
            disabled={decisionMut.isPending}
            data-testid={`${testIdPrefix}-keep-primary`}
          >
            {decisionMut.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            {t("pages.copilot.secondOpinionKeepPrimary")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2"
            onClick={() => handleDecision("adopt_secondary")}
            disabled={decisionMut.isPending}
            data-testid={`${testIdPrefix}-adopt-secondary`}
          >
            {t("pages.copilot.secondOpinionAdoptSecondary")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] px-2"
            onClick={() => handleDecision("manual")}
            disabled={decisionMut.isPending}
            data-testid={`${testIdPrefix}-manual`}
          >
            {t("pages.copilot.secondOpinionMarkManual")}
          </Button>
        </div>
      )}
    </div>
  );
}

function AgreementBadge({
  level,
  score,
  testId,
}: { level: "low" | "medium" | "high"; score: number | null; testId: string }) {
  const { t } = useTranslation();
  const label = level === "high"
    ? t("pages.copilot.secondOpinionAgreementHigh")
    : level === "medium"
      ? t("pages.copilot.secondOpinionAgreementMedium")
      : t("pages.copilot.secondOpinionAgreementLow");
  const cls = level === "high"
    ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
    : level === "medium"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200";
  return (
    <span
      data-testid={`${testId}-${level}`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      <span aria-hidden>●</span>
      {label}{score !== null ? ` · ${score}%` : ""}
    </span>
  );
}

function DiffRow({ diff, testId }: { diff: SecondOpinionDiff; testId: string }) {
  const { t } = useTranslation();
  const sevCls = diff.severity === "major"
    ? "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200"
    : diff.severity === "minor"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-200";
  return (
    <li className="text-[11px] rounded border bg-background p-1.5 space-y-1" data-testid={testId}>
      <div className="flex items-center gap-1.5">
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium ${sevCls}`}>
          {t(`pages.copilot.secondOpinionSeverity.${diff.severity}`)}
        </span>
        <span className="font-medium">{diff.label}</span>
        <span className="text-[10px] text-muted-foreground font-mono">{diff.path}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {t("pages.copilot.secondOpinionPrimaryLabel")}
          </div>
          <DiffValue value={diff.primary} />
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {t("pages.copilot.secondOpinionSecondaryLabel")}
          </div>
          <DiffValue value={diff.secondary} />
        </div>
      </div>
    </li>
  );
}

function DiffValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">—</span>;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span>{String(value)}</span>;
  }
  return <pre className="text-[10px] whitespace-pre-wrap break-words">{JSON.stringify(value, null, 0)}</pre>;
}

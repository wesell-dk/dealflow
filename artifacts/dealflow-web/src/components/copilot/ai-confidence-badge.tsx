import { useTranslation } from "react-i18next";

/**
 * Strukturierte Konfidenz-Stufen aus Task #69. Wird vom Backend als
 * `confidenceLevel` in jedem Copilot-Envelope geliefert und zusätzlich auf
 * eine 0..1-Zahl gemappt (0.4 / 0.65 / 0.85), damit die persistierte
 * Empfehlungs-Zeile eine kalibrierbare Konfidenz hat.
 */
export type ConfidenceLevel = "low" | "medium" | "high";

export interface AIConfidenceBadgeProps {
  /** Strukturierte Stufe (bevorzugt) — wird direkt angezeigt. */
  level?: ConfidenceLevel | null;
  /**
   * Nur als Fallback genutzt, wenn `level` fehlt (z. B. für ältere
   * persistierte Empfehlungen). Mapping: <0.5 → low, <0.75 → medium, sonst high.
   */
  numeric?: number | null;
  /** Optionaler Begründungs-Satz (Tooltip + sr-only). */
  reason?: string | null;
  /** Wenn true, wird die Begründung sichtbar unter dem Pill angezeigt. */
  showReason?: boolean;
  /** data-testid Suffix; default: confidence-badge. */
  testId?: string;
}

function bucketFromNumeric(conf: number): ConfidenceLevel {
  if (conf >= 0.75) return "high";
  if (conf >= 0.5) return "medium";
  return "low";
}

/**
 * Visuelles Pill mit Konfidenz-Stufe (low/medium/high) plus optionaler
 * Begründung. Farb-Tokens: rot/gelb/grün analog zum Health-Schema im
 * Reports-Cockpit. Die Begründung wandert in title= (Browser-Tooltip) und
 * sr-only (Screenreader); via `showReason` wird sie zusätzlich rendered.
 *
 * Verwendet in:
 *   - Copilot-Panel (deal.summary, pricing.review, approval.readiness, contract.risk)
 *   - Intake-Wizard (external.contract.extract → overallConfidence)
 *   - AI-Recommendations-Card (persistierte Empfehlungen)
 */
export function AIConfidenceBadge({
  level,
  numeric,
  reason,
  showReason = false,
  testId = "confidence-badge",
}: AIConfidenceBadgeProps) {
  const { t } = useTranslation();
  const effective: ConfidenceLevel = level
    ?? (typeof numeric === "number" ? bucketFromNumeric(numeric) : "low");
  const label = effective === "high"
    ? t("pages.copilot.aiRecConfHigh")
    : effective === "medium"
      ? t("pages.copilot.aiRecConfMed")
      : t("pages.copilot.aiRecConfLow");
  const cls = effective === "high"
    ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
    : effective === "medium"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200";
  const pct = typeof numeric === "number" ? Math.round(numeric * 100) : null;
  const tooltip = reason ?? "";

  return (
    <span className="inline-flex flex-col gap-0.5">
      <span
        data-testid={`${testId}-${effective}`}
        title={tooltip || undefined}
        aria-label={tooltip ? `${label} — ${tooltip}` : label}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
      >
        <span aria-hidden>●</span>
        {label}{pct !== null ? ` · ${pct}%` : ""}
      </span>
      {showReason && reason && (
        <span
          className="text-[10px] text-muted-foreground leading-snug"
          data-testid={`${testId}-reason`}
        >
          {reason}
        </span>
      )}
      {!showReason && reason && <span className="sr-only">{reason}</span>}
    </span>
  );
}

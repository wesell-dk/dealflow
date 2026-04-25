import { useTranslation } from "react-i18next";
import { useGetAiRecommendationMetrics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Reports-Cockpit-Tile (Task #69): "KI-Annahmequote pro Prompt".
 *
 * Pro Prompt-Key:
 *   - Annahmequote (accepted+modified / decided)
 *   - Weighted Quality Score (acceptanceRate × Ø-Konfidenz der Entschiedenen)
 *     -> "vertraut die Organisation der KI hoch UND haben wir hohes Modell-
 *     vertrauen, wenn entschieden wird?"
 *   - 7-Tage-Sparkline der Annahmequote (luckenlose Tagesreihe)
 *
 * So sehen Sales- und CO-User auf einen Blick, wo das Modell Vertrauen
 * verdient hat — ohne in das Admin-Cockpit wechseln zu müssen.
 */
export function AiAcceptanceTile() {
  const { t } = useTranslation();
  const { data: metrics, isLoading } = useGetAiRecommendationMetrics();

  const rows = (metrics ?? [])
    .filter((m) => m.acceptanceRate !== null)
    .sort((a, b) => (b.weightedQualityScore ?? 0) - (a.weightedQualityScore ?? 0));

  return (
    <Card data-testid="reports-ai-acceptance-tile">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t("pages.reports.aiAcceptanceTitle")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("pages.reports.aiAcceptanceHint")}
        </p>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-xs text-muted-foreground">…</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("pages.reports.aiAcceptanceEmpty")}
          </p>
        )}
        {rows.length > 0 && (
          <ul className="space-y-3">
            {rows.map((m) => {
              const acc = Math.round((m.acceptanceRate ?? 0) * 100);
              const wqs = m.weightedQualityScore;
              const wqsPct = wqs !== null && wqs !== undefined ? Math.round(wqs * 100) : null;
              return (
                <li
                  key={m.promptKey}
                  className="space-y-1.5"
                  data-testid={`reports-ai-acc-${m.promptKey}`}
                >
                  <div className="flex items-center justify-between text-xs gap-2">
                    <span className="font-mono truncate" title={m.promptKey}>
                      {m.promptKey}
                    </span>
                    <span className="tabular-nums text-muted-foreground whitespace-nowrap">
                      {acc}% · n={m.count}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${acc}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] gap-2">
                    <span
                      className="text-muted-foreground"
                      data-testid={`reports-ai-wqs-${m.promptKey}`}
                      title={t("pages.reports.aiAcceptanceWqsHint")}
                    >
                      {t("pages.reports.aiAcceptanceWqs")}: {wqsPct !== null ? `${wqsPct}%` : "—"}
                    </span>
                    <TrendSparkline
                      points={(m.trend ?? []).map((p) => ({
                        date: p.date,
                        value: p.acceptanceRate,
                        decided: p.decided,
                      }))}
                      testId={`reports-ai-trend-${m.promptKey}`}
                      label={t("pages.reports.aiAcceptanceTrendLabel")}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TrendSparkline({
  points,
  testId,
  label,
}: {
  points: { date: string; value: number | null; decided: number }[];
  testId: string;
  label: string;
}) {
  if (points.length === 0) {
    return <span className="text-muted-foreground" data-testid={`${testId}-empty`}>—</span>;
  }
  const w = 80;
  const h = 18;
  const stepX = points.length > 1 ? w / (points.length - 1) : w;
  // Tage ohne entschiedene Empfehlung werden als Luecke gerendert (Polyline
  // wird unterbrochen). Damit erkennen Reviewer eine "stille" Phase, statt
  // implizit 0% zu vermuten.
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    const x = stepX * i;
    if (p.value === null || p.value === undefined) {
      if (current) {
        segments.push(current);
        current = "";
      }
      return;
    }
    const y = h - p.value * h;
    current += `${current === "" ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
  });
  if (current) segments.push(current);
  const sumDecided = points.reduce((acc, p) => acc + p.decided, 0);
  const tooltip = points
    .map((p) => {
      const pct = p.value !== null && p.value !== undefined
        ? `${Math.round(p.value * 100)}%`
        : "—";
      return `${p.date}: ${pct} (n=${p.decided})`;
    })
    .join("\n");
  return (
    <span
      className="inline-flex items-center gap-1"
      data-testid={testId}
      title={tooltip}
      aria-label={`${label}: ${sumDecided} ${label}`}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-primary">
        <line x1={0} y1={h - 0.5} x2={w} y2={h - 0.5} stroke="currentColor" strokeOpacity={0.15} />
        {segments.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1.4} />
        ))}
        {points.map((p, i) =>
          p.value !== null && p.value !== undefined ? (
            <circle
              key={i}
              cx={stepX * i}
              cy={h - p.value * h}
              r={1.4}
              fill="currentColor"
            />
          ) : null,
        )}
      </svg>
      <span className="text-muted-foreground tabular-nums">{sumDecided}</span>
    </span>
  );
}

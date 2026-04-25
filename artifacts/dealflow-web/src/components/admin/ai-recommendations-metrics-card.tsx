import { useTranslation } from "react-i18next";
import { useGetAiRecommendationMetrics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Admin-Karte "KI-Vertrauensgenauigkeit".
 * Pro promptKey:
 *  - count, acceptance rate (accepted+modified / decided),
 *    durchschnittliche Konfidenz
 *  - Konfidenz-Kalibrierung als 4 Mini-Bars (0-25/25-50/50-75/75-100 %)
 *    mit jeweiliger acceptance-rate. Gut kalibriert = Bars steigen mit
 *    Konfidenz an.
 */
export function AiRecommendationsMetricsCard() {
  const { t } = useTranslation();
  const { data: metrics, isLoading } = useGetAiRecommendationMetrics();

  return (
    <Card data-testid="ai-rec-metrics-card">
      <CardHeader className="pb-2">
        <CardTitle>{t("pages.admin.aiRecMetricsTitle")}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("pages.admin.aiRecMetricsHint")}</p>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-xs text-muted-foreground">…</p>}
        {!isLoading && (metrics?.length ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground">{t("pages.admin.aiRecMetricsEmpty")}</p>
        )}
        {(metrics ?? []).length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-3 font-medium">{t("pages.admin.aiRecMetricsCol.prompt")}</th>
                  <th className="py-2 pr-3 font-medium text-right">{t("pages.admin.aiRecMetricsCol.count")}</th>
                  <th className="py-2 pr-3 font-medium text-right">{t("pages.admin.aiRecMetricsCol.accept")}</th>
                  <th className="py-2 pr-3 font-medium text-right">{t("pages.admin.aiRecMetricsCol.avgConf")}</th>
                  <th className="py-2 pr-3 font-medium">{t("pages.admin.aiRecMetricsCol.calibration")}</th>
                </tr>
              </thead>
              <tbody>
                {metrics?.map((m) => (
                  <tr key={m.promptKey} className="border-b last:border-0" data-testid={`ai-rec-metric-${m.promptKey}`}>
                    <td className="py-2 pr-3 font-mono">{m.promptKey}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{m.count}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {m.acceptanceRate === null ? "—" : `${Math.round(m.acceptanceRate * 100)}%`}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {`${Math.round(m.averageConfidence * 100)}%`}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-end gap-1 h-10">
                        {m.calibration.map((b) => {
                          const h = b.acceptanceRate === null
                            ? 0
                            : Math.max(2, Math.round(b.acceptanceRate * 36));
                          const tip = b.total === 0
                            ? `${b.range}%: n=0`
                            : `${b.range}%: ${Math.round((b.acceptanceRate ?? 0) * 100)}% acc · n=${b.total}`;
                          return (
                            <div
                              key={b.range}
                              className="flex flex-col items-center gap-0.5 w-7"
                              title={tip}
                              data-testid={`ai-rec-cal-${m.promptKey}-${b.range}`}
                            >
                              <div
                                className="w-full bg-primary/70 rounded-sm"
                                style={{ height: `${h}px` }}
                              />
                              <span className="text-[8px] text-muted-foreground tabular-nums">
                                {b.range}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

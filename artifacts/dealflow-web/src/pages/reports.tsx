import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  useGetPerformanceReport,
  useGetForecast,
  useGetDashboardSummary,
  useGetRenewalSummary,
  useGetRenewalTrend,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResponsiveContainer, ComposedChart, AreaChart, Area, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { AiAcceptanceTile } from "@/components/reports/ai-acceptance-tile";

export default function Reports() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { data: performance, isLoading: isLoadingPerf } = useGetPerformanceReport();
  const { data: forecast, isLoading: isLoadingForecast } = useGetForecast();
  const { data: dashboard } = useGetDashboardSummary();
  const { data: renewalSummary } = useGetRenewalSummary();
  const [period, setPeriod] = useState<string>("12");
  const [ownerId, setOwnerId] = useState<string>("__all__");
  // Trend-Modus: total = bisheriger gestapelter Risiko/Safe-Bar.
  // brand/owner = ein gestapelter Bar pro Brand bzw. Owner.
  // Brand-Aufschluesselung wird IMMER mitgezogen, weil der Tooltip in jedem
  // Modus die Top-3-Brands pro Monat zeigen soll (Anforderung Task #121).
  const [trendMode, setTrendMode] = useState<"total" | "brand" | "owner">("total");
  const trendGroupBy = trendMode === "owner" ? "brand,owner" : "brand";
  const { data: renewalTrend } = useGetRenewalTrend({
    horizonMonths: 12,
    groupBy: trendGroupBy,
  });

  const renewalTrendCurrencyFmt = useMemo(
    () => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 0 }),
    [],
  );

  const monthLabel = (ym: string): string => {
    const [y, m] = ym.split("-");
    const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  };

  // Default-Datenform für den "Gesamt"-Modus.
  const renewalTrendData = useMemo(() => {
    if (!renewalTrend) return [];
    return renewalTrend.map((b) => ({
      ym: b.ym,
      monthLabel: monthLabel(b.ym),
      safeValue: Math.max(0, (b.value ?? 0) - (b.atRiskValue ?? 0)),
      atRiskValue: b.atRiskValue ?? 0,
      count: b.count,
      atRiskCount: b.atRiskCount,
      total: b.value ?? 0,
      // Top-3-Brand-Liste fuer den Tooltip — auch im "Gesamt"-Modus.
      topBrands: (b.byBrand ?? []).slice(0, 3).map((x) => ({ name: x.name, value: x.value })),
    }));
  }, [renewalTrend]);

  // Top-N Brands/Owner ueber alle Buckets ermitteln, damit der Stack
  // in jedem Monat in derselben Reihenfolge gezeichnet wird. Alles, was
  // unter Top-N faellt, wird in einer "Weitere"-Serie aggregiert.
  const TOP_SERIES = 6;
  const groupedSeries = useMemo(() => {
    if (!renewalTrend || trendMode === "total") return null;
    const totals = new Map<string, { id: string | null; name: string; total: number }>();
    for (const b of renewalTrend) {
      const breakdown = (trendMode === "brand" ? b.byBrand : b.byOwner) ?? [];
      for (const e of breakdown) {
        const id = (trendMode === "brand" ? e.brandId : e.ownerId) ?? null;
        const key = id ?? "__none__";
        const cur = totals.get(key) ?? { id: id ?? null, name: e.name, total: 0 };
        cur.total += e.value;
        cur.name = e.name;
        totals.set(key, cur);
      }
    }
    const ranked = Array.from(totals.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const top = ranked.slice(0, TOP_SERIES);
    const otherKeys = new Set(ranked.slice(TOP_SERIES).map((r) => r.key));
    const series = [
      ...top.map((t, i) => ({ key: t.key, name: t.name, color: `hsl(var(--chart-${(i % 5) + 1}))` })),
    ];
    if (otherKeys.size) series.push({ key: "__other__", name: "Weitere", color: "hsl(var(--muted-foreground))" });
    return { series, otherKeys };
  }, [renewalTrend, trendMode]);

  const groupedTrendData = useMemo(() => {
    if (!renewalTrend || !groupedSeries || trendMode === "total") return [];
    const { series, otherKeys } = groupedSeries;
    return renewalTrend.map((b) => {
      const breakdown = (trendMode === "brand" ? b.byBrand : b.byOwner) ?? [];
      const row: Record<string, unknown> = {
        ym: b.ym,
        monthLabel: monthLabel(b.ym),
        count: b.count,
        atRiskCount: b.atRiskCount,
        total: b.value ?? 0,
        // Top-3-Brand-Liste fuer den Tooltip (immer Brands, auch wenn
        // gerade Owner-Modus aktiv ist — die Frage "welche Marke treibt
        // den Monat?" ist laut Anforderung Brand-fix).
        topBrands: (b.byBrand ?? []).slice(0, 3).map((x) => ({ name: x.name, value: x.value })),
      };
      for (const s of series) row[s.key] = 0;
      for (const e of breakdown) {
        const id = (trendMode === "brand" ? e.brandId : e.ownerId) ?? null;
        const key = id ?? "__none__";
        if (otherKeys.has(key)) {
          row.__other__ = (row.__other__ as number ?? 0) + e.value;
        } else if (key in row) {
          row[key] = (row[key] as number ?? 0) + e.value;
        }
      }
      return row;
    });
  }, [renewalTrend, trendMode, groupedSeries]);

  const ownerOptions = useMemo(() => performance?.byOwner ?? [], [performance]);
  const monthly = useMemo(() => {
    if (!performance) return [];
    const n = period === "all" ? performance.monthly.length : parseInt(period, 10);
    return performance.monthly.slice(-n);
  }, [performance, period]);
  const filteredOwners = useMemo(() => {
    if (!performance) return [];
    if (ownerId === "__all__") return performance.byOwner;
    return performance.byOwner.filter((o) => o.ownerId === ownerId);
  }, [performance, ownerId]);

  if (isLoadingPerf || isLoadingForecast) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!performance || !forecast) {
    return <div className="p-8">{t("common.noData")}</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("pages.reports.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("pages.reports.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("common.filter")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger>
              <SelectValue placeholder={t("pages.reports.filterPeriod")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 months</SelectItem>
              <SelectItem value="6">6 months</SelectItem>
              <SelectItem value="12">12 months</SelectItem>
              <SelectItem value="all">{t("common.all")}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={ownerId} onValueChange={setOwnerId}>
            <SelectTrigger>
              <SelectValue placeholder={t("pages.reports.filterOwner")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("common.all")}</SelectItem>
              {ownerOptions.map((o) => (
                <SelectItem key={o.ownerId} value={o.ownerId}>{o.ownerName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-primary">{performance.winRatePct}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Discount</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{performance.avgDiscountPct}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Cycle Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{performance.avgCycleDays} days</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Margin Discipline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{performance.marginDisciplinePct}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Renewal-Pipeline (#66) */}
      <div className="grid gap-4 md:grid-cols-4" data-testid="kpi-row-renewals">
        <Card data-testid="kpi-renewal-pipeline">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Renewal-Pipeline (€)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {renewalSummary
                ? new Intl.NumberFormat(undefined, {
                    style: "currency",
                    currency: "EUR",
                    maximumFractionDigits: 0,
                  }).format(renewalSummary.pipelineValue ?? 0)
                : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {renewalSummary?.totalOpen ?? 0} offene Renewals
            </div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-renewal-this-month">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Renewals diesen Monat</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{renewalSummary?.thisMonth.count ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Notice-Frist im aktuellen Monat</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-renewal-next90">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Renewals nächste 90 Tage</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{renewalSummary?.next90.count ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Aktion erforderlich</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-renewal-at-risk">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Renewals mit Risiko</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(renewalSummary?.atRisk.count ?? 0) > 0 ? "text-amber-600" : ""}`}>
              {renewalSummary?.atRisk.count ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Score ≥ 70</div>
          </CardContent>
        </Card>
      </div>

      {/* Renewal-Pipeline Trend (#99 / #121) */}
      <Card data-testid="card-renewal-trend">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Renewal-Pipeline (12 Monate)</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Volumen pro Monat über die nächsten 12 Monate. Im Modus „Gesamt" zeigt der gestapelte rote Anteil Renewals mit Risiko ≥ 70; in den Modi „nach Brand" / „nach Owner" wird das Volumen je Monat nach den Top-Brands bzw. ‑Ownern aufgeschlüsselt. Klick auf einen Monat öffnet die Renewals-Liste mit passendem Filter.
              </p>
            </div>
            <Select value={trendMode} onValueChange={(v) => setTrendMode(v as "total" | "brand" | "owner")}>
              <SelectTrigger className="w-[180px]" data-testid="select-trend-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="total">Gesamt</SelectItem>
                <SelectItem value="brand">Nach Brand</SelectItem>
                <SelectItem value="owner">Nach Owner</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="h-80">
          {renewalTrendData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t("common.noData")}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={trendMode === "total" ? renewalTrendData : groupedTrendData}
                onClick={(state: unknown) => {
                  const s = state as { activePayload?: Array<{ payload?: { ym?: string } }> } | null;
                  const ym = s?.activePayload?.[0]?.payload?.ym;
                  if (ym) navigate(`/renewals?ym=${ym}`);
                }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="monthLabel" axisLine={false} tickLine={false} fontSize={12} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  fontSize={12}
                  tickFormatter={(v: number) =>
                    v >= 1000
                      ? `${(v / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })}k`
                      : String(v)
                  }
                />
                <Tooltip
                  formatter={(value: number, name: string) => [renewalTrendCurrencyFmt.format(value), name]}
                  labelFormatter={(label: string, items) => {
                    const p = items?.[0]?.payload as
                      | { count?: number; atRiskCount?: number; total?: number; topBrands?: Array<{ name: string; value: number }> }
                      | undefined;
                    if (!p) return label;
                    const head = `${label} · ${p.count ?? 0} Renewals · ${renewalTrendCurrencyFmt.format(p.total ?? 0)}`;
                    if (!p.topBrands || p.topBrands.length === 0) return head;
                    const tops = p.topBrands.map((b) => `${b.name}: ${renewalTrendCurrencyFmt.format(b.value)}`).join(" · ");
                    return `${head}\nTop-Brands: ${tops}`;
                  }}
                />
                <Legend />
                {trendMode === "total" ? (
                  <>
                    <Bar
                      dataKey="safeValue"
                      stackId="value"
                      name="Volumen (Risiko < 70)"
                      fill="hsl(var(--chart-1))"
                      cursor="pointer"
                    />
                    <Bar
                      dataKey="atRiskValue"
                      stackId="value"
                      name="Volumen (Risiko ≥ 70)"
                      fill="hsl(var(--chart-2))"
                      cursor="pointer"
                    />
                  </>
                ) : (
                  groupedSeries?.series.map((s) => (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      stackId="value"
                      name={s.name}
                      fill={s.color}
                      cursor="pointer"
                    />
                  ))
                )}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Vertragswesen MVP — KPI-Kacheln */}
      <div className="grid gap-4 md:grid-cols-4" data-testid="kpi-row-contracts">
        <Card data-testid="kpi-time-to-signature">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Time-to-Signature</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {dashboard?.avgTimeToSignatureDays != null ? `${dashboard.avgTimeToSignatureDays} Tage` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">ø der letzten 90 Tage</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-open-deviations">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Offene Klausel-Abweichungen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(dashboard?.openDeviationsCount ?? 0) > 0 ? "text-amber-600" : ""}`}>
              {dashboard?.openDeviationsCount ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Im sichtbaren Scope</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-overdue-obligations">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Überfällige Pflichten</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(dashboard?.overdueObligationsCount ?? 0) > 0 ? "text-red-600" : ""}`}>
              {dashboard?.overdueObligationsCount ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">aus signierten Verträgen</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-approval-duration">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">ø Approval-Dauer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {dashboard?.avgApprovalDurationHours != null ? `${dashboard.avgApprovalDurationHours} h` : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">vom Antrag bis Entscheidung</div>
          </CardContent>
        </Card>
      </div>

      {/* Task #69: KI-Annahmequote pro Prompt */}
      <div className="grid gap-4">
        <AiAcceptanceTile />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Monthly Performance</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={12} />
                <YAxis yAxisId="left" axisLine={false} tickLine={false} fontSize={12} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} fontSize={12} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="won" stackId="a" fill="hsl(var(--chart-1))" name="Won" />
                <Bar yAxisId="left" dataKey="lost" stackId="a" fill="hsl(var(--chart-2))" name="Lost" />
                <Line yAxisId="right" type="monotone" dataKey="value" stroke="hsl(var(--chart-3))" strokeWidth={2} name="Value" />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Forecast ({forecast.currency})</CardTitle>
          </CardHeader>
          <CardContent className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecast.months}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} fontSize={12} />
                <YAxis axisLine={false} tickLine={false} fontSize={12} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="pipeline" stackId="1" stroke="hsl(var(--chart-5))" fill="hsl(var(--chart-5))" opacity={0.3} name="Pipeline" />
                <Area type="monotone" dataKey="bestCase" stackId="2" stroke="hsl(var(--chart-4))" fill="hsl(var(--chart-4))" opacity={0.6} name="Best Case" />
                <Area type="monotone" dataKey="committed" stackId="3" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" opacity={0.8} name="Committed" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Performance by Owner</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead>Deals</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-[300px]">Win Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOwners.map((owner) => (
                <TableRow key={owner.ownerId}>
                  <TableCell className="font-medium">{owner.ownerName}</TableCell>
                  <TableCell>{owner.deals}</TableCell>
                  <TableCell>{owner.value.toLocaleString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="w-12 text-right">{owner.winRatePct}%</span>
                      <div className="h-2 flex-1 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-primary transition-all" 
                          style={{ width: `${owner.winRatePct}%` }} 
                        />
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

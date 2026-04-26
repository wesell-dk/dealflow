import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  useGetPerformanceReport,
  useGetForecast,
  useGetDashboardSummary,
  useGetRenewalSummary,
  useGetRenewalTrend,
  useGetLeadsReport,
  useListRenewals,
  useNotifyRenewalOwner,
  useUpdateRenewal,
  useBulkRenewalAction,
  getListRenewalsQueryKey,
  getGetRenewalSummaryQueryKey,
  getGetRenewalTrendQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Bell, CalendarClock, CheckCircle2, Clock, ExternalLink, UserPlus, ArrowRight } from "lucide-react";
import { ResponsiveContainer, ComposedChart, AreaChart, Area, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { AiAcceptanceTile } from "@/components/reports/ai-acceptance-tile";
import { TONE_TEXT_CLASSES } from "@/components/patterns/status-badges";

export default function Reports() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
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

  // Trend-Chart Drill-down (Task #120): ausgewählter Monat öffnet ein Sheet mit
  // Renewals dieses Monats. Renewals werden serverseitig per dueYm-Filter
  // geladen, damit die Liste exakt zum Chart-Balken passt.
  const [trendMonth, setTrendMonth] = useState<{ ym: string; label: string } | null>(null);
  const [bulkSnoozeDate, setBulkSnoozeDate] = useState<string>("");
  const trendDetailsParams = { status: "open" as const, dueYm: trendMonth?.ym ?? "" };
  const trendDetails = useListRenewals(trendDetailsParams, {
    query: {
      enabled: !!trendMonth,
      queryKey: getListRenewalsQueryKey(trendDetailsParams),
    },
  });
  const notifyMut = useNotifyRenewalOwner();
  const updateMut = useUpdateRenewal();
  const bulkMut = useBulkRenewalAction();

  function refetchRenewals() {
    qc.invalidateQueries({ queryKey: getListRenewalsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetRenewalSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getGetRenewalTrendQueryKey() });
  }

  async function notifyOne(id: string) {
    try {
      const res = await notifyMut.mutateAsync({ id });
      toast({ title: t("pages.reports.trendActions.toast.notified", { name: res.ownerName }) });
    } catch (err: unknown) {
      const status = (err as { status?: number; response?: { status?: number } } | null)?.status
        ?? (err as { response?: { status?: number } } | null)?.response?.status;
      if (status === 422) {
        toast({
          title: t("pages.reports.trendActions.toast.notifyFailed"),
          description: t("pages.reports.trendActions.toast.noOwner"),
          variant: "destructive",
        });
      } else {
        toast({
          title: t("pages.reports.trendActions.toast.notifyFailed"),
          variant: "destructive",
        });
      }
    }
  }

  async function snoozeOne(id: string, until: string) {
    if (!until) {
      toast({
        title: t("pages.reports.trendActions.toast.snoozeMissingDate"),
        variant: "destructive",
      });
      return;
    }
    await updateMut.mutateAsync({ id, data: { status: "snoozed", snoozedUntil: until } });
    toast({ title: t("pages.reports.trendActions.toast.snoozed") });
    refetchRenewals();
  }

  async function markHandled(id: string) {
    await updateMut.mutateAsync({ id, data: { status: "cancelled" } });
    toast({ title: t("pages.reports.trendActions.toast.handled") });
    refetchRenewals();
  }

  async function bulkNotify(ids: string[]) {
    if (ids.length === 0) return;
    const res = await bulkMut.mutateAsync({ data: { ids, action: "notify" } });
    toast({
      title: t("pages.reports.trendActions.toast.bulkNotified", {
        count: res.notified.length,
        skipped: res.skipped,
      }),
    });
  }

  async function bulkSnooze(ids: string[]) {
    if (ids.length === 0) return;
    if (!bulkSnoozeDate) {
      toast({
        title: t("pages.reports.trendActions.toast.snoozeMissingDate"),
        variant: "destructive",
      });
      return;
    }
    const res = await bulkMut.mutateAsync({
      data: { ids, action: "snooze", snoozedUntil: bulkSnoozeDate },
    });
    toast({
      title: t("pages.reports.trendActions.toast.bulkSnoozed", {
        count: res.updated,
        skipped: res.skipped,
      }),
    });
    refetchRenewals();
    setBulkSnoozeDate("");
  }

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
    if (otherKeys.size) series.push({ key: "__other__", name: "Other", color: "hsl(var(--muted-foreground))" });
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

  // Lead-Konvertierungen (Task #199): Kennzahlen aus der Lead-Inbox
  // (Volumen, Conversion-Rate, Top-Quellen). Der `period`-Selector oben
  // wird wiederverwendet ("3"/"6"/"12" Monate, "all" = ohne Filter).
  const leadsPeriodMonths = period === "all" ? undefined : parseInt(period, 10);
  const { data: leadsReport } = useGetLeadsReport(
    leadsPeriodMonths !== undefined ? { periodMonths: leadsPeriodMonths } : undefined,
  );
  const KNOWN_SOURCE_KEYS = ["website", "referral", "inbound_email", "event", "outbound", "partner", "other"] as const;
  function sourceLabel(source: string): string {
    if ((KNOWN_SOURCE_KEYS as readonly string[]).includes(source)) {
      return t(`pages.leads.sources.${source}`);
    }
    return source || t("common.unknown", { defaultValue: "—" });
  }
  function gotoLeads(params: Record<string, string>) {
    const sp = new URLSearchParams(params);
    const qs = sp.toString();
    navigate(qs ? `/leads?${qs}` : "/leads");
  }

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
            <CardTitle className="text-sm font-medium">Renewals this month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{renewalSummary?.thisMonth.count ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Notice deadline in current month</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-renewal-next90">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Renewals next 90 days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{renewalSummary?.next90.count ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Action required</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-renewal-at-risk">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Renewals with risk</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(renewalSummary?.atRisk.count ?? 0) > 0 ? TONE_TEXT_CLASSES.warning : ""}`}>
              {renewalSummary?.atRisk.count ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Score ≥ 70</div>
          </CardContent>
        </Card>
      </div>

      {/* Renewal-Pipeline Trend (#99 + #120 + #121) */}
      <Card data-testid="card-renewal-trend">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>Renewal pipeline (12 months)</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Volume per month over the next 12 months. In "Total" mode the stacked red portion shows renewals with risk ≥ 70; in "by Brand" / "by Owner" modes the volume per month is broken down by top brands or owners. Click a month to open the action list — snooze, mark as done, or notify the owner directly.
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
                  const s = state as {
                    activePayload?: Array<{ payload?: { ym?: string; monthLabel?: string } }>;
                  } | null;
                  const payload = s?.activePayload?.[0]?.payload;
                  if (payload?.ym) {
                    setTrendMonth({
                      ym: payload.ym,
                      label: payload.monthLabel ?? payload.ym,
                    });
                  }
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
                      name="Volume (Risk < 70)"
                      fill="hsl(var(--chart-1))"
                      cursor="pointer"
                    />
                    <Bar
                      dataKey="atRiskValue"
                      stackId="value"
                      name="Volume (Risk ≥ 70)"
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

      {/* Leads & Conversion (Task #199) */}
      <Card data-testid="card-leads-conversion">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-muted-foreground" />
                {t("pages.reports.leads.title")}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {t("pages.reports.leads.subtitle")}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => gotoLeads({})}
              data-testid="btn-leads-open-inbox"
            >
              {t("pages.reports.leads.openInbox")}
              <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-4" data-testid="kpi-row-leads">
            <Card data-testid="kpi-leads-new">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("pages.reports.leads.kpi.newLeads")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/*
                 * "Neue Leads" = im Zeitraum erstellt (totalLeads), NICHT
                 * der aktuelle Status-Bestand. Drilldown geht deshalb zur
                 * Lead-Inbox ohne Status-Filter — sortiert nach createdAt
                 * desc landen die jüngsten Leads ohnehin oben, und alle
                 * im Zeitraum erstellten Leads (auch bereits konvertierte)
                 * sind dort sichtbar.
                 */}
                <button
                  type="button"
                  onClick={() => gotoLeads({})}
                  className="text-2xl font-bold text-left hover:underline"
                  data-testid="kpi-leads-new-value"
                >
                  {leadsReport?.totalLeads ?? 0}
                </button>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("pages.reports.leads.kpi.newLeadsHint")}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="kpi-leads-conversion-rate">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("pages.reports.leads.kpi.conversionRate")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary" data-testid="kpi-leads-conversion-rate-value">
                  {leadsReport ? `${leadsReport.qualifiedConversionRatePct}%` : "—"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("pages.reports.leads.kpi.conversionRateHint")}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="kpi-leads-converted">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("pages.reports.leads.kpi.totalConverted")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <button
                  type="button"
                  onClick={() => gotoLeads({ status: "converted" })}
                  className="text-2xl font-bold text-left hover:underline"
                  data-testid="kpi-leads-converted-value"
                >
                  {leadsReport?.convertedLeads ?? 0}
                </button>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("pages.reports.leads.kpi.totalConvertedHint", {
                    count: leadsReport?.convertedLeads ?? 0,
                    total: leadsReport?.totalLeads ?? 0,
                  })}
                </div>
              </CardContent>
            </Card>
            <Card data-testid="kpi-leads-avg-ttc">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("pages.reports.leads.kpi.avgTimeToConvert")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {leadsReport?.avgTimeToConvertDays != null
                    ? t("pages.reports.leads.kpi.avgTimeToConvertValue", { days: leadsReport.avgTimeToConvertDays })
                    : t("pages.reports.leads.kpi.avgTimeToConvertEmpty")}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("pages.reports.leads.kpi.avgTimeToConvertHint")}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="rounded-md border bg-card" data-testid="leads-top-sources">
            <div className="px-4 py-3 border-b">
              <div className="text-sm font-medium">{t("pages.reports.leads.topSources.title")}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t("pages.reports.leads.topSources.hint")}
              </div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.reports.leads.topSources.col.source")}</TableHead>
                  <TableHead className="text-right">{t("pages.reports.leads.topSources.col.count")}</TableHead>
                  <TableHead className="text-right">{t("pages.reports.leads.topSources.col.converted")}</TableHead>
                  <TableHead className="text-right">{t("pages.reports.leads.topSources.col.rate")}</TableHead>
                  <TableHead className="w-[1%]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!leadsReport || leadsReport.topSources.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                      {t("pages.reports.leads.topSources.empty")}
                    </TableCell>
                  </TableRow>
                )}
                {leadsReport?.topSources.map((s) => (
                  <TableRow key={s.source} data-testid={`row-leads-source-${s.source}`}>
                    <TableCell className="font-medium">{sourceLabel(s.source)}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.converted}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.conversionRatePct}%</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => gotoLeads({ source: s.source })}
                        data-testid={`btn-drill-source-${s.source}`}
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Contractswesen MVP — KPI-Kacheln */}
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
            <CardTitle className="text-sm font-medium">Offene Clause-Abweichungen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(dashboard?.openDeviationsCount ?? 0) > 0 ? TONE_TEXT_CLASSES.warning : ""}`}>
              {dashboard?.openDeviationsCount ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">In visible scope</div>
          </CardContent>
        </Card>
        <Card data-testid="kpi-overdue-obligations">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Overdue obligations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${(dashboard?.overdueObligationsCount ?? 0) > 0 ? TONE_TEXT_CLASSES.danger : ""}`}>
              {dashboard?.overdueObligationsCount ?? 0}
            </div>
            <div className="text-xs text-muted-foreground mt-1">from signed contracts</div>
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

      <Sheet
        open={!!trendMonth}
        onOpenChange={(open) => {
          if (!open) {
            setTrendMonth(null);
            setBulkSnoozeDate("");
          }
        }}
      >
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" data-testid="sheet-trend-actions">
          <SheetHeader>
            <SheetTitle>
              {t("pages.reports.trendActions.title", { month: trendMonth?.label ?? "" })}
            </SheetTitle>
            <SheetDescription>
              {t("pages.reports.trendActions.subtitle", {
                count: trendDetails.data?.length ?? 0,
                value: ((trendDetails.data ?? []).reduce(
                  (sum, r) => sum + (r.valueAmount ?? 0),
                  0,
                )).toLocaleString(undefined, {
                  style: "currency",
                  currency: trendDetails.data?.[0]?.currency ?? "EUR",
                  maximumFractionDigits: 0,
                }),
              })}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="link-open-renewals"
              onClick={() => {
                if (trendMonth) navigate(`/renewals?ym=${trendMonth.ym}`);
              }}
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              {t("pages.reports.trendActions.openInRenewals")}
            </Button>
          </div>

          {(trendDetails.data?.length ?? 0) > 0 && (
            <div className="mt-4 rounded-md border p-3">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                {t("pages.reports.trendActions.bulk.header")}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="button-bulk-notify"
                  disabled={bulkMut.isPending}
                  onClick={() => bulkNotify((trendDetails.data ?? []).map((r) => r.id))}
                >
                  <Bell className="mr-2 h-4 w-4" />
                  {t("pages.reports.trendActions.bulk.notifyAll")}
                </Button>
                <Input
                  type="date"
                  value={bulkSnoozeDate}
                  onChange={(e) => setBulkSnoozeDate(e.target.value)}
                  className="h-9 w-44"
                  data-testid="input-bulk-snooze-date"
                  aria-label={t("pages.reports.trendActions.bulk.snoozeAllPlaceholder")}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="button-bulk-snooze"
                  disabled={bulkMut.isPending || !bulkSnoozeDate}
                  onClick={() => bulkSnooze((trendDetails.data ?? []).map((r) => r.id))}
                >
                  <CalendarClock className="mr-2 h-4 w-4" />
                  {t("pages.reports.trendActions.bulk.snoozeAllApply")}
                </Button>
              </div>
            </div>
          )}

          <div className="mt-4 space-y-2">
            {trendDetails.isLoading ? (
              <div className="text-sm text-muted-foreground">
                {t("pages.reports.trendActions.loading")}
              </div>
            ) : (trendDetails.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground">
                {t("pages.reports.trendActions.empty")}
              </div>
            ) : (
              (trendDetails.data ?? []).map((r) => (
                <RenewalActionRow
                  key={r.id}
                  r={r}
                  onNotify={() => notifyOne(r.id)}
                  onMarkHandled={() => markHandled(r.id)}
                  onSnooze={(date) => snoozeOne(r.id, date)}
                />
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function RenewalActionRow({
  r,
  onNotify,
  onMarkHandled,
  onSnooze,
}: {
  r: {
    id: string;
    accountName?: string | null;
    contractTitle?: string | null;
    dueDate: string;
    noticeDeadline: string;
    riskScore: number;
    valueAmount?: number | null;
    currency?: string | null;
  };
  onNotify: () => void;
  onMarkHandled: () => void;
  onSnooze: (date: string) => void;
}) {
  const { t } = useTranslation();
  const [snoozeDate, setSnoozeDate] = useState<string>("");
  const value = (r.valueAmount ?? 0).toLocaleString(undefined, {
    style: "currency",
    currency: r.currency ?? "EUR",
    maximumFractionDigits: 0,
  });
  const due = new Date(r.dueDate).toLocaleDateString();
  const notice = new Date(r.noticeDeadline).toLocaleDateString();
  const riskTone =
    r.riskScore >= 70 ? "destructive" : r.riskScore >= 40 ? "default" : "secondary";

  return (
    <div
      className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={`row-renewal-${r.id}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{r.accountName ?? "—"}</span>
          <Badge variant={riskTone as "default" | "secondary" | "destructive"}>
            {t("pages.reports.trendActions.row.risk", { score: r.riskScore })}
          </Badge>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {r.contractTitle ?? ""}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{value}</span>
          <span>{t("pages.reports.trendActions.row.due", { date: due })}</span>
          <span>{t("pages.reports.trendActions.row.notice", { date: notice })}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              data-testid={`button-row-snooze-${r.id}`}
            >
              <Clock className="mr-1 h-4 w-4" />
              {t("pages.reports.trendActions.row.snooze")}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-3">
            <label className="block text-xs font-medium text-muted-foreground">
              {t("pages.reports.trendActions.snooze.label")}
            </label>
            <Input
              type="date"
              value={snoozeDate}
              onChange={(e) => setSnoozeDate(e.target.value)}
              className="mt-1 w-44"
              data-testid={`input-row-snooze-date-${r.id}`}
            />
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={!snoozeDate}
              data-testid={`button-row-snooze-apply-${r.id}`}
              onClick={() => onSnooze(snoozeDate)}
            >
              {t("pages.reports.trendActions.snooze.apply")}
            </Button>
          </PopoverContent>
        </Popover>
        <Button
          size="sm"
          variant="outline"
          data-testid={`button-row-handled-${r.id}`}
          onClick={onMarkHandled}
        >
          <CheckCircle2 className="mr-1 h-4 w-4" />
          {t("pages.reports.trendActions.row.handled")}
        </Button>
        <Button
          size="sm"
          variant="default"
          data-testid={`button-row-notify-${r.id}`}
          onClick={onNotify}
        >
          <Bell className="mr-1 h-4 w-4" />
          {t("pages.reports.trendActions.row.notify")}
        </Button>
      </div>
    </div>
  );
}

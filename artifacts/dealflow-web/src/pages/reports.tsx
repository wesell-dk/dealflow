import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGetPerformanceReport, useGetForecast } from "@workspace/api-client-react";
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
import { ResponsiveContainer, ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export default function Reports() {
  const { t } = useTranslation();
  const { data: performance, isLoading: isLoadingPerf } = useGetPerformanceReport();
  const { data: forecast, isLoading: isLoadingForecast } = useGetForecast();
  const [period, setPeriod] = useState<string>("12");
  const [ownerId, setOwnerId] = useState<string>("__all__");

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

import { useTranslation } from "react-i18next";
import { useGetDashboardSummary, useListCopilotInsights } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, Activity, Target, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TourBanner } from "@/components/patterns/tour-banner";
import { useOnboarding } from "@/contexts/onboarding-context";

export default function Home() {
  const { t } = useTranslation();
  const { openWelcome } = useOnboarding();
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: insightsResp, isLoading: isLoadingInsights } = useListCopilotInsights();
  const insights = insightsResp?.items;

  if (isLoadingSummary || isLoadingInsights) {
    return <div className="p-8 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!summary) return null;

  return (
    <div className="flex flex-col gap-6">
      <TourBanner onStartTour={openWelcome} />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("pages.home.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("pages.home.subtitle")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("pages.home.openDeals")}</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.openDealsCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {t("pages.home.openDealsValue")}: {summary.openDealsValue.toLocaleString()} {summary.currency}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("pages.home.winRate")}</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.winRatePct}%</div>
            <p className="text-xs text-muted-foreground mt-1">{t("pages.home.rolling90")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("pages.home.avgCycle")}</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.avgCycleDays} {t("pages.home.days")}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("pages.home.timeToClose")}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("pages.home.atRisk")}</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{summary.atRiskDeals}</div>
            <p className="text-xs text-muted-foreground mt-1">{t("pages.home.requiresAttention")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("pages.home.queue")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span>{t("pages.home.approvalsDue")}</span>
                <Badge variant="secondary">{summary.openApprovals}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span>{t("pages.home.signaturesPending")}</span>
                <Badge variant="secondary">{summary.signaturesPending}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span>{t("pages.home.quotesAwaiting")}</span>
                <Badge variant="secondary">{summary.quotesAwaitingResponse}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("pages.home.copilotHighlights")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {insights?.slice(0, 3).map(insight => (
                <div key={insight.id} className="p-3 border rounded-md">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={insight.severity === 'high' ? 'destructive' : 'secondary'}>{t(`common.severity${insight.severity.charAt(0).toUpperCase()}${insight.severity.slice(1)}`)}</Badge>
                    <span className="font-medium text-sm">{insight.title}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{insight.summary}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
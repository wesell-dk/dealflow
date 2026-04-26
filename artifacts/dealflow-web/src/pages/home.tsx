import { useTranslation } from "react-i18next";
import { useGetDashboardSummary, useListCopilotInsights } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, Activity, Target, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TourBanner } from "@/components/patterns/tour-banner";
import { useOnboarding } from "@/contexts/onboarding-context";
import { useAuth } from "@/contexts/auth-context";

function firstName(fullName: string | undefined): string {
  if (!fullName) return "";
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0];
}

function greetingKey(date: Date): "morning" | "afternoon" | "evening" {
  const h = date.getHours();
  if (h < 11) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}

export default function Home() {
  const { t, i18n } = useTranslation();
  const { openWelcome } = useOnboarding();
  const { user } = useAuth();
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: insightsResp, isLoading: isLoadingInsights } = useListCopilotInsights();
  const insights = insightsResp?.items;

  if (isLoadingSummary || isLoadingInsights) {
    return <div className="p-8 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!summary) return null;

  const now = new Date();
  const locale = i18n.resolvedLanguage === "en" ? "en-US" : "de-DE";
  const dateLabel = now.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const greeting = t(`pages.home.greetings.${greetingKey(now)}`);
  const fname = firstName(user?.name);

  return (
    <div className="flex flex-col gap-8">
      <TourBanner onStartTour={openWelcome} />

      <header className="flex flex-col items-center text-center pt-2">
        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground/80">
          {dateLabel}
        </p>
        <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-foreground">
          {fname ? `${greeting}, ${fname}` : greeting}
        </h1>
        <p className="text-muted-foreground mt-2 max-w-xl">
          {t("pages.home.subtitle")}
        </p>
      </header>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("pages.home.openDeals")}
            </CardTitle>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Briefcase className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-tight">{summary.openDealsCount}</div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {t("pages.home.openDealsValue")}: {summary.openDealsValue.toLocaleString()} {summary.currency}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("pages.home.winRate")}
            </CardTitle>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[hsl(var(--brand-2)/0.12)] text-[hsl(var(--brand-2))]">
              <Target className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-tight">{summary.winRatePct}%</div>
            <p className="text-xs text-muted-foreground mt-1.5">{t("pages.home.rolling90")}</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("pages.home.avgCycle")}
            </CardTitle>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Activity className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-tight">
              {summary.avgCycleDays} <span className="text-base font-medium text-muted-foreground">{t("pages.home.days")}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{t("pages.home.timeToClose")}</p>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t("pages.home.atRisk")}
            </CardTitle>
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-4 w-4" />
            </span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold tracking-tight text-destructive">{summary.atRiskDeals}</div>
            <p className="text-xs text-muted-foreground mt-1.5">{t("pages.home.requiresAttention")}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("pages.home.queue")}</CardTitle>
          </CardHeader>
          <CardContent className="pb-6">
            <div className="space-y-1">
              <div className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-accent/40 transition-colors">
                <span className="text-sm">{t("pages.home.approvalsDue")}</span>
                <Badge variant="secondary" className="rounded-full px-2.5 tabular-nums">{summary.openApprovals}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-accent/40 transition-colors">
                <span className="text-sm">{t("pages.home.signaturesPending")}</span>
                <Badge variant="secondary" className="rounded-full px-2.5 tabular-nums">{summary.signaturesPending}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-accent/40 transition-colors">
                <span className="text-sm">{t("pages.home.quotesAwaiting")}</span>
                <Badge variant="secondary" className="rounded-full px-2.5 tabular-nums">{summary.quotesAwaitingResponse}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("pages.home.copilotHighlights")}</CardTitle>
          </CardHeader>
          <CardContent className="pb-6">
            <div className="space-y-3">
              {insights?.slice(0, 3).map(insight => (
                <div key={insight.id} className="p-4 border border-border/70 rounded-xl bg-card">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={insight.severity === 'high' ? 'destructive' : 'secondary'} className="rounded-full">
                      {t(`common.severity${insight.severity.charAt(0).toUpperCase()}${insight.severity.slice(1)}`)}
                    </Badge>
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

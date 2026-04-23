import { Link } from "wouter";
import { useGetDashboardSummary, useListCopilotInsights } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Briefcase, Activity, Target, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: insights, isLoading: isLoadingInsights } = useListCopilotInsights();

  if (isLoadingSummary || isLoadingInsights) {
    return <div className="p-8 space-y-4"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!summary) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Today</h1>
        <p className="text-muted-foreground mt-1">Overview of your pipeline and active tasks.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Open Deals</CardTitle>
            <Briefcase className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.openDealsCount}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Value: {summary.openDealsValue.toLocaleString()} {summary.currency}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.winRatePct}%</div>
            <p className="text-xs text-muted-foreground mt-1">Rolling 90 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Cycle Time</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.avgCycleDays} days</div>
            <p className="text-xs text-muted-foreground mt-1">Time to close</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">At Risk Deals</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{summary.atRiskDeals}</div>
            <p className="text-xs text-muted-foreground mt-1">Requires attention</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span>Approvals Due</span>
                <Badge variant="secondary">{summary.openApprovals}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span>Signatures Pending</span>
                <Badge variant="secondary">{summary.signaturesPending}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span>Quotes Awaiting Response</span>
                <Badge variant="secondary">{summary.quotesAwaitingResponse}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Copilot Highlights</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {insights?.slice(0, 3).map(insight => (
                <div key={insight.id} className="p-3 border rounded-md">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={insight.severity === 'high' ? 'destructive' : 'secondary'}>{insight.severity}</Badge>
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
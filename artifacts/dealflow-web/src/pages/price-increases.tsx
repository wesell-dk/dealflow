import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useListPriceIncreases } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";

export default function PriceIncreases() {
  const { t } = useTranslation();
  // Using the actual hook name from API client
  const { data: campaigns, isLoading } = useListPriceIncreases?.() ?? { data: [], isLoading: false };

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.priceIncreasesList.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.priceIncreasesList.subtitle")}</p>
        </div>
      </div>

      {!campaigns?.length ? (
        <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-muted/20">
          <TrendingUp className="h-10 w-10 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">No active campaigns</h2>
          <p className="text-muted-foreground">{t("pages.priceIncreasesList.empty")}</p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <Card key={campaign.id}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <CardTitle className="text-lg">
                  <Link href={`/price-increases/${campaign.id}`} className="hover:underline">
                    {campaign.name}
                  </Link>
                </CardTitle>
                <Badge variant={campaign.status === "Active" ? "default" : "outline"}>
                  {campaign.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Effective Date</span>
                  <span>{new Date(campaign.effectiveDate).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Accounts</span>
                  <span>{campaign.accountsCount}</span>
                </div>
                
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
                    {campaign.acceptedCount} Accepted
                  </Badge>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
                    {campaign.pendingCount} Pending
                  </Badge>
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">
                    {campaign.rejectedCount} Rejected
                  </Badge>
                </div>

                <div className="pt-4 border-t">
                  <div className="text-xs text-muted-foreground mb-1">Avg. Uplift</div>
                  <div className="text-2xl font-bold text-primary">
                    +{campaign.averageUpliftPct ?? 0}%
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

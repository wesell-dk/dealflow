import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useListPriceIncreases } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { PriceIncreaseStatusBadge } from "@/components/patterns/status-badges";

export default function PriceIncreases() {
  const { t } = useTranslation();
  const { data: campaigns, isLoading } = useListPriceIncreases?.() ?? { data: [], isLoading: false };

  return (
    <div className="flex flex-col">
      <PageHeader
        icon={TrendingUp}
        title={t("pages.priceIncreasesList.title")}
        subtitle={t("pages.priceIncreasesList.subtitle")}
      />

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !campaigns?.length ? (
        <EmptyStateCard
          icon={TrendingUp}
          title={t("pages.priceIncreasesList.emptyTitle")}
          body={t("pages.priceIncreasesList.emptyBody")}
          hint={t("pages.priceIncreasesList.emptyHint")}
        />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <Card key={campaign.id}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between gap-2">
                <CardTitle className="text-lg">
                  <Link href={`/price-increases/${campaign.id}`} className="hover:underline">
                    {campaign.name}
                  </Link>
                </CardTitle>
                <PriceIncreaseStatusBadge status={campaign.status} />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("pages.priceIncreasesList.effectiveDate")}</span>
                  <span>{new Date(campaign.effectiveDate).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("pages.priceIncreasesList.accounts")}</span>
                  <span>{campaign.accountsCount}</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50">
                    {campaign.acceptedCount} {t("pages.priceIncreasesList.accepted")}
                  </Badge>
                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50">
                    {campaign.pendingCount} {t("pages.priceIncreasesList.pending")}
                  </Badge>
                  <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/50">
                    {campaign.rejectedCount} {t("pages.priceIncreasesList.rejected")}
                  </Badge>
                </div>

                <div className="pt-4 border-t">
                  <div className="text-xs text-muted-foreground mb-1">{t("pages.priceIncreasesList.avgUplift")}</div>
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

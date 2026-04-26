import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useListPriceIncreases } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import {
  PriceIncreaseStatusBadge,
  PriceIncreaseCounterBadge,
} from "@/components/patterns/status-badges";

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
                  <PriceIncreaseCounterBadge
                    kind="accepted"
                    count={campaign.acceptedCount}
                    label={t("pages.priceIncreasesList.accepted")}
                  />
                  <PriceIncreaseCounterBadge
                    kind="pending"
                    count={campaign.pendingCount}
                    label={t("pages.priceIncreasesList.pending")}
                  />
                  <PriceIncreaseCounterBadge
                    kind="rejected"
                    count={campaign.rejectedCount}
                    label={t("pages.priceIncreasesList.rejected")}
                  />
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

import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Link } from "wouter";
import { useListNegotiations } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MessageSquare, AlertTriangle, RefreshCw, Check, Clock, Handshake } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { NegotiationStatusBadge, RiskBadge } from "@/components/patterns/status-badges";

export default function Negotiations() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string>("active");
  const { data: negotiations, isLoading } = useListNegotiations(
    status === "all" ? {} : { status }
  );

  return (
    <div className="flex flex-col">
      <PageHeader
        icon={Handshake}
        title={t("pages.negotiations.title")}
        subtitle={t("pages.negotiations.subtitle")}
      />

      <div className="flex gap-2 mb-4">
        <Button variant={status === "active" ? "default" : "outline"} onClick={() => setStatus("active")} size="sm">
          {t("pages.negotiations.tabActive")}
        </Button>
        <Button variant={status === "concluded" ? "default" : "outline"} onClick={() => setStatus("concluded")} size="sm">
          {t("pages.negotiations.tabConcluded")}
        </Button>
        <Button variant={status === "all" ? "default" : "outline"} onClick={() => setStatus("all")} size="sm">
          {t("pages.negotiations.tabAll")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !negotiations || negotiations.length === 0 ? (
        <EmptyStateCard
          icon={Handshake}
          title={t("pages.negotiations.emptyTitle")}
          body={t("pages.negotiations.emptyBody")}
          hint={t("pages.negotiations.emptyHint")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {negotiations?.map((neg) => {
            let Icon = MessageSquare;
            let iconColor = "text-blue-500";
            if (neg.lastReactionType === "objection") { Icon = AlertTriangle; iconColor = "text-orange-500"; }
            else if (neg.lastReactionType === "counterproposal") { Icon = RefreshCw; iconColor = "text-purple-500"; }
            else if (neg.lastReactionType === "acceptance") { Icon = Check; iconColor = "text-green-500"; }

            return (
              <Card key={neg.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-lg">
                      <Link href={`/negotiations/${neg.id}`} className="hover:underline">
                        {neg.dealName}
                      </Link>
                    </CardTitle>
                    <NegotiationStatusBadge status={neg.status} />
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{t("pages.negotiations.round", { n: neg.round })}</Badge>
                    <RiskBadge risk={neg.riskLevel} />
                  </div>

                  <div className="mt-auto pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${iconColor}`} />
                      <span className="capitalize">{neg.lastReactionType}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>{formatDistanceToNow(new Date(neg.updatedAt), { locale: de, addSuffix: true })}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

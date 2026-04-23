import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Link } from "wouter";
import { useListNegotiations } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MessageSquare, AlertTriangle, RefreshCw, Check, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Negotiations() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string>("active");
  const { data: negotiations, isLoading } = useListNegotiations(
    status === "all" ? {} : { status }
  );

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.negotiations.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.negotiations.subtitle")}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant={status === "active" ? "default" : "outline"} onClick={() => setStatus("active")} size="sm">
          Active
        </Button>
        <Button variant={status === "concluded" ? "default" : "outline"} onClick={() => setStatus("concluded")} size="sm">
          Concluded
        </Button>
        <Button variant={status === "all" ? "default" : "outline"} onClick={() => setStatus("all")} size="sm">
          All
        </Button>
      </div>

      {(!negotiations || negotiations.length === 0) ? (
        <Card className="p-12 text-center flex flex-col items-center justify-center text-muted-foreground">
          <MessageSquare className="h-12 w-12 mb-4 opacity-20" />
          <p>No negotiations found for this status.</p>
        </Card>
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
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">
                      <Link href={`/negotiations/${neg.id}`} className="hover:underline">
                        {neg.dealName}
                      </Link>
                    </CardTitle>
                    <Badge variant={neg.status === "active" ? "default" : "secondary"}>
                      {neg.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col gap-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Round {neg.round}</Badge>
                    <Badge variant={neg.riskLevel === "high" ? "destructive" : "outline"}>
                      Risk: {neg.riskLevel}
                    </Badge>
                  </div>
                  
                  <div className="mt-auto pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${iconColor}`} />
                      <span className="capitalize">{neg.lastReactionType}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>{formatDistanceToNow(new Date(neg.updatedAt))} ago</span>
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

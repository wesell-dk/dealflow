import { useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetOrderConfirmation,
  useHandoverOrderConfirmation,
  getGetOrderConfirmationQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, CheckCircle2, XCircle, Clock, ArrowRightCircle } from "lucide-react";

const checkIcon = (status: string) => {
  if (status === "passed") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-rose-600" />;
  return <Clock className="h-4 w-4 text-amber-600" />;
};

export default function OrderConfirmationDetail() {
  const [, params] = useRoute("/order-confirmations/:id");
  const id = params?.id ?? "";
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useGetOrderConfirmation(id);
  const handover = useHandoverOrderConfirmation();

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">{t("common.noData")}</p>;

  const handleHandover = async () => {
    await handover.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getGetOrderConfirmationQueryKey(id) });
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <Link href="/order-confirmations">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            {data.number}
            <Badge variant="outline">{data.status}</Badge>
          </h1>
          <p className="text-sm text-muted-foreground">{data.dealName}</p>
        </div>
        {data.status !== "handed_over" && (
          <Button onClick={handleHandover} disabled={handover.isPending}>
            <ArrowRightCircle className="h-4 w-4 mr-2" />
            Handover
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Readiness</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="text-3xl font-bold tabular-nums">{data.readinessScore}%</div>
            </div>
            <Progress value={data.readinessScore} className="h-2 mt-2" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums">
              {new Intl.NumberFormat(i18n.resolvedLanguage, {
                style: "currency",
                currency: data.currency,
              }).format(data.totalAmount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Delivery</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg">
              {data.expectedDelivery
                ? new Date(data.expectedDelivery).toLocaleDateString(i18n.resolvedLanguage)
                : "—"}
            </div>
            {data.handoverAt && (
              <div className="text-xs text-muted-foreground mt-1">
                Handover: {new Date(data.handoverAt).toLocaleString(i18n.resolvedLanguage)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("pages.orderConfirmations.handoverChecklist")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {data.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 py-3">
                {checkIcon(c.status)}
                <div className="flex-1">
                  <div className="text-sm font-medium">{c.label}</div>
                  {c.detail && (
                    <div className="text-xs text-muted-foreground mt-0.5">{c.detail}</div>
                  )}
                </div>
                <Badge variant={c.status === "passed" ? "secondary" : c.status === "failed" ? "destructive" : "outline"}>
                  {t(`pages.orderConfirmations.${c.status === "passed" ? "passed" : c.status === "failed" ? "failed" : "pending"}`)}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

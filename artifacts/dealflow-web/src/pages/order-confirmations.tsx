import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useListOrderConfirmations } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { ClipboardCheck } from "lucide-react";

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  preparing: "outline",
  checks_pending: "outline",
  ready_for_handover: "secondary",
  in_onboarding: "default",
  completed: "default",
};

export default function OrderConfirmations() {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useListOrderConfirmations();

  return (
    <>
      <div className="flex items-center gap-3">
        <ClipboardCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("pages.orderConfirmations.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pages.orderConfirmations.subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("pages.orderConfirmations.title")}</CardTitle>
          <CardDescription>
            {data ? `${data.length}` : "—"} {t("nav.orderConfirmations")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : !data || data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("pages.orderConfirmations.noConfirmations")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Deal</TableHead>
                  <TableHead>{t("common.status")}</TableHead>
                  <TableHead>Readiness</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>{t("common.date")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c) => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Link href={`/order-confirmations/${c.id}`} className="font-mono text-xs text-primary">
                        {c.number}
                      </Link>
                    </TableCell>
                    <TableCell>{c.dealName}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[c.status] ?? "outline"}>{c.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 w-32">
                        <Progress value={c.readinessScore} className="h-1.5" />
                        <span className="text-xs tabular-nums w-8">{c.readinessScore}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {new Intl.NumberFormat(i18n.resolvedLanguage, {
                        style: "currency",
                        currency: c.currency,
                      }).format(c.totalAmount)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString(i18n.resolvedLanguage)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useListDeals, useGetDealPipeline } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Search, Plus, Briefcase } from "lucide-react";
import { DealFormDialog } from "@/components/deals/deal-form-dialog";

export default function Deals() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const { data: deals, isLoading: isLoadingDeals } = useListDeals({ search });
  const { data: pipeline, isLoading: isLoadingPipeline } = useGetDealPipeline();

  if (isLoadingDeals || isLoadingPipeline) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.deals.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.deals.subtitle")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="deals-new-button">
          <Plus className="h-4 w-4 mr-1" />
          Deal anlegen
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {pipeline?.stages.map((stage) => (
          <Card key={stage.stage}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{stage.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stage.count}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Value: {stage.value.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("pages.deals.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      {deals?.length === 0 && !search ? (
        <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-muted/20">
          <Briefcase className="h-10 w-10 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">Noch keine Deals</h2>
          <p className="text-muted-foreground mb-4">Lege deinen ersten Deal an, um die Pipeline zu starten.</p>
          <Button onClick={() => setCreateOpen(true)} data-testid="deals-empty-create">
            <Plus className="h-4 w-4 mr-1" />
            Ersten Deal anlegen
          </Button>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("nav.accounts")}</TableHead>
                <TableHead>{t("common.stage")}</TableHead>
                <TableHead>{t("common.value")}</TableHead>
                <TableHead>{t("common.owner")}</TableHead>
                <TableHead>{t("pages.deals.closeDate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals?.map((deal) => (
                <TableRow key={deal.id}>
                  <TableCell className="font-medium">
                    <Link href={`/deals/${deal.id}`} className="hover:underline">{deal.name}</Link>
                  </TableCell>
                  <TableCell>{deal.accountName}</TableCell>
                  <TableCell><Badge variant="outline">{deal.stage}</Badge></TableCell>
                  <TableCell>{deal.value.toLocaleString()} {deal.currency}</TableCell>
                  <TableCell>{deal.ownerName}</TableCell>
                  <TableCell>{new Date(deal.expectedCloseDate).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
              {deals?.length === 0 && search && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">Keine Treffer für „{search}".</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <DealFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useListOrderConfirmations } from "@workspace/api-client-react";
import { TableSkeleton } from "@/components/patterns/skeletons";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { ClipboardCheck, Search } from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { OrderConfirmationStatusBadge } from "@/components/patterns/status-badges";

export default function OrderConfirmations() {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useListOrderConfirmations();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    if (!data) return [];
    const s = search.trim().toLowerCase();
    return data.filter((c) => {
      const matchesSearch = !s
        || c.number.toLowerCase().includes(s)
        || c.dealName.toLowerCase().includes(s);
      const matchesStatus = statusFilter === "all" || c.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [data, search, statusFilter]);

  const statuses = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((c) => set.add(c.status));
    return Array.from(set).sort();
  }, [data]);

  return (
    <div className="flex flex-col">
      <PageHeader
        icon={ClipboardCheck}
        title={t("pages.orderConfirmations.title")}
        subtitle={t("pages.orderConfirmations.subtitle")}
      />

      {!isLoading && data && data.length > 0 && (
        <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2 mb-4">
          <div className="relative w-full md:w-60">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("pages.orderConfirmations.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
              data-testid="oc-search"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full md:w-44" data-testid="oc-status-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={8} cols={6} />
      ) : !data || data.length === 0 ? (
        <EmptyStateCard
          icon={ClipboardCheck}
          title={t("pages.orderConfirmations.emptyTitle")}
          body={t("pages.orderConfirmations.emptyBody")}
          hint={t("pages.orderConfirmations.emptyHint")}
        />
      ) : filtered.length === 0 ? (
        <EmptyStateCard
          icon={Search}
          title={t("common.noResultsTitle")}
          body={t("common.noResultsBody")}
        />
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background z-20 md:static md:bg-transparent">#</TableHead>
                <TableHead>{t("common.deal")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead>{t("pages.orderConfirmations.readiness")}</TableHead>
                <TableHead className="text-right">{t("common.total")}</TableHead>
                <TableHead>{t("common.date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="sticky left-0 bg-background z-10 md:static md:bg-transparent">
                    <Link href={`/order-confirmations/${c.id}`} className="font-mono text-xs text-primary hover:underline">
                      {c.number}
                    </Link>
                  </TableCell>
                  <TableCell>{c.dealName}</TableCell>
                  <TableCell><OrderConfirmationStatusBadge status={c.status} /></TableCell>
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
        </div>
      )}
    </div>
  );
}

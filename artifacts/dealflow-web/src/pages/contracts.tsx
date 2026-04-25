import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useListContracts,
  useListExternalContracts,
  type Contract,
  type ExternalContract,
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FileText, Plus, RefreshCw } from "lucide-react";
import { ContractFormDialog } from "@/components/contracts/contract-form-dialog";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { ContractStatusBadge, RiskBadge } from "@/components/patterns/status-badges";

type Source = "all" | "internal" | "external";

type Row =
  | {
      kind: "internal";
      id: string;
      title: string;
      dealId: string;
      dealName: string;
      template: string;
      version: number;
      status: string;
      riskLevel: Contract["riskLevel"];
      validUntil: string | null;
      renewalRelevant: false;
    }
  | {
      kind: "external";
      id: string;
      title: string;
      accountId: string;
      accountName: string | null;
      fileName: string;
      status: string;
      validUntil: string | null;
      renewalRelevant: boolean;
    };

export default function Contracts() {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [location, setLocation] = useLocation();

  // Open the create dialog when the URL contains ?new=1 (e.g. command palette
  // entry or deep link from the global "Neuer Vertrag" shortcut). We strip the
  // flag from the URL so refreshing the page doesn't keep popping the dialog.
  useEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    if (params.get("new") === "1") {
      setCreateOpen(true);
      params.delete("new");
      const next = params.toString();
      setLocation(next ? `${location}?${next}` : location, { replace: true });
    }
    // We intentionally only run this on mount / location change.
  }, [location, setLocation]);

  const { data: contracts, isLoading: l1 } = useListContracts();
  const { data: externals, isLoading: l2 } = useListExternalContracts();

  const isLoading = l1 || l2;

  const rows = useMemo<Row[]>(() => {
    const internal: Row[] = (contracts ?? []).map((c) => ({
      kind: "internal",
      id: c.id,
      title: c.title,
      dealId: c.dealId,
      dealName: c.dealName,
      template: c.template,
      version: c.version,
      status: c.status,
      riskLevel: c.riskLevel,
      validUntil: c.validUntil ?? null,
      renewalRelevant: false,
    }));
    const ext: Row[] = (externals ?? []).map((c: ExternalContract) => ({
      kind: "external",
      id: c.id,
      title: c.title,
      accountId: c.accountId,
      accountName: c.accountName ?? null,
      fileName: c.fileName,
      status: c.status,
      validUntil: c.effectiveTo ?? null,
      renewalRelevant: c.renewalRelevant,
    }));
    let combined: Row[] = [];
    if (source === "internal") combined = internal;
    else if (source === "external") combined = ext;
    else combined = [...internal, ...ext];
    return combined.sort((a, b) => a.title.localeCompare(b.title, "de"));
  }, [contracts, externals, source]);

  return (
    <div className="flex flex-col">
      <PageHeader
        icon={FileText}
        title={t("pages.contracts.title")}
        subtitle={t("pages.contracts.subtitle")}
        actions={
          <>
            <div className="w-44">
              <Label className="text-xs text-muted-foreground">{t("pages.contracts.source")}</Label>
              <Select value={source} onValueChange={(v) => setSource(v as Source)}>
                <SelectTrigger data-testid="contracts-source-filter"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  <SelectItem value="internal">{t("pages.contracts.internal")}</SelectItem>
                  <SelectItem value="external">{t("pages.contracts.external")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => setCreateOpen(true)} data-testid="button-new-contract" className="self-end">
              <Plus className="mr-2 h-4 w-4" /> {t("pages.contracts.newContract")}
            </Button>
          </>
        }
      />

      <ContractFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <EmptyStateCard
          icon={FileText}
          title={t("pages.contracts.emptyTitle")}
          body={t("pages.contracts.emptyBody")}
          primaryAction={{
            label: t("pages.contracts.newContract"),
            onClick: () => setCreateOpen(true),
            testId: "contracts-empty-create",
          }}
        />
      ) : (
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("common.title")}</TableHead>
              <TableHead>Quelle</TableHead>
              <TableHead>{t("common.deal")}</TableHead>
              <TableHead>{t("common.template")}</TableHead>
              <TableHead>{t("common.version")}</TableHead>
              <TableHead>{t("common.status")}</TableHead>
              <TableHead>{t("common.risk")}</TableHead>
              <TableHead>{t("common.validUntil")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) =>
              row.kind === "internal" ? (
                <TableRow key={`int-${row.id}`} data-testid={`contract-row-${row.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/contracts/${row.id}`} className="flex items-center gap-2 hover:underline">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell><Badge variant="outline">Intern</Badge></TableCell>
                  <TableCell>
                    <Link href={`/deals/${row.dealId}`} className="hover:underline">
                      {row.dealName}
                    </Link>
                  </TableCell>
                  <TableCell>{row.template}</TableCell>
                  <TableCell>v{row.version}</TableCell>
                  <TableCell><ContractStatusBadge status={row.status} /></TableCell>
                  <TableCell><RiskBadge risk={row.riskLevel} /></TableCell>
                  <TableCell>{row.validUntil ? new Date(row.validUntil).toLocaleDateString() : '—'}</TableCell>
                </TableRow>
              ) : (
                <TableRow key={`ext-${row.id}`} data-testid={`contract-row-${row.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/accounts/${row.accountId}`} className="flex items-center gap-2 hover:underline">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="gap-1">
                      {t("pages.contracts.external")}
                      {row.renewalRelevant && <RefreshCw className="h-3 w-3" />}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link href={`/accounts/${row.accountId}`} className="text-muted-foreground hover:underline">
                      {row.accountName ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.fileName}</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell><ContractStatusBadge status={row.status} /></TableCell>
                  <TableCell>—</TableCell>
                  <TableCell>{row.validUntil ? new Date(row.validUntil).toLocaleDateString() : '—'}</TableCell>
                </TableRow>
              )
            )}
          </TableBody>
        </Table>
      </div>
      )}
    </div>
  );
}

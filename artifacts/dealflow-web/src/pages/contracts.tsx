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
import { Input } from "@/components/ui/input";
import { TableSkeleton } from "@/components/patterns/skeletons";
import { FileText, Plus, RefreshCw, Search, ArrowDown, ArrowUp } from "lucide-react";
import { ContractFormDialog } from "@/components/contracts/contract-form-dialog";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { ContractStatusBadge, RiskBadge } from "@/components/patterns/status-badges";
import { SavedViewTabs, type ViewState, type BuiltInView } from "@/components/patterns/saved-view-tabs";
import { FilterChip, FilterChipsRow } from "@/components/patterns/filter-chips";
import { PaginationBar } from "@/components/patterns/pagination-bar";

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

const DEFAULT_VIEW: ViewState = {
  filters: {},
  columns: [],
  sortBy: "title",
  sortDir: "asc",
};

export default function Contracts() {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [location, setLocation] = useLocation();

  useEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    const params = new URLSearchParams(search);
    if (params.get("new") === "1") {
      setCreateOpen(true);
      params.delete("new");
      const next = params.toString();
      setLocation(next ? `${location}?${next}` : location, { replace: true });
    }
  }, [location, setLocation]);

  const { data: contracts, isLoading: l1 } = useListContracts();
  const { data: externals, isLoading: l2 } = useListExternalContracts();
  const isLoading = l1 || l2;

  const builtIns: BuiltInView[] = useMemo(() => [
    { id: "all",       name: t("pages.contracts.viewAll"),       isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: {} } },
    { id: "active",    name: t("pages.contracts.viewActive"),    isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { status: "active" } } },
    { id: "highRisk",  name: t("pages.contracts.viewHighRisk"),  isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { risk: "high" } } },
    { id: "external",  name: t("pages.contracts.viewExternal"),  isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { source: "external" } } },
  ], [t]);

  const [activeViewId, setActiveViewId] = useState<string>("all");
  const [view, setView] = useState<ViewState>(builtIns[0].state);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => { setPage(1); }, [view.filters, view.sortBy, view.sortDir, search]);

  function selectView(id: string, state: ViewState) {
    setActiveViewId(id);
    setView(state);
  }
  function setFilter(k: string, v: unknown) {
    setView((s) => {
      const nf = { ...(s.filters ?? {}) };
      if (v === null || v === "" || v === undefined) delete nf[k]; else nf[k] = v;
      return { ...s, filters: nf };
    });
  }
  function toggleSort(key: string) {
    setView((s) => {
      if (s.sortBy === key) return { ...s, sortDir: s.sortDir === "asc" ? "desc" : "asc" };
      return { ...s, sortBy: key, sortDir: "asc" };
    });
  }

  const filtered = useMemo(() => {
    const f = view.filters as Record<string, unknown>;
    const source: Source = (f.source as Source) ?? "all";

    const internal: Row[] = (contracts ?? []).map((c) => ({
      kind: "internal", id: c.id, title: c.title, dealId: c.dealId, dealName: c.dealName,
      template: c.template, version: c.version, status: c.status,
      riskLevel: c.riskLevel, validUntil: c.validUntil ?? null, renewalRelevant: false,
    }));
    const ext: Row[] = (externals ?? []).map((c: ExternalContract) => ({
      kind: "external", id: c.id, title: c.title, accountId: c.accountId,
      accountName: c.accountName ?? null, fileName: c.fileName, status: c.status,
      validUntil: c.effectiveTo ?? null, renewalRelevant: c.renewalRelevant,
    }));

    let combined: Row[] = [];
    if (source === "internal") combined = internal;
    else if (source === "external") combined = ext;
    else combined = [...internal, ...ext];

    if (f.status) combined = combined.filter((r) => r.status === f.status);
    if (f.risk) combined = combined.filter((r) => r.kind === "internal" && r.riskLevel === f.risk);
    if (f.renewalRelevant) combined = combined.filter((r) => r.kind === "external" && r.renewalRelevant);

    const s = search.trim().toLowerCase();
    if (s) combined = combined.filter((r) => {
      if (r.title.toLowerCase().includes(s)) return true;
      if (r.kind === "internal" && r.dealName.toLowerCase().includes(s)) return true;
      if (r.kind === "external" && (r.accountName ?? "").toLowerCase().includes(s)) return true;
      if (r.kind === "external" && r.fileName.toLowerCase().includes(s)) return true;
      return false;
    });

    const sortBy = view.sortBy ?? "title";
    const dir = view.sortDir === "desc" ? -1 : 1;
    combined = [...combined].sort((a, b) => {
      const get = (r: Row) => {
        if (sortBy === "title")      return r.title.toLowerCase();
        if (sortBy === "status")     return r.status;
        if (sortBy === "validUntil") return r.validUntil ? new Date(r.validUntil).getTime() : 0;
        return r.title.toLowerCase();
      };
      const av = get(a), bv = get(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "de") * dir;
    });
    return combined;
  }, [contracts, externals, view, search]);

  const total = filtered.length;
  const pageRows = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const hasFilters = Object.keys(view.filters ?? {}).length > 0;

  const sortableHeader = (key: string, label: string) => (
    <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-foreground">
      {label}
      {view.sortBy === key && (view.sortDir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={FileText}
        title={t("pages.contracts.title")}
        subtitle={t("pages.contracts.subtitle")}
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="button-new-contract">
            <Plus className="mr-2 h-4 w-4" /> {t("pages.contracts.newContract")}
          </Button>
        }
      />

      <ContractFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      <SavedViewTabs
        entityType="contract"
        builtIns={builtIns}
        activeViewId={activeViewId}
        currentState={view}
        onSelect={selectView}
      />

      <FilterChipsRow
        hasActive={hasFilters}
        onClearAll={() => setView((s) => ({ ...s, filters: {} }))}
        extra={
          <div className="relative w-full md:w-60">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("common.searchPlaceholder")}
              className="h-8 pl-8 text-sm"
              data-testid="contracts-search"
            />
          </div>
        }
      >
        <FilterChip
          label={t("pages.contracts.source")}
          value={(view.filters as Record<string, string>).source}
          options={[
            { value: "internal", label: t("pages.contracts.internal") },
            { value: "external", label: t("pages.contracts.external") },
          ]}
          onChange={(v) => setFilter("source", v)}
          testId="chip-contracts-source"
        />
        <FilterChip
          label={t("common.status")}
          value={(view.filters as Record<string, string>).status}
          options={[
            { value: "draft",     label: t("pages.contracts.statusDraft") },
            { value: "review",    label: t("pages.contracts.statusReview") },
            { value: "signed",    label: t("pages.contracts.statusSigned") },
            { value: "active",    label: t("pages.contracts.statusActive") },
            { value: "expired",   label: t("pages.contracts.statusExpired") },
            { value: "cancelled", label: t("common.cancelled") },
          ]}
          onChange={(v) => setFilter("status", v)}
          testId="chip-contracts-status"
        />
        <FilterChip
          label={t("common.risk")}
          value={(view.filters as Record<string, string>).risk}
          options={[
            { value: "low",    label: t("common.riskLow") },
            { value: "medium", label: t("common.riskMedium") },
            { value: "high",   label: t("common.riskHigh") },
          ]}
          onChange={(v) => setFilter("risk", v)}
          testId="chip-contracts-risk"
        />
      </FilterChipsRow>

      {isLoading ? (
        <TableSkeleton rows={10} cols={7} />
      ) : total === 0 ? (
        ((contracts?.length ?? 0) + (externals?.length ?? 0)) === 0 && !search && !hasFilters ? (
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
          <EmptyStateCard
            icon={FileText}
            title={t("common.noMatches")}
            body={t("common.noMatchesBody")}
            primaryAction={{
              label: t("common.resetFilters"),
              onClick: () => { setView((s) => ({ ...s, filters: {} })); setSearch(""); },
            }}
            testId="contracts-no-match"
          />
        )
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background z-20 md:static md:bg-transparent">{sortableHeader("title", t("common.title"))}</TableHead>
                <TableHead>{t("pages.contracts.source")}</TableHead>
                <TableHead>{t("common.deal")}</TableHead>
                <TableHead>{t("common.template")}</TableHead>
                <TableHead>{t("common.version")}</TableHead>
                <TableHead>{sortableHeader("status", t("common.status"))}</TableHead>
                <TableHead>{t("common.risk")}</TableHead>
                <TableHead>{sortableHeader("validUntil", t("common.validUntil"))}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((row) =>
                row.kind === "internal" ? (
                  <TableRow key={`int-${row.id}`} data-testid={`contract-row-${row.id}`}>
                    <TableCell className="font-medium sticky left-0 bg-background z-10 md:static md:bg-transparent">
                      <Link href={`/contracts/${row.id}`} className="flex items-center gap-2 hover:underline">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        {row.title}
                      </Link>
                    </TableCell>
                    <TableCell><Badge variant="outline">{t("pages.contracts.internal")}</Badge></TableCell>
                    <TableCell>
                      <Link href={`/deals/${row.dealId}`} className="hover:underline">{row.dealName}</Link>
                    </TableCell>
                    <TableCell>{row.template}</TableCell>
                    <TableCell>v{row.version}</TableCell>
                    <TableCell><ContractStatusBadge status={row.status} /></TableCell>
                    <TableCell><RiskBadge risk={row.riskLevel} /></TableCell>
                    <TableCell>{row.validUntil ? new Date(row.validUntil).toLocaleDateString() : '—'}</TableCell>
                  </TableRow>
                ) : (
                  <TableRow key={`ext-${row.id}`} data-testid={`contract-row-${row.id}`}>
                    <TableCell className="font-medium sticky left-0 bg-background z-10 md:static md:bg-transparent">
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
          <div className="border-t">
            <PaginationBar
              total={total}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

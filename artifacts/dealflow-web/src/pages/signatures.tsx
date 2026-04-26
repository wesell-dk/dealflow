import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useListSignaturePackages, useSendSignatureReminder } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { PenTool, Bell, Search, ArrowDown, ArrowUp } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { SignatureStatusBadge } from "@/components/patterns/status-badges";
import { SavedViewTabs, type ViewState, type BuiltInView } from "@/components/patterns/saved-view-tabs";
import { FilterChip, FilterChipsRow } from "@/components/patterns/filter-chips";
import { PaginationBar } from "@/components/patterns/pagination-bar";

const DEFAULT_VIEW: ViewState = {
  filters: { status: "in_progress" },
  columns: [],
  sortBy: "deadline",
  sortDir: "asc",
};

export default function Signatures() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const remind = useSendSignatureReminder();

  const builtIns: BuiltInView[] = useMemo(() => [
    { id: "in_progress", name: t("pages.signatures.tabInProgress"), isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { status: "in_progress" } } },
    { id: "completed",   name: t("pages.signatures.tabCompleted"), isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { status: "completed" }, sortBy: "deadline", sortDir: "desc" } },
    { id: "all",         name: t("pages.signatures.tabAll"),       isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: {} } },
  ], [t]);

  const [activeViewId, setActiveViewId] = useState<string>("in_progress");
  const [view, setView] = useState<ViewState>(builtIns[0].state);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => { setPage(1); }, [view.filters, view.sortBy, view.sortDir, search]);

  const { data: packages, isLoading } = useListSignaturePackages({});

  const filtered = useMemo(() => {
    const f = view.filters as Record<string, unknown>;
    let rows = (packages ?? []).slice();
    if (f.status) rows = rows.filter((p) => p.status === f.status);
    const s = search.trim().toLowerCase();
    if (s) rows = rows.filter((p) => p.title.toLowerCase().includes(s) || p.dealName.toLowerCase().includes(s));
    const sortBy = view.sortBy ?? "deadline";
    const dir = view.sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const get = (r: typeof a) => {
        if (sortBy === "deadline") return r.deadline ? new Date(r.deadline).getTime() : 0;
        if (sortBy === "progress") return r.totalSigners ? r.signedCount / r.totalSigners : 0;
        if (sortBy === "title")   return r.title.toLowerCase();
        return r.status;
      };
      const av = get(a), bv = get(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "de") * dir;
    });
    return rows;
  }, [packages, view, search]);

  const total = filtered.length;
  const pageRows = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

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

  const handleRemind = (id: string) => {
    remind.mutate({ id }, {
      onSuccess: () => toast({ title: t("pages.signatures.reminderSent") }),
      onError:   () => toast({ title: t("pages.signatures.reminderFailed"), variant: "destructive" }),
    });
  };

  const hasFilters = Object.keys(view.filters ?? {}).length > 0;

  const sortableHeader = (key: string, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      {label}
      {view.sortBy === key && (view.sortDir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={PenTool}
        title={t("pages.signatures.title")}
        subtitle={t("pages.signatures.subtitle")}
      />

      <SavedViewTabs
        entityType="signature"
        builtIns={builtIns}
        activeViewId={activeViewId}
        currentState={view}
        onSelect={selectView}
      />

      <FilterChipsRow
        hasActive={hasFilters}
        onClearAll={() => setView((s) => ({ ...s, filters: {} }))}
        extra={
          <div className="relative w-60">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("common.searchPlaceholder")}
              className="h-8 pl-8 text-sm"
              data-testid="signatures-search"
            />
          </div>
        }
      >
        <FilterChip
          label={t("common.status")}
          value={(view.filters as Record<string, string>).status}
          options={[
            { value: "in_progress", label: t("pages.signatures.tabInProgress") },
            { value: "completed",   label: t("pages.signatures.tabCompleted") },
            { value: "cancelled",   label: t("common.cancelled") },
          ]}
          onChange={(v) => setFilter("status", v)}
          testId="chip-signatures-status"
        />
      </FilterChipsRow>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : total === 0 ? (
        packages && packages.length === 0 && !search && !hasFilters ? (
          <EmptyStateCard
            icon={PenTool}
            title={t("pages.signatures.emptyTitle")}
            body={t("pages.signatures.emptyBody")}
            hint={t("pages.signatures.emptyHint")}
          />
        ) : (
          <EmptyStateCard
            icon={PenTool}
            title={t("common.noMatches")}
            body={t("common.noMatchesBody")}
            primaryAction={{
              label: t("common.resetFilters"),
              onClick: () => { setView((s) => ({ ...s, filters: {} })); setSearch(""); },
            }}
            testId="signatures-no-match"
          />
        )
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{sortableHeader("title", t("common.title"))}</TableHead>
                <TableHead>{t("common.deal")}</TableHead>
                <TableHead>{sortableHeader("status", t("common.status"))}</TableHead>
                <TableHead className="w-[200px]">{sortableHeader("progress", t("common.progress"))}</TableHead>
                <TableHead>{sortableHeader("deadline", t("common.deadline"))}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((pkg) => (
                <TableRow key={pkg.id}>
                  <TableCell className="font-medium">
                    <Link href={`/signatures/${pkg.id}`} className="hover:underline">
                      {pkg.title}
                    </Link>
                  </TableCell>
                  <TableCell>{pkg.dealName}</TableCell>
                  <TableCell><SignatureStatusBadge status={pkg.status} /></TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{pkg.signedCount} / {pkg.totalSigners} {t("pages.signatures.signed")}</span>
                      </div>
                      <Progress value={(pkg.signedCount / pkg.totalSigners) * 100} className="h-2" />
                    </div>
                  </TableCell>
                  <TableCell>
                    {pkg.deadline ? new Date(pkg.deadline).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {pkg.status === "in_progress" && (
                      <Button variant="ghost" size="sm" onClick={() => handleRemind(pkg.id)} disabled={remind.isPending}>
                        <Bell className="h-4 w-4 mr-2" />
                        {t("pages.signatures.remind")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
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

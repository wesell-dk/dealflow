import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListObligations,
  useUpdateObligation,
  getListObligationsQueryKey,
  type Obligation,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/patterns/skeletons";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  AlarmClock, AlertTriangle, CheckCircle2, ClipboardList,
  FileSignature, ListChecks, Repeat, Search, ArrowDown, ArrowUp,
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { ObligationStatusBadge } from "@/components/patterns/status-badges";
import { SavedViewTabs, type ViewState, type BuiltInView } from "@/components/patterns/saved-view-tabs";
import { FilterChip, FilterChipsRow } from "@/components/patterns/filter-chips";
import { PaginationBar } from "@/components/patterns/pagination-bar";

type ObligationStatus = "pending" | "in_progress" | "done" | "missed" | "waived";

const DEFAULT_VIEW: ViewState = {
  filters: { state: "open" },
  columns: [],
  sortBy: "dueAt",
  sortDir: "asc",
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function dueClass(o: Obligation): string {
  if (o.status === "done" || o.status === "waived") return "text-muted-foreground";
  if (!o.dueAt) return "";
  const due = new Date(o.dueAt).getTime();
  const now = Date.now();
  if (due < now) return "text-red-600 font-medium";
  if (due - now < 7 * 86400000) return "text-amber-600 font-medium";
  return "";
}

export default function Obligations() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const builtIns: BuiltInView[] = useMemo(() => [
    { id: "open",     name: t("pages.obligations.viewOpen"),     isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { state: "open" } } },
    { id: "overdue",  name: t("pages.obligations.viewOverdue"),  isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { state: "overdue" } } },
    { id: "next7",    name: t("pages.obligations.viewNext7"),    isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { state: "open", dueIn: "7" } } },
    { id: "done",     name: t("pages.obligations.viewDone"),     isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { state: "done" }, sortBy: "completedAt", sortDir: "desc" } },
    { id: "all",      name: t("pages.obligations.viewAll"),      isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: {} } },
  ], [t]);

  const [activeViewId, setActiveViewId] = useState<string>("open");
  const [view, setView] = useState<ViewState>(builtIns[0].state);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  useEffect(() => { setPage(1); }, [view.filters, view.sortBy, view.sortDir, search]);

  const { data, isLoading } = useListObligations({});
  const update = useUpdateObligation();

  const filtered = useMemo(() => {
    const f = view.filters as Record<string, unknown>;
    let rows = (data ?? []).slice();
    const state = (f.state as string) ?? "";
    const now = Date.now();
    if (state === "open") rows = rows.filter(o => o.status !== "done" && o.status !== "waived");
    else if (state === "overdue") rows = rows.filter(o => o.status !== "done" && o.status !== "waived" && o.dueAt && new Date(o.dueAt).getTime() < now);
    else if (state === "done") rows = rows.filter(o => o.status === "done");
    else if (state) rows = rows.filter(o => o.status === state);

    if (f.dueIn) {
      const days = Number(f.dueIn);
      const horizon = now + days * 86400000;
      rows = rows.filter(o => o.dueAt && new Date(o.dueAt).getTime() <= horizon);
    }
    if (f.type) rows = rows.filter(o => o.type === f.type);
    if (f.recurrence) rows = rows.filter(o => o.recurrence === f.recurrence);

    const s = search.trim().toLowerCase();
    if (s) rows = rows.filter(o =>
      o.description.toLowerCase().includes(s)
      || (o.contractTitle ?? "").toLowerCase().includes(s)
      || (o.accountName ?? "").toLowerCase().includes(s)
      || (o.ownerName ?? "").toLowerCase().includes(s),
    );

    const sortBy = view.sortBy ?? "dueAt";
    const dir = view.sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const get = (r: Obligation) => {
        if (sortBy === "dueAt")       return r.dueAt ? new Date(r.dueAt).getTime() : Number.POSITIVE_INFINITY;
        if (sortBy === "completedAt") return r.completedAt ? new Date(r.completedAt).getTime() : 0;
        if (sortBy === "owner")       return (r.ownerName ?? r.ownerRole ?? "").toLowerCase();
        if (sortBy === "status")      return r.status;
        return r.description.toLowerCase();
      };
      const av = get(a), bv = get(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "de") * dir;
    });
    return rows;
  }, [data, view, search]);

  const total = filtered.length;
  const pageRows = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const summary = useMemo(() => {
    const all = data ?? [];
    const open = all.filter(o => o.status !== "done" && o.status !== "waived");
    const overdue = open.filter(o => o.dueAt && new Date(o.dueAt).getTime() < Date.now());
    const next7 = open.filter(o => o.dueAt && new Date(o.dueAt).getTime() >= Date.now()
      && new Date(o.dueAt).getTime() < Date.now() + 7 * 86400000);
    const done30 = all.filter(o => o.status === "done" && o.completedAt
      && Date.now() - new Date(o.completedAt).getTime() < 30 * 86400000);
    return { open: open.length, overdue: overdue.length, next7: next7.length, done30: done30.length };
  }, [data]);

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

  async function setStatus(o: Obligation, status: ObligationStatus) {
    try {
      await update.mutateAsync({ id: o.id, data: { status } });
      await qc.invalidateQueries({ queryKey: getListObligationsQueryKey() });
      toast({ title: t("pages.obligations.statusUpdated") });
    } catch (e) {
      toast({ title: t("common.error"), description: String(e), variant: "destructive" });
    }
  }

  const hasFilters = Object.keys(view.filters ?? {}).length > 0;

  const sortableHeader = (key: string, label: string) => (
    <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-foreground">
      {label}
      {view.sortBy === key && (view.sortDir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
    </button>
  );

  return (
    <div className="space-y-6 p-6" data-testid="page-obligations">
      <PageHeader
        icon={ClipboardList}
        title={t("pages.obligations.title")}
        subtitle={t("pages.obligations.subtitle")}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card data-testid="kpi-open">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />{t("pages.obligations.kpiOpen")}
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{summary.open}</div></CardContent>
        </Card>
        <Card data-testid="kpi-overdue">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />{t("pages.obligations.kpiOverdue")}
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">{summary.overdue}</div></CardContent>
        </Card>
        <Card data-testid="kpi-next7">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlarmClock className="h-4 w-4 text-amber-500" />{t("pages.obligations.kpiNext7")}
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{summary.next7}</div></CardContent>
        </Card>
        <Card data-testid="kpi-done30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />{t("pages.obligations.kpiDone30")}
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-600">{summary.done30}</div></CardContent>
        </Card>
      </div>

      <SavedViewTabs
        entityType="obligation"
        builtIns={builtIns}
        activeViewId={activeViewId}
        currentState={view}
        onSelect={selectView}
      />

      <FilterChipsRow
        hasActive={hasFilters}
        onClearAll={() => setView((s) => ({ ...s, filters: {} }))}
        extra={
          <div className="relative w-full md:w-72">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("pages.obligations.searchPlaceholder")}
              className="h-8 pl-8 text-sm"
              data-testid="input-search"
            />
          </div>
        }
      >
        <FilterChip
          label={t("common.status")}
          value={(view.filters as Record<string, string>).state}
          options={[
            { value: "open",        label: t("pages.obligations.statusOpen") },
            { value: "overdue",     label: t("pages.obligations.statusOverdue") },
            { value: "in_progress", label: t("pages.obligations.statusInProgress") },
            { value: "done",        label: t("pages.obligations.statusDone") },
            { value: "waived",      label: t("pages.obligations.statusWaived") },
          ]}
          onChange={(v) => setFilter("state", v)}
          testId="chip-obligations-state"
        />
        <FilterChip
          label={t("pages.obligations.dueIn")}
          value={(view.filters as Record<string, string>).dueIn}
          options={[
            { value: "7",  label: t("pages.obligations.dueIn7") },
            { value: "30", label: t("pages.obligations.dueIn30") },
            { value: "90", label: t("pages.obligations.dueIn90") },
          ]}
          onChange={(v) => setFilter("dueIn", v)}
          testId="chip-obligations-duein"
        />
        <FilterChip
          label={t("pages.obligations.type")}
          value={(view.filters as Record<string, string>).type}
          options={[
            { value: "delivery",  label: t("pages.obligations.typeDelivery") },
            { value: "reporting", label: t("pages.obligations.typeReporting") },
            { value: "sla",       label: t("pages.obligations.typeSla") },
            { value: "payment",   label: t("pages.obligations.typePayment") },
            { value: "notice",    label: t("pages.obligations.typeNotice") },
            { value: "audit",     label: t("pages.obligations.typeAudit") },
          ]}
          onChange={(v) => setFilter("type", v)}
          testId="chip-obligations-type"
        />
      </FilterChipsRow>

      {isLoading ? (
        <TableSkeleton rows={10} cols={8} />
      ) : total === 0 ? (
        (data?.length ?? 0) === 0 && !search && !hasFilters ? (
          <EmptyStateCard
            icon={ClipboardList}
            title={t("pages.obligations.emptyTitle")}
            body={t("pages.obligations.emptyBody")}
            hint={t("pages.obligations.emptyHint")}
          />
        ) : (
          <EmptyStateCard
            icon={ClipboardList}
            title={t("common.noMatches")}
            body={t("common.noMatchesBody")}
            primaryAction={{
              label: t("common.resetFilters"),
              onClick: () => { setView((s) => ({ ...s, filters: {} })); setSearch(""); },
            }}
            testId="obligations-no-match"
          />
        )
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background z-20 md:static md:bg-transparent">{t("pages.obligations.colObligation")}</TableHead>
                <TableHead>{t("pages.obligations.colContract")}</TableHead>
                <TableHead>{t("pages.obligations.type")}</TableHead>
                <TableHead>{sortableHeader("owner", t("pages.obligations.colOwner"))}</TableHead>
                <TableHead>{sortableHeader("dueAt", t("pages.obligations.colDue"))}</TableHead>
                <TableHead>{t("pages.obligations.colRecurrence")}</TableHead>
                <TableHead>{sortableHeader("status", t("common.status"))}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map(o => (
                <TableRow key={o.id} data-testid={`row-obligation-${o.id}`}>
                  <TableCell className="max-w-md sticky left-0 bg-background z-10 md:static md:bg-transparent">
                    <div className="font-medium text-sm">{o.description}</div>
                    {o.accountName && (
                      <div className="text-xs text-muted-foreground">{o.accountName}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/contracts/${o.contractId}`}>
                      <span className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                        <FileSignature className="h-3 w-3" />
                        {o.contractTitle ?? o.contractId}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {t(`pages.obligations.type${o.type.charAt(0).toUpperCase()}${o.type.slice(1)}`, { defaultValue: o.type })}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {o.ownerName ?? o.ownerRole ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className={`text-sm ${dueClass(o)}`}>{fmtDate(o.dueAt)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {o.recurrence !== "none" && <Repeat className="h-3 w-3 inline mr-1" />}
                    {t(`pages.obligations.recurrence${o.recurrence.charAt(0).toUpperCase()}${o.recurrence.slice(1)}`, { defaultValue: o.recurrence })}
                  </TableCell>
                  <TableCell><ObligationStatusBadge status={o.status === "done" ? "completed" : o.status === "missed" ? "overdue" : o.status} /></TableCell>
                  <TableCell className="text-right">
                    {o.status !== "done" && o.status !== "waived" && (
                      <div className="flex justify-end gap-1">
                        {o.status === "pending" && (
                          <Button size="sm" variant="ghost" onClick={() => setStatus(o, "in_progress")}
                            data-testid={`btn-start-${o.id}`}>
                            {t("pages.obligations.actionStart")}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => setStatus(o, "done")}
                          data-testid={`btn-done-${o.id}`}>
                          {t("pages.obligations.actionDone")}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-muted-foreground"
                          onClick={() => setStatus(o, "waived")}
                          data-testid={`btn-waive-${o.id}`}>
                          {t("pages.obligations.actionWaive")}
                        </Button>
                      </div>
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

import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListDeals,
  useGetDealPipeline,
  useUpdateDeal,
  useListUsers,
  useBulkUpdateDealOwner,
  useBulkUpdateDealStage,
  getListDealsQueryKey,
  getGetDealPipelineQueryKey,
  type Deal,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Search, Plus, Briefcase, ArrowUp, ArrowDown, UserCog, Workflow } from "lucide-react";
import { DealFormDialog } from "@/components/deals/deal-form-dialog";
import { SavedViewTabs, type ViewState, type BuiltInView } from "@/components/patterns/saved-view-tabs";
import { FilterChip, FilterChipsRow } from "@/components/patterns/filter-chips";
import { BulkActionBar } from "@/components/patterns/bulk-action-bar";
import { ColumnChooser, useColumnVisibility, type ColumnDef } from "@/components/patterns/column-chooser";
import { PaginationBar } from "@/components/patterns/pagination-bar";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { CSVExportButton } from "@/components/patterns/csv-export-button";
import { InlineEditField } from "@/components/patterns/inline-edit-field";
import { useToast } from "@/hooks/use-toast";

const COLUMNS: ColumnDef[] = [
  { key: "name",        label: "Deal",         required: true },
  { key: "account",     label: "Account" },
  { key: "stage",       label: "Stage" },
  { key: "value",       label: "Wert" },
  { key: "owner",       label: "Owner" },
  { key: "closeDate",   label: "Close-Datum" },
  { key: "probability", label: "Wahrsch." },
  { key: "risk",        label: "Risiko" },
];

const DEFAULT_VIEW: ViewState = {
  filters: {},
  columns: ["name", "account", "stage", "value", "owner", "closeDate"],
  sortBy: "value",
  sortDir: "desc",
};

export default function Deals() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: deals, isLoading: isLoadingDeals } = useListDeals({ search: search || undefined });
  const { data: pipeline, isLoading: isLoadingPipeline } = useGetDealPipeline();
  const { data: users = [] } = useListUsers();
  const updateDeal = useUpdateDeal();
  const bulkOwner = useBulkUpdateDealOwner();
  const bulkStage = useBulkUpdateDealStage();

  const stageOptions = useMemo(() => (pipeline?.stages ?? []).map((s) => ({ value: s.stage, label: s.label })), [pipeline]);

  const builtIns: BuiltInView[] = useMemo(() => [
    { id: "all",   name: "Alle Deals",     isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: {} } },
    { id: "mine",  name: "Meine Deals",    isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { ownerId: user?.id ?? "" } } },
    { id: "open",  name: "Aktive Pipeline", isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { activePipeline: true } } },
    { id: "closing", name: "Closing < 30 Tage", isBuiltIn: true, state: { ...DEFAULT_VIEW, sortBy: "expectedCloseDate", sortDir: "asc", filters: { closingSoon: true } } },
  ], [user?.id]);

  const [activeViewId, setActiveViewId] = useState<string>("all");
  const [view, setView] = useState<ViewState>(builtIns[0].state);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const colVis = useColumnVisibility("dealflow.deals.cols.v1", COLUMNS);

  useEffect(() => { setSelected(new Set()); }, [activeViewId]);
  useEffect(() => { setPage(1); }, [view.filters, view.sortBy, view.sortDir, search]);

  useEffect(() => {
    const visArr = COLUMNS.filter((c) => colVis.visible.has(c.key)).map((c) => c.key);
    setView((s) => {
      if (s.columns.length === visArr.length && s.columns.every((c, i) => c === visArr[i])) return s;
      return { ...s, columns: visArr };
    });
  }, [colVis.visible]);

  function selectView(id: string, state: ViewState) {
    setActiveViewId(id);
    setView(state);
    if (state.columns && state.columns.length > 0) colVis.setAll(state.columns);
  }

  const filtered = useMemo(() => {
    if (!deals) return [];
    const f = view.filters as Record<string, unknown>;
    const now = Date.now();
    const in30 = now + 30 * 24 * 3600 * 1000;
    let rows = deals.filter((d) => {
      if (f.ownerId && d.ownerId !== f.ownerId) return false;
      if (f.stage && d.stage !== f.stage) return false;
      if (f.accountId && d.accountId !== f.accountId) return false;
      if (f.minValue && d.value < Number(f.minValue)) return false;
      if (f.activePipeline && (d.stage === "closed_won" || d.stage === "closed_lost")) return false;
      if (f.closingSoon) {
        const t = new Date(d.expectedCloseDate).getTime();
        if (!(t >= now && t <= in30)) return false;
      }
      return true;
    });
    const sortBy = view.sortBy ?? "value";
    const dir = view.sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortBy === "closeDate" ? "expectedCloseDate" : sortBy];
      const bv = (b as unknown as Record<string, unknown>)[sortBy === "closeDate" ? "expectedCloseDate" : sortBy];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? ""), "de") * dir;
    });
    return rows;
  }, [deals, view]);

  const total = filtered.length;
  const pageRows = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

  const accountOptions = useMemo(() => {
    const map = new Map<string, string>();
    (deals ?? []).forEach((d) => map.set(d.accountId, d.accountName));
    return Array.from(map.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "de"));
  }, [deals]);

  function setFilter<K extends string>(k: K, v: unknown) {
    setView((s) => {
      const nf = { ...(s.filters ?? {}) };
      if (v === null || v === "" || v === undefined) delete nf[k]; else nf[k] = v;
      return { ...s, filters: nf };
    });
  }

  function toggleSort(key: string) {
    setView((s) => {
      if (s.sortBy === key) return { ...s, sortDir: s.sortDir === "asc" ? "desc" : "asc" };
      return { ...s, sortBy: key, sortDir: "desc" };
    });
  }

  function isAllSelected() {
    return pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  }
  function togglePageAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (isAllSelected()) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function patchDeal(id: string, patch: Parameters<typeof updateDeal.mutateAsync>[0]["data"]) {
    try {
      await updateDeal.mutateAsync({ id, data: patch });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListDealsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetDealPipelineQueryKey() }),
      ]);
      toast({ title: "Gespeichert" });
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "", variant: "destructive" });
      throw e;
    }
  }

  async function doBulkOwner(ownerId: string) {
    try {
      const res = await bulkOwner.mutateAsync({ data: { ids: [...selected], ownerId } });
      await qc.invalidateQueries({ queryKey: getListDealsQueryKey() });
      toast({ title: "Owner aktualisiert", description: `${res.updated} geändert, ${res.skipped} übersprungen.` });
      setSelected(new Set());
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  async function doBulkStage(stage: string) {
    try {
      const res = await bulkStage.mutateAsync({ data: { ids: [...selected], stage } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListDealsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetDealPipelineQueryKey() }),
      ]);
      toast({ title: "Stage aktualisiert", description: `${res.updated} geändert, ${res.skipped} übersprungen.` });
      setSelected(new Set());
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  if (isLoadingDeals || isLoadingPipeline) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  const hasFilters = Object.keys(view.filters ?? {}).length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deals</h1>
          <p className="text-muted-foreground mt-1">Pipeline, Bewertungen und Forecast aller laufenden Deals.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="deals-new-button">
          <Plus className="h-4 w-4 mr-1" /> Deal anlegen
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {pipeline?.stages.map((stage) => {
          const active = (view.filters as Record<string, unknown>).stage === stage.stage;
          return (
            <button
              type="button"
              key={stage.stage}
              onClick={() => setFilter("stage", active ? null : stage.stage)}
              aria-pressed={active}
              className="text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              data-testid={`pipeline-card-${stage.stage}`}
            >
              <Card className="hover:border-primary/40 transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center justify-between">
                    {stage.label}
                    {active && <Badge variant="default" className="text-[9px] py-0 h-4">aktiv</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold tabular-nums">{stage.count}</div>
                  <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                    {stage.value.toLocaleString("de-DE")}
                  </p>
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      <SavedViewTabs
        entityType="deal"
        builtIns={builtIns}
        activeViewId={activeViewId}
        currentState={view}
        onSelect={selectView}
      />

      <div className="flex items-center justify-between gap-2">
        <FilterChipsRow
          hasActive={hasFilters}
          onClearAll={() => setView((s) => ({ ...s, filters: {} }))}
          extra={
            <div className="relative w-60">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Suche Deal-Name…"
                className="h-8 pl-8 text-sm"
                data-testid="deals-search"
              />
            </div>
          }
        >
          <FilterChip
            label="Stage"
            value={(view.filters as Record<string, string>).stage}
            options={stageOptions}
            onChange={(v) => setFilter("stage", v)}
            testId="chip-stage"
          />
          <FilterChip
            label="Owner"
            value={(view.filters as Record<string, string>).ownerId}
            options={users.map((u) => ({ value: u.id, label: u.name }))}
            onChange={(v) => setFilter("ownerId", v)}
            searchable
            testId="chip-owner"
          />
          <FilterChip
            label="Account"
            value={(view.filters as Record<string, string>).accountId}
            options={accountOptions}
            onChange={(v) => setFilter("accountId", v)}
            searchable
            testId="chip-account"
          />
          <FilterChip
            label="Mindestwert"
            value={(view.filters as Record<string, string>).minValue?.toString()}
            options={[
              { value: "10000",  label: "≥ 10 k" },
              { value: "50000",  label: "≥ 50 k" },
              { value: "100000", label: "≥ 100 k" },
              { value: "250000", label: "≥ 250 k" },
            ]}
            onChange={(v) => setFilter("minValue", v ? Number(v) : null)}
            testId="chip-minvalue"
          />
        </FilterChipsRow>
        <div className="flex items-center gap-2">
          <CSVExportButton
            filename={`deals-${new Date().toISOString().slice(0, 10)}.csv`}
            rows={filtered}
            columns={[
              { key: "id", label: "ID", value: (r) => r.id },
              { key: "name", label: "Deal", value: (r) => r.name },
              { key: "account", label: "Account", value: (r) => r.accountName },
              { key: "stage", label: "Stage", value: (r) => r.stage },
              { key: "value", label: "Wert", value: (r) => r.value },
              { key: "currency", label: "Währung", value: (r) => r.currency },
              { key: "owner", label: "Owner", value: (r) => r.ownerName },
              { key: "closeDate", label: "Close", value: (r) => r.expectedCloseDate?.slice(0, 10) ?? "" },
              { key: "probability", label: "Wahrsch.", value: (r) => r.probability },
              { key: "risk", label: "Risiko", value: (r) => r.riskLevel },
            ]}
            testId="deals-export"
          />
          <ColumnChooser defs={COLUMNS} visible={colVis.visible} onToggle={colVis.toggle} onReset={colVis.reset} />
        </div>
      </div>

      {filtered.length === 0 ? (
        deals && deals.length === 0 && !search ? (
          <EmptyStateCard
            icon={Briefcase}
            title="Noch keine Deals"
            body="Lege deinen ersten Deal an, um die Pipeline zu starten."
            primaryAction={{
              label: "Ersten Deal anlegen",
              onClick: () => setCreateOpen(true),
              testId: "deals-empty-create",
            }}
            testId="deals-empty"
          />
        ) : (
          <EmptyStateCard
            icon={Briefcase}
            title="Keine Treffer"
            body={search ? `Kein Deal entspricht „${search}".` : "Keine Deals entsprechen den aktuellen Filtern."}
            primaryAction={{
              label: "Filter zurücksetzen",
              onClick: () => { setView((s) => ({ ...s, filters: {} })); setSearch(""); },
            }}
            testId="deals-no-match"
          />
        )
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={isAllSelected()}
                    onCheckedChange={togglePageAll}
                    aria-label="Alle auf dieser Seite auswählen"
                  />
                </TableHead>
                {COLUMNS.filter((c) => colVis.visible.has(c.key)).map((c) => (
                  <TableHead key={c.key}>
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                    >
                      {c.label}
                      {view.sortBy === c.key && (view.sortDir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                    </button>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((deal) => (
                <DealRow
                  key={deal.id}
                  deal={deal}
                  visible={colVis.visible}
                  selected={selected.has(deal.id)}
                  onToggle={() => toggleOne(deal.id)}
                  stages={stageOptions}
                  onPatch={(p) => patchDeal(deal.id, p)}
                />
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

      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Select value="" onValueChange={(v) => void doBulkOwner(v)}>
          <SelectTrigger className="h-8 w-44" aria-label="Owner zuweisen" data-testid="bulk-owner-trigger">
            <span className="inline-flex items-center gap-1.5 text-xs">
              <UserCog className="h-3.5 w-3.5" /> Owner zuweisen
            </span>
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value="" onValueChange={(v) => void doBulkStage(v)}>
          <SelectTrigger className="h-8 w-44" aria-label="Stage ändern" data-testid="bulk-stage-trigger">
            <span className="inline-flex items-center gap-1.5 text-xs">
              <Workflow className="h-3.5 w-3.5" /> Stage ändern
            </span>
          </SelectTrigger>
          <SelectContent>
            {stageOptions.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </BulkActionBar>

      <DealFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

function DealRow({
  deal, visible, selected, onToggle, stages, onPatch,
}: {
  deal: Deal;
  visible: Set<string>;
  selected: boolean;
  onToggle: () => void;
  stages: { value: string; label: string }[];
  onPatch: (p: { name?: string; stage?: string; value?: number; expectedCloseDate?: string }) => Promise<void>;
}) {
  const stageLabel = stages.find((s) => s.value === deal.stage)?.label ?? deal.stage;
  return (
    <TableRow data-state={selected ? "selected" : undefined} className={selected ? "bg-muted/40" : undefined}>
      <TableCell>
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`${deal.name} auswählen`} />
      </TableCell>
      {visible.has("name") && (
        <TableCell className="font-medium">
          <Link href={`/deals/${deal.id}`} className="hover:underline" data-testid={`deal-link-${deal.id}`}>
            {deal.name}
          </Link>
        </TableCell>
      )}
      {visible.has("account") && (
        <TableCell>
          <Link href={`/accounts/${deal.accountId}`} className="hover:underline text-muted-foreground">
            {deal.accountName}
          </Link>
        </TableCell>
      )}
      {visible.has("stage") && (
        <TableCell>
          <InlineEditField
            ariaLabel="Stage"
            kind="select"
            options={stages}
            value={deal.stage}
            display={<Badge variant="outline">{stageLabel}</Badge>}
            onSubmit={(v) => onPatch({ stage: v })}
            testId={`inline-stage-${deal.id}`}
          />
        </TableCell>
      )}
      {visible.has("value") && (
        <TableCell className="tabular-nums">
          <InlineEditField
            ariaLabel="Wert"
            kind="currency"
            value={deal.value}
            display={`${deal.value.toLocaleString("de-DE")} ${deal.currency}`}
            onSubmit={(v) => onPatch({ value: Number(v) })}
            testId={`inline-value-${deal.id}`}
          />
        </TableCell>
      )}
      {visible.has("owner") && <TableCell className="text-muted-foreground">{deal.ownerName}</TableCell>}
      {visible.has("closeDate") && (
        <TableCell className="tabular-nums">
          <InlineEditField
            ariaLabel="Close-Datum"
            kind="date"
            value={deal.expectedCloseDate?.slice(0, 10) ?? ""}
            display={new Date(deal.expectedCloseDate).toLocaleDateString("de-DE")}
            onSubmit={(v) => onPatch({ expectedCloseDate: v })}
            testId={`inline-close-${deal.id}`}
          />
        </TableCell>
      )}
      {visible.has("probability") && <TableCell className="tabular-nums">{deal.probability}%</TableCell>}
      {visible.has("risk") && (
        <TableCell>
          <Badge variant={deal.riskLevel === "high" ? "destructive" : deal.riskLevel === "medium" ? "secondary" : "outline"}>
            {deal.riskLevel}
          </Badge>
        </TableCell>
      )}
    </TableRow>
  );
}

import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useListNegotiations,
  useListQuotes,
  useCreateNegotiation,
  getListNegotiationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardGridSkeleton } from "@/components/patterns/skeletons";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, AlertTriangle, RefreshCw, Check, Clock, Handshake, Search, FileText } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { NegotiationStatusBadge, RiskBadge } from "@/components/patterns/status-badges";
import { SavedViewTabs, type ViewState, type BuiltInView } from "@/components/patterns/saved-view-tabs";
import { FilterChip, FilterChipsRow } from "@/components/patterns/filter-chips";
import { PaginationBar } from "@/components/patterns/pagination-bar";

const DEFAULT_VIEW: ViewState = {
  filters: { status: "active" },
  columns: [],
  sortBy: "updatedAt",
  sortDir: "desc",
};

function StartFromQuoteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data: quotes, isLoading } = useListQuotes({}, { query: { enabled: open, queryKey: ["quotes-for-negotiation"] } });
  const { data: existing } = useListNegotiations({}, { query: { enabled: open, queryKey: ["negotiations-for-picker"] } });
  const create = useCreateNegotiation();
  const [search, setSearch] = useState("");
  const [pickedDealId, setPickedDealId] = useState<string | null>(null);

  const activeByDeal = useMemo(() => {
    const m = new Map<string, string>();
    (existing ?? []).forEach(n => { if (n.status === "active") m.set(n.dealId, n.id); });
    return m;
  }, [existing]);

  const eligible = useMemo(() => {
    const list = (quotes ?? []).filter(q => q.status === "draft" || q.status === "sent");
    const s = search.trim().toLowerCase();
    if (!s) return list;
    return list.filter(q => q.dealName.toLowerCase().includes(s) || q.number.toLowerCase().includes(s));
  }, [quotes, search]);

  async function go() {
    if (!pickedDealId) return;
    const existingId = activeByDeal.get(pickedDealId);
    if (existingId) {
      onOpenChange(false);
      navigate(`/negotiations/${existingId}`);
      return;
    }
    try {
      const n = await create.mutateAsync({ data: { dealId: pickedDealId } });
      await qc.invalidateQueries({ queryKey: getListNegotiationsQueryKey() });
      toast({ description: t("pages.negotiations.startedToast") });
      onOpenChange(false);
      navigate(`/negotiations/${n.id}`);
    } catch (e) {
      toast({ title: t("common.error"), description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("pages.negotiations.startDialog.title")}</DialogTitle>
          <DialogDescription>{t("pages.negotiations.startDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("pages.negotiations.startDialog.searchPlaceholder")}
              className="h-9 pl-8 text-sm"
              data-testid="quote-picker-search"
            />
          </div>
          <div className="max-h-[360px] overflow-y-auto border rounded-md divide-y">
            {isLoading ? (
              <div className="text-sm text-muted-foreground p-4">{t("common.loading")}</div>
            ) : eligible.length === 0 ? (
              <div className="text-sm text-muted-foreground p-4 text-center">
                {t("pages.negotiations.startDialog.noQuotes")}
              </div>
            ) : (
              eligible.map(q => {
                const hasActive = activeByDeal.has(q.dealId);
                const isPicked = pickedDealId === q.dealId;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setPickedDealId(q.dealId)}
                    className={`w-full text-left p-3 hover:bg-muted/40 transition-colors flex items-center gap-3 ${isPicked ? "bg-muted/60" : ""}`}
                    data-testid={`quote-picker-row-${q.id}`}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{q.dealName}</div>
                      <div className="text-xs text-muted-foreground">{q.number} · {q.totalAmount.toLocaleString("de-DE")} {q.currency}</div>
                    </div>
                    <Badge variant="outline" className="text-[11px]">{q.status}</Badge>
                    {hasActive && (
                      <Badge variant="secondary" className="text-[11px]">
                        <Handshake className="h-3 w-3 mr-1" />
                        {t("pages.negotiations.startDialog.alreadyActive")}
                      </Badge>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={go}
            disabled={!pickedDealId || create.isPending}
            data-testid="quote-picker-confirm"
          >
            {pickedDealId && activeByDeal.has(pickedDealId)
              ? t("pages.negotiations.startDialog.openExisting")
              : t("pages.negotiations.startDialog.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Negotiations() {
  const { t } = useTranslation();
  const [startOpen, setStartOpen] = useState(false);

  const builtIns: BuiltInView[] = useMemo(() => [
    { id: "active",    name: t("pages.negotiations.tabActive"),    isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { status: "active" } } },
    { id: "concluded", name: t("pages.negotiations.tabConcluded"), isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { status: "concluded" } } },
    { id: "highRisk",  name: t("pages.negotiations.viewHighRisk"), isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { riskLevel: "high" } } },
    { id: "all",       name: t("pages.negotiations.tabAll"),       isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: {} } },
  ], [t]);

  const [activeViewId, setActiveViewId] = useState<string>("active");
  const [view, setView] = useState<ViewState>(builtIns[0].state);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);

  useEffect(() => { setPage(1); }, [view.filters, view.sortBy, view.sortDir, search]);

  const { data: negotiations, isLoading } = useListNegotiations({});

  const filtered = useMemo(() => {
    const f = view.filters as Record<string, unknown>;
    let rows = (negotiations ?? []).slice();
    if (f.status) rows = rows.filter((n) => n.status === f.status);
    if (f.riskLevel) rows = rows.filter((n) => n.riskLevel === f.riskLevel);
    if (f.lastReactionType) rows = rows.filter((n) => n.lastReactionType === f.lastReactionType);
    const s = search.trim().toLowerCase();
    if (s) rows = rows.filter((n) => n.dealName.toLowerCase().includes(s));
    const sortBy = view.sortBy ?? "updatedAt";
    const dir = view.sortDir === "asc" ? 1 : -1;
    const riskRank: Record<string, number> = { low: 0, medium: 1, high: 2 };
    rows = [...rows].sort((a, b) => {
      let av: number; let bv: number;
      if (sortBy === "riskLevel") {
        av = riskRank[a.riskLevel] ?? 0; bv = riskRank[b.riskLevel] ?? 0;
      } else if (sortBy === "round") {
        av = a.round ?? 0; bv = b.round ?? 0;
      } else {
        av = new Date(a.updatedAt).getTime(); bv = new Date(b.updatedAt).getTime();
      }
      return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
    });
    return rows;
  }, [negotiations, view, search]);

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
  function setSort(token: string | null) {
    if (!token) { setView((s) => ({ ...s, sortBy: "updatedAt", sortDir: "desc" })); return; }
    const [by, dir] = token.split(":");
    setView((s) => ({ ...s, sortBy: by, sortDir: (dir === "asc" ? "asc" : "desc") }));
  }
  const currentSortToken = `${view.sortBy ?? "updatedAt"}:${view.sortDir ?? "desc"}`;

  const hasFilters = Object.keys(view.filters ?? {}).length > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        icon={Handshake}
        title={t("pages.negotiations.title")}
        subtitle={t("pages.negotiations.subtitle")}
        actions={
          <Button onClick={() => setStartOpen(true)} data-testid="negotiations-start-from-quote">
            <Handshake className="h-4 w-4 mr-2" />
            {t("pages.negotiations.startFromQuote")}
          </Button>
        }
      />
      <StartFromQuoteDialog open={startOpen} onOpenChange={setStartOpen} />

      <SavedViewTabs
        entityType="negotiation"
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
              data-testid="negotiations-search"
            />
          </div>
        }
      >
        <FilterChip
          label={t("common.status")}
          value={(view.filters as Record<string, string>).status}
          options={[
            { value: "active",    label: t("pages.negotiations.tabActive") },
            { value: "concluded", label: t("pages.negotiations.tabConcluded") },
          ]}
          onChange={(v) => setFilter("status", v)}
          testId="chip-negotiations-status"
        />
        <FilterChip
          label={t("common.risk")}
          value={(view.filters as Record<string, string>).riskLevel}
          options={[
            { value: "low",      label: t("common.riskLow") },
            { value: "medium",   label: t("common.riskMedium") },
            { value: "high",     label: t("common.riskHigh") },
          ]}
          onChange={(v) => setFilter("riskLevel", v)}
          testId="chip-negotiations-risk"
        />
        <FilterChip
          label={t("pages.negotiations.lastReaction")}
          value={(view.filters as Record<string, string>).lastReactionType}
          options={[
            { value: "objection",       label: t("pages.negotiations.reaction.objection") },
            { value: "counterproposal", label: t("pages.negotiations.reaction.counterproposal") },
            { value: "acceptance",      label: t("pages.negotiations.reaction.acceptance") },
          ]}
          onChange={(v) => setFilter("lastReactionType", v)}
          testId="chip-negotiations-reaction"
        />
        <FilterChip
          label={t("pages.negotiations.sort.label")}
          value={currentSortToken === "updatedAt:desc" ? null : currentSortToken}
          options={[
            { value: "updatedAt:desc",  label: t("pages.negotiations.sort.updatedDesc") },
            { value: "updatedAt:asc",   label: t("pages.negotiations.sort.updatedAsc") },
            { value: "riskLevel:desc",  label: t("pages.negotiations.sort.riskDesc") },
            { value: "round:desc",      label: t("pages.negotiations.sort.roundDesc") },
          ]}
          onChange={setSort}
          testId="chip-negotiations-sort"
        />
      </FilterChipsRow>

      {isLoading ? (
        <CardGridSkeleton items={6} />
      ) : total === 0 ? (
        negotiations && negotiations.length === 0 && !search && !hasFilters ? (
          <EmptyStateCard
            icon={Handshake}
            title={t("pages.negotiations.emptyTitle")}
            body={t("pages.negotiations.emptyBody")}
            hint={t("pages.negotiations.emptyHint")}
            primaryAction={{
              label: t("pages.negotiations.startFromQuote"),
              onClick: () => setStartOpen(true),
              testId: "negotiations-empty-cta",
            }}
          />
        ) : (
          <EmptyStateCard
            icon={Handshake}
            title={t("common.noMatches")}
            body={t("common.noMatchesBody")}
            primaryAction={{
              label: t("common.resetFilters"),
              onClick: () => { setView((s) => ({ ...s, filters: {} })); setSearch(""); },
            }}
            testId="negotiations-no-match"
          />
        )
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pageRows.map((neg) => {
              let Icon = MessageSquare;
              let iconColor = "text-blue-500";
              if (neg.lastReactionType === "objection") { Icon = AlertTriangle; iconColor = "text-orange-500"; }
              else if (neg.lastReactionType === "counterproposal") { Icon = RefreshCw; iconColor = "text-purple-500"; }
              else if (neg.lastReactionType === "acceptance") { Icon = Check; iconColor = "text-green-500"; }

              return (
                <Card key={neg.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start gap-2">
                      <CardTitle className="text-lg">
                        <Link href={`/negotiations/${neg.id}`} className="hover:underline">
                          {neg.dealName}
                        </Link>
                      </CardTitle>
                      <NegotiationStatusBadge status={neg.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col gap-4">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{t("pages.negotiations.round", { n: neg.round })}</Badge>
                      <RiskBadge risk={neg.riskLevel} />
                    </div>

                    <div className="mt-auto pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-4 w-4 ${iconColor}`} />
                        <span className="capitalize">{neg.lastReactionType}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{formatDistanceToNow(new Date(neg.updatedAt), { locale: de, addSuffix: true })}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <div className="border rounded-md">
            <PaginationBar
              total={total}
              page={page}
              pageSize={pageSize}
              pageSizes={[12, 24, 48]}
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            />
          </div>
        </>
      )}
    </div>
  );
}

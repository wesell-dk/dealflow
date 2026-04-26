import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListQuotes } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, ExternalLink, FileText, Search, ArrowDown, ArrowUp } from "lucide-react";
import { QuoteWizard } from "@/components/quote-wizard";
import { QuoteDuplicateButton } from "@/components/quotes/quote-duplicate-button";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { QuoteStatusBadge } from "@/components/patterns/status-badges";
import { SavedViewTabs, type ViewState, type BuiltInView } from "@/components/patterns/saved-view-tabs";
import { FilterChip, FilterChipsRow } from "@/components/patterns/filter-chips";
import { PaginationBar } from "@/components/patterns/pagination-bar";

const DEFAULT_VIEW: ViewState = {
  filters: {},
  columns: [],
  sortBy: "validUntil",
  sortDir: "asc",
};

export default function Quotes() {
  const { t } = useTranslation();
  const { data: quotes, isLoading } = useListQuotes();
  const [wizardOpen, setWizardOpen] = useState(false);

  const builtIns: BuiltInView[] = useMemo(() => [
    { id: "all",      name: t("pages.quotes.viewAll"),      isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: {} } },
    { id: "open",     name: t("pages.quotes.viewOpen"),     isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { status: "sent" } } },
    { id: "draft",    name: t("pages.quotes.viewDraft"),    isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { status: "draft" } } },
    { id: "accepted", name: t("pages.quotes.viewAccepted"), isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: { status: "accepted" }, sortBy: "validUntil", sortDir: "desc" } },
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
    let rows = (quotes ?? []).slice();
    if (f.status) rows = rows.filter((q) => q.status === f.status);
    if (f.minDiscount) rows = rows.filter((q) => q.discountPct >= Number(f.minDiscount));
    const s = search.trim().toLowerCase();
    if (s) rows = rows.filter((q) => q.number.toLowerCase().includes(s) || q.dealName.toLowerCase().includes(s));
    const sortBy = view.sortBy ?? "validUntil";
    const dir = view.sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const get = (r: typeof a) => {
        if (sortBy === "totalAmount")  return r.totalAmount;
        if (sortBy === "discountPct")  return r.discountPct;
        if (sortBy === "validUntil")   return r.validUntil ? new Date(r.validUntil).getTime() : 0;
        if (sortBy === "number")       return r.number.toLowerCase();
        return r.status;
      };
      const av = get(a), bv = get(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "de") * dir;
    });
    return rows;
  }, [quotes, view, search]);

  const total = filtered.length;
  const pageRows = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

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
        icon={FileText}
        title={t("pages.quotes.title")}
        subtitle={t("pages.quotes.subtitle")}
        actions={
          <Button onClick={() => setWizardOpen(true)} data-testid="quotes-new-button">
            <Plus className="h-4 w-4 mr-1" />
            {t("pages.quotes.newQuote")}
          </Button>
        }
      />

      <SavedViewTabs
        entityType="quote"
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
              data-testid="quotes-search"
            />
          </div>
        }
      >
        <FilterChip
          label={t("common.status")}
          value={(view.filters as Record<string, string>).status}
          options={[
            { value: "draft",     label: t("pages.quotes.statusDraft") },
            { value: "sent",      label: t("pages.quotes.statusSent") },
            { value: "accepted",  label: t("pages.quotes.statusAccepted") },
            { value: "rejected",  label: t("pages.quotes.statusRejected") },
            { value: "expired",   label: t("pages.quotes.statusExpired") },
          ]}
          onChange={(v) => setFilter("status", v)}
          testId="chip-quotes-status"
        />
        <FilterChip
          label={t("pages.quotes.discount")}
          value={(view.filters as Record<string, string>).minDiscount?.toString()}
          options={[
            { value: "5",  label: "≥ 5 %" },
            { value: "10", label: "≥ 10 %" },
            { value: "20", label: "≥ 20 %" },
            { value: "30", label: "≥ 30 %" },
          ]}
          onChange={(v) => setFilter("minDiscount", v ? Number(v) : null)}
          testId="chip-quotes-discount"
        />
      </FilterChipsRow>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : total === 0 ? (
        quotes && quotes.length === 0 && !search && !hasFilters ? (
          <EmptyStateCard
            icon={FileText}
            title={t("pages.quotes.emptyTitle")}
            body={t("pages.quotes.emptyBody")}
            primaryAction={{
              label: t("pages.quotes.newQuote"),
              onClick: () => setWizardOpen(true),
              testId: "quotes-empty-create",
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
            testId="quotes-no-match"
          />
        )
      ) : (
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{sortableHeader("number", t("common.number"))}</TableHead>
                <TableHead>{t("common.deal")}</TableHead>
                <TableHead>{sortableHeader("totalAmount", t("common.total"))}</TableHead>
                <TableHead>{sortableHeader("discountPct", t("common.discount"))}</TableHead>
                <TableHead>{sortableHeader("status", t("common.status"))}</TableHead>
                <TableHead>{sortableHeader("validUntil", t("common.validUntil"))}</TableHead>
                <TableHead className="w-12 text-right">&nbsp;</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((quote) => (
                <TableRow key={quote.id} data-testid={`quote-row-${quote.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/quotes/${quote.id}`} className="hover:underline">{quote.number}</Link>
                  </TableCell>
                  <TableCell>{quote.dealName}</TableCell>
                  <TableCell className="tabular-nums">{quote.totalAmount.toLocaleString()} {quote.currency}</TableCell>
                  <TableCell className="tabular-nums">{quote.discountPct}%</TableCell>
                  <TableCell><QuoteStatusBadge status={quote.status} /></TableCell>
                  <TableCell className="tabular-nums">{new Date(quote.validUntil).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`quote-menu-${quote.id}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/quotes/${quote.id}`} data-testid={`quote-open-${quote.id}`}>
                            <ExternalLink className="h-4 w-4 mr-2" />
                            {t("common.open")}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, "_blank")}
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          {t("pages.quote.openPdf")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                          <div className="px-1.5 py-0.5">
                            <QuoteDuplicateButton
                              quoteId={quote.id}
                              quoteNumber={quote.number}
                              variant="ghost"
                              size="sm"
                            />
                          </div>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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

      <QuoteWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}

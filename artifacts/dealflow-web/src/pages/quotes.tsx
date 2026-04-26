import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListQuotes, usePatchQuote, getListQuotesQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, MoreHorizontal, ExternalLink, FileText, Search, ArrowDown, ArrowUp,
  Archive, ArchiveRestore, ChevronDown, FilePlus, Wand2,
} from "lucide-react";
import { useLocation } from "wouter";
import { QuoteWizard } from "@/components/quote-wizard";
import { QuoteDuplicateButton } from "@/components/quotes/quote-duplicate-button";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { QuoteStatusBadge } from "@/components/patterns/status-badges";
import { SavedViewTabs, type ViewState, type BuiltInView } from "@/components/patterns/saved-view-tabs";
import { FilterChip, FilterChipsRow } from "@/components/patterns/filter-chips";
import { PaginationBar } from "@/components/patterns/pagination-bar";
import { BulkActionBar } from "@/components/patterns/bulk-action-bar";
import { useToast } from "@/hooks/use-toast";

const DEFAULT_VIEW: ViewState = {
  filters: {},
  columns: [],
  sortBy: "validUntil",
  sortDir: "asc",
};

type ArchivedTab = "active" | "archived";

export default function Quotes() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const patchQuote = usePatchQuote();
  const [wizardOpen, setWizardOpen] = useState(false);
  // Aktiv vs. archiviert wird auf API-Ebene gefiltert (`archived` query param);
  // intern halten wir nur einen Tab-State und übergeben ihn an useListQuotes.
  const [archivedTab, setArchivedTab] = useState<ArchivedTab>("active");
  const { data: quotes, isLoading } = useListQuotes(
    archivedTab === "archived" ? { archived: "archived" } : { archived: "active" },
  );

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

  // Bulk-Selektion mit Status-Set, damit wir client-seitig wissen, welche
  // Items wirklich „expirable"/„rejectable" sind (Server lässt nur draft/sent
  // → expired/rejected zu, alles andere → 409). Toast-Zähler kommen aus
  // Promise.allSettled, damit Teil-Erfolge sauber sichtbar sind.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);

  useEffect(() => { setPage(1); }, [view.filters, view.sortBy, view.sortDir, search, archivedTab]);
  useEffect(() => { setSelected(new Set()); }, [activeViewId, archivedTab]);

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
    // Status-Filter prüft den Anzeige-Status (inkl. abgeleitetem 'expired'),
    // damit Filter und Badge übereinstimmen.
    if (f.status) {
      rows = rows.filter(
        (q) => ((q as { displayStatus?: string }).displayStatus ?? q.status) === f.status,
      );
    }
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

  // Welche Items in der aktuellen Seite sind „bulkable"?
  // - Status setzen (expire/reject): nur draft/sent
  // - Archivieren: alle aktiven Items (egal welcher Status)
  // - Wiederherstellen: alle archivierten Items
  const STATUS_TRANSITIONABLE = new Set(["draft", "sent"]);
  function isStatusTransitionable(status: string) {
    return STATUS_TRANSITIONABLE.has(status);
  }

  const quoteById = useMemo(() => new Map((quotes ?? []).map((q) => [q.id, q])), [quotes]);
  const transitionableSelectedIds = useMemo(
    () => [...selected].filter((id) => isStatusTransitionable(String(quoteById.get(id)?.status ?? ""))),
    [selected, quoteById],
  );

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

  function invalidateQuotes() {
    qc.invalidateQueries({ queryKey: getListQuotesQueryKey() });
  }

  async function runBulkSetStatus(status: "expired" | "rejected") {
    if (transitionableSelectedIds.length === 0) return;
    setBulkRunning(true);
    try {
      const results = await Promise.allSettled(
        transitionableSelectedIds.map((id) => patchQuote.mutateAsync({ id, data: { status } })),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - ok;
      const skipped = selected.size - transitionableSelectedIds.length;
      toast({
        title: status === "expired"
          ? t("pages.quotes.bulkExpireDone")
          : t("pages.quotes.bulkRejectDone"),
        description: t("pages.quotes.bulkResult", { ok, fail, skipped }),
        variant: fail > 0 && ok === 0 ? "destructive" : undefined,
      });
      setSelected(new Set());
      invalidateQuotes();
    } finally {
      setBulkRunning(false);
      setBulkStatusOpen(false);
    }
  }

  async function runBulkArchive(archived: boolean) {
    if (selected.size === 0) return;
    setBulkRunning(true);
    try {
      const ids = [...selected];
      const results = await Promise.allSettled(
        ids.map((id) => patchQuote.mutateAsync({ id, data: { archived } })),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - ok;
      toast({
        title: archived
          ? t("pages.quotes.bulkArchiveDone")
          : t("pages.quotes.bulkUnarchiveDone"),
        description: t("pages.quotes.bulkResult", { ok, fail, skipped: 0 }),
        variant: fail > 0 && ok === 0 ? "destructive" : undefined,
      });
      setSelected(new Set());
      invalidateQuotes();
    } finally {
      setBulkRunning(false);
      setBulkArchiveOpen(false);
    }
  }

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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="quotes-new-button">
                <Plus className="h-4 w-4 mr-1" />
                {t("pages.quotes.newQuote")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuItem
                onClick={() => navigate("/quotes/new")}
                data-testid="quotes-new-inline"
              >
                <FilePlus className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span className="font-medium">{t("quoteEditor.newInline")}</span>
                  <span className="text-xs text-muted-foreground">{t("quoteEditor.newInlineDesc")}</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setWizardOpen(true)}
                data-testid="quotes-new-wizard"
              >
                <Wand2 className="mr-2 h-4 w-4" />
                <div className="flex flex-col">
                  <span className="font-medium">{t("quoteEditor.newWizard")}</span>
                  <span className="text-xs text-muted-foreground">{t("quoteEditor.newWizardDesc")}</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="flex items-center gap-2 border-b">
        <button
          type="button"
          className={`px-3 py-1.5 text-sm border-b-2 transition-colors ${
            archivedTab === "active"
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setArchivedTab("active")}
          data-testid="quotes-tab-active"
        >
          {t("pages.quotes.tabActive")}
        </button>
        <button
          type="button"
          className={`px-3 py-1.5 text-sm border-b-2 transition-colors ${
            archivedTab === "archived"
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          onClick={() => setArchivedTab("archived")}
          data-testid="quotes-tab-archived"
        >
          {t("pages.quotes.tabArchived")}
        </button>
      </div>

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
                <TableHead className="w-10">
                  <Checkbox
                    checked={isAllSelected()}
                    onCheckedChange={togglePageAll}
                    aria-label={t("common.bulk.selectAllOnPage")}
                    data-testid="quotes-select-all"
                  />
                </TableHead>
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
                  <TableCell>
                    <Checkbox
                      checked={selected.has(quote.id)}
                      onCheckedChange={() => toggleOne(quote.id)}
                      aria-label={t("common.bulk.selectRow", { name: quote.number })}
                      data-testid={`quote-select-${quote.id}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link href={`/quotes/${quote.id}`} className="hover:underline">{quote.number}</Link>
                  </TableCell>
                  <TableCell>{quote.dealName}</TableCell>
                  <TableCell className="tabular-nums">{quote.totalAmount.toLocaleString()} {quote.currency}</TableCell>
                  <TableCell className="tabular-nums">{quote.discountPct}%</TableCell>
                  <TableCell><QuoteStatusBadge status={(quote as { displayStatus?: string }).displayStatus ?? quote.status} /></TableCell>
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

      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
        {archivedTab === "active" ? (
          <>
            <DropdownMenu open={bulkStatusOpen} onOpenChange={setBulkStatusOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1"
                  disabled={transitionableSelectedIds.length === 0 || bulkRunning}
                  data-testid="quotes-bulk-status-trigger"
                  aria-label={t("pages.quotes.bulkSetStatus")}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  {t("pages.quotes.bulkSetStatus")} ({transitionableSelectedIds.length})
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => void runBulkSetStatus("expired")}
                  data-testid="quotes-bulk-status-expired"
                >
                  {t("pages.quotes.bulkExpire")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void runBulkSetStatus("rejected")}
                  data-testid="quotes-bulk-status-rejected"
                >
                  {t("pages.quotes.bulkReject")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1"
              onClick={() => setBulkArchiveOpen(true)}
              disabled={bulkRunning}
              data-testid="quotes-bulk-archive"
            >
              <Archive className="h-3.5 w-3.5" />
              {t("pages.quotes.bulkArchive")}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1"
            onClick={() => void runBulkArchive(false)}
            disabled={bulkRunning}
            data-testid="quotes-bulk-unarchive"
          >
            <ArchiveRestore className="h-3.5 w-3.5" />
            {t("pages.quotes.bulkUnarchive")}
          </Button>
        )}
      </BulkActionBar>

      <AlertDialog open={bulkArchiveOpen} onOpenChange={setBulkArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.quotes.bulkArchiveDialogTitle", { count: selected.size })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.quotes.bulkArchiveDialogBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void runBulkArchive(true); }}
              data-testid="quotes-bulk-archive-confirm"
            >
              {t("pages.quotes.bulkArchive")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <QuoteWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}

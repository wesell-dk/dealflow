import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAccounts,
  useUpdateAccount,
  useCreateAccount,
  useListUsers,
  useBulkUpdateAccountOwner,
  useBulkDeleteAccounts,
  getListAccountsQueryKey,
  type Account,
  type AccountInput,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Building, Plus, ArrowUp, ArrowDown, Trash2, UserCog, AlertTriangle } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AccountFormDialog } from "@/components/accounts/account-form-dialog";
import { SavedViewTabs, type ViewState, type BuiltInView } from "@/components/patterns/saved-view-tabs";
import { FilterChip, FilterChipsRow } from "@/components/patterns/filter-chips";
import { BulkActionBar } from "@/components/patterns/bulk-action-bar";
import { ColumnChooser, useColumnVisibility, type ColumnDef } from "@/components/patterns/column-chooser";
import { PaginationBar } from "@/components/patterns/pagination-bar";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { CSVExportButton } from "@/components/patterns/csv-export-button";
import { CSVImportDialog } from "@/components/patterns/csv-import-dialog";
import { InlineEditField } from "@/components/patterns/inline-edit-field";
import { useToast } from "@/hooks/use-toast";

const COLUMNS: ColumnDef[] = [
  { key: "name",        label: "Name",       required: true },
  { key: "industry",    label: "Branche" },
  { key: "country",     label: "Land" },
  { key: "owner",       label: "Owner" },
  { key: "healthScore", label: "Health" },
  { key: "openDeals",   label: "Offene Deals" },
  { key: "totalValue",  label: "Volumen" },
];

const DEFAULT_VIEW: ViewState = {
  filters: {},
  columns: ["name", "industry", "country", "owner", "healthScore", "openDeals", "totalValue"],
  sortBy: "name",
  sortDir: "asc",
};

export default function Accounts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: accounts, isLoading } = useListAccounts();
  const { data: users = [] } = useListUsers();
  const updateAccount = useUpdateAccount();
  const createAccount = useCreateAccount();
  const bulkOwner = useBulkUpdateAccountOwner();
  const bulkDelete = useBulkDeleteAccounts();
  const [createOpen, setCreateOpen] = useState(false);

  const builtIns: BuiltInView[] = useMemo(() => [
    { id: "all", name: "Alle Accounts", isBuiltIn: true, state: { ...DEFAULT_VIEW, filters: {} } },
    {
      id: "mine",
      name: "Meine Accounts",
      isBuiltIn: true,
      state: { ...DEFAULT_VIEW, filters: { ownerId: user?.id ?? "" } },
    },
    {
      id: "active",
      name: "Mit offenen Deals",
      isBuiltIn: true,
      state: { ...DEFAULT_VIEW, filters: { hasDeals: true } },
    },
    {
      id: "atrisk",
      name: "Risiko (Health < 60)",
      isBuiltIn: true,
      state: { ...DEFAULT_VIEW, filters: { riskOnly: true } },
    },
  ], [user?.id]);

  const [activeViewId, setActiveViewId] = useState<string>("all");
  const [view, setView] = useState<ViewState>(builtIns[0].state);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOwnerOpen, setBulkOwnerOpen] = useState(false);

  const colVis = useColumnVisibility("dealflow.accounts.cols.v1", COLUMNS);

  // Reset selection on data refresh / view change
  useEffect(() => { setSelected(new Set()); }, [activeViewId]);
  useEffect(() => { setPage(1); }, [view.filters, view.sortBy, view.sortDir]);

  // Mirror visible columns into the current view (so saving a view captures them).
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

  // Filter / sort client-side
  const filtered = useMemo(() => {
    if (!accounts) return [];
    const f = view.filters as Record<string, unknown>;
    let rows = accounts.filter((a) => {
      if (f.industry && a.industry !== f.industry) return false;
      if (f.country && a.country !== f.country) return false;
      if (f.ownerId && a.ownerId !== f.ownerId) return false;
      if (f.hasDeals && !(a.openDeals > 0)) return false;
      if (f.riskOnly && !(a.healthScore < 60)) return false;
      return true;
    });
    const sortBy = view.sortBy ?? "name";
    const dir = view.sortDir === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortBy];
      const bv = (b as unknown as Record<string, unknown>)[sortBy];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av ?? "").localeCompare(String(bv ?? ""), "de") * dir;
    });
    return rows;
  }, [accounts, view]);

  const total = filtered.length;
  const pageRows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  const industries = useMemo(() => Array.from(new Set((accounts ?? []).map((a) => a.industry))).sort(), [accounts]);
  const countries = useMemo(() => Array.from(new Set((accounts ?? []).map((a) => a.country))).sort(), [accounts]);
  const userOptions = users.map((u) => ({ value: u.id, label: u.name }));

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
      return { ...s, sortBy: key, sortDir: "asc" };
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

  async function patchAccount(id: string, patch: Parameters<typeof updateAccount.mutateAsync>[0]["data"]) {
    try {
      await updateAccount.mutateAsync({ id, data: patch });
      await qc.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      toast({ title: "Gespeichert" });
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "", variant: "destructive" });
      throw e;
    }
  }

  async function doBulkOwner(ownerId: string) {
    try {
      const res = await bulkOwner.mutateAsync({ data: { ids: [...selected], ownerId } });
      await qc.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      toast({ title: "Owner aktualisiert", description: `${res.updated} geändert, ${res.skipped} übersprungen.` });
      setSelected(new Set());
      setBulkOwnerOpen(false);
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  // Lösch-Dialog: zwei Stufen.
  // 1) Bestätigung mit optionalem Cascade-Toggle.
  // 2) Wenn der erste Versuch ohne Cascade an verknüpften Daten scheitert,
  //    zeigen wir die konkreten Zähler und bieten "Mit allem löschen" an —
  //    statt eines kryptischen "übersprungen"-Toasts.
  type BlockedRefs = { deals: number; contacts: number; contracts: number; letters: number; renewals: number; obligations: number; externalContracts: number };
  const [deleteDialog, setDeleteDialog] = useState<
    | { stage: "confirm"; ids: string[]; cascade: boolean }
    | { stage: "blocked"; ids: string[]; references: Record<string, BlockedRefs>; deletedCount: number }
    | null
  >(null);

  function openBulkDelete() {
    if (selected.size === 0) return;
    setDeleteDialog({ stage: "confirm", ids: [...selected], cascade: false });
  }

  async function runBulkDelete(ids: string[], cascade: boolean) {
    try {
      const res = await bulkDelete.mutateAsync({ data: { ids, cascade } });
      await qc.invalidateQueries({ queryKey: getListAccountsQueryKey() });
      const blockedIds = (res.skippedIds ?? []).filter(
        id => res.skippedReasons?.[id] === "has_references",
      );
      if (!cascade && blockedIds.length > 0) {
        // Stufe 2: Nutzer entscheidet über Cascade.
        setDeleteDialog({
          stage: "blocked",
          ids: blockedIds,
          references: (res.references ?? {}) as Record<string, BlockedRefs>,
          deletedCount: res.updated,
        });
        return;
      }
      const noPermission = (res.skippedIds ?? []).filter(
        id => res.skippedReasons?.[id] === "no_permission",
      ).length;
      const desc = noPermission > 0
        ? `${res.updated} entfernt, ${noPermission} ohne Berechtigung übersprungen.`
        : `${res.updated} entfernt.`;
      toast({ title: "Gelöscht", description: desc });
      setSelected(new Set());
      setDeleteDialog(null);
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  }

  function nameOf(id: string): string {
    return (accounts ?? []).find((r: Account) => r.id === id)?.name ?? id;
  }

  function describeRefs(r: BlockedRefs): string {
    const parts: string[] = [];
    if (r.deals) parts.push(`${r.deals} Deal${r.deals === 1 ? "" : "s"}`);
    if (r.contacts) parts.push(`${r.contacts} Kontakt${r.contacts === 1 ? "" : "e"}`);
    if (r.contracts) parts.push(`${r.contracts} Vertrag${r.contracts === 1 ? "" : "/Verträge"}`);
    if (r.letters) parts.push(`${r.letters} Preisanpassungs-Schreiben`);
    if (r.renewals) parts.push(`${r.renewals} Verlängerung${r.renewals === 1 ? "" : "en"}`);
    if (r.obligations) parts.push(`${r.obligations} Verpflichtung${r.obligations === 1 ? "" : "en"}`);
    if (r.externalContracts) parts.push(`${r.externalContracts} externe Verträge`);
    return parts.join(", ");
  }

  const hasFilters = Object.keys(view.filters ?? {}).length > 0;

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
          <p className="text-muted-foreground mt-1">Kunden, Verteilung und Pipeline-Anteil pro Account.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="accounts-new-button">
          <Plus className="h-4 w-4 mr-1" /> Kunde anlegen
        </Button>
      </div>

      <SavedViewTabs
        entityType="account"
        builtIns={builtIns}
        activeViewId={activeViewId}
        currentState={view}
        onSelect={selectView}
      />

      <div className="flex items-center justify-between gap-2">
        <FilterChipsRow
          hasActive={hasFilters}
          onClearAll={() => setView((s) => ({ ...s, filters: {} }))}
        >
          <FilterChip
            label="Branche"
            value={(view.filters as Record<string, string>).industry as string | undefined}
            options={industries.map((v) => ({ value: v, label: v }))}
            onChange={(v) => setFilter("industry", v)}
            searchable
            testId="chip-industry"
          />
          <FilterChip
            label="Land"
            value={(view.filters as Record<string, string>).country as string | undefined}
            options={countries.map((v) => ({ value: v, label: v }))}
            onChange={(v) => setFilter("country", v)}
            searchable
            testId="chip-country"
          />
          <FilterChip
            label="Owner"
            value={(view.filters as Record<string, string>).ownerId as string | undefined}
            options={userOptions}
            onChange={(v) => setFilter("ownerId", v)}
            searchable
            testId="chip-owner"
          />
          <FilterChip
            label="Mit Deals"
            value={(view.filters as Record<string, unknown>).hasDeals ? "yes" : undefined}
            options={[{ value: "yes", label: "Nur mit offenen Deals" }]}
            onChange={(v) => setFilter("hasDeals", v === "yes" ? true : null)}
            testId="chip-hasdeals"
          />
        </FilterChipsRow>
        <div className="flex items-center gap-2">
          <CSVExportButton
            filename={`accounts-${new Date().toISOString().slice(0, 10)}.csv`}
            rows={filtered}
            columns={[
              { key: "id", label: "ID", value: (r) => r.id },
              { key: "name", label: "Name", value: (r) => r.name },
              { key: "industry", label: "Branche", value: (r) => r.industry },
              { key: "country", label: "Land", value: (r) => r.country },
              { key: "owner", label: "OwnerId", value: (r) => r.ownerId ?? "" },
              { key: "health", label: "Health", value: (r) => r.healthScore },
              { key: "openDeals", label: "Offene Deals", value: (r) => r.openDeals },
              { key: "totalValue", label: "Volumen", value: (r) => r.totalValue },
            ]}
            testId="accounts-export"
          />
          <CSVImportDialog
            triggerLabel="Import"
            title="Accounts aus CSV importieren"
            fields={[
              { key: "name", label: "Name", required: true },
              { key: "industry", label: "Branche", required: true },
              { key: "country", label: "Land", required: true },
            ]}
            templateExample={[
              { name: "Helix Logistics GmbH", industry: "Logistik", country: "DE" },
              { name: "Nova Retail AG", industry: "Handel", country: "CH" },
            ]}
            templateFilename="accounts-vorlage.csv"
            buildRow={(m): AccountInput | null => {
              if (!m.name?.trim()) return null;
              return {
                name: m.name.trim(),
                industry: (m.industry || "Sonstiges").trim(),
                country: (m.country || "DE").trim(),
              };
            }}
            onImport={async (row) => {
              await createAccount.mutateAsync({ data: row });
            }}
            testId="accounts-import"
          />
          <ColumnChooser defs={COLUMNS} visible={colVis.visible} onToggle={colVis.toggle} onReset={colVis.reset} />
        </div>
      </div>

      {filtered.length === 0 ? (
        accounts && accounts.length === 0 ? (
          <EmptyStateCard
            icon={Building}
            title="Noch keine Kunden"
            body="Lege deinen ersten Account an, um Kontakte und Deals zu verknüpfen."
            primaryAction={{
              label: "Ersten Kunden anlegen",
              onClick: () => setCreateOpen(true),
              testId: "accounts-empty-create",
            }}
            secondaryAction={{
              label: "Per CSV importieren",
              onClick: () => document.querySelector<HTMLButtonElement>('[data-testid="accounts-import"]')?.click(),
            }}
            testId="accounts-empty"
          />
        ) : (
          <EmptyStateCard
            icon={Building}
            title="Keine Treffer"
            body="Keine Accounts entsprechen den aktuellen Filtern."
            primaryAction={{
              label: "Filter zurücksetzen",
              onClick: () => setView((s) => ({ ...s, filters: {} })),
            }}
            testId="accounts-no-match"
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
              {pageRows.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  visible={colVis.visible}
                  selected={selected.has(account.id)}
                  onToggle={() => toggleOne(account.id)}
                  users={users}
                  onPatch={(p) => patchAccount(account.id, p)}
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
        <Select
          open={bulkOwnerOpen}
          onOpenChange={setBulkOwnerOpen}
          value=""
          onValueChange={(v) => void doBulkOwner(v)}
        >
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
        <Button size="sm" variant="ghost" className="h-8 gap-1 text-destructive" onClick={openBulkDelete} data-testid="bulk-delete">
          <Trash2 className="h-3.5 w-3.5" /> Löschen
        </Button>
      </BulkActionBar>

      <AccountFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      <AlertDialog
        open={deleteDialog?.stage === "confirm"}
        onOpenChange={(o) => { if (!o) setDeleteDialog(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteDialog?.stage === "confirm" && deleteDialog.ids.length === 1
                ? `Account "${nameOf(deleteDialog.ids[0])}" löschen?`
                : `${deleteDialog?.stage === "confirm" ? deleteDialog.ids.length : 0} Account(s) löschen?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Accounts mit verknüpften Deals, Verträgen oder Kontakten können standardmäßig nicht gelöscht werden.
              Du kannst stattdessen direkt erzwingen, dass alle abhängigen Daten mitgelöscht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-start gap-2 text-sm cursor-pointer p-3 rounded-md border bg-muted/30">
            <Checkbox
              checked={deleteDialog?.stage === "confirm" ? deleteDialog.cascade : false}
              onCheckedChange={(v) => {
                if (deleteDialog?.stage === "confirm") {
                  setDeleteDialog({ ...deleteDialog, cascade: v === true });
                }
              }}
              data-testid="delete-cascade-toggle"
            />
            <span>
              <span className="font-medium">Auch alle verknüpften Daten löschen</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Deals, Kontakte, Angebote, Renewals und Schreiben werden entfernt. Verträge und Verpflichtungen bleiben erhalten — nur die Account-Zuordnung wird geleert.
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (deleteDialog?.stage === "confirm") {
                  void runBulkDelete(deleteDialog.ids, deleteDialog.cascade);
                }
              }}
              data-testid="delete-confirm"
            >
              {deleteDialog?.stage === "confirm" && deleteDialog.cascade ? "Endgültig löschen" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteDialog?.stage === "blocked"}
        onOpenChange={(o) => { if (!o) setDeleteDialog(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              {deleteDialog?.stage === "blocked" && deleteDialog.ids.length === 1
                ? `"${nameOf(deleteDialog.ids[0])}" hat noch verknüpfte Daten`
                : `${deleteDialog?.stage === "blocked" ? deleteDialog.ids.length : 0} Account(s) haben noch verknüpfte Daten`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteDialog?.stage === "blocked" && deleteDialog.deletedCount > 0
                ? `${deleteDialog.deletedCount} Account(s) wurden bereits gelöscht. Folgende konnten wegen verknüpfter Daten nicht entfernt werden:`
                : "Der Account konnte nicht gelöscht werden, weil noch verknüpfte Daten existieren:"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="text-sm space-y-1.5 max-h-48 overflow-auto pr-2">
            {deleteDialog?.stage === "blocked" && deleteDialog.ids.map(id => (
              <li key={id} className="border-l-2 border-amber-500 pl-3">
                <div className="font-medium">{nameOf(id)}</div>
                <div className="text-xs text-muted-foreground">{describeRefs(deleteDialog.references[id] ?? { deals: 0, contacts: 0, contracts: 0, letters: 0, renewals: 0, obligations: 0, externalContracts: 0 })}</div>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (deleteDialog?.stage === "blocked") {
                  void runBulkDelete(deleteDialog.ids, true);
                }
              }}
              data-testid="delete-cascade-confirm"
            >
              Inkl. abhängiger Daten löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AccountRow({
  account,
  visible,
  selected,
  onToggle,
  users,
  onPatch,
}: {
  account: Account;
  visible: Set<string>;
  selected: boolean;
  onToggle: () => void;
  users: { id: string; name: string }[];
  onPatch: (p: { name?: string; industry?: string; country?: string; ownerId?: string | null }) => Promise<void>;
}) {
  const healthColor = account.healthScore < 60 ? "bg-red-500" : account.healthScore <= 75 ? "bg-amber-400" : "bg-green-500";
  const ownerName = users.find((u) => u.id === account.ownerId)?.name;
  return (
    <TableRow data-state={selected ? "selected" : undefined} className={selected ? "bg-muted/40" : undefined}>
      <TableCell>
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`${account.name} auswählen`} />
      </TableCell>
      {visible.has("name") && (
        <TableCell className="font-medium">
          <Link href={`/accounts/${account.id}`} className="hover:underline" data-testid={`account-link-${account.id}`}>
            {account.name}
          </Link>
        </TableCell>
      )}
      {visible.has("industry") && (
        <TableCell>
          <InlineEditField
            ariaLabel="Branche"
            value={account.industry}
            onSubmit={(v) => onPatch({ industry: v })}
            testId={`inline-industry-${account.id}`}
          />
        </TableCell>
      )}
      {visible.has("country") && (
        <TableCell>
          <InlineEditField
            ariaLabel="Land"
            value={account.country}
            onSubmit={(v) => onPatch({ country: v })}
            testId={`inline-country-${account.id}`}
          />
        </TableCell>
      )}
      {visible.has("owner") && (
        <TableCell>
          <InlineEditField
            ariaLabel="Owner"
            kind="select"
            options={users.map((u) => ({ value: u.id, label: u.name }))}
            value={account.ownerId ?? ""}
            display={<span className={ownerName ? "" : "text-muted-foreground italic"}>{ownerName ?? "Nicht zugewiesen"}</span>}
            onSubmit={(v) => onPatch({ ownerId: v || null })}
            testId={`inline-owner-${account.id}`}
          />
        </TableCell>
      )}
      {visible.has("healthScore") && (
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="w-8 text-right text-xs font-medium tabular-nums">{account.healthScore}</span>
            <div className="h-2 w-24 bg-muted rounded-full overflow-hidden">
              <div className={`h-full ${healthColor}`} style={{ width: `${account.healthScore}%` }} />
            </div>
          </div>
        </TableCell>
      )}
      {visible.has("openDeals") && <TableCell className="tabular-nums">{account.openDeals}</TableCell>}
      {visible.has("totalValue") && <TableCell className="tabular-nums">{account.totalValue.toLocaleString("de-DE")}</TableCell>}
    </TableRow>
  );
}

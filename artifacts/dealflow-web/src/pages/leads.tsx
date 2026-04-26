import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  UserPlus,
  Plus,
  Search,
  Mail,
  Phone,
  CheckCircle2,
  XCircle,
  ArrowRight,
  MoreHorizontal,
  Trash2,
  Pencil,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLeads,
  useCreateLead,
  useUpdateLead,
  useDeleteLead,
  useConvertLead,
  useListUsers,
  useListAccounts,
  useListCompanies,
  useListBrands,
  getListLeadsQueryKey,
  type Lead,
  type LeadStatus,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { PaginationBar } from "@/components/patterns/pagination-bar";
import { FilterChip } from "@/components/patterns/filter-chips";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ─── Quellen / Status ───────────────────────────────────────────────────────
const SOURCE_KEYS = [
  "website", "referral", "inbound_email", "event", "outbound", "partner", "other",
] as const;

type StatusTab = "all" | "new" | "qualified" | "disqualified" | "converted";

const STATUS_TONE: Record<LeadStatus, { bg: string; text: string }> = {
  new: { bg: "bg-sky-50 dark:bg-sky-950/40", text: "text-sky-800 dark:text-sky-200" },
  qualified: { bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-800 dark:text-emerald-200" },
  disqualified: { bg: "bg-rose-50 dark:bg-rose-950/40", text: "text-rose-800 dark:text-rose-200" },
  converted: { bg: "bg-violet-50 dark:bg-violet-950/40", text: "text-violet-800 dark:text-violet-200" },
};

function StatusBadge({ status }: { status: LeadStatus }) {
  const { t } = useTranslation();
  const tone = STATUS_TONE[status];
  return (
    <Badge variant="outline" className={cn("font-normal border-transparent", tone.bg, tone.text)}>
      {t(`pages.leads.status.${status}`)}
    </Badge>
  );
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return s;
  }
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function Leads() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();

  const [statusTab, setStatusTab] = useState<StatusTab>("all");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data: users = [] } = useListUsers();

  const query = useMemo(() => {
    const params: Record<string, string | number | undefined> = {
      page,
      pageSize,
    };
    if (statusTab !== "all") params.status = statusTab;
    if (search.trim()) params.search = search.trim();
    if (ownerFilter) params.ownerId = ownerFilter;
    if (sourceFilter) params.source = sourceFilter;
    return params;
  }, [statusTab, search, ownerFilter, sourceFilter, page, pageSize]);

  const { data, isLoading } = useListLeads(query);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const counts = data?.statusCounts ?? { all: 0, new: 0, qualified: 0, disqualified: 0, converted: 0 };

  // Dialogs / Drawers
  const [createOpen, setCreateOpen] = useState(false);
  const [editLead, setEditLead] = useState<Lead | null>(null);
  const [convertLead, setConvertLeadState] = useState<Lead | null>(null);
  const [disqualifyLead, setDisqualifyLead] = useState<Lead | null>(null);
  const [deleteLead, setDeleteLeadState] = useState<Lead | null>(null);

  const qc = useQueryClient();
  const invalidateLeads = () => qc.invalidateQueries({ queryKey: getListLeadsQueryKey().slice(0, 1) });
  const updateLead = useUpdateLead();

  function quickQualify(lead: Lead) {
    updateLead.mutate(
      { id: lead.id, data: { status: "qualified" } },
      {
        onSuccess: () => {
          toast({ title: t("pages.leads.toasts.qualified") });
          invalidateLeads();
        },
      },
    );
  }

  // Tabs definition
  const tabs: { id: StatusTab; label: string; count: number }[] = [
    { id: "all", label: t("pages.leads.tabs.all"), count: counts.all },
    { id: "new", label: t("pages.leads.tabs.new"), count: counts.new },
    { id: "qualified", label: t("pages.leads.tabs.qualified"), count: counts.qualified },
    { id: "disqualified", label: t("pages.leads.tabs.disqualified"), count: counts.disqualified },
    { id: "converted", label: t("pages.leads.tabs.converted"), count: counts.converted },
  ];

  const ownerOptions = useMemo(() => [
    { value: "unassigned", label: t("pages.leads.filters.ownerUnassigned") },
    ...users.map(u => ({ value: u.id, label: u.name })),
  ], [users, t]);

  const sourceOptions = useMemo(
    () => SOURCE_KEYS.map(k => ({ value: k, label: t(`pages.leads.sources.${k}`) })),
    [t],
  );

  const showInitialEmpty = !isLoading && counts.all === 0 && !search && !ownerFilter && !sourceFilter && statusTab === "all";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("pages.leads.title")}
        subtitle={t("pages.leads.subtitle")}
        icon={UserPlus}
        testId="page-leads-header"
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="btn-new-lead">
            <Plus className="mr-1 h-4 w-4" /> {t("pages.leads.newLead")}
          </Button>
        }
      />

      {showInitialEmpty ? (
        <EmptyStateCard
          icon={UserPlus}
          title={t("pages.leads.emptyTitle")}
          body={t("pages.leads.emptyBody")}
          primaryAction={{
            label: t("pages.leads.newLead"),
            onClick: () => setCreateOpen(true),
            testId: "empty-cta-new-lead",
          }}
          testId="page-leads-empty"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {/* Status tabs */}
          <div className="flex flex-wrap items-center gap-1 border-b">
            {tabs.map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => { setStatusTab(tab.id); setPage(1); }}
                className={cn(
                  "px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
                  statusTab === tab.id
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
                data-testid={`tab-status-${tab.id}`}
              >
                {tab.label}
                <span className="ml-1.5 text-xs text-muted-foreground tabular-nums">({tab.count})</span>
              </button>
            ))}
          </div>

          {/* Search + filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { setSearch(searchInput); setPage(1); }
                }}
                onBlur={() => { if (searchInput !== search) { setSearch(searchInput); setPage(1); } }}
                placeholder={t("pages.leads.searchPlaceholder")}
                className="pl-8 h-8"
                data-testid="input-search-leads"
              />
            </div>
            <FilterChip
              label={t("pages.leads.filters.owner")}
              value={ownerFilter}
              options={ownerOptions}
              onChange={v => { setOwnerFilter(v); setPage(1); }}
              searchable
              testId="chip-owner"
            />
            <FilterChip
              label={t("pages.leads.filters.source")}
              value={sourceFilter}
              options={sourceOptions}
              onChange={v => { setSourceFilter(v); setPage(1); }}
              testId="chip-source"
            />
          </div>

          {/* Table */}
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.leads.columns.name")}</TableHead>
                  <TableHead>{t("pages.leads.columns.company")}</TableHead>
                  <TableHead>{t("pages.leads.columns.contact")}</TableHead>
                  <TableHead>{t("pages.leads.columns.source")}</TableHead>
                  <TableHead>{t("pages.leads.columns.status")}</TableHead>
                  <TableHead>{t("pages.leads.columns.owner")}</TableHead>
                  <TableHead>{t("pages.leads.columns.lastContact")}</TableHead>
                  <TableHead className="w-[1%] text-right">…</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))}
                {!isLoading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground py-10">
                      {t("pages.leads.emptyTitle")}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && items.map(lead => (
                  <TableRow key={lead.id} data-testid={`row-lead-${lead.id}`}>
                    <TableCell className="font-medium">{lead.name}</TableCell>
                    <TableCell className="text-sm">{lead.companyName ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-col gap-0.5">
                        {lead.email && (
                          <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                            <Mail className="h-3 w-3" /> {lead.email}
                          </a>
                        )}
                        {lead.phone && (
                          <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                            <Phone className="h-3 w-3" /> {lead.phone}
                          </a>
                        )}
                        {!lead.email && !lead.phone && <span className="text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(SOURCE_KEYS as readonly string[]).includes(lead.source)
                        ? t(`pages.leads.sources.${lead.source}`)
                        : lead.source}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={lead.status} />
                      {lead.status === "converted" && (lead.convertedAccountId || lead.convertedDealId) && (
                        <div className="mt-1 flex flex-col gap-0.5 text-xs">
                          {lead.convertedAccountId && (
                            <Link
                              href={`/accounts/${lead.convertedAccountId}`}
                              className="text-primary hover:underline"
                              data-testid={`link-converted-account-${lead.id}`}
                            >
                              → {t("pages.leads.convert.accountLabel", { defaultValue: "Account" })}: {lead.convertedAccountName ?? lead.convertedAccountId}
                            </Link>
                          )}
                          {lead.convertedDealId && (
                            <Link
                              href={`/deals/${lead.convertedDealId}`}
                              className="text-primary hover:underline"
                              data-testid={`link-converted-deal-${lead.id}`}
                            >
                              → {t("pages.leads.convert.dealLabel", { defaultValue: "Deal" })}: {lead.convertedDealName ?? lead.convertedDealId}
                            </Link>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{lead.ownerName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm tabular-nums">{fmtDate(lead.lastContactAt)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`menu-lead-${lead.id}`}>
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {lead.status !== "converted" && (
                            <DropdownMenuItem onSelect={() => setEditLead(lead)} data-testid={`item-edit-${lead.id}`}>
                              <Pencil className="mr-2 h-3.5 w-3.5" /> {t("common.edit", { defaultValue: "Bearbeiten" })}
                            </DropdownMenuItem>
                          )}
                          {lead.status === "new" && (
                            <DropdownMenuItem onSelect={() => quickQualify(lead)} data-testid={`item-qualify-${lead.id}`}>
                              <CheckCircle2 className="mr-2 h-3.5 w-3.5" /> {t("pages.leads.actions.qualify")}
                            </DropdownMenuItem>
                          )}
                          {lead.status !== "converted" && lead.status !== "disqualified" && (
                            <DropdownMenuItem onSelect={() => setDisqualifyLead(lead)} data-testid={`item-disqualify-${lead.id}`}>
                              <XCircle className="mr-2 h-3.5 w-3.5" /> {t("pages.leads.actions.disqualify")}
                            </DropdownMenuItem>
                          )}
                          {(lead.status === "new" || lead.status === "qualified") && (
                            <DropdownMenuItem onSelect={() => setConvertLeadState(lead)} data-testid={`item-convert-${lead.id}`}>
                              <ArrowRight className="mr-2 h-3.5 w-3.5" /> {t("pages.leads.actions.convert")}
                            </DropdownMenuItem>
                          )}
                          {lead.status !== "converted" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() => setDeleteLeadState(lead)}
                                className="text-destructive focus:text-destructive"
                                data-testid={`item-delete-${lead.id}`}
                              >
                                <Trash2 className="mr-2 h-3.5 w-3.5" /> {t("pages.leads.actions.delete")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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

      <LeadFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        users={users}
        currentUserId={user?.id}
      />
      <LeadFormDialog
        open={!!editLead}
        onOpenChange={(o) => { if (!o) setEditLead(null); }}
        users={users}
        currentUserId={user?.id}
        lead={editLead ?? undefined}
      />
      <DisqualifyDialog
        lead={disqualifyLead}
        onOpenChange={(o) => { if (!o) setDisqualifyLead(null); }}
      />
      <ConvertDialog
        lead={convertLead}
        onOpenChange={(o) => { if (!o) setConvertLeadState(null); }}
      />
      <DeleteConfirm
        lead={deleteLead}
        onOpenChange={(o) => { if (!o) setDeleteLeadState(null); }}
      />
    </div>
  );
}

// ─── Form (create + edit) ───────────────────────────────────────────────────
function LeadFormDialog({
  open, onOpenChange, users, currentUserId, lead,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  users: { id: string; name: string }[];
  currentUserId?: string;
  lead?: Lead;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!lead;
  const create = useCreateLead();
  const update = useUpdateLead();
  const invalidate = () => qc.invalidateQueries({ queryKey: getListLeadsQueryKey().slice(0, 1) });

  const [name, setName] = useState(lead?.name ?? "");
  const [companyName, setCompanyName] = useState(lead?.companyName ?? "");
  const [email, setEmail] = useState(lead?.email ?? "");
  const [phone, setPhone] = useState(lead?.phone ?? "");
  const [source, setSource] = useState(lead?.source ?? "website");
  const [ownerId, setOwnerId] = useState<string>(lead?.ownerId ?? currentUserId ?? "");
  const [notes, setNotes] = useState(lead?.notes ?? "");
  const [lastContactAt, setLastContactAt] = useState(lead?.lastContactAt ? lead.lastContactAt.slice(0, 10) : "");

  // Reset on open / when lead changes
  useEffect(() => {
    if (open) {
      setName(lead?.name ?? "");
      setCompanyName(lead?.companyName ?? "");
      setEmail(lead?.email ?? "");
      setPhone(lead?.phone ?? "");
      setSource(lead?.source ?? "website");
      setOwnerId(lead?.ownerId ?? currentUserId ?? "");
      setNotes(lead?.notes ?? "");
      setLastContactAt(lead?.lastContactAt ? lead.lastContactAt.slice(0, 10) : "");
    }
  }, [open, lead, currentUserId]);

  function handleSubmit() {
    if (!name.trim()) return;
    const payload = {
      name: name.trim(),
      companyName: companyName.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      source: source.trim() || "other",
      ownerId: ownerId === "__unassigned__" ? null : ownerId || null,
      notes: notes.trim() || null,
      lastContactAt: lastContactAt ? new Date(lastContactAt).toISOString() : null,
    };
    if (isEdit && lead) {
      update.mutate(
        { id: lead.id, data: payload },
        {
          onSuccess: () => {
            toast({ title: t("pages.leads.toasts.updated") });
            invalidate();
            onOpenChange(false);
          },
        },
      );
    } else {
      create.mutate(
        { data: payload },
        {
          onSuccess: () => {
            toast({ title: t("pages.leads.toasts.created") });
            invalidate();
            onOpenChange(false);
          },
        },
      );
    }
  }

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dlg-lead-form">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("pages.leads.form.editTitle") : t("pages.leads.form.createTitle")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>{t("pages.leads.form.name")}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("pages.leads.form.company")}</Label>
              <Input value={companyName} onChange={e => setCompanyName(e.target.value)} data-testid="input-company" />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("pages.leads.form.source")}</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger data-testid="select-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCE_KEYS.map(k => (
                    <SelectItem key={k} value={k}>{t(`pages.leads.sources.${k}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("pages.leads.form.email")}</Label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} data-testid="input-email" />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("pages.leads.form.phone")}</Label>
              <Input value={phone} onChange={e => setPhone(e.target.value)} data-testid="input-phone" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("pages.leads.form.owner")}</Label>
              <Select value={ownerId || "__unassigned__"} onValueChange={setOwnerId}>
                <SelectTrigger data-testid="select-owner"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">{t("pages.leads.form.ownerUnassigned")}</SelectItem>
                  {users.map(u => (
                    <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("pages.leads.form.lastContactAt")}</Label>
              <Input type="date" value={lastContactAt} onChange={e => setLastContactAt(e.target.value)} data-testid="input-last-contact" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>{t("pages.leads.form.notes")}</Label>
            <Textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} data-testid="input-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("pages.leads.form.cancel")}</Button>
          <Button onClick={handleSubmit} disabled={busy || !name.trim()} data-testid="btn-save-lead">
            {t("pages.leads.form.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Disqualify dialog ──────────────────────────────────────────────────────
function DisqualifyDialog({
  lead, onOpenChange,
}: {
  lead: Lead | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const update = useUpdateLead();
  const [reason, setReason] = useState("");

  useEffect(() => { if (lead) setReason(lead.disqualifyReason ?? ""); }, [lead]);

  function handleConfirm() {
    if (!lead || !reason.trim()) return;
    update.mutate(
      { id: lead.id, data: { status: "disqualified", disqualifyReason: reason.trim() } },
      {
        onSuccess: () => {
          toast({ title: t("pages.leads.toasts.disqualified") });
          qc.invalidateQueries({ queryKey: getListLeadsQueryKey().slice(0, 1) });
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={!!lead} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dlg-disqualify">
        <DialogHeader>
          <DialogTitle>{t("pages.leads.disqualify.title")}</DialogTitle>
          <DialogDescription>{t("pages.leads.disqualify.body")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label>{t("pages.leads.disqualify.reason")}</Label>
          <Textarea
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            data-testid="input-disqualify-reason"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("pages.leads.form.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={update.isPending || !reason.trim()}
            data-testid="btn-confirm-disqualify"
          >
            {t("pages.leads.disqualify.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Convert dialog ─────────────────────────────────────────────────────────
function ConvertDialog({
  lead, onOpenChange,
}: {
  lead: Lead | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const convert = useConvertLead();
  const { data: accounts = [] } = useListAccounts({ status: "active" });
  const { data: companies = [] } = useListCompanies();
  const { data: brands = [] } = useListBrands();

  const [mode, setMode] = useState<"existing" | "new">("new");
  const [existingAccountId, setExistingAccountId] = useState("");
  const [accName, setAccName] = useState("");
  const [accIndustry, setAccIndustry] = useState("");
  const [accCountry, setAccCountry] = useState("DE");
  const [accWebsite, setAccWebsite] = useState("");
  const [accPhone, setAccPhone] = useState("");

  const [withDeal, setWithDeal] = useState(false);
  const [dealName, setDealName] = useState("");
  const [dealValue, setDealValue] = useState("0");
  const [dealCurrency, setDealCurrency] = useState("EUR");
  const [dealCloseDate, setDealCloseDate] = useState("");
  const [dealCompanyId, setDealCompanyId] = useState("");
  const [dealBrandId, setDealBrandId] = useState("");

  // Hydrate from lead on open.
  useEffect(() => {
    if (lead) {
      setMode("new");
      setExistingAccountId("");
      setAccName(lead.companyName ?? lead.name);
      setAccIndustry("");
      setAccCountry("DE");
      setAccWebsite("");
      setAccPhone(lead.phone ?? "");
      setWithDeal(false);
      setDealName(`${lead.companyName ?? lead.name} – Erstgeschäft`);
      setDealValue("0");
      setDealCurrency("EUR");
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      setDealCloseDate(d.toISOString().slice(0, 10));
      setDealCompanyId("");
      setDealBrandId("");
    }
  }, [lead]);

  // Brands der gewählten Company
  const brandsForCompany = useMemo(
    () => brands.filter((b: { companyId: string }) => b.companyId === dealCompanyId),
    [brands, dealCompanyId],
  );

  function handleConvert() {
    if (!lead) return;
    const body: Record<string, unknown> = {};
    if (mode === "existing") {
      if (!existingAccountId) return;
      body.accountId = existingAccountId;
    } else {
      if (!accName.trim() || !accIndustry.trim() || !accCountry.trim()) return;
      body.newAccount = {
        name: accName.trim(),
        industry: accIndustry.trim(),
        country: accCountry.trim(),
        website: accWebsite.trim() || null,
        phone: accPhone.trim() || null,
      };
    }
    if (withDeal) {
      const v = Number(dealValue);
      if (!dealName.trim() || !Number.isFinite(v) || v < 0) return;
      if (!dealCloseDate || !dealCompanyId || !dealBrandId) return;
      body.newDeal = {
        name: dealName.trim(),
        value: v,
        currency: dealCurrency,
        expectedCloseDate: dealCloseDate,
        companyId: dealCompanyId,
        brandId: dealBrandId,
        stage: "qualified",
        probability: 30,
      };
    }
    convert.mutate(
      { id: lead.id, data: body as never },
      {
        onSuccess: (res) => {
          const accLabel = res.account?.name ?? "—";
          const dealLabel = res.deal && (res.deal as { name?: string }).name;
          toast({
            title: t("pages.leads.toasts.convertedTitle"),
            description: dealLabel
              ? t("pages.leads.convert.successWithDeal", { account: accLabel, deal: dealLabel })
              : t("pages.leads.convert.successBody", { account: accLabel }),
          });
          qc.invalidateQueries({ queryKey: getListLeadsQueryKey().slice(0, 1) });
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={!!lead} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="dlg-convert">
        <DialogHeader>
          <DialogTitle>{t("pages.leads.convert.title")}</DialogTitle>
          <DialogDescription>{t("pages.leads.convert.body")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Account section */}
          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{t("pages.leads.convert.accountSection")}</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                  data-testid="radio-new-account"
                />
                {t("pages.leads.convert.createNewAccount")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === "existing"}
                  onChange={() => setMode("existing")}
                  data-testid="radio-existing-account"
                />
                {t("pages.leads.convert.useExistingAccount")}
              </label>
            </div>

            {mode === "existing" ? (
              <div className="grid gap-1.5">
                <Label>{t("pages.leads.convert.existingAccount")}</Label>
                <Select value={existingAccountId} onValueChange={setExistingAccountId}>
                  <SelectTrigger data-testid="select-existing-account"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a: { id: string; name: string }) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>{t("pages.leads.convert.newAccountName")}</Label>
                    <Input value={accName} onChange={e => setAccName(e.target.value)} data-testid="input-acc-name" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("pages.leads.convert.newAccountIndustry")}</Label>
                    <Input value={accIndustry} onChange={e => setAccIndustry(e.target.value)} data-testid="input-acc-industry" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="grid gap-1.5">
                    <Label>{t("pages.leads.convert.newAccountCountry")}</Label>
                    <Input value={accCountry} onChange={e => setAccCountry(e.target.value)} data-testid="input-acc-country" />
                  </div>
                  <div className="grid gap-1.5 col-span-2">
                    <Label>{t("pages.leads.convert.newAccountWebsite")}</Label>
                    <Input value={accWebsite} onChange={e => setAccWebsite(e.target.value)} data-testid="input-acc-website" />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("pages.leads.convert.newAccountPhone")}</Label>
                  <Input value={accPhone} onChange={e => setAccPhone(e.target.value)} data-testid="input-acc-phone" />
                </div>
              </div>
            )}
          </fieldset>

          {/* Deal section */}
          <fieldset className="grid gap-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{t("pages.leads.convert.dealSection")}</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={withDeal}
                onChange={e => setWithDeal(e.target.checked)}
                data-testid="cb-with-deal"
              />
              {t("pages.leads.convert.createDeal")}
            </label>
            {withDeal && (
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("pages.leads.convert.dealName")}</Label>
                  <Input value={dealName} onChange={e => setDealName(e.target.value)} data-testid="input-deal-name" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="grid gap-1.5">
                    <Label>{t("pages.leads.convert.dealValue")}</Label>
                    <Input type="number" min={0} value={dealValue} onChange={e => setDealValue(e.target.value)} data-testid="input-deal-value" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("pages.leads.convert.dealCurrency")}</Label>
                    <Input value={dealCurrency} onChange={e => setDealCurrency(e.target.value.toUpperCase())} data-testid="input-deal-currency" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("pages.leads.convert.dealCloseDate")}</Label>
                    <Input type="date" value={dealCloseDate} onChange={e => setDealCloseDate(e.target.value)} data-testid="input-deal-close" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>{t("pages.leads.convert.dealCompany")}</Label>
                    <Select value={dealCompanyId} onValueChange={(v) => { setDealCompanyId(v); setDealBrandId(""); }}>
                      <SelectTrigger data-testid="select-deal-company"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {companies.map((c: { id: string; legalName?: string; name?: string }) => (
                          <SelectItem key={c.id} value={c.id}>{c.legalName ?? c.name ?? c.id}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("pages.leads.convert.dealBrand")}</Label>
                    <Select value={dealBrandId} onValueChange={setDealBrandId} disabled={!dealCompanyId}>
                      <SelectTrigger data-testid="select-deal-brand"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {brandsForCompany.map((b: { id: string; name: string }) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("pages.leads.form.cancel")}
          </Button>
          <Button
            onClick={handleConvert}
            disabled={convert.isPending || (mode === "existing" && !existingAccountId)}
            data-testid="btn-confirm-convert"
          >
            {t("pages.leads.convert.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete confirm ─────────────────────────────────────────────────────────
function DeleteConfirm({
  lead, onOpenChange,
}: {
  lead: Lead | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const del = useDeleteLead();

  function handleConfirm() {
    if (!lead) return;
    del.mutate(
      { id: lead.id },
      {
        onSuccess: () => {
          toast({ title: t("pages.leads.toasts.deleted") });
          qc.invalidateQueries({ queryKey: getListLeadsQueryKey().slice(0, 1) });
          onOpenChange(false);
        },
      },
    );
  }

  return (
    <AlertDialog open={!!lead} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="dlg-delete-lead">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("pages.leads.delete.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("pages.leads.delete.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("pages.leads.form.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={del.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            data-testid="btn-confirm-delete"
          >
            {t("pages.leads.delete.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

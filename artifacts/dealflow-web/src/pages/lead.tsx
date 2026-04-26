import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  Building,
  Mail,
  Phone,
  UserPlus,
  Pencil,
  Trash2,
  CheckCircle2,
  XCircle,
  Calendar,
  MoreHorizontal,
  Plus,
  Send,
  StickyNote,
  CalendarClock,
  ClipboardList,
  Sparkles,
} from "lucide-react";
import {
  useGetLead,
  useUpdateLead,
  useListUsers,
  useListLeadActivities,
  useCreateLeadActivity,
  useUpdateLeadActivity,
  useDeleteLeadActivity,
  getGetLeadQueryKey,
  getListLeadActivitiesQueryKey,
  getListAuditEntriesQueryKey,
  getListLeadsQueryKey,
  type Lead,
  type LeadActivity,
  type LeadActivityInputType,
} from "@workspace/api-client-react";
import type { CurrentUser } from "@/lib/auth";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Breadcrumbs } from "@/components/patterns/breadcrumbs";
import { ActivityTimeline } from "@/components/patterns/activity-timeline";
import { useTrackRecent } from "@/hooks/use-recents";
import { cn } from "@/lib/utils";
import {
  LeadFormDialog,
  DisqualifyDialog,
  ConvertDialog,
  DeleteConfirm,
} from "@/pages/leads";

const STATUS_TONE: Record<string, { bg: string; text: string }> = {
  new: { bg: "bg-sky-50 dark:bg-sky-950/40", text: "text-sky-800 dark:text-sky-200" },
  qualified: { bg: "bg-emerald-50 dark:bg-emerald-950/40", text: "text-emerald-800 dark:text-emerald-200" },
  disqualified: { bg: "bg-rose-50 dark:bg-rose-950/40", text: "text-rose-800 dark:text-rose-200" },
  converted: { bg: "bg-violet-50 dark:bg-violet-950/40", text: "text-violet-800 dark:text-violet-200" },
};

const SOURCE_KEYS = ["website", "referral", "inbound_email", "event", "outbound", "partner", "other"] as const;

const ACTIVITY_TYPES: LeadActivityInputType[] = ["note", "call", "email", "meeting", "task"];

const ACTIVITY_ICON: Record<LeadActivityInputType, typeof StickyNote> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  meeting: CalendarClock,
  task: ClipboardList,
};

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return s;
  }
}

function fmtDateTime(s: string | null | undefined) {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("de-DE", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return s;
  }
}

export default function LeadDetail() {
  const { t } = useTranslation();
  const [, params] = useRoute("/leads/:id");
  const id = params?.id || "";
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: lead, isLoading } = useGetLead(id);
  const { data: users = [] } = useListUsers();
  const { data: activities = [], isLoading: actLoading } = useListLeadActivities(id);

  const updateLead = useUpdateLead();

  const [editOpen, setEditOpen] = useState(false);
  const [disqualifyState, setDisqualifyState] = useState<Lead | null>(null);
  const [convertState, setConvertState] = useState<Lead | null>(null);
  const [deleteState, setDeleteState] = useState<Lead | null>(null);

  useTrackRecent(lead ? { kind: "lead", id: lead.id, label: lead.name, href: `/leads/${lead.id}` } : null);

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!lead) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-muted-foreground">{t("pages.leads.detail.notFound")}</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/leads"><ArrowLeft className="mr-1 h-4 w-4" /> {t("pages.leads.detail.back")}</Link>
        </Button>
      </div>
    );
  }

  const tone = STATUS_TONE[lead.status] ?? STATUS_TONE.new;
  const sourceLabel = (SOURCE_KEYS as readonly string[]).includes(lead.source)
    ? t(`pages.leads.sources.${lead.source}`)
    : lead.source;

  function quickQualify() {
    if (!lead) return;
    updateLead.mutate(
      { id: lead.id, data: { status: "qualified" } },
      {
        onSuccess: () => {
          toast({ title: t("pages.leads.toasts.qualified") });
          void qc.invalidateQueries({ queryKey: getGetLeadQueryKey(lead.id) });
          void qc.invalidateQueries({ queryKey: getListLeadsQueryKey().slice(0, 1) });
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: t("pages.leads.title"), href: "/leads" },
          { label: lead.name },
        ]}
      />

      {/* ─── Header ─── */}
      <div className="flex flex-col gap-4 border-b pb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-3">
              <UserPlus className="h-7 w-7 text-muted-foreground shrink-0" />
              <h1 className="text-3xl font-bold tracking-tight" data-testid="lead-detail-title">{lead.name}</h1>
              <Badge
                variant="outline"
                className={cn("font-normal border-transparent", tone.bg, tone.text)}
                data-testid="lead-detail-status"
              >
                {t(`pages.leads.status.${lead.status}`)}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {lead.companyName && (
                <span className="inline-flex items-center gap-1">
                  <Building className="h-3.5 w-3.5" /> {lead.companyName}
                </span>
              )}
              {lead.companyName && <span aria-hidden>•</span>}
              <span>{sourceLabel}</span>
              <span aria-hidden>•</span>
              <span>{t("pages.leads.detail.stammdatenOwner")}: {lead.ownerName ?? <em className="text-muted-foreground">—</em>}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {lead.status !== "converted" && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)} data-testid="btn-edit-lead">
                <Pencil className="mr-1 h-4 w-4" /> {t("common.edit")}
              </Button>
            )}
            {lead.status === "new" && (
              <Button size="sm" variant="outline" onClick={quickQualify} data-testid="btn-qualify-lead">
                <CheckCircle2 className="mr-1 h-4 w-4" /> {t("pages.leads.actions.qualify")}
              </Button>
            )}
            {(lead.status === "new" || lead.status === "qualified") && (
              <Button size="sm" onClick={() => setConvertState(lead)} data-testid="btn-convert-lead">
                <ArrowRight className="mr-1 h-4 w-4" /> {t("pages.leads.actions.convert")}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8" data-testid="lead-detail-menu">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {lead.status !== "converted" && (
                  <DropdownMenuItem onSelect={() => setEditOpen(true)} data-testid="menu-edit-lead">
                    <Pencil className="mr-2 h-3.5 w-3.5" /> {t("common.edit")}
                  </DropdownMenuItem>
                )}
                {lead.status !== "converted" && lead.status !== "disqualified" && (
                  <DropdownMenuItem onSelect={() => setDisqualifyState(lead)} data-testid="menu-disqualify-lead">
                    <XCircle className="mr-2 h-3.5 w-3.5" /> {t("pages.leads.actions.disqualify")}
                  </DropdownMenuItem>
                )}
                {lead.status !== "converted" && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setDeleteState(lead)}
                      data-testid="menu-delete-lead"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" /> {t("pages.leads.actions.delete")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Konvertiert-Banner — zeigt Verlinkung auf Account/Deal an */}
        {lead.status === "converted" && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-md border border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/30 px-3 py-2 text-sm"
            data-testid="lead-converted-banner"
          >
            <Sparkles className="h-4 w-4 text-violet-700 dark:text-violet-300 shrink-0" />
            <span className="text-violet-900 dark:text-violet-100">
              {t("pages.leads.detail.convertedBanner", { date: fmtDate(lead.convertedAt) })}
            </span>
            {lead.convertedAccountId && (
              <Link
                href={`/accounts/${lead.convertedAccountId}`}
                className="font-medium text-violet-900 dark:text-violet-100 underline underline-offset-2"
                data-testid="link-converted-account"
              >
                {lead.convertedAccountName ?? lead.convertedAccountId}
              </Link>
            )}
            {lead.convertedDealId && (
              <>
                <span className="text-violet-700 dark:text-violet-300">{t("pages.leads.detail.convertedToDeal")}</span>
                <Link
                  href={`/deals/${lead.convertedDealId}`}
                  className="font-medium text-violet-900 dark:text-violet-100 underline underline-offset-2"
                  data-testid="link-converted-deal"
                >
                  {lead.convertedDealName ?? lead.convertedDealId}
                </Link>
              </>
            )}
          </div>
        )}
      </div>

      {/* ─── Body: 2/3 + 1/3 Layout ─── */}
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>{t("pages.leads.detail.stammdatenTitle")}</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <DataRow icon={Building} label={t("pages.leads.detail.stammdatenCompany")}>
                  {lead.companyName ?? "—"}
                </DataRow>
                <DataRow icon={Mail} label={t("pages.leads.detail.stammdatenEmail")}>
                  {lead.email
                    ? <a href={`mailto:${lead.email}`} className="text-primary hover:underline">{lead.email}</a>
                    : "—"}
                </DataRow>
                <DataRow icon={Phone} label={t("pages.leads.detail.stammdatenPhone")}>
                  {lead.phone
                    ? <a href={`tel:${lead.phone}`} className="text-primary hover:underline">{lead.phone}</a>
                    : "—"}
                </DataRow>
                <DataRow icon={Sparkles} label={t("pages.leads.detail.stammdatenSource")}>
                  {sourceLabel}
                </DataRow>
                <DataRow icon={UserPlus} label={t("pages.leads.detail.stammdatenOwner")}>
                  {lead.ownerName ?? <span className="text-muted-foreground italic">—</span>}
                </DataRow>
                <DataRow icon={Calendar} label={t("pages.leads.detail.stammdatenLastContact")}>
                  <span className="tabular-nums">{fmtDate(lead.lastContactAt)}</span>
                </DataRow>
                <DataRow icon={Calendar} label={t("pages.leads.detail.stammdatenCreated")}>
                  <span className="tabular-nums">{fmtDateTime(lead.createdAt)}</span>
                </DataRow>
              </dl>
              {lead.disqualifyReason && (
                <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30 px-3 py-2 text-sm">
                  <div className="font-medium text-rose-900 dark:text-rose-100 mb-0.5">
                    {t("pages.leads.detail.disqualifyReason")}
                  </div>
                  <div className="text-rose-800 dark:text-rose-200 whitespace-pre-line">
                    {lead.disqualifyReason}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("pages.leads.detail.notesTitle")}</CardTitle></CardHeader>
            <CardContent>
              {lead.notes
                ? <div className="text-sm whitespace-pre-line">{lead.notes}</div>
                : <div className="text-sm text-muted-foreground">{t("pages.leads.detail.notesEmpty")}</div>}
            </CardContent>
          </Card>

          <WidgetIntakeCard lead={lead} />

          {/* Activities — composer + recent list */}
          <Card>
            <CardHeader>
              <CardTitle>{t("pages.leads.detail.activityTitle")}</CardTitle>
              <p className="text-sm text-muted-foreground">{t("pages.leads.detail.activitySubtitle")}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {lead.status !== "converted" && lead.status !== "disqualified" && (
                <ActivityComposer leadId={lead.id} />
              )}
              <ActivityList items={activities} loading={actLoading} leadId={lead.id} currentUser={user} />
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: Audit / Timeline */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader><CardTitle>{t("pages.leads.detail.activityTitle")}</CardTitle></CardHeader>
            <CardContent>
              <ActivityTimeline entityType="lead" entityId={lead.id} />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Reused dialogs */}
      <LeadFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        users={users}
        currentUserId={user?.id}
        lead={lead}
      />
      <DisqualifyDialog
        lead={disqualifyState}
        onOpenChange={(o) => { if (!o) setDisqualifyState(null); }}
      />
      <ConvertDialog
        lead={convertState}
        onOpenChange={(o) => { if (!o) setConvertState(null); }}
      />
      <DeleteConfirm
        lead={deleteState}
        onOpenChange={(o) => { if (!o) setDeleteState(null); }}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function DataRow({ icon: Icon, label, children }: {
  icon: typeof Building; label: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="text-sm font-medium truncate">{children}</dd>
      </div>
    </div>
  );
}

function ActivityComposer({ leadId }: { leadId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const create = useCreateLeadActivity();

  const [type, setType] = useState<LeadActivityInputType>("note");
  const [body, setBody] = useState("");
  const [markContacted, setMarkContacted] = useState(true);

  function handleSubmit() {
    const trimmed = body.trim();
    if (!trimmed) return;
    create.mutate(
      { id: leadId, data: { type, body: trimmed, markContacted } },
      {
        onSuccess: () => {
          toast({ title: t("pages.leads.toasts.activityAdded") });
          setBody("");
          setMarkContacted(true);
          void qc.invalidateQueries({ queryKey: getListLeadActivitiesQueryKey(leadId) });
          void qc.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) });
          // Audit-Liste der Sidebar-Timeline ebenfalls invalidieren — der
          // POST schreibt einen Audit-Log-Eintrag, der dort erscheinen soll.
          void qc.invalidateQueries({
            queryKey: getListAuditEntriesQueryKey({ entityType: "lead", entityId: leadId }).slice(0, 1),
          });
        },
        onError: (err) => {
          toast({
            title: t("pages.leads.toasts.activityFailed"),
            description: err instanceof Error ? err.message : "",
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <div className="rounded-md border bg-muted/40 p-3 space-y-2" data-testid="activity-composer">
      <div className="flex flex-wrap items-center gap-1.5">
        {ACTIVITY_TYPES.map((k) => {
          const Icon = ACTIVITY_ICON[k];
          const active = type === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setType(k)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
              data-testid={`activity-type-${k}`}
            >
              <Icon className="h-3 w-3" />
              {t(`pages.leads.detail.type${k.charAt(0).toUpperCase() + k.slice(1)}`)}
            </button>
          );
        })}
      </div>
      <Textarea
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t("pages.leads.detail.addActivityPlaceholder")}
        data-testid="activity-body"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
          <input
            type="checkbox"
            checked={markContacted}
            onChange={(e) => setMarkContacted(e.target.checked)}
            data-testid="activity-mark-contacted"
          />
          {t("pages.leads.detail.markContacted")}
        </label>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={create.isPending || !body.trim()}
          data-testid="activity-save"
        >
          {create.isPending
            ? <>{t("pages.leads.detail.saving")}</>
            : <><Send className="mr-1 h-4 w-4" /> {t("pages.leads.detail.save")}</>}
        </Button>
      </div>
    </div>
  );
}

/**
 * Brand-Lead-Widget (Task #262): zeigt für Widget-Leads die zusätzlichen
 * Datenpunkte, die das öffentliche Formular einliefert — KI-Zusammenfassung,
 * Domain-Anreicherung, Cal.com-Termin und die Qualifier-Antworten. Nicht-
 * Widget-Leads (manuell angelegt, importiert, etc.) rendern nichts.
 */
function WidgetIntakeCard({ lead }: { lead: Lead }) {
  const enrichment = (lead.enrichment ?? null) as
    | { domain?: string; title?: string; description?: string; faviconUrl?: string; fetchedAt?: string }
    | null;
  const widgetMeta = (lead.widgetMeta ?? null) as
    | {
        qualifier?: Record<string, string>;
        referrer?: string | null;
        userAgent?: string | null;
        ip?: string | null;
        calBooking?: {
          eventTypeId?: string | number;
          startTime?: string;
          endTime?: string;
          attendeeEmail?: string;
          attendeeName?: string;
          status?: string;
          rescheduleUid?: string;
          uid?: string;
          updatedAt?: string;
        } | null;
      }
    | null;
  const hasEnrichment = !!enrichment && !!enrichment.domain;
  const hasQualifier = !!widgetMeta?.qualifier && Object.keys(widgetMeta.qualifier).length > 0;
  const hasBooking = !!widgetMeta?.calBooking?.startTime;
  const hasSummary = !!lead.aiSummary;
  if (!hasEnrichment && !hasQualifier && !hasBooking && !hasSummary && !widgetMeta?.referrer) return null;

  const booking = widgetMeta?.calBooking ?? null;

  return (
    <Card data-testid="widget-intake-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Widget intake
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasSummary && (
          <div
            className="rounded-md border border-primary/30 bg-primary/5 p-3"
            data-testid="widget-ai-summary"
          >
            <div className="text-xs font-medium text-primary mb-1">AI summary</div>
            <div className="text-sm whitespace-pre-line">{lead.aiSummary}</div>
          </div>
        )}

        {hasEnrichment && enrichment && (
          <div className="rounded-md border bg-card p-3 space-y-2" data-testid="widget-enrichment">
            <div className="flex items-start gap-3">
              {enrichment.faviconUrl ? (
                <img
                  src={enrichment.faviconUrl}
                  alt=""
                  className="h-8 w-8 rounded border bg-white object-contain p-1 shrink-0"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="h-8 w-8 rounded border bg-muted shrink-0" />
              )}
              <div className="min-w-0 flex-1 space-y-0.5">
                <a
                  href={`https://${enrichment.domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {enrichment.domain}
                </a>
                {enrichment.title && (
                  <div className="text-sm font-medium truncate">{enrichment.title}</div>
                )}
                {enrichment.description && (
                  <div className="text-xs text-muted-foreground line-clamp-3">
                    {enrichment.description}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {hasBooking && booking && (
          <div
            className="rounded-md border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30 p-3"
            data-testid="widget-cal-booking"
          >
            <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-100 text-sm font-medium">
              <CalendarClock className="h-4 w-4" />
              Cal.com booking
            </div>
            <div className="mt-1 text-sm text-emerald-900/90 dark:text-emerald-100/90 space-y-0.5">
              <div className="tabular-nums">
                {fmtDateTime(booking.startTime)}
                {booking.endTime ? <> – {fmtDateTime(booking.endTime)}</> : null}
              </div>
              {booking.status && (
                <div className="text-xs uppercase tracking-wide">{booking.status}</div>
              )}
              {booking.attendeeName && (
                <div className="text-xs">{booking.attendeeName} ({booking.attendeeEmail})</div>
              )}
            </div>
          </div>
        )}

        {hasQualifier && widgetMeta?.qualifier && (
          <div className="space-y-1.5" data-testid="widget-qualifier">
            <div className="text-xs font-medium text-muted-foreground">Qualifier</div>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              {Object.entries(widgetMeta.qualifier).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{k}</dt>
                  <dd className="text-sm font-medium break-words whitespace-pre-line">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {(widgetMeta?.referrer || widgetMeta?.userAgent) && (
          <div className="text-xs text-muted-foreground space-y-0.5 pt-2 border-t">
            {widgetMeta.referrer && (
              <div className="truncate">
                Referrer: <span className="font-mono">{widgetMeta.referrer}</span>
              </div>
            )}
            {widgetMeta.userAgent && (
              <div className="truncate">
                UA: <span className="font-mono">{widgetMeta.userAgent}</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityList({
  items, loading, leadId, currentUser,
}: {
  items: LeadActivity[];
  loading: boolean;
  leadId: string;
  currentUser: CurrentUser | null;
}) {
  const { t } = useTranslation();
  if (loading) {
    return <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>;
  }
  if (!items.length) {
    return (
      <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground" data-testid="activity-empty">
        <Plus className="mx-auto mb-1 h-4 w-4" />
        {t("pages.leads.detail.activityEmpty")}
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-testid="activity-list">
      {items.map((a) => (
        <ActivityRow key={a.id} activity={a} leadId={leadId} currentUser={currentUser} />
      ))}
    </ul>
  );
}

// Strukturell identische Berechtigungslogik wie das Backend (siehe
// `loadEditableLeadActivity` in dealflow.ts): ein Eintrag ist genau dann
// modifizierbar, wenn der Caller Tenant-Admin ist ODER der Autor — wobei
// der Autor aktuell als `name ?? id` persistiert wird. Wenn Backend und
// Frontend hier divergieren, würde der UI-Button auftauchen aber die
// Anfrage 403 liefern — daher diese Spiegelung exakt halten.
function canModifyActivity(a: LeadActivity, user: CurrentUser | null): boolean {
  if (!user) return false;
  if (user.tenantWide) return true;
  return a.actor === (user.name ?? user.id);
}

function ActivityRow({
  activity: a, leadId, currentUser,
}: {
  activity: LeadActivity;
  leadId: string;
  currentUser: CurrentUser | null;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const Icon = ACTIVITY_ICON[a.type as LeadActivityInputType] ?? StickyNote;
  const typeLabel = t(`pages.leads.detail.type${a.type.charAt(0).toUpperCase() + a.type.slice(1)}`);
  const canModify = canModifyActivity(a, currentUser);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(a.body);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update = useUpdateLeadActivity();
  const del = useDeleteLeadActivity();

  function invalidate() {
    void qc.invalidateQueries({ queryKey: getListLeadActivitiesQueryKey(leadId) });
    void qc.invalidateQueries({
      queryKey: getListAuditEntriesQueryKey({ entityType: "lead", entityId: leadId }).slice(0, 1),
    });
  }

  function startEdit() {
    setDraft(a.body);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(a.body);
  }

  function saveEdit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === a.body) { setEditing(false); return; }
    update.mutate(
      { id: leadId, activityId: a.id, data: { body: trimmed } },
      {
        onSuccess: () => {
          toast({ title: t("pages.leads.toasts.activityUpdated") });
          setEditing(false);
          invalidate();
        },
        onError: (err) => {
          toast({
            title: t("pages.leads.toasts.activityUpdateFailed"),
            description: err instanceof Error ? err.message : "",
            variant: "destructive",
          });
        },
      },
    );
  }

  function doDelete() {
    del.mutate(
      { id: leadId, activityId: a.id },
      {
        onSuccess: () => {
          toast({ title: t("pages.leads.toasts.activityDeleted") });
          setConfirmDelete(false);
          invalidate();
        },
        onError: (err) => {
          toast({
            title: t("pages.leads.toasts.activityDeleteFailed"),
            description: err instanceof Error ? err.message : "",
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <li
      className="flex items-start gap-2 rounded-md border bg-card px-3 py-2"
      data-testid={`activity-item-${a.id}`}
    >
      <Icon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <div className="text-xs font-medium">
            {typeLabel}
            <span className="text-muted-foreground font-normal"> · {a.actor}</span>
          </div>
          <div className="flex items-center gap-2">
            <time className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(a.at)}</time>
            {canModify && !editing && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    data-testid={`activity-menu-${a.id}`}
                    aria-label={t("common.actions")}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={startEdit}
                    data-testid={`activity-edit-${a.id}`}
                  >
                    <Pencil className="mr-2 h-3.5 w-3.5" /> {t("common.edit")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={() => setConfirmDelete(true)}
                    data-testid={`activity-delete-${a.id}`}
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> {t("common.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        {editing ? (
          <div className="mt-1 space-y-2">
            <Textarea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              data-testid={`activity-edit-body-${a.id}`}
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={cancelEdit}
                disabled={update.isPending}
                data-testid={`activity-edit-cancel-${a.id}`}
              >
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={saveEdit}
                disabled={update.isPending || !draft.trim()}
                data-testid={`activity-edit-save-${a.id}`}
              >
                {update.isPending
                  ? t("pages.leads.detail.saving")
                  : t("pages.leads.detail.save")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-sm whitespace-pre-line break-words">{a.body}</div>
        )}
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent data-testid={`activity-delete-confirm-${a.id}`}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.leads.detail.activityDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.leads.detail.activityDeleteDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); doDelete(); }}
              disabled={del.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid={`activity-delete-confirm-action-${a.id}`}
            >
              {del.isPending ? t("pages.leads.detail.saving") : t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

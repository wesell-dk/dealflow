import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  Activity, FileText, ShieldCheck, PenTool, Edit, Plus, Trash2, RefreshCw, MessageSquare,
  Send, XCircle, AlertTriangle, Languages, Archive, ArchiveRestore, Copy, Clock,
  Phone, Mail, CalendarClock, ClipboardList,
} from "lucide-react";
import { useListAuditEntries, type AuditEntry } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ActivityTimelineProps {
  entityType: string; // 'account' | 'deal' | 'contract' | …
  entityId: string;
  limit?: number;
}

const ACTION_META: Record<string, { icon: typeof Activity; label: string; tone: string }> = {
  create:           { icon: Plus,        label: "Angelegt",      tone: "text-emerald-600" },
  update:           { icon: Edit,        label: "Geändert",      tone: "text-blue-600" },
  delete:           { icon: Trash2,      label: "Gelöscht",      tone: "text-destructive" },
  bulk_owner:       { icon: RefreshCw,   label: "Owner geändert", tone: "text-blue-600" },
  bulk_stage:       { icon: RefreshCw,   label: "Stage geändert", tone: "text-blue-600" },
  bulk_delete:      { icon: Trash2,      label: "Gelöscht (Bulk)", tone: "text-destructive" },
  bulk_archive:     { icon: Trash2,      label: "Archiviert", tone: "text-muted-foreground" },
  bulk_restore:     { icon: RefreshCw,   label: "Wiederhergestellt", tone: "text-emerald-600" },
  bulk_purge:       { icon: Trash2,      label: "Endgültig gelöscht", tone: "text-destructive" },
  approval_created: { icon: ShieldCheck, label: "Approval angelegt", tone: "text-amber-600" },
  approval_decided: { icon: ShieldCheck, label: "Approval entschieden", tone: "text-amber-600" },
  signature_created:{ icon: PenTool,     label: "Signatur angelegt", tone: "text-violet-600" },
  contract_created: { icon: FileText,    label: "Vertrag angelegt", tone: "text-indigo-600" },
  comment:          { icon: MessageSquare, label: "Kommentar",   tone: "text-muted-foreground" },
  // Quote-spezifische Aktionen
  status_changed:   { icon: RefreshCw,   label: "Statuswechsel", tone: "text-blue-600" },
  sent:             { icon: Send,        label: "Versendet",     tone: "text-sky-600" },
  send_failed:      { icon: AlertTriangle, label: "Versand fehlgeschlagen", tone: "text-destructive" },
  language_changed: { icon: Languages,   label: "Sprache geändert", tone: "text-muted-foreground" },
  archived:         { icon: Archive,     label: "Archiviert", tone: "text-muted-foreground" },
  unarchived:       { icon: ArchiveRestore, label: "Wiederhergestellt", tone: "text-emerald-600" },
  expired:          { icon: Clock,       label: "Abgelaufen",    tone: "text-muted-foreground" },
  rejected:         { icon: XCircle,     label: "Abgelehnt",     tone: "text-rose-600" },
  duplicate:        { icon: Copy,        label: "Dupliziert",    tone: "text-blue-600" },
  value_autofill:   { icon: Edit,        label: "Wert übernommen", tone: "text-emerald-600" },
  version_created:  { icon: FileText,    label: "Version angelegt", tone: "text-indigo-600" },
  // Lead-Aktivitäten (note|call|email|meeting|task) + convert.
  note:             { icon: MessageSquare, label: "Notiz",        tone: "text-slate-600" },
  call:             { icon: Phone,         label: "Anruf",        tone: "text-emerald-600" },
  email:            { icon: Mail,          label: "E-Mail",       tone: "text-sky-600" },
  meeting:          { icon: CalendarClock, label: "Meeting",      tone: "text-violet-600" },
  task:             { icon: ClipboardList, label: "Folgeaufgabe", tone: "text-amber-600" },
  convert:          { icon: RefreshCw,     label: "Konvertiert",  tone: "text-violet-600" },
};

type FilterKey = "all" | "activity" | "create" | "update" | "status" | "approval" | "signature" | "contract";

const FILTER_LABELS: Record<FilterKey, string> = {
  all: "Alle",
  activity: "Aktivitäten",
  create: "Neu",
  update: "Änderung",
  status: "Status",
  approval: "Approvals",
  signature: "Signaturen",
  contract: "Verträge",
};

const STATUS_ACTIONS = new Set([
  "status_changed", "sent", "send_failed", "rejected", "expired", "archived", "unarchived",
]);

const ACTIVITY_ACTIONS = new Set(["note", "call", "email", "meeting", "task", "comment"]);

function classify(action: string): FilterKey {
  if (ACTIVITY_ACTIONS.has(action)) return "activity";
  if (action.startsWith("approval")) return "approval";
  if (action.startsWith("signature")) return "signature";
  if (action.startsWith("contract")) return "contract";
  if (STATUS_ACTIONS.has(action)) return "status";
  if (action === "create") return "create";
  return "update";
}

const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  sent: "Versendet",
  accepted: "Angenommen",
  rejected: "Abgelehnt",
  expired: "Abgelaufen",
};

function safeParse(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Status-Wechsel besonders deutlich darstellen: alter Status → neuer Status
 * + optionaler Ablehnungsgrund. Fällt auf den serverseitigen Summary-Text
 * zurück, falls keine before/after-Snapshots vorhanden sind.
 */
function renderStatusChange(e: AuditEntry): { headline: ReactNode; reason: string | null } | null {
  if (e.action !== "status_changed") return null;
  const before = safeParse(e.beforeJson);
  const after = safeParse(e.afterJson);
  const fromRaw = (before?.status as string | undefined) ?? null;
  const toRaw = (after?.status as string | undefined) ?? null;
  if (!fromRaw || !toRaw) return null;
  const reason = (after?.rejectionReason as string | null | undefined)?.trim() || null;
  return {
    headline: (
      <span className="inline-flex items-center gap-1 text-xs">
        <Badge variant="secondary" className="font-normal">{QUOTE_STATUS_LABEL[fromRaw] ?? fromRaw}</Badge>
        <span className="text-muted-foreground">→</span>
        <Badge variant="outline" className="font-normal">{QUOTE_STATUS_LABEL[toRaw] ?? toRaw}</Badge>
      </span>
    ),
    reason,
  };
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "gerade eben";
  if (m < 60) return `vor ${m} Min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std`;
  const dys = Math.floor(h / 24);
  if (dys < 7) return `vor ${dys} Tg`;
  return d.toLocaleDateString("de-DE");
}

export function ActivityTimeline({ entityType, entityId, limit = 50 }: ActivityTimelineProps) {
  const { data, isLoading } = useListAuditEntries({ entityType, entityId, limit });
  const [filter, setFilter] = useState<FilterKey>("all");

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data;
    return data.filter((e) => classify(e.action) === filter);
  }, [data, filter]);

  if (isLoading) {
    return <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Noch keine Aktivität für diesen Eintrag.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="activity-timeline">
      <div className="flex flex-wrap items-center gap-1.5">
        {(Object.keys(FILTER_LABELS) as FilterKey[]).map((k) => {
          const count = k === "all" ? data.length : data.filter((e) => classify(e.action) === k).length;
          if (k !== "all" && count === 0) return null;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs border transition-colors",
                filter === k
                  ? "bg-foreground text-background border-foreground"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted",
              )}
              data-testid={`activity-filter-${k}`}
            >
              {FILTER_LABELS[k]} <span className="opacity-70 tabular-nums">({count})</span>
            </button>
          );
        })}
      </div>

      <ol className="relative ml-2 border-l pl-5 space-y-3">
        {filtered.map((e: AuditEntry) => {
          const meta = ACTION_META[e.action] ?? { icon: Activity, label: e.action, tone: "text-muted-foreground" };
          const Icon = meta.icon;
          const statusInfo = renderStatusChange(e);
          return (
            <li key={e.id} className="relative" data-testid={`activity-item-${e.id}`}>
              <span className={cn(
                "absolute -left-[27px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background",
                meta.tone,
              )}>
                <Icon className="h-3 w-3" />
              </span>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="font-medium">{e.actor || "System"}</span>
                    <Badge variant="outline" className="text-[10px] py-0 h-4">{meta.label}</Badge>
                    {statusInfo?.headline}
                  </div>
                  {statusInfo?.reason && (
                    <p
                      className="text-xs text-rose-700 dark:text-rose-300 mt-1"
                      data-testid={`activity-item-${e.id}-reason`}
                    >
                      <span className="font-medium">Grund:</span> {statusInfo.reason}
                    </p>
                  )}
                  {e.summary && !statusInfo && (
                    <p className="text-xs text-muted-foreground mt-0.5">{e.summary}</p>
                  )}
                </div>
                <span
                  className="text-[11px] text-muted-foreground whitespace-nowrap pt-0.5"
                  title={new Date(e.at).toLocaleString("de-DE")}
                >
                  {timeAgo(e.at)}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

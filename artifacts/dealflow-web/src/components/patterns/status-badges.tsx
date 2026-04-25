import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "muted";

const TONE_CLASSES: Record<Tone, string> = {
  neutral:
    "border-border bg-muted text-foreground",
  info:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
  danger:
    "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200",
  muted:
    "border-border bg-background text-muted-foreground",
};

interface ToneBadgeProps {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  testId?: string;
  title?: string;
}

function ToneBadge({ tone, children, className, testId, title }: ToneBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn("font-normal", TONE_CLASSES[tone], className)}
      data-testid={testId}
      title={title}
    >
      {children}
    </Badge>
  );
}

// ─── Risk (low/medium/high/critical) ────────────────────────────────────────
const RISK_TONE: Record<string, Tone> = {
  low: "success",
  medium: "warning",
  high: "danger",
  critical: "danger",
};
const RISK_LABEL: Record<string, string> = {
  low: "Niedrig",
  medium: "Mittel",
  high: "Hoch",
  critical: "Kritisch",
};
export function RiskBadge({ risk, className, testId }: { risk: string | null | undefined; className?: string; testId?: string }) {
  const k = (risk ?? "medium").toLowerCase();
  const tone = RISK_TONE[k] ?? "neutral";
  const label = RISK_LABEL[k] ?? risk ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId} title={`Risiko: ${label}`}>
      {label}
    </ToneBadge>
  );
}

// ─── Deal Stage ─────────────────────────────────────────────────────────────
const DEAL_STAGE_TONE: Record<string, Tone> = {
  lead: "muted",
  qualification: "info",
  qualified: "info",
  discovery: "info",
  proposal: "warning",
  negotiation: "warning",
  contract: "warning",
  closed_won: "success",
  closed_lost: "danger",
  on_hold: "muted",
};
export function DealStageBadge({ stage, label, className, testId }: { stage: string | null | undefined; label?: string; className?: string; testId?: string }) {
  const k = (stage ?? "").toLowerCase();
  const tone = DEAL_STAGE_TONE[k] ?? "neutral";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label ?? stage ?? "—"}
    </ToneBadge>
  );
}

// ─── Contract Status ────────────────────────────────────────────────────────
const CONTRACT_STATUS_TONE: Record<string, Tone> = {
  draft: "muted",
  in_review: "info",
  pending_signature: "warning",
  signed: "success",
  active: "success",
  expired: "danger",
  terminated: "danger",
  archived: "muted",
};
const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  in_review: "In Prüfung",
  pending_signature: "Wartet auf Signatur",
  signed: "Signiert",
  active: "Aktiv",
  expired: "Abgelaufen",
  terminated: "Gekündigt",
  archived: "Archiviert",
};
export function ContractStatusBadge({ status, className, testId }: { status: string | null | undefined; className?: string; testId?: string }) {
  const k = (status ?? "").toLowerCase();
  const tone = CONTRACT_STATUS_TONE[k] ?? "neutral";
  const label = CONTRACT_STATUS_LABEL[k] ?? status ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Quote Status ───────────────────────────────────────────────────────────
const QUOTE_STATUS_TONE: Record<string, Tone> = {
  draft: "muted",
  in_review: "info",
  approved: "success",
  sent: "info",
  accepted: "success",
  rejected: "danger",
  expired: "danger",
  superseded: "muted",
};
const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  in_review: "In Prüfung",
  approved: "Freigegeben",
  sent: "Versandt",
  accepted: "Akzeptiert",
  rejected: "Abgelehnt",
  expired: "Abgelaufen",
  superseded: "Ersetzt",
};
export function QuoteStatusBadge({ status, className, testId }: { status: string | null | undefined; className?: string; testId?: string }) {
  const k = (status ?? "").toLowerCase();
  const tone = QUOTE_STATUS_TONE[k] ?? "neutral";
  const label = QUOTE_STATUS_LABEL[k] ?? status ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Approval Status ────────────────────────────────────────────────────────
const APPROVAL_STATUS_TONE: Record<string, Tone> = {
  pending: "warning",
  in_review: "info",
  approved: "success",
  rejected: "danger",
  withdrawn: "muted",
  expired: "danger",
};
const APPROVAL_STATUS_LABEL: Record<string, string> = {
  pending: "Offen",
  in_review: "In Prüfung",
  approved: "Freigegeben",
  rejected: "Abgelehnt",
  withdrawn: "Zurückgezogen",
  expired: "Abgelaufen",
};
export function ApprovalStatusBadge({ status, className, testId }: { status: string | null | undefined; className?: string; testId?: string }) {
  const k = (status ?? "").toLowerCase();
  const tone = APPROVAL_STATUS_TONE[k] ?? "neutral";
  const label = APPROVAL_STATUS_LABEL[k] ?? status ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Signature Status ───────────────────────────────────────────────────────
const SIGNATURE_STATUS_TONE: Record<string, Tone> = {
  draft: "muted",
  in_progress: "info",
  pending: "warning",
  completed: "success",
  declined: "danger",
  expired: "danger",
  cancelled: "muted",
};
const SIGNATURE_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  in_progress: "Läuft",
  pending: "Wartet",
  completed: "Abgeschlossen",
  declined: "Abgelehnt",
  expired: "Abgelaufen",
  cancelled: "Abgebrochen",
};
export function SignatureStatusBadge({ status, className, testId }: { status: string | null | undefined; className?: string; testId?: string }) {
  const k = (status ?? "").toLowerCase();
  const tone = SIGNATURE_STATUS_TONE[k] ?? "neutral";
  const label = SIGNATURE_STATUS_LABEL[k] ?? status ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Obligation Status ──────────────────────────────────────────────────────
const OBLIGATION_STATUS_TONE: Record<string, Tone> = {
  open: "warning",
  in_progress: "info",
  completed: "success",
  overdue: "danger",
  waived: "muted",
};
const OBLIGATION_STATUS_LABEL: Record<string, string> = {
  open: "Offen",
  in_progress: "In Arbeit",
  completed: "Erfüllt",
  overdue: "Überfällig",
  waived: "Entfallen",
};
export function ObligationStatusBadge({ status, className, testId }: { status: string | null | undefined; className?: string; testId?: string }) {
  const k = (status ?? "").toLowerCase();
  const tone = OBLIGATION_STATUS_TONE[k] ?? "neutral";
  const label = OBLIGATION_STATUS_LABEL[k] ?? status ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Negotiation Status ─────────────────────────────────────────────────────
const NEGOTIATION_STATUS_TONE: Record<string, Tone> = {
  active: "info",
  on_hold: "muted",
  concluded: "success",
  lost: "danger",
};
const NEGOTIATION_STATUS_LABEL: Record<string, string> = {
  active: "Aktiv",
  on_hold: "Pausiert",
  concluded: "Abgeschlossen",
  lost: "Verloren",
};
export function NegotiationStatusBadge({ status, className, testId }: { status: string | null | undefined; className?: string; testId?: string }) {
  const k = (status ?? "").toLowerCase();
  const tone = NEGOTIATION_STATUS_TONE[k] ?? "neutral";
  const label = NEGOTIATION_STATUS_LABEL[k] ?? status ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Price Increase Status ──────────────────────────────────────────────────
const PI_STATUS_TONE: Record<string, Tone> = {
  draft: "muted",
  active: "info",
  in_progress: "info",
  completed: "success",
  cancelled: "muted",
};
const PI_STATUS_LABEL: Record<string, string> = {
  draft: "Entwurf",
  active: "Aktiv",
  in_progress: "Läuft",
  completed: "Abgeschlossen",
  cancelled: "Abgebrochen",
};
export function PriceIncreaseStatusBadge({ status, className, testId }: { status: string | null | undefined; className?: string; testId?: string }) {
  const k = (status ?? "").toLowerCase();
  const tone = PI_STATUS_TONE[k] ?? "neutral";
  const label = PI_STATUS_LABEL[k] ?? status ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Order Confirmation Status ──────────────────────────────────────────────
const OC_STATUS_TONE: Record<string, Tone> = {
  pending: "warning",
  in_progress: "info",
  ready: "info",
  handover: "warning",
  completed: "success",
  blocked: "danger",
};
const OC_STATUS_LABEL: Record<string, string> = {
  pending: "Offen",
  in_progress: "In Arbeit",
  ready: "Bereit",
  handover: "Übergabe",
  completed: "Abgeschlossen",
  blocked: "Blockiert",
};
export function OrderConfirmationStatusBadge({ status, className, testId }: { status: string | null | undefined; className?: string; testId?: string }) {
  const k = (status ?? "").toLowerCase();
  const tone = OC_STATUS_TONE[k] ?? "neutral";
  const label = OC_STATUS_LABEL[k] ?? status ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Renewal Bucket ─────────────────────────────────────────────────────────
const RENEWAL_BUCKET_TONE: Record<string, Tone> = {
  overdue: "danger",
  this_month: "warning",
  next_month: "warning",
  this_quarter: "info",
  next_quarter: "info",
  later: "muted",
};
const RENEWAL_BUCKET_LABEL: Record<string, string> = {
  overdue: "Überfällig",
  this_month: "Diesen Monat",
  next_month: "Nächster Monat",
  this_quarter: "Dieses Quartal",
  next_quarter: "Nächstes Quartal",
  later: "Später",
};
export function RenewalBucketBadge({ bucket, className, testId }: { bucket: string | null | undefined; className?: string; testId?: string }) {
  const k = (bucket ?? "").toLowerCase();
  const tone = RENEWAL_BUCKET_TONE[k] ?? "neutral";
  const label = RENEWAL_BUCKET_LABEL[k] ?? bucket ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

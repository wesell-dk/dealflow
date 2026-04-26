import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "muted";

export const TONE_CLASSES: Record<Tone, string> = {
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

// Text-only tone classes for highlighting numbers, headings, etc. without a
// full badge background. Use when a Badge is too heavy (e.g. KPI counters,
// at-risk number highlights).
export const TONE_TEXT_CLASSES: Record<Tone, string> = {
  neutral: "text-foreground",
  info: "text-sky-700 dark:text-sky-300",
  success: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-700 dark:text-amber-300",
  danger: "text-rose-700 dark:text-rose-300",
  muted: "text-muted-foreground",
};

// Icon-only tone classes (slightly brighter than text) for status icons that
// sit on a neutral background (e.g. lucide icons in card headers).
export const TONE_ICON_CLASSES: Record<Tone, string> = {
  neutral: "text-foreground",
  info: "text-sky-600 dark:text-sky-400",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-rose-600 dark:text-rose-400",
  muted: "text-muted-foreground",
};

// Solid status dot classes (filled circles indicating severity / status).
// Use for small severity / status indicators rendered as a colored dot.
export const TONE_DOT_CLASSES: Record<Tone, string> = {
  neutral: "bg-foreground",
  info: "bg-sky-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-destructive",
  muted: "bg-muted-foreground",
};

// Tinted background classes (10% opacity tone behind icons / chips).
// Use when an icon needs a soft tone-colored backdrop, not a full badge.
export const TONE_TINT_BG_CLASSES: Record<Tone, string> = {
  neutral: "bg-muted",
  info: "bg-sky-500/10",
  success: "bg-emerald-500/10",
  warning: "bg-amber-500/10",
  danger: "bg-rose-500/10",
  muted: "bg-muted/50",
};

// ─── Severity (low/medium/high) → Tone ──────────────────────────────────────
const SEVERITY_TONE: Record<string, Tone> = {
  low: "success",
  medium: "warning",
  high: "danger",
  critical: "danger",
};
export function getSeverityTone(severity: string | null | undefined): Tone {
  return SEVERITY_TONE[(severity ?? "").toLowerCase()] ?? "neutral";
}

interface ToneBadgeProps {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
  testId?: string;
  title?: string;
}

export function ToneBadge({ tone, children, className, testId, title }: ToneBadgeProps) {
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
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
export function RiskBadge({ risk, className, testId }: { risk: string | null | undefined; className?: string; testId?: string }) {
  const k = (risk ?? "medium").toLowerCase();
  const tone = RISK_TONE[k] ?? "neutral";
  const label = RISK_LABEL[k] ?? risk ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId} title={`Risk: ${label}`}>
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
  draft: "Draft",
  in_review: "In review",
  pending_signature: "Awaiting signature",
  signed: "Signed",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
  archived: "Archived",
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
  draft: "Draft",
  in_review: "In review",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
  expired: "Expired",
  superseded: "Superseded",
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
  pending: "Pending",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  expired: "Expired",
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
  draft: "Draft",
  in_progress: "In progress",
  pending: "Awaiting",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
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
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
  overdue: "Overdue",
  waived: "Waived",
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
  active: "Active",
  on_hold: "On hold",
  concluded: "Concluded",
  lost: "Lost",
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
  draft: "Draft",
  active: "Active",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
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
  pending: "Pending",
  in_progress: "In progress",
  ready: "Ready",
  handover: "Handover",
  completed: "Completed",
  blocked: "Blocked",
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
  overdue: "Overdue",
  this_month: "This month",
  next_month: "Next month",
  this_quarter: "This quarter",
  next_quarter: "Next quarter",
  later: "Later",
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

// ─── Negotiation Reaction (question/objection/counterproposal/...) ─────────
const NEGOTIATION_REACTION_TONE: Record<string, Tone> = {
  question: "info",
  objection: "warning",
  counterproposal: "info",
  acceptance: "success",
  partial: "warning",
  price_rejected: "danger",
  clause_rejected: "danger",
  term_change: "info",
  deferred: "muted",
};
const NEGOTIATION_REACTION_LABEL: Record<string, string> = {
  question: "Question",
  objection: "Objection",
  counterproposal: "Counterproposal",
  acceptance: "Accepted",
  partial: "Partial",
  price_rejected: "Price rejected",
  clause_rejected: "Clause rejected",
  term_change: "Term change",
  deferred: "Deferred",
};
export function NegotiationReactionBadge({ type, className, testId }: { type: string | null | undefined; className?: string; testId?: string }) {
  const k = (type ?? "").toLowerCase();
  const tone = NEGOTIATION_REACTION_TONE[k] ?? "neutral";
  const label = NEGOTIATION_REACTION_LABEL[k] ?? type ?? "—";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Price-Increase Counter (accepted / pending / rejected) ────────────────
export function PriceIncreaseCounterBadge({
  kind, count, label, className, testId,
}: {
  kind: "accepted" | "pending" | "rejected";
  count: number;
  label: string;
  className?: string;
  testId?: string;
}) {
  const tone: Tone = kind === "accepted" ? "success" : kind === "pending" ? "warning" : "danger";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {count} {label}
    </ToneBadge>
  );
}

// ─── Clause Tone (zart / moderat / standard / streng / hart) ───────────────
// Mapping rationale: härter = heavier risk for the counter-party position.
// "zart" = soft fallback (danger flag — concession); "hart" = strict baseline.
const CLAUSE_TONE_TONE: Record<string, Tone> = {
  zart: "danger",
  moderat: "warning",
  standard: "info",
  streng: "success",
  hart: "neutral",
};
export function ClauseToneBadge({ tone, label, className, testId }: { tone: string | null | undefined; label?: string; className?: string; testId?: string }) {
  const k = (tone ?? "").toLowerCase();
  const t = CLAUSE_TONE_TONE[k] ?? "neutral";
  return (
    <ToneBadge tone={t} className={cn("text-xs", className)} testId={testId}>
      {label ?? tone ?? "—"}
    </ToneBadge>
  );
}

// ─── Clause Suggestion Status (open / accepted / rejected) ─────────────────
const SUGGESTION_STATUS_TONE: Record<string, Tone> = {
  open: "warning",
  accepted: "success",
  rejected: "danger",
};
export function SuggestionStatusBadge({ status, label, className, testId }: { status: string | null | undefined; label?: string; className?: string; testId?: string }) {
  const k = (status ?? "").toLowerCase();
  const tone = SUGGESTION_STATUS_TONE[k] ?? "neutral";
  return (
    <ToneBadge tone={tone} className={cn("text-xs", className)} testId={testId}>
      {label ?? status ?? "—"}
    </ToneBadge>
  );
}

// ─── Clause Compatibility (requires / conflicts) ───────────────────────────
export function ClauseCompatibilityBadge({
  kind, label, className, testId,
}: {
  kind: "requires" | "conflicts";
  label: string;
  className?: string;
  testId?: string;
}) {
  const tone: Tone = kind === "conflicts" ? "danger" : "warning";
  return (
    <ToneBadge tone={tone} className={className} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Translation Status per locale (present / missing) ─────────────────────
export function TranslationStatusBadge({
  present, locale, label, className, testId,
}: {
  present: boolean;
  locale: string;
  label: string;
  className?: string;
  testId?: string;
}) {
  // present = success (DE/EN already there). missing = warning (admin must fill).
  const tone: Tone = present ? (locale.toLowerCase() === "en" ? "info" : "success") : "warning";
  return (
    <ToneBadge tone={tone} className={cn("text-xs", className)} testId={testId}>
      {locale.toUpperCase()} · {label}
    </ToneBadge>
  );
}

// ─── Override Marker (brand has an override defined) ───────────────────────
export function OverrideMarkerBadge({ label, className, testId }: { label: string; className?: string; testId?: string }) {
  return (
    <ToneBadge tone="warning" className={cn("text-xs", className)} testId={testId}>
      {label}
    </ToneBadge>
  );
}

// ─── Copilot Insight Kind helper ───────────────────────────────────────────
const INSIGHT_KIND_TONE: Record<string, Tone> = {
  Risk: "danger",
  NextAction: "warning",
  Opportunity: "success",
};
export function getInsightKindTone(kind: string | null | undefined): Tone {
  return INSIGHT_KIND_TONE[kind ?? ""] ?? "neutral";
}

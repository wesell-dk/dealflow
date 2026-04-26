import { useMemo, useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  useGetNegotiation,
  getGetNegotiationQueryKey,
  useCreateCounterproposal,
  useAddCustomerReaction,
  useCreateVersionFromReaction,
  useRequestApprovalFromReaction,
  useConcludeNegotiation,
  useListClauseFamilies,
  getListQuotesQueryKey,
  getListApprovalsQueryKey,
  getListNegotiationsQueryKey,
  type AffectedLineItem,
  type NegotiationLineItem,
  type NegotiationBaseline,
  type ClauseFamily,
  type ReactionInput,
  type CounterproposalInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  MessageSquare, AlertTriangle, RefreshCw, Check, Clock, User,
  TrendingDown, TrendingUp, Minus, FileSignature, ShieldAlert, FilePlus,
  ThumbsUp, MessageCircleQuestion, GitCompareArrows, Flag, X, FileText,
  CheckCircle2, XCircle, PauseCircle,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Breadcrumbs } from "@/components/patterns/breadcrumbs";
import { NegotiationReactionBadge, TONE_ICON_CLASSES, TONE_TEXT_CLASSES, TONE_CLASSES } from "@/components/patterns/status-badges";
import { useTranslation } from "react-i18next";

const followUpLabel: Record<string, string> = {
  new_quote_version: "Neue Angebotsversion",
  discount_approval: "Discount-Approval",
  contract_amendment: "Vertragsänderung",
  clause_change: "Klausel-Wechsel",
};

function formatCurrency(n: number | null | undefined, currency = "EUR") {
  if (n == null) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

function signed(n: number | null | undefined, suffix = "") {
  if (n == null) return "—";
  const s = n > 0 ? `+${n}` : `${n}`;
  return `${s}${suffix}`;
}

type ActionKind = "objection" | "counterproposal" | "question" | "acceptance";

interface AffectedDraft {
  lineItemId: string;
  action: "price" | "qty" | "discount" | "remove";
  newPrice?: string;
  newQty?: string;
  discountPct?: string;
}

// Mirrors the backend `applyAffectedLineItems` so the live "Neu" preview matches
// what the server will compute on save (no double-application of discount).
function newAlt(item: NegotiationLineItem, draft: AffectedDraft): { qty: number; unitPrice: number; discountPct: number; total: number; removed: boolean } {
  if (draft.action === "remove") {
    return { qty: 0, unitPrice: item.unitPrice, discountPct: item.discountPct, total: 0, removed: true };
  }
  let qty = item.quantity;
  let unitPrice = item.unitPrice;
  let discountPct = item.discountPct;
  const listPrice = item.listPrice;
  if (draft.action === "qty" && draft.newQty !== undefined && draft.newQty !== "") {
    qty = Number(draft.newQty);
  } else if (draft.action === "price" && draft.newPrice !== undefined && draft.newPrice !== "") {
    unitPrice = Number(draft.newPrice);
    discountPct = listPrice > 0
      ? Math.max(0, Math.round((1 - unitPrice / listPrice) * 10000) / 100)
      : 0;
  } else if (draft.action === "discount" && draft.discountPct !== undefined && draft.discountPct !== "") {
    discountPct = Math.max(0, Number(draft.discountPct));
    unitPrice = Math.round(listPrice * (1 - discountPct / 100) * 100) / 100;
  }
  const total = Math.round(qty * unitPrice * 100) / 100;
  return { qty, unitPrice, discountPct, total, removed: false };
}

// Aggregate live preview that mirrors backend totals (newTotal, deltas, discount, margin).
function aggregatePreview(
  items: NegotiationLineItem[],
  drafts: AffectedDraft[],
  baseline: NegotiationBaseline | null,
): {
  hasChanges: boolean;
  oldTotal: number;
  newTotal: number;
  deltaAmount: number;
  priceDeltaPct: number | null;
  newDiscountPct: number | null;
  newMarginPct: number | null;
} {
  const draftMap = new Map(drafts.filter(d => draftIsComplete(d)).map(d => [d.lineItemId, d]));
  const oldTotal = items.filter(li => li.kind === "item").reduce((s, li) => s + li.total, 0);
  let newTotal = 0;
  for (const li of items) {
    if (li.kind !== "item") continue;
    const d = draftMap.get(li.id);
    if (!d) { newTotal += li.total; continue; }
    const a = newAlt(li, d);
    newTotal += a.removed ? 0 : a.total;
  }
  newTotal = Math.round(newTotal * 100) / 100;
  const baseTotal = baseline?.totalAmount ?? oldTotal;
  const baseDiscount = baseline?.discountPct ?? null;
  const baseMargin = baseline?.marginPct ?? null;
  const priceDeltaPct = baseTotal > 0
    ? Math.round(((newTotal - baseTotal) / baseTotal) * 10000) / 100
    : null;
  const newDiscountPct = baseDiscount != null && priceDeltaPct != null
    ? Math.round(Math.max(0, baseDiscount - priceDeltaPct) * 100) / 100
    : null;
  const newMarginPct = baseMargin != null && priceDeltaPct != null
    ? Math.round((baseMargin + priceDeltaPct) * 100) / 100
    : null;
  return {
    hasChanges: draftMap.size > 0,
    oldTotal: Math.round(oldTotal * 100) / 100,
    newTotal,
    deltaAmount: Math.round((newTotal - oldTotal) * 100) / 100,
    priceDeltaPct,
    newDiscountPct,
    newMarginPct,
  };
}

function draftIsComplete(d: AffectedDraft): boolean {
  if (d.action === "remove") return true;
  if (d.action === "price") return !!d.newPrice;
  if (d.action === "qty") return !!d.newQty;
  if (d.action === "discount") return !!d.discountPct;
  return false;
}

function draftToAffected(d: AffectedDraft): AffectedLineItem | null {
  const out: AffectedLineItem = { lineItemId: d.lineItemId, action: d.action };
  if (d.action === "price") {
    if (!d.newPrice) return null;
    out.newPrice = Number(d.newPrice);
  } else if (d.action === "qty") {
    if (!d.newQty) return null;
    out.newQty = Number(d.newQty);
  } else if (d.action === "discount") {
    if (!d.discountPct) return null;
    out.discountPct = Number(d.discountPct);
  }
  return out;
}

export default function NegotiationWorkspace() {
  const { t } = useTranslation();
  const [, params] = useRoute("/negotiations/:id");
  const id = params?.id as string;
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: neg, isLoading } = useGetNegotiation(id ?? "");
  const { data: clauseFamilies } = useListClauseFamilies();

  const addReaction = useAddCustomerReaction();
  const counterprop = useCreateCounterproposal();
  const createVersion = useCreateVersionFromReaction();
  const requestApproval = useRequestApprovalFromReaction();
  const conclude = useConcludeNegotiation();

  const [openSheet, setOpenSheet] = useState<ActionKind | null>(null);
  const [confirmConclude, setConfirmConclude] = useState(false);

  const baseline = neg?.baseline ?? null;
  const lineItems = useMemo(() => neg?.lineItems ?? [], [neg?.lineItems]);
  const lineItemsById = useMemo(() => new Map(lineItems.map(li => [li.id, li])), [lineItems]);
  const impactsByReaction = useMemo(
    () => new Map((neg?.impacts ?? []).map(i => [i.reactionId, i])),
    [neg?.impacts],
  );

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!neg) return <div className="p-8">{t("pages.negotiation.notFound")}</div>;

  const isActive = neg.status === "active";
  const invalidate = () => Promise.all([
    qc.invalidateQueries({ queryKey: getGetNegotiationQueryKey(id) }),
    qc.invalidateQueries({ queryKey: getListNegotiationsQueryKey() }),
  ]);

  const handleCreateVersion = (reactionId: string) => {
    createVersion.mutate({ id, reactionId }, {
      onSuccess: () => {
        toast({ title: t("pages.negotiation.toasts.newVersion") });
        invalidate();
        qc.invalidateQueries({ queryKey: getListQuotesQueryKey() });
      },
      onError: () => toast({ title: t("pages.negotiation.toasts.newVersionError"), variant: "destructive" }),
    });
  };

  const handleRequestApproval = (reactionId: string) => {
    requestApproval.mutate({ id, reactionId, data: {} }, {
      onSuccess: (result) => {
        toast({ title: t("pages.negotiation.toasts.approvalRequested"), description: t("pages.negotiation.toasts.redirecting") });
        invalidate();
        qc.invalidateQueries({ queryKey: getListApprovalsQueryKey() });
        setLocation(`/approvals?highlight=${encodeURIComponent(result.approvalId)}`);
      },
      onError: () => toast({ title: t("pages.negotiation.toasts.approvalError"), variant: "destructive" }),
    });
  };

  const handleConclude = (outcome: "accepted" | "rejected" | "withdrawn") => {
    conclude.mutate({ id, data: { outcome } }, {
      onSuccess: () => {
        toast({ title: t(`pages.negotiation.conclude.toasts.${outcome}`) });
        invalidate();
        setConfirmConclude(false);
      },
      onError: () => toast({ title: t("pages.negotiation.conclude.toasts.error"), variant: "destructive" }),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: t("nav.negotiations"), href: "/negotiations" },
          { label: neg.dealName },
        ]}
      />
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{neg.dealName}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
            <Badge variant={isActive ? "default" : "secondary"}>
              {isActive ? t("pages.negotiation.statusActive") : neg.status}
            </Badge>
            <Badge variant="outline">{t("pages.negotiations.round", { n: neg.round })}</Badge>
            <Badge variant={neg.riskLevel === "high" ? "destructive" : "outline"}>
              {t("pages.negotiation.risk", { level: neg.riskLevel })}
            </Badge>
            {neg.outcome && (
              <Badge variant="secondary" data-testid="neg-outcome-badge">
                {t(`pages.negotiation.conclude.outcomes.${neg.outcome}`)}
              </Badge>
            )}
            {baseline && (
              <span className="text-xs">
                {t("pages.negotiation.baseline", {
                  total: formatCurrency(baseline.totalAmount, neg.quote?.currency),
                  discount: baseline.discountPct,
                  margin: baseline.marginPct,
                })}
              </span>
            )}
          </div>
        </div>
        {isActive && (
          <Popover open={confirmConclude} onOpenChange={setConfirmConclude}>
            <PopoverTrigger asChild>
              <Button variant="outline" data-testid="negotiation-conclude-btn">
                <Flag className="h-4 w-4 mr-2" />
                {t("pages.negotiation.conclude.button")}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <div className="space-y-2">
                <div className="text-sm font-medium">{t("pages.negotiation.conclude.title")}</div>
                <p className="text-xs text-muted-foreground">{t("pages.negotiation.conclude.description")}</p>
                <div className="flex flex-col gap-1.5 pt-1">
                  <Button size="sm" variant="outline" className="justify-start"
                    onClick={() => handleConclude("accepted")}
                    disabled={conclude.isPending}
                    data-testid="negotiation-conclude-accepted">
                    <CheckCircle2 className={`h-4 w-4 mr-2 ${TONE_ICON_CLASSES.success}`} />
                    {t("pages.negotiation.conclude.outcomes.accepted")}
                  </Button>
                  <Button size="sm" variant="outline" className="justify-start"
                    onClick={() => handleConclude("rejected")}
                    disabled={conclude.isPending}
                    data-testid="negotiation-conclude-rejected">
                    <XCircle className={`h-4 w-4 mr-2 ${TONE_ICON_CLASSES.danger}`} />
                    {t("pages.negotiation.conclude.outcomes.rejected")}
                  </Button>
                  <Button size="sm" variant="outline" className="justify-start"
                    onClick={() => handleConclude("withdrawn")}
                    disabled={conclude.isPending}
                    data-testid="negotiation-conclude-withdrawn">
                    <PauseCircle className={`h-4 w-4 mr-2 ${TONE_ICON_CLASSES.warning}`} />
                    {t("pages.negotiation.conclude.outcomes.withdrawn")}
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {neg.quote && (
        <Card data-testid="negotiation-linked-quote">
          <CardContent className="pt-5 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div>
                  <Link href={`/quotes/${neg.quote.id}`} className="font-semibold hover:underline">
                    {neg.quote.number}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    v{neg.quote.currentVersion} · {neg.quote.status}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-6 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">{t("pages.negotiation.quote.total")}</div>
                  <div className="font-semibold">{formatCurrency(neg.quote.totalAmount, neg.quote.currency)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("pages.negotiation.quote.discount")}</div>
                  <div className="font-semibold">{neg.quote.discountPct}%</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("pages.negotiation.quote.margin")}</div>
                  <div className="font-semibold">{neg.quote.marginPct}%</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isActive && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("pages.negotiation.actions.title")}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <ActionTile
              icon={AlertTriangle}
              label={t("pages.negotiation.actions.objection.title")}
              hint={t("pages.negotiation.actions.objection.hint")}
              onClick={() => setOpenSheet("objection")}
              testId="action-tile-objection"
              tone="text-orange-600"
            />
            <ActionTile
              icon={GitCompareArrows}
              label={t("pages.negotiation.actions.counterproposal.title")}
              hint={t("pages.negotiation.actions.counterproposal.hint")}
              onClick={() => setOpenSheet("counterproposal")}
              testId="action-tile-counterproposal"
              tone="text-purple-600"
            />
            <ActionTile
              icon={MessageCircleQuestion}
              label={t("pages.negotiation.actions.question.title")}
              hint={t("pages.negotiation.actions.question.hint")}
              onClick={() => setOpenSheet("question")}
              testId="action-tile-question"
              tone="text-blue-600"
            />
            <ActionTile
              icon={ThumbsUp}
              label={t("pages.negotiation.actions.acceptance.title")}
              hint={t("pages.negotiation.actions.acceptance.hint")}
              onClick={() => setOpenSheet("acceptance")}
              testId="action-tile-acceptance"
              tone={TONE_ICON_CLASSES.success}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-12 gap-6">
        {/* LEFT: Timeline */}
        <div className="lg:col-span-3">
          <Card className="sticky top-6">
            <CardHeader><CardTitle className="text-base">{t("pages.negotiation.timeline")}</CardTitle></CardHeader>
            <CardContent>
              {(!neg.timeline || neg.timeline.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-4">{t("pages.negotiation.noEvents")}</p>
              ) : (
                <div className="space-y-4 border-l-2 border-muted ml-2 pl-3">
                  {neg.timeline.map((event) => (
                    <div key={event.id} className="relative">
                      <div className="absolute w-2.5 h-2.5 bg-primary rounded-full -left-[17px] top-1.5" />
                      <div className="text-xs font-medium">{event.title}</div>
                      <div className="text-[11px] text-muted-foreground">{format(new Date(event.at), "dd.MM.yyyy HH:mm")}</div>
                      {event.description && <p className="text-xs text-muted-foreground mt-1">{event.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* CENTER: Reactions with impact */}
        <div className="lg:col-span-9">
          <Card>
            <CardHeader><CardTitle>{t("pages.negotiation.reactions")}</CardTitle></CardHeader>
            <CardContent>
              {(!neg.reactions || neg.reactions.length === 0) ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p>{t("pages.negotiation.empty")}</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {neg.reactions.map((r) => {
                    const impact = impactsByReaction.get(r.id);
                    let Icon = MessageSquare;
                    if (r.type === "objection" || r.type === "clause_rejected") Icon = AlertTriangle;
                    else if (r.type === "counterproposal" || r.type === "partial" || r.type === "term_change") Icon = RefreshCw;
                    else if (r.type === "acceptance") Icon = Check;

                    const TrendIcon = impact?.riskTrend === "up" ? TrendingUp
                      : impact?.riskTrend === "down" ? TrendingDown : Minus;
                    const trendColor = impact?.riskTrend === "up" ? TONE_ICON_CLASSES.danger
                      : impact?.riskTrend === "down" ? TONE_ICON_CLASSES.success : "text-muted-foreground";
                    const affected = r.affectedLineItems ?? [];

                    return (
                      <div key={r.id} className="rounded-lg border p-4 space-y-3" data-testid={`reaction-${r.id}`}>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex gap-3">
                            <div className="mt-1 bg-muted p-2 rounded-full h-fit"><Icon className="h-4 w-4" /></div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <NegotiationReactionBadge type={r.type} />
                                <h4 className="font-semibold text-base">{r.topic}</h4>
                              </div>
                              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><User className="h-3 w-3"/> {r.source}</span>
                                <span>·</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3"/> {formatDistanceToNow(new Date(r.createdAt))}</span>
                              </div>
                            </div>
                          </div>
                          <Badge variant={r.priority === "high" ? "destructive" : "secondary"}>{r.priority}</Badge>
                        </div>

                        <p className="text-sm">{r.summary}</p>

                        {affected.length > 0 && (
                          <div className="rounded border bg-muted/30 p-2">
                            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                              {t("pages.negotiation.affectedItems", { count: affected.length })}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {affected.map((a, i) => {
                                const li = lineItemsById.get(a.lineItemId);
                                return (
                                  <Badge key={i} variant="outline" className="text-[11px]">
                                    <span className="font-medium">{li?.name ?? a.lineItemId}</span>
                                    <span className="ml-1 text-muted-foreground">· {a.action}</span>
                                  </Badge>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {impact && (
                          (impact.priceDeltaPct != null || impact.termMonthsDelta != null ||
                           impact.paymentTermsDeltaDays != null || impact.requestedClauseVariantId ||
                           impact.followUps.length > 0) && (
                            <div className="rounded-md bg-muted/40 border p-3 space-y-2">
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                <TrendIcon className={`h-4 w-4 ${trendColor}`} />
                                <span>{t("pages.negotiation.impact")}</span>
                                <span className={`text-xs ${trendColor}`}>{t("pages.negotiation.riskTrend", { dir: impact.riskTrend === "up" ? "↑" : impact.riskTrend === "down" ? "↓" : "=" })}</span>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                {impact.priceDeltaPct != null && (
                                  <div>
                                    <div className="text-muted-foreground">{t("pages.negotiation.fields.price")}</div>
                                    <div className="font-semibold">{signed(impact.priceDeltaPct, "%")}</div>
                                    {impact.newTotalAmount != null && (
                                      <div className="text-muted-foreground">→ {formatCurrency(impact.newTotalAmount, neg.quote?.currency)}</div>
                                    )}
                                  </div>
                                )}
                                {impact.newDiscountPct != null && (
                                  <div>
                                    <div className="text-muted-foreground">{t("pages.negotiation.fields.newDiscount")}</div>
                                    <div className="font-semibold">{impact.newDiscountPct}%</div>
                                  </div>
                                )}
                                {impact.newMarginPct != null && (
                                  <div>
                                    <div className="text-muted-foreground">{t("pages.negotiation.fields.margin")}</div>
                                    <div className="font-semibold">{impact.newMarginPct}%</div>
                                    {impact.marginDeltaPct != null && (
                                      <div className="text-muted-foreground">{signed(impact.marginDeltaPct, "pp")}</div>
                                    )}
                                  </div>
                                )}
                                {impact.termMonthsDelta != null && (
                                  <div>
                                    <div className="text-muted-foreground">{t("pages.negotiation.fields.term")}</div>
                                    <div className="font-semibold">{signed(impact.termMonthsDelta, " " + t("pages.negotiation.units.months"))}</div>
                                  </div>
                                )}
                                {impact.paymentTermsDeltaDays != null && (
                                  <div>
                                    <div className="text-muted-foreground">{t("pages.negotiation.fields.paymentTerms")}</div>
                                    <div className="font-semibold">{signed(impact.paymentTermsDeltaDays, " " + t("pages.negotiation.units.days"))}</div>
                                  </div>
                                )}
                                {impact.requestedClauseVariantId && (
                                  <div>
                                    <div className="text-muted-foreground">{t("pages.negotiation.fields.clauseSwap")}</div>
                                    <div className="font-semibold">{impact.requestedClauseVariantId}</div>
                                  </div>
                                )}
                                {impact.affectedLineItemsCount != null && impact.affectedLineItemsCount > 0 && (
                                  <div>
                                    <div className="text-muted-foreground">{t("pages.negotiation.fields.scope")}</div>
                                    <div className="font-semibold">{t("pages.negotiation.affectedItemsShort", { count: impact.affectedLineItemsCount })}</div>
                                  </div>
                                )}
                              </div>

                              {impact.followUps.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                  {impact.followUps.map(f => (
                                    <Badge key={f} variant="secondary" className="text-[11px]">
                                      {followUpLabel[f] ?? f}
                                    </Badge>
                                  ))}
                                </div>
                              )}

                              {impact.approvalsTriggered.length > 0 && (
                                <div className={`flex items-start gap-2 rounded border p-2 text-xs ${TONE_CLASSES.warning}`}>
                                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                                  <div>
                                    {impact.approvalsTriggered.map((a, i) => (
                                      <div key={i}><strong>{a.type}:</strong> {a.reason}</div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="flex flex-wrap gap-2 pt-1">
                                {impact.priceDeltaPct != null && !impact.linkedQuoteVersionId && (
                                  <Button size="sm" variant="outline" disabled={createVersion.isPending}
                                    onClick={() => handleCreateVersion(r.id)}
                                    data-testid={`reaction-create-version-${r.id}`}>
                                    <FilePlus className="h-3.5 w-3.5 mr-1" /> {t("pages.negotiation.cta.newVersion")}
                                  </Button>
                                )}
                                {impact.linkedQuoteVersionId && (
                                  <Badge variant="outline" className="text-[11px]">
                                    <FileSignature className="h-3 w-3 mr-1" /> {t("pages.negotiation.cta.versionLinked", { id: impact.linkedQuoteVersionId })}
                                  </Badge>
                                )}
                                {impact.approvalsTriggered.length > 0 && !impact.linkedApprovalId && (
                                  <Button size="sm" variant="outline" disabled={requestApproval.isPending}
                                    onClick={() => handleRequestApproval(r.id)}>
                                    <ShieldAlert className="h-3.5 w-3.5 mr-1" /> {t("pages.negotiation.cta.requestApproval")}
                                  </Button>
                                )}
                                {impact.linkedApprovalId && (
                                  <Badge variant="outline" className="text-[11px]">
                                    <ShieldAlert className="h-3 w-3 mr-1" /> {t("pages.negotiation.cta.approvalLinked", { id: impact.linkedApprovalId })}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ReactionSheet
        kind={openSheet}
        onClose={() => setOpenSheet(null)}
        onSubmit={async (kind, payload, opts) => {
          try {
            if (kind === "counterproposal") {
              const r = await counterprop.mutateAsync({ id, data: payload as CounterproposalInput });
              await invalidate();
              qc.invalidateQueries({ queryKey: getListQuotesQueryKey() });
              toast({
                description: r.linkedQuoteVersionId
                  ? t("pages.negotiation.toasts.counterWithVersion")
                  : t("pages.negotiation.toasts.counterSaved"),
              });
            } else {
              const r = await addReaction.mutateAsync({ id, data: payload as ReactionInput });
              await invalidate();
              if (opts?.alsoCreateVersion) {
                try {
                  await createVersion.mutateAsync({ id, reactionId: r.id });
                  await invalidate();
                  qc.invalidateQueries({ queryKey: getListQuotesQueryKey() });
                  toast({ description: t("pages.negotiation.toasts.reactionWithVersion") });
                } catch (versionErr) {
                  toast({
                    title: t("pages.negotiation.toasts.newVersionError"),
                    description: versionErr instanceof Error ? versionErr.message : String(versionErr),
                    variant: "destructive",
                  });
                }
              } else {
                toast({ description: t("pages.negotiation.toasts.reactionSaved") });
              }
            }
            setOpenSheet(null);
          } catch (e) {
            toast({
              title: t("pages.negotiation.toasts.saveError"),
              description: e instanceof Error ? e.message : String(e),
              variant: "destructive",
            });
          }
        }}
        lineItems={lineItems}
        baseline={baseline}
        clauseFamilies={clauseFamilies ?? []}
        currency={neg.quote?.currency ?? "EUR"}
        pending={addReaction.isPending || counterprop.isPending || createVersion.isPending}
      />
    </div>
  );
}

function ActionTile({ icon: Icon, label, hint, onClick, testId, tone }:
  { icon: typeof MessageSquare; label: string; hint: string; onClick: () => void; testId: string; tone: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="text-left rounded-lg border p-3 hover:bg-muted/40 hover:border-primary/40 transition-colors flex flex-col gap-1.5"
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${tone}`} />
        <span className="text-sm font-semibold">{label}</span>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </button>
  );
}

type ReactionSubmitOptions = { alsoCreateVersion?: boolean };
type ReactionPayload = ReactionInput | CounterproposalInput;

function ReactionSheet({
  kind, onClose, onSubmit, lineItems, baseline, clauseFamilies, currency, pending,
}: {
  kind: ActionKind | null;
  onClose: () => void;
  onSubmit: (kind: ActionKind, payload: ReactionPayload, opts?: ReactionSubmitOptions) => void | Promise<void>;
  lineItems: NegotiationLineItem[];
  baseline: NegotiationBaseline | null;
  clauseFamilies: ClauseFamily[];
  currency: string;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [topic, setTopic] = useState("");
  const [summary, setSummary] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState("medium");
  const [priceDeltaPct, setPriceDeltaPct] = useState("");
  const [termMonthsDelta, setTermMonthsDelta] = useState("");
  const [paymentTermsDeltaDays, setPaymentTermsDeltaDays] = useState("");
  const [requestedClauseVariantId, setRequestedClauseVariantId] = useState("");
  const [createNewVersion, setCreateNewVersion] = useState(false);
  const [drafts, setDrafts] = useState<AffectedDraft[]>([]);
  const [pickerLi, setPickerLi] = useState("");

  const open = kind !== null;
  const allowsLineItems = kind === "objection" || kind === "counterproposal";
  const allowsClause = kind === "objection" || kind === "counterproposal";
  const allowsStructuredDeltas = kind === "counterproposal";

  function reset() {
    setTopic(""); setSummary(""); setSource(""); setPriority("medium");
    setPriceDeltaPct(""); setTermMonthsDelta(""); setPaymentTermsDeltaDays("");
    setRequestedClauseVariantId(""); setCreateNewVersion(false);
    setDrafts([]); setPickerLi("");
  }

  function handleOpenChange(v: boolean) {
    if (!v) {
      reset();
      onClose();
    }
  }

  function addDraft() {
    if (!pickerLi) return;
    if (drafts.some(d => d.lineItemId === pickerLi)) return;
    setDrafts(d => [...d, { lineItemId: pickerLi, action: "price", newPrice: "" }]);
    setPickerLi("");
  }

  function updateDraft(idx: number, patch: Partial<AffectedDraft>) {
    setDrafts(d => d.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  }

  function removeDraft(idx: number) {
    setDrafts(d => d.filter((_, i) => i !== idx));
  }

  function buildPayload(): { payload: ReactionPayload; affectedCount: number } | null {
    if (!kind) return null;
    const affectedLineItems: AffectedLineItem[] = drafts
      .map(draftToAffected)
      .filter((x): x is AffectedLineItem => x !== null);

    if (kind === "counterproposal") {
      const counter: CounterproposalInput = { topic, summary, source, priority };
      if (priceDeltaPct) counter.priceDeltaPct = Number(priceDeltaPct);
      if (termMonthsDelta) counter.termMonthsDelta = Number(termMonthsDelta);
      if (paymentTermsDeltaDays) counter.paymentTermsDeltaDays = Number(paymentTermsDeltaDays);
      if (requestedClauseVariantId) counter.requestedClauseVariantId = requestedClauseVariantId;
      if (affectedLineItems.length > 0) counter.affectedLineItems = affectedLineItems;
      counter.createNewVersion = createNewVersion;
      return { payload: counter, affectedCount: affectedLineItems.length };
    }

    const type = kind === "objection" ? "objection"
      : kind === "question" ? "question"
      : "acceptance";
    const reaction: ReactionInput = { type, topic, summary, source, priority };
    if (requestedClauseVariantId) reaction.requestedClauseVariantId = requestedClauseVariantId;
    if (affectedLineItems.length > 0) reaction.affectedLineItems = affectedLineItems;
    return { payload: reaction, affectedCount: affectedLineItems.length };
  }

  function submit(alsoCreateVersion: boolean) {
    if (!kind) return;
    const built = buildPayload();
    if (!built) return;
    onSubmit(kind, built.payload, alsoCreateVersion ? { alsoCreateVersion: true } : undefined);
  }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submit(false);
  }

  // Aggregate live preview across all complete drafts (mirrors backend math).
  const preview = useMemo(
    () => aggregatePreview(lineItems, drafts, baseline),
    [lineItems, drafts, baseline],
  );
  // Dual-action only relevant for objections with at least one completed line-item draft.
  const allowsSaveAndVersion = kind === "objection" && preview.hasChanges;

  const title = kind ? t(`pages.negotiation.actions.${kind}.title`) : "";
  const description = kind ? t(`pages.negotiation.actions.${kind}.description`) : "";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>{t("pages.negotiation.fields.topic")}</Label>
            <Input value={topic} onChange={e => setTopic(e.target.value)} required data-testid="reaction-topic" />
          </div>
          <div className="space-y-2">
            <Label>{t("pages.negotiation.fields.summary")}</Label>
            <Textarea value={summary} onChange={e => setSummary(e.target.value)} required rows={3} data-testid="reaction-summary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>{t("pages.negotiation.fields.source")}</Label>
              <Input value={source} onChange={e => setSource(e.target.value)} required data-testid="reaction-source" />
            </div>
            <div className="space-y-2">
              <Label>{t("pages.negotiation.fields.priority")}</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger data-testid="reaction-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t("pages.negotiation.priority.low")}</SelectItem>
                  <SelectItem value="medium">{t("pages.negotiation.priority.medium")}</SelectItem>
                  <SelectItem value="high">{t("pages.negotiation.priority.high")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {allowsLineItems && (
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("pages.negotiation.fields.affectedItems")}
              </Label>
              <div className="flex gap-2">
                <Select value={pickerLi} onValueChange={setPickerLi}>
                  <SelectTrigger data-testid="reaction-line-item-picker">
                    <SelectValue placeholder={t("pages.negotiation.fields.pickItem")} />
                  </SelectTrigger>
                  <SelectContent>
                    {lineItems.filter(li => li.kind === "item").map(li => (
                      <SelectItem key={li.id} value={li.id} disabled={drafts.some(d => d.lineItemId === li.id)}>
                        {li.name} · {formatCurrency(li.total, currency)}
                      </SelectItem>
                    ))}
                    {lineItems.filter(li => li.kind === "item").length === 0 && (
                      <SelectItem value="__empty__" disabled>{t("pages.negotiation.fields.noItems")}</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" onClick={addDraft} disabled={!pickerLi} data-testid="reaction-line-item-add">
                  {t("common.add")}
                </Button>
              </div>
              {drafts.length > 0 && preview.hasChanges && (
                <div
                  className={`rounded-md border p-3 space-y-1.5 ${TONE_CLASSES.info}`}
                  data-testid="reaction-aggregate-preview"
                >
                  <div className="text-xs uppercase tracking-wide font-semibold">
                    {t("pages.negotiation.fields.aggregateImpact")}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div>
                      <div className="opacity-80">{t("pages.negotiation.lineItem.alt")}</div>
                      <div className="font-semibold">{formatCurrency(preview.oldTotal, currency)}</div>
                    </div>
                    <div>
                      <div className="opacity-80">{t("pages.negotiation.lineItem.neu")}</div>
                      <div
                        className={`font-semibold ${preview.deltaAmount < 0 ? TONE_TEXT_CLASSES.danger : preview.deltaAmount > 0 ? TONE_TEXT_CLASSES.success : ""}`}
                        data-testid="reaction-aggregate-new-total"
                      >
                        {formatCurrency(preview.newTotal, currency)}
                      </div>
                      <div className="opacity-80">
                        {signed(+preview.deltaAmount.toFixed(2))} €
                        {preview.priceDeltaPct != null && <> · {signed(preview.priceDeltaPct, "%")}</>}
                      </div>
                    </div>
                    {preview.newDiscountPct != null && (
                      <div>
                        <div className="opacity-80">{t("pages.negotiation.fields.newDiscount")}</div>
                        <div className="font-semibold">{preview.newDiscountPct}%</div>
                      </div>
                    )}
                    {preview.newMarginPct != null && (
                      <div>
                        <div className="opacity-80">{t("pages.negotiation.fields.margin")}</div>
                        <div className="font-semibold">{preview.newMarginPct}%</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {drafts.length > 0 && (
                <div className="space-y-2">
                  {drafts.map((d, i) => {
                    const li = lineItems.find(x => x.id === d.lineItemId);
                    if (!li) return null;
                    const alt = newAlt(li, d);
                    const delta = alt.total - li.total;
                    return (
                      <div key={d.lineItemId} className="rounded border p-2 space-y-2 bg-muted/20" data-testid={`reaction-line-${d.lineItemId}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-sm">{li.name}</div>
                          <Button type="button" size="sm" variant="ghost"
                            onClick={() => removeDraft(i)}
                            data-testid={`reaction-line-remove-${d.lineItemId}`}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <Select value={d.action} onValueChange={(v) => updateDraft(i, { action: v as AffectedDraft["action"] })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="price">{t("pages.negotiation.lineItem.actions.price")}</SelectItem>
                              <SelectItem value="qty">{t("pages.negotiation.lineItem.actions.qty")}</SelectItem>
                              <SelectItem value="discount">{t("pages.negotiation.lineItem.actions.discount")}</SelectItem>
                              <SelectItem value="remove">{t("pages.negotiation.lineItem.actions.remove")}</SelectItem>
                            </SelectContent>
                          </Select>
                          {d.action === "price" && (
                            <Input type="number" step="0.01" value={d.newPrice ?? ""} placeholder={String(li.unitPrice)}
                              onChange={e => updateDraft(i, { newPrice: e.target.value })} />
                          )}
                          {d.action === "qty" && (
                            <Input type="number" step="1" value={d.newQty ?? ""} placeholder={String(li.quantity)}
                              onChange={e => updateDraft(i, { newQty: e.target.value })} />
                          )}
                          {d.action === "discount" && (
                            <Input type="number" step="0.1" value={d.discountPct ?? ""} placeholder={String(li.discountPct)}
                              onChange={e => updateDraft(i, { discountPct: e.target.value })} />
                          )}
                          {d.action === "remove" && (
                            <div className="text-xs text-muted-foreground self-center">{t("pages.negotiation.lineItem.removeNote")}</div>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs border-t pt-1.5">
                          <div>
                            <div className="text-muted-foreground">{t("pages.negotiation.lineItem.alt")}</div>
                            <div>{li.quantity} × {formatCurrency(li.unitPrice, currency)} − {li.discountPct}%</div>
                            <div className="font-semibold">{formatCurrency(li.total, currency)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">{t("pages.negotiation.lineItem.neu")}</div>
                            {alt.removed ? (
                              <div className={`line-through ${TONE_TEXT_CLASSES.danger}`}>{formatCurrency(li.total, currency)}</div>
                            ) : (
                              <>
                                <div>{alt.qty} × {formatCurrency(alt.unitPrice, currency)} − {alt.discountPct}%</div>
                                <div className={`font-semibold ${delta < 0 ? TONE_TEXT_CLASSES.danger : delta > 0 ? TONE_TEXT_CLASSES.success : ""}`}>
                                  {formatCurrency(alt.total, currency)} <span className="text-[10px]">({signed(+delta.toFixed(2))})</span>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {allowsStructuredDeltas && (
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                {t("pages.negotiation.fields.structured")}
              </Label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t("pages.negotiation.fields.priceDelta")}</Label>
                  <Input type="number" step="0.1" value={priceDeltaPct} onChange={e => setPriceDeltaPct(e.target.value)} placeholder="-7" data-testid="reaction-price-delta" />
                </div>
                <div>
                  <Label className="text-xs">{t("pages.negotiation.fields.termDelta")}</Label>
                  <Input type="number" value={termMonthsDelta} onChange={e => setTermMonthsDelta(e.target.value)} placeholder="12" />
                </div>
                <div>
                  <Label className="text-xs">{t("pages.negotiation.fields.paymentDelta")}</Label>
                  <Input type="number" value={paymentTermsDeltaDays} onChange={e => setPaymentTermsDeltaDays(e.target.value)} placeholder="30" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs mt-2">
                <input type="checkbox" checked={createNewVersion} onChange={e => setCreateNewVersion(e.target.checked)} data-testid="reaction-create-version-checkbox" />
                {t("pages.negotiation.fields.createNewVersion")}
              </label>
            </div>
          )}

          {allowsClause && (
            <div className="border-t pt-3 space-y-2">
              <Label className="text-xs">{t("pages.negotiation.fields.clauseVariant")}</Label>
              <Select value={requestedClauseVariantId || "__none__"} onValueChange={(v) => setRequestedClauseVariantId(v === "__none__" ? "" : v)}>
                <SelectTrigger data-testid="reaction-clause-variant"><SelectValue placeholder={t("pages.negotiation.fields.pickClause")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("common.none")}</SelectItem>
                  {clauseFamilies.flatMap((fam: { id: string; name: string; variants: { id: string; name: string; severity: string }[] }) =>
                    fam.variants.map(v => (
                      <SelectItem key={v.id} value={v.id}>
                        {fam.name} – {v.name} ({v.severity})
                      </SelectItem>
                    )),
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

          <SheetFooter className="pt-2 gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={pending || !topic || !summary || !source} data-testid="reaction-submit">
              {pending ? t("common.saving") : t("common.save")}
            </Button>
            {allowsSaveAndVersion && (
              <Button
                type="button"
                variant="default"
                disabled={pending || !topic || !summary || !source}
                onClick={() => submit(true)}
                data-testid="reaction-submit-with-version"
              >
                <FilePlus className="h-3.5 w-3.5 mr-1" />
                {t("pages.negotiation.cta.saveAndCreateVersion")}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

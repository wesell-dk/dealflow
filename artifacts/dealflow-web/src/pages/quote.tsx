import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetQuote,
  useListQuoteAttachments,
  usePatchQuote,
  useConvertQuoteToOrder,
  useTransitionQuote,
  getGetQuoteQueryKey,
  getListQuotesQueryKey,
  getListOrderConfirmationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Download,
  Paperclip,
  Languages,
  ClipboardCheck,
  AlertTriangle,
  Send,
  CheckCircle2,
  XCircle,
  ChevronDown,
  History,
} from "lucide-react";
import { QuoteDuplicateButton } from "@/components/quotes/quote-duplicate-button";
import { SendQuoteDialog } from "@/components/quotes/send-quote-dialog";
import { QuoteEditor } from "@/components/quote-editor";
import { QuotePreview } from "@/components/quotes/quote-preview";
import { useToast } from "@/hooks/use-toast";
import { useTabState } from "@/hooks/use-tab-state";
import { AiPromptPanel } from "@/components/copilot/ai-prompt-panel";
import { ActivityTimeline } from "@/components/patterns/activity-timeline";
import { Breadcrumbs } from "@/components/patterns/breadcrumbs";
import { QuoteStatusBadge } from "@/components/patterns/status-badges";

type TransitionTarget = "sent" | "accepted" | "rejected";

export default function Quote() {
  const params = useParams();
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const id = params.id as string;
  const { data: quote, isLoading } = useGetQuote(id);
  const versionId = quote?.versions?.[0]?.id ?? "";
  const { data: attachments } = useListQuoteAttachments(versionId, {
    query: { enabled: !!versionId, queryKey: ["quoteAttachments", versionId] },
  });
  const patchQuote = usePatchQuote();
  const convertMutation = useConvertQuoteToOrder();
  const transition = useTransitionQuote();
  const [convertOpen, setConvertOpen] = useState(false);
  const [expectedDelivery, setExpectedDelivery] = useState("");
  const [conflict, setConflict] = useState<
    | { id: string; number: string }
    | null
  >(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [tab, setTab] = useTabState("overview");

  async function changeLanguage(next: "de" | "en") {
    if (!quote || quote.language === next) return;
    try {
      await patchQuote.mutateAsync({ id, data: { language: next } });
      await qc.invalidateQueries({ queryKey: getGetQuoteQueryKey(id) });
      toast({ description: t("pages.quote.languageChanged") });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  }

  async function doConvert(force = false) {
    try {
      const oc = await convertMutation.mutateAsync({
        id,
        data: {
          expectedDelivery: expectedDelivery ? expectedDelivery : undefined,
          force,
        },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetQuoteQueryKey(id) }),
        qc.invalidateQueries({ queryKey: getListOrderConfirmationsQueryKey() }),
      ]);
      toast({ description: t("pages.quote.convertSuccess", { number: oc.number }) });
      setConvertOpen(false);
      setConflict(null);
      setExpectedDelivery("");
      navigate(`/order-confirmations/${oc.id}`);
    } catch (e: unknown) {
      // Conflict — duplicate. Backend returns 409 with { error, existing }.
      const err = e as { status?: number; response?: { status?: number; data?: { existing?: { id: string; number: string } } }; data?: { existing?: { id: string; number: string } } };
      const status = err?.status ?? err?.response?.status;
      const existing = err?.response?.data?.existing ?? err?.data?.existing;
      if (status === 409 && existing) {
        setConflict({ id: existing.id, number: existing.number });
        return;
      }
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function runTransition(target: TransitionTarget, rejectionReason?: string) {
    try {
      await transition.mutateAsync({
        id,
        data: { status: target, ...(rejectionReason !== undefined ? { rejectionReason } : {}) },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetQuoteQueryKey(id) }),
        qc.invalidateQueries({ queryKey: getListQuotesQueryKey() }),
      ]);
      toast({ description: t(`pages.quote.statusChanged.${target}`) });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  }

  function openReject() {
    setRejectReason("");
    setRejectOpen(true);
  }

  async function confirmReject() {
    const reason = rejectReason.trim();
    setRejectOpen(false);
    await runTransition("rejected", reason || undefined);
  }

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!quote) return <div className="p-8">Quote not found</div>;

  const canConvert = quote.status === "accepted";
  const linkedOrders = quote.orderConfirmations ?? [];
  const versions = quote.versions ?? [];

  const displayStatus = (quote as { displayStatus?: string }).displayStatus ?? quote.status;
  const canEdit = (quote as { canEdit?: boolean }).canEdit === true;
  const rejectionReason = (quote as { rejectionReason?: string | null }).rejectionReason ?? null;

  // Aktionen werden nur am echten DB-Status berechnet (nicht am abgeleiteten
  // 'expired'). Ein abgelaufenes Angebot bleibt intern 'sent' und kann immer
  // noch akzeptiert/abgelehnt werden, falls es nachträglich behandelt wurde.
  const actions: Array<{ key: TransitionTarget; label: string; icon: typeof Send; testId: string }> = [];
  if (canEdit) {
    if (quote.status === "draft") {
      actions.push({ key: "sent", label: t("pages.quote.markAsSent"), icon: Send, testId: "quote-mark-sent" });
    }
    if (quote.status === "sent") {
      actions.push({ key: "accepted", label: t("pages.quote.markAsAccepted"), icon: CheckCircle2, testId: "quote-mark-accepted" });
      actions.push({ key: "rejected", label: t("pages.quote.markAsRejected"), icon: XCircle, testId: "quote-mark-rejected" });
    }
  }

  const taxSummary = (quote as {
    taxSummary?: {
      net: number;
      tax: number;
      gross: number;
      breakdown: { ratePct: number; net: number; tax: number }[];
    };
  }).taxSummary;

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: t("nav.quotes"), href: "/quotes" },
          { label: `${t("common.quote")} ${quote.number}` },
        ]}
      />
      <div className="sticky top-0 z-20 -mx-4 px-4 md:-mx-6 md:px-6 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b pb-4 pt-2 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">{t("common.quote")} {quote.number}</h1>
            <p className="text-muted-foreground mt-1">{quote.dealName}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Languages className="h-4 w-4 text-muted-foreground" />
              <Select value={quote.language ?? "de"} onValueChange={(v) => changeLanguage(v as "de" | "en")}>
                <SelectTrigger className="h-8 w-[120px]" data-testid="quote-language-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="de">DE</SelectItem>
                  <SelectItem value="en">EN</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={() => window.open(`/api/quotes/${id}/pdf`, '_blank')}>
              <FileText className="h-4 w-4 mr-2" /> {t("pages.quote.openPdf")}
            </Button>
            <SendQuoteDialog
              quoteId={quote.id}
              quoteNumber={quote.number}
              dealId={quote.dealId}
              language={quote.language === "en" ? "en" : "de"}
            />
            <QuoteDuplicateButton quoteId={quote.id} quoteNumber={quote.number} />
            {canConvert && (
              <Button
                size="sm"
                onClick={() => { setConflict(null); setConvertOpen(true); }}
                data-testid="quote-convert-to-order-btn"
              >
                <ClipboardCheck className="h-4 w-4 mr-2" />
                {t("pages.quote.convertToOrder")}
              </Button>
            )}
            {actions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    disabled={transition.isPending}
                    data-testid="quote-status-menu"
                  >
                    <QuoteStatusBadge status={displayStatus} testId="quote-status-badge" />
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {actions.map(({ key, label, icon: Icon, testId }) => (
                    <DropdownMenuItem
                      key={key}
                      data-testid={testId}
                      onSelect={() => {
                        if (key === "rejected") openReject();
                        else void runTransition(key);
                      }}
                    >
                      <Icon className="h-4 w-4 mr-2" />
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <QuoteStatusBadge status={displayStatus} testId="quote-status-badge" />
            )}
          </div>
        </div>
        {quote.sentAt && (
          <div
            className="rounded-md border bg-muted/40 px-4 py-2 text-sm text-muted-foreground flex flex-wrap gap-x-4 gap-y-1"
            data-testid="quote-sent-info"
          >
            <span>
              <strong className="text-foreground">{t("pages.quote.send.lastSent")}:</strong>{" "}
              {new Date(quote.sentAt).toLocaleString()}
            </span>
            {quote.sentTo && (
              <span>
                <strong className="text-foreground">{t("pages.quote.send.sentTo")}:</strong>{" "}
                {quote.sentTo}
              </span>
            )}
          </div>
        )}
      </div>

      {displayStatus === "rejected" && rejectionReason && (
        <Card className="border-rose-200 bg-rose-50/50 dark:border-rose-900/50 dark:bg-rose-950/20">
          <CardContent className="py-3">
            <div className="text-xs font-medium uppercase text-rose-700 dark:text-rose-300">
              {t("pages.quote.rejectionReasonLabel")}
            </div>
            <div className="mt-1 text-sm text-rose-900 dark:text-rose-100" data-testid="quote-rejection-reason">
              {rejectionReason}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="w-full md:w-auto h-auto flex overflow-x-auto whitespace-nowrap justify-start" data-testid="quote-tabs">
          <TabsTrigger value="overview" data-testid="quote-tab-overview">
            {t("pages.quote.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="items" data-testid="quote-tab-items">
            {t("pages.quote.tabs.items")}
          </TabsTrigger>
          <TabsTrigger value="attachments" data-testid="quote-tab-attachments">
            {t("pages.quote.tabs.attachments")}
            {attachments && attachments.length > 0 && (
              <Badge variant="secondary" className="ml-2">{attachments.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="quote-tab-activity">
            {t("pages.quote.tabs.activity")}
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="quote-tab-history">
            {t("pages.quote.tabs.history")}
          </TabsTrigger>
          <TabsTrigger value="orders" data-testid="quote-tab-orders">
            {t("pages.quote.tabs.linkedOrders")}
            {linkedOrders.length > 0 && (
              <Badge variant="secondary" className="ml-2">{linkedOrders.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4" data-testid="quote-tabpanel-overview">
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-2 space-y-6">
              <AiPromptPanel mode="pricing.review" entityId={id} />
              <div data-testid="quote-pdf-preview">
                <QuotePreview
                  quoteNumber={quote.number}
                  currency={quote.currency}
                  validUntil={quote.validUntil}
                  language={quote.language ?? "de"}
                  dealId={quote.dealId}
                  dealName={quote.dealName}
                  lines={(quote.lineItems ?? []).map((li) => ({
                    id: li.id,
                    kind: li.kind === "heading" ? "heading" : "item",
                    name: li.name,
                    description: li.description ?? "",
                    quantity: li.quantity,
                    listPrice: li.listPrice ?? li.unitPrice ?? 0,
                    unitPrice: li.unitPrice,
                    discountPct: li.discountPct,
                    total: li.total,
                    taxRatePct:
                      (li as { taxRatePct?: number | null }).taxRatePct ?? null,
                  }))}
                  taxSummary={taxSummary ?? null}
                  notes={(quote as { notes?: string | null }).notes ?? null}
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(`/api/quotes/${id}/pdf`, "_blank")
                    }
                    data-testid="quote-open-pdf"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    {t("pages.quote.openPdf")}
                  </Button>
                </div>
              </div>
            </div>
            <div>
              <Card>
                <CardHeader><CardTitle>{t("pages.quote.summary")}</CardTitle></CardHeader>
                <CardContent className="space-y-2" data-testid="quote-summary-card">
                  {!taxSummary ? (
                    <div className="flex justify-between">
                      <span>{t("common.total")}:</span>{" "}
                      <strong>
                        {quote.totalAmount.toLocaleString()} {quote.currency}
                      </strong>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span>{t("pages.quote.netto")}:</span>{" "}
                        <strong className="tabular-nums">
                          {taxSummary.net.toLocaleString()} {quote.currency}
                        </strong>
                      </div>
                      {taxSummary.breakdown.map((b) => (
                        <div
                          key={b.ratePct}
                          className="flex justify-between text-sm text-muted-foreground"
                          data-testid={`quote-tax-row-${b.ratePct}`}
                        >
                          <span>
                            {b.ratePct === 0
                              ? t("pages.quote.vatExempt")
                              : t("pages.quote.vatAt", {
                                  pct: (Math.round(b.ratePct * 100) / 100).toLocaleString(),
                                })}
                          </span>
                          <span className="tabular-nums">
                            {b.tax.toLocaleString()} {quote.currency}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-between border-t pt-2">
                        <span className="font-semibold">
                          {t("pages.quote.brutto")}:
                        </span>{" "}
                        <strong className="tabular-nums">
                          {taxSummary.gross.toLocaleString()} {quote.currency}
                        </strong>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between"><span>{t("common.discount")}:</span> <strong>{quote.discountPct}%</strong></div>
                  <div className="flex justify-between"><span>{t("pages.quote.margin")}:</span> <strong>{quote.marginPct}%</strong></div>
                  <div className="flex justify-between"><span>{t("common.validUntil")}:</span> <strong>{new Date(quote.validUntil).toLocaleDateString()}</strong></div>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="items" className="mt-4" data-testid="quote-tabpanel-items">
          {quote.status === "draft" ? (
            <QuoteEditor quoteId={id} />
          ) : (
            <div className="space-y-3">
              <QuotePreview
                quoteNumber={quote.number}
                currency={quote.currency}
                validUntil={quote.validUntil}
                language={quote.language ?? "de"}
                dealId={quote.dealId}
                dealName={quote.dealName}
                lines={(quote.lineItems ?? []).map((li) => ({
                  id: li.id,
                  kind: li.kind === "heading" ? "heading" : "item",
                  name: li.name,
                  description: li.description ?? "",
                  quantity: li.quantity,
                  listPrice: li.listPrice ?? li.unitPrice ?? 0,
                  unitPrice: li.unitPrice,
                  discountPct: li.discountPct,
                  total: li.total,
                  taxRatePct:
                    (li as { taxRatePct?: number | null }).taxRatePct ?? null,
                }))}
                taxSummary={taxSummary ?? null}
                notes={(quote as { notes?: string | null }).notes ?? null}
                testId="quote-readonly-preview"
              />
              {/* Hidden anchors preserve stable per-line testids that earlier
                  read-only views surfaced for Playwright/RTL compatibility. */}
              <div className="sr-only" aria-hidden>
                {quote.lineItems.map((item) => (
                  <span key={item.id} data-testid={`quote-line-${item.id}`}>
                    {item.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="attachments" className="mt-4" data-testid="quote-tabpanel-attachments">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                {t("pages.quote.attachments")}
                {attachments && attachments.length > 0 && (
                  <Badge variant="secondary">{attachments.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!attachments || attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("pages.quote.noAttachments")}</p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded-md border p-3" data-testid={`quote-attachment-${a.id}`}>
                      <div className="flex-1">
                        <div className="font-medium text-sm">{a.name}</div>
                        {a.label && <div className="text-xs text-muted-foreground">{a.label}</div>}
                        <div className="mt-1 text-xs text-muted-foreground">
                          {a.mimeType} · {(a.size / 1024).toFixed(0)} KB
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const path = a.objectPath.startsWith("/objects/")
                            ? `/api/storage${a.objectPath}`
                            : a.objectPath;
                          window.open(path, "_blank");
                        }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4" data-testid="quote-tabpanel-activity">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4" />
                {t("pages.quote.tabs.activity")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityTimeline entityType="quote" entityId={id} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4" data-testid="quote-tabpanel-history">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-4 w-4" />
                {t("pages.quote.tabs.history")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("pages.quote.tabs.noVersions")}</p>
              ) : (
                <ol className="space-y-3">
                  {versions.map((v) => (
                    <li
                      key={v.id}
                      className="border-l-2 pl-3 py-1 border-primary/40"
                      data-testid={`quote-version-${v.id}`}
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <Badge variant="outline">v{v.version}</Badge>
                        <Badge variant="secondary">{v.status}</Badge>
                        <span className="text-muted-foreground tabular-nums">
                          {v.totalAmount.toLocaleString()} {quote.currency}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(v.createdAt).toLocaleString()}
                        {" · "}
                        {t("common.discount")}: {v.discountPct}%
                        {" · "}
                        {t("pages.quote.margin")}: {v.marginPct}%
                      </div>
                      {v.notes && (
                        <div className="text-xs mt-1 text-muted-foreground italic">{v.notes}</div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="orders" className="mt-4" data-testid="quote-tabpanel-orders">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4" />
                {t("pages.quote.linkedOrders")}
                {linkedOrders.length > 0 && (
                  <Badge variant="secondary">{linkedOrders.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {linkedOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("pages.quote.tabs.noLinkedOrders")}</p>
              ) : (
                <div className="space-y-2">
                  {linkedOrders.map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between rounded-md border p-3"
                      data-testid={`quote-linked-oc-${o.id}`}
                    >
                      <div>
                        <Link
                          href={`/order-confirmations/${o.id}`}
                          className="font-medium underline hover:text-foreground"
                        >
                          {o.number}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {t(`pages.orderConfirmations.status.${o.status}`, o.status)}
                          {" · "}
                          {new Date(o.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <Link href={`/order-confirmations/${o.id}`}>
                        <Button variant="outline" size="sm">
                          {t("pages.quote.openOrder")}
                        </Button>
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={convertOpen} onOpenChange={(o) => { setConvertOpen(o); if (!o) setConflict(null); }}>
        <DialogContent data-testid="quote-convert-dialog">
          <DialogHeader>
            <DialogTitle>{t("pages.quote.convertDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("pages.quote.convertDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          {conflict ? (
            <div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
              <div>
                <div className="font-medium">
                  {t("pages.quote.convertExistsTitle")}
                </div>
                <div className="text-muted-foreground">
                  {t("pages.quote.convertExistsBody", { number: conflict.number })}
                </div>
                <div className="mt-2">
                  <Link
                    href={`/order-confirmations/${conflict.id}`}
                    className="underline"
                  >
                    {t("pages.quote.openOrder")} ({conflict.number})
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 py-2">
              <div className="rounded-md border p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("common.total")}:</span>
                  <strong>{quote.totalAmount.toLocaleString()} {quote.currency}</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("pages.quote.margin")}:</span>
                  <strong>{quote.marginPct}%</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t("common.discount")}:</span>
                  <strong>{quote.discountPct}%</strong>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="expected-delivery">
                  {t("pages.quote.convertExpectedDelivery")}
                </Label>
                <Input
                  id="expected-delivery"
                  type="date"
                  value={expectedDelivery}
                  onChange={(e) => setExpectedDelivery(e.target.value)}
                  data-testid="quote-convert-expected-delivery"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setConvertOpen(false); setConflict(null); }}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => doConvert(conflict !== null)}
              disabled={convertMutation.isPending}
              data-testid="quote-convert-confirm"
            >
              {conflict ? t("pages.quote.convertForce") : t("pages.quote.convertConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent data-testid="quote-reject-dialog">
          <DialogHeader>
            <DialogTitle>{t("pages.quote.rejectDialogTitle")}</DialogTitle>
            <DialogDescription>{t("pages.quote.rejectDialogBody")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t("pages.quote.rejectReasonPlaceholder")}
            rows={4}
            maxLength={2000}
            data-testid="quote-reject-reason"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)} data-testid="quote-reject-cancel">
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmReject}
              disabled={transition.isPending}
              data-testid="quote-reject-confirm"
            >
              {t("pages.quote.rejectConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

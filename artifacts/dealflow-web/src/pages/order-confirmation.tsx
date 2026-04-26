import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetOrderConfirmation,
  useHandoverOrderConfirmation,
  useCompleteOrderConfirmation,
  useSendOrderConfirmationToCustomer,
  useListUsers,
  getGetOrderConfirmationQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Breadcrumbs } from "@/components/patterns/breadcrumbs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  ArrowLeft, CheckCircle2, AlertTriangle, XCircle, Clock,
  ArrowRightCircle, UserCheck, Timer, AlertOctagon, Flag, CheckCheck, Send,
  FileText,
} from "lucide-react";

// Task #237: Statuskette enthält jetzt sent_to_customer zwischen
// ready_for_handover und in_onboarding (Send → Vertrag-Draft entsteht).
const STEPS = [
  "preparing",
  "checks_pending",
  "ready_for_handover",
  "sent_to_customer",
  "in_onboarding",
  "completed",
] as const;
type Step = typeof STEPS[number];

const checkIcon = (status: string) => {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  if (status === "blocked") return <XCircle className="h-4 w-4 text-rose-600" />;
  return <Clock className="h-4 w-4 text-muted-foreground" />;
};

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  if (s === "completed" || s === "in_onboarding") return "default";
  if (s === "sent_to_customer" || s === "ready_for_handover") return "secondary";
  if (s === "checks_pending") return "outline";
  return "outline";
};

export default function OrderConfirmationDetail() {
  const [, params] = useRoute("/order-confirmations/:id");
  const id = params?.id ?? "";
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useGetOrderConfirmation(id);
  const { data: users } = useListUsers();
  const handover = useHandoverOrderConfirmation();
  const complete = useCompleteOrderConfirmation();
  const send = useSendOrderConfirmationToCustomer();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    onboardingOwnerId: "",
    contactName: "",
    contactEmail: "",
    deliveryDate: "",
    note: "",
    criticalNotes: "",
  });
  const [sendOpen, setSendOpen] = useState(false);
  const [sendForm, setSendForm] = useState({ recipientEmail: "", note: "" });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (!data) return <p className="text-sm text-muted-foreground">{t("common.noData")}</p>;

  const currentStepIdx = STEPS.indexOf(data.status as Step);
  // Task #237: Send ist nur ab ready_for_handover möglich (Pflicht-Checks ok).
  const canSend = data.status === "ready_for_handover" && data.handoverReady;
  // Handover ist ab sent_to_customer möglich; ältere Statuswerte bleiben für
  // Backwards-Compat erlaubt, falls /send (z. B. via API) übersprungen wurde.
  const handoverAllowed =
    data.status === "sent_to_customer" ||
    data.status === "ready_for_handover" ||
    data.status === "checks_pending";
  const canHandover = handoverAllowed && data.handoverReady;
  const canComplete = data.status === "in_onboarding";

  const submitHandover = async () => {
    if (!form.onboardingOwnerId || !form.contactName || !form.contactEmail || !form.deliveryDate) return;
    await handover.mutateAsync({ id, data: form });
    qc.invalidateQueries({ queryKey: getGetOrderConfirmationQueryKey(id) });
    setDialogOpen(false);
  };

  const [sendError, setSendError] = useState<string | null>(null);
  const submitSend = async () => {
    setSendError(null);
    try {
      await send.mutateAsync({
        id,
        data: {
          recipientEmail: sendForm.recipientEmail.trim(),
          note: sendForm.note.trim() || null,
        },
      });
      qc.invalidateQueries({ queryKey: getGetOrderConfirmationQueryKey(id) });
      setSendOpen(false);
      setSendForm({ recipientEmail: "", note: "" });
    } catch (err) {
      const detail = (err as { detail?: string; error?: string; message?: string } | undefined);
      setSendError(detail?.detail || detail?.error || detail?.message || t("pages.orderConfirmations.sendFailedGeneric"));
      // Trotzdem invalidieren, damit der Banner mit sendStatus=failed sichtbar wird.
      qc.invalidateQueries({ queryKey: getGetOrderConfirmationQueryKey(id) });
    }
  };

  const retrySend = async () => {
    if (!data?.sentToCustomerEmail) {
      // Ohne früheren Empfänger den Dialog öffnen.
      setSendForm({ recipientEmail: "", note: data?.sentToCustomerNote ?? "" });
      setSendOpen(true);
      return;
    }
    setSendError(null);
    try {
      await send.mutateAsync({
        id,
        data: {
          recipientEmail: data.sentToCustomerEmail,
          note: data.sentToCustomerNote ?? null,
        },
      });
      qc.invalidateQueries({ queryKey: getGetOrderConfirmationQueryKey(id) });
    } catch (err) {
      const detail = (err as { detail?: string; error?: string; message?: string } | undefined);
      setSendError(detail?.detail || detail?.error || detail?.message || t("pages.orderConfirmations.sendFailedGeneric"));
      qc.invalidateQueries({ queryKey: getGetOrderConfirmationQueryKey(id) });
    }
  };

  const doComplete = async () => {
    await complete.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getGetOrderConfirmationQueryKey(id) });
  };

  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString(i18n.resolvedLanguage) : "—";

  return (
    <>
      <Breadcrumbs
        className="mb-3"
        items={[
          { label: t("nav.orderConfirmations"), href: "/order-confirmations" },
          { label: data.number },
        ]}
      />
      <div className="flex items-center gap-3">
        <Link href="/order-confirmations">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            {data.number}
            <Badge variant={statusVariant(data.status)}>
              {t(`pages.orderConfirmations.status.${data.status}`, data.status)}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            {data.dealName}
            {data.sourceQuoteId && data.sourceQuoteNumber && (
              <>
                {" · "}
                <Link
                  href={`/quotes/${data.sourceQuoteId}`}
                  className="underline hover:text-foreground"
                  data-testid="oc-source-quote-link"
                >
                  {t("common.quote")} {data.sourceQuoteNumber}
                </Link>
              </>
            )}
            {data.contractId && data.contractNumber && (
              <>
                {" · "}
                <Link
                  href={`/contracts/${data.contractId}`}
                  className="underline hover:text-foreground"
                  data-testid="oc-linked-contract-link"
                >
                  <FileText className="inline h-3.5 w-3.5 mr-1" />
                  {data.contractNumber}
                </Link>
              </>
            )}
          </p>
        </div>
        {/* Task #237: Send-to-customer Aktion (legt Vertrag-Draft an) */}
        {(data.status === "ready_for_handover" || data.status === "sent_to_customer") && (
          <Dialog open={sendOpen} onOpenChange={(o) => { setSendOpen(o); if (!o) setSendError(null); }}>
            <DialogTrigger asChild>
              <Button
                variant={data.status === "sent_to_customer" ? "outline" : "default"}
                disabled={data.status === "sent_to_customer" || !canSend}
                data-testid="oc-send-button"
                title={data.status === "sent_to_customer"
                  ? t("pages.orderConfirmations.alreadySent")
                  : !canSend ? t("pages.orderConfirmations.handoverBlocked") : undefined}
              >
                <Send className="h-4 w-4 mr-2" />
                {data.status === "sent_to_customer"
                  ? t("pages.orderConfirmations.sentToCustomer")
                  : t("pages.orderConfirmations.sendToCustomer")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("pages.orderConfirmations.sendDialogTitle")}</DialogTitle>
                <DialogDescription>{t("pages.orderConfirmations.sendDialogDescription")}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="grid gap-1.5">
                  <Label>{t("pages.orderConfirmations.recipientEmail")}</Label>
                  <Input
                    type="email"
                    value={sendForm.recipientEmail}
                    onChange={e => setSendForm({ ...sendForm, recipientEmail: e.target.value })}
                    placeholder="customer@example.com"
                    data-testid="oc-send-recipient-input"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("pages.orderConfirmations.sendNote")}</Label>
                  <Textarea
                    rows={2}
                    value={sendForm.note}
                    onChange={e => setSendForm({ ...sendForm, note: e.target.value })}
                    data-testid="oc-send-note-input"
                  />
                </div>
              </div>
              {sendError && (
                <div
                  className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-900"
                  data-testid="oc-send-error"
                >
                  {sendError}
                </div>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => { setSendOpen(false); setSendError(null); }}>{t("common.cancel")}</Button>
                <Button
                  onClick={submitSend}
                  disabled={send.isPending || !sendForm.recipientEmail.trim()}
                  data-testid="oc-send-confirm"
                >
                  {t("pages.orderConfirmations.confirmSend")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {(data.status === "preparing" || data.status === "checks_pending" || data.status === "ready_for_handover" || data.status === "sent_to_customer") && (
          <Dialog open={dialogOpen} onOpenChange={(o) => canHandover && setDialogOpen(o)}>
            <DialogTrigger asChild>
              <Button
                disabled={!canHandover}
                title={!canHandover
                  ? (data.escalations.length > 0
                      ? `${t("pages.orderConfirmations.handoverBlocked")}: ${data.escalations.map(e => e.label).join(", ")}`
                      : t("pages.orderConfirmations.handoverBlocked"))
                  : undefined}
              >
                <ArrowRightCircle className="h-4 w-4 mr-2" />
                {t("pages.orderConfirmations.startHandover")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("pages.orderConfirmations.handoverDialogTitle")}</DialogTitle>
                <DialogDescription>
                  {t("pages.orderConfirmations.handoverDialogDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-2">
                <div className="grid gap-1.5">
                  <Label>{t("pages.orderConfirmations.onboardingOwner")}</Label>
                  <Select value={form.onboardingOwnerId} onValueChange={v => setForm({ ...form, onboardingOwnerId: v })}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {(users ?? []).map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.name} — {u.role}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>{t("pages.orderConfirmations.contactName")}</Label>
                    <Input value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("pages.orderConfirmations.contactEmail")}</Label>
                    <Input type="email" value={form.contactEmail} onChange={e => setForm({ ...form, contactEmail: e.target.value })} />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("pages.orderConfirmations.deliveryDate")}</Label>
                  <Input type="date" value={form.deliveryDate} onChange={e => setForm({ ...form, deliveryDate: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("pages.orderConfirmations.handoverNote")}</Label>
                  <Textarea rows={2} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("pages.orderConfirmations.criticalNotes")}</Label>
                  <Textarea rows={2} value={form.criticalNotes} onChange={e => setForm({ ...form, criticalNotes: e.target.value })} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
                <Button onClick={submitHandover} disabled={handover.isPending}>
                  {t("pages.orderConfirmations.confirmHandover")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {data.status === "in_onboarding" && (
          <Button onClick={doComplete} disabled={!canComplete || complete.isPending}>
            <CheckCheck className="h-4 w-4 mr-2" />
            {t("pages.orderConfirmations.markComplete")}
          </Button>
        )}
      </div>

      {/* Status-Stepper */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 overflow-x-auto">
            {STEPS.map((s, i) => {
              const isCurrent = i === currentStepIdx;
              const isDone = i < currentStepIdx;
              return (
                <div key={s} className="flex items-center gap-2 shrink-0">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs ${
                    isDone ? "bg-primary/20 text-primary" :
                    isCurrent ? "bg-primary text-primary-foreground font-medium" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {isDone ? <CheckCircle2 className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border-2 border-current" />}
                    {t(`pages.orderConfirmations.status.${s}`, s)}
                  </div>
                  {i < STEPS.length - 1 && <div className="h-px w-6 bg-border" />}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Escalation Banner for blocked required checks */}
      {data.escalations.length > 0 && data.status !== "completed" && (
        <Card className="border-rose-300 bg-rose-50/50 dark:bg-rose-950/20">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertOctagon className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="font-medium text-sm text-rose-900 dark:text-rose-100">
                {t("pages.orderConfirmations.escalationBanner", { count: data.escalations.length })}
              </div>
              <ul className="text-xs space-y-0.5 text-rose-800 dark:text-rose-200">
                {data.escalations.map(e => (
                  <li key={e.checkId}>• <span className="font-medium">{e.label}</span>: {e.reason}</li>
                ))}
              </ul>
              {data.salesOwnerName && (
                <div className="text-xs text-rose-700 dark:text-rose-300 mt-1">
                  {t("pages.orderConfirmations.escalationOwner")}: {data.salesOwnerName}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Send-Failure Banner mit Retry */}
      {data.sendStatus === "failed" && (
        <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertOctagon className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-1">
              <div className="font-medium text-sm text-amber-900 dark:text-amber-100">
                {t("pages.orderConfirmations.sendFailedTitle")}
              </div>
              <div className="text-xs text-amber-800 dark:text-amber-200 break-words">
                {data.sendError || t("pages.orderConfirmations.sendFailedGeneric")}
              </div>
              {data.lastSendAttemptAt && (
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  {t("pages.orderConfirmations.sendFailedLastAttempt", {
                    when: new Date(data.lastSendAttemptAt).toLocaleString(),
                    attempts: data.sendAttempts ?? 1,
                  })}
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={retrySend}
              disabled={send.isPending}
              data-testid="button-retry-send"
            >
              <Send className="h-3.5 w-3.5 mr-1.5" />
              {t("pages.orderConfirmations.retrySend")}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("pages.orderConfirmations.readiness")}</CardTitle></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold tabular-nums">{data.readinessScore}%</div>
            <Progress value={data.readinessScore} className="h-2 mt-2" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("pages.orderConfirmations.activeOwner")}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-primary" />
              <div>
                <div className="text-sm font-medium">
                  {data.activeOwner === "onboarding"
                    ? (data.onboardingOwnerName ?? "—")
                    : (data.salesOwnerName ?? "—")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {data.activeOwner === "onboarding"
                    ? t("pages.orderConfirmations.owner.onboarding")
                    : t("pages.orderConfirmations.owner.sales")}
                </div>
              </div>
            </div>
            {data.salesOwnerName && data.activeOwner === "onboarding" && (
              <div className="text-xs text-muted-foreground mt-2">
                {t("pages.orderConfirmations.owner.sales")}: {data.salesOwnerName}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("pages.orderConfirmations.sla")}</CardTitle></CardHeader>
          <CardContent>
            {data.handoverStartedAt ? (
              <>
                <div className="flex items-center gap-2">
                  <Timer className={`h-5 w-5 ${data.slaBreached ? "text-rose-600" : "text-emerald-600"}`} />
                  <div>
                    <div className={`text-sm font-medium ${data.slaBreached ? "text-rose-700 dark:text-rose-300" : ""}`}>
                      {t("pages.orderConfirmations.slaRunning", { days: data.daysSinceHandover ?? 0, sla: data.slaDays })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("pages.orderConfirmations.slaDeadline")}: {fmtDate(data.slaDeadline)}
                    </div>
                  </div>
                </div>
                {data.slaBreached && (
                  <Badge variant="destructive" className="mt-2">
                    <Flag className="h-3 w-3 mr-1" />
                    {t("pages.orderConfirmations.slaBreached")}
                  </Badge>
                )}
              </>
            ) : (
              <div className="text-sm text-muted-foreground">
                {t("pages.orderConfirmations.slaNotStarted", { sla: data.slaDays })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Handover note */}
      {data.status === "in_onboarding" || data.status === "completed" ? (
        <Card>
          <CardHeader><CardTitle className="text-base">{t("pages.orderConfirmations.handoverSummary")}</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground tracking-wide">{t("pages.orderConfirmations.contactName")}</div>
                <div className="font-medium">{data.handoverContact ?? "—"}</div>
                <div className="text-xs text-muted-foreground">{data.handoverContactEmail ?? ""}</div>
              </div>
              <div>
                <div className="text-xs uppercase text-muted-foreground tracking-wide">{t("pages.orderConfirmations.deliveryDate")}</div>
                <div className="font-medium">{fmtDate(data.handoverDeliveryDate)}</div>
              </div>
            </div>
            {data.handoverNote && (
              <div>
                <div className="text-xs uppercase text-muted-foreground tracking-wide">{t("pages.orderConfirmations.handoverNote")}</div>
                <p className="mt-1">{data.handoverNote}</p>
              </div>
            )}
            {data.handoverCriticalNotes && (
              <div className="rounded-md border border-amber-300 bg-amber-50/50 dark:bg-amber-950/20 p-3">
                <div className="text-xs uppercase text-amber-800 dark:text-amber-200 tracking-wide flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {t("pages.orderConfirmations.criticalNotes")}
                </div>
                <p className="mt-1 text-sm">{data.handoverCriticalNotes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Financial + delivery summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("pages.orderConfirmations.total")}</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">
              {new Intl.NumberFormat(i18n.resolvedLanguage, { style: "currency", currency: data.currency }).format(data.totalAmount)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium text-muted-foreground">{t("pages.orderConfirmations.delivery")}</CardTitle></CardHeader>
          <CardContent>
            <div className="text-lg">{fmtDate(data.expectedDelivery)}</div>
            {data.handoverAt && (
              <div className="text-xs text-muted-foreground mt-1">
                {t("pages.orderConfirmations.handedOverAt")}: {new Date(data.handoverAt).toLocaleString(i18n.resolvedLanguage)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Checks */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t("pages.orderConfirmations.handoverChecklist")}</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {data.checks.map(c => (
              <li key={c.id} className="flex items-start gap-3 py-3">
                {checkIcon(c.status)}
                <div className="flex-1">
                  <div className="text-sm font-medium flex items-center gap-2">
                    {c.label}
                    {!c.required && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {t("pages.orderConfirmations.optional")}
                      </Badge>
                    )}
                  </div>
                  {c.detail && <div className="text-xs text-muted-foreground mt-0.5">{c.detail}</div>}
                </div>
                <Badge variant={c.status === "ok" ? "secondary" : c.status === "blocked" ? "destructive" : "outline"}>
                  {t(`pages.orderConfirmations.checkStatus.${c.status}`, c.status)}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

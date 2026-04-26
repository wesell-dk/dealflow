import { useRoute, Link, useLocation } from "wouter";
import { useState } from "react";
import {
  useGetSignaturePackage,
  getGetSignaturePackageQueryKey,
  getListSignaturePackagesQueryKey,
  getListOrderConfirmationsQueryKey,
  useSendSignatureReminder,
  useDeclineSigner,
  useEscalateSignaturePackage,
  useSignSigner,
  type Signer,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Check, Clock, Mail, Bell, AlertOctagon, UserPlus, PenTool,
  Eye, XCircle, ArrowRight, Send,
} from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Breadcrumbs } from "@/components/patterns/breadcrumbs";
import { useTranslation } from "react-i18next";
import { de } from "date-fns/locale";

const statusBadge: Record<string, { label: string; cls: string; icon: React.ComponentType<{className?: string}> }> = {
  pending:  { label: "Pending",   cls: "bg-slate-100 text-slate-700 border-slate-200",   icon: Clock },
  sent:     { label: "Sent",      cls: "bg-blue-50 text-blue-700 border-blue-200",       icon: Send },
  viewed:   { label: "Viewed",    cls: "bg-amber-50 text-amber-700 border-amber-200",    icon: Eye },
  signed:   { label: "Signed",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: Check },
  declined: { label: "Declined",  cls: "bg-rose-50 text-rose-700 border-rose-200",       icon: XCircle },
};

const packageStatusBadge: Record<string, { label: string; variant: "secondary" | "default" | "outline" | "destructive" }> = {
  draft:       { label: "Draft",       variant: "outline" },
  in_progress: { label: "In progress", variant: "default" },
  completed:   { label: "Completed",   variant: "secondary" },
  blocked:     { label: "Blocked",     variant: "destructive" },
};

export default function SignatureDetail() {
  const { t } = useTranslation();
  const [, params] = useRoute("/signatures/:id");
  const id = params?.id as string;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: pkg, isLoading } = useGetSignaturePackage(id ?? "");

  const sendReminder = useSendSignatureReminder();
  const decline = useDeclineSigner();
  const escalate = useEscalateSignaturePackage();
  const sign = useSignSigner();

  const [declineTarget, setDeclineTarget] = useState<Signer | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [fallback, setFallback] = useState({ name: "", email: "", role: "" });

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!pkg) return <div className="p-8">Signature package not found.</div>;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetSignaturePackageQueryKey(id) });
    qc.invalidateQueries({ queryKey: getListSignaturePackagesQueryKey() });
  };

  const pkgStatus = packageStatusBadge[pkg.status] ?? { label: pkg.status, variant: "outline" as const };
  const declinedSigner = pkg.signers?.find(s => s.status === "declined");
  const waitingName = pkg.waitingOnSignerName;
  const waitingHours = pkg.waitingSinceHours ?? 0;
  const nextReminder = pkg.nextReminderAt ? new Date(pkg.nextReminderAt) : null;
  const escalateAt = pkg.escalationAt ? new Date(pkg.escalationAt) : null;

  const handleReminder = () => {
    sendReminder.mutate({ id }, {
      onSuccess: () => { toast({ title: "Reminder sent" }); invalidate(); },
      onError: () => toast({ title: "Reminder could not be sent", variant: "destructive" }),
    });
  };

  const handleSign = (signerId: string) => {
    sign.mutate({ id: signerId }, {
      onSuccess: (res) => {
        toast({ title: "Signature recorded" });
        invalidate();
        if (res.status === "completed" && res.orderConfirmationId) {
          qc.invalidateQueries({ queryKey: getListOrderConfirmationsQueryKey() });
          toast({ title: "Order confirmation created", description: `OC ${res.orderConfirmationId}` });
        }
      },
      onError: () => toast({ title: "Signature failed", variant: "destructive" }),
    });
  };

  const submitDecline = () => {
    if (!declineTarget) return;
    decline.mutate({ id: declineTarget.id, data: { reason: declineReason || undefined } }, {
      onSuccess: () => {
        toast({ title: "Signature declined – package blocked" });
        setDeclineTarget(null); setDeclineReason("");
        invalidate();
      },
      onError: () => toast({ title: "Decline could not be recorded", variant: "destructive" }),
    });
  };

  const submitEscalate = () => {
    if (!fallback.name.trim() || !fallback.email.trim()) {
      toast({ title: "Name and email required", variant: "destructive" }); return;
    }
    escalate.mutate({
      id,
      data: {
        fallbackName: fallback.name,
        fallbackEmail: fallback.email,
        fallbackRole: fallback.role || "Fallback Signer",
        replacesSignerId: declinedSigner?.id,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Fallback signer activated" });
        setEscalateOpen(false); setFallback({ name: "", email: "", role: "" });
        invalidate();
      },
      onError: () => toast({ title: "Escalation failed", variant: "destructive" }),
    });
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto w-full">
      <Breadcrumbs
        items={[
          { label: t("nav.signatures"), href: "/signatures" },
          { label: pkg.title },
        ]}
      />
      <div className="flex flex-col gap-2 border-b pb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{pkg.title}</h1>
            <div className="flex items-center gap-3 text-muted-foreground mt-2 text-sm">
              <span className="font-medium text-foreground">{pkg.dealName}</span>
              <span>&bull;</span>
              <Badge variant="outline" className="font-normal">
                {pkg.mode === "parallel" ? "Parallel" : "Sequential"}
              </Badge>
              <span>&bull;</span>
              <span>Deadline: {pkg.deadline ? format(new Date(pkg.deadline), "dd.MM.yyyy") : "—"}</span>
            </div>
          </div>
          <Badge variant={pkgStatus.variant} className="text-sm px-3 py-1">{pkgStatus.label}</Badge>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Progress</div>
            <div className="text-2xl font-bold">{pkg.signedCount} / {pkg.totalSigners}</div>
            <Progress value={(pkg.signedCount / Math.max(1, pkg.totalSigners)) * 100} className="h-2 mt-2" />
          </CardContent></Card>

          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Waiting on</div>
            {pkg.status === "completed" ? (
              <div className="text-sm font-medium text-emerald-700">All signatures complete</div>
            ) : pkg.status === "blocked" ? (
              <div className="text-sm font-medium text-rose-700">Blocked by rejection</div>
            ) : waitingName ? (
              <>
                <div className="text-sm font-semibold">{waitingName}</div>
                <div className="text-xs text-muted-foreground">for {Math.round(waitingHours / 24)} days ({waitingHours}h)</div>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">—</div>
            )}
          </CardContent></Card>

          <Card><CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Reminder / escalation</div>
            <div className="text-xs">Interval: {pkg.reminderIntervalHours}h, escalation after {pkg.escalationAfterHours}h</div>
            {nextReminder && pkg.status === "in_progress" && (
              <div className="text-xs mt-1 text-muted-foreground">
                Next reminder: {formatDistanceToNowStrict(nextReminder, { addSuffix: true, locale: de })}
              </div>
            )}
            {escalateAt && pkg.status === "in_progress" && (
              <div className="text-xs text-muted-foreground">
                Escalation window: {formatDistanceToNowStrict(escalateAt, { addSuffix: true, locale: de })}
              </div>
            )}
          </CardContent></Card>
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {pkg.status === "in_progress" && (
            <Button onClick={handleReminder} disabled={sendReminder.isPending} size="sm">
              <Bell className="h-4 w-4 mr-2" /> Send reminder now
            </Button>
          )}
          {pkg.status === "blocked" && declinedSigner && (
            <Dialog open={escalateOpen} onOpenChange={setEscalateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  <UserPlus className="h-4 w-4 mr-2" /> Escalate: fallback signer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Activate fallback signer</DialogTitle>
                  <DialogDescription>
                    Replaces <span className="font-medium">{declinedSigner.name}</span> ({declinedSigner.role}).
                    Decline reason: {declinedSigner.declineReason ?? "—"}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 py-2">
                  <div className="space-y-1">
                    <Label htmlFor="fbName">Name</Label>
                    <Input id="fbName" value={fallback.name} onChange={e => setFallback({ ...fallback, name: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="fbEmail">Email</Label>
                    <Input id="fbEmail" type="email" value={fallback.email} onChange={e => setFallback({ ...fallback, email: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="fbRole">Role</Label>
                    <Input id="fbRole" placeholder="e.g. Deputy CFO" value={fallback.role} onChange={e => setFallback({ ...fallback, role: e.target.value })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEscalateOpen(false)}>Cancel</Button>
                  <Button onClick={submitEscalate} disabled={escalate.isPending}>Activate</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {pkg.status === "completed" && pkg.orderConfirmationId && (
            <Button size="sm" variant="outline" onClick={() => setLocation(`/order-confirmations/${pkg.orderConfirmationId}`)}>
              <ArrowRight className="h-4 w-4 mr-2" /> Open order confirmation ({pkg.orderConfirmationId})
            </Button>
          )}
        </div>

        {pkg.status === "blocked" && (
          <div className="mt-4 border border-rose-200 bg-rose-50 rounded-md p-3 text-sm flex gap-2 items-start">
            <AlertOctagon className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-rose-900">Package blocked</div>
              <div className="text-rose-800/80">
                A signature was declined. Activate a fallback signer to continue.
              </div>
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xl font-bold mb-4">Signer order</h3>

        <div className="space-y-3">
          {pkg.signers?.slice().sort((a, b) => a.order - b.order).map((signer) => {
            const b = statusBadge[signer.status] ?? statusBadge.pending!;
            const Icon = b.icon;
            const canAct = pkg.status === "in_progress" && (signer.status === "sent" || signer.status === "viewed" || signer.status === "pending");
            return (
              <Card key={signer.id} className={signer.status === "signed" ? "border-emerald-200 bg-emerald-50/40"
                : signer.status === "declined" ? "border-rose-200 bg-rose-50/40" : ""}>
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="mt-1 flex items-center justify-center w-9 h-9 rounded-full border-2 bg-background shrink-0 font-medium text-sm">
                      {signer.status === "signed" ? <Check className="w-4 h-4 text-emerald-600" /> :
                       signer.status === "declined" ? <XCircle className="w-4 h-4 text-rose-600" /> :
                       signer.order}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{signer.name}</span>
                        <Badge variant="outline" className="text-xs">{signer.role}</Badge>
                        {signer.isFallback && <Badge variant="outline" className="text-xs bg-amber-50 text-amber-700 border-amber-200">Fallback</Badge>}
                        <Badge variant="outline" className={`text-xs ${b.cls}`}>
                          <Icon className="w-3 h-3 mr-1 inline" />
                          {b.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {signer.email}</span>
                        {signer.sentAt && <span>Sent {format(new Date(signer.sentAt), "dd.MM. HH:mm")}</span>}
                        {signer.viewedAt && <span>Viewed {format(new Date(signer.viewedAt), "dd.MM. HH:mm")}</span>}
                        {signer.signedAt && <span className="text-emerald-700">Signed {format(new Date(signer.signedAt), "dd.MM. HH:mm")}</span>}
                        {signer.lastReminderAt && <span>Last reminder {format(new Date(signer.lastReminderAt), "dd.MM. HH:mm")}</span>}
                      </div>
                      {signer.status === "declined" && signer.declineReason && (
                        <div className="text-xs text-rose-800 mt-1">Reason: {signer.declineReason}</div>
                      )}
                    </div>
                  </div>

                  {canAct && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => handleSign(signer.id)} disabled={sign.isPending}>
                        <PenTool className="h-3 w-3 mr-1" /> Capture signature
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setDeclineTarget(signer); setDeclineReason(""); }}>
                        <XCircle className="h-3 w-3 mr-1" /> Decline
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={!!declineTarget} onOpenChange={(open) => { if (!open) setDeclineTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline signature</DialogTitle>
            <DialogDescription>
              {declineTarget?.name} ({declineTarget?.role}) — the package will move to status "Blocked".
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="declReason">Reason (optional)</Label>
            <Textarea id="declReason" value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclineTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={submitDecline} disabled={decline.isPending}>Decline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex justify-end">
        <Button variant="ghost" asChild><Link href="/signatures">Back to list</Link></Button>
      </div>
    </div>
  );
}

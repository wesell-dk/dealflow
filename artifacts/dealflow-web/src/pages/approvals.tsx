import { useTranslation } from "react-i18next";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListApprovals,
  useDecideApproval,
  getListApprovalsQueryKey,
  useListMyDelegations,
  useCreateMyDelegation,
  useUpdateMyDelegation,
  useDeleteMyDelegation,
  useListUsers,
  getListMyDelegationsQueryKey,
  type ApprovalCase,
  type ApprovalStage,
  type UserDelegation,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CardGridSkeleton } from "@/components/patterns/skeletons";
import { Checkbox } from "@/components/ui/checkbox";
import { AiPromptPanel } from "@/components/copilot/ai-prompt-panel";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Clock, CheckCircle2, XCircle, AlertCircle, ChevronRight, UserCog, Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { BulkActionBar } from "@/components/patterns/bulk-action-bar";
import { useToast } from "@/hooks/use-toast";

function StageStepper({ stages, currentIdx }: { stages: ApprovalStage[]; currentIdx: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {stages.map((s, i) => {
        const isActive = i === currentIdx;
        const color =
          s.status === "approved" ? "bg-green-500/15 text-green-700 border-green-300" :
          s.status === "rejected" ? "bg-red-500/15 text-red-700 border-red-300" :
          isActive ? "bg-primary/15 text-primary border-primary/40 font-medium" :
          "bg-muted text-muted-foreground border-border";
        return (
          <div key={`${s.order}-${i}`} className="flex items-center gap-2">
            <div className={`px-2 py-1 rounded border ${color}`} data-testid={`stage-${i}-${s.status}`}>
              <span className="opacity-70 mr-1">{i + 1}.</span>{s.label}
              {s.status === "approved" && <CheckCircle2 className="inline ml-1 h-3 w-3" />}
              {s.status === "rejected" && <XCircle className="inline ml-1 h-3 w-3" />}
              {s.delegatedFromName && (
                <span className="ml-2 italic opacity-80">i.A. {s.delegatedFromName}</span>
              )}
            </div>
            {i < stages.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        );
      })}
    </div>
  );
}

function MyDelegationsCard() {
  const qc = useQueryClient();
  const { data: delegations } = useListMyDelegations();
  const { data: users } = useListUsers();
  const createDelegation = useCreateMyDelegation();
  const updateDelegation = useUpdateMyDelegation();
  const deleteDelegation = useDeleteMyDelegation();
  const [open, setOpen] = useState(false);
  const [toUserId, setToUserId] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [reason, setReason] = useState("");

  const refresh = () => qc.invalidateQueries({ queryKey: getListMyDelegationsQueryKey() });

  const handleCreate = () => {
    if (!toUserId || !validFrom || !validUntil) return;
    createDelegation.mutate(
      { data: {
        toUserId,
        validFrom: new Date(validFrom).toISOString(),
        validUntil: new Date(validUntil).toISOString(),
        reason: reason || null,
      } },
      { onSuccess: () => { refresh(); setOpen(false); setToUserId(""); setValidFrom(""); setValidUntil(""); setReason(""); } },
    );
  };

  const out = delegations?.outgoing ?? [];
  const inc = delegations?.incoming ?? [];

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <UserCog className="h-4 w-4" /> Meine Vertretung
          </CardTitle>
          <CardDescription>
            Während Ihrer Abwesenheit darf ein Kollege Ihre Approvals entscheiden.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(o => !o)} data-testid="button-toggle-delegation-form">
          {open ? "Abbrechen" : "Neue Vertretung"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {open && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 border rounded p-3 bg-muted/20">
            <div>
              <Label className="text-xs">Vertreten durch</Label>
              <select
                className="w-full border rounded h-9 px-2 bg-background"
                value={toUserId}
                onChange={e => setToUserId(e.target.value)}
                data-testid="select-delegation-to-user"
              >
                <option value="">— wählen —</option>
                {(users ?? []).map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Von</Label>
              <Input type="datetime-local" value={validFrom} onChange={e => setValidFrom(e.target.value)} data-testid="input-delegation-from" />
            </div>
            <div>
              <Label className="text-xs">Bis</Label>
              <Input type="datetime-local" value={validUntil} onChange={e => setValidUntil(e.target.value)} data-testid="input-delegation-until" />
            </div>
            <div>
              <Label className="text-xs">Grund (optional)</Label>
              <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Urlaub, Reise..." data-testid="input-delegation-reason" />
            </div>
            <div className="md:col-span-4 flex justify-end">
              <Button size="sm" onClick={handleCreate} disabled={!toUserId || !validFrom || !validUntil} data-testid="button-create-delegation">
                Vertretung anlegen
              </Button>
            </div>
          </div>
        )}
        {out.length === 0 ? (
          <div className="text-muted-foreground text-xs">Sie haben keine aktive Vertretung eingerichtet.</div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Sie werden vertreten durch:</div>
            {out.map((d: UserDelegation) => (
              <div key={d.id} className="flex items-center justify-between border rounded px-3 py-2" data-testid={`delegation-out-${d.id}`}>
                <div className="text-sm">
                  <span className="font-medium">{d.toUserName ?? d.toUserId}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {new Date(d.validFrom).toLocaleString()} – {new Date(d.validUntil).toLocaleString()}
                  </span>
                  {d.reason && <span className="ml-2 italic text-xs text-muted-foreground">({d.reason})</span>}
                  {!d.active && <Badge variant="outline" className="ml-2">inaktiv</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => updateDelegation.mutate({ id: d.id, data: { active: !d.active } }, { onSuccess: refresh })}
                    data-testid={`button-toggle-delegation-${d.id}`}
                  >
                    {d.active ? "Deaktivieren" : "Aktivieren"}
                  </Button>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => deleteDelegation.mutate({ id: d.id }, { onSuccess: refresh })}
                    data-testid={`button-delete-delegation-${d.id}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        {inc.length > 0 && (
          <div className="space-y-2 pt-2 border-t">
            <div className="text-xs font-medium text-muted-foreground">Sie vertreten:</div>
            {inc.map((d: UserDelegation) => (
              <div key={d.id} className="text-sm" data-testid={`delegation-in-${d.id}`}>
                <span className="font-medium">{d.fromUserName ?? d.fromUserId}</span>
                <span className="text-muted-foreground ml-2 text-xs">
                  {new Date(d.validFrom).toLocaleString()} – {new Date(d.validUntil).toLocaleString()}
                </span>
                {!d.active && <Badge variant="outline" className="ml-2">inaktiv</Badge>}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Approvals() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: approvals, isLoading } = useListApprovals(
    statusFilter === "all" ? {} : { status: statusFilter }
  );

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const qc = useQueryClient();
  const decideApproval = useDecideApproval();

  // Bulk-Auswahl: nur Cases sind selektierbar, bei denen der eingeloggte User
  // entscheidungsberechtigt ist (canDecide === true). Der Server lehnt
  // unberechtigte Decisions ab; wir filtern dennoch im UI, damit der Toast
  // nur die wirklich angefragten Items zählt und nicht „silently failed" wird.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectComment, setBulkRejectComment] = useState("");

  // Wenn der Filter wechselt, alte Auswahl verwerfen — sonst könnten
  // Items „selected" bleiben, die gerade gar nicht mehr sichtbar sind.
  useEffect(() => { setSelected(new Set()); }, [statusFilter]);

  // Decidable = ist offen, hat canDecide=true. Berücksichtigt Stage-Logik.
  const decidableMap = useMemo(() => {
    const m = new Map<string, ApprovalCase>();
    for (const a of approvals ?? []) {
      const isOpen = a.status !== "approved" && a.status !== "rejected";
      if (isOpen && a.canDecide) m.set(a.id, a);
    }
    return m;
  }, [approvals]);

  const decidableSelectedIds = useMemo(
    () => [...selected].filter((id) => decidableMap.has(id)),
    [selected, decidableMap],
  );

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function isAllDecidableSelected() {
    const ids = [...decidableMap.keys()];
    return ids.length > 0 && ids.every((id) => selected.has(id));
  }
  function toggleAllDecidable() {
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = [...decidableMap.keys()];
      const allOn = ids.length > 0 && ids.every((id) => next.has(id));
      if (allOn) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function invalidateApprovals() {
    qc.invalidateQueries({ queryKey: getListApprovalsQueryKey() });
    qc.invalidateQueries({ queryKey: getListApprovalsQueryKey({ status: statusFilter }) });
  }

  const handleApprove = (id: string) => {
    decideApproval.mutate(
      { id, data: { decision: "approve" } },
      { onSuccess: invalidateApprovals },
    );
  };

  const handleReject = (id: string) => {
    decideApproval.mutate(
      { id, data: { decision: "reject", comment } },
      {
        onSuccess: () => {
          setRejectingId(null);
          setComment("");
          invalidateApprovals();
        },
      },
    );
  };

  async function runBulkDecide(decision: "approve" | "reject", bulkComment?: string) {
    if (decidableSelectedIds.length === 0) return;
    setBulkRunning(true);
    try {
      const results = await Promise.allSettled(
        decidableSelectedIds.map((id) =>
          decideApproval.mutateAsync({
            id,
            data: decision === "approve"
              ? { decision: "approve" }
              : { decision: "reject", comment: bulkComment },
          }),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const fail = results.length - ok;
      toast({
        title: decision === "approve"
          ? t("pages.approvals.bulkApproveDone")
          : t("pages.approvals.bulkRejectDone"),
        description: t("pages.approvals.bulkResult", { ok, fail }),
        variant: fail > 0 && ok === 0 ? "destructive" : undefined,
      });
      setSelected(new Set());
      invalidateApprovals();
    } finally {
      setBulkRunning(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-12 w-1/3" />
        <CardGridSkeleton items={4} columnsClass="grid-cols-1" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CheckCircle2}
        title={t("pages.approvals.title")}
        subtitle={t("pages.approvals.subtitle")}
      />

      <MyDelegationsCard />

      <div className="flex flex-wrap items-center gap-2">
        {["all", "pending", "approved", "rejected"].map(s => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(s)}
            className="capitalize"
          >
            {s}
          </Button>
        ))}
        {decidableMap.size > 0 && (
          <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={isAllDecidableSelected()}
              onCheckedChange={toggleAllDecidable}
              data-testid="approvals-select-all"
              aria-label={t("pages.approvals.selectAllDecidable")}
            />
            {t("pages.approvals.selectAllDecidable")} ({decidableMap.size})
          </label>
        )}
      </div>

      <div className="grid gap-4">
        {approvals?.length === 0 ? (
          <EmptyStateCard
            icon={CheckCircle2}
            title={t("pages.approvals.emptyTitle")}
            body={t("pages.approvals.emptyBody")}
            hint={t("pages.approvals.emptyHint")}
          />
        ) : (
          approvals?.map((approval: ApprovalCase) => {
            const isOpen = approval.status !== "approved" && approval.status !== "rejected";
            const hasStages = approval.stages && approval.stages.length > 0;
            const canDecide = !!approval.canDecide;
            const onBehalfOf = approval.canDecideOnBehalfOf;
            const decidable = isOpen && canDecide;
            return (
              <Card key={approval.id} data-testid={`approval-${approval.id}`}>
                <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
                  {decidable && (
                    <Checkbox
                      className="mt-1.5"
                      checked={selected.has(approval.id)}
                      onCheckedChange={() => toggleOne(approval.id)}
                      data-testid={`approval-select-${approval.id}`}
                      aria-label={t("common.bulk.selectRow", { name: approval.dealName })}
                    />
                  )}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <CardTitle className="text-lg">
                        <Link href={`/deals/${approval.dealId}`} className="hover:underline">
                          {approval.dealName}
                        </Link>
                      </CardTitle>
                      <Badge variant="outline">{approval.type}</Badge>
                      <Badge variant={approval.priority === "high" ? "destructive" : "secondary"}>
                        {approval.priority}
                      </Badge>
                      {hasStages && (
                        <Badge variant="outline" data-testid={`badge-stage-${approval.id}`}>
                          Stage {Math.min(approval.currentStageIdx + 1, approval.stages.length)}/{approval.stages.length}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{approval.reason}</p>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg">{approval.impactValue.toLocaleString()} {approval.currency}</div>
                    <Badge variant={
                      approval.status === "approved" ? "secondary" :
                      approval.status === "rejected" ? "destructive" : "default"
                    } className={approval.status === "approved" ? "bg-green-500/10 text-green-600 hover:bg-green-500/20" : ""}>
                      {approval.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pb-3 space-y-3 text-sm text-muted-foreground">
                  <div className="flex flex-wrap gap-6">
                    <div className="flex items-center gap-1">
                      <AlertCircle className="h-4 w-4" />
                      Requested by {approval.requestedByName} on {new Date(approval.createdAt).toLocaleDateString()}
                    </div>
                    {approval.deadline && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        Due by {new Date(approval.deadline).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                  {hasStages && <StageStepper stages={approval.stages} currentIdx={approval.currentStageIdx} />}
                  {isOpen && (
                    <AiPromptPanel mode="approval.readiness" entityId={approval.id} />
                  )}
                </CardContent>
                {isOpen && (
                  <CardFooter className="pt-3 border-t bg-muted/10 flex flex-col items-stretch gap-3">
                    {!canDecide && hasStages && (
                      <div className="text-xs text-muted-foreground italic" data-testid={`hint-cannot-decide-${approval.id}`}>
                        Sie sind für die aktuelle Stage nicht entscheidungsberechtigt.
                      </div>
                    )}
                    {canDecide && onBehalfOf && (
                      <div className="text-xs text-amber-700 italic" data-testid={`hint-on-behalf-${approval.id}`}>
                        Sie entscheiden im Auftrag eines vertretenen Kollegen.
                      </div>
                    )}
                    {canDecide && rejectingId === approval.id ? (
                      <div className="w-full space-y-2">
                        <Textarea
                          placeholder="Reason for rejection..."
                          value={comment}
                          onChange={e => setComment(e.target.value)}
                          className="min-h-[80px]"
                          data-testid={`textarea-reject-comment-${approval.id}`}
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setRejectingId(null)}>Cancel</Button>
                          <Button variant="destructive" size="sm" onClick={() => handleReject(approval.id)} disabled={!comment.trim()} data-testid={`button-confirm-reject-${approval.id}`}>
                            Confirm Rejection
                          </Button>
                        </div>
                      </div>
                    ) : canDecide ? (
                      <div className="flex justify-end gap-2 w-full">
                        <Button variant="outline" size="sm" onClick={() => setRejectingId(approval.id)} data-testid={`button-reject-${approval.id}`}>
                          <XCircle className="mr-2 h-4 w-4" /> Reject
                        </Button>
                        <Button size="sm" onClick={() => handleApprove(approval.id)} data-testid={`button-approve-${approval.id}`}>
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
                        </Button>
                      </div>
                    ) : null}
                  </CardFooter>
                )}
                {!isOpen && approval.decisionComment && (
                  <CardFooter className="pt-3 border-t bg-muted/10 text-sm">
                    <div className="italic">"{approval.decisionComment}"</div>
                  </CardFooter>
                )}
              </Card>
            );
          })
        )}
      </div>

      <BulkActionBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button
          size="sm"
          variant="default"
          className="h-8 gap-1"
          disabled={decidableSelectedIds.length === 0 || bulkRunning}
          onClick={() => void runBulkDecide("approve")}
          data-testid="approvals-bulk-approve"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          {t("pages.approvals.bulkApprove", { count: decidableSelectedIds.length })}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 text-destructive"
          disabled={decidableSelectedIds.length === 0 || bulkRunning}
          onClick={() => { setBulkRejectComment(""); setBulkRejectOpen(true); }}
          data-testid="approvals-bulk-reject"
        >
          <XCircle className="h-3.5 w-3.5" />
          {t("pages.approvals.bulkReject", { count: decidableSelectedIds.length })}
        </Button>
      </BulkActionBar>

      <AlertDialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("pages.approvals.bulkRejectDialogTitle", { count: decidableSelectedIds.length })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.approvals.bulkRejectDialogBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={bulkRejectComment}
            onChange={(e) => setBulkRejectComment(e.target.value)}
            placeholder={t("pages.approvals.bulkRejectCommentPlaceholder")}
            className="min-h-[100px]"
            data-testid="approvals-bulk-reject-comment"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!bulkRejectComment.trim() || bulkRunning}
              onClick={(e) => {
                e.preventDefault();
                setBulkRejectOpen(false);
                void runBulkDecide("reject", bulkRejectComment.trim());
              }}
              data-testid="approvals-bulk-reject-confirm"
            >
              {t("pages.approvals.bulkRejectConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

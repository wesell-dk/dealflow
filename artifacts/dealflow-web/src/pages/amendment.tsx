import { useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetContractAmendment,
  usePatchContractAmendment,
  useListApprovals,
  useListSignaturePackages,
  getGetContractAmendmentQueryKey,
  getListContractAmendmentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileStack, GitCompare, ArrowLeft, ClipboardList, History, CheckCircle2, PenLine } from "lucide-react";
import { EntityVersions } from "@/components/ui/entity-versions";
import { useToast } from "@/hooks/use-toast";
import { Breadcrumbs } from "@/components/patterns/breadcrumbs";

function amendmentTypeLabel(type: string): string {
  switch (type) {
    case "price-change": return "Price change";
    case "scope-change": return "Scope change";
    case "term-extension": return "Term extension";
    case "renewal": return "Renewal";
    default: return type;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "drafting": return "bg-slate-500/10 text-slate-600 border-slate-500/30";
    case "proposed": return "bg-sky-500/10 text-sky-600 border-sky-500/30";
    case "in_review": return "bg-amber-500/10 text-amber-600 border-amber-500/30";
    case "approved": return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
    case "out_for_signature": return "bg-indigo-500/10 text-indigo-600 border-indigo-500/30";
    case "signed":
    case "executed":
    case "active": return "bg-emerald-600/10 text-emerald-700 border-emerald-600/30";
    case "rejected": return "bg-rose-500/10 text-rose-600 border-rose-500/30";
    default: return "bg-muted text-muted-foreground";
  }
}

function opLabel(op: string): string {
  switch (op) {
    case "add": return "Added";
    case "modify": return "Modified";
    case "remove": return "Removed";
    default: return op;
  }
}

function opClass(op: string): string {
  switch (op) {
    case "add": return "bg-emerald-500/10 text-emerald-700 border-emerald-500/30";
    case "modify": return "bg-amber-500/10 text-amber-700 border-amber-500/30";
    case "remove": return "bg-rose-500/10 text-rose-700 border-rose-500/30";
    default: return "bg-muted text-muted-foreground";
  }
}

const NEXT_STATUS: Record<string, string[]> = {
  drafting: ["proposed", "rejected"],
  proposed: ["in_review", "rejected"],
  in_review: ["approved", "rejected"],
  approved: ["out_for_signature", "rejected"],
  out_for_signature: ["signed", "rejected"],
  signed: ["active"],
  active: [],
  executed: [],
  rejected: [],
};

export default function Amendment() {
  const { t } = useTranslation();
  const [, params] = useRoute("/amendments/:id");
  const id = params?.id as string;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: a, isLoading } = useGetContractAmendment(id ?? "");
  const patch = usePatchContractAmendment();
  const { data: approvals } = useListApprovals({ amendmentId: id });
  const { data: signatures } = useListSignaturePackages({ amendmentId: id });

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!a) return <div className="p-8 text-center text-muted-foreground">Not found</div>;

  const nextOptions = NEXT_STATUS[a.status] ?? [];

  async function onStatusChange(next: string) {
    try {
      await patch.mutateAsync({ id, data: { status: next } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetContractAmendmentQueryKey(id) }),
        qc.invalidateQueries({ queryKey: getListContractAmendmentsQueryKey(a!.originalContractId) }),
      ]);
      toast({ title: `Status: ${next}` });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: t("nav.contracts"), href: "/contracts" },
          { label: t("common.contract"), href: `/contracts/${a.originalContractId}` },
          { label: a.number },
        ]}
      />
      <div className="flex flex-col gap-2 border-b pb-4">
        <Link
          href={`/contracts/${a.originalContractId}`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          <ArrowLeft className="h-4 w-4" /> Back to contract
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileStack className="h-8 w-8 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground font-mono">{a.number}</div>
              <h1 className="text-3xl font-bold tracking-tight">{a.title}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{amendmentTypeLabel(a.type)}</Badge>
            <Badge variant="outline" className={statusClass(a.status)}>{a.status}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground mt-2 text-sm">
          {a.createdBy && <span>created by {a.createdBy}</span>}
          <span>·</span>
          <span>{new Date(a.createdAt).toLocaleDateString()}</span>
          {a.effectiveFrom && (
            <>
              <span>·</span>
              <span>effective from {new Date(a.effectiveFrom).toLocaleDateString()}</span>
            </>
          )}
        </div>
      </div>

      {a.description && (
        <Card>
          <CardContent className="p-4 text-sm">{a.description}</CardContent>
        </Card>
      )}

      {nextOptions.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> Next step
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3 pt-0">
            <Select onValueChange={onStatusChange}>
              <SelectTrigger className="w-[280px]" data-testid="select-amendment-next-status">
                <SelectValue placeholder="Change status..." />
              </SelectTrigger>
              <SelectContent>
                {nextOptions.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onStatusChange(nextOptions[0])}
              disabled={patch.isPending}
              data-testid="button-amendment-advance"
            >
              Advance to: {nextOptions[0]}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b">
          <GitCompare className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Changes</h2>
          <Badge variant="outline" className="ml-2">{a.changes.length}</Badge>
        </div>

        {a.changes.length === 0 ? (
          <div className="p-6 text-center border rounded-md text-muted-foreground bg-muted/10 text-sm">
            No clause changes recorded.
          </div>
        ) : (
          <div className="grid gap-3">
            {a.changes.map(ch => (
              <Card key={ch.id} data-testid={`amendment-change-${ch.id}`}>
                <CardHeader className="py-3 flex flex-row items-center justify-between">
                  <CardTitle className="text-base font-medium">{ch.family}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={opClass(ch.operation)}>{opLabel(ch.operation)}</Badge>
                    {ch.severity && (
                      <Badge variant="outline">{ch.severity}</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-muted-foreground uppercase">Before</div>
                      <div className="p-3 border rounded text-sm bg-rose-500/5 min-h-[60px]">
                        {ch.beforeSummary ?? <span className="text-muted-foreground italic">—</span>}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs font-semibold text-muted-foreground uppercase">After</div>
                      <div className="p-3 border rounded text-sm bg-emerald-500/5 min-h-[60px]">
                        {ch.afterSummary ?? <span className="text-muted-foreground italic">—</span>}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b">
          <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Approvals</h2>
          <Badge variant="outline" className="ml-2">{approvals?.length ?? 0}</Badge>
        </div>
        {!approvals || approvals.length === 0 ? (
          <div className="p-4 text-center border rounded-md text-muted-foreground bg-muted/10 text-sm">
            No approval case linked. Created automatically when status becomes "In review".
          </div>
        ) : (
          <div className="grid gap-2">
            {approvals.map(ap => (
              <Link key={ap.id} href="/approvals" className="block">
                <Card className="hover-elevate" data-testid={`amendment-approval-${ap.id}`}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <div className="text-sm font-medium">{ap.reason}</div>
                      <div className="text-xs text-muted-foreground font-mono">{ap.id} · {ap.requestedByName}</div>
                    </div>
                    <Badge variant="outline" className={statusClass(ap.status)}>{ap.status}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b">
          <PenLine className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Signatures</h2>
          <Badge variant="outline" className="ml-2">{signatures?.length ?? 0}</Badge>
        </div>
        {!signatures || signatures.length === 0 ? (
          <div className="p-4 text-center border rounded-md text-muted-foreground bg-muted/10 text-sm">
            No signature package linked. Created automatically when status becomes "Out for signature".
          </div>
        ) : (
          <div className="grid gap-2">
            {signatures.map(sg => (
              <Link key={sg.id} href={`/signatures/${sg.id}`} className="block">
                <Card className="hover-elevate" data-testid={`amendment-signature-${sg.id}`}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <div className="text-sm font-medium">{sg.title}</div>
                      <div className="text-xs text-muted-foreground font-mono">
                        {sg.id} · {sg.signedCount}/{sg.totalSigners} signed
                      </div>
                    </div>
                    <Badge variant="outline" className={statusClass(sg.status)}>{sg.status}</Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b">
          <History className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">{t("common.history") ?? "Verlauf"}</h2>
        </div>
        <EntityVersions entityType="contract_amendment" entityId={id} />
      </div>
    </div>
  );
}

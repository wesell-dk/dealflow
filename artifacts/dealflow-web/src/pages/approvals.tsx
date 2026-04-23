import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListApprovals,
  useDecideApproval,
  getListApprovalsQueryKey
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";

export default function Approvals() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data: approvals, isLoading } = useListApprovals(
    statusFilter === "all" ? {} : { status: statusFilter }
  );
  
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const qc = useQueryClient();
  const decideApproval = useDecideApproval();

  const handleApprove = (id: string) => {
    decideApproval.mutate(
      { id, data: { decision: "approved" } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListApprovalsQueryKey() });
          qc.invalidateQueries({ queryKey: getListApprovalsQueryKey({ status: statusFilter }) });
        }
      }
    );
  };

  const handleReject = (id: string) => {
    decideApproval.mutate(
      { id, data: { decision: "rejected", comment } },
      {
        onSuccess: () => {
          setRejectingId(null);
          setComment("");
          qc.invalidateQueries({ queryKey: getListApprovalsQueryKey() });
          qc.invalidateQueries({ queryKey: getListApprovalsQueryKey({ status: statusFilter }) });
        }
      }
    );
  };

  if (isLoading) {
    return <div className="p-8 space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("pages.approvals.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("pages.approvals.subtitle")}</p>
      </div>

      <div className="flex gap-2">
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
      </div>

      <div className="grid gap-4">
        {approvals?.length === 0 ? (
          <div className="text-center py-12 border rounded-lg bg-muted/20">
            <CheckCircle2 className="mx-auto h-12 w-12 text-muted-foreground opacity-50" />
            <h3 className="mt-4 text-lg font-medium">All caught up</h3>
            <p className="text-muted-foreground text-sm">No approvals found matching your criteria.</p>
          </div>
        ) : (
          approvals?.map(approval => (
            <Card key={approval.id}>
              <CardHeader className="pb-3 flex flex-row items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <CardTitle className="text-lg">
                      <Link href={`/deals/${approval.dealId}`} className="hover:underline">
                        {approval.dealName}
                      </Link>
                    </CardTitle>
                    <Badge variant="outline">{approval.type}</Badge>
                    <Badge variant={approval.priority === 'high' ? 'destructive' : 'secondary'}>
                      {approval.priority}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{approval.reason}</p>
                </div>
                <div className="text-right">
                  <div className="font-bold text-lg">{approval.impactValue.toLocaleString()} {approval.currency}</div>
                  <Badge variant={
                    approval.status === 'approved' ? 'secondary' : 
                    approval.status === 'rejected' ? 'destructive' : 'default'
                  } className={approval.status === 'approved' ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20' : ''}>
                    {approval.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pb-3 flex gap-6 text-sm text-muted-foreground">
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
              </CardContent>
              {approval.status === 'pending' && (
                <CardFooter className="pt-3 border-t bg-muted/10 flex flex-col items-stretch gap-3">
                  {rejectingId === approval.id ? (
                    <div className="w-full space-y-2">
                      <Textarea 
                        placeholder="Reason for rejection..." 
                        value={comment}
                        onChange={e => setComment(e.target.value)}
                        className="min-h-[80px]"
                      />
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setRejectingId(null)}>Cancel</Button>
                        <Button variant="destructive" size="sm" onClick={() => handleReject(approval.id)} disabled={!comment.trim()}>Confirm Rejection</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-end gap-2 w-full">
                      <Button variant="outline" size="sm" onClick={() => setRejectingId(approval.id)}>
                        <XCircle className="mr-2 h-4 w-4" /> Reject
                      </Button>
                      <Button size="sm" onClick={() => handleApprove(approval.id)}>
                        <CheckCircle2 className="mr-2 h-4 w-4" /> Approve
                      </Button>
                    </div>
                  )}
                </CardFooter>
              )}
              {approval.status !== 'pending' && approval.decisionComment && (
                <CardFooter className="pt-3 border-t bg-muted/10 text-sm">
                  <div className="italic">"{approval.decisionComment}"</div>
                </CardFooter>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

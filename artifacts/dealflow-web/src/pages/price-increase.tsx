import { useState } from "react";
import { useRoute } from "wouter";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetPriceIncrease,
  useRespondToPriceIncreaseLetter,
  getGetPriceIncreaseQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Clock, XCircle, MessageSquarePlus } from "lucide-react";
import { Breadcrumbs } from "@/components/patterns/breadcrumbs";

function ResponseDialog({ campaignId, letterId, onDone }: { campaignId: string; letterId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const respond = useRespondToPriceIncreaseLetter();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<string>("accept");
  const [comment, setComment] = useState("");

  const submit = async () => {
    await respond.mutateAsync({ id: campaignId, letterId, data: { decision, comment: comment || null } });
    setOpen(false);
    setComment("");
    onDone();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MessageSquarePlus className="h-3.5 w-3.5 mr-1" />
          {t("pages.priceIncrease.letterResponse")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.priceIncrease.letterResponse")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase text-muted-foreground">{t("pages.priceIncrease.responseType")}</label>
            <Select value={decision} onValueChange={setDecision}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="accept">{t("pages.priceIncrease.responseAccept")}</SelectItem>
                <SelectItem value="negotiate">{t("pages.priceIncrease.responseNegotiate")}</SelectItem>
                <SelectItem value="reject">{t("pages.priceIncrease.responseReject")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs uppercase text-muted-foreground">{t("pages.priceIncrease.responseNote")}</label>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={respond.isPending}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PriceIncrease() {
  const [, params] = useRoute("/price-increases/:id");
  const id = params?.id || "";
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: campaign, isLoading } = useGetPriceIncrease(id);
  const refresh = () => qc.invalidateQueries({ queryKey: getGetPriceIncreaseQueryKey(id) });

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!campaign) {
    return <div className="p-8">Campaign not found</div>;
  }

  const total = campaign.accountsCount || 1;
  const acceptedPct = Math.round((campaign.acceptedCount / total) * 100);
  const pendingPct = Math.round((campaign.pendingCount / total) * 100);
  const rejectedPct = Math.round((campaign.rejectedCount / total) * 100);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: t("nav.priceIncreases"), href: "/price-increases" },
          { label: campaign.name },
        ]}
      />
      <div className="flex flex-col gap-2 border-b pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">{campaign.name}</h1>
          <Badge variant={campaign.status === "Active" ? "default" : "outline"}>
            {campaign.status}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground">
          <span>Effective: {new Date(campaign.effectiveDate).toLocaleDateString()}</span>
          <span>&bull;</span>
          <span>{campaign.currency}</span>
          <span>&bull;</span>
          <span className="font-medium text-foreground">+{campaign.averageUpliftPct ?? 0}% Avg Uplift</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-green-700 dark:text-green-400">Accepted</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaign.acceptedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-amber-700 dark:text-amber-400">Pending</CardTitle>
            <Clock className="h-4 w-4 text-amber-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaign.pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-red-700 dark:text-red-400">Rejected</CardTitle>
            <XCircle className="h-4 w-4 text-red-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaign.rejectedCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Acceptance Funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-4 w-full rounded-full overflow-hidden flex">
            <div style={{ width: `${acceptedPct}%` }} className="bg-green-500 h-full transition-all" title={`Accepted: ${acceptedPct}%`} />
            <div style={{ width: `${pendingPct}%` }} className="bg-amber-400 h-full transition-all" title={`Pending: ${pendingPct}%`} />
            <div style={{ width: `${rejectedPct}%` }} className="bg-red-500 h-full transition-all" title={`Rejected: ${rejectedPct}%`} />
          </div>
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{acceptedPct}% Accepted</span>
            <span>{pendingPct}% Pending</span>
            <span>{rejectedPct}% Rejected</span>
          </div>
        </CardContent>
      </Card>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Uplift</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Responded</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaign.letters?.map((letter: any) => (
              <TableRow key={letter.id}>
                <TableCell className="font-medium">
                  <Link href={`/accounts/${letter.accountId}`} className="hover:underline">
                    {letter.accountName}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={
                    letter.status === "Accepted" ? "outline" :
                    letter.status === "Rejected" ? "destructive" : "secondary"
                  }>
                    {letter.status}
                  </Badge>
                </TableCell>
                <TableCell>+{letter.upliftPct}%</TableCell>
                <TableCell>{letter.sentAt ? new Date(letter.sentAt).toLocaleDateString() : '-'}</TableCell>
                <TableCell>{letter.respondedAt ? new Date(letter.respondedAt).toLocaleDateString() : '-'}</TableCell>
                <TableCell className="text-right">
                  {letter.status === "Sent" || letter.status === "Pending" ? (
                    <ResponseDialog campaignId={id} letterId={letter.id} onDone={refresh} />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {!campaign.letters?.length && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">No letters found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

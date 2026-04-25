import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useListRenewals,
  useGetRenewalSummary,
  useUpdateRenewal,
  useRunRenewalEngine,
  useIssueRenewalFollowup,
  getListRenewalsQueryKey,
  getGetRenewalSummaryQueryKey,
  type RenewalOpportunity,
  type RenewalRiskFactor,
  type ListRenewalsParams,
  type RenewalPatch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { CalendarClock, AlertTriangle, RefreshCcw, Calendar, FileSignature, X, FilePlus2 } from "lucide-react";
import { Link, useSearch, useLocation } from "wouter";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";

type Bucket = "" | "this_month" | "next_90" | "risk";

function fmtCurrency(v: number | null | undefined, currency: string | null | undefined) {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "EUR",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `${v} ${currency || ""}`;
  }
}

function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return s.slice(0, 10);
}

function riskBadge(score: number) {
  if (score >= 70) return <Badge variant="destructive">{score}</Badge>;
  if (score >= 40) return <Badge>{score}</Badge>;
  return <Badge variant="secondary">{score}</Badge>;
}

function statusBadge(status: string, t: (k: string) => string) {
  const variant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    open: "default",
    in_progress: "default",
    snoozed: "secondary",
    won: "outline",
    lost: "destructive",
    cancelled: "secondary",
  };
  return (
    <Badge variant={variant[status] ?? "secondary"}>
      {t(`pages.renewals.status.${status}`)}
    </Badge>
  );
}

export default function RenewalsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isTenantAdmin = user?.isPlatformAdmin || user?.role === "Tenant Admin";

  const search = useSearch();
  const [, setLocation] = useLocation();
  const ymFilter = useMemo(() => {
    const sp = new URLSearchParams(search);
    const v = sp.get("ym");
    return v && /^\d{4}-\d{2}$/.test(v) ? v : "";
  }, [search]);
  function clearYmFilter() {
    const sp = new URLSearchParams(search);
    sp.delete("ym");
    const qs = sp.toString();
    setLocation(qs ? `/renewals?${qs}` : "/renewals");
  }

  const [bucket, setBucket] = useState<Bucket>("");
  const [minRisk, setMinRisk] = useState<string>("");
  const [status, setStatus] = useState<string>("open");
  const [selected, setSelected] = useState<RenewalOpportunity | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [snoozeDate, setSnoozeDate] = useState<string>("");

  const params: ListRenewalsParams = { status: status as ListRenewalsParams["status"] };
  if (bucket) params.bucket = bucket as ListRenewalsParams["bucket"];
  const minRiskN = Number(minRisk);
  if (minRisk && !Number.isNaN(minRiskN)) params.minRisk = minRiskN;

  const { data: summary, isLoading: isLoadingSummary } = useGetRenewalSummary();
  const { data: rows, isLoading: isLoadingRows } = useListRenewals(params);
  const updateMut = useUpdateRenewal();
  const runMut = useRunRenewalEngine();
  const issueMut = useIssueRenewalFollowup();

  function refetchAll() {
    qc.invalidateQueries({ queryKey: getListRenewalsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetRenewalSummaryQueryKey() });
  }

  const sortedRows = useMemo(() => {
    let list = (rows ?? []).slice();
    if (ymFilter) {
      list = list.filter((r) => typeof r.dueDate === "string" && r.dueDate.slice(0, 7) === ymFilter);
    }
    return list.sort((a, b) => b.riskScore - a.riskScore);
  }, [rows, ymFilter]);

  const ymFilterLabel = useMemo(() => {
    if (!ymFilter) return "";
    const [y, m] = ymFilter.split("-");
    const d = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [ymFilter]);

  function openDetail(r: RenewalOpportunity) {
    setSelected(r);
    setNotes(r.notes ?? "");
    setSnoozeDate(r.snoozedUntil ?? "");
  }

  async function patch(action: "snooze" | "won" | "lost" | "cancelled" | "open" | "save") {
    if (!selected) return;
    const body: RenewalPatch = {};
    if (action === "snooze") {
      if (!snoozeDate) {
        toast({ title: t("pages.renewals.snoozeRequiresDate"), variant: "destructive" });
        return;
      }
      body.status = "snoozed";
      body.snoozedUntil = snoozeDate;
    } else if (action === "save") {
      body.notes = notes;
    } else {
      body.status = action;
    }
    await updateMut.mutateAsync({ id: selected.id, data: body });
    toast({ title: t("pages.renewals.saved") });
    refetchAll();
    setSelected(null);
  }

  async function issueFollowup() {
    if (!selected) return;
    try {
      const res = await issueMut.mutateAsync({ id: selected.id });
      toast({
        title: t("pages.renewals.followupCreated"),
        description: res.contract.title,
      });
      refetchAll();
      setSelected(null);
      setLocation(`/contracts/${res.contract.id}`);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      toast({ title: t("pages.renewals.followupFailed"), description: detail, variant: "destructive" });
    }
  }

  async function runEngine() {
    const res = await runMut.mutateAsync();
    toast({
      title: t("pages.renewals.runDone"),
      description: t("pages.renewals.runSummary", {
        created: res.created,
        updated: res.updated,
        dueSoon: res.dueSoon,
      }),
    });
    refetchAll();
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        icon={CalendarClock}
        title={t("pages.renewals.title")}
        subtitle={t("pages.renewals.subtitle")}
        actions={isTenantAdmin && (
          <Button onClick={runEngine} disabled={runMut.isPending} variant="outline">
            <RefreshCcw className="mr-2 h-4 w-4" />
            {t("pages.renewals.runNow")}
          </Button>
        )}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("pages.renewals.summary.totalOpen")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{summary?.totalOpen ?? 0}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtCurrency(summary?.pipelineValue ?? 0, "EUR")}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card data-testid="card-bucket-this-month">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("pages.renewals.summary.thisMonth")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{summary?.thisMonth.count ?? 0}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtCurrency(summary?.thisMonth.value ?? 0, "EUR")}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card data-testid="card-bucket-next-90">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">{t("pages.renewals.summary.next90")}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{summary?.next90.count ?? 0}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtCurrency(summary?.next90.value ?? 0, "EUR")}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card data-testid="card-bucket-risk">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1">
              <AlertTriangle className="h-4 w-4 text-destructive" /> {t("pages.renewals.summary.atRisk")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingSummary ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">{summary?.atRisk.count ?? 0}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtCurrency(summary?.atRisk.value ?? 0, "EUR")}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("pages.renewals.tableTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Select value={bucket || "__all__"} onValueChange={(v) => setBucket(v === "__all__" ? "" : (v as Bucket))}>
              <SelectTrigger className="w-48"><SelectValue placeholder={t("pages.renewals.filter.bucket")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t("pages.renewals.filter.allBuckets")}</SelectItem>
                <SelectItem value="this_month">{t("pages.renewals.summary.thisMonth")}</SelectItem>
                <SelectItem value="next_90">{t("pages.renewals.summary.next90")}</SelectItem>
                <SelectItem value="risk">{t("pages.renewals.summary.atRisk")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44"><SelectValue placeholder={t("pages.renewals.filter.status")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">{t("pages.renewals.status.open")}</SelectItem>
                <SelectItem value="in_progress">{t("pages.renewals.status.in_progress")}</SelectItem>
                <SelectItem value="snoozed">{t("pages.renewals.status.snoozed")}</SelectItem>
                <SelectItem value="won">{t("pages.renewals.status.won")}</SelectItem>
                <SelectItem value="lost">{t("pages.renewals.status.lost")}</SelectItem>
                <SelectItem value="cancelled">{t("pages.renewals.status.cancelled")}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              min={0}
              max={100}
              placeholder={t("pages.renewals.filter.minRisk")}
              value={minRisk}
              onChange={(e) => setMinRisk(e.target.value)}
              className="w-36"
              data-testid="input-min-risk"
            />
            {ymFilter && (
              <Badge
                variant="secondary"
                className="flex items-center gap-1"
                data-testid="badge-ym-filter"
              >
                <Calendar className="h-3 w-3" />
                <span>Monat: {ymFilterLabel}</span>
                <button
                  type="button"
                  onClick={clearYmFilter}
                  className="ml-1 rounded-sm hover:bg-background/40"
                  aria-label="Monatsfilter entfernen"
                  data-testid="button-clear-ym-filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )}
          </div>

          {isLoadingRows ? (
            <Skeleton className="h-40 w-full" />
          ) : sortedRows.length === 0 ? (
            <EmptyStateCard
              icon={CalendarClock}
              title={t("pages.renewals.emptyTitle")}
              body={t("pages.renewals.empty")}
              hint={t("pages.renewals.emptyHint")}
              className="border-0 shadow-none"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("pages.renewals.col.account")}</TableHead>
                  <TableHead>{t("pages.renewals.col.contract")}</TableHead>
                  <TableHead>{t("pages.renewals.col.notice")}</TableHead>
                  <TableHead>{t("pages.renewals.col.due")}</TableHead>
                  <TableHead>{t("pages.renewals.col.value")}</TableHead>
                  <TableHead>{t("pages.renewals.col.risk")}</TableHead>
                  <TableHead>{t("pages.renewals.col.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((r) => (
                  <TableRow
                    key={r.id}
                    onClick={() => openDetail(r)}
                    className="cursor-pointer"
                    data-testid={`row-renewal-${r.id}`}
                  >
                    <TableCell>{r.accountName ?? r.accountId}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2">
                        {r.kind === "external"
                          ? r.externalContractTitle ?? r.externalContractId ?? "—"
                          : r.contractTitle ?? r.contractId ?? "—"}
                        {r.kind === "external" && (
                          <Badge variant="secondary" className="text-[10px] uppercase">Extern</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>{fmtDate(r.noticeDeadline)}</TableCell>
                    <TableCell>{fmtDate(r.dueDate)}</TableCell>
                    <TableCell>{fmtCurrency(r.valueAmount ?? null, r.currency ?? "EUR")}</TableCell>
                    <TableCell>{riskBadge(r.riskScore)}</TableCell>
                    <TableCell>{statusBadge(r.status, t)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => { if (!o) setSelected(null); }}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <CalendarClock className="h-5 w-5" />
                  {selected.kind === "external"
                    ? selected.externalContractTitle ?? selected.externalContractId ?? "—"
                    : selected.contractTitle ?? selected.contractId ?? "—"}
                  {selected.kind === "external" && (
                    <Badge variant="secondary" className="text-[10px] uppercase">Extern</Badge>
                  )}
                </SheetTitle>
                <SheetDescription>
                  {selected.accountName ?? selected.accountId}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">{t("pages.renewals.col.notice")}</div>
                    <div className="font-medium flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" /> {fmtDate(selected.noticeDeadline)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("pages.renewals.col.due")}</div>
                    <div className="font-medium flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" /> {fmtDate(selected.dueDate)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("pages.renewals.col.value")}</div>
                    <div className="font-medium">{fmtCurrency(selected.valueAmount ?? null, selected.currency ?? "EUR")}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("pages.renewals.col.status")}</div>
                    <div>{statusBadge(selected.status, t)}</div>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t("pages.renewals.detail.riskTitle")}</div>
                  <div className="flex items-center gap-2 mb-2">
                    {riskBadge(selected.riskScore)}
                    <span className="text-sm">/ 100</span>
                  </div>
                  <div className="space-y-1 rounded-md border p-3">
                    {(selected.riskFactors as RenewalRiskFactor[] | undefined ?? []).map((f) => (
                      <div key={f.key} className="flex items-center justify-between text-sm">
                        <span>{f.label}</span>
                        <span className="font-mono text-xs">+{f.points}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t("pages.renewals.detail.contract")}</div>
                  {selected.kind === "external" ? (
                    // Externe Bestandsverträge haben keine eigene Detail-Seite —
                    // wir verlinken stattdessen den Account, dort steht die
                    // Externe-Verträge-Karte.
                    <Link href={`/accounts/${selected.accountId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <FileSignature className="h-4 w-4" />
                      {selected.externalContractTitle ?? selected.externalContractId ?? "—"}
                    </Link>
                  ) : selected.contractId ? (
                    <Link href={`/contracts/${selected.contractId}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <FileSignature className="h-4 w-4" /> {selected.contractTitle ?? selected.contractId}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>

                {selected.followupContractId && (
                  <div>
                    <div className="text-xs text-muted-foreground mb-1">{t("pages.renewals.detail.followup")}</div>
                    <Link
                      href={`/contracts/${selected.followupContractId}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      data-testid="link-followup-contract"
                    >
                      <FilePlus2 className="h-4 w-4" /> {selected.followupContractId}
                    </Link>
                  </div>
                )}

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t("pages.renewals.detail.notes")}</div>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                </div>

                <div>
                  <div className="text-xs text-muted-foreground mb-1">{t("pages.renewals.detail.snoozeUntil")}</div>
                  <Input type="date" value={snoozeDate} onChange={(e) => setSnoozeDate(e.target.value)} />
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  {selected.status === "open" && !selected.followupContractId && (
                    <Button
                      onClick={issueFollowup}
                      disabled={issueMut.isPending}
                      data-testid="button-issue-followup"
                    >
                      <FilePlus2 className="mr-2 h-4 w-4" />
                      {t("pages.renewals.actions.issueFollowup")}
                    </Button>
                  )}
                  {selected.followupContractId && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSelected(null);
                        setLocation(`/contracts/${selected.followupContractId}`);
                      }}
                      data-testid="button-open-followup"
                    >
                      <FilePlus2 className="mr-2 h-4 w-4" />
                      {t("pages.renewals.actions.openFollowup")}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => patch("save")} disabled={updateMut.isPending}>
                    {t("pages.renewals.actions.saveNotes")}
                  </Button>
                  <Button variant="secondary" onClick={() => patch("snooze")} disabled={updateMut.isPending}>
                    {t("pages.renewals.actions.snooze")}
                  </Button>
                  <Button onClick={() => patch("won")} disabled={updateMut.isPending}>
                    {t("pages.renewals.actions.won")}
                  </Button>
                  <Button variant="destructive" onClick={() => patch("lost")} disabled={updateMut.isPending}>
                    {t("pages.renewals.actions.lost")}
                  </Button>
                  <Button variant="ghost" onClick={() => patch("cancelled")} disabled={updateMut.isPending}>
                    {t("pages.renewals.actions.cancel")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

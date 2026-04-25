import { useRoute, Link } from "wouter";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetContract,
  useListClauseFamilies,
  useListContractClauses,
  usePatchContractClause,
  useListContractAmendments,
  useCreateContractAmendment,
  useGetContractEffectiveState,
  useListContractDeviations,
  useEvaluateContractDeviations,
  useResolveDeviation,
  useListObligations,
  useUpdateObligation,
  useDeriveContractObligations,
  useGetContractClauseCompatibility,
  getGetContractQueryKey,
  getListContractClausesQueryKey,
  getListContractAmendmentsQueryKey,
  getListContractDeviationsQueryKey,
  getListObligationsQueryKey,
  type ContractClause,
  type ClauseVariant,
  type ClauseFamily,
  type ClauseDeviation,
  type Obligation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileText, ShieldAlert, Library, Activity, GitCompare, AlertTriangle, FileStack, Plus } from "lucide-react";
import { EntityVersions } from "@/components/ui/entity-versions";
import { useToast } from "@/hooks/use-toast";

function toneClass(tone: string) {
  switch (tone) {
    case "zart": return "bg-rose-500/10 text-rose-600 border-rose-500/30";
    case "moderat": return "bg-amber-500/10 text-amber-600 border-amber-500/30";
    case "standard": return "bg-sky-500/10 text-sky-600 border-sky-500/30";
    case "streng": return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
    case "hart": return "bg-indigo-500/10 text-indigo-600 border-indigo-500/30";
    default: return "bg-muted text-muted-foreground";
  }
}

function severityDot(severity?: string) {
  if (severity === "high") return "bg-destructive";
  if (severity === "medium") return "bg-amber-500";
  return "bg-emerald-500";
}

function diffWords(a: string, b: string): { text: string; kind: "same" | "add" | "del" }[] {
  const aw = a.split(/(\s+)/);
  const bw = b.split(/(\s+)/);
  const m = aw.length, n = bw.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aw[i] === bw[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: { text: string; kind: "same" | "add" | "del" }[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (aw[i] === bw[j]) { out.push({ text: aw[i], kind: "same" }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ text: aw[i], kind: "del" }); i++; }
    else { out.push({ text: bw[j], kind: "add" }); j++; }
  }
  while (i < m) { out.push({ text: aw[i++], kind: "del" }); }
  while (j < n) { out.push({ text: bw[j++], kind: "add" }); }
  return out;
}

type DiffState = { fromVariant: ClauseVariant; toVariant: ClauseVariant; delta: number } | null;

export default function Contract() {
  const { t } = useTranslation();
  const [, params] = useRoute("/contracts/:id");
  const id = params?.id as string;
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: contract, isLoading: isLoadingContract } = useGetContract(id ?? "");
  const { data: families, isLoading: isLoadingFamilies } = useListClauseFamilies();
  const { data: clauses, isLoading: isLoadingClauses } = useListContractClauses(id ?? "");
  const { data: compatReport } = useGetContractClauseCompatibility(id ?? "", {
    query: { enabled: !!id, queryKey: ["contractClauseCompatibility", id] },
  });
  const patchClause = usePatchContractClause();

  const [diff, setDiff] = useState<DiffState>(null);
  const [pending, setPending] = useState<string | null>(null);

  if (isLoadingContract || isLoadingFamilies || isLoadingClauses) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }
  if (!contract) return <div className="p-8 text-center text-muted-foreground">Contract not found</div>;

  const familyMap = new Map<string, ClauseFamily>((families ?? []).map(f => [f.id, f]));

  async function onVariantChange(clause: ContractClause, nextVariantId: string) {
    if (!clause.id || nextVariantId === clause.activeVariantId) return;
    setPending(clause.id);
    try {
      const res = await patchClause.mutateAsync({
        id: clause.id,
        data: { variantId: nextVariantId },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetContractQueryKey(id) }),
        qc.invalidateQueries({ queryKey: getListContractClausesQueryKey(id) }),
        qc.invalidateQueries({ queryKey: ["contractClauseCompatibility", id] }),
      ]);
      toast({
        title: t("pages.contracts.variantChanged"),
        description: res.approvalId
          ? t("pages.contracts.approvalTriggered") + ` · ${res.approvalReason ?? ""}`
          : t("pages.contracts.noApprovalNeeded"),
        variant: res.approvalId ? "destructive" : "default",
      });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setPending(null);
    }
  }

  function openDiff(clause: ContractClause, toVariantId: string) {
    const fam = familyMap.get(clause.familyId ?? "");
    if (!fam) return;
    const fromVariant = fam.variants.find(v => v.id === clause.activeVariantId);
    const toVariant = fam.variants.find(v => v.id === toVariantId);
    if (!fromVariant || !toVariant) return;
    setDiff({
      fromVariant,
      toVariant,
      delta: (toVariant.severityScore ?? 0) - (fromVariant.severityScore ?? 0),
    });
  }

  const riskScore = contract.riskScore ?? 0;
  const riskColor = riskScore >= 70 ? "text-destructive" : riskScore >= 40 ? "text-amber-600" : "text-emerald-600";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 border-b pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-3xl font-bold tracking-tight">{contract.title}</h1>
          </div>
          <div className="flex gap-2 items-center">
            <Button variant="outline" size="sm" onClick={() => window.open(`/api/contracts/${id}/pdf`, '_blank')}>
              <FileText className="h-4 w-4 mr-2" /> PDF anzeigen
            </Button>
            <Badge variant="outline" className="text-sm px-3 py-1">{contract.status}</Badge>
            <Badge
              variant={contract.riskLevel === 'high' ? 'destructive' : 'outline'}
              className={`text-sm px-3 py-1 ${
                contract.riskLevel === 'low' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                : contract.riskLevel === 'medium' ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                : ''
              }`}
            >
              Risk: {contract.riskLevel}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground mt-2 text-sm">
          <Link href={`/deals/${contract.dealId}`} className="hover:underline">{contract.dealName}</Link>
          <span>·</span>
          <span>{t("common.version")} {contract.version}</span>
          <span>·</span>
          <span>Template: {contract.template}</span>
          {contract.validUntil && (
            <>
              <span>·</span>
              <span>{new Date(contract.validUntil).toLocaleDateString()}</span>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm flex items-center gap-2 font-medium text-muted-foreground">
            <Activity className="h-4 w-4" /> {t("pages.contracts.riskScore")}
          </CardTitle>
          <span className={`text-3xl font-bold tabular-nums ${riskColor}`}>{riskScore}</span>
        </CardHeader>
        <CardContent>
          <Progress value={riskScore} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">
            {t("pages.contracts.riskScoreInfo", { count: clauses?.length ?? 0 })}
          </p>
        </CardContent>
      </Card>

      <EntityVersions entityType="contract" entityId={id} />

      <AmendmentsSection contractId={id} contractStatus={contract.status} />

      <EffectiveStateSection contractId={id} contractStatus={contract.status} />

      <DeviationsSection contractId={id} />

      <ObligationsSection contractId={id} contractStatus={contract.status} />

      <div className="space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b">
          <ShieldAlert className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">{t("pages.contracts.currentClauses")}</h2>
        </div>

        {(clauses?.length ?? 0) === 0 ? (
          <div className="p-8 text-center border rounded-md text-muted-foreground bg-muted/10">
            {t("common.noData")}
          </div>
        ) : (
          <div className="grid gap-4">
            {clauses?.map(clause => {
              const fam = familyMap.get(clause.familyId ?? "");
              const variants = fam?.variants ?? [];
              const compat = compatReport?.items?.find(c => c.contractClauseId === clause.id);
              return (
                <Card
                  key={clause.id}
                  className="border-l-4"
                  style={{
                    borderLeftColor:
                      clause.severity === 'high' ? 'hsl(var(--destructive))'
                      : clause.severity === 'medium' ? '#f59e0b' : '#10b981',
                  }}
                  data-testid={`clause-card-${clause.id}`}
                >
                  <CardHeader className="py-3 px-4 flex flex-row items-start justify-between gap-4 bg-muted/10">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-base font-medium">{clause.family}</CardTitle>
                      <div className="flex items-center gap-2 mt-1 text-xs">
                        <Badge variant="outline" className={toneClass(clause.tone ?? "")}>
                          {clause.tone ?? "—"}
                        </Badge>
                        <span className="text-muted-foreground">
                          {t("pages.contracts.score")}: <strong className="tabular-nums">{clause.severityScore ?? "—"}</strong>
                        </span>
                        {compat && <CompatBadge compat={compat} />}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Select
                        value={clause.activeVariantId ?? ""}
                        onValueChange={(v) => onVariantChange(clause, v)}
                        disabled={pending === clause.id}
                      >
                        <SelectTrigger className="w-[280px]" data-testid={`clause-variant-select-${clause.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {variants.map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              <span className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${severityDot(v.severity)}`}></span>
                                <span className="truncate">{v.name}</span>
                                <span className="text-xs text-muted-foreground">· {v.tone} ({v.severityScore})</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </CardHeader>
                  <CardContent className="py-3 px-4 text-sm space-y-3">
                    <p className="text-foreground">{clause.summary}</p>
                    {clause.body && (
                      <p className="text-xs text-muted-foreground italic border-l-2 pl-3 py-1">
                        {clause.body}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2 pt-2 border-t">
                      {variants
                        .filter(v => v.id !== clause.activeVariantId)
                        .slice(0, 4)
                        .map(v => (
                          <Button
                            key={v.id}
                            size="sm"
                            variant="outline"
                            onClick={() => openDiff(clause, v.id)}
                            data-testid={`clause-diff-${clause.id}-${v.id}`}
                            className="h-7 text-xs"
                          >
                            <GitCompare className="h-3 w-3 mr-1" />
                            {v.tone} ({v.severityScore})
                          </Button>
                        ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-4 pt-4">
        <div className="flex items-center justify-between pb-2 border-b">
          <div className="flex items-center gap-2">
            <Library className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-semibold">{t("pages.contracts.clauseLibrary")}</h2>
          </div>
          <Link href="/clauses" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            {t("common.view")} →
          </Link>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          {families?.map(family => (
            <Card key={family.id} className="bg-muted/5">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-base font-medium">{family.name}</CardTitle>
                <p className="text-xs text-muted-foreground">{family.description}</p>
              </CardHeader>
              <CardContent className="py-0 px-4 pb-3">
                <div className="flex flex-wrap gap-1.5">
                  {family.variants.map(v => (
                    <Badge key={v.id} variant="outline" className={`${toneClass(v.tone)} text-xs`}>
                      {v.tone} ({v.severityScore})
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={!!diff} onOpenChange={(o) => !o && setDiff(null)}>
        <DialogContent className="max-w-4xl">
          {diff && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <GitCompare className="h-5 w-5" />
                  {t("pages.contracts.diffTitle", {
                    from: diff.fromVariant.name,
                    to: diff.toVariant.name,
                  })}
                </DialogTitle>
                <DialogDescription className="flex items-center gap-3 pt-2">
                  <Badge variant="outline" className={toneClass(diff.fromVariant.tone)}>
                    {diff.fromVariant.tone} ({diff.fromVariant.severityScore})
                  </Badge>
                  <span>→</span>
                  <Badge variant="outline" className={toneClass(diff.toVariant.tone)}>
                    {diff.toVariant.tone} ({diff.toVariant.severityScore})
                  </Badge>
                  <span className="ml-2">
                    {t("pages.contracts.deltaScore")}:{" "}
                    <strong className={diff.delta < 0 ? "text-rose-600" : diff.delta > 0 ? "text-emerald-600" : ""}>
                      {diff.delta > 0 ? `+${diff.delta}` : diff.delta}
                    </strong>
                  </span>
                  {diff.delta < 0 && (
                    <span className="ml-auto flex items-center gap-1 text-rose-600 text-xs">
                      <AlertTriangle className="h-3 w-3" />
                      {t("pages.contracts.softer")}
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-4 mt-2">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t("pages.contracts.beforeText")}
                  </div>
                  <div className="p-3 border rounded text-sm leading-relaxed bg-rose-500/5">
                    {diff.fromVariant.body}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t("pages.contracts.afterText")}
                  </div>
                  <div className="p-3 border rounded text-sm leading-relaxed bg-emerald-500/5">
                    {diff.toVariant.body}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Redlining
                </div>
                <div className="p-3 border rounded text-sm leading-relaxed bg-muted/20">
                  {diffWords(diff.fromVariant.body ?? "", diff.toVariant.body ?? "").map((seg, i) => (
                    <span
                      key={i}
                      className={
                        seg.kind === "add" ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300" :
                        seg.kind === "del" ? "bg-rose-500/20 text-rose-800 dark:text-rose-300 line-through" :
                        ""
                      }
                    >
                      {seg.text}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function amendmentTypeLabel(type: string): string {
  switch (type) {
    case "price-change": return "Preisänderung";
    case "scope-change": return "Leistungsänderung";
    case "term-extension": return "Laufzeitverlängerung";
    case "renewal": return "Verlängerung";
    default: return type;
  }
}

function amendmentStatusClass(status: string): string {
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

function EffectiveStateSection({ contractId, contractStatus }: { contractId: string; contractStatus: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useGetContractEffectiveState(contractId, {
    query: { enabled: open, queryKey: ["contractEffectiveState", contractId] },
  });
  const show = ["signed", "active", "countersigned"].includes(contractStatus);
  if (!show) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-2">
          <Library className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Aktueller Vertragsstand</h2>
          {data && <Badge variant="outline" className="ml-2">{data.appliedAmendments.length} Nachträge angewandt</Badge>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)} data-testid="button-toggle-effective-state">
          {open ? "Ausblenden" : "Anzeigen"}
        </Button>
      </div>
      {open && (
        isLoading || !data ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Klausel-Bestand inkl. aller aktiven Nachträge ({data.appliedAmendments.length} angewandt).
            </p>
            {data.clauses.length === 0 ? (
              <div className="p-4 text-center border rounded-md text-muted-foreground bg-muted/10 text-sm">
                Keine Klauseln vorhanden.
              </div>
            ) : (
              <div className="grid gap-2">
                {data.clauses.map(cl => (
                  <Card key={cl.id} data-testid={`effective-clause-${cl.id}`}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div className="flex flex-col gap-0.5">
                        <div className="text-sm font-medium">{cl.family}</div>
                        <div className="text-xs text-muted-foreground">{cl.summary}</div>
                      </div>
                      <Badge variant="outline" className={toneClass(cl.variant)}>{cl.variant}</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

function AmendmentsSection({ contractId, contractStatus }: { contractId: string; contractStatus: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: amendments, isLoading } = useListContractAmendments(contractId);
  const create = useCreateContractAmendment();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("price-change");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const canAmend = ["signed", "active", "countersigned"].includes(contractStatus);

  async function onCreate() {
    if (!title.trim()) return;
    try {
      await create.mutateAsync({
        id: contractId,
        data: { type, title: title.trim(), description: description.trim() || null },
      });
      await qc.invalidateQueries({ queryKey: getListContractAmendmentsQueryKey(contractId) });
      setOpen(false);
      setTitle("");
      setDescription("");
      toast({ title: "Nachtrag angelegt" });
    } catch (e) {
      toast({ title: "Fehler", description: String(e), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-2">
          <FileStack className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Nachträge (Amendments)</h2>
          <Badge variant="outline" className="ml-2">{amendments?.length ?? 0}</Badge>
        </div>
        {canAmend && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="button-new-amendment">
            <Plus className="h-4 w-4 mr-1" /> Neuer Nachtrag
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (amendments?.length ?? 0) === 0 ? (
        <div className="p-6 text-center border rounded-md text-muted-foreground bg-muted/10 text-sm">
          {canAmend ? "Keine Nachträge vorhanden." : `Nachträge sind erst ab Vertragsstatus "signed" möglich.`}
        </div>
      ) : (
        <div className="grid gap-2">
          {amendments?.map(a => (
            <Link key={a.id} href={`/amendments/${a.id}`}>
              <Card className="hover:bg-muted/30 transition-colors cursor-pointer" data-testid={`amendment-${a.id}`}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{a.number}</span>
                      <span>·</span>
                      <span>{amendmentTypeLabel(a.type)}</span>
                      {a.effectiveFrom && (
                        <>
                          <span>·</span>
                          <span>gültig ab {new Date(a.effectiveFrom).toLocaleDateString()}</span>
                        </>
                      )}
                    </div>
                    <div className="font-medium truncate mt-1">{a.title}</div>
                    {a.description && (
                      <div className="text-xs text-muted-foreground truncate mt-1">{a.description}</div>
                    )}
                  </div>
                  <Badge variant="outline" className={amendmentStatusClass(a.status)}>
                    {a.status}
                  </Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuer Nachtrag</DialogTitle>
            <DialogDescription>
              Nachtrag zum aktiven Vertrag. Eigener Approval- und Signaturprozess.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase">Typ</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="select-amendment-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="price-change">Preisänderung</SelectItem>
                  <SelectItem value="scope-change">Leistungsänderung</SelectItem>
                  <SelectItem value="term-extension">Laufzeitverlängerung</SelectItem>
                  <SelectItem value="renewal">Verlängerung</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase">Titel</label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="z.B. Preisanpassung Q2 2026"
                data-testid="input-amendment-title"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase">Beschreibung</label>
              <textarea
                className="w-full px-3 py-2 border rounded-md text-sm bg-background min-h-[80px]"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Begründung und Umfang der Änderung"
                data-testid="textarea-amendment-description"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
              <Button onClick={onCreate} disabled={!title.trim() || create.isPending} data-testid="button-create-amendment">
                Anlegen
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertragswesen MVP Phase 1 — Deviations & Obligations Sections
// ─────────────────────────────────────────────────────────────────────────────

function severityBadge(sev: string) {
  const map: Record<string, string> = {
    high: "border-red-300 text-red-700 bg-red-50",
    medium: "border-amber-300 text-amber-700 bg-amber-50",
    low: "border-slate-300 text-slate-700",
  };
  return map[sev] ?? "";
}

function deviationTypeLabel(t: string): string {
  return ({
    missing_required: "Pflicht-Klausel fehlt",
    forbidden_used: "Verbotene Klausel verwendet",
    variant_change: "Variante außerhalb Playbook",
    text_edit: "Text-Edit (Redline)",
    threshold_breach: "Schwellwert verletzt",
  } as Record<string, string>)[t] ?? t;
}

function obligationTypeLabel(t: string): string {
  return ({
    delivery: "Lieferung",
    reporting: "Reporting",
    sla: "SLA",
    payment: "Zahlung",
    notice: "Mitteilung",
    audit: "Audit",
  } as Record<string, string>)[t] ?? t;
}

function obligationStatusBadge(s: string) {
  const map: Record<string, string> = {
    pending: "border-slate-300 text-slate-700",
    in_progress: "border-amber-300 text-amber-700 bg-amber-50",
    done: "border-emerald-300 text-emerald-700 bg-emerald-50",
    missed: "border-red-300 text-red-700 bg-red-50",
    waived: "border-slate-300 text-slate-500",
  };
  return map[s] ?? "";
}

function fmtDateShort(s: string | null | undefined): string {
  return s ? new Date(s).toLocaleDateString("de-DE") : "—";
}

function DeviationsSection({ contractId }: { contractId: string }) {
  const { data: deviations, isLoading } = useListContractDeviations(contractId);
  const qc = useQueryClient();
  const { toast } = useToast();
  const evaluate = useEvaluateContractDeviations();
  const resolve = useResolveDeviation();

  const onEvaluate = async () => {
    try {
      const res = await evaluate.mutateAsync({ id: contractId });
      await qc.invalidateQueries({ queryKey: getListContractDeviationsQueryKey(contractId) });
      toast({
        title: "Klausel-Prüfung abgeschlossen",
        description: `Offen: ${res.summary.open} · Gesamt: ${res.summary.total}`,
      });
    } catch {
      toast({ title: "Prüfung fehlgeschlagen", variant: "destructive" });
    }
  };

  const onResolve = async (dev: ClauseDeviation, label: string) => {
    const note = window.prompt(`Begründung für ${label}:`, label);
    if (!note?.trim()) return;
    try {
      await resolve.mutateAsync({ id: dev.id, data: { resolutionNote: note.trim() } });
      await qc.invalidateQueries({ queryKey: getListContractDeviationsQueryKey(contractId) });
      toast({ title: "Abweichung aufgelöst" });
    } catch {
      toast({ title: "Aktion fehlgeschlagen", variant: "destructive" });
    }
  };

  const open = (deviations ?? []).filter(d => !d.resolvedAt);
  const resolved = (deviations ?? []).filter(d => !!d.resolvedAt);

  return (
    <div className="space-y-3" data-testid="section-deviations">
      <div className="flex items-center justify-between gap-2 pb-2 border-b">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Klausel-Abweichungen</h2>
          {open.length > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
              {open.length} offen
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onEvaluate}
          disabled={evaluate.isPending}
          data-testid="button-evaluate-deviations"
        >
          {evaluate.isPending ? "Prüfe…" : "Gegen Playbook prüfen"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (deviations?.length ?? 0) === 0 ? (
        <div className="p-6 text-center border rounded-md text-sm text-muted-foreground bg-muted/10">
          Keine Abweichungen erfasst. Klick auf „Gegen Playbook prüfen", um zu evaluieren.
        </div>
      ) : (
        <div className="space-y-2">
          {[...open, ...resolved].map(dev => (
            <div
              key={dev.id}
              className="border rounded-md p-3 bg-card"
              data-testid={`deviation-row-${dev.id}`}
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={severityBadge(dev.severity)}>
                      {dev.severity}
                    </Badge>
                    <span className="text-sm font-medium">{deviationTypeLabel(dev.deviationType)}</span>
                    {dev.familyName && (
                      <span className="text-xs text-muted-foreground">· {dev.familyName}</span>
                    )}
                    <Badge variant="outline" className={!dev.resolvedAt ? "border-amber-300 text-amber-700" : "border-emerald-300 text-emerald-700"}>
                      {!dev.resolvedAt ? "open" : "resolved"}
                    </Badge>
                    {dev.requiresApproval && !dev.resolvedAt && (
                      <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">approval</Badge>
                    )}
                  </div>
                  {dev.description && (
                    <p className="text-sm text-muted-foreground mt-1">{dev.description}</p>
                  )}
                  {dev.resolutionNote && (
                    <p className="text-xs text-muted-foreground mt-1 italic">→ {dev.resolutionNote}</p>
                  )}
                </div>
                {!dev.resolvedAt && (
                  <div className="flex gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onResolve(dev, "Approved")}
                      disabled={resolve.isPending}
                      data-testid={`button-approve-${dev.id}`}
                    >
                      Approved
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onResolve(dev, "Waived")}
                      disabled={resolve.isPending}
                      data-testid={`button-waive-${dev.id}`}
                    >
                      Waived
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ObligationsSection({ contractId, contractStatus }: { contractId: string; contractStatus: string }) {
  const { data: obligations, isLoading } = useListObligations({ contractId });
  const qc = useQueryClient();
  const { toast } = useToast();
  const derive = useDeriveContractObligations();
  const update = useUpdateObligation();

  const onDerive = async () => {
    try {
      const res = await derive.mutateAsync({ id: contractId });
      await qc.invalidateQueries({ queryKey: getListObligationsQueryKey({ contractId }) });
      toast({
        title: "Pflichten abgeleitet",
        description: `Neu: ${res.created} · Gesamt: ${res.total}`,
      });
    } catch {
      toast({ title: "Ableitung fehlgeschlagen", variant: "destructive" });
    }
  };

  const onAdvance = async (ob: Obligation, status: "in_progress" | "done" | "waived") => {
    try {
      await update.mutateAsync({ id: ob.id, data: { status } });
      await qc.invalidateQueries({ queryKey: getListObligationsQueryKey({ contractId }) });
      toast({ title: "Pflicht aktualisiert", description: `Status: ${status}` });
    } catch {
      toast({ title: "Aktion fehlgeschlagen", variant: "destructive" });
    }
  };

  const items = obligations ?? [];
  const overdueCount = items.filter(
    o => o.dueAt && o.status !== "done" && o.status !== "waived" && new Date(o.dueAt) < new Date()
  ).length;

  return (
    <div className="space-y-3" data-testid="section-obligations">
      <div className="flex items-center justify-between gap-2 pb-2 border-b">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Vertragspflichten</h2>
          {overdueCount > 0 && (
            <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">
              {overdueCount} überfällig
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onDerive}
          disabled={derive.isPending || contractStatus !== "signed"}
          data-testid="button-derive-obligations"
          title={contractStatus !== "signed" ? "Nur für signierte Verträge" : undefined}
        >
          {derive.isPending ? "Ableite…" : "Aus Klauseln ableiten"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : items.length === 0 ? (
        <div className="p-6 text-center border rounded-md text-sm text-muted-foreground bg-muted/10">
          {contractStatus === "signed"
            ? 'Noch keine Pflichten — klick auf „Aus Klauseln ableiten".'
            : "Pflichten werden bei Signatur automatisch erzeugt."}
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Titel</th>
                <th className="text-left px-3 py-2">Typ</th>
                <th className="text-left px-3 py-2">Fällig</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {items.map(ob => {
                const overdue = ob.dueAt && ob.status !== "done" && ob.status !== "waived" && new Date(ob.dueAt) < new Date();
                return (
                  <tr key={ob.id} className="border-t" data-testid={`obligation-row-${ob.id}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium">{ob.description}</div>
                      {ob.ownerName && <div className="text-xs text-muted-foreground">Owner: {ob.ownerName}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">{obligationTypeLabel(ob.type)}</td>
                    <td className={`px-3 py-2 text-xs ${overdue ? "text-red-700 font-medium" : ""}`}>
                      {fmtDateShort(ob.dueAt)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={obligationStatusBadge(ob.status)}>
                        {ob.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {ob.status !== "done" && ob.status !== "waived" && (
                        <div className="inline-flex gap-1">
                          {ob.status === "pending" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onAdvance(ob, "in_progress")}
                              disabled={update.isPending}
                              data-testid={`button-start-${ob.id}`}
                            >
                              Start
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onAdvance(ob, "done")}
                            disabled={update.isPending}
                            data-testid={`button-done-${ob.id}`}
                          >
                            Erledigt
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onAdvance(ob, "waived")}
                            disabled={update.isPending}
                            data-testid={`button-waive-ob-${ob.id}`}
                          >
                            Verzicht
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type CompatEntry = {
  contractClauseId: string;
  status: "ok" | "warning" | "conflict";
  conflicts?: Array<{ withFamilyName?: string | null; withVariantName?: string | null; note?: string | null }> | null;
  requiresOpen?: Array<{ requiredFamilyName?: string | null; requiredVariantName?: string | null; note?: string | null }> | null;
};

function CompatBadge({ compat }: { compat: CompatEntry }) {
  const { t } = useTranslation();
  const conflicts = compat.conflicts ?? [];
  const open = compat.requiresOpen ?? [];

  if (compat.status === "ok") {
    return (
      <Badge
        variant="outline"
        className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs"
        data-testid={`compat-badge-${compat.contractClauseId}`}
      >
        ✓ {t("pages.clauses.compatBadgeOk")}
      </Badge>
    );
  }

  const isConflict = compat.status === "conflict";
  const lines: string[] = [];
  conflicts.forEach(c => {
    lines.push(t("pages.clauses.compatConflictLine", {
      variant: c.withVariantName ?? "?",
      family: c.withFamilyName ?? "?",
    }));
    if (c.note) lines.push(`— ${c.note}`);
  });
  open.forEach(c => {
    lines.push(t("pages.clauses.compatRequiresOpenLine", {
      variant: c.requiredVariantName ?? "?",
      family: c.requiredFamilyName ?? "?",
    }));
    if (c.note) lines.push(`— ${c.note}`);
  });

  return (
    <Badge
      variant="outline"
      className={
        isConflict
          ? "bg-rose-500/10 text-rose-600 border-rose-500/30 text-xs cursor-help"
          : "bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs cursor-help"
      }
      title={lines.join("\n")}
      data-testid={`compat-badge-${compat.contractClauseId}`}
    >
      {isConflict ? "✕ " : "⚠ "}
      {isConflict ? t("pages.clauses.compatBadgeConflict") : t("pages.clauses.compatBadgeWarning")}
    </Badge>
  );
}

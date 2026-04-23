import { useRoute, Link } from "wouter";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetContract,
  useListClauseFamilies,
  useListContractClauses,
  usePatchContractClause,
  getGetContractQueryKey,
  getListContractClausesQueryKey,
  type ContractClause,
  type ClauseVariant,
  type ClauseFamily,
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
import { FileText, ShieldAlert, Library, Activity, GitCompare, AlertTriangle } from "lucide-react";
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

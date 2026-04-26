import { useRoute, useLocation, Link } from "wouter";
import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetContract,
  usePatchContract,
  useListClauseFamilies,
  useListContractClauses,
  usePatchContractClause,
  useCreateClauseSuggestion,
  getGetClauseSuggestionStatsQueryKey,
  useGetClauseSuggestionStats,
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
  useGetContractCuadCoverage,
  useAddContractClause,
  getGetContractCuadCoverageQueryKey,
  useListContractTypes,
  useRequestContractApproval,
  useLintContract,
  useListExternalCollaborators,
  useCreateExternalCollaborator,
  useRevokeExternalCollaborator,
  useListContractExternalEvents,
  getListExternalCollaboratorsQueryKey,
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
  type ExternalCollaborator,
  type ExternalCollaboratorCreate,
  type ExternalCollaboratorEvent,
  type CuadCoverage,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabState } from "@/hooks/use-tab-state";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileText, ShieldAlert, ShieldCheck, Library, Activity, GitCompare, AlertTriangle, FileStack, Plus, Languages, Pencil, Sparkles, Inbox, RotateCcw, Eye, MessageSquare, Pencil as PencilIcon, Ban, ShieldOff, Filter as FilterIcon, Paperclip } from "lucide-react";
import { EntityVersions } from "@/components/ui/entity-versions";
import { useToast } from "@/hooks/use-toast";
import { ApiError } from "@workspace/api-client-react";
import { AiPromptPanel } from "@/components/copilot/ai-prompt-panel";
import { Breadcrumbs } from "@/components/patterns/breadcrumbs";
import { LintPanel } from "@/components/contract/lint-panel";
import { NegotiationStrategyTab } from "@/components/contract/negotiation-strategy-tab";
import { RegulatorySection } from "@/components/contract/regulatory-section";

/**
 * Kleiner Badge für den Konsistenz-Tab — zeigt die Fehler-Anzahl als roter
 * Badge, sodass User sofort sehen, dass etwas zu prüfen ist. Nutzt denselben
 * Lint-Endpoint wie das LintPanel; React Query dedupliziert die Anfrage.
 */
function LintErrorBadge({ contractId }: { contractId: string }) {
  const { data } = useLintContract(contractId);
  const errorCount = data?.counts?.error ?? 0;
  const warnCount = data?.counts?.warn ?? 0;
  if (errorCount > 0) {
    return (
      <Badge variant="destructive" className="ml-2" data-testid="lint-tab-error-count">
        {errorCount}
      </Badge>
    );
  }
  if (warnCount > 0) {
    return (
      <Badge
        variant="outline"
        className="ml-2 bg-amber-500/10 text-amber-700 border-amber-500/40"
        data-testid="lint-tab-warn-count"
      >
        {warnCount}
      </Badge>
    );
  }
  return null;
}

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
  const patchContract = usePatchContract();
  async function changeLanguage(next: "de" | "en") {
    if (!contract || (contract.language ?? "de") === next) return;
    try {
      await patchContract.mutateAsync({ id: id ?? "", data: { language: next } });
      await qc.invalidateQueries({ queryKey: getGetContractQueryKey(id ?? "") });
      await qc.invalidateQueries({ queryKey: ["/api/v1/contracts", id, "clauses"] });
      toast({ description: t("pages.contracts.languageChanged") });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  }

  const [diff, setDiff] = useState<DiffState>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [editClause, setEditClause] = useState<ContractClause | null>(null);
  const [queueClause, setQueueClause] = useState<ContractClause | null>(null);
  const [tab, setTab] = useTabState("overview");

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
      <Breadcrumbs
        items={[
          { label: t("nav.contracts"), href: "/contracts" },
          { label: contract.title },
        ]}
      />
      <div className="sticky top-0 z-20 -mx-4 px-4 md:-mx-6 md:px-6 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex flex-col gap-2 border-b pb-4 pt-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <FileText className="h-8 w-8 text-muted-foreground shrink-0" />
            <h1 className="text-3xl font-bold tracking-tight truncate">{contract.title}</h1>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <div className="flex items-center gap-1.5">
              <Languages className="h-4 w-4 text-muted-foreground" />
              <Select
                value={contract.language ?? "de"}
                onValueChange={(v) => changeLanguage(v as "de" | "en")}
              >
                <SelectTrigger className="h-8 w-[120px]" data-testid="contract-language-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="de">DE</SelectItem>
                  <SelectItem value="en">EN</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={() => window.open(`/api/contracts/${id}/pdf`, '_blank')}>
              <FileText className="h-4 w-4 mr-2" /> View PDF
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

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList
          className="w-full md:w-auto h-auto flex overflow-x-auto whitespace-nowrap justify-start"
          data-testid="contract-tabs"
        >
          <TabsTrigger value="overview" data-testid="contract-tab-overview">
            {t("pages.contracts.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="clauses" data-testid="contract-tab-clauses">
            {t("pages.contracts.tabs.clauses")}
            {clauses && clauses.length > 0 && (
              <Badge variant="secondary" className="ml-2">{clauses.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="attachments" data-testid="contract-tab-attachments">
            {t("pages.contracts.tabs.attachments")}
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="contract-tab-activity">
            {t("pages.contracts.tabs.activity")}
          </TabsTrigger>
          <TabsTrigger value="lint" data-testid="contract-tab-lint">
            Konsistenz
            <LintErrorBadge contractId={id} />
          </TabsTrigger>
          <TabsTrigger value="approvals" data-testid="contract-tab-approvals">
            {t("pages.contracts.tabs.approvals")}
          </TabsTrigger>
          <TabsTrigger value="negotiation" data-testid="contract-tab-negotiation">
            {t("pages.contracts.tabs.negotiation")}
          </TabsTrigger>
          <TabsTrigger value="regulatory" data-testid="contract-tab-regulatory">
            Regulatorik
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-6" data-testid="contract-tabpanel-overview">
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
          <AiPromptPanel mode="contract.risk" entityId={id} />
          <EffectiveStateSection contractId={id} contractStatus={contract.status} />
          <CuadCoverageSection contractId={id} />
        </TabsContent>

        <TabsContent value="clauses" className="mt-4 space-y-6" data-testid="contract-tabpanel-clauses">
          <DeviationsSection contractId={id} />
          <div className="space-y-4">
            <div className="flex items-center gap-2 pb-2 border-b">
              <ShieldAlert className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-xl font-semibold">{t("pages.contracts.currentClauses")}</h2>
            </div>

        {(clauses?.length ?? 0) === 0 ? (
          <div className="p-8 text-center border rounded-xl text-muted-foreground bg-accent/20">
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
                  <CardHeader className="py-3 px-4 flex flex-row items-start justify-between gap-4 bg-accent/20">
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
                        {clause.translationMissing && (
                          <Badge
                            variant="outline"
                            className="bg-amber-500/10 text-amber-600 border-amber-500/30"
                            data-testid={`clause-translation-missing-${clause.id}`}
                          >
                            <Languages className="h-3 w-3 mr-1" />
                            {t("pages.contracts.translationMissingClause")}
                          </Badge>
                        )}
                        {clause.edited && (
                          <Badge
                            variant="outline"
                            className="bg-fuchsia-500/10 text-fuchsia-600 border-fuchsia-500/30"
                            data-testid={`clause-edited-${clause.id}`}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            {t("pages.clauseSuggestions.editEdited")}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Select
                        value={clause.activeVariantId ?? ""}
                        onValueChange={(v) => onVariantChange(clause, v)}
                        disabled={pending === clause.id}
                      >
                        <SelectTrigger className="w-[260px]" data-testid={`clause-variant-select-${clause.id}`}>
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
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-9 w-9 p-0"
                        onClick={() => setEditClause(clause)}
                        title={t("pages.clauseSuggestions.editClauseTitle")}
                        data-testid={`clause-edit-${clause.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {clause.edited && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 w-9 p-0"
                          onClick={() => setQueueClause(clause)}
                          title={t("pages.clauseSuggestions.queueButton")}
                          data-testid={`clause-queue-${clause.id}`}
                        >
                          <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                        </Button>
                      )}
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
                <Card key={family.id} className="bg-accent/10">
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
        </TabsContent>

        <TabsContent value="attachments" className="mt-4" data-testid="contract-tabpanel-attachments">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                {t("pages.contracts.tabs.attachments")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm text-muted-foreground text-center py-8">
                {t("pages.contracts.tabs.noAttachments")}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4 space-y-6" data-testid="contract-tabpanel-activity">
          <EntityVersions entityType="contract" entityId={id} />
          <ObligationsSection contractId={id} contractStatus={contract.status} />
          <ExternalAccessActivityCard contractId={id} />
        </TabsContent>

        <TabsContent value="lint" className="mt-4 space-y-6" data-testid="contract-tabpanel-lint">
          <LintPanel contractId={id} />
        </TabsContent>

        <TabsContent value="approvals" className="mt-4 space-y-6" data-testid="contract-tabpanel-approvals">
          <AmendmentsSection contractId={id} contractStatus={contract.status} />
          <ExternalCollaboratorsCard contractId={id} />
        </TabsContent>

        <TabsContent value="negotiation" className="mt-4 space-y-6" data-testid="contract-tabpanel-negotiation">
          <NegotiationStrategyTab contractId={id} clauses={clauses ?? []} />
        </TabsContent>

        <TabsContent value="regulatory" className="mt-4 space-y-6" data-testid="contract-tabpanel-regulatory">
          <RegulatorySection contractId={id} />
        </TabsContent>
      </Tabs>

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
                <div className="p-3 border rounded-lg text-sm leading-relaxed bg-accent/20">
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

      {editClause && (
        <EditClauseDialog
          contractId={id}
          clause={editClause}
          onClose={() => setEditClause(null)}
        />
      )}
      {queueClause && (
        <QueueSuggestionDialog
          contractId={id}
          clause={queueClause}
          families={families ?? []}
          onClose={() => setQueueClause(null)}
        />
      )}
    </div>
  );
}

function EditClauseDialog({
  contractId, clause, onClose,
}: {
  contractId: string;
  clause: ContractClause;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const patch = usePatchContractClause();
  const [name, setName] = useState(clause.variant ?? "");
  const [summary, setSummary] = useState(clause.summary ?? "");
  const [body, setBody] = useState(clause.body ?? "");
  const [reason, setReason] = useState(clause.editedReason ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await patch.mutateAsync({
        id: clause.id,
        data: {
          editedName: name,
          editedSummary: summary,
          editedBody: body,
          editedReason: reason || undefined,
        },
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListContractClausesQueryKey(contractId) }),
        qc.invalidateQueries({ queryKey: getGetClauseSuggestionStatsQueryKey({ days: 30 }) }),
      ]);
      toast({ description: t("pages.clauseSuggestions.queueQueued") });
      onClose();
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await patch.mutateAsync({ id: clause.id, data: { clearEdits: true } });
      await qc.invalidateQueries({ queryKey: getListContractClausesQueryKey(contractId) });
      onClose();
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("pages.clauseSuggestions.editClauseTitle")}</DialogTitle>
          <DialogDescription>{t("pages.clauseSuggestions.editClauseHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.editName")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="edit-clause-name" />
          </div>
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.editSummary")}</Label>
            <Textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={2}
              data-testid="edit-clause-summary"
            />
          </div>
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.editBody")}</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              data-testid="edit-clause-body"
            />
          </div>
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.editReason")}</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="edit-clause-reason" />
          </div>
        </div>
        <DialogFooter className="flex justify-between sm:justify-between">
          <div>
            {clause.edited && (
              <Button variant="outline" onClick={clear} disabled={busy} data-testid="edit-clause-clear">
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                {t("pages.clauseSuggestions.editClear")}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
            <Button onClick={save} disabled={busy || !name.trim() || !body.trim()} data-testid="edit-clause-save">
              {busy ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QueueSuggestionDialog({
  contractId, clause, families, onClose,
}: {
  contractId: string;
  clause: ContractClause;
  families: ClauseFamily[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateClauseSuggestion();
  const [familyId, setFamilyId] = useState<string>(clause.familyId ?? families[0]?.id ?? "");
  const [name, setName] = useState(clause.variant ?? "");
  const [summary, setSummary] = useState(clause.summary ?? "");
  const [body, setBody] = useState(clause.body ?? "");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!familyId) return;
    setBusy(true);
    try {
      await create.mutateAsync({
        data: {
          familyId,
          proposedName: name,
          proposedSummary: summary,
          proposedBody: body,
          contractId,
          contractClauseId: clause.id,
          baseVariantId: clause.activeVariantId ?? undefined,
          sourceType: clause.activeVariantId ? "edit" : "ad-hoc",
        },
      });
      await qc.invalidateQueries({ queryKey: getGetClauseSuggestionStatsQueryKey({ days: 30 }) });
      toast({ description: t("pages.clauseSuggestions.queueQueued") });
      onClose();
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.clauseSuggestions.queueDialogTitle")}</DialogTitle>
          <DialogDescription>{t("pages.clauseSuggestions.queueDialogHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.queueFamily")}</Label>
            <Select value={familyId} onValueChange={setFamilyId}>
              <SelectTrigger data-testid="queue-family">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {families.map(f => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.queueProposedName")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="queue-name" />
          </div>
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.queueProposedSummary")}</Label>
            <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} data-testid="queue-summary" />
          </div>
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.queueProposedBody")}</Label>
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} data-testid="queue-body" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button
            onClick={submit}
            disabled={busy || !familyId || !name.trim() || !body.trim() || !summary.trim()}
            data-testid="queue-submit"
          >
            <Inbox className="h-3.5 w-3.5 mr-1" />
            {busy ? t("common.loading") : t("pages.clauseSuggestions.queueButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function amendmentTypeLabel(type: string): string {
  switch (type) {
    case "price-change": return "Price change";
    case "scope-change": return "Scope change";
    case "term-extension": return "Term extension";
    case "renewal": return "Renewal";
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
          <h2 className="text-xl font-semibold">Current contract state</h2>
          {data && <Badge variant="outline" className="ml-2">{data.appliedAmendments.length} amendments applied</Badge>}
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(!open)} data-testid="button-toggle-effective-state">
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open && (
        isLoading || !data ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Clause set including all active amendments ({data.appliedAmendments.length} applied).
            </p>
            {data.clauses.length === 0 ? (
              <div className="p-4 text-center border rounded-xl text-muted-foreground bg-accent/20 text-sm">
                No clauses present.
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
      toast({ title: "Amendment created" });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-2">
          <FileStack className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Amendments</h2>
          <Badge variant="outline" className="ml-2">{amendments?.length ?? 0}</Badge>
        </div>
        {canAmend && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="button-new-amendment">
            <Plus className="h-4 w-4 mr-1" /> New amendment
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (amendments?.length ?? 0) === 0 ? (
        <div className="p-6 text-center border rounded-xl text-muted-foreground bg-accent/20 text-sm">
          {canAmend ? "No amendments." : `Amendments are only available once the contract status is "signed".`}
        </div>
      ) : (
        <div className="grid gap-2">
          {amendments?.map(a => (
            <Link key={a.id} href={`/amendments/${a.id}`}>
              <Card className="hover:bg-accent/30 transition-colors cursor-pointer" data-testid={`amendment-${a.id}`}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">{a.number}</span>
                      <span>·</span>
                      <span>{amendmentTypeLabel(a.type)}</span>
                      {a.effectiveFrom && (
                        <>
                          <span>·</span>
                          <span>valid from {new Date(a.effectiveFrom).toLocaleDateString()}</span>
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
            <DialogTitle>New amendment</DialogTitle>
            <DialogDescription>
              Amendment to the active contract. Has its own approval and signature process.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase">Type</label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger data-testid="select-amendment-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="price-change">Price change</SelectItem>
                  <SelectItem value="scope-change">Scope change</SelectItem>
                  <SelectItem value="term-extension">Term extension</SelectItem>
                  <SelectItem value="renewal">Renewal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase">Title</label>
              <input
                type="text"
                className="w-full px-3 py-2 border rounded-lg text-sm bg-background"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Price adjustment Q2 2026"
                data-testid="input-amendment-title"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase">Description</label>
              <textarea
                className="w-full px-3 py-2 border rounded-lg text-sm bg-background min-h-[80px]"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Justification and scope of the change"
                data-testid="textarea-amendment-description"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
              <Button onClick={onCreate} disabled={!title.trim() || create.isPending} data-testid="button-create-amendment">
                Create
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
    missing_required: "Required clause missing",
    forbidden_used: "Forbidden clause used",
    variant_change: "Variant outside playbook",
    text_edit: "Text edit (Redline)",
    threshold_breach: "Threshold breached",
  } as Record<string, string>)[t] ?? t;
}

function obligationTypeLabel(t: string): string {
  return ({
    delivery: "Delivery",
    reporting: "Reporting",
    sla: "SLA",
    payment: "Payment",
    notice: "Notice",
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

// ─────────────────────────────────────────────────────────────────────────────
// CUAD-Vollständigkeits-Check — "Typische Bausteine fehlen"
// ─────────────────────────────────────────────────────────────────────────────

function CuadCoverageSection({ contractId }: { contractId: string }) {
  const { data, isLoading } = useGetContractCuadCoverage(contractId);
  const { data: families } = useListClauseFamilies();
  const { data: contractTypes } = useListContractTypes();
  const patchContract = usePatchContract();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAll, setShowAll] = useState(false);
  const [pendingFamilyId, setPendingFamilyId] = useState<string | null>(null);
  const [pendingContractTypeId, setPendingContractTypeId] = useState("");
  const addClause = useAddContractClause();
  const { user } = useAuth();
  const isTenantAdmin = !!(user?.isPlatformAdmin || user?.role === "Tenant Admin");
  const [, setLocation] = useLocation();
  const requestApproval = useRequestContractApproval();
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const familyNameById = new Map<string, string>();
  for (const f of families ?? []) familyNameById.set(f.id, f.name);

  const cov = (data ?? null) as CuadCoverage | null;

  async function handleBindContractType() {
    if (!pendingContractTypeId) return;
    try {
      await patchContract.mutateAsync({
        id: contractId,
        data: { contractTypeId: pendingContractTypeId },
      });
      toast({ title: "Contract type assigned", description: "CUAD coverage will be recalculated." });
      await qc.invalidateQueries({ queryKey: getGetContractQueryKey(contractId) });
      await qc.invalidateQueries();
      setPendingContractTypeId("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Please try again.";
      toast({ title: "Assignment failed", description: msg, variant: "destructive" });
    }
  }

  const totalRequired = (cov?.totalExpected ?? 0);
  const coveredRequired = (cov?.coveredExpected ?? 0);
  const pct = totalRequired > 0 ? Math.round((coveredRequired / totalRequired) * 100) : null;
  const missingExpected = (cov?.missing ?? []).filter(m => m.requirement === "expected");
  const missingExpectedCount = cov?.missingExpectedCount ?? 0;
  const blocked = missingExpectedCount > 0;

  const onAddFamily = async (familyId: string) => {
    setPendingFamilyId(familyId);
    try {
      const res = await addClause.mutateAsync({ id: contractId, data: { familyId } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetContractCuadCoverageQueryKey(contractId) }),
        qc.invalidateQueries({ queryKey: getListContractClausesQueryKey(contractId) }),
        qc.invalidateQueries({ queryKey: getGetContractQueryKey(contractId) }),
      ]);
      toast({
        title: "Clause added",
        description: `${res.clause.family} → ${res.clause.variant}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Add failed", description: msg, variant: "destructive" });
    } finally {
      setPendingFamilyId(null);
    }
  };

  const renderFamilyChips = (ids: string[]) => (
    ids.length ? (
      <div className="flex flex-wrap gap-1 mt-1">
        {ids.map(fid => (
          <Badge key={fid} variant="outline" className="text-[11px] font-normal">
            {familyNameById.get(fid) ?? fid}
          </Badge>
        ))}
      </div>
    ) : null
  );

  const renderSuggestedFamilies = (ids: string[], cuadCategoryId: string) => (
    ids.length ? (
      <div className="flex flex-wrap gap-1.5 mt-1">
        {ids.map(fid => {
          const isPending = pendingFamilyId === fid && addClause.isPending;
          return (
            <div
              key={fid}
              className="inline-flex items-center gap-1 border rounded-full pl-2 pr-1 py-0.5 bg-card"
              data-testid={`cuad-suggest-${cuadCategoryId}-${fid}`}
            >
              <span className="text-[11px]">{familyNameById.get(fid) ?? fid}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-5 px-1.5 text-[11px] gap-1"
                disabled={addClause.isPending}
                onClick={() => onAddFamily(fid)}
                data-testid={`cuad-add-${cuadCategoryId}-${fid}`}
              >
                <Plus className="h-3 w-3" />
                {isPending ? "…" : "Add"}
              </Button>
            </div>
          );
        })}
      </div>
    ) : null
  );

  async function submitApproval(opts: { override: boolean; overrideReason?: string }) {
    try {
      const result = await requestApproval.mutateAsync({
        id: contractId,
        data: {
          override: opts.override,
          ...(opts.overrideReason ? { overrideReason: opts.overrideReason } : {}),
        },
      });
      toast({
        title: opts.override ? "Approval requested via override" : "Approval requested",
        description: opts.override
          ? `Override logged in audit log · ${missingExpectedCount} required component${missingExpectedCount === 1 ? "" : "s"} missing`
          : "Opening approval hub…",
        variant: opts.override ? "destructive" : "default",
      });
      setOverrideOpen(false);
      setOverrideReason("");
      await qc.invalidateQueries({ queryKey: ["/api/v1/approvals"] });
      setLocation(`/approvals?highlight=${encodeURIComponent(result.approvalId)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const data = err.data as { code?: string; missingExpectedCount?: number; approvalId?: string } | null;
        if (data?.code === "cuad_required_missing") {
          toast({
            title: "Approval blocked",
            description: `Required CUAD components missing (${data.missingExpectedCount ?? 0}). Please add them or request an override.`,
            variant: "destructive",
          });
          return;
        }
        if (data?.approvalId) {
          toast({
            title: "Already requested",
            description: "An open approval already exists for this contract.",
          });
          setLocation(`/approvals?highlight=${encodeURIComponent(data.approvalId)}`);
          return;
        }
      }
      if (err instanceof ApiError && err.status === 403) {
        toast({
          title: "Override not allowed",
          description: "Only tenant admins may bypass the CUAD pre-check.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Could not request approval",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-3" data-testid="section-cuad-coverage">
      <div className="flex items-center justify-between gap-2 pb-2 border-b flex-wrap">
        <div className="flex items-center gap-2">
          <Library className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Typical components (CUAD)</h2>
          {cov && (
            <Badge variant="outline" className="ml-2">
              {coveredRequired}/{totalRequired} required
            </Badge>
          )}
          {cov && cov.missingExpectedCount > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
              {cov.missingExpectedCount} missing
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {blocked ? (
            isTenantAdmin ? (
              <Button
                size="sm"
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-50"
                onClick={() => { setOverrideReason(""); setOverrideOpen(true); }}
                data-testid="button-request-approval-override"
              >
                <ShieldAlert className="h-4 w-4 mr-2" /> Request anyway
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled
                title="Required components missing — override only for tenant admins"
                data-testid="button-request-approval-blocked"
              >
                <ShieldAlert className="h-4 w-4 mr-2" /> Approval blocked
              </Button>
            )
          ) : (
            <Button
              size="sm"
              onClick={() => submitApproval({ override: false })}
              disabled={requestApproval.isPending || !cov}
              data-testid="button-request-approval"
            >
              <ShieldCheck className="h-4 w-4 mr-2" />
              {requestApproval.isPending ? "Sending…" : "Request approval"}
            </Button>
          )}
        </div>
      </div>

      {blocked && (
        <div
          className="border border-red-300 bg-red-50/60 rounded-xl p-4 space-y-2"
          data-testid="cuad-block-banner"
        >
          <div className="flex items-center gap-2 text-red-800 font-medium text-sm">
            <ShieldAlert className="h-4 w-4" />
            Approval blocked: Required clauses missing ({missingExpectedCount})
          </div>
          <div className="text-xs text-red-900/80">
            For contract type <strong>{cov?.contractTypeName ?? cov?.contractTypeId}</strong> the following
            mandatory CUAD categories are not yet covered:
          </div>
          <ul className="text-xs text-red-900 list-disc pl-5 space-y-0.5" data-testid="cuad-block-missing-list">
            {missingExpected.map(m => (
              <li key={m.cuadCategoryId} data-testid={`cuad-block-missing-${m.cuadCategoryId}`}>
                <span className="font-medium">{m.name}</span>{" "}
                <span className="font-mono text-[10px] opacity-70">({m.code})</span>
              </li>
            ))}
          </ul>
          {!isTenantAdmin && (
            <div className="text-xs text-red-900/80 pt-1">
              Please add the missing clause families below or ask a tenant admin for an override.
            </div>
          )}
        </div>
      )}

      <Dialog open={overrideOpen} onOpenChange={(o) => { if (!o) setOverrideOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request approval despite missing required clauses?</DialogTitle>
            <DialogDescription>
              {missingExpectedCount} required CUAD categor{missingExpectedCount === 1 ? "y" : "ies"}{" "}
              ({missingExpected.map(m => m.code).join(", ")}) {missingExpectedCount === 1 ? "is" : "are"} missing for{" "}
              <strong>{cov?.contractTypeName ?? cov?.contractTypeId}</strong>. The override
              is recorded in the audit log and is compliance-relevant — please provide a clear,
              traceable justification.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="override-reason">Justification (required, ≥10 characters)</Label>
            <Textarea
              id="override-reason"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="e.g. Parties + Governing Law are covered in the attached side letter — approval escalation to Legal Lead via email."
              rows={4}
              data-testid="textarea-override-reason"
            />
            <div className="text-xs text-muted-foreground">
              {overrideReason.trim().length}/10 characters
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)} data-testid="button-override-cancel">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={overrideReason.trim().length < 10 || requestApproval.isPending}
              onClick={() => submitApproval({ override: true, overrideReason: overrideReason.trim() })}
              data-testid="button-override-confirm"
            >
              {requestApproval.isPending ? "Sending…" : "Apply override & request approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !cov || !cov.contractTypeId ? (
        <div
          className="p-4 border rounded-xl text-sm bg-accent/20 space-y-3"
          data-testid="cuad-bind-contract-type"
        >
          <p className="text-muted-foreground">
            No contract type assigned — without it, CUAD coverage cannot be calculated.
            Select a contract type to check the typical clauses immediately.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={pendingContractTypeId}
              onValueChange={setPendingContractTypeId}
            >
              <SelectTrigger
                className="w-72"
                data-testid="select-bind-contract-type"
              >
                <SelectValue placeholder="Select contract type…" />
              </SelectTrigger>
              <SelectContent>
                {(contractTypes ?? [])
                  .filter(t => t.active)
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name, "de"))
                  .map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.code})
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleBindContractType}
              disabled={!pendingContractTypeId || patchContract.isPending}
              data-testid="button-bind-contract-type"
            >
              Assign contract type
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-sm font-medium">{cov.contractTypeName ?? cov.contractTypeId}</div>
                  <div className="text-xs text-muted-foreground">
                    {coveredRequired} of {totalRequired} required categories covered
                    {cov.totalRecommended > 0 && (
                      <> · {cov.coveredRecommended}/{cov.totalRecommended} recommended</>
                    )}
                  </div>
                </div>
                {pct != null && (
                  <div className="text-2xl font-semibold tabular-nums" data-testid="cuad-coverage-pct">
                    {pct}%
                  </div>
                )}
              </div>
              {pct != null && <Progress value={pct} className="h-2" />}
            </CardContent>
          </Card>

          {cov.missing.length > 0 && (
            <div className="space-y-2" data-testid="cuad-missing-list">
              <div className="text-sm font-medium text-amber-700">
                Typical clauses missing
              </div>
              {cov.missing.map(m => (
                <div
                  key={m.cuadCategoryId}
                  className="border rounded-xl p-3 bg-card"
                  data-testid={`cuad-missing-${m.cuadCategoryId}`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={m.requirement === "expected"
                            ? "border-amber-300 text-amber-700 bg-amber-50"
                            : "border-slate-300 text-slate-600"}
                        >
                          {m.requirement === "expected" ? "Required" : "Recommended"}
                        </Badge>
                        <span className="text-sm font-medium">{m.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{m.code}</span>
                      </div>
                      {m.suggestedFamilyIds.length > 0 && (
                        <div className="mt-1.5">
                          <div className="text-xs text-muted-foreground">
                            Suggestions — add clause family:
                          </div>
                          {renderSuggestedFamilies(m.suggestedFamilyIds, m.cuadCategoryId)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {cov.covered.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowAll(s => !s)}
                className="text-xs text-muted-foreground hover:underline"
                data-testid="cuad-toggle-covered"
              >
                {showAll ? "▾" : "▸"} Covered categories ({cov.covered.length})
              </button>
              {showAll && (
                <div className="grid gap-2" data-testid="cuad-covered-list">
                  {cov.covered.map(c => (
                    <div
                      key={c.cuadCategoryId}
                      className="border rounded-xl p-2 bg-emerald-50/30 text-sm"
                      data-testid={`cuad-covered-${c.cuadCategoryId}`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50">
                          {c.requirement === "expected" ? "Required" : "Rec."}
                        </Badge>
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground font-mono">{c.code}</span>
                      </div>
                      {renderFamilyChips(c.coveredByFamilyIds)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
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
        title: "Clause check completed",
        description: `Open: ${res.summary.open} · Total: ${res.summary.total}`,
      });
    } catch {
      toast({ title: "Check failed", variant: "destructive" });
    }
  };

  const onResolve = async (dev: ClauseDeviation, label: string) => {
    const note = window.prompt(`Reason for ${label}:`, label);
    if (!note?.trim()) return;
    try {
      await resolve.mutateAsync({ id: dev.id, data: { resolutionNote: note.trim() } });
      await qc.invalidateQueries({ queryKey: getListContractDeviationsQueryKey(contractId) });
      toast({ title: "Deviation resolved" });
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
    }
  };

  const open = (deviations ?? []).filter(d => !d.resolvedAt);
  const resolved = (deviations ?? []).filter(d => !!d.resolvedAt);

  return (
    <div className="space-y-3" data-testid="section-deviations">
      <div className="flex items-center justify-between gap-2 pb-2 border-b">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">Clause deviations</h2>
          {open.length > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50">
              {open.length} open
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
          {evaluate.isPending ? "Checking…" : "Check against playbook"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (deviations?.length ?? 0) === 0 ? (
        <div className="p-6 text-center border rounded-xl text-sm text-muted-foreground bg-accent/20">
          No deviations recorded. Click "Check against playbook" to evaluate.
        </div>
      ) : (
        <div className="space-y-2">
          {[...open, ...resolved].map(dev => (
            <div
              key={dev.id}
              className="border rounded-xl p-3 bg-card"
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
        title: "Obligations derived",
        description: `New: ${res.created} · Total: ${res.total}`,
      });
    } catch {
      toast({ title: "Derivation failed", variant: "destructive" });
    }
  };

  const onAdvance = async (ob: Obligation, status: "in_progress" | "done" | "waived") => {
    try {
      await update.mutateAsync({ id: ob.id, data: { status } });
      await qc.invalidateQueries({ queryKey: getListObligationsQueryKey({ contractId }) });
      toast({ title: "Obligation updated", description: `Status: ${status}` });
    } catch {
      toast({ title: "Action failed", variant: "destructive" });
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
          <h2 className="text-xl font-semibold">Contract obligations</h2>
          {overdueCount > 0 && (
            <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50">
              {overdueCount} overdue
            </Badge>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onDerive}
          disabled={derive.isPending || contractStatus !== "signed"}
          data-testid="button-derive-obligations"
          title={contractStatus !== "signed" ? "Only available for signed contracts" : undefined}
        >
          {derive.isPending ? "Deriving…" : "Derive from clauses"}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : items.length === 0 ? (
        <div className="p-6 text-center border rounded-xl text-sm text-muted-foreground bg-accent/20">
          {contractStatus === "signed"
            ? 'No obligations yet — click "Derive from clauses".'
            : "Obligations are generated automatically on signature."}
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-accent/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Title</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Due</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Action</th>
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
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onAdvance(ob, "waived")}
                            disabled={update.isPending}
                            data-testid={`button-waive-ob-${ob.id}`}
                          >
                            Waive
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

// =========================================================================
// External Collaborators (Magic-Link) Card — Task #70
// =========================================================================

function ExternalCollaboratorsCard({ contractId }: { contractId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: collabs, isLoading } = useListExternalCollaborators(contractId);
  const create = useCreateExternalCollaborator();
  const revoke = useRevokeExternalCollaborator();

  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [capView] = useState(true); // implicit
  const [capComment, setCapComment] = useState(true);
  const [capEditFields, setCapEditFields] = useState(false);
  const [capSign, setCapSign] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [editableFields, setEditableFields] = useState<string[]>([]);
  const [ipAllowlistText, setIpAllowlistText] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [createdToken, setCreatedToken] = useState<
    | {
        url: string;
        email: string;
        emailSent: { ok: boolean; provider: string; error?: string | null } | null;
      }
    | null
  >(null);

  const EDITABLE_FIELD_KEYS = ["effectiveFrom", "effectiveTo", "governingLaw", "jurisdiction"] as const;

  function reset() {
    setEmail(""); setName(""); setOrganization("");
    setCapComment(true); setCapEditFields(false); setCapSign(false);
    setExpiresInDays(14); setEditableFields([]); setIpAllowlistText("");
    setSendEmail(true);
  }

  function toggleEditableField(field: string) {
    setEditableFields((prev) => prev.includes(field) ? prev.filter(f => f !== field) : [...prev, field]);
  }

  async function handleSubmit() {
    const caps: ("view" | "comment" | "edit_fields" | "sign_party")[] = ["view"];
    if (capComment) caps.push("comment");
    if (capEditFields) caps.push("edit_fields");
    if (capSign) caps.push("sign_party");
    // Cross-Check vor dem Server-Call: edit_fields ohne Whitelist macht keinen Sinn.
    if (capEditFields && editableFields.length === 0) {
      toast({ title: t("pages.contracts.extCollabEditFieldsRequired"), variant: "destructive" });
      return;
    }
    const ipAllowlist = ipAllowlistText
      .split(/[\s,;\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
    // Build absolute magic-link base URL relative to current origin + BASE_URL.
    // The server appends "/external/<token>" so the email and the success
    // dialog show identical URLs even when the web app is mounted under a sub-path.
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const magicLinkBaseUrl = `${window.location.origin}${base}`;
    try {
      const r = await create.mutateAsync({
        id: contractId,
        data: {
          email: email.trim().toLowerCase(),
          name: name.trim() || null,
          organization: organization.trim() || null,
          capabilities: caps as unknown as ExternalCollaborator["capabilities"],
          expiresInDays,
          editableFields: (capEditFields ? editableFields : []) as ExternalCollaboratorCreate["editableFields"],
          ipAllowlist,
          sendEmail,
          magicLinkBaseUrl,
        },
      });
      const url = `${magicLinkBaseUrl}/external/${r.tokenPlaintext ?? ""}`;
      setCreatedToken({ url, email: r.email, emailSent: r.emailSent ?? null });
      setOpen(false);
      reset();
      qc.invalidateQueries({ queryKey: getListExternalCollaboratorsQueryKey(contractId) });
      const sentOk = r.emailSent?.ok === true;
      toast({
        title: t("pages.contracts.extCollabCreated"),
        description: sendEmail
          ? sentOk
            ? t("pages.contracts.extCollabEmailSentToast", { email: r.email })
            : t("pages.contracts.extCollabEmailFailedToast")
          : undefined,
      });
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    }
  }

  async function handleRevoke(id: string, email: string) {
    try {
      await revoke.mutateAsync({ id });
      qc.invalidateQueries({ queryKey: getListExternalCollaboratorsQueryKey(contractId) });
      toast({ title: t("pages.contracts.extCollabRevoked"), description: email });
    } catch (e) {
      toast({ title: String(e), variant: "destructive" });
    }
  }

  function statusBadge(status: ExternalCollaborator["status"]) {
    const cls =
      status === "active" ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
      : status === "expired" ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
      : "bg-muted text-muted-foreground";
    const label =
      status === "active" ? t("pages.contracts.extCollabStatusActive")
      : status === "expired" ? t("pages.contracts.extCollabStatusExpired")
      : t("pages.contracts.extCollabStatusRevoked");
    return <Badge variant="outline" className={`${cls} text-xs`}>{label}</Badge>;
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-2">
          <FileStack className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">{t("pages.contracts.extCollab")}</h2>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} data-testid="ext-collab-add-btn">
          <Plus className="h-4 w-4 mr-2" /> {t("pages.contracts.extCollabAdd")}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("pages.contracts.extCollabHint")}</p>

      {isLoading && <Skeleton className="h-24 w-full" />}
      {!isLoading && (collabs?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground italic">{t("pages.contracts.extCollabNone")}</p>
      )}
      {!isLoading && (collabs?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {collabs!.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-4 border rounded-xl p-3 bg-card"
              data-testid={`ext-collab-row-${c.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{c.email}</span>
                  {statusBadge(c.status)}
                  {(c.capabilities ?? []).map((cap) => (
                    <Badge key={cap} variant="outline" className="text-[10px] uppercase tracking-wide">
                      {cap === "view"
                        ? t("pages.contracts.extCollabCapView")
                        : cap === "comment"
                        ? t("pages.contracts.extCollabCapComment")
                        : cap === "edit_fields"
                        ? t("pages.contracts.extCollabCapEditFields")
                        : t("pages.contracts.extCollabCapSign")}
                    </Badge>
                  ))}
                  {(c.ipAllowlist ?? []).length > 0 && (
                    <Badge
                      variant="outline"
                      className="text-[10px] uppercase tracking-wide bg-blue-500/10 text-blue-600 border-blue-500/30"
                      title={(c.ipAllowlist ?? []).join(", ")}
                    >
                      IP-Lock ({(c.ipAllowlist ?? []).length})
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                  {c.organization && <span>{c.organization}</span>}
                  <span>
                    {t("pages.contracts.extCollabExpires")}: {new Date(c.expiresAt).toLocaleDateString()}
                  </span>
                  <span>
                    {t("pages.contracts.extCollabLastUsed")}:{" "}
                    {c.lastUsedAt
                      ? new Date(c.lastUsedAt).toLocaleString()
                      : t("pages.contracts.extCollabNeverUsed")}
                  </span>
                </div>
              </div>
              {c.status === "active" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleRevoke(c.id, c.email)}
                  data-testid={`ext-collab-revoke-${c.id}`}
                >
                  {t("pages.contracts.extCollabRevoke")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("pages.contracts.extCollabAdd")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("pages.contracts.extCollabEmail")} *</label>
              <input
                type="email"
                className="w-full border rounded px-2 py-1 text-sm bg-background"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="ext-collab-email"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("pages.contracts.extCollabName")}</label>
                <input
                  type="text"
                  className="w-full border rounded px-2 py-1 text-sm bg-background"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t("pages.contracts.extCollabExpiresIn")}</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="w-full border rounded px-2 py-1 text-sm bg-background"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(Math.max(1, Math.min(30, Number(e.target.value) || 14)))}
                  data-testid="ext-collab-expires"
                />
                <p className="text-[11px] text-muted-foreground">{t("pages.contracts.extCollabExpiresHint")}</p>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("pages.contracts.extCollabOrg")}</label>
              <input
                type="text"
                className="w-full border rounded px-2 py-1 text-sm bg-background"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("pages.contracts.extCollabCaps")}</label>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <input type="checkbox" checked={capView} disabled />
                  {t("pages.contracts.extCollabCapView")} (implizit)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={capComment} onChange={(e) => setCapComment(e.target.checked)} />
                  {t("pages.contracts.extCollabCapComment")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={capEditFields}
                    onChange={(e) => setCapEditFields(e.target.checked)}
                    data-testid="ext-collab-cap-editfields"
                  />
                  {t("pages.contracts.extCollabCapEditFields")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={capSign} onChange={(e) => setCapSign(e.target.checked)} />
                  {t("pages.contracts.extCollabCapSign")}
                </label>
              </div>
            </div>
            {capEditFields && (
              <div className="space-y-1 border-l-2 border-amber-500/40 pl-3">
                <label className="text-sm font-medium">{t("pages.contracts.extCollabEditableFields")} *</label>
                <div className="flex flex-col gap-1">
                  {EDITABLE_FIELD_KEYS.map((f) => (
                    <label key={f} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={editableFields.includes(f)}
                        onChange={() => toggleEditableField(f)}
                        data-testid={`ext-collab-editable-${f}`}
                      />
                      {t(`pages.contracts.extCollabField_${f}`)}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("pages.contracts.extCollabIpAllowlist")}</label>
              <textarea
                rows={2}
                placeholder="z.B. 203.0.113.5, 198.51.100.0/24"
                className="w-full border rounded px-2 py-1 text-sm bg-background font-mono"
                value={ipAllowlistText}
                onChange={(e) => setIpAllowlistText(e.target.value)}
                data-testid="ext-collab-ip-allowlist"
              />
              <p className="text-[11px] text-muted-foreground">{t("pages.contracts.extCollabIpAllowlistHint")}</p>
            </div>
            <div className="space-y-1 border-t pt-3">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                  data-testid="ext-collab-send-email"
                />
                {t("pages.contracts.extCollabSendEmail")}
              </label>
              <p className="text-[11px] text-muted-foreground">{t("pages.contracts.extCollabSendEmailHint")}</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                disabled={!email.includes("@") || create.isPending}
                onClick={handleSubmit}
                data-testid="ext-collab-submit"
              >
                {t("pages.contracts.extCollabAdd")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* One-time-token reveal Dialog */}
      <Dialog open={!!createdToken} onOpenChange={(o) => !o && setCreatedToken(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              {t("pages.contracts.extCollabTokenTitle")}
            </DialogTitle>
            <DialogDescription>
              {createdToken?.email}
            </DialogDescription>
          </DialogHeader>
          {createdToken && (
            <div className="space-y-3">
              <p className="text-sm text-amber-700 bg-amber-500/10 border border-amber-500/30 rounded p-3">
                {t("pages.contracts.extCollabTokenWarning")}
              </p>
              <pre
                className="text-xs bg-muted p-3 rounded border overflow-x-auto break-all whitespace-pre-wrap"
                data-testid="ext-collab-token-url"
              >
                {createdToken.url}
              </pre>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(createdToken.url);
                    toast({ title: t("pages.contracts.extCollabTokenCopied") });
                  } catch {
                    /* noop */
                  }
                }}
              >
                {t("pages.contracts.extCollabTokenCopy")}
              </Button>
              {createdToken.emailSent && (
                <div
                  className={
                    "text-xs rounded border p-2 " +
                    (createdToken.emailSent.ok
                      ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700"
                      : "bg-rose-500/10 border-rose-500/30 text-rose-700")
                  }
                  data-testid="ext-collab-email-status"
                >
                  {createdToken.emailSent.ok
                    ? t("pages.contracts.extCollabEmailStatusSent", {
                        provider: createdToken.emailSent.provider,
                      })
                    : t("pages.contracts.extCollabEmailStatusFailed", {
                        error: createdToken.emailSent.error ?? "unknown",
                      })}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// =========================================================================
// External Access Activity Card — Task #108
// Compliance-Sicht pro Vertrag: alle Magic-Link-Reviewer mit deren Events
// (geoeffnet, kommentiert, Felder bearbeitet, Token-Versuche). Filterbar
// pro Reviewer. Deep-Link via URL-Param `?collab=<id>` (vom Audit-Log).
// =========================================================================

function actionIcon(action: ExternalCollaboratorEvent["action"]) {
  switch (action) {
    case "created": return <Plus className="h-3.5 w-3.5" />;
    case "viewed": return <Eye className="h-3.5 w-3.5" />;
    case "commented": return <MessageSquare className="h-3.5 w-3.5" />;
    case "edited_fields": return <PencilIcon className="h-3.5 w-3.5" />;
    case "revoked": return <Ban className="h-3.5 w-3.5" />;
    case "expired_attempt": return <ShieldOff className="h-3.5 w-3.5" />;
    default: return <Activity className="h-3.5 w-3.5" />;
  }
}

function actionToneClass(action: ExternalCollaboratorEvent["action"]) {
  switch (action) {
    case "expired_attempt":
    case "revoked":
      return "bg-rose-500/10 text-rose-600 border-rose-500/30";
    case "edited_fields":
      return "bg-amber-500/10 text-amber-600 border-amber-500/30";
    case "commented":
      return "bg-sky-500/10 text-sky-600 border-sky-500/30";
    case "viewed":
      return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
    case "created":
      return "bg-indigo-500/10 text-indigo-600 border-indigo-500/30";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function ExternalAccessActivityCard({ contractId }: { contractId: string }) {
  const { t, i18n } = useTranslation();
  const { data: collabs, isLoading: collabsLoading } = useListExternalCollaborators(contractId);
  // URL-Deep-Link: ?collab=<id> aus dem Audit-Log → vorselektieren.
  const [location] = useLocation();
  const initialCollab = useMemo(() => {
    if (typeof window === "undefined") return "__all__";
    const sp = new URLSearchParams(window.location.search);
    return sp.get("collab") || "__all__";
  // location is a dependency so the URL parsing re-runs after route changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  const [reviewerFilter, setReviewerFilter] = useState<string>(initialCollab);
  // Wenn der URL-Param wechselt (z.B. user navigiert vom Audit-Log via Link),
  // den Filter re-syncen UND die Karte in den Viewport scrollen.
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (initialCollab === "__all__") return;
    setReviewerFilter(initialCollab);
    // Nach Mount des aktiven Reviewer-Blocks scrollen.
    const tHandle = window.setTimeout(() => {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(tHandle);
  }, [initialCollab]);

  const eventsQuery = useListContractExternalEvents(
    contractId,
    reviewerFilter === "__all__" ? undefined : { collaboratorId: reviewerFilter },
  );
  const events = eventsQuery.data ?? [];
  const isLoading = collabsLoading || eventsQuery.isLoading;

  // Reviewer-Map fuer schnelles Email-Lookup pro Event.
  const reviewerMap = useMemo(() => {
    const m = new Map<string, ExternalCollaborator>();
    for (const c of collabs ?? []) m.set(c.id, c);
    return m;
  }, [collabs]);

  // Events nach Collaborator gruppieren — chronologisch absteigend pro Block.
  const grouped = useMemo(() => {
    const byCollab = new Map<string, ExternalCollaboratorEvent[]>();
    for (const e of events) {
      const arr = byCollab.get(e.collaboratorId) ?? [];
      arr.push(e);
      byCollab.set(e.collaboratorId, arr);
    }
    // Innerhalb eines Blocks neueste zuerst.
    for (const arr of byCollab.values()) {
      arr.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    // Sortierung der Bloecke: Reviewer mit juengstem Event zuerst.
    return Array.from(byCollab.entries()).sort(([, a], [, b]) =>
      b[0].createdAt.localeCompare(a[0].createdAt),
    );
  }, [events]);

  function formatPayloadSummary(e: ExternalCollaboratorEvent): string {
    const p = e.payload ?? {};
    switch (e.action) {
      case "created":
        return [
          (p as { capabilities?: unknown }).capabilities
            ? t("pages.contracts.extActivityCaps") + ": " + ((p as { capabilities: string[] }).capabilities ?? []).join(", ")
            : null,
          (p as { ipAllowlistCount?: number }).ipAllowlistCount
            ? "IP-Lock: " + (p as { ipAllowlistCount: number }).ipAllowlistCount
            : null,
        ].filter(Boolean).join(" · ");
      case "edited_fields":
        return t("pages.contracts.extActivityFields") + ": " +
          (((p as { fields?: string[] }).fields ?? []).join(", ") || "—");
      case "commented":
        return t("pages.contracts.extActivityCommentLen", {
          n: (p as { length?: number }).length ?? 0,
        });
      case "expired_attempt":
        return t("pages.contracts.extActivityReason") + ": " +
          ((p as { reason?: string }).reason ?? "—");
      case "revoked":
        return t("pages.contracts.extActivityRevokedBy") + ": " +
          ((p as { revokedBy?: string }).revokedBy ?? "—");
      case "viewed":
        return "";
      default:
        return "";
    }
  }

  return (
    <div ref={cardRef} className="space-y-4 pt-4" data-testid="ext-activity-card">
      <div className="flex items-center justify-between pb-2 border-b">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-semibold">{t("pages.contracts.extActivityTitle")}</h2>
        </div>
        <div className="flex items-center gap-2">
          <FilterIcon className="h-4 w-4 text-muted-foreground" />
          <Select value={reviewerFilter} onValueChange={setReviewerFilter}>
            <SelectTrigger className="h-8 w-[260px]" data-testid="ext-activity-reviewer-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("pages.contracts.extActivityAllReviewers")}</SelectItem>
              {(collabs ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.email}{c.organization ? ` · ${c.organization}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{t("pages.contracts.extActivityHint")}</p>

      {isLoading && <Skeleton className="h-32 w-full" />}
      {!isLoading && (collabs?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground italic">{t("pages.contracts.extCollabNone")}</p>
      )}
      {!isLoading && (collabs?.length ?? 0) > 0 && grouped.length === 0 && (
        <p className="text-sm text-muted-foreground italic">{t("pages.contracts.extActivityNoEvents")}</p>
      )}
      {!isLoading && grouped.length > 0 && (
        <div className="space-y-4">
          {grouped.map(([collabId, evts]) => {
            const c = reviewerMap.get(collabId);
            const isHighlighted = initialCollab !== "__all__" && initialCollab === collabId;
            return (
              <Card
                key={collabId}
                className={isHighlighted ? "ring-2 ring-primary/40" : ""}
                data-testid={`ext-activity-block-${collabId}`}
              >
                <CardHeader className="py-3 px-4 bg-accent/20">
                  <div className="flex flex-wrap items-center gap-3 justify-between">
                    <div className="flex flex-col gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium truncate">{c?.email ?? collabId}</span>
                        {c?.organization && (
                          <span className="text-xs text-muted-foreground">· {c.organization}</span>
                        )}
                        {c && (
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                            {c.status}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {(c?.capabilities ?? []).map((cap) => (
                          <Badge key={cap} variant="outline" className="text-[10px] uppercase">
                            {cap}
                          </Badge>
                        ))}
                        {(c?.ipAllowlist ?? []).length > 0 && (
                          <Badge
                            variant="outline"
                            className="text-[10px] uppercase bg-blue-500/10 text-blue-600 border-blue-500/30"
                            title={(c?.ipAllowlist ?? []).join(", ")}
                          >
                            IP-Lock ({(c?.ipAllowlist ?? []).length})
                          </Badge>
                        )}
                        <span className="font-mono">· {collabId}</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {t("pages.contracts.extActivityEventCount", { n: evts.length })}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="py-3 px-4">
                  <ol className="space-y-2 border-l border-muted-foreground/20 pl-4 ml-1">
                    {evts.map((e) => (
                      <li key={e.id} className="relative" data-testid={`ext-activity-event-${e.id}`}>
                        <span className="absolute -left-[22px] top-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-background border border-muted-foreground/30">
                          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60"></span>
                        </span>
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge variant="outline" className={`${actionToneClass(e.action)} gap-1`}>
                            {actionIcon(e.action)}
                            {t(`pages.contracts.extActivityAction_${e.action}`)}
                          </Badge>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {new Date(e.createdAt).toLocaleString(i18n.resolvedLanguage)}
                          </span>
                          {e.ipAddress && (
                            <span className="text-[11px] font-mono text-muted-foreground">
                              IP {e.ipAddress}
                            </span>
                          )}
                        </div>
                        {formatPayloadSummary(e) && (
                          <div className="text-xs text-muted-foreground mt-0.5 break-words">
                            {formatPayloadSummary(e)}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

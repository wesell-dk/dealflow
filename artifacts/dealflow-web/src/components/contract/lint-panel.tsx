import { useState } from "react";
import {
  useLintContract,
  useLintContractWithAi,
  useApplyContractLintFix,
  getLintContractQueryKey,
  getGetContractQueryKey,
  type ContractLintFinding,
  type ContractLintReport,
  type ContractLintAiEnvelopeAi,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { AlertCircle, AlertTriangle, Info, RefreshCw, Sparkles, ChevronRight, Wrench } from "lucide-react";

const CATEGORY_LABEL: Record<string, string> = {
  cross_reference: "Querverweise",
  definitions: "Definitionen",
  attachments: "Anlagen",
  mandatory_clauses: "Pflichtklauseln",
  forbidden_clauses: "Verbotene Klauseln",
  numeric_consistency: "Zahlen / Fristen",
  semantic: "Semantik (KI)",
};

function severityIcon(sev: string) {
  if (sev === "error") return <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden />;
  if (sev === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" aria-hidden />;
  return <Info className="h-4 w-4 text-blue-500 shrink-0" aria-hidden />;
}

function severityBadge(sev: string, count: number, testid: string) {
  const variant = sev === "error" ? "destructive" : sev === "warn" ? "outline" : "secondary";
  const cls = sev === "warn"
    ? "bg-amber-500/10 text-amber-700 border-amber-500/40 dark:text-amber-400"
    : sev === "info" ? "bg-blue-500/10 text-blue-700 border-blue-500/40 dark:text-blue-400" : "";
  return (
    <Badge variant={variant} className={cls} data-testid={testid}>
      {sev === "error" ? "Fehler" : sev === "warn" ? "Warnung" : "Info"}: {count}
    </Badge>
  );
}

/**
 * Click-to-jump: scrollt zum Klausel-Card mit data-testid `clause-card-${id}`.
 * Wird vom Vertrags-Editor gerendert und ist daher der stabile Anker für
 * deeplinks aus dem Linter heraus.
 */
function jumpToClause(clauseId: string) {
  const el = document.querySelector(`[data-testid="clause-card-${clauseId}"]`);
  if (el && "scrollIntoView" in el) {
    (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLElement).classList.add("ring-2", "ring-primary");
    window.setTimeout(() => (el as HTMLElement).classList.remove("ring-2", "ring-primary"), 1500);
  }
}

interface FindingRowProps {
  finding: ContractLintFinding;
  source: "deterministic" | "ai";
  onApplyFix?: (finding: ContractLintFinding) => void;
  isFixing?: boolean;
}

/**
 * Liefert einen Klick-Label für die `fix.kind`-Werte aus dem Linter-Schema.
 * Nur deterministische Findings haben einen `fix`; KI-Findings sind aktuell
 * read-only und enthalten höchstens einen freitextlichen `suggestion`.
 */
function fixLabel(kind: string): string | null {
  if (kind === "add_mandatory_family") return "Pflichtklausel ergänzen";
  if (kind === "remove_forbidden_family") return "Klausel entfernen";
  return null;
}

function FindingRow({ finding, source, onApplyFix, isFixing }: FindingRowProps) {
  const hasJump = !!finding.contractClauseId;
  const fix = finding.fix;
  const label = fix?.kind ? fixLabel(fix.kind) : null;
  const canApplyFix = source === "deterministic" && !!fix && !!label && !!onApplyFix;
  return (
    <div
      className="flex items-start gap-2 py-2 border-b last:border-b-0"
      data-testid={`lint-finding-${finding.id}`}
    >
      {severityIcon(finding.severity)}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{finding.message}</span>
          {source === "ai" && (
            <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-700 border-violet-500/40">
              KI
            </Badge>
          )}
        </div>
        {finding.snippet && (
          <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">{finding.snippet}</p>
        )}
        {finding.suggestion && (
          <p className="text-xs text-muted-foreground mt-1">→ {finding.suggestion}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {canApplyFix && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => onApplyFix!(finding)}
            disabled={isFixing}
            data-testid={`lint-fix-${finding.id}`}
          >
            <Wrench className="h-3 w-3" />
            {label}
          </Button>
        )}
        {hasJump && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => jumpToClause(finding.contractClauseId!)}
            data-testid={`lint-jump-${finding.id}`}
          >
            Springe zur Klausel <ChevronRight className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}

interface CategoryBlockProps {
  category: string;
  findings: ContractLintFinding[];
  source: "deterministic" | "ai";
  onApplyFix?: (finding: ContractLintFinding) => void;
  fixingFindingId?: string | null;
}

function CategoryBlock({ category, findings, source, onApplyFix, fixingFindingId }: CategoryBlockProps) {
  if (!findings.length) return null;
  return (
    <div className="space-y-1" data-testid={`lint-category-${category}`}>
      <h4 className="text-sm font-semibold text-muted-foreground">
        {CATEGORY_LABEL[category] ?? category}
        <span className="ml-2 text-xs text-muted-foreground">({findings.length})</span>
      </h4>
      <div className="border rounded-md px-3 bg-card">
        {findings.map(f => (
          <FindingRow
            key={`${source}-${f.id}`}
            finding={f}
            source={source}
            onApplyFix={onApplyFix}
            isFixing={fixingFindingId === f.id}
          />
        ))}
      </div>
    </div>
  );
}

interface AiFindingShape {
  category: string;
  severity: "info" | "warn" | "error";
  message: string;
  contractClauseId?: string | null;
  snippet?: string | null;
  suggestion?: string | null;
}

function aiFindingsToLintFindings(items: AiFindingShape[]): ContractLintFinding[] {
  return items.map((f, i) => ({
    id: `ai-${i}-${f.category}`,
    category: f.category as ContractLintFinding["category"],
    severity: f.severity,
    code: "ai_semantic",
    message: f.message,
    contractClauseId: f.contractClauseId ?? undefined,
    snippet: f.snippet ?? undefined,
    suggestion: f.suggestion ?? undefined,
  }));
}

export interface LintPanelProps {
  contractId: string;
}

export function LintPanel({ contractId }: LintPanelProps) {
  const { data, isLoading, refetch, isFetching } = useLintContract(contractId);
  const aiMutation = useLintContractWithAi();
  const fixMutation = useApplyContractLintFix();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [aiResult, setAiResult] = useState<ContractLintAiEnvelopeAi | null>(null);
  const [fixingFindingId, setFixingFindingId] = useState<string | null>(null);

  /**
   * Wendet einen vom Linter vorgeschlagenen Quick-Fix an. Nach Erfolg werden
   * sowohl der Lint-Report als auch der Vertrag neu geladen, damit hinzu-
   * gefügte / entfernte Klauseln im Editor sofort sichtbar werden.
   */
  async function applyFix(finding: ContractLintFinding) {
    if (!finding.fix) return;
    setFixingFindingId(finding.id);
    try {
      const data: { kind: "add_mandatory_family"; familyId: string } | { kind: "remove_forbidden_family"; clauseId: string } =
        finding.fix.kind === "add_mandatory_family" && finding.fix.familyId
          ? { kind: "add_mandatory_family", familyId: finding.fix.familyId }
          : finding.fix.kind === "remove_forbidden_family" && finding.fix.clauseId
            ? { kind: "remove_forbidden_family", clauseId: finding.fix.clauseId }
            : (() => { throw new Error("Fix unvollständig: erforderliche IDs fehlen"); })();
      await fixMutation.mutateAsync({ id: contractId, data });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getLintContractQueryKey(contractId) }),
        queryClient.invalidateQueries({ queryKey: getGetContractQueryKey(contractId) }),
      ]);
      toast({
        title: "Fix angewendet",
        description: finding.fix.kind === "add_mandatory_family"
          ? "Pflichtklausel wurde ergänzt."
          : "Klausel wurde entfernt.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast({ title: "Fix fehlgeschlagen", description: msg, variant: "destructive" });
    } finally {
      setFixingFindingId(null);
    }
  }

  const report = data as ContractLintReport | undefined;
  const findings = report?.findings ?? [];
  const counts = report?.counts ?? { error: 0, warn: 0, info: 0, total: 0 };

  // Gruppe deterministische Findings nach Kategorie für übersichtliche Darstellung.
  const byCategory = new Map<string, ContractLintFinding[]>();
  for (const f of findings) {
    const list = byCategory.get(f.category) ?? [];
    list.push(f);
    byCategory.set(f.category, list);
  }
  const orderedCategories: Array<ContractLintFinding["category"]> = [
    "mandatory_clauses",
    "forbidden_clauses",
    "cross_reference",
    "numeric_consistency",
    "attachments",
    "definitions",
  ];

  const aiFindingsByCategory = new Map<string, ContractLintFinding[]>();
  if (aiResult) {
    for (const f of aiFindingsToLintFindings(aiResult.findings)) {
      const list = aiFindingsByCategory.get(f.category) ?? [];
      list.push(f);
      aiFindingsByCategory.set(f.category, list);
    }
  }

  async function runAi() {
    try {
      const res = await aiMutation.mutateAsync({ id: contractId });
      setAiResult(res.ai);
      toast({
        title: "KI-Konsistenz-Prüfung abgeschlossen",
        description: `${res.ai.findings.length} semantische Befund(e) · Konfidenz ${res.ai.confidenceLevel}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      toast({ title: "KI-Prüfung fehlgeschlagen", description: msg, variant: "destructive" });
    }
  }

  return (
    <Card data-testid="lint-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            Konsistenz & Vollständigkeit
            {counts.error > 0 && severityBadge("error", counts.error, "lint-count-error")}
            {counts.warn > 0 && severityBadge("warn", counts.warn, "lint-count-warn")}
            {counts.info > 0 && severityBadge("info", counts.info, "lint-count-info")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="lint-refresh"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Neu prüfen
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1"
              onClick={runAi}
              disabled={aiMutation.isPending}
              data-testid="lint-ai-run"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {aiMutation.isPending ? "KI prüft…" : "KI-Prüfung starten"}
            </Button>
          </div>
        </div>
        {counts.error > 0 && (
          <p
            className="text-xs text-destructive mt-2 px-3 py-2 rounded border border-destructive/40 bg-destructive/5"
            data-testid="lint-error-banner"
          >
            <strong>Freigabe / Signatur blockiert:</strong> {counts.error} Konsistenz-Fehler verhindern,
            dass eine Approval angefordert werden kann. Tenant-Admins können den Block via Override
            (mit Begründung im Audit-Log) durchbrechen.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground" data-testid="lint-loading">Wird geprüft…</p>
        ) : findings.length === 0 ? (
          <p
            className="text-sm text-muted-foreground py-6 text-center"
            data-testid="lint-empty"
          >
            Keine deterministischen Befunde. Vertrag ist in sich konsistent.
          </p>
        ) : (
          <div className="space-y-3">
            {orderedCategories.map(cat => (
              <CategoryBlock
                key={cat}
                category={cat}
                findings={byCategory.get(cat) ?? []}
                source="deterministic"
                onApplyFix={applyFix}
                fixingFindingId={fixingFindingId}
              />
            ))}
          </div>
        )}

        {aiResult && (
          <div className="border-t pt-4 space-y-3" data-testid="lint-ai-results">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold flex items-center gap-1">
                <Sparkles className="h-4 w-4 text-violet-500" /> Semantische KI-Befunde
              </h3>
              <Badge variant="outline" className="text-xs">
                Konfidenz: {aiResult.confidenceLevel}
              </Badge>
            </div>
            {aiResult.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="lint-ai-empty">
                Die KI hat keine zusätzlichen semantischen Befunde gefunden.
              </p>
            ) : (
              <div className="space-y-3">
                {Array.from(aiFindingsByCategory.keys()).map(cat => (
                  <CategoryBlock
                    key={`ai-${cat}`}
                    category={cat}
                    findings={aiFindingsByCategory.get(cat) ?? []}
                    source="ai"
                  />
                ))}
              </div>
            )}
            {aiResult.notes.length > 0 && (
              <div className="text-xs text-muted-foreground border-l-2 border-muted pl-3">
                <strong className="block mb-1">Hinweise:</strong>
                <ul className="list-disc pl-4 space-y-0.5">
                  {aiResult.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground italic">
              {aiResult.confidenceReason}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

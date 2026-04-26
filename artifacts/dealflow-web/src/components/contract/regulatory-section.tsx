import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListContractRegulatoryAssessments,
  useRunContractRegulatoryCheck,
  useAddContractRegulatoryFramework,
  useRemoveContractRegulatoryFramework,
  getListContractRegulatoryAssessmentsQueryKey,
  type ContractRegulatoryAssessment,
  type RegulatoryFramework,
  type RegulatoryFinding,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ShieldCheck, RefreshCw, Plus, X, CheckCircle2, AlertTriangle,
  XCircle, HelpCircle, Loader2, ExternalLink,
} from "lucide-react";

function statusBadge(status: string) {
  switch (status) {
    case "compliant":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30" variant="outline">
          <CheckCircle2 className="h-3 w-3 mr-1" />Konform
        </Badge>
      );
    case "partial":
      return (
        <Badge className="bg-amber-500/10 text-amber-700 border-amber-500/30" variant="outline">
          <AlertTriangle className="h-3 w-3 mr-1" />Teilweise
        </Badge>
      );
    case "non_compliant":
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />Nicht konform
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <HelpCircle className="h-3 w-3 mr-1" />Nicht bewertet
        </Badge>
      );
  }
}

function findingIcon(status: string) {
  if (status === "met") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "partial") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <XCircle className="h-4 w-4 text-destructive" />;
}

function applicabilityBadge(value: string) {
  switch (value) {
    case "auto_applicable":
      return <Badge variant="outline" className="text-xs">Auto-erkannt</Badge>;
    case "manual_added":
      return <Badge variant="secondary" className="text-xs">Manuell ergänzt</Badge>;
    case "manual_removed":
      return <Badge variant="outline" className="text-xs">Manuell entfernt</Badge>;
    default:
      return null;
  }
}

export function RegulatorySection(props: { contractId: string }) {
  const { contractId } = props;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useListContractRegulatoryAssessments(contractId);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const assessments = data?.assessments ?? [];
  const frameworks = data?.frameworks ?? [];

  const invalidate = () => {
    qc.invalidateQueries({
      queryKey: getListContractRegulatoryAssessmentsQueryKey(contractId),
    });
  };

  const runCheck = useRunContractRegulatoryCheck({
    mutation: {
      onSuccess: (res) => {
        toast({
          title: "Regulatorik geprüft",
          description: `${res.frameworksEvaluated} Regelwerk(e) ausgewertet.`,
        });
        invalidate();
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "KI-Check fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const addMut = useAddContractRegulatoryFramework({
    mutation: {
      onSuccess: () => {
        toast({ title: "Regulatorik hinzugefügt" });
        invalidate();
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Hinzufügen fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const removeMut = useRemoveContractRegulatoryFramework({
    mutation: {
      onSuccess: () => {
        toast({ title: "Regulatorik entfernt" });
        setRemoveId(null);
        invalidate();
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Entfernen fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const fwById = useMemo(
    () => new Map(frameworks.map((f) => [f.id, f])),
    [frameworks],
  );

  // Anwendbar = auto_applicable oder manual_added
  const applicable = assessments.filter(
    (a) => a.applicability === "auto_applicable" || a.applicability === "manual_added",
  );
  const explicitlyRemoved = assessments.filter((a) => a.applicability === "manual_removed");
  const autoNotApplicable = assessments.filter((a) => a.applicability === "auto_not_applicable");

  // Frameworks, die noch nicht für diesen Vertrag bewertet wurden,
  // sind manuell hinzufügbar.
  const assessedIds = new Set(assessments.map((a) => a.frameworkId));
  const addable = frameworks.filter((f) => !assessedIds.has(f.id));
  // Manuelle "removed" können wieder hinzugefügt werden
  for (const a of explicitlyRemoved) {
    if (!addable.some((f) => f.id === a.frameworkId) && fwById.has(a.frameworkId)) {
      addable.push(fwById.get(a.frameworkId)!);
    }
  }

  const overallSummary = useMemo(() => {
    const compliant = applicable.filter((a) => a.overallStatus === "compliant").length;
    const partial = applicable.filter((a) => a.overallStatus === "partial").length;
    const nonCompliant = applicable.filter((a) => a.overallStatus === "non_compliant").length;
    const notEvaluated = applicable.filter((a) => a.overallStatus === "not_evaluated").length;
    return { compliant, partial, nonCompliant, notEvaluated };
  }, [applicable]);

  const targetForRemove = applicable.find((a) => a.frameworkId === removeId) ?? null;
  const removeFwLabel = targetForRemove
    ? fwById.get(targetForRemove.frameworkId)?.code ?? "Unbekannt"
    : "";

  return (
    <Card data-testid="card-regulatory-section">
      <CardHeader className="flex flex-row items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <CardTitle>Regulatorik-Compliance</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Welche EU-/DE-Regulatoriken sind für diesen Vertrag relevant und wie
            gut werden ihre Anforderungen abgedeckt?
          </p>
        </div>
        <div className="flex items-center gap-2">
          {addable.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-add-regulation">
                  <Plus className="h-4 w-4 mr-1" />
                  Regulatorik
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-72">
                {addable.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onSelect={() => addMut.mutate({ contractId, frameworkId: f.id, data: {} })}
                    data-testid={`menu-add-${f.code}`}
                  >
                    <div className="flex items-center gap-2 flex-1">
                      <Badge variant="outline" className="font-mono text-[10px]">{f.shortLabel}</Badge>
                      <span className="text-sm">{f.title}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button
            size="sm"
            onClick={() => runCheck.mutate({ contractId })}
            disabled={runCheck.isPending || frameworks.length === 0}
            data-testid="button-run-regulatory-check"
          >
            {runCheck.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            KI-Check ausführen
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : applicable.length === 0 && assessments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Noch keine Regulatorik-Bewertung. Klicke auf „KI-Check ausführen“,
            um anwendbare Regulatoriken automatisch zu erkennen und prüfen
            zu lassen.
          </p>
        ) : (
          <>
            {applicable.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-center text-xs">
                <div className="rounded-md border p-2 bg-emerald-500/5">
                  <div className="text-2xl font-semibold text-emerald-700">{overallSummary.compliant}</div>
                  <div className="text-muted-foreground">Konform</div>
                </div>
                <div className="rounded-md border p-2 bg-amber-500/5">
                  <div className="text-2xl font-semibold text-amber-700">{overallSummary.partial}</div>
                  <div className="text-muted-foreground">Teilweise</div>
                </div>
                <div className="rounded-md border p-2 bg-destructive/5">
                  <div className="text-2xl font-semibold text-destructive">{overallSummary.nonCompliant}</div>
                  <div className="text-muted-foreground">Nicht konform</div>
                </div>
                <div className="rounded-md border p-2">
                  <div className="text-2xl font-semibold text-muted-foreground">{overallSummary.notEvaluated}</div>
                  <div className="text-muted-foreground">Nicht bewertet</div>
                </div>
              </div>
            )}

            {applicable.length > 0 && (
              <Accordion type="multiple" className="w-full">
                {applicable.map((a) => {
                  const fw = fwById.get(a.frameworkId);
                  if (!fw) return null;
                  return (
                    <AssessmentItem
                      key={a.id}
                      assessment={a}
                      framework={fw}
                      onRemove={() => setRemoveId(a.frameworkId)}
                    />
                  );
                })}
              </Accordion>
            )}

            {(autoNotApplicable.length > 0 || explicitlyRemoved.length > 0) && (
              <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
                <div className="font-medium">Nicht anwendbar / entfernt:</div>
                <div className="flex flex-wrap gap-1">
                  {[...autoNotApplicable, ...explicitlyRemoved].map((a) => {
                    const fw = fwById.get(a.frameworkId);
                    return (
                      <Badge
                        key={a.id}
                        variant="outline"
                        className="text-[10px]"
                        title={a.applicabilityReason ?? ""}
                      >
                        {fw?.shortLabel ?? a.frameworkId}
                        {a.applicability === "manual_removed" ? " ✕" : ""}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>

      <AlertDialog
        open={!!removeId}
        onOpenChange={(open) => { if (!open) setRemoveId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regulatorik entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeFwLabel} wird für diesen Vertrag als nicht anwendbar
              markiert. Du kannst sie später jederzeit wieder hinzufügen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeId) removeMut.mutate({ contractId, frameworkId: removeId });
              }}
              data-testid="button-confirm-remove-regulation"
            >
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function AssessmentItem(props: {
  assessment: ContractRegulatoryAssessment;
  framework: RegulatoryFramework;
  onRemove: () => void;
}) {
  const { assessment, framework, onRemove } = props;
  const reqById = new Map(framework.requirements.map((r) => [r.id, r]));
  const findings = (assessment.findings ?? []) as RegulatoryFinding[];

  return (
    <AccordionItem value={assessment.id}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2 flex-1 text-left">
          <Badge variant="outline" className="font-mono text-xs">
            {framework.shortLabel}
          </Badge>
          <span className="font-medium">{framework.title}</span>
          {applicabilityBadge(assessment.applicability)}
          <span className="ml-auto mr-2">{statusBadge(assessment.overallStatus)}</span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pt-2">
        {assessment.applicabilityReason && (
          <p className="text-xs text-muted-foreground italic">
            {assessment.applicabilityReason}
          </p>
        )}
        {framework.url && (
          <a
            href={framework.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Originalquelle öffnen
          </a>
        )}
        <div className="space-y-2">
          {findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch keine Detail-Auswertung. Bitte „KI-Check ausführen“ starten.
            </p>
          ) : (
            findings.map((f, idx) => {
              const req = reqById.get(f.requirementId);
              if (!req) return null;
              return (
                <div
                  key={`${f.requirementId}-${idx}`}
                  className="border rounded-md p-3 space-y-1"
                  data-testid={`finding-${f.requirementId}`}
                >
                  <div className="flex items-start gap-2">
                    {findingIcon(f.status)}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{req.title}</span>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {req.code}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{req.normRef}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{f.note}</p>
                      {f.snippet && (
                        <blockquote className="text-xs italic border-l-2 pl-2 mt-2 text-muted-foreground">
                          „{f.snippet}"
                        </blockquote>
                      )}
                      {f.suggestion && (
                        <div className="mt-2 text-xs">
                          <span className="font-medium">Vorschlag: </span>
                          <span className="text-muted-foreground">{f.suggestion}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            data-testid={`button-remove-regulation-${framework.code}`}
          >
            <X className="h-3 w-3 mr-1" />
            Aus diesem Vertrag entfernen
          </Button>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

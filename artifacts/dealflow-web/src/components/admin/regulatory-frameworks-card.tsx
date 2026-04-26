import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRegulatoryFrameworks,
  useCreateRegulatoryFramework,
  useUpdateRegulatoryFramework,
  useDeleteRegulatoryFramework,
  useCreateRegulatoryRequirement,
  useUpdateRegulatoryRequirement,
  useDeleteRegulatoryRequirement,
  getListRegulatoryFrameworksQueryKey,
  type RegulatoryFramework,
  type RegulatoryFrameworkInput,
  type RegulatoryApplicabilityRule,
  type RegulatoryRequirement,
  type RegulatoryRequirementInput,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { ShieldCheck, Plus, Pencil, Trash2, Lock, ExternalLink } from "lucide-react";

const APPLICABILITY_KINDS: Array<{ value: string; label: string }> = [
  { value: "data_processing", label: "Datenverarbeitung (AVV/DPA)" },
  { value: "ai_usage", label: "KI-Nutzung" },
  { value: "service_type", label: "Service-Typ" },
  { value: "jurisdiction", label: "Jurisdiktion" },
  { value: "industry", label: "Branche" },
  { value: "size_bracket", label: "Unternehmensgröße" },
  { value: "contract_type", label: "Vertragstyp" },
  { value: "always", label: "Immer anwendbar" },
];

const SEVERITY_OPTIONS: Array<{ value: "must" | "should" | "info"; label: string }> = [
  { value: "must", label: "Pflicht" },
  { value: "should", label: "Empfohlen" },
  { value: "info", label: "Info" },
];

function severityBadge(severity: string) {
  if (severity === "must") return <Badge variant="destructive">Pflicht</Badge>;
  if (severity === "should") return <Badge variant="secondary">Empfohlen</Badge>;
  return <Badge variant="outline">Info</Badge>;
}

export function RegulatoryFrameworksCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useListRegulatoryFrameworks();
  const [editing, setEditing] = useState<RegulatoryFramework | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListRegulatoryFrameworksQueryKey() });
  };

  const deleteMut = useDeleteRegulatoryFramework({
    mutation: {
      onSuccess: () => {
        toast({ title: "Regulatorik gelöscht" });
        setDeleteId(null);
        invalidate();
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const frameworks = useMemo(() => data ?? [], [data]);
  const targetForDelete = frameworks.find((f) => f.id === deleteId) ?? null;

  return (
    <Card data-testid="card-regulatory-frameworks">
      <CardHeader className="flex flex-row items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <CardTitle>Regulatorik-Bibliothek</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            EU-/DE-Regulatorik (DSGVO/AVV, EU AI Act, DSA, NIS2, LkSG …) für
            automatische Compliance-Checks. System-Frameworks sind global
            verfügbar; eigene können tenant-spezifisch ergänzt werden.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setCreating(true)}
          data-testid="button-new-framework"
        >
          <Plus className="h-4 w-4 mr-1" />
          Neue Regulatorik
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : frameworks.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Noch keine Regulatoriken angelegt.
          </p>
        ) : (
          <Accordion type="multiple" className="w-full">
            {frameworks.map((fw) => (
              <AccordionItem key={fw.id} value={fw.id}>
                <AccordionTrigger
                  className="hover:no-underline"
                  data-testid={`row-framework-${fw.id}`}
                >
                  <div className="flex items-center gap-2 flex-1 text-left">
                    <Badge variant="outline" className="font-mono text-xs">
                      {fw.shortLabel}
                    </Badge>
                    <span className="font-medium">{fw.title}</span>
                    {fw.isSystem && (
                      <Badge variant="secondary" className="text-[10px]">
                        <Lock className="h-3 w-3 mr-1" />System
                      </Badge>
                    )}
                    {!fw.active && (
                      <Badge variant="outline" className="text-[10px]">Inaktiv</Badge>
                    )}
                    <span className="ml-auto mr-2 text-xs text-muted-foreground">
                      {fw.requirements.length} Anforderungen
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 pt-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Code: </span>
                      <span className="font-mono">{fw.code}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Jurisdiktion: </span>
                      <span>{fw.jurisdiction}</span>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-muted-foreground">Zusammenfassung: </span>
                      <span>{fw.summary}</span>
                    </div>
                    {fw.url && (
                      <div className="md:col-span-2">
                        <a
                          href={fw.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center text-primary hover:underline text-xs"
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          Quelle öffnen
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing(fw)}
                      disabled={fw.isSystem}
                      title={fw.isSystem ? "System-Framework ist schreibgeschützt" : "Bearbeiten"}
                      data-testid={`button-edit-framework-${fw.id}`}
                    >
                      <Pencil className="h-4 w-4 mr-1" />Bearbeiten
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(fw.id)}
                      disabled={fw.isSystem}
                      title={fw.isSystem ? "System-Framework ist nicht löschbar" : "Löschen"}
                      data-testid={`button-delete-framework-${fw.id}`}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />Löschen
                    </Button>
                  </div>
                  <RequirementsTable framework={fw} onChanged={invalidate} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>

      {(creating || editing) && (
        <FrameworkFormDialog
          framework={editing}
          open={creating || !!editing}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
          onSaved={invalidate}
        />
      )}

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regulatorik löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {targetForDelete ? `${targetForDelete.code} – ${targetForDelete.title}` : ""}
              {" "}wird endgültig entfernt. Bestehende Bewertungen auf Verträgen
              werden ebenfalls gelöscht.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteId) deleteMut.mutate({ id: deleteId }); }}
              data-testid="button-confirm-delete-framework"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function FrameworkFormDialog(props: {
  framework: RegulatoryFramework | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { framework, open, onOpenChange, onSaved } = props;
  const { toast } = useToast();
  const isEdit = !!framework;

  const [code, setCode] = useState(framework?.code ?? "");
  const [title, setTitle] = useState(framework?.title ?? "");
  const [shortLabel, setShortLabel] = useState(framework?.shortLabel ?? "");
  const [jurisdiction, setJurisdiction] = useState(framework?.jurisdiction ?? "EU");
  const [summary, setSummary] = useState(framework?.summary ?? "");
  const [url, setUrl] = useState(framework?.url ?? "");
  const [version, setVersion] = useState(framework?.version ?? "1.0");
  const [active, setActive] = useState(framework?.active ?? true);
  const [sortOrder, setSortOrder] = useState(framework?.sortOrder ?? 100);
  const [rules, setRules] = useState<RegulatoryApplicabilityRule[]>(
    framework?.applicabilityRules ?? [],
  );

  const createMut = useCreateRegulatoryFramework({
    mutation: {
      onSuccess: () => {
        toast({ title: "Regulatorik angelegt" });
        onSaved();
        onOpenChange(false);
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const updateMut = useUpdateRegulatoryFramework({
    mutation: {
      onSuccess: () => {
        toast({ title: "Regulatorik aktualisiert" });
        onSaved();
        onOpenChange(false);
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const submit = () => {
    const data: RegulatoryFrameworkInput = {
      code: code.trim(),
      title: title.trim(),
      shortLabel: shortLabel.trim(),
      jurisdiction: jurisdiction.trim(),
      summary: summary.trim(),
      url: url.trim() ? url.trim() : null,
      version: version.trim(),
      applicabilityRules: rules,
      active,
      sortOrder,
    };
    if (isEdit && framework) {
      updateMut.mutate({ id: framework.id, data });
    } else {
      createMut.mutate({ data });
    }
  };

  const submitting = createMut.isPending || updateMut.isPending;
  const canSubmit =
    code.trim().length >= 2 &&
    title.trim().length >= 2 &&
    shortLabel.trim().length >= 1 &&
    summary.trim().length >= 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Regulatorik bearbeiten" : "Neue Regulatorik"}
          </DialogTitle>
          <DialogDescription>
            Definiere ein Regelwerk und in welchen Verträgen es anwendbar ist.
            Die Heuristik wird nachträglich von der KI verfeinert.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fw-code">Code</Label>
              <Input
                id="fw-code"
                placeholder="DSGVO_AVV"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                data-testid="input-fw-code"
              />
            </div>
            <div>
              <Label htmlFor="fw-shortLabel">Kurzbezeichnung</Label>
              <Input
                id="fw-shortLabel"
                placeholder="DSGVO"
                maxLength={30}
                value={shortLabel}
                onChange={(e) => setShortLabel(e.target.value)}
                data-testid="input-fw-shortLabel"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="fw-title">Titel</Label>
            <Input
              id="fw-title"
              placeholder="Datenschutz-Grundverordnung – Auftragsverarbeitung"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-fw-title"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="fw-jurisdiction">Jurisdiktion</Label>
              <Input
                id="fw-jurisdiction"
                placeholder="EU"
                maxLength={4}
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                data-testid="input-fw-jurisdiction"
              />
            </div>
            <div>
              <Label htmlFor="fw-version">Version</Label>
              <Input
                id="fw-version"
                placeholder="1.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                data-testid="input-fw-version"
              />
            </div>
            <div>
              <Label htmlFor="fw-sort">Sortierung</Label>
              <Input
                id="fw-sort"
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                data-testid="input-fw-sortOrder"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="fw-summary">Zusammenfassung</Label>
            <Textarea
              id="fw-summary"
              rows={3}
              placeholder="Worum geht es? Welche Pflichten ergeben sich daraus für Verträge?"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              data-testid="input-fw-summary"
            />
          </div>
          <div>
            <Label htmlFor="fw-url">URL (optional)</Label>
            <Input
              id="fw-url"
              placeholder="https://eur-lex.europa.eu/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              data-testid="input-fw-url"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="fw-active"
              checked={active}
              onCheckedChange={setActive}
              data-testid="switch-fw-active"
            />
            <Label htmlFor="fw-active">Aktiv (für Verträge sichtbar)</Label>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Anwendbarkeits-Regeln</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRules([...rules, { kind: "always", values: [], note: "" }])}
                data-testid="button-add-rule"
              >
                <Plus className="h-3 w-3 mr-1" />Regel
              </Button>
            </div>
            {rules.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Keine Regeln definiert — nur die KI entscheidet anhand der
                Vertrags-Signale.
              </p>
            )}
            {rules.map((rule, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-start border rounded-md p-2">
                <div className="col-span-4">
                  <Select
                    value={rule.kind}
                    onValueChange={(v) => {
                      const next = [...rules];
                      next[idx] = { ...rule, kind: v as RegulatoryApplicabilityRule["kind"] };
                      setRules(next);
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs" data-testid={`select-rule-kind-${idx}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {APPLICABILITY_KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  className="col-span-7 h-8 text-xs"
                  placeholder="Werte (kommagetrennt) — z.B. DE,EU,AT"
                  value={(rule.values ?? []).join(", ")}
                  onChange={(e) => {
                    const next = [...rules];
                    next[idx] = {
                      ...rule,
                      values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean),
                    };
                    setRules(next);
                  }}
                  data-testid={`input-rule-values-${idx}`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="col-span-1 h-8 w-8 p-0"
                  onClick={() => setRules(rules.filter((_, i) => i !== idx))}
                  data-testid={`button-remove-rule-${idx}`}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit || submitting}
            data-testid="button-submit-framework"
          >
            {submitting ? "Speichere…" : isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RequirementsTable(props: {
  framework: RegulatoryFramework;
  onChanged: () => void;
}) {
  const { framework, onChanged } = props;
  const { toast } = useToast();
  const [editing, setEditing] = useState<RegulatoryRequirement | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteReqId, setDeleteReqId] = useState<string | null>(null);

  const deleteMut = useDeleteRegulatoryRequirement({
    mutation: {
      onSuccess: () => {
        toast({ title: "Anforderung gelöscht" });
        setDeleteReqId(null);
        onChanged();
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const reqs = framework.requirements;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Anforderungen</h4>
        {!framework.isSystem && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreating(true)}
            data-testid={`button-new-requirement-${framework.id}`}
          >
            <Plus className="h-3 w-3 mr-1" />Anforderung
          </Button>
        )}
      </div>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Code</TableHead>
              <TableHead>Titel</TableHead>
              <TableHead className="w-[120px]">Norm</TableHead>
              <TableHead className="w-[100px]">Stufe</TableHead>
              <TableHead className="w-[80px] text-right">Aktion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reqs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground h-12">
                  Noch keine Anforderungen.
                </TableCell>
              </TableRow>
            ) : (
              reqs.map((r) => (
                <TableRow key={r.id} data-testid={`row-requirement-${r.id}`}>
                  <TableCell className="font-mono text-xs">{r.code}</TableCell>
                  <TableCell>
                    <div className="font-medium text-sm">{r.title}</div>
                    <div className="text-xs text-muted-foreground line-clamp-2">
                      {r.description}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.normRef}</TableCell>
                  <TableCell>{severityBadge(r.severity)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(r)}
                        disabled={framework.isSystem}
                        data-testid={`button-edit-requirement-${r.id}`}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteReqId(r.id)}
                        disabled={framework.isSystem}
                        data-testid={`button-delete-requirement-${r.id}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {(creating || editing) && (
        <RequirementFormDialog
          frameworkId={framework.id}
          requirement={editing}
          open={creating || !!editing}
          onOpenChange={(open) => {
            if (!open) {
              setCreating(false);
              setEditing(null);
            }
          }}
          onSaved={onChanged}
        />
      )}

      <AlertDialog
        open={!!deleteReqId}
        onOpenChange={(open) => { if (!open) setDeleteReqId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anforderung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Anforderung wird endgültig entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteReqId) {
                  deleteMut.mutate({ id: framework.id, reqId: deleteReqId });
                }
              }}
              data-testid="button-confirm-delete-requirement"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RequirementFormDialog(props: {
  frameworkId: string;
  requirement: RegulatoryRequirement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { frameworkId, requirement, open, onOpenChange, onSaved } = props;
  const { toast } = useToast();
  const isEdit = !!requirement;

  const [code, setCode] = useState(requirement?.code ?? "");
  const [title, setTitle] = useState(requirement?.title ?? "");
  const [description, setDescription] = useState(requirement?.description ?? "");
  const [normRef, setNormRef] = useState(requirement?.normRef ?? "");
  const [severity, setSeverity] = useState<"must" | "should" | "info">(
    (requirement?.severity as "must" | "should" | "info") ?? "must",
  );
  const [recommendedClauseFamily, setRecommendedClauseFamily] = useState(
    requirement?.recommendedClauseFamily ?? "",
  );
  const [recommendedClauseText, setRecommendedClauseText] = useState(
    requirement?.recommendedClauseText ?? "",
  );

  const createMut = useCreateRegulatoryRequirement({
    mutation: {
      onSuccess: () => {
        toast({ title: "Anforderung angelegt" });
        onSaved();
        onOpenChange(false);
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });
  const updateMut = useUpdateRegulatoryRequirement({
    mutation: {
      onSuccess: () => {
        toast({ title: "Anforderung aktualisiert" });
        onSaved();
        onOpenChange(false);
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const submit = () => {
    const data: RegulatoryRequirementInput = {
      code: code.trim(),
      title: title.trim(),
      description: description.trim(),
      normRef: normRef.trim(),
      severity,
      recommendedClauseFamily: recommendedClauseFamily.trim() || null,
      recommendedClauseText: recommendedClauseText.trim() || null,
    };
    if (isEdit && requirement) {
      updateMut.mutate({ id: frameworkId, reqId: requirement.id, data });
    } else {
      createMut.mutate({ id: frameworkId, data });
    }
  };

  const submitting = createMut.isPending || updateMut.isPending;
  const canSubmit =
    code.trim().length >= 1 &&
    title.trim().length >= 2 &&
    description.trim().length >= 4 &&
    normRef.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Anforderung bearbeiten" : "Neue Anforderung"}
          </DialogTitle>
          <DialogDescription>
            Eine konkrete Pflicht aus diesem Framework, die im Vertrag
            adressiert sein soll.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="req-code">Code</Label>
              <Input
                id="req-code"
                placeholder="AVV-1"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                data-testid="input-req-code"
              />
            </div>
            <div className="col-span-2">
              <Label htmlFor="req-normRef">Norm-Referenz</Label>
              <Input
                id="req-normRef"
                placeholder="DSGVO Art. 28 Abs. 3"
                value={normRef}
                onChange={(e) => setNormRef(e.target.value)}
                data-testid="input-req-normRef"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="req-title">Titel</Label>
            <Input
              id="req-title"
              placeholder="Auftragsverarbeitungsvertrag erforderlich"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-req-title"
            />
          </div>
          <div>
            <Label htmlFor="req-description">Beschreibung</Label>
            <Textarea
              id="req-description"
              rows={3}
              placeholder="Worauf muss der Vertrag eingehen?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="input-req-description"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="req-severity">Stufe</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as "must" | "should" | "info")}>
                <SelectTrigger data-testid="select-req-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="req-clauseFamily">Empfohlene Klausel-Familie</Label>
              <Input
                id="req-clauseFamily"
                placeholder="data_processing"
                value={recommendedClauseFamily}
                onChange={(e) => setRecommendedClauseFamily(e.target.value)}
                data-testid="input-req-clauseFamily"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="req-clauseText">Empfohlener Klausel-Vorschlag (optional)</Label>
            <Textarea
              id="req-clauseText"
              rows={3}
              placeholder="Standardformulierung, die die KI als Vorschlag verwenden kann."
              value={recommendedClauseText}
              onChange={(e) => setRecommendedClauseText(e.target.value)}
              data-testid="input-req-clauseText"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit || submitting}
            data-testid="button-submit-requirement"
          >
            {submitting ? "Speichere…" : isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

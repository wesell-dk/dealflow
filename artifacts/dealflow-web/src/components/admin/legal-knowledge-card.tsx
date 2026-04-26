import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListLegalSources,
  useCreateLegalSource,
  useUpdateLegalSource,
  useDeleteLegalSource,
  useListLegalPrecedents,
  useDeleteLegalPrecedent,
  useBackfillLegalPrecedents,
  getListLegalSourcesQueryKey,
  getListLegalPrecedentsQueryKey,
  type LegalSource,
  type LegalSourceInput,
  type LegalSourceInputAreaOfLaw,
  type LegalSourceInputHierarchy,
  type LegalPrecedent,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { BookOpen, Plus, Pencil, Trash2, RefreshCw, Lock, FileSearch } from "lucide-react";

// Faces gegen die OpenAPI-Enums. Wir bewahren die Reihenfolge, damit das
// Dropdown immer dieselbe Sortierung zeigt — Tenants sollen das bekannteste
// Rechtsgebiet (Vertragsrecht) zuoberst finden.
const AREAS: Array<{ value: LegalSourceInputAreaOfLaw; label: string }> = [
  { value: "contract", label: "Vertragsrecht" },
  { value: "data_protection", label: "Datenschutz" },
  { value: "competition", label: "Wettbewerb" },
  { value: "commercial", label: "Handelsrecht" },
  { value: "it", label: "IT-Recht" },
  { value: "labor", label: "Arbeitsrecht" },
  { value: "tax", label: "Steuern" },
  { value: "other", label: "Sonstiges" },
];

const HIERARCHIES: Array<{ value: LegalSourceInputHierarchy; label: string }> = [
  { value: "statute", label: "Gesetz" },
  { value: "regulation", label: "Verordnung" },
  { value: "judgment", label: "Urteil" },
  { value: "guideline", label: "Leitlinie" },
  { value: "standard", label: "Standard" },
];

const OUTCOME_LABELS: Record<string, string> = {
  standard: "Standard",
  softened: "Abgeschwächt",
  hardened: "Verschärft",
  custom: "Individuell",
};

function areaLabel(value: string): string {
  return AREAS.find((a) => a.value === value)?.label ?? value;
}
function hierarchyLabel(value: string): string {
  return HIERARCHIES.find((h) => h.value === value)?.label ?? value;
}

// ───────────────────────────────────────────────────────────────────────────
// Hauptkomponente — zwei Reiter „Rechtsquellen“ und „Präzedenzfälle“.
// Wird in admin.tsx als Karte eingebunden.
// ───────────────────────────────────────────────────────────────────────────
export function LegalKnowledgeCard() {
  return (
    <Card data-testid="card-legal-knowledge">
      <CardHeader className="flex flex-row items-center gap-2">
        <BookOpen className="h-5 w-5 text-primary" />
        <div>
          <CardTitle>Wissensbasis</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Externe Rechtsquellen und interne Vertragspräzedenzfälle. Beide werden
            von der KI bei Risiko-Empfehlungen mit Quellenangabe zitiert.
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="sources" className="w-full">
          <TabsList>
            <TabsTrigger value="sources" data-testid="tab-legal-sources">
              Rechtsquellen
            </TabsTrigger>
            <TabsTrigger value="precedents" data-testid="tab-legal-precedents">
              Präzedenzfälle
            </TabsTrigger>
          </TabsList>
          <TabsContent value="sources" className="mt-4">
            <SourcesTab />
          </TabsContent>
          <TabsContent value="precedents" className="mt-4">
            <PrecedentsTab />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Rechtsquellen-Tab
// ───────────────────────────────────────────────────────────────────────────
function SourcesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [areaFilter, setAreaFilter] = useState<string>("all");
  const [editing, setEditing] = useState<LegalSource | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const params = areaFilter !== "all" ? { areaOfLaw: areaFilter } : undefined;
  const { data: sources, isLoading } = useListLegalSources(params);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListLegalSourcesQueryKey() });
  };

  const deleteMut = useDeleteLegalSource({
    mutation: {
      onSuccess: () => {
        toast({ title: "Quelle gelöscht" });
        setDeleteId(null);
        invalidate();
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const rows = useMemo(() => sources ?? [], [sources]);
  const targetForDelete = rows.find((r) => r.id === deleteId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Rechtsgebiet</Label>
          <Select value={areaFilter} onValueChange={setAreaFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-area-filter">
              <SelectValue placeholder="Alle" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              {AREAS.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto">
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            data-testid="button-new-source"
          >
            <Plus className="h-4 w-4 mr-1" />
            Neue Quelle
          </Button>
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>Norm</TableHead>
              <TableHead>Titel</TableHead>
              <TableHead>Gebiet</TableHead>
              <TableHead>Rang</TableHead>
              <TableHead className="text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-16 w-full" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-16 text-muted-foreground">
                  Keine Rechtsquellen gefunden.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} data-testid={`row-legal-source-${row.id}`}>
                  <TableCell>
                    {row.isSystem ? (
                      <Badge variant="secondary" className="text-[10px]">
                        <Lock className="h-3 w-3 mr-1" />System
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-medium">{row.normRef}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="line-clamp-2">{row.title}</div>
                  </TableCell>
                  <TableCell>{areaLabel(row.areaOfLaw)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {hierarchyLabel(row.hierarchy)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(row)}
                        disabled={row.isSystem}
                        title={row.isSystem ? "System-Quelle ist nicht editierbar" : "Bearbeiten"}
                        data-testid={`button-edit-source-${row.id}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteId(row.id)}
                        disabled={row.isSystem}
                        title={row.isSystem ? "System-Quelle ist nicht löschbar" : "Löschen"}
                        data-testid={`button-delete-source-${row.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
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
        <SourceFormDialog
          source={editing}
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
            <AlertDialogTitle>Rechtsquelle löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {targetForDelete ? `${targetForDelete.normRef} – ${targetForDelete.title}` : ""}
              {" "}wird endgültig entfernt und aus zukünftigen KI-Zitationen ausgeschlossen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) deleteMut.mutate({ id: deleteId });
              }}
              data-testid="button-confirm-delete-source"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SourceFormDialog(props: {
  source: LegalSource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { source, open, onOpenChange, onSaved } = props;
  const { toast } = useToast();
  const isEdit = !!source;

  const [normRef, setNormRef] = useState(source?.normRef ?? "");
  const [title, setTitle] = useState(source?.title ?? "");
  const [jurisdiction, setJurisdiction] = useState(source?.jurisdiction ?? "DE");
  const [areaOfLaw, setAreaOfLaw] = useState<LegalSourceInputAreaOfLaw>(
    (source?.areaOfLaw as LegalSourceInputAreaOfLaw) ?? "contract",
  );
  const [hierarchy, setHierarchy] = useState<LegalSourceInputHierarchy>(
    (source?.hierarchy as LegalSourceInputHierarchy) ?? "statute",
  );
  const [summary, setSummary] = useState(source?.summary ?? "");
  const [fullText, setFullText] = useState(source?.fullText ?? "");
  const [keywords, setKeywords] = useState((source?.keywords ?? []).join(", "));
  const [url, setUrl] = useState(source?.url ?? "");

  const createMut = useCreateLegalSource({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rechtsquelle angelegt" });
        onSaved();
        onOpenChange(false);
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Speichern fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const updateMut = useUpdateLegalSource({
    mutation: {
      onSuccess: () => {
        toast({ title: "Rechtsquelle aktualisiert" });
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
    const data: LegalSourceInput = {
      normRef: normRef.trim(),
      title: title.trim(),
      jurisdiction: jurisdiction.trim() || undefined,
      areaOfLaw,
      hierarchy,
      summary: summary.trim(),
      fullText: fullText.trim(),
      keywords: keywords
        .split(",")
        .map((k) => k.trim())
        .filter((k) => k.length > 0),
      url: url.trim() ? url.trim() : null,
    };
    if (isEdit && source) {
      updateMut.mutate({ id: source.id, data });
    } else {
      createMut.mutate({ data });
    }
  };

  const submitting = createMut.isPending || updateMut.isPending;
  const canSubmit =
    normRef.trim().length >= 2 &&
    title.trim().length >= 2 &&
    summary.trim().length >= 4 &&
    fullText.trim().length >= 4;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Rechtsquelle bearbeiten" : "Neue Rechtsquelle"}
          </DialogTitle>
          <DialogDescription>
            Tenant-spezifische Quelle. System-Quellen können nur dupliziert
            statt direkt geändert werden.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="normRef">Norm-Referenz</Label>
              <Input
                id="normRef"
                placeholder="BGB § 305"
                value={normRef}
                onChange={(e) => setNormRef(e.target.value)}
                data-testid="input-source-normRef"
              />
            </div>
            <div>
              <Label htmlFor="jurisdiction">Jurisdiktion</Label>
              <Input
                id="jurisdiction"
                placeholder="DE"
                maxLength={4}
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value)}
                data-testid="input-source-jurisdiction"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="title">Titel</Label>
            <Input
              id="title"
              placeholder="Allgemeine Geschäftsbedingungen — Einbeziehung"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-source-title"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Rechtsgebiet</Label>
              <Select
                value={areaOfLaw}
                onValueChange={(v) => setAreaOfLaw(v as LegalSourceInputAreaOfLaw)}
              >
                <SelectTrigger data-testid="select-source-area">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AREAS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rang</Label>
              <Select
                value={hierarchy}
                onValueChange={(v) => setHierarchy(v as LegalSourceInputHierarchy)}
              >
                <SelectTrigger data-testid="select-source-hierarchy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HIERARCHIES.map((h) => (
                    <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="summary">Kurzfassung</Label>
            <Textarea
              id="summary"
              rows={2}
              placeholder="Worum geht es in einem Satz?"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              data-testid="input-source-summary"
            />
          </div>
          <div>
            <Label htmlFor="fullText">Volltext</Label>
            <Textarea
              id="fullText"
              rows={5}
              value={fullText}
              onChange={(e) => setFullText(e.target.value)}
              data-testid="input-source-fullText"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="keywords">Stichwörter (Komma-getrennt)</Label>
              <Input
                id="keywords"
                placeholder="agb, einbeziehung, transparenz"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                data-testid="input-source-keywords"
              />
            </div>
            <div>
              <Label htmlFor="url">Quell-URL (optional)</Label>
              <Input
                id="url"
                placeholder="https://www.gesetze-im-internet.de/..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                data-testid="input-source-url"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            onClick={submit}
            disabled={!canSubmit || submitting}
            data-testid="button-save-source"
          >
            {submitting ? "Speichert…" : "Speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Präzedenzfälle-Tab
// ───────────────────────────────────────────────────────────────────────────
function PrecedentsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [familyFilter, setFamilyFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const params = useMemo(() => {
    const p: { family?: string; outcome?: "standard" | "softened" | "hardened" | "custom" } = {};
    if (familyFilter.trim()) p.family = familyFilter.trim();
    if (outcomeFilter !== "all") {
      p.outcome = outcomeFilter as "standard" | "softened" | "hardened" | "custom";
    }
    return Object.keys(p).length ? p : undefined;
  }, [familyFilter, outcomeFilter]);

  const { data: precedents, isLoading } = useListLegalPrecedents(params);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListLegalPrecedentsQueryKey() });
  };

  const deleteMut = useDeleteLegalPrecedent({
    mutation: {
      onSuccess: () => {
        toast({ title: "Präzedenzfall gelöscht" });
        setDeleteId(null);
        invalidate();
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Löschen fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const backfillMut = useBackfillLegalPrecedents({
    mutation: {
      onSuccess: (r) => {
        toast({
          title: "Präzedenzfälle re-indexiert",
          description: `${r.contracts} Verträge, ${r.indexed} Klauseln`,
        });
        invalidate();
      },
      onError: (e: unknown) => {
        const msg = e instanceof Error ? e.message : "Re-Index fehlgeschlagen";
        toast({ title: "Fehler", description: msg, variant: "destructive" });
      },
    },
  });

  const rows = (precedents ?? []) as LegalPrecedent[];
  const targetForDelete = rows.find((r) => r.id === deleteId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Klausel-Familie</Label>
          <Input
            value={familyFilter}
            onChange={(e) => setFamilyFilter(e.target.value)}
            placeholder="z. B. liability_cap"
            className="w-[200px]"
            data-testid="input-precedent-family-filter"
          />
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Verhandlungsausgang</Label>
          <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
            <SelectTrigger className="w-[180px]" data-testid="select-precedent-outcome-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="softened">Abgeschwächt</SelectItem>
              <SelectItem value="hardened">Verschärft</SelectItem>
              <SelectItem value="custom">Individuell</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="outline"
            onClick={() => backfillMut.mutate()}
            disabled={backfillMut.isPending}
            data-testid="button-backfill-precedents"
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${backfillMut.isPending ? "animate-spin" : ""}`} />
            Alle signierten Verträge neu indexieren
          </Button>
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Familie</TableHead>
              <TableHead>Ausgang</TableHead>
              <TableHead>Gegenpartei</TableHead>
              <TableHead>Branche</TableHead>
              <TableHead>Auszug</TableHead>
              <TableHead>Unterzeichnet</TableHead>
              <TableHead className="text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-16 w-full" />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center h-16 text-muted-foreground">
                  <FileSearch className="h-4 w-4 inline mr-1" />
                  Noch keine Präzedenzfälle. Sie werden beim Signieren automatisch
                  erzeugt — oder über „Neu indexieren“.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} data-testid={`row-legal-precedent-${row.id}`}>
                  <TableCell className="font-medium">{row.family}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {OUTCOME_LABELS[row.negotiationOutcome] ?? row.negotiationOutcome}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.counterpartyName ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.industry ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-md">
                    <div className="line-clamp-2">{row.snippet}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {row.signedAt ? new Date(row.signedAt).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(row.id)}
                      data-testid={`button-delete-precedent-${row.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Präzedenzfall löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              {targetForDelete
                ? `Familie ${targetForDelete.family} (Ausgang ${OUTCOME_LABELS[targetForDelete.negotiationOutcome] ?? targetForDelete.negotiationOutcome})`
                : ""}
              {" "}wird aus den KI-Empfehlungen entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) deleteMut.mutate({ id: deleteId });
              }}
              data-testid="button-confirm-delete-precedent"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

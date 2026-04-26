import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListApprovalChains,
  useCreateApprovalChain,
  useUpdateApprovalChain,
  useDeleteApprovalChain,
  getListApprovalChainsQueryKey,
  useListUsers,
  useListRoles,
  type ApprovalChainTemplate,
  type ApprovalChainCondition,
  type ApprovalStage,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  GitBranch, Plus, Trash2, ArrowUp, ArrowDown, ChevronDown, ChevronRight,
  Percent, FileEdit, AlertTriangle, Sparkles,
} from "lucide-react";

// ─── Trigger / Felder / Operatoren (identisch zum Backend-Resolver) ────────
const TRIGGER_TYPES = [
  { value: "clause_change", label: "Klausel-Änderung", sentence: "eine Klausel geändert wird" },
  { value: "amendment", label: "Vertragsänderung", sentence: "es einen Vertrags-Nachtrag gibt" },
  { value: "discount", label: "Rabatt", sentence: "ein Rabatt gewährt wird" },
  { value: "manual", label: "Manuell", sentence: "die Kette manuell ausgelöst wird" },
] as const;

type ConditionFieldDef = {
  key: string;
  label: string;
  type: "number" | "string";
  hint?: string;
  /** Subjektform für Klartext-Sätze, z.B. "der Rabatt", "die Preisänderung". */
  subject: string;
  /** Einheit hinter dem Wert, z.B. "%" / "€" / "Punkte". */
  unit?: string;
};

const CONDITION_FIELDS: Record<string, ConditionFieldDef[]> = {
  clause_change: [
    { key: "deltaScore", label: "Δ Risiko-Score (Punkte)", type: "number", subject: "der Δ Risiko-Score", unit: "Punkte", hint: "Differenz neu − alt. Höher = riskanter." },
    { key: "riskScore", label: "Risiko-Score (neu)", type: "number", subject: "der neue Risiko-Score", unit: "Punkte" },
    { key: "softer", label: "Lockerer Wechsel? (1=ja, 0=nein)", type: "number", subject: "die Klausel-Lockerung", unit: "(1=ja, 0=nein)" },
    { key: "brandId", label: "Brand-ID", type: "string", subject: "die Brand-ID" },
  ],
  discount: [
    { key: "discountPct", label: "Rabatt %", type: "number", subject: "der Rabatt", unit: "%" },
    { key: "dealValue", label: "Deal-Wert (EUR)", type: "number", subject: "der Deal-Wert", unit: "€" },
    { key: "brandId", label: "Brand-ID", type: "string", subject: "die Brand-ID" },
  ],
  amendment: [
    { key: "priceDelta", label: "Preis-Δ (EUR)", type: "number", subject: "die Preisänderung", unit: "€" },
    { key: "dealValue", label: "Deal-Wert (EUR)", type: "number", subject: "der Deal-Wert", unit: "€" },
  ],
  manual: [
    { key: "dealValue", label: "Deal-Wert (EUR)", type: "number", subject: "der Deal-Wert", unit: "€" },
    { key: "brandId", label: "Brand-ID", type: "string", subject: "die Brand-ID" },
  ],
};

const OPERATORS_NUM = [
  { value: "gte", label: "≥ (mindestens)", sentence: "mindestens" },
  { value: "gt", label: "> (größer als)", sentence: "größer als" },
  { value: "lte", label: "≤ (höchstens)", sentence: "höchstens" },
  { value: "lt", label: "< (kleiner als)", sentence: "kleiner als" },
  { value: "eq", label: "= (gleich)", sentence: "gleich" },
] as const;
const OPERATORS_STR = [{ value: "eq", label: "= (gleich)", sentence: "gleich" }] as const;

function findFieldDef(triggerType: string, key: string): ConditionFieldDef | undefined {
  return CONDITION_FIELDS[triggerType]?.find(f => f.key === key);
}
function opSentence(op: ApprovalChainCondition["op"], type: "number" | "string"): string {
  const list: ReadonlyArray<{ value: string; sentence: string }> = type === "string" ? OPERATORS_STR : OPERATORS_NUM;
  return list.find(o => o.value === op)?.sentence ?? op;
}

// ─── Vorlagen ─────────────────────────────────────────────────────────────
type Template = {
  id: string;
  title: string;
  description: string;
  icon: typeof Percent;
  preset?: {
    name: string;
    triggerType: string;
    condition: ApprovalChainCondition;
  };
};

const TEMPLATES: Template[] = [
  {
    id: "discount-pct",
    title: "Rabatt über X % muss freigegeben werden",
    description: "Greift, sobald ein Rabatt einen Schwellwert überschreitet. Du legst nur den Prozentsatz und die Freigeber:innen fest.",
    icon: Percent,
    preset: {
      name: "Rabatt-Freigabe",
      triggerType: "discount",
      condition: { field: "discountPct", op: "gte", value: 10 },
    },
  },
  {
    id: "amendment-price",
    title: "Vertragsänderung mit Preiserhöhung über X €",
    description: "Greift bei Nachträgen mit Preiserhöhung über einem Schwellwert. Du legst den Euro-Betrag und die Freigeber:innen fest.",
    icon: FileEdit,
    preset: {
      name: "Vertragsänderung — Preiserhöhung",
      triggerType: "amendment",
      condition: { field: "priceDelta", op: "gte", value: 5000 },
    },
  },
  {
    id: "risky-clause",
    title: "Risikoreiche Klausel-Änderung",
    description: "Greift, wenn eine Klausel den Risiko-Score deutlich erhöht. Du legst nur die Schwelle und die Freigeber:innen fest.",
    icon: AlertTriangle,
    preset: {
      name: "Risikoreiche Klausel-Änderung",
      triggerType: "clause_change",
      condition: { field: "deltaScore", op: "gte", value: 10 },
    },
  },
  {
    id: "custom",
    title: "Eigene Kette von Grund auf",
    description: "Volle Kontrolle: Trigger, Bedingungen und Freigabe-Stufen frei wählen.",
    icon: Sparkles,
  },
];

// ─── Drafts ───────────────────────────────────────────────────────────────
type ConditionDraft = {
  field: string;
  op: ApprovalChainCondition["op"];
  value: string;
  valueType: "number" | "string";
};

function conditionToDraft(c: ApprovalChainCondition, triggerType: string): ConditionDraft {
  const known = findFieldDef(triggerType, c.field);
  const valueType: "number" | "string" =
    known?.type ?? (typeof c.value === "number" ? "number" : "string");
  return { field: c.field, op: c.op, value: String(c.value), valueType };
}

function draftToCondition(d: ConditionDraft): ApprovalChainCondition | { error: string } {
  if (!d.field) return { error: "Bitte alle Bedingungs-Felder wählen." };
  if (d.value.trim() === "") return { error: `Wert für "${d.field}" fehlt.` };
  if (d.valueType === "number") {
    const n = Number(d.value);
    if (!Number.isFinite(n)) return { error: `"${d.value}" ist keine gültige Zahl für "${d.field}".` };
    return { field: d.field, op: d.op, value: n };
  }
  return { field: d.field, op: d.op, value: d.value };
}

type StageDraft = {
  order: number;
  label: string;
  approverRole: string;
  approverUserId: string;
};

const emptyStage = (order: number): StageDraft => ({
  order, label: `Stufe ${order}`, approverRole: "", approverUserId: "",
});

// Approver-Picker kodiert Rolle/User in einen einzigen Select-Wert.
function encodeApprover(s: { approverRole: string; approverUserId: string }): string {
  if (s.approverUserId) return `user:${s.approverUserId}`;
  if (s.approverRole) return `role:${s.approverRole}`;
  return "";
}
function decodeApprover(v: string): { approverRole: string; approverUserId: string } {
  if (v.startsWith("user:")) return { approverRole: "", approverUserId: v.slice(5) };
  if (v.startsWith("role:")) return { approverRole: v.slice(5), approverUserId: "" };
  return { approverRole: "", approverUserId: "" };
}

// ─── Component ────────────────────────────────────────────────────────────
export function ApprovalChainsCard() {
  const { data: chains, isLoading } = useListApprovalChains();
  const { data: users } = useListUsers();
  const { data: roles } = useListRoles();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateApprovalChain();
  const update = useUpdateApprovalChain();
  const del = useDeleteApprovalChain();

  // Dialog-State
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"templates" | "form">("templates");
  const [editing, setEditing] = useState<ApprovalChainTemplate | null>(null);

  // Form-State
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<string>("clause_change");
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [priority, setPriority] = useState<number>(100);
  const [active, setActive] = useState(true);
  const [stages, setStages] = useState<StageDraft[]>([emptyStage(1)]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  // Sammlung aller Rollen-Namen, die irgendwo schon verwendet wurden — auch
  // historische, damit der Edit-Dialog Legacy-Werte nicht stillschweigend
  // verschluckt.
  const allRoleNames = useMemo(() => {
    const set = new Set<string>();
    (roles ?? []).forEach(r => set.add(r.name));
    (chains ?? []).forEach(c => c.stages.forEach(s => { if (s.approverRole) set.add(s.approverRole); }));
    return Array.from(set).sort();
  }, [roles, chains]);

  const knownRoleNames = useMemo(() => new Set((roles ?? []).map(r => r.name)), [roles]);

  const fieldDefs = CONDITION_FIELDS[triggerType] ?? [];

  // ─── Dialog-Handling ────────────────────────────────────────────────────
  const reset = () => {
    setEditing(null); setName(""); setDescription("");
    setTriggerType("clause_change"); setConditions([]); setPriority(100);
    setActive(true); setStages([emptyStage(1)]);
    setAdvancedOpen(false); setTouched(false);
    setView("templates");
  };

  const openCreate = () => { reset(); setOpen(true); };

  const openEdit = (c: ApprovalChainTemplate) => {
    setEditing(c);
    setName(c.name); setDescription(c.description ?? "");
    setTriggerType(c.triggerType);
    setConditions((c.conditions ?? []).map(cd => conditionToDraft(cd, c.triggerType)));
    setPriority(c.priority); setActive(c.active);
    setStages(c.stages.map((s, i) => ({
      order: s.order ?? i + 1,
      label: s.label,
      approverRole: s.approverRole ?? "",
      approverUserId: s.approverUserId ?? "",
    })));
    // Beim Bearbeiten: keinen Vorlagen-Schritt, direkt ins Formular. Wenn die
    // bestehende Kette Legacy-Felder oder eine Nicht-Default-Priorität hat,
    // klappen wir die erweiterten Optionen direkt auf, damit der User sieht,
    // was bereits gesetzt ist.
    const hasUnknownConditions = (c.conditions ?? []).some(cd => !findFieldDef(c.triggerType, cd.field));
    const hasCustomLabels = c.stages.some((s, i) => (s.label ?? "").trim() !== `Stufe ${i + 1}`);
    setAdvancedOpen(c.priority !== 100 || !!c.description || hasUnknownConditions || hasCustomLabels);
    setTouched(true);
    setView("form");
    setOpen(true);
  };

  const applyTemplate = (tpl: Template) => {
    if (tpl.preset) {
      setName(tpl.preset.name);
      setDescription("");
      setTriggerType(tpl.preset.triggerType);
      setConditions([conditionToDraft(tpl.preset.condition, tpl.preset.triggerType)]);
    } else {
      // "Eigene Kette" — leeres Formular, Default-Trigger Klausel-Änderung.
      setName(""); setDescription("");
      setTriggerType("clause_change");
      setConditions([]);
    }
    setPriority(100); setActive(true);
    setStages([emptyStage(1)]);
    setAdvancedOpen(false); setTouched(false);
    setView("form");
  };

  const refresh = () => qc.invalidateQueries({ queryKey: getListApprovalChainsQueryKey() });

  // ─── Validierung (für Inline-Hinweise + Save-Button) ────────────────────
  const buildPayload = (): { ok: true; conditions: ApprovalChainCondition[]; stages: ApprovalStage[] } | { ok: false; error: string } => {
    if (!name.trim()) return { ok: false, error: "Bitte gib der Kette einen Namen." };
    if (stages.length === 0) return { ok: false, error: "Mindestens eine Stufe ist erforderlich." };

    const builtConds: ApprovalChainCondition[] = [];
    for (const d of conditions) {
      const r = draftToCondition(d);
      if ("error" in r) return { ok: false, error: r.error };
      builtConds.push(r);
    }

    const stagesPayload: ApprovalStage[] = [];
    for (let i = 0; i < stages.length; i++) {
      const s = stages[i]!;
      if (!s.approverRole && !s.approverUserId) {
        return { ok: false, error: `Stufe ${i + 1} braucht eine Freigeber:in (Rolle oder Person).` };
      }
      stagesPayload.push({
        order: i + 1,
        label: s.label.trim() || `Stufe ${i + 1}`,
        approverRole: s.approverRole || null,
        approverUserId: s.approverUserId || null,
        status: "pending",
        decidedBy: null,
        decidedAt: null,
        delegatedFrom: null,
        delegatedFromName: null,
        decidedByName: null,
        comment: null,
      });
    }
    return { ok: true, conditions: builtConds, stages: stagesPayload };
  };

  const validation = buildPayload();
  const canSave = validation.ok;
  const saveBlockerReason = validation.ok ? "" : validation.error;

  const onSave = async () => {
    setTouched(true);
    if (!validation.ok) {
      toast({ title: "Bitte ergänze noch", description: validation.error, variant: "destructive" });
      return;
    }
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          data: {
            name, description: description || null, triggerType,
            conditions: validation.conditions, priority, active, stages: validation.stages,
          },
        });
        toast({ title: "Genehmigungs-Kette aktualisiert" });
      } else {
        await create.mutateAsync({
          data: {
            name: name.trim(), description: description || undefined, triggerType,
            conditions: validation.conditions, priority, active, stages: validation.stages,
          },
        });
        toast({ title: "Genehmigungs-Kette angelegt" });
      }
      await refresh();
      setOpen(false); reset();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Speichern fehlgeschlagen", description: message, variant: "destructive" });
    }
  };

  const onDelete = async (c: ApprovalChainTemplate) => {
    try {
      await del.mutateAsync({ id: c.id });
      await refresh();
      toast({ title: "Kette gelöscht" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Löschen fehlgeschlagen", description: message, variant: "destructive" });
    }
  };

  // ─── Stage-Helpers ──────────────────────────────────────────────────────
  const updateStage = (idx: number, patch: Partial<StageDraft>) => {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };
  const moveStage = (idx: number, dir: -1 | 1) => {
    setStages(prev => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next.map((s, i) => ({ ...s, order: i + 1 }));
    });
  };
  const removeStage = (idx: number) => {
    setStages(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  };
  const addStage = () => setStages(prev => [...prev, emptyStage(prev.length + 1)]);

  // ─── Condition-Helpers ──────────────────────────────────────────────────
  const addKnownCondition = () => {
    const f = fieldDefs[0];
    if (!f) return;
    setConditions(prev => [...prev, {
      field: f.key,
      op: f.type === "string" ? "eq" : "gte",
      value: "",
      valueType: f.type,
    }]);
  };
  const addAdvancedCondition = () => {
    setConditions(prev => [...prev, { field: "", op: "eq", value: "", valueType: "string" }]);
  };
  const removeCondition = (idx: number) => {
    setConditions(prev => prev.filter((_, i) => i !== idx));
  };
  const updateCondition = (idx: number, patch: Partial<ConditionDraft>) => {
    setConditions(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };
  const onTriggerChange = (next: string) => {
    setTriggerType(next);
    // Beim Trigger-Wechsel Bedingungen mit unbekannten Feldern verwerfen,
    // damit der User keinen Eintrag sieht, der zum neuen Trigger nicht passt.
    const knownKeys = new Set((CONDITION_FIELDS[next] ?? []).map(f => f.key));
    setConditions(prev => prev.filter(c => knownKeys.has(c.field)));
  };

  // ─── Live-Vorschau-Satz ─────────────────────────────────────────────────
  const previewSentence = useMemo(() => {
    const trig = TRIGGER_TYPES.find(t => t.value === triggerType)?.sentence ?? triggerType;
    const condSentences: string[] = [];
    for (const c of conditions) {
      const def = findFieldDef(triggerType, c.field);
      const subject = def?.subject ?? c.field;
      const valueText = c.value.trim() === "" ? "…" : c.value;
      const unit = def?.unit ? ` ${def.unit}` : "";
      const op = opSentence(c.op, def?.type ?? c.valueType);
      condSentences.push(`${subject} ${op} ${valueText}${unit}`);
    }
    const ifPart = condSentences.length === 0
      ? `Wenn ${trig}`
      : `Wenn ${trig} und ${condSentences.join(" und ")}`;

    const stageNames = stages.map((s, i) => {
      if (s.approverUserId) {
        const u = (users ?? []).find(x => x.id === s.approverUserId);
        return u?.name ?? `Person #${i + 1}`;
      }
      if (s.approverRole) return s.approverRole;
      return "(noch offen)";
    });
    const thenPart = stageNames.length === 0
      ? "(noch keine Freigeber:innen)"
      : stageNames.join(" → ");
    return `${ifPart}, dann freigeben durch ${thenPart}.`;
  }, [triggerType, conditions, stages, users]);

  // ─── Bedingungen aufteilen: bekannt vs. unbekannt (Legacy) ──────────────
  const conditionsWithIdx = conditions.map((c, i) => ({ c, i }));
  const knownConds = conditionsWithIdx.filter(({ c }) => !!findFieldDef(triggerType, c.field));
  const advancedConds = conditionsWithIdx.filter(({ c }) => !findFieldDef(triggerType, c.field));

  // Erweiterte Optionen automatisch öffnen, wenn unbekannte Bedingungen
  // existieren — sonst hätte der User keine Möglichkeit, sie zu sehen.
  useEffect(() => {
    if (advancedConds.length > 0 && !advancedOpen) setAdvancedOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedConds.length]);

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <Card data-testid="card-approval-chains">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <GitBranch className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <CardTitle>Genehmigungs-Ketten</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Lege fest, wann ein Vorgang freigegeben werden muss und wer ihn freigibt.
              Pro Trigger gewinnt bei mehreren passenden Ketten die mit der niedrigsten
              Prioritäts-Zahl (Default 100). Jede Stufe braucht eine Freigeber:in
              (Rolle oder konkrete Person).
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-new-chain">
          <Plus className="h-4 w-4 mr-1" /> Neue Kette
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (chains?.length ?? 0) === 0 ? (
          <div className="p-6 text-center text-sm border rounded-md bg-muted/10 text-muted-foreground">
            Noch keine Genehmigungs-Ketten konfiguriert. Approvals laufen single-stage durch
            den Anfrage-Empfänger.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Stufen</TableHead>
                <TableHead>Priorität</TableHead>
                <TableHead>Aktiv</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chains!.map(c => (
                <TableRow key={c.id} data-testid={`row-chain-${c.id}`}>
                  <TableCell className="font-medium">
                    {c.name}
                    {c.description && <div className="text-xs text-muted-foreground">{c.description}</div>}
                  </TableCell>
                  <TableCell><Badge variant="outline">{c.triggerType}</Badge></TableCell>
                  <TableCell className="text-xs">
                    {c.stages.map((s, i) => (
                      <span key={i} className="inline-block mr-1">
                        {i + 1}.&nbsp;{s.label}
                        <span className="text-muted-foreground"> ({s.approverRole || s.approverUserId})</span>
                        {i < c.stages.length - 1 && " →"}
                      </span>
                    ))}
                  </TableCell>
                  <TableCell>{c.priority}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={c.active ? "border-emerald-300 text-emerald-700" : "border-slate-300 text-slate-500"}>
                      {c.active ? "ja" : "nein"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => openEdit(c)} data-testid={`button-edit-chain-${c.id}`}>
                        Bearbeiten
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onDelete(c)} data-testid={`button-delete-chain-${c.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-3xl">
          {view === "templates" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Neue Genehmigungs-Kette</AlertDialogTitle>
                <AlertDialogDescription>
                  Wähle eine Vorlage als Startpunkt. Du kannst danach noch Werte und
                  Freigeber:innen anpassen.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid gap-3 py-2 max-h-[65vh] overflow-y-auto">
                {TEMPLATES.map(tpl => {
                  const Icon = tpl.icon;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => applyTemplate(tpl)}
                      className="text-left border rounded-lg p-4 hover:border-primary hover:bg-muted/30 transition-colors flex items-start gap-3"
                      data-testid={`template-card-${tpl.id}`}
                    >
                      <div className="p-2 rounded-md bg-muted">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium">{tpl.title}</div>
                        <div className="text-sm text-muted-foreground mt-0.5">{tpl.description}</div>
                      </div>
                      <ChevronRight className="h-5 w-5 text-muted-foreground mt-1" />
                    </button>
                  );
                })}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          ) : (
            <TooltipProvider delayDuration={150}>
              <AlertDialogHeader>
                <AlertDialogTitle>{editing ? "Kette bearbeiten" : "Neue Genehmigungs-Kette"}</AlertDialogTitle>
                <AlertDialogDescription>
                  Lege fest, wann diese Kette greift und wer der Reihe nach freigibt.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid gap-4 py-2 max-h-[65vh] overflow-y-auto">
                {/* ── Name + aktiv-Schalter ───────────────────────────── */}
                <div>
                  <Label htmlFor="chain-name">Name dieser Kette</Label>
                  <Input
                    id="chain-name"
                    value={name}
                    onChange={e => { setName(e.target.value); setTouched(true); }}
                    onBlur={() => setTouched(true)}
                    aria-invalid={touched && !name.trim()}
                    className={touched && !name.trim() ? "border-destructive" : ""}
                    data-testid="input-chain-name"
                  />
                  {touched && !name.trim() && (
                    <p className="text-xs text-destructive mt-1" data-testid="error-chain-name">
                      Bitte gib der Kette einen Namen.
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    <Switch
                      id="chain-active"
                      checked={active}
                      onCheckedChange={v => setActive(!!v)}
                      data-testid="switch-chain-active"
                    />
                    <Label htmlFor="chain-active" className="cursor-pointer">Diese Kette ist aktiv</Label>
                  </div>
                </div>

                {/* ── Wann greift die Kette ───────────────────────────── */}
                <div className="space-y-2 border-t pt-4">
                  <Label className="text-base">Wann greift diese Kette?</Label>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Trigger:</span>
                    <select
                      className="border rounded h-9 px-2 bg-background"
                      value={triggerType}
                      onChange={e => onTriggerChange(e.target.value)}
                      data-testid="select-chain-trigger"
                    >
                      {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>

                  {knownConds.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">
                      Keine Bedingungen — die Kette greift bei jedem {TRIGGER_TYPES.find(t => t.value === triggerType)?.label}-Ereignis.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {knownConds.map(({ c, i }) => {
                        const def = findFieldDef(triggerType, c.field)!;
                        const ops = def.type === "string" ? OPERATORS_STR : OPERATORS_NUM;
                        const valueMissing = touched && c.value.trim() === "";
                        return (
                          <div
                            key={i}
                            className="flex flex-wrap items-center gap-2 text-sm border rounded p-3 bg-muted/10"
                            data-testid={`condition-row-${i}`}
                          >
                            <span className="text-muted-foreground">… und</span>
                            <select
                              className="border rounded h-9 px-2 bg-background"
                              value={c.field}
                              onChange={e => {
                                const nextDef = findFieldDef(triggerType, e.target.value);
                                updateCondition(i, {
                                  field: e.target.value,
                                  valueType: nextDef?.type ?? "number",
                                  op: nextDef?.type === "string" ? "eq" : c.op,
                                  value: "",
                                });
                              }}
                              data-testid={`select-condition-field-${i}`}
                            >
                              {fieldDefs.map(f => <option key={f.key} value={f.key}>{f.subject}</option>)}
                            </select>
                            <select
                              className="border rounded h-9 px-2 bg-background"
                              value={c.op}
                              onChange={e => updateCondition(i, { op: e.target.value as ApprovalChainCondition["op"] })}
                              data-testid={`select-condition-op-${i}`}
                            >
                              {ops.map(op => <option key={op.value} value={op.value}>{op.sentence}</option>)}
                            </select>
                            <Input
                              type={def.type === "number" ? "number" : "text"}
                              value={c.value}
                              onChange={e => updateCondition(i, { value: e.target.value })}
                              onBlur={() => setTouched(true)}
                              aria-invalid={valueMissing}
                              className={`w-28 ${valueMissing ? "border-destructive" : ""}`}
                              placeholder={def.type === "number" ? "Wert" : "Text"}
                              data-testid={`input-condition-value-${i}`}
                            />
                            {def.unit && <span className="text-muted-foreground">{def.unit}</span>}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto"
                              onClick={() => removeCondition(i)}
                              data-testid={`button-condition-remove-${i}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                            {valueMissing && (
                              <p className="text-xs text-destructive w-full">Bitte einen Wert eintragen.</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={addKnownCondition}
                    disabled={fieldDefs.length === 0}
                    data-testid="button-add-condition"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Bedingung hinzufügen
                  </Button>
                </div>

                {/* ── Wer gibt frei? (Stages) ─────────────────────────── */}
                <div className="space-y-2 border-t pt-4">
                  <Label className="text-base">Wer soll freigeben?</Label>
                  <p className="text-xs text-muted-foreground -mt-1">
                    Die Stufen werden in dieser Reihenfolge der Reihe nach abgefragt.
                  </p>
                  {stages.map((s, i) => {
                    const value = encodeApprover(s);
                    const missing = touched && !value;
                    const legacyRole = s.approverRole && !knownRoleNames.has(s.approverRole);
                    return (
                      <div
                        key={i}
                        className="flex flex-wrap items-center gap-2 border rounded p-3 bg-muted/10"
                        data-testid={`stage-row-${i}`}
                      >
                        <div className="font-mono text-sm font-medium w-6">{i + 1}.</div>
                        <div className="flex-1 min-w-[220px]">
                          <select
                            className={`w-full border rounded h-9 px-2 bg-background ${missing ? "border-destructive" : ""}`}
                            value={value}
                            onChange={e => {
                              const decoded = decodeApprover(e.target.value);
                              updateStage(i, decoded);
                            }}
                            aria-invalid={missing}
                            data-testid={`select-stage-approver-${i}`}
                          >
                            <option value="">— Wer gibt frei? —</option>
                            {legacyRole && (
                              <option value={`role:${s.approverRole}`}>
                                {s.approverRole} (Legacy-Rolle)
                              </option>
                            )}
                            <optgroup label="Rollen">
                              {allRoleNames.map(r => (
                                <option key={`role-${r}`} value={`role:${r}`}>{r}</option>
                              ))}
                            </optgroup>
                            <optgroup label="Personen">
                              {(users ?? []).map(u => (
                                <option key={`user-${u.id}`} value={`user:${u.id}`}>{u.name}</option>
                              ))}
                            </optgroup>
                          </select>
                          {missing && (
                            <p className="text-xs text-destructive mt-1">Bitte eine Freigeber:in wählen.</p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => moveStage(i, -1)} disabled={i === 0} data-testid={`button-stage-up-${i}`}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => moveStage(i, 1)} disabled={i === stages.length - 1} data-testid={`button-stage-down-${i}`}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => removeStage(i)} disabled={stages.length === 1} data-testid={`button-stage-remove-${i}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                  <Button size="sm" variant="outline" onClick={addStage} data-testid="button-add-stage">
                    <Plus className="h-3 w-3 mr-1" /> Stufe hinzufügen
                  </Button>
                </div>

                {/* ── Live-Vorschau ───────────────────────────────────── */}
                <div className="border-t pt-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    Vorschau
                  </div>
                  <div
                    className="rounded-md border bg-muted/20 px-3 py-2 text-sm leading-relaxed"
                    data-testid="chain-preview"
                  >
                    {previewSentence}
                  </div>
                </div>

                {/* ── Erweiterte Optionen ─────────────────────────────── */}
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="border-t pt-2">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                      data-testid="button-toggle-advanced"
                    >
                      <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "" : "-rotate-90"}`} />
                      Erweiterte Optionen
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pt-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="chain-priority">Priorität (niedriger = wichtiger)</Label>
                        <Input
                          id="chain-priority"
                          type="number"
                          value={priority}
                          onChange={e => setPriority(parseInt(e.target.value) || 0)}
                          data-testid="input-chain-priority"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Default 100 reicht in den meisten Fällen.</p>
                      </div>
                      <div>
                        <Label htmlFor="chain-description">Beschreibung (optional)</Label>
                        <Input
                          id="chain-description"
                          value={description}
                          onChange={e => setDescription(e.target.value)}
                          data-testid="input-chain-description"
                        />
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm">Stufen-Bezeichnungen</Label>
                      <p className="text-xs text-muted-foreground">Optional. Default ist „Stufe 1", „Stufe 2", …</p>
                      <div className="space-y-1 mt-1">
                        {stages.map((s, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="font-mono text-xs w-6">{i + 1}.</span>
                            <Input
                              value={s.label}
                              onChange={e => updateStage(i, { label: e.target.value })}
                              data-testid={`input-stage-label-${i}`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <Label className="text-sm">Freier Bedingungs-Builder</Label>
                      <p className="text-xs text-muted-foreground">
                        Für historische / unbekannte Felder, die der Standard-Builder oben nicht kennt.
                      </p>
                      {advancedConds.length === 0 ? (
                        <p className="text-xs text-muted-foreground italic mt-1">Keine erweiterten Bedingungen.</p>
                      ) : (
                        <div className="space-y-2 mt-2">
                          {advancedConds.map(({ c, i }) => (
                            <div key={i} className="grid grid-cols-12 gap-2 items-end border rounded p-2 bg-muted/10" data-testid={`advanced-condition-row-${i}`}>
                              <div className="col-span-4">
                                <Label className="text-xs">Feld (intern)</Label>
                                <Input
                                  value={c.field}
                                  onChange={e => updateCondition(i, { field: e.target.value })}
                                  placeholder="z. B. customField"
                                  data-testid={`input-advanced-field-${i}`}
                                />
                              </div>
                              <div className="col-span-3">
                                <Label className="text-xs">Operator</Label>
                                <select
                                  className="w-full border rounded h-9 px-2 bg-background"
                                  value={c.op}
                                  onChange={e => updateCondition(i, { op: e.target.value as ApprovalChainCondition["op"] })}
                                  data-testid={`select-advanced-op-${i}`}
                                >
                                  {(c.valueType === "string" ? OPERATORS_STR : OPERATORS_NUM).map(op => (
                                    <option key={op.value} value={op.value}>{op.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="col-span-2">
                                <Label className="text-xs">Typ</Label>
                                <select
                                  className="w-full border rounded h-9 px-2 bg-background"
                                  value={c.valueType}
                                  onChange={e => updateCondition(i, {
                                    valueType: e.target.value as "number" | "string",
                                    op: e.target.value === "string" ? "eq" : c.op,
                                  })}
                                  data-testid={`select-advanced-type-${i}`}
                                >
                                  <option value="number">Zahl</option>
                                  <option value="string">Text</option>
                                </select>
                              </div>
                              <div className="col-span-2">
                                <Label className="text-xs">Wert</Label>
                                <Input
                                  type={c.valueType === "number" ? "number" : "text"}
                                  value={c.value}
                                  onChange={e => updateCondition(i, { value: e.target.value })}
                                  data-testid={`input-advanced-value-${i}`}
                                />
                              </div>
                              <div className="col-span-1 flex justify-end">
                                <Button size="sm" variant="ghost" onClick={() => removeCondition(i)} data-testid={`button-advanced-remove-${i}`}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={addAdvancedCondition}
                        data-testid="button-add-advanced-condition"
                      >
                        <Plus className="h-3 w-3 mr-1" /> Erweiterte Bedingung
                      </Button>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              <AlertDialogFooter>
                {!editing && (
                  <Button
                    variant="ghost"
                    onClick={() => setView("templates")}
                    data-testid="button-back-to-templates"
                  >
                    Zurück zu Vorlagen
                  </Button>
                )}
                <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                {canSave ? (
                  <AlertDialogAction onClick={onSave} data-testid="button-save-chain">
                    Speichern
                  </AlertDialogAction>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button
                          disabled
                          aria-disabled
                          data-testid="button-save-chain"
                        >
                          Speichern
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">{saveBlockerReason}</TooltipContent>
                  </Tooltip>
                )}
              </AlertDialogFooter>
            </TooltipProvider>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

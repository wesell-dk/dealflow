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
  { value: "clause_change", label: "Clause change" },
  { value: "amendment", label: "Contract amendment" },
  { value: "discount", label: "Discount" },
  { value: "manual", label: "Manual" },
] as const;

type ConditionFieldDef = {
  key: string;
  label: string;
  type: "number" | "string";
  hint?: string;
  /** Subject form for plain-language sentences, e.g. "the discount". Falls back to label when omitted. */
  subject?: string;
  /** Unit suffix after the value, e.g. "%" / "€" / "points". */
  unit?: string;
};

const CONDITION_FIELDS: Record<string, ConditionFieldDef[]> = {
  clause_change: [
    { key: "deltaScore", label: "Δ Risk score (points)", type: "number", hint: "Difference new − old. Higher = riskier." },
    { key: "riskScore", label: "Risk score (new)", type: "number" },
    { key: "softer", label: "Softer change? (1=yes, 0=no)", type: "number" },
    { key: "brandId", label: "Brand ID", type: "string" },
  ],
  discount: [
    { key: "discountPct", label: "Discount %", type: "number" },
    { key: "dealValue", label: "Deal value (EUR)", type: "number" },
    { key: "brandId", label: "Brand ID", type: "string" },
  ],
  amendment: [
    { key: "priceDelta", label: "Price Δ (EUR)", type: "number" },
    { key: "dealValue", label: "Deal value (EUR)", type: "number" },
  ],
  manual: [
    { key: "dealValue", label: "Deal value (EUR)", type: "number" },
    { key: "brandId", label: "Brand ID", type: "string" },
  ],
};
const OPERATORS_NUM = [
  { value: "gte", label: "≥ (at least)" },
  { value: "gt", label: "> (greater than)" },
  { value: "lte", label: "≤ (at most)" },
  { value: "lt", label: "< (less than)" },
  { value: "eq", label: "= (equals)" },
] as const;
const OPERATORS_STR = [{ value: "eq", label: "= (equals)" }] as const;

function findFieldDef(triggerType: string, key: string): ConditionFieldDef | undefined {
  return CONDITION_FIELDS[triggerType]?.find(f => f.key === key);
}
function opSentence(op: ApprovalChainCondition["op"], type: "number" | "string"): string {
  const list: ReadonlyArray<{ value: string; label: string }> = type === "string" ? OPERATORS_STR : OPERATORS_NUM;
  return list.find(o => o.value === op)?.label ?? op;
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
    title: "Discount above X % requires approval",
    description: "Triggers as soon as a discount exceeds a threshold. You only set the percentage and the approvers.",
    icon: Percent,
    preset: {
      name: "Discount approval",
      triggerType: "discount",
      condition: { field: "discountPct", op: "gte", value: 10 },
    },
  },
  {
    id: "amendment-price",
    title: "Contract amendment with price increase above X €",
    description: "Triggers on amendments with a price increase above a threshold. You only set the euro amount and the approvers.",
    icon: FileEdit,
    preset: {
      name: "Amendment — price increase",
      triggerType: "amendment",
      condition: { field: "priceDelta", op: "gte", value: 5000 },
    },
  },
  {
    id: "risky-clause",
    title: "Risky clause change",
    description: "Triggers when a clause significantly raises the risk score. You only set the threshold and the approvers.",
    icon: AlertTriangle,
    preset: {
      name: "Risky clause change",
      triggerType: "clause_change",
      condition: { field: "deltaScore", op: "gte", value: 10 },
    },
  },
  {
    id: "custom",
    title: "Custom chain from scratch",
    description: "Full control: choose trigger, conditions and approval stages freely.",
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
function draftsToConditions(drafts: ConditionDraft[]): ApprovalChainCondition[] | { error: string } {
  const out: ApprovalChainCondition[] = [];
  for (const d of drafts) {
    if (!d.field) return { error: "Please select all condition fields." };
    if (d.value.trim() === "") return { error: `Value for "${d.field}" is missing.` };
    if (d.valueType === "number") {
      const n = Number(d.value);
      if (!Number.isFinite(n)) return { error: `"${d.value}" is not a valid number for "${d.field}".` };
      out.push({ field: d.field, op: d.op, value: n });
    } else {
      out.push({ field: d.field, op: d.op, value: d.value });
    }
  }
  return out;
}

type StageDraft = {
  order: number;
  label: string;
  approverRole: string;
  approverUserId: string;
};

const emptyStage = (order: number): StageDraft => ({
  order, label: `Stage ${order}`, approverRole: "", approverUserId: "",
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
    const hasCustomLabels = c.stages.some((s, i) => {
      const label = (s.label ?? "").trim();
      return label !== `Stage ${i + 1}` && label !== `Stufe ${i + 1}`;
    });
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

  const onSave = async () => {
    const built = draftsToConditions(conditions);
    if (!Array.isArray(built)) {
      toast({ title: "Invalid conditions", description: built.error, variant: "destructive" });
      return;
    }
    const stagesPayload: ApprovalStage[] = stages.map((s, i) => ({
      order: i + 1,
      label: s.label.trim() || `Stage ${i + 1}`,
      approverRole: s.approverRole || null,
      approverUserId: s.approverUserId || null,
      status: "pending",
      decidedBy: null,
      decidedAt: null,
      delegatedFrom: null,
      delegatedFromName: null,
      decidedByName: null,
      comment: null,
    }));
    if (stagesPayload.length === 0) {
      toast({ title: "At least one stage is required", variant: "destructive" });
      return;
    }
    for (const s of stagesPayload) {
      if (!s.approverRole && !s.approverUserId) {
        toast({ title: `Stage ${s.order} requires a role or a user`, variant: "destructive" });
        return;
      }
    }
    
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          data: {
            name, description: description || null, triggerType,
            conditions: built, priority, active, stages: stagesPayload,
          },
        });
        toast({ title: "Approval chain updated" });
      } else {
        await create.mutateAsync({
          data: {
            name: name.trim(), description: description || undefined, triggerType,
            conditions: built, priority, active, stages: stagesPayload,
          },
        });
        toast({ title: "Approval chain created" });
      }
      await refresh();
      setOpen(false); reset();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Save failed", description: message, variant: "destructive" });
    }
  };

  const onDelete = async (c: ApprovalChainTemplate) => {
    try {
      await del.mutateAsync({ id: c.id });
      await refresh();
      toast({ title: "Chain deleted" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toast({ title: "Delete failed", description: message, variant: "destructive" });
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
    const trig = TRIGGER_TYPES.find(t => t.value === triggerType)?.label ?? triggerType;
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
      ? `When ${trig}`
      : `When ${trig} and ${condSentences.join(" and ")}`;

    const stageNames = stages.map((s, i) => {
      if (s.approverUserId) {
        const u = (users ?? []).find(x => x.id === s.approverUserId);
        return u?.name ?? `Person #${i + 1}`;
      }
      if (s.approverRole) return s.approverRole;
      return "(not set)";
    });
    const thenPart = stageNames.length === 0
      ? "(no approvers yet)"
      : stageNames.join(" → ");
    return `${ifPart}, then approve via ${thenPart}.`;
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
            <CardTitle>Approval chains</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Define multi-stage approval workflows. A trigger (e.g. clause change
              or amendment) is matched against all active templates whenever an approval
              is created; if multiple match, the template with the lowest
              priority number wins (default 100). Each stage requires either a role or
              a specific user as approver.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-new-chain">
          <Plus className="h-4 w-4 mr-1" /> New chain
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (chains?.length ?? 0) === 0 ? (
          <div className="p-6 text-center text-sm border rounded-md bg-muted/10 text-muted-foreground">
            No approval chains configured yet. Approvals run single-stage through
            the request recipient.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Stages</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Action</TableHead>
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
                      {c.active ? "yes" : "no"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => openEdit(c)} data-testid={`button-edit-chain-${c.id}`}>
                        Edit
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
          <AlertDialogHeader>
            <AlertDialogTitle>{editing ? "Edit chain" : "New approval chain"}</AlertDialogTitle>
            <AlertDialogDescription>
              Conditions evaluate values from the trigger context (e.g. <span className="font-medium">Δ risk score</span>{" "}
              for clause changes or <span className="font-medium">discount %</span>). All conditions must be satisfied
              (AND match) for the chain to apply.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2 max-h-[65vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-chain-name" />
              </div>
              <div>
                <Label>Priority (lower = more important, default 100)</Label>
                <Input type="number" value={priority} onChange={e => setPriority(parseInt(e.target.value) || 0)} data-testid="input-chain-priority" />
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} data-testid="input-chain-description" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Trigger</Label>
                <select
                  className="w-full border rounded h-9 px-2 bg-background"
                  value={triggerType}
                  onChange={e => onTriggerChange(e.target.value)}
                  data-testid="select-chain-trigger"
                >
                  {TRIGGER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-6">
                <input id="chain-active" type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} data-testid="checkbox-chain-active" />
                <Label htmlFor="chain-active">Active</Label>
              </div>
            </div>

            {/* ── Bedingungs-Builder (F07) ─────────────────────────────────── */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label>Conditions</Label>
                <Button size="sm" variant="outline" onClick={addKnownCondition} disabled={fieldDefs.length === 0} data-testid="button-add-condition">
                  <Plus className="h-3 w-3 mr-1" /> Add condition
                </Button>
              </div>
              {conditions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No conditions — the chain applies to every {triggerType} trigger.
                </p>
              ) : (
                <div className="space-y-2">
                  {conditions.map((c, i) => {
                    const def = fieldDefs.find(f => f.key === c.field);
                    const ops = (def?.type ?? c.valueType) === "string" ? OPERATORS_STR : OPERATORS_NUM;
                    const isUnknownField = !def;
                    return (
                      <div key={i} className="grid grid-cols-12 gap-2 items-end border rounded p-2 bg-muted/10" data-testid={`condition-row-${i}`}>
                        <div className="col-span-5">
                          <Label className="text-xs">Field</Label>
                          <select
                            className="w-full border rounded h-9 px-2 bg-background"
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
                            {isUnknownField && <option value={c.field}>{c.field} (unknown)</option>}
                            {fieldDefs.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                        </div>
                        <div className="col-span-3">
                          <Label className="text-xs">Operator</Label>
                          <select
                            className="w-full border rounded h-9 px-2 bg-background"
                            value={c.op}
                            onChange={e => updateCondition(i, { op: e.target.value as ApprovalChainCondition["op"] })}
                            data-testid={`select-condition-op-${i}`}
                          >
                            {ops.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                          </select>
                        </div>
                        <div className="col-span-3">
                          <Label className="text-xs">Value</Label>
                          <Input
                            type={c.valueType === "number" ? "number" : "text"}
                            value={c.value}
                            onChange={e => updateCondition(i, { value: e.target.value })}
                            data-testid={`input-condition-value-${i}`}
                          />
                        </div>
                        <div className="col-span-1 flex justify-end">
                          <Button size="sm" variant="ghost" onClick={() => removeCondition(i)} data-testid={`button-condition-remove-${i}`}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Stages ───────────────────────────────────────────────────── */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label>Stages (sequential)</Label>
                <Button size="sm" variant="outline" onClick={addStage} data-testid="button-add-stage">
                  <Plus className="h-3 w-3 mr-1" /> Add stage
                </Button>
              </div>
              {stages.map((s, i) => {
                const roleKnown = !s.approverRole || allRoleNames.includes(s.approverRole);
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end border rounded p-2 bg-muted/10" data-testid={`stage-row-${i}`}>
                    <div className="col-span-1 text-center font-mono text-sm pt-2">{i + 1}.</div>
                    <div className="col-span-3">
                      <Label className="text-xs">Label</Label>
                      <Input value={s.label} onChange={e => updateStage(i, { label: e.target.value })} data-testid={`input-stage-label-${i}`} />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Role</Label>
                      <select
                        className="w-full border rounded h-9 px-2 bg-background"
                        value={s.approverRole}
                        onChange={e => updateStage(i, { approverRole: e.target.value, approverUserId: "" })}
                        data-testid={`select-stage-role-${i}`}
                      >
                        <option value="">— Role —</option>
                        {!roleKnown && <option value={s.approverRole}>{s.approverRole} (Legacy)</option>}
                        {allRoleNames.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">or specific user</Label>
                      <select
                        className="w-full border rounded h-9 px-2 bg-background"
                        value={s.approverUserId}
                        onChange={e => updateStage(i, { approverUserId: e.target.value, approverRole: "" })}
                        data-testid={`select-stage-user-${i}`}
                      >
                        <option value="">—</option>
                        {(users ?? []).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                    <div className="col-span-2 flex justify-end gap-1">
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
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onSave} disabled={!name.trim() || stages.length === 0} data-testid="button-save-chain">
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

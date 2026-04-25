import { useMemo, useState } from "react";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { GitBranch, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";

const TRIGGER_TYPES = [
  { value: "clause_change", label: "Klausel-Änderung" },
  { value: "amendment", label: "Vertragsänderung" },
  { value: "discount", label: "Rabatt" },
  { value: "manual", label: "Manuell" },
] as const;

// ─── Visueller Bedingungs-Builder (F07) ───────────────────────────────────
// Statt rohem JSON kennt der Builder einen Katalog gängiger Felder pro
// Trigger-Typ — passend zu den Payload-Keys, die der Backend-Resolver in
// `lib/approvalChains.ts` auswertet. Unbekannte Felder werden in einen
// generischen Modus zurückgefallen, sodass historische Chains weiter
// editierbar bleiben.
type ConditionFieldDef = {
  key: string;
  label: string;
  type: "number" | "string";
  hint?: string;
};
const CONDITION_FIELDS: Record<string, ConditionFieldDef[]> = {
  clause_change: [
    { key: "deltaScore", label: "Δ Risiko-Score (Punkte)", type: "number", hint: "Differenz neu − alt. Höher = riskanter." },
    { key: "riskScore", label: "Risiko-Score (neu)", type: "number" },
    { key: "softer", label: "Lockerer Wechsel? (1=ja, 0=nein)", type: "number" },
    { key: "brandId", label: "Brand-ID", type: "string" },
  ],
  discount: [
    { key: "discountPct", label: "Rabatt %", type: "number" },
    { key: "dealValue", label: "Deal-Wert (EUR)", type: "number" },
    { key: "brandId", label: "Brand-ID", type: "string" },
  ],
  amendment: [
    { key: "priceDelta", label: "Preis-Δ (EUR)", type: "number" },
    { key: "dealValue", label: "Deal-Wert (EUR)", type: "number" },
  ],
  manual: [
    { key: "dealValue", label: "Deal-Wert (EUR)", type: "number" },
    { key: "brandId", label: "Brand-ID", type: "string" },
  ],
};
const OPERATORS_NUM = [
  { value: "gte", label: "≥ (mindestens)" },
  { value: "gt", label: "> (größer als)" },
  { value: "lte", label: "≤ (höchstens)" },
  { value: "lt", label: "< (kleiner als)" },
  { value: "eq", label: "= (gleich)" },
] as const;
const OPERATORS_STR = [{ value: "eq", label: "= (gleich)" }] as const;

type ConditionDraft = {
  field: string;
  op: ApprovalChainCondition["op"];
  value: string;
  valueType: "number" | "string";
};

function conditionToDraft(c: ApprovalChainCondition, triggerType: string): ConditionDraft {
  const known = CONDITION_FIELDS[triggerType]?.find(f => f.key === c.field);
  const valueType: "number" | "string" =
    known?.type ?? (typeof c.value === "number" ? "number" : "string");
  return { field: c.field, op: c.op, value: String(c.value), valueType };
}
function draftsToConditions(drafts: ConditionDraft[]): ApprovalChainCondition[] | { error: string } {
  const out: ApprovalChainCondition[] = [];
  for (const d of drafts) {
    if (!d.field) return { error: "Bitte alle Bedingungs-Felder wählen." };
    if (d.value.trim() === "") return { error: `Wert für "${d.field}" fehlt.` };
    if (d.valueType === "number") {
      const n = Number(d.value);
      if (!Number.isFinite(n)) return { error: `"${d.value}" ist keine gültige Zahl für "${d.field}".` };
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
  order, label: `Stufe ${order}`, approverRole: "", approverUserId: "",
});

export function ApprovalChainsCard() {
  const { data: chains, isLoading } = useListApprovalChains();
  const { data: users } = useListUsers();
  const { data: roles } = useListRoles();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateApprovalChain();
  const update = useUpdateApprovalChain();
  const del = useDeleteApprovalChain();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovalChainTemplate | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerType, setTriggerType] = useState<string>("clause_change");
  const [conditions, setConditions] = useState<ConditionDraft[]>([]);
  const [priority, setPriority] = useState<number>(100);
  const [active, setActive] = useState(true);
  const [stages, setStages] = useState<StageDraft[]>([emptyStage(1)]);

  // Sammlung aller Rollen-Namen, die irgendwo schon verwendet wurden
  // (vorhandene Stages, Legacy-Daten). Sicherstellen, dass auch unbekannte
  // historische Werte als Option im Dropdown sichtbar bleiben — sonst
  // verschluckt der Edit-Dialog diese stillschweigend.
  const allRoleNames = useMemo(() => {
    const set = new Set<string>();
    (roles ?? []).forEach(r => set.add(r.name));
    (chains ?? []).forEach(c => c.stages.forEach(s => { if (s.approverRole) set.add(s.approverRole); }));
    return Array.from(set).sort();
  }, [roles, chains]);

  const reset = () => {
    setEditing(null); setName(""); setDescription("");
    setTriggerType("clause_change"); setConditions([]); setPriority(100);
    setActive(true); setStages([emptyStage(1)]);
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
    setOpen(true);
  };

  const refresh = () => qc.invalidateQueries({ queryKey: getListApprovalChainsQueryKey() });

  const onSave = async () => {
    const built = draftsToConditions(conditions);
    if (!Array.isArray(built)) {
      toast({ title: "Bedingungen ungültig", description: built.error, variant: "destructive" });
      return;
    }
    const stagesPayload: ApprovalStage[] = stages.map((s, i) => ({
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
    }));
    if (stagesPayload.length === 0) {
      toast({ title: "Mindestens eine Stufe erforderlich", variant: "destructive" });
      return;
    }
    for (const s of stagesPayload) {
      if (!s.approverRole && !s.approverUserId) {
        toast({ title: `Stufe ${s.order} braucht eine Rolle oder einen User`, variant: "destructive" });
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
        toast({ title: "Genehmigungs-Kette aktualisiert" });
      } else {
        await create.mutateAsync({
          data: {
            name: name.trim(), description: description || undefined, triggerType,
            conditions: built, priority, active, stages: stagesPayload,
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

  // Bedingungen
  const addCondition = () => {
    const fields = CONDITION_FIELDS[triggerType] ?? [];
    const f = fields[0];
    setConditions(prev => [...prev, {
      field: f?.key ?? "",
      op: f?.type === "string" ? "eq" : "gte",
      value: "",
      valueType: f?.type ?? "number",
    }]);
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
    // damit der User nicht im Builder ein Feld sieht, das gar nicht zum
    // neuen Trigger passt.
    const knownKeys = new Set((CONDITION_FIELDS[next] ?? []).map(f => f.key));
    setConditions(prev => prev.filter(c => knownKeys.has(c.field)));
  };

  const fieldDefs = CONDITION_FIELDS[triggerType] ?? [];

  return (
    <Card data-testid="card-approval-chains">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <GitBranch className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <CardTitle>Genehmigungs-Ketten</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Definieren Sie mehrstufige Approval-Workflows. Ein Trigger (z. B. Klausel-Änderung
              oder Amendment) wird beim Erstellen eines Approvals gegen alle aktiven Templates
              geprüft; bei mehreren Treffern gewinnt das Template mit der niedrigsten
              Prioritäts-Zahl (Default 100). Jede Stufe benötigt entweder eine Rolle oder
              einen konkreten User als Approver.
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
          <AlertDialogHeader>
            <AlertDialogTitle>{editing ? "Kette bearbeiten" : "Neue Genehmigungs-Kette"}</AlertDialogTitle>
            <AlertDialogDescription>
              Bedingungen prüfen Werte aus dem Trigger-Kontext (z. B. <span className="font-medium">Δ Risiko-Score</span>{" "}
              bei Klausel-Änderungen oder <span className="font-medium">Rabatt %</span>). Alle Bedingungen müssen erfüllt sein
              (UND-Verknüpfung), damit die Kette greift.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2 max-h-[65vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-chain-name" />
              </div>
              <div>
                <Label>Priorität (niedriger = wichtiger, Default 100)</Label>
                <Input type="number" value={priority} onChange={e => setPriority(parseInt(e.target.value) || 0)} data-testid="input-chain-priority" />
              </div>
            </div>
            <div>
              <Label>Beschreibung</Label>
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
                <Label htmlFor="chain-active">Aktiv</Label>
              </div>
            </div>

            {/* ── Bedingungs-Builder (F07) ─────────────────────────────────── */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label>Bedingungen</Label>
                <Button size="sm" variant="outline" onClick={addCondition} disabled={fieldDefs.length === 0} data-testid="button-add-condition">
                  <Plus className="h-3 w-3 mr-1" /> Bedingung hinzufügen
                </Button>
              </div>
              {conditions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  Keine Bedingungen — die Kette greift bei jedem {triggerType}-Trigger.
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
                          <Label className="text-xs">Feld</Label>
                          <select
                            className="w-full border rounded h-9 px-2 bg-background"
                            value={c.field}
                            onChange={e => {
                              const next = e.target.value;
                              const nextDef = fieldDefs.find(f => f.key === next);
                              updateCondition(i, {
                                field: next,
                                valueType: nextDef?.type ?? "number",
                                op: nextDef?.type === "string" ? "eq" : c.op,
                              });
                            }}
                            data-testid={`select-condition-field-${i}`}
                          >
                            {isUnknownField && <option value={c.field}>{c.field} (unbekannt)</option>}
                            {fieldDefs.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                          </select>
                          {def?.hint && <p className="text-xs text-muted-foreground mt-0.5">{def.hint}</p>}
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
                          <Label className="text-xs">Wert</Label>
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
                <Label>Stufen (sequenziell)</Label>
                <Button size="sm" variant="outline" onClick={addStage} data-testid="button-add-stage">
                  <Plus className="h-3 w-3 mr-1" /> Stufe hinzufügen
                </Button>
              </div>
              {stages.map((s, i) => {
                const roleKnown = !s.approverRole || allRoleNames.includes(s.approverRole);
                return (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end border rounded p-2 bg-muted/10" data-testid={`stage-row-${i}`}>
                    <div className="col-span-1 text-center font-mono text-sm pt-2">{i + 1}.</div>
                    <div className="col-span-3">
                      <Label className="text-xs">Bezeichnung</Label>
                      <Input value={s.label} onChange={e => updateStage(i, { label: e.target.value })} data-testid={`input-stage-label-${i}`} />
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">Rolle</Label>
                      <select
                        className="w-full border rounded h-9 px-2 bg-background"
                        value={s.approverRole}
                        onChange={e => updateStage(i, { approverRole: e.target.value, approverUserId: "" })}
                        data-testid={`select-stage-role-${i}`}
                      >
                        <option value="">— Rolle —</option>
                        {!roleKnown && <option value={s.approverRole}>{s.approverRole} (Legacy)</option>}
                        {allRoleNames.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="col-span-3">
                      <Label className="text-xs">oder konkreter User</Label>
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
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={onSave} disabled={!name.trim() || stages.length === 0} data-testid="button-save-chain">
              Speichern
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

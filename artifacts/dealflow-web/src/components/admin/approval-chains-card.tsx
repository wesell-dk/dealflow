import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListApprovalChains,
  useCreateApprovalChain,
  useUpdateApprovalChain,
  useDeleteApprovalChain,
  getListApprovalChainsQueryKey,
  useListUsers,
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

const ROLES = ["sales_rep", "sales_manager", "legal", "finance", "tenant_admin"] as const;

type StageDraft = {
  order: number;
  label: string;
  approverRole: string;
  approverUserId: string;
};

const emptyStage = (order: number): StageDraft => ({
  order, label: `Stage ${order}`, approverRole: "", approverUserId: "",
});

export function ApprovalChainsCard() {
  const { data: chains, isLoading } = useListApprovalChains();
  const { data: users } = useListUsers();
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
  const [conditionsJson, setConditionsJson] = useState<string>("[]");
  const [priority, setPriority] = useState<number>(100);
  const [active, setActive] = useState(true);
  const [stages, setStages] = useState<StageDraft[]>([emptyStage(1)]);

  const reset = () => {
    setEditing(null); setName(""); setDescription("");
    setTriggerType("clause_change"); setConditionsJson("[]"); setPriority(100);
    setActive(true); setStages([emptyStage(1)]);
  };
  const openCreate = () => { reset(); setOpen(true); };
  const openEdit = (c: ApprovalChainTemplate) => {
    setEditing(c);
    setName(c.name); setDescription(c.description ?? "");
    setTriggerType(c.triggerType);
    setConditionsJson(JSON.stringify(c.conditions ?? [], null, 2));
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
    let conditions: ApprovalChainCondition[] = [];
    try {
      const parsed = conditionsJson.trim() ? JSON.parse(conditionsJson) : [];
      if (!Array.isArray(parsed)) {
        toast({ title: "Bedingungen müssen ein JSON-Array sein", variant: "destructive" });
        return;
      }
      conditions = parsed as ApprovalChainCondition[];
    } catch {
      toast({ title: "Bedingungen sind kein gültiges JSON", variant: "destructive" });
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
      toast({ title: "Mindestens eine Stage erforderlich", variant: "destructive" });
      return;
    }
    for (const s of stagesPayload) {
      if (!s.approverRole && !s.approverUserId) {
        toast({ title: `Stage ${s.order} braucht eine Rolle oder einen User`, variant: "destructive" });
        return;
      }
    }
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          data: {
            name, description: description || null, triggerType,
            conditions, priority, active, stages: stagesPayload,
          },
        });
        toast({ title: "Genehmigungs-Kette aktualisiert" });
      } else {
        await create.mutateAsync({
          data: {
            name: name.trim(), description: description || undefined, triggerType,
            conditions, priority, active, stages: stagesPayload,
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
              Prioritäts-Zahl (Default 100). Jede Stage benötigt entweder eine Rolle oder
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
                <TableHead>Stages</TableHead>
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
              Bedingungen werden als JSON-Array von <code>{`{ field, op, value }`}</code> geprüft, z. B.{" "}
              <code className="text-xs">{`[{"field":"deltaScore","op":"gte","value":3}]`}</code>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2 max-h-[60vh] overflow-y-auto">
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
                  onChange={e => setTriggerType(e.target.value)}
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
            <div>
              <Label>Bedingungen (JSON)</Label>
              <textarea
                className="w-full border rounded p-2 font-mono text-xs h-24 bg-background"
                value={conditionsJson}
                onChange={e => setConditionsJson(e.target.value)}
                data-testid="textarea-chain-conditions"
              />
            </div>
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label>Stages (sequenziell)</Label>
                <Button size="sm" variant="outline" onClick={addStage} data-testid="button-add-stage">
                  <Plus className="h-3 w-3 mr-1" /> Stage hinzufügen
                </Button>
              </div>
              {stages.map((s, i) => (
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
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
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
              ))}
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

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePriceRule,
  useUpdatePriceRule,
  useListBrands,
  useListCompanies,
  getListPriceRulesQueryKey,
  type PriceRule,
  type PriceRuleInput,
  type PriceRulePatch,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  rule?: PriceRule;
}

const STATUS_OPTIONS: Array<{ value: "draft" | "active" | "archived"; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

const SCOPE_GLOBAL = "global";
const SCOPE_COMPANY = "_company_";
const SCOPE_BRAND = "_brand_";

export function PriceRuleFormDialog({ open, onOpenChange, rule }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!rule;

  const createMut = useCreatePriceRule();
  const updateMut = useUpdatePriceRule();
  const brandsQ = useListBrands();
  const companiesQ = useListCompanies();

  const [name, setName] = useState("");
  const [scopeKind, setScopeKind] = useState<"global" | "_company_" | "_brand_">("global");
  const [scopeTarget, setScopeTarget] = useState<string>("");
  const [condition, setCondition] = useState<string>("");
  const [effect, setEffect] = useState<string>("");
  const [priority, setPriority] = useState<string>("100");
  const [status, setStatus] = useState<"draft" | "active" | "archived">("draft");

  // Bestehende Rule-Scopes können string-IDs sein. Beim Edit identifizieren wir
  // den Typ (global/company/brand) damit der Picker korrekt vorbefüllt ist.
  useEffect(() => {
    if (!open) return;
    if (rule) {
      setName(rule.name);
      setCondition(rule.condition);
      setEffect(rule.effect);
      setPriority(String(rule.priority));
      setStatus((rule.status as "draft" | "active" | "archived") ?? "draft");
      if (rule.scope === "global") {
        setScopeKind("global");
        setScopeTarget("");
      } else if ((companiesQ.data ?? []).some(c => c.id === rule.scope)) {
        setScopeKind("_company_");
        setScopeTarget(rule.scope);
      } else if ((brandsQ.data ?? []).some(b => b.id === rule.scope)) {
        setScopeKind("_brand_");
        setScopeTarget(rule.scope);
      } else {
        // Unbekannter Scope (z. B. Company/Brand noch nicht geladen) → Default Global,
        // User sieht den rohen Wert via "Erweitert" nicht – wir zeigen Hinweis.
        setScopeKind("global");
        setScopeTarget(rule.scope);
      }
    } else {
      setName("");
      setScopeKind("global");
      setScopeTarget("");
      setCondition("");
      setEffect("");
      setPriority("100");
      setStatus("draft");
    }
  }, [open, rule, companiesQ.data, brandsQ.data]);

  const scopeStr = useMemo(() => {
    if (scopeKind === "global") return "global";
    return scopeTarget;
  }, [scopeKind, scopeTarget]);

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedCondition = condition.trim();
    const trimmedEffect = effect.trim();
    const prio = Number(priority);
    if (!trimmedName) {
      toast({ title: "Name missing", variant: "destructive" });
      return;
    }
    if (scopeKind !== "global" && !scopeTarget) {
      toast({ title: "Scope target missing", description: "Please choose a brand or company.", variant: "destructive" });
      return;
    }
    if (!trimmedCondition || !trimmedEffect) {
      toast({ title: "Condition & effect required", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(prio) || prio < 0) {
      toast({ title: "Invalid priority", description: "Whole, non-negative number.", variant: "destructive" });
      return;
    }
    try {
      if (isEdit && rule) {
        const patch: PriceRulePatch = {
          name: trimmedName,
          scope: scopeStr,
          condition: trimmedCondition,
          effect: trimmedEffect,
          priority: Math.round(prio),
          status,
        };
        await updateMut.mutateAsync({ id: rule.id, data: patch });
        toast({ title: "Pricing rule updated", description: trimmedName });
      } else {
        const body: PriceRuleInput = {
          name: trimmedName,
          scope: scopeStr,
          condition: trimmedCondition,
          effect: trimmedEffect,
          priority: Math.round(prio),
          status,
        };
        await createMut.mutateAsync({ data: body });
        toast({ title: "Pricing rule created", description: trimmedName });
      }
      await qc.invalidateQueries({ queryKey: getListPriceRulesQueryKey() });
      onOpenChange(false);
    } catch (e: unknown) {
      const st = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: st === 403 ? "Not authorized" : "Save failed",
        description: body?.error ?? (e instanceof Error ? e.message : "Unknown error"),
        variant: "destructive",
      });
    }
  };

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit pricing rule" : "New pricing rule"}</DialogTitle>
          <DialogDescription>
            Rules apply in order of their priority (lower number = earlier).
            Scope determines what the rule applies to — global, a brand or a company.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="pr-name">Name *</Label>
            <Input id="pr-name" value={name} onChange={e => setName(e.target.value)} placeholder="Volume Discount Tier 1" data-testid="input-pr-name" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Scope type</Label>
              <Select value={scopeKind} onValueChange={(v) => { setScopeKind(v as typeof scopeKind); setScopeTarget(""); }}>
                <SelectTrigger data-testid="select-pr-scope-kind"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={SCOPE_GLOBAL}>Global</SelectItem>
                  <SelectItem value={SCOPE_COMPANY}>Company</SelectItem>
                  <SelectItem value={SCOPE_BRAND}>Brand</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scope target{scopeKind === "global" ? "" : " *"}</Label>
              {scopeKind === "global" ? (
                <Input value="All brands & companies" disabled />
              ) : scopeKind === "_company_" ? (
                <Select value={scopeTarget} onValueChange={setScopeTarget}>
                  <SelectTrigger data-testid="select-pr-scope-company"><SelectValue placeholder={companiesQ.isLoading ? "Loading…" : "Choose"} /></SelectTrigger>
                  <SelectContent>
                    {(companiesQ.data ?? []).map(c => (
                      <SelectItem key={c.id} value={c.id} textValue={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={scopeTarget} onValueChange={setScopeTarget}>
                  <SelectTrigger data-testid="select-pr-scope-brand"><SelectValue placeholder={brandsQ.isLoading ? "Loading…" : "Choose"} /></SelectTrigger>
                  <SelectContent>
                    {(brandsQ.data ?? []).map(b => (
                      <SelectItem key={b.id} value={b.id} textValue={b.name}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pr-condition">Condition *</Label>
              <Textarea
                id="pr-condition"
                value={condition}
                onChange={e => setCondition(e.target.value)}
                placeholder="quantity >= 10"
                className="font-mono text-sm"
                rows={3}
                data-testid="input-pr-condition"
              />
              <p className="text-[11px] text-muted-foreground">
                Free text — e.g. <code className="font-mono">quantity {">"}= 10</code> or
                <code className="font-mono"> total {">"} 50000 EUR</code>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-effect">Effect *</Label>
              <Textarea
                id="pr-effect"
                value={effect}
                onChange={e => setEffect(e.target.value)}
                placeholder="apply 5% discount"
                className="font-mono text-sm"
                rows={3}
                data-testid="input-pr-effect"
              />
              <p className="text-[11px] text-muted-foreground">
                e.g. <code className="font-mono">apply 5% discount</code>.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pr-priority">Priority *</Label>
              <Input
                id="pr-priority"
                type="number"
                min={0}
                step="1"
                value={priority}
                onChange={e => setPriority(e.target.value)}
                data-testid="input-pr-priority"
              />
              <p className="text-[11px] text-muted-foreground">Lower number is evaluated first.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pr-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as "draft" | "active" | "archived")}>
                <SelectTrigger id="pr-status" data-testid="select-pr-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-pr-submit">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

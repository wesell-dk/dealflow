import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateContract,
  useListDeals,
  useListContractTypes,
  getListContractsQueryKey,
  getGetDealQueryKey,
  type ContractType,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDealId?: string;
};

const TEMPLATE_OPTIONS: Array<{ value: string; label: string; suggestedCode: string }> = [
  { value: "Mutual NDA", label: "Mutual NDA", suggestedCode: "NDA" },
  { value: "Master Services Agreement", label: "Master Services Agreement", suggestedCode: "MSA" },
  { value: "Order Form", label: "Order Form", suggestedCode: "OF" },
  { value: "Data Processing Agreement", label: "Data Processing Agreement", suggestedCode: "DPA" },
  { value: "Statement of Work", label: "Statement of Work", suggestedCode: "SOW" },
];

function suggestContractTypeId(template: string, types: ContractType[]): string {
  const tpl = template.toLowerCase();
  const match = TEMPLATE_OPTIONS.find(t => tpl.includes(t.value.toLowerCase()))?.suggestedCode;
  if (!match) return "";
  return types.find(t => t.code === match && t.active)?.id ?? "";
}

export function ContractFormDialog({ open, onOpenChange, defaultDealId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const create = useCreateContract();

  const { data: deals } = useListDeals();
  const { data: contractTypes } = useListContractTypes();

  const [dealId, setDealId] = useState(defaultDealId ?? "");
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState(TEMPLATE_OPTIONS[1].value);
  const [contractTypeId, setContractTypeId] = useState("");
  const [contractTypeTouched, setContractTypeTouched] = useState(false);

  // Reset form whenever the dialog opens; pre-pick deal/title sensibly.
  useEffect(() => {
    if (!open) return;
    setDealId(defaultDealId ?? "");
    setTitle("");
    setTemplate(TEMPLATE_OPTIONS[1].value);
    setContractTypeTouched(false);
  }, [open, defaultDealId]);

  // Auto-suggest contract type from template name unless the user has
  // explicitly chosen one already.
  useEffect(() => {
    if (contractTypeTouched) return;
    const types = contractTypes ?? [];
    if (types.length === 0) return;
    setContractTypeId(suggestContractTypeId(template, types));
  }, [template, contractTypes, contractTypeTouched]);

  const dealOptions = useMemo(
    () =>
      (deals ?? [])
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "de"))
        .map(d => ({ value: d.id, label: `${d.name}${d.accountName ? ` · ${d.accountName}` : ""}` })),
    [deals],
  );

  const typeOptions = useMemo(
    () =>
      (contractTypes ?? [])
        .filter(t => t.active)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "de"))
        .map(t => ({ value: t.id, label: `${t.name} (${t.code})` })),
    [contractTypes],
  );

  const canSubmit =
    dealId.trim() !== "" &&
    title.trim() !== "" &&
    template.trim() !== "" &&
    contractTypeId.trim() !== "" &&
    !create.isPending;

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      const created = await create.mutateAsync({
        data: {
          dealId,
          title: title.trim(),
          template,
          contractTypeId,
        },
      });
      toast({ title: "Vertrag angelegt", description: created.title });
      await qc.invalidateQueries({ queryKey: getListContractsQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
      onOpenChange(false);
      setLocation(`/contracts/${created.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bitte versuche es erneut.";
      toast({ title: "Anlegen fehlgeschlagen", description: msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-new-contract">
        <DialogHeader>
          <DialogTitle>Neuer Vertrag</DialogTitle>
          <DialogDescription>
            Wähle Deal und Vertragstyp — der Vertragstyp ist Pflicht, damit der CUAD-Coverage-Check
            sofort funktioniert.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="contract-deal">Deal</Label>
            <Select value={dealId} onValueChange={setDealId}>
              <SelectTrigger id="contract-deal" data-testid="select-deal">
                <SelectValue placeholder="Deal auswählen…" />
              </SelectTrigger>
              <SelectContent>
                {dealOptions.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contract-title">Titel</Label>
            <Input
              id="contract-title"
              data-testid="input-contract-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="z. B. MSA mit ACME GmbH"
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contract-template">Template</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger id="contract-template" data-testid="select-template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contract-type">
              Vertragstyp <span className="text-destructive">*</span>
            </Label>
            <Select
              value={contractTypeId}
              onValueChange={(v) => { setContractTypeTouched(true); setContractTypeId(v); }}
            >
              <SelectTrigger id="contract-type" data-testid="select-contract-type">
                <SelectValue placeholder="Vertragstyp wählen…" />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Vorausgewählt anhand des Templates. Du kannst jederzeit einen anderen Typ wählen.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="button-create-contract"
          >
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

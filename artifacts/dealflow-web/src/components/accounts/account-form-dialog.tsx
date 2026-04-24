import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateAccount,
  useUpdateAccount,
  getListAccountsQueryKey,
  getGetAccountQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useOnboarding } from "@/contexts/onboarding-context";

type EditAccount = {
  id: string;
  name: string;
  industry: string;
  country: string;
  healthScore?: number;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: EditAccount | null;
  onSaved?: (id: string) => void;
};

export function AccountFormDialog({ open, onOpenChange, account, onSaved }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { markStep } = useOnboarding();
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const isEdit = Boolean(account);

  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("");
  const [healthScore, setHealthScore] = useState<string>("");

  useEffect(() => {
    if (open) {
      setName(account?.name ?? "");
      setIndustry(account?.industry ?? "");
      setCountry(account?.country ?? "");
      setHealthScore(account?.healthScore !== undefined ? String(account.healthScore) : "");
    }
  }, [open, account]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedIndustry = industry.trim();
    const trimmedCountry = country.trim();
    if (!trimmedName || !trimmedIndustry || !trimmedCountry) {
      toast({ title: "Pflichtfelder fehlen", description: "Name, Branche und Land sind erforderlich.", variant: "destructive" });
      return;
    }
    try {
      if (isEdit && account) {
        const patch: { name?: string; industry?: string; country?: string; healthScore?: number } = {};
        if (trimmedName !== account.name) patch.name = trimmedName;
        if (trimmedIndustry !== account.industry) patch.industry = trimmedIndustry;
        if (trimmedCountry !== account.country) patch.country = trimmedCountry;
        const hs = healthScore.trim() === "" ? undefined : Number(healthScore);
        if (hs !== undefined && !Number.isNaN(hs) && hs !== account.healthScore) patch.healthScore = hs;
        if (Object.keys(patch).length === 0) {
          onOpenChange(false);
          return;
        }
        await update.mutateAsync({ id: account.id, data: patch });
        await qc.invalidateQueries({ queryKey: getGetAccountQueryKey(account.id) });
        await qc.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        toast({ title: "Kunde aktualisiert", description: trimmedName });
        onSaved?.(account.id);
      } else {
        const result = await create.mutateAsync({
          data: { name: trimmedName, industry: trimmedIndustry, country: trimmedCountry },
        });
        await qc.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        markStep("account");
        toast({ title: "Kunde angelegt", description: trimmedName });
        onSaved?.(result.id);
      }
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Speichern fehlgeschlagen";
      toast({ title: "Fehler", description: msg, variant: "destructive" });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <DialogContent data-testid="account-form-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Kunde bearbeiten" : "Kunde anlegen"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Aktualisiere Stammdaten dieses Kunden."
              : "Lege einen neuen B2B-Kunden mit den wichtigsten Stammdaten an."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="acc-name">Name *</Label>
            <Input
              id="acc-name"
              data-testid="account-form-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. ACME GmbH"
              autoFocus
              disabled={pending}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="acc-industry">Branche *</Label>
              <Input
                id="acc-industry"
                data-testid="account-form-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="z.B. Maschinenbau"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-country">Land *</Label>
              <Input
                id="acc-country"
                data-testid="account-form-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="z.B. DE"
                disabled={pending}
              />
            </div>
          </div>
          {isEdit && (
            <div className="space-y-2">
              <Label htmlFor="acc-health">Health-Score (0–100)</Label>
              <Input
                id="acc-health"
                data-testid="account-form-health"
                type="number"
                min={0}
                max={100}
                value={healthScore}
                onChange={(e) => setHealthScore(e.target.value)}
                disabled={pending}
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending} data-testid="account-form-submit">
              {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Speichern" : "Kunde anlegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

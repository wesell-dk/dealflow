import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCompany,
  useUpdateCompany,
  getListCompaniesQueryKey,
  type Company,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Falls gesetzt: Edit-Modus, sonst Create. */
  company?: Company | null;
}

export function CompanyFormDialog({ open, onOpenChange, company }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateCompany();
  const updateMut = useUpdateCompany();
  const isEdit = !!company;

  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [country, setCountry] = useState("DE");
  const [currency, setCurrency] = useState("EUR");

  // Werte synchronisieren, wenn Dialog mit anderer Company geöffnet wird.
  useEffect(() => {
    if (open) {
      setName(company?.name ?? "");
      setLegalName(company?.legalName ?? "");
      setCountry(company?.country ?? "DE");
      setCurrency(company?.currency ?? "EUR");
    }
  }, [open, company]);

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedLegal = legalName.trim();
    const c2 = country.trim().toUpperCase();
    const c3 = currency.trim().toUpperCase();
    if (!trimmedName || !trimmedLegal) {
      toast({ title: "Eingabe unvollständig", description: "Name und juristischer Name sind Pflicht.", variant: "destructive" });
      return;
    }
    if (!/^[A-Z]{2}$/.test(c2)) {
      toast({ title: "Ungültiges Land", description: "Bitte ISO-2-Code (z. B. DE, CH, AT).", variant: "destructive" });
      return;
    }
    if (!/^[A-Z]{3}$/.test(c3)) {
      toast({ title: "Ungültige Währung", description: "Bitte ISO-3-Code (z. B. EUR, CHF, USD).", variant: "destructive" });
      return;
    }
    try {
      if (isEdit && company) {
        await updateMut.mutateAsync({
          id: company.id,
          data: { name: trimmedName, legalName: trimmedLegal, country: c2, currency: c3 },
        });
        toast({ title: "Gesellschaft aktualisiert", description: trimmedName });
      } else {
        await createMut.mutateAsync({
          data: { name: trimmedName, legalName: trimmedLegal, country: c2, currency: c3 },
        });
        toast({ title: "Gesellschaft angelegt", description: trimmedName });
      }
      await qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
      onOpenChange(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: status === 409 ? "Name bereits vergeben" : "Speichern fehlgeschlagen",
        description: body?.error ?? (e instanceof Error ? e.message : "Unbekannter Fehler"),
        variant: "destructive",
      });
    }
  };

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Gesellschaft bearbeiten" : "Neue Gesellschaft anlegen"}</DialogTitle>
          <DialogDescription>
            Juristische Einheit innerhalb deines Tenants — z. B. die operative GmbH oder Tochtergesellschaft.
            Markenauftritte hängen darunter.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">Anzeige-Name *</Label>
            <Input id="company-name" value={name} onChange={e => setName(e.target.value)} placeholder="Helix Logistics" data-testid="input-company-name" />
            <p className="text-xs text-muted-foreground">Der Name, wie er in DealFlow erscheint.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-legal">Juristischer Name *</Label>
            <Input id="company-legal" value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="Helix Logistics GmbH" data-testid="input-company-legal" />
            <p className="text-xs text-muted-foreground">Vollständiger Firmenwortlaut wie im Handelsregister.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="company-country">Land (ISO-2)</Label>
              <Input id="company-country" value={country} onChange={e => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="DE" data-testid="input-company-country" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-currency">Währung (ISO-3)</Label>
              <Input id="company-currency" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="EUR" data-testid="input-company-currency" />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Abbrechen</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-company-submit">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

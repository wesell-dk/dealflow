import { useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateDeal,
  useUpdateDeal,
  useListAccounts,
  useListBrands,
  useListCompanies,
  useListUsers,
  getListDealsQueryKey,
  getGetDealQueryKey,
  getGetDealPipelineQueryKey,
  getGetAccountQueryKey,
  getListAccountsQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { useOnboarding } from "@/contexts/onboarding-context";
import { FieldHint } from "@/components/ui/field-hint";
import { DEAL_STAGES } from "@/lib/glossary";

const STAGES = [
  { value: "qualified",   label: DEAL_STAGES.qualified.label,   short: DEAL_STAGES.qualified.short },
  { value: "discovery",   label: DEAL_STAGES.discovery.label,   short: DEAL_STAGES.discovery.short },
  { value: "proposal",    label: DEAL_STAGES.proposal.label,    short: DEAL_STAGES.proposal.short },
  { value: "negotiation", label: DEAL_STAGES.negotiation.label, short: DEAL_STAGES.negotiation.short },
  { value: "closing",     label: DEAL_STAGES.closing.label,     short: DEAL_STAGES.closing.short },
  { value: "won",         label: DEAL_STAGES.won.label,         short: DEAL_STAGES.won.short },
  { value: "lost",        label: DEAL_STAGES.lost.label,        short: DEAL_STAGES.lost.short },
];

type EditDeal = {
  id: string;
  name: string;
  accountId: string;
  value: number;
  stage: string;
  brandId: string;
  companyId: string;
  ownerId: string;
  expectedCloseDate: string;
  probability?: number;
  riskLevel?: string;
  nextStep?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: EditDeal | null;
  defaultAccountId?: string;
  onSaved?: (id: string) => void;
};

export function DealFormDialog({ open, onOpenChange, deal, defaultAccountId, onSaved }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { markStep } = useOnboarding();
  const create = useCreateDeal();
  const update = useUpdateDeal();
  const isEdit = Boolean(deal);

  const { data: accounts } = useListAccounts();
  const { data: brands } = useListBrands();
  const { data: companies } = useListCompanies();
  const { data: users } = useListUsers();

  const [name, setName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [value, setValue] = useState("");
  const [stage, setStage] = useState("qualified");
  const [brandId, setBrandId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [probability, setProbability] = useState<string>("");
  const [nextStep, setNextStep] = useState<string>("");

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Marke ist die Quelle für die Company: jede Brand hängt fest an genau einer
  // Company (`brands.company_id` notNull). Wir leiten die companyId immer aus
  // der gewählten Marke ab, damit Nutzer keine widersprüchliche Kombination
  // erzeugen können (vgl. Task #226).
  const selectedBrand = useMemo(
    () => brands?.find(b => b.id === brandId),
    [brands, brandId],
  );
  const derivedCompanyId = selectedBrand?.companyId ?? "";
  const derivedCompanyName = useMemo(() => {
    if (!derivedCompanyId) return "";
    return companies?.find(c => c.id === derivedCompanyId)?.name ?? "";
  }, [companies, derivedCompanyId]);

  useEffect(() => {
    if (open) {
      setName(deal?.name ?? "");
      setAccountId(deal?.accountId ?? defaultAccountId ?? "");
      setValue(deal ? String(deal.value) : "");
      setStage(deal?.stage ?? "qualified");
      setBrandId(deal?.brandId ?? "");
      setCompanyId(deal?.companyId ?? "");
      setOwnerId(deal?.ownerId ?? "");
      setExpectedCloseDate(
        deal?.expectedCloseDate
          ? deal.expectedCloseDate.slice(0, 10)
          : new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10)
      );
      setProbability(deal?.probability !== undefined ? String(deal.probability) : "");
      setNextStep(deal?.nextStep ?? "");
    }
  }, [open, deal, defaultAccountId]);

  // Company aus der gewählten Marke ableiten — sobald die Brand-Liste oder
  // der ausgewählte Brand sich ändert, spiegeln wir die zugehörige companyId
  // ins lokale Form-State, damit das (read-only) Company-Feld konsistent
  // bleibt und beim Submit der korrekte Wert übermittelt wird.
  useEffect(() => {
    if (!open) return;
    if (derivedCompanyId && derivedCompanyId !== companyId) {
      setCompanyId(derivedCompanyId);
    }
  }, [open, derivedCompanyId, companyId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast({ title: "Name fehlt", variant: "destructive" });
      return;
    }
    // Wert ist optional bei Anlage — wird beim ersten akzeptierten Angebot
    // nachgepflegt (siehe `quote.accept`-Backend). Bei Eingabe muss der Wert
    // aber positiv sein.
    const valueProvided = value.trim() !== "";
    const numValue = valueProvided ? Number(value) : 0;
    if (valueProvided && (Number.isNaN(numValue) || numValue < 0)) {
      toast({ title: "Wert ungültig", description: "Bitte einen positiven Betrag angeben oder leer lassen.", variant: "destructive" });
      return;
    }
    // Company wird aus der gewählten Marke abgeleitet — die separate Pflicht-
    // prüfung entfällt, sobald eine Marke gewählt ist.
    if (!isEdit && (!accountId || !brandId || !ownerId || !expectedCloseDate)) {
      toast({ title: "Pflichtfelder fehlen", description: "Kunde, Marke, Verantwortlich und Abschlussdatum sind erforderlich.", variant: "destructive" });
      return;
    }
    // Sicherheits-Netz: ohne aufgelöste Brand-Daten haben wir keine companyId
    // und dürfen nicht senden — sonst lehnt das Backend (Brand/Company-
    // Konsistenzprüfung) den Request ab.
    if (!isEdit && !derivedCompanyId) {
      toast({ title: "Marke wird geladen", description: "Bitte einen Moment warten und erneut versuchen.", variant: "destructive" });
      return;
    }
    try {
      if (isEdit && deal) {
        const patch: {
          name?: string; stage?: string; value?: number; probability?: number;
          nextStep?: string; expectedCloseDate?: string;
        } = {};
        if (trimmedName !== deal.name) patch.name = trimmedName;
        if (stage !== deal.stage) patch.stage = stage;
        if (value.trim() !== "" && Number(value) !== deal.value) patch.value = Number(value);
        if (probability.trim() !== "") {
          const p = Number(probability);
          if (!Number.isNaN(p) && p !== deal.probability) patch.probability = p;
        }
        if (nextStep.trim() !== (deal.nextStep ?? "").trim()) patch.nextStep = nextStep.trim();
        if (expectedCloseDate && expectedCloseDate !== deal.expectedCloseDate.slice(0, 10)) {
          patch.expectedCloseDate = expectedCloseDate;
        }
        if (Object.keys(patch).length === 0) {
          onOpenChange(false);
          return;
        }
        await update.mutateAsync({ id: deal.id, data: patch });
        await qc.invalidateQueries({ queryKey: getGetDealQueryKey(deal.id) });
        await qc.invalidateQueries({ queryKey: getListDealsQueryKey() });
        await qc.invalidateQueries({ queryKey: getGetDealPipelineQueryKey() });
        await qc.invalidateQueries({ queryKey: getGetAccountQueryKey(deal.accountId) });
        toast({ title: "Deal aktualisiert", description: trimmedName });
        onSaved?.(deal.id);
      } else {
        const result = await create.mutateAsync({
          data: {
            name: trimmedName,
            accountId,
            // Wert ist optional bei Anlage. Wird vom Backend mit 0 initialisiert
            // und beim ersten akzeptierten Angebot über den Quote-Total gesetzt.
            value: valueProvided ? numValue : 0,
            stage,
            brandId,
            // companyId wird aus der Marke abgeleitet (siehe useMemo oben).
            // Wir senden den abgeleiteten Wert direkt, statt auf den
            // useEffect-Sync zu vertrauen, damit ein synchrones Submit nach
            // dem Brand-Wechsel garantiert die korrekte companyId enthält.
            companyId: derivedCompanyId,
            ownerId,
            expectedCloseDate,
          },
        });
        await qc.invalidateQueries({ queryKey: getListDealsQueryKey() });
        await qc.invalidateQueries({ queryKey: getGetDealPipelineQueryKey() });
        await qc.invalidateQueries({ queryKey: getGetAccountQueryKey(accountId) });
        await qc.invalidateQueries({ queryKey: getListAccountsQueryKey() });
        markStep("deal");
        toast({ title: "Deal angelegt", description: trimmedName });
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
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto" data-testid="deal-form-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Deal bearbeiten" : "Deal anlegen"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Aktualisiere Phase, Wert und nächsten Schritt dieses Deals."
              : "Erfasse eine neue Verkaufschance mit Kunde, Marke und erwartetem Abschluss."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="deal-name">Name *</Label>
            <Input
              id="deal-name"
              data-testid="deal-form-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. ACME – Wartungsvertrag 2026"
              autoFocus
              disabled={pending}
            />
          </div>

          {!isEdit && (
            <div className="space-y-2">
              <Label htmlFor="deal-account">Kunde *</Label>
              <Select value={accountId} onValueChange={setAccountId} disabled={pending}>
                <SelectTrigger id="deal-account" data-testid="deal-form-account"><SelectValue placeholder="Kunde wählen…" /></SelectTrigger>
                <SelectContent>
                  {accounts?.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  {!accounts?.length && <div className="px-2 py-1.5 text-xs text-muted-foreground">Noch keine Kunden – lege erst einen Kunden an.</div>}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="deal-value">Wert (€)</Label>
                <FieldHint term={{ group: "concepts", value: "value" }} />
              </div>
              <Input
                id="deal-value"
                data-testid="deal-form-value"
                type="number"
                min={0}
                step="0.01"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="optional – wird aus Angebot übernommen"
                disabled={pending}
              />
              {!isEdit && (
                <p className="text-xs text-muted-foreground">
                  Leer lassen, wenn der Wert erst aus dem ersten akzeptierten Angebot folgt.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="deal-stage">Phase *</Label>
                <FieldHint
                  title="Pipeline-Phasen"
                  text="Qualifiziert → Discovery → Angebot → Verhandlung → Closing → Won/Lost. Jede Phase steht für einen klaren Reifegrad. Wähle in der Liste eine Phase, um die Detail-Erklärung zu sehen."
                />
              </div>
              <Select value={stage} onValueChange={setStage} disabled={pending}>
                <SelectTrigger id="deal-stage" data-testid="deal-form-stage"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map(s => (
                    <SelectItem key={s.value} value={s.value} className="py-2">
                      <div className="flex flex-col">
                        <span>{s.label}</span>
                        <span className="text-[11px] leading-snug text-muted-foreground">{s.short}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!isEdit && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="deal-brand">Marke *</Label>
                  <FieldHint term={{ group: "concepts", value: "brand" }} />
                </div>
                <Select value={brandId} onValueChange={setBrandId} disabled={pending}>
                  <SelectTrigger id="deal-brand" data-testid="deal-form-brand"><SelectValue placeholder="Marke wählen…" /></SelectTrigger>
                  <SelectContent>
                    {brands?.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="deal-company">Company</Label>
                  <FieldHint term={{ group: "concepts", value: "company" }} />
                </div>
                {/*
                  Company ist read-only und wird aus der gewählten Marke
                  abgeleitet. Wir zeigen den Wert als Input statt Select, damit
                  klar ist, dass hier keine eigene Auswahl getroffen wird.
                */}
                <Input
                  id="deal-company"
                  data-testid="deal-form-company"
                  value={derivedCompanyName}
                  placeholder={brandId ? "Wird aus Marke abgeleitet…" : "Erst eine Marke wählen"}
                  readOnly
                  disabled
                  aria-describedby="deal-company-hint"
                />
                <p id="deal-company-hint" className="text-xs text-muted-foreground">
                  Wird automatisch aus der gewählten Marke übernommen.
                </p>
              </div>
            </div>
          )}

          {!isEdit && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="deal-owner">Verantwortlich *</Label>
                <FieldHint term={{ group: "concepts", value: "owner" }} />
              </div>
              <Select value={ownerId} onValueChange={setOwnerId} disabled={pending}>
                <SelectTrigger id="deal-owner" data-testid="deal-form-owner"><SelectValue placeholder="User wählen…" /></SelectTrigger>
                <SelectContent>
                  {users?.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="deal-close">Erwartetes Abschlussdatum {!isEdit && "*"}</Label>
                <FieldHint term={{ group: "concepts", value: "expectedCloseDate" }} />
              </div>
              <Input
                id="deal-close"
                data-testid="deal-form-close"
                type="date"
                min={today}
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                disabled={pending}
              />
            </div>
            {isEdit && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="deal-prob">Wahrscheinlichkeit (%)</Label>
                  <FieldHint term={{ group: "concepts", value: "probability" }} />
                </div>
                <Input
                  id="deal-prob"
                  data-testid="deal-form-probability"
                  type="number"
                  min={0}
                  max={100}
                  value={probability}
                  onChange={(e) => setProbability(e.target.value)}
                  disabled={pending}
                />
              </div>
            )}
          </div>

          {isEdit && (
            <div className="space-y-2">
              <Label htmlFor="deal-next">Nächster Schritt</Label>
              <Input
                id="deal-next"
                data-testid="deal-form-next"
                value={nextStep}
                onChange={(e) => setNextStep(e.target.value)}
                placeholder="z.B. Demo am 12.05. mit CTO"
                disabled={pending}
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending} data-testid="deal-form-submit">
              {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Speichern" : "Deal anlegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

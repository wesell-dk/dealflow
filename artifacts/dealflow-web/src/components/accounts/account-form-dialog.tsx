import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateAccount,
  useUpdateAccount,
  useEnrichAccountFromWebsite,
  getListAccountsQueryKey,
  getGetAccountQueryKey,
  type AccountInput,
  type AccountPatch,
  type AccountEnrichmentSuggestion,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, Check, X } from "lucide-react";
import { useOnboarding } from "@/contexts/onboarding-context";

type EditAccount = {
  id: string;
  name: string;
  industry: string;
  country: string;
  healthScore?: number;
  website?: string | null;
  phone?: string | null;
  billingAddress?: string | null;
  vatId?: string | null;
  sizeBracket?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: EditAccount | null;
  onSaved?: (id: string) => void;
};

const SIZE_BRACKETS = ["1-10", "11-50", "51-200", "201-1000", "1000+"];

export function AccountFormDialog({ open, onOpenChange, account, onSaved }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { markStep } = useOnboarding();
  const create = useCreateAccount();
  const update = useUpdateAccount();
  const enrich = useEnrichAccountFromWebsite();
  const isEdit = Boolean(account);

  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("");
  const [healthScore, setHealthScore] = useState<string>("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [vatId, setVatId] = useState("");
  const [sizeBracket, setSizeBracket] = useState<string>("");

  const [suggestion, setSuggestion] = useState<AccountEnrichmentSuggestion | null>(null);

  // Achtung: Dependency hier nur auf `open` und `account?.id`. Das Parent-
  // Component (pages/account.tsx) baut das account-Objekt inline auf jedem
  // Render neu auf, wodurch eine Dependency auf `account` selbst diesen
  // Effect bei jedem Eltern-Render feuern würde — und damit auch frisch
  // geladene Crawler-Vorschläge sofort wieder leise weg-wischen würde,
  // während der Toast stehen bleibt ("er sagt er hat es gecrawled aber
  // hat es nicht gecrawled"-Bug).
  useEffect(() => {
    if (open) {
      setName(account?.name ?? "");
      setIndustry(account?.industry ?? "");
      setCountry(account?.country ?? "");
      setHealthScore(account?.healthScore !== undefined ? String(account.healthScore) : "");
      setWebsite(account?.website ?? "");
      setPhone(account?.phone ?? "");
      setBillingAddress(account?.billingAddress ?? "");
      setVatId(account?.vatId ?? "");
      setSizeBracket(account?.sizeBracket ?? "");
      setSuggestion(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id]);

  const onEnrich = async () => {
    const w = website.trim();
    if (!w) {
      toast({ title: "Website fehlt", description: "Bitte eine URL oder Domain eintragen.", variant: "destructive" });
      return;
    }
    try {
      const res = await enrich.mutateAsync({ data: { website: w } });

      // Leere Form-Felder werden direkt befüllt — sonst denkt der User, der
      // Crawler hätte gelogen ("er sagt er hat es gecrawled aber hat es
      // nicht gecrawled"). Felder, die der User schon ausgefüllt hat und
      // die vom Crawler abweichen, kommen weiter in den Vorschlags-Panel
      // zum manuellen Übernehmen — wir wollen keine Eingaben überschreiben.
      const applied: string[] = [];
      const conflicts: string[] = [];
      const conflictSuggestion: AccountEnrichmentSuggestion = {
        name: null, country: null, billingAddress: null,
        phone: null, vatId: null, legalEntityName: null, sourceUrl: res.sourceUrl ?? null,
      };

      // Normalisierung pro Feldtyp, damit semantisch gleiche Werte nicht
      // als Konflikt markiert werden (z.B. "DE" vs "de" beim Land,
      // unterschiedliche Whitespace-/Punkt-Schreibweisen bei VAT/Telefon).
      const normCountry = (s: string) => s.trim().toUpperCase();
      const normVatId = (s: string) => s.replace(/[\s.\-/]/g, "").toUpperCase();
      const normPhone = (s: string) => s.replace(/[\s().\-/]/g, "");
      const normPlain = (s: string) => s.trim();

      const consider = (
        label: string,
        suggested: string | null | undefined,
        current: string,
        apply: (v: string) => void,
        conflictKey: keyof AccountEnrichmentSuggestion,
        normalize: (s: string) => string = normPlain,
      ) => {
        const s = (suggested ?? "").trim();
        if (!s) return;
        if (!current.trim()) {
          apply(s);
          applied.push(label);
        } else if (normalize(s) !== normalize(current)) {
          conflicts.push(label);
          (conflictSuggestion[conflictKey] as string) = s;
        }
      };

      consider("Name", res.name, name, setName, "name");
      consider("Land", res.country, country, setCountry, "country", normCountry);
      consider("Adresse", res.billingAddress, billingAddress, setBillingAddress, "billingAddress");
      consider("Telefon", res.phone, phone, setPhone, "phone", normPhone);
      consider("USt-ID", res.vatId, vatId, setVatId, "vatId", normVatId);
      // Firmierung hat kein eigenes Form-Feld — nur als Info im Panel.
      const hasLegalHint = Boolean(res.legalEntityName);
      if (hasLegalHint) {
        conflictSuggestion.legalEntityName = res.legalEntityName ?? null;
      }

      const hasConflicts = conflicts.length > 0 || hasLegalHint;
      setSuggestion(hasConflicts ? conflictSuggestion : null);

      if (applied.length === 0 && conflicts.length === 0 && !hasLegalHint) {
        toast({
          title: "Keine Daten gefunden",
          description: "Zu dieser Website konnten wir nichts aus Impressum oder öffentlichen Quellen ableiten.",
        });
      } else if (applied.length > 0 && conflicts.length === 0 && !hasLegalHint) {
        toast({
          title: "Felder ergänzt",
          description: applied.join(", ") + " automatisch übernommen.",
        });
      } else if (applied.length > 0 && conflicts.length > 0) {
        toast({
          title: "Teilweise übernommen",
          description: `${applied.join(", ")} ergänzt. ${conflicts.join(", ")} weicht ab — bitte prüfen.`,
        });
      } else if (conflicts.length > 0) {
        toast({
          title: "Vorschläge weichen ab",
          description: `${conflicts.join(", ")} ${conflicts.length === 1 ? "weicht" : "weichen"} von deiner Eingabe ab — bitte prüfen.`,
        });
      } else {
        // Nur legalEntityName-Hinweis ohne Konflikte und/oder ohne übernommene Felder.
        toast({
          title: applied.length > 0 ? "Felder ergänzt" : "Hinweis aus dem Web",
          description: applied.length > 0
            ? `${applied.join(", ")} übernommen. Zusätzlich Firmierung gefunden.`
            : `Im Impressum gefunden: Firmierung „${res.legalEntityName}".`,
        });
      }
    } catch (e) {
      toast({
        title: "Anreicherung fehlgeschlagen",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    }
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    // Im Konflikt-Modus überschreibt Übernehmen jetzt explizit die User-
    // Eingabe mit dem Web-Vorschlag.
    if (suggestion.name) setName(suggestion.name);
    if (suggestion.country) setCountry(suggestion.country);
    if (suggestion.billingAddress) setBillingAddress(suggestion.billingAddress);
    if (suggestion.phone) setPhone(suggestion.phone);
    if (suggestion.vatId) setVatId(suggestion.vatId);
    setSuggestion(null);
    toast({ title: "Vorschläge übernommen" });
  };

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
        const patch: AccountPatch = {};
        if (trimmedName !== account.name) patch.name = trimmedName;
        if (trimmedIndustry !== account.industry) patch.industry = trimmedIndustry;
        if (trimmedCountry !== account.country) patch.country = trimmedCountry;
        const hs = healthScore.trim() === "" ? undefined : Number(healthScore);
        if (hs !== undefined && !Number.isNaN(hs) && hs !== account.healthScore) patch.healthScore = hs;
        const w = website.trim();
        if (w !== (account.website ?? "")) patch.website = w || null;
        const p = phone.trim();
        if (p !== (account.phone ?? "")) patch.phone = p || null;
        const ba = billingAddress.trim();
        if (ba !== (account.billingAddress ?? "")) patch.billingAddress = ba || null;
        const v = vatId.trim();
        if (v !== (account.vatId ?? "")) patch.vatId = v || null;
        if ((sizeBracket || "") !== (account.sizeBracket ?? "")) patch.sizeBracket = sizeBracket || null;
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
        const data: AccountInput = {
          name: trimmedName, industry: trimmedIndustry, country: trimmedCountry,
          website: website.trim() || null,
          phone: phone.trim() || null,
          billingAddress: billingAddress.trim() || null,
          vatId: vatId.trim() || null,
          sizeBracket: sizeBracket || null,
        };
        const result = await create.mutateAsync({ data });
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="account-form-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Kunde bearbeiten" : "Kunde anlegen"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Aktualisiere Stammdaten dieses Kunden."
              : "Lege einen neuen B2B-Kunden mit Stammdaten an. Optional Website prüfen, um Adresse, Telefon und USt-ID automatisch zu ergänzen."}
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

          {/* Website + Anreichern */}
          <div className="space-y-2">
            <Label htmlFor="acc-website">Website</Label>
            <div className="flex gap-2">
              <Input
                id="acc-website"
                data-testid="account-form-website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="z.B. https://acme.de"
                disabled={pending || enrich.isPending}
              />
              <Button
                type="button"
                variant="outline"
                onClick={onEnrich}
                disabled={enrich.isPending || !website.trim()}
                data-testid="account-form-enrich"
              >
                {enrich.isPending
                  ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  : <Sparkles className="h-4 w-4 mr-1" />}
                Website prüfen
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Ruft Adresse, USt-ID und Telefon aus Impressum / öffentlichen Quellen ab.
            </p>
          </div>

          {/* Vorschläge anzeigen */}
          {suggestion && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="account-form-suggestion">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Vorschläge aus dem Web
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setSuggestion(null)} aria-label="Vorschläge verwerfen">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {suggestion.name && <div><span className="text-muted-foreground">Name:</span> {suggestion.name}</div>}
                {suggestion.legalEntityName && <div><span className="text-muted-foreground">Firmierung:</span> {suggestion.legalEntityName}</div>}
                {suggestion.country && <div><span className="text-muted-foreground">Land:</span> {suggestion.country}</div>}
                {suggestion.phone && <div><span className="text-muted-foreground">Telefon:</span> {suggestion.phone}</div>}
                {suggestion.vatId && <div><span className="text-muted-foreground">USt-ID:</span> {suggestion.vatId}</div>}
                {suggestion.billingAddress && <div className="col-span-2"><span className="text-muted-foreground">Adresse:</span> {suggestion.billingAddress}</div>}
                {suggestion.sourceUrl && <div className="col-span-2 text-muted-foreground italic">Quelle: {suggestion.sourceUrl}</div>}
              </div>
              <Button type="button" size="sm" onClick={applySuggestion} data-testid="account-form-apply-suggestion">
                <Check className="h-3.5 w-3.5 mr-1" /> Übernehmen
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="acc-phone">Telefon</Label>
              <Input
                id="acc-phone"
                data-testid="account-form-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+49 30 1234567"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="acc-vatid">USt-IdNr.</Label>
              <Input
                id="acc-vatid"
                data-testid="account-form-vatid"
                value={vatId}
                onChange={(e) => setVatId(e.target.value)}
                placeholder="DE123456789"
                disabled={pending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="acc-address">Rechnungsadresse</Label>
            <Textarea
              id="acc-address"
              data-testid="account-form-address"
              rows={2}
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              placeholder="Musterstraße 1, 10115 Berlin"
              disabled={pending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="acc-size">Mitarbeitergröße</Label>
              <Select value={sizeBracket || "_unset"} onValueChange={(v) => setSizeBracket(v === "_unset" ? "" : v)}>
                <SelectTrigger id="acc-size" data-testid="account-form-size">
                  <SelectValue placeholder="Wählen…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_unset">— nicht gesetzt —</SelectItem>
                  {SIZE_BRACKETS.map((s) => (
                    <SelectItem key={s} value={s}>{s} Mitarbeiter</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
          </div>

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

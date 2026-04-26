import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateBrand,
  useUpdateBrand,
  useListBrands,
  useListContractTypes,
  getListBrandsQueryKey,
  type Brand,
  type Company,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { fetchUploadUrlWithRetry } from "@/lib/upload-retry";
import { Loader2, Upload, Image as ImageIcon, X, Sparkles } from "lucide-react";
import { extractLogoColors, foregroundFor, isTooLightForPaper } from "@/lib/extract-logo-colors";
import { toAssetSrc } from "@/lib/asset-url";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: Company[];
  /** Optional vorausgewählte Gesellschaft. */
  defaultCompanyId?: string;
  /** Falls gesetzt: Edit-Modus, sonst Create. */
  brand?: Brand | null;
}

const TONES: Array<{ value: string; label: string; hint: string }> = [
  { value: "precise",  label: "Precise",  hint: "Sachlich, klar, faktenorientiert." },
  { value: "premium",  label: "Premium",  hint: "Wertig, zurückhaltend, exklusiv." },
  { value: "concise",  label: "Concise",  hint: "Knapp, ergebnisorientiert, ohne Floskeln." },
  { value: "bold",     label: "Bold",     hint: "Selbstbewusst, akzentuiert, plakativ." },
];

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_LOGO_MIME = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const NO_PARENT = "_none_";
const NO_CONTRACT_TYPE = "_none_";

/**
 * Parse a stored addressLine like "Siegmund-Hiepe-Str. 28-32, 35578 Wetzlar"
 * into { street, postalCode, city }. Uses the LAST comma as separator so that
 * commas in the street part (rare, but possible) don't break parsing.
 * Falls back gracefully when the input is empty or doesn't match the pattern.
 */
export function parseAddressLine(addressLine: string): { street: string; postalCode: string; city: string } {
  const raw = (addressLine ?? "").trim();
  if (!raw) return { street: "", postalCode: "", city: "" };
  const lastComma = raw.lastIndexOf(",");
  if (lastComma < 0) {
    // No comma — treat the whole string as street.
    return { street: raw, postalCode: "", city: "" };
  }
  const street = raw.slice(0, lastComma).trim();
  const tail = raw.slice(lastComma + 1).trim();
  // Try "PLZ Ort" — leading digits followed by whitespace and the rest.
  const m = tail.match(/^(\d+)\s+(.+)$/);
  if (m) return { street, postalCode: m[1], city: m[2].trim() };
  if (/^\d+$/.test(tail)) return { street, postalCode: tail, city: "" };
  return { street, postalCode: "", city: tail };
}

/** Compose three fields back into the single addressLine the API expects. */
export function composeAddressLine(street: string, postalCode: string, city: string): string {
  const s = street.trim();
  const plzCity = [postalCode.trim(), city.trim()].filter(Boolean).join(" ");
  return [s, plzCity].filter(Boolean).join(", ");
}

export function BrandFormDialog({ open, onOpenChange, companies, defaultCompanyId, brand }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateBrand();
  const updateMut = useUpdateBrand();
  const { data: allBrands } = useListBrands();
  const { data: contractTypes } = useListContractTypes();
  const isEdit = !!brand;

  const [companyId, setCompanyId] = useState(defaultCompanyId ?? companies[0]?.id ?? "");
  const [parentBrandId, setParentBrandId] = useState<string>(NO_PARENT);
  const [name, setName] = useState("");
  const [tone, setTone] = useState("precise");
  const [primaryColor, setPrimaryColor] = useState("#2D6CDF");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [legalEntityName, setLegalEntityName] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [defaultContractTypeId, setDefaultContractTypeId] = useState<string>(NO_CONTRACT_TYPE);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [primaryTouched, setPrimaryTouched] = useState(false);
  const [secondaryTouched, setSecondaryTouched] = useState(false);
  const [colorsExtracted, setColorsExtracted] = useState<{ primary: string; secondary: string | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const primaryTouchedRef = useRef(false);
  const secondaryTouchedRef = useRef(false);
  const uploadTokenRef = useRef(0);

  useEffect(() => {
    if (open) {
      setCompanyId(brand?.companyId ?? defaultCompanyId ?? companies[0]?.id ?? "");
      setParentBrandId(brand?.parentBrandId ?? NO_PARENT);
      setName(brand?.name ?? "");
      setTone(brand?.tone ?? brand?.voice ?? "precise");
      setPrimaryColor(brand?.primaryColor ?? brand?.color ?? "#2D6CDF");
      setSecondaryColor(brand?.secondaryColor ?? "");
      setLegalEntityName(brand?.legalEntityName ?? "");
      const parsed = parseAddressLine(brand?.addressLine ?? "");
      setStreet(parsed.street);
      setPostalCode(parsed.postalCode);
      setCity(parsed.city);
      setLogoUrl(brand?.logoUrl ?? "");
      setDefaultContractTypeId(brand?.defaultContractTypeId ?? NO_CONTRACT_TYPE);
      setPrimaryTouched(false);
      setSecondaryTouched(false);
      primaryTouchedRef.current = false;
      secondaryTouchedRef.current = false;
      setColorsExtracted(null);
    }
  }, [open, defaultCompanyId, companies, brand]);

  // Kandidaten für Parent-Brand: gleiche Company, nicht das Brand selbst,
  // und keine Brands die dieses Brand als (transitiven) Eltern haben — sonst
  // entsteht ein Zyklus. Backend schützt zusätzlich (lib/brands.ts).
  const parentCandidates = (allBrands ?? []).filter((b) => {
    if (b.companyId !== companyId) return false;
    if (brand && b.id === brand.id) return false;
    if (brand) {
      // Walk up b.parentBrandId chain — if we hit `brand.id`, b is a descendant.
      let cur: string | null | undefined = b.parentBrandId;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        if (cur === brand.id) return false;
        seen.add(cur);
        cur = (allBrands ?? []).find((x) => x.id === cur)?.parentBrandId;
      }
    }
    return true;
  });

  const onUpload = async (file: File) => {
    if (!ALLOWED_LOGO_MIME.includes(file.type)) {
      toast({ title: "Format nicht unterstützt", description: `${file.name || "Datei"} — erlaubt: PNG, JPEG, SVG, WebP.`, variant: "destructive" });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({ title: "Logo zu groß", description: `${(file.size / 1024 / 1024).toFixed(1)} MB — Maximum 5 MB.`, variant: "destructive" });
      return;
    }
    setUploading(true);
    const myToken = ++uploadTokenRef.current;
    const colorsPromise = extractLogoColors(file).catch(() => null);
    const applyColors = async () => {
      const colors = await colorsPromise;
      if (myToken !== uploadTokenRef.current) return;
      if (!colors) return;
      setColorsExtracted(colors);
      if (!primaryTouchedRef.current) setPrimaryColor(colors.primary);
      if (!secondaryTouchedRef.current && colors.secondary) setSecondaryColor(colors.secondary);
    };
    try {
      const res = await fetchUploadUrlWithRetry(
        `${import.meta.env.BASE_URL}api/storage/uploads/request-url`,
        {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type, kind: "logo" }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const serverMsg =
          (body as { message?: string; error?: string })?.message
          ?? (body as { error?: string })?.error;
        const msg = serverMsg
          ?? (res.status === 401 ? "Sitzung abgelaufen — bitte neu anmelden."
              : res.status === 403 ? "Nur Tenant-Admins dürfen Logos hochladen."
              : (res.status === 502 || res.status === 503 || res.status === 504)
                ? "Server kurz nicht erreichbar. Bitte in wenigen Sekunden erneut versuchen."
                : `Upload-URL fehlgeschlagen (${res.status})`);
        throw new Error(msg);
      }
      const { uploadURL, objectPath } = await res.json();
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`Upload fehlgeschlagen (${put.status})`);
      if (myToken === uploadTokenRef.current) {
        setLogoUrl(`/api/storage${objectPath}`);
      }
      await applyColors();
    } catch (e: unknown) {
      await applyColors();
      toast({ title: "Logo-Upload fehlgeschlagen", description: e instanceof Error ? e.message : "Unbekannt", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void onUpload(f);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void onUpload(f);
  };

  const submit = async () => {
    if (!companyId) {
      toast({ title: "Gesellschaft wählen", description: "Ein Brand muss einer Gesellschaft zugeordnet sein.", variant: "destructive" });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: "Name fehlt", variant: "destructive" });
      return;
    }
    if (!HEX_RE.test(primaryColor)) {
      toast({ title: "Primärfarbe ungültig", description: "Bitte #RRGGBB.", variant: "destructive" });
      return;
    }
    if (secondaryColor && !HEX_RE.test(secondaryColor)) {
      toast({ title: "Sekundärfarbe ungültig", description: "Bitte #RRGGBB oder leer lassen.", variant: "destructive" });
      return;
    }
    const parent = parentBrandId === NO_PARENT ? null : parentBrandId;
    const ctDefault = defaultContractTypeId === NO_CONTRACT_TYPE ? null : defaultContractTypeId;
    const composedAddress = composeAddressLine(street, postalCode, city);
    try {
      if (isEdit && brand) {
        await updateMut.mutateAsync({
          id: brand.id,
          data: {
            name: trimmed,
            color: primaryColor,
            voice: tone,
            tone,
            primaryColor,
            secondaryColor: secondaryColor || null,
            legalEntityName: legalEntityName.trim() || null,
            addressLine: composedAddress || null,
            logoUrl: logoUrl.trim() || null,
            parentBrandId: parent,
            defaultContractTypeId: ctDefault,
          },
        });
        toast({ title: "Brand aktualisiert", description: trimmed });
      } else {
        await createMut.mutateAsync({
          data: {
            companyId,
            parentBrandId: parent,
            name: trimmed,
            color: primaryColor,
            voice: tone,
            tone,
            primaryColor,
            secondaryColor: secondaryColor || null,
            legalEntityName: legalEntityName.trim() || null,
            addressLine: composedAddress || null,
            logoUrl: logoUrl.trim() || null,
            defaultContractTypeId: ctDefault,
          },
        });
        toast({ title: "Brand angelegt", description: trimmed });
      }
      await qc.invalidateQueries({ queryKey: getListBrandsQueryKey() });
      onOpenChange(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: status === 409 ? "Name bereits vergeben" : isEdit ? "Speichern fehlgeschlagen" : "Anlegen fehlgeschlagen",
        description: body?.error ?? (e instanceof Error ? e.message : "Unbekannter Fehler"),
        variant: "destructive",
      });
    }
  };

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Brand bearbeiten" : "Neuen Brand anlegen"}</DialogTitle>
          <DialogDescription>
            Markenauftritt einer Gesellschaft — bestimmt Logo, Farben, Tonalität und juristisches Impressum
            in generierten Angeboten und Verträgen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="brand-company">Gesellschaft *</Label>
            <Select value={companyId} onValueChange={setCompanyId} disabled={isEdit}>
              <SelectTrigger id="brand-company" data-testid="select-brand-company">
                <SelectValue>{companies.find(c => c.id === companyId)?.name ?? "Wählen…"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id} textValue={c.name}>
                    <div className="flex flex-col">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.legalName} · {c.country} · {c.currency}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit && <p className="text-xs text-muted-foreground">Gesellschaft eines bestehenden Brands kann nicht gewechselt werden.</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-parent">Eltern-Marke</Label>
            <Select value={parentBrandId} onValueChange={setParentBrandId}>
              <SelectTrigger id="brand-parent" data-testid="select-brand-parent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>— Keine (Top-Level) —</SelectItem>
                {parentCandidates.map((b) => (
                  <SelectItem key={b.id} value={b.id} textValue={b.name}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Optional — Sub-Brand unter einer übergeordneten Marke (z. B. WFS → weCREATE).</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-name">Brand-Name *</Label>
            <Input id="brand-name" value={name} onChange={e => setName(e.target.value)} placeholder="z. B. Helix Premium" data-testid="input-brand-name" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-tone">Tonalität</Label>
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger id="brand-tone" data-testid="select-brand-tone">
                <SelectValue>{TONES.find(t => t.value === tone)?.label ?? tone}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TONES.map(opt => (
                  <SelectItem key={opt.value} value={opt.value} textValue={opt.label}>
                    <div className="flex flex-col">
                      <span className="font-medium">{opt.label}</span>
                      <span className="text-xs text-muted-foreground">{opt.hint}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Steuert Ansprache und Wortwahl in generierten Texten.</p>
          </div>

          {/* Logo */}
          <div className="space-y-1.5">
            <Label>Logo</Label>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative cursor-pointer rounded-md border-2 border-dashed transition-colors ${
                dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-muted-foreground/60"
              }`}
              data-testid="brand-logo-dropzone"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ALLOWED_LOGO_MIME.join(",")}
                className="hidden"
                disabled={uploading}
                onChange={onFileInput}
              />
              <div className="flex items-center gap-4 p-4">
                {logoUrl ? (
                  <div className="flex-shrink-0 h-24 w-24 rounded-md border bg-white p-2 flex items-center justify-center">
                    <img src={toAssetSrc(logoUrl)} alt="Logo-Vorschau" className="max-h-full max-w-full object-contain" />
                  </div>
                ) : (
                  <div className="flex-shrink-0 h-24 w-24 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-8 w-8" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {uploading ? (
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Wird hochgeladen…
                    </p>
                  ) : logoUrl ? (
                    <>
                      <p className="text-sm font-medium">Logo geladen</p>
                      <p className="text-xs text-muted-foreground mt-1">Klicken oder Datei ziehen, um zu ersetzen.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">Datei hierher ziehen oder klicken</p>
                      <p className="text-xs text-muted-foreground mt-1">PNG, JPEG, SVG, WebP — bis 5 MB</p>
                    </>
                  )}
                </div>
                {logoUrl && !uploading && (
                  <Button type="button" size="sm" variant="ghost"
                    onClick={(e) => { e.stopPropagation(); setLogoUrl(""); setColorsExtracted(null); }}
                    aria-label="Logo entfernen">
                    <X className="h-4 w-4" />
                  </Button>
                )}
                {!logoUrl && !uploading && (
                  <Button type="button" size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                    <Upload className="h-4 w-4 mr-1" />
                    Hochladen
                  </Button>
                )}
              </div>
              {logoUrl && !uploading && (
                <div className="border-t grid grid-cols-2 gap-px bg-muted/30">
                  <div className="bg-white p-3 flex items-center justify-center gap-2" title="Wirkung auf weißem Papier (DIN A4)">
                    <img src={toAssetSrc(logoUrl)} alt="" className="h-8 w-8 object-contain" />
                    <span className="px-2 py-1 rounded text-xs font-medium" style={{ background: primaryColor || "#ffffff", color: foregroundFor(primaryColor || "#ffffff") }}>
                      auf Weiß
                    </span>
                  </div>
                  <div className="bg-slate-900 p-3 flex items-center justify-center gap-2" title="Wirkung auf dunklem Header (App)">
                    <img src={toAssetSrc(logoUrl)} alt="" className="h-8 w-8 object-contain" />
                    <span className="px-2 py-1 rounded text-xs font-medium" style={{ background: primaryColor || "#ffffff", color: foregroundFor(primaryColor || "#ffffff") }}>
                      auf Dunkel
                    </span>
                  </div>
                </div>
              )}
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">URL manuell eintragen…</summary>
              <Input
                value={logoUrl}
                onChange={e => setLogoUrl(e.target.value)}
                placeholder="https://… / /api/storage/objects/…"
                className="mt-1 font-mono"
              />
            </details>

            {colorsExtracted && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="brand-colors-extracted">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span>Farben aus Logo abgeleitet — du kannst sie unten anpassen.</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="brand-primary">Primärfarbe</Label>
              <div className="flex gap-2">
                <Input
                  id="brand-primary"
                  type="color"
                  value={HEX_RE.test(primaryColor) ? primaryColor : "#2D6CDF"}
                  onChange={e => { setPrimaryColor(e.target.value); setPrimaryTouched(true); primaryTouchedRef.current = true; }}
                  className="w-14 p-1"
                />
                <Input
                  value={primaryColor}
                  onChange={e => { setPrimaryColor(e.target.value); setPrimaryTouched(true); primaryTouchedRef.current = true; }}
                  className="flex-1"
                />
              </div>
              {isTooLightForPaper(primaryColor || "#ffffff") && (
                <p className="text-xs text-amber-700">⚠ Sehr hell — auf weißem Papier kaum sichtbar.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-secondary">Sekundärfarbe (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="brand-secondary"
                  type="color"
                  value={HEX_RE.test(secondaryColor) ? secondaryColor : "#000000"}
                  onChange={e => { setSecondaryColor(e.target.value); setSecondaryTouched(true); secondaryTouchedRef.current = true; }}
                  className="w-14 p-1"
                />
                <Input
                  value={secondaryColor}
                  onChange={e => { setSecondaryColor(e.target.value); setSecondaryTouched(true); secondaryTouchedRef.current = true; }}
                  className="flex-1"
                  placeholder="leer = nur Primärfarbe"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-default-contract-type">Standard-Vertragstyp</Label>
            <Select value={defaultContractTypeId} onValueChange={setDefaultContractTypeId}>
              <SelectTrigger id="brand-default-contract-type" data-testid="select-brand-default-contract-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONTRACT_TYPE}>— Heuristik aus Template-Name —</SelectItem>
                {(contractTypes ?? []).filter(ct => ct.active !== false).map(ct => (
                  <SelectItem key={ct.id} value={ct.id} textValue={ct.name}>
                    <div className="flex flex-col">
                      <span className="font-medium">{ct.name}</span>
                      <span className="text-xs text-muted-foreground">{ct.code}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Wird in „Vertrag erstellen" verwendet, wenn kein Vertragstyp explizit gewählt wurde — bevor die
              Schlagwort-Heuristik aus dem Templatenamen greift.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-legal">Juristischer Name (Impressum)</Label>
            <Input id="brand-legal" value={legalEntityName} onChange={e => setLegalEntityName(e.target.value)} placeholder="z. B. Helix Logistics GmbH" />
          </div>
          <div className="space-y-1.5">
            <Label>Adresse (Impressum)</Label>
            <Input
              id="brand-street"
              value={street}
              onChange={e => setStreet(e.target.value)}
              placeholder="Straße / Hausnummer (z. B. Musterstraße 1)"
              data-testid="input-brand-street"
              aria-label="Straße und Hausnummer"
            />
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <Input
                id="brand-postal-code"
                value={postalCode}
                onChange={e => setPostalCode(e.target.value)}
                placeholder="PLZ"
                data-testid="input-brand-postal-code"
                aria-label="Postleitzahl"
                inputMode="numeric"
              />
              <Input
                id="brand-city"
                value={city}
                onChange={e => setCity(e.target.value)}
                placeholder="Ort"
                data-testid="input-brand-city"
                aria-label="Ort"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Abbrechen</Button>
          <Button onClick={submit} disabled={busy || uploading} data-testid="button-brand-submit">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Speichern" : "Anlegen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

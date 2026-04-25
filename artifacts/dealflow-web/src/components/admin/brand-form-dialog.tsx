import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateBrand,
  getListBrandsQueryKey,
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
import { Loader2, Upload, Image as ImageIcon, X, Sparkles } from "lucide-react";
import { extractLogoColors } from "@/lib/extract-logo-colors";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  companies: Company[];
  /** Optional vorausgewählte Gesellschaft. */
  defaultCompanyId?: string;
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

export function BrandFormDialog({ open, onOpenChange, companies, defaultCompanyId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateBrand();

  const [companyId, setCompanyId] = useState(defaultCompanyId ?? companies[0]?.id ?? "");
  const [name, setName] = useState("");
  const [tone, setTone] = useState("precise");
  const [primaryColor, setPrimaryColor] = useState("#2D6CDF");
  const [secondaryColor, setSecondaryColor] = useState("");
  const [legalEntityName, setLegalEntityName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [primaryTouched, setPrimaryTouched] = useState(false);
  const [secondaryTouched, setSecondaryTouched] = useState(false);
  const [colorsExtracted, setColorsExtracted] = useState<{ primary: string; secondary: string | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Refs spiegeln die touched-Flags, damit der asynchrone Upload-Handler beim
  // Anwenden der extrahierten Farben den jeweils aktuellen Stand sieht — und
  // nicht den, der beim Drop in die Closure capture-d wurde. Sonst könnte ein
  // Color-Picker-Edit während des Uploads von der Auto-Extraction überschrieben werden.
  const primaryTouchedRef = useRef(false);
  const secondaryTouchedRef = useRef(false);
  // Monoton steigender Token, damit bei mehreren parallelen Uploads (User dropt
  // schnell ein zweites Logo) nur der jüngste Lauf das State-Update gewinnt.
  const uploadTokenRef = useRef(0);

  useEffect(() => {
    if (open) {
      setCompanyId(defaultCompanyId ?? companies[0]?.id ?? "");
      setName("");
      setTone("precise");
      setPrimaryColor("#2D6CDF");
      setSecondaryColor("");
      setLegalEntityName("");
      setAddressLine("");
      setLogoUrl("");
      setPrimaryTouched(false);
      setSecondaryTouched(false);
      primaryTouchedRef.current = false;
      secondaryTouchedRef.current = false;
      setColorsExtracted(null);
    }
  }, [open, defaultCompanyId, companies]);

  const onUpload = async (file: File) => {
    if (!ALLOWED_LOGO_MIME.includes(file.type)) {
      toast({
        title: "Format nicht unterstützt",
        description: `${file.name || "Datei"} — erlaubt: PNG, JPEG, SVG, WebP.`,
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({
        title: "Logo zu groß",
        description: `${(file.size / 1024 / 1024).toFixed(1)} MB — Maximum 5 MB.`,
        variant: "destructive",
      });
      return;
    }
    setUploading(true);
    const myToken = ++uploadTokenRef.current;
    // Farben asynchron aus dem File ableiten — independent vom Upload, damit
    // der User selbst bei Upload-Fehlschlag eine Farbpalette bekommt.
    const colorsPromise = extractLogoColors(file).catch(() => null);
    // Helper: Farben anwenden, falls dieser Lauf noch der jüngste ist.
    const applyColors = async () => {
      const colors = await colorsPromise;
      if (myToken !== uploadTokenRef.current) return;
      if (!colors) return;
      setColorsExtracted(colors);
      if (!primaryTouchedRef.current) setPrimaryColor(colors.primary);
      if (!secondaryTouchedRef.current && colors.secondary) setSecondaryColor(colors.secondary);
    };
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/storage/uploads/request-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type,
          kind: "logo",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: string })?.error
          ?? (res.status === 401 ? "Sitzung abgelaufen — bitte neu anmelden."
              : res.status === 403 ? "Nur Tenant-Admins dürfen Logos hochladen."
              : `Upload-URL fehlgeschlagen (${res.status})`);
        throw new Error(msg);
      }
      const { uploadURL, objectPath } = await res.json();
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload fehlgeschlagen (${put.status})`);
      if (myToken === uploadTokenRef.current) {
        setLogoUrl(`/api/storage${objectPath}`);
      }
      await applyColors();
    } catch (e: unknown) {
      // Farben trotzdem anwenden — der lokale Browser konnte sie ableiten,
      // auch wenn der Server-Upload daneben ging.
      await applyColors();
      toast({
        title: "Logo-Upload fehlgeschlagen",
        description: e instanceof Error ? e.message : "Unbekannt",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) void onUpload(f);
    // Eingabe leeren, damit dieselbe Datei erneut gewählt werden kann
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
    try {
      await createMut.mutateAsync({
        data: {
          companyId,
          name: trimmed,
          color: primaryColor,
          voice: tone,
          tone,
          primaryColor,
          secondaryColor: secondaryColor || null,
          legalEntityName: legalEntityName.trim() || null,
          addressLine: addressLine.trim() || null,
          logoUrl: logoUrl.trim() || null,
        },
      });
      await qc.invalidateQueries({ queryKey: getListBrandsQueryKey() });
      toast({ title: "Brand angelegt", description: trimmed });
      onOpenChange(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: status === 409 ? "Name bereits vergeben" : "Anlegen fehlgeschlagen",
        description: body?.error ?? (e instanceof Error ? e.message : "Unbekannter Fehler"),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Neuen Brand anlegen</DialogTitle>
          <DialogDescription>
            Markenauftritt einer Gesellschaft — bestimmt Logo, Farben, Tonalität und juristisches Impressum
            in generierten Angeboten und Verträgen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="brand-company">Gesellschaft *</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
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

          {/* Logo: Drag-&-Drop oder klassisches Hochladen */}
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
              <div className="flex items-center gap-3 p-4">
                {logoUrl ? (
                  <img src={logoUrl} alt="Logo-Vorschau" className="h-14 w-14 object-contain rounded border bg-white p-1" />
                ) : (
                  <div className="h-14 w-14 rounded bg-muted flex items-center justify-center text-muted-foreground">
                    <ImageIcon className="h-6 w-6" />
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
                      <p className="text-sm font-medium truncate">Logo geladen</p>
                      <p className="text-xs text-muted-foreground truncate">{logoUrl}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">
                        Datei hierher ziehen oder klicken
                      </p>
                      <p className="text-xs text-muted-foreground">
                        PNG, JPEG, SVG, WebP — bis 5 MB
                      </p>
                    </>
                  )}
                </div>
                {logoUrl && !uploading && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={(e) => { e.stopPropagation(); setLogoUrl(""); setColorsExtracted(null); }}
                    aria-label="Logo entfernen"
                  >
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
            </div>

            {/* Manuelle URL-Eingabe als Fallback (z. B. CDN-Link) */}
            <Input
              value={logoUrl}
              onChange={e => setLogoUrl(e.target.value)}
              placeholder="…oder URL eintragen: https://… / /api/storage/objects/…"
              className="text-xs"
            />

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
                  value={primaryColor}
                  onChange={e => { setPrimaryColor(e.target.value); setPrimaryTouched(true); primaryTouchedRef.current = true; }}
                  className="w-14 p-1"
                />
                <Input
                  value={primaryColor}
                  onChange={e => { setPrimaryColor(e.target.value); setPrimaryTouched(true); primaryTouchedRef.current = true; }}
                  className="flex-1"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-secondary">Sekundärfarbe (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="brand-secondary"
                  type="color"
                  value={secondaryColor || "#000000"}
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
            <Label htmlFor="brand-legal">Juristischer Name (Impressum)</Label>
            <Input id="brand-legal" value={legalEntityName} onChange={e => setLegalEntityName(e.target.value)} placeholder="z. B. Helix Logistics GmbH" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand-address">Adresszeile (Impressum)</Label>
            <Input id="brand-address" value={addressLine} onChange={e => setAddressLine(e.target.value)} placeholder="Musterstraße 1, 10115 Berlin" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createMut.isPending}>Abbrechen</Button>
          <Button onClick={submit} disabled={createMut.isPending || uploading} data-testid="button-brand-submit">
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
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
import { Loader2, Upload } from "lucide-react";

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
    }
  }, [open, defaultCompanyId, companies]);

  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/storage/uploads/request-url`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) throw new Error(`upload URL failed (${res.status})`);
      const { uploadURL, objectPath } = await res.json();
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`PUT failed (${put.status})`);
      setLogoUrl(`/api/storage${objectPath}`);
    } catch (e: unknown) {
      toast({ title: "Logo-Upload fehlgeschlagen", description: e instanceof Error ? e.message : "Unbekannt", variant: "destructive" });
    } finally {
      setUploading(false);
    }
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="brand-primary">Primärfarbe</Label>
              <div className="flex gap-2">
                <Input id="brand-primary" type="color" value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="w-14 p-1" />
                <Input value={primaryColor} onChange={e => setPrimaryColor(e.target.value)} className="flex-1" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-secondary">Sekundärfarbe (optional)</Label>
              <div className="flex gap-2">
                <Input id="brand-secondary" type="color" value={secondaryColor || "#000000"} onChange={e => setSecondaryColor(e.target.value)} className="w-14 p-1" />
                <Input value={secondaryColor} onChange={e => setSecondaryColor(e.target.value)} className="flex-1" placeholder="leer = nur Primärfarbe" />
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

          <div className="space-y-1.5">
            <Label htmlFor="brand-logo">Logo</Label>
            <div className="flex items-center gap-2">
              <Input id="brand-logo" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="/api/storage/objects/… oder https://…" className="flex-1" />
              <label className="inline-flex items-center gap-1 text-sm border rounded-md px-3 py-1.5 cursor-pointer hover:bg-muted">
                <Upload className="h-4 w-4" />
                Hochladen
                <input type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" disabled={uploading}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void onUpload(f); }} />
              </label>
            </div>
            {uploading && <p className="text-xs text-muted-foreground">Wird hochgeladen…</p>}
            {logoUrl && !uploading && (
              <img src={logoUrl} alt="logo preview" className="mt-1 max-h-12 border rounded bg-white p-1" />
            )}
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

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { BrandDocumentTemplates } from "./brand-document-templates";
import { BrandWidgetSettings } from "./brand-widget-settings";
import { BrandNotificationChannelsSettings } from "./brand-notification-channels-settings";

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
  { value: "precise",  label: "Precise",  hint: "Factual, clear, data-driven." },
  { value: "premium",  label: "Premium",  hint: "Refined, understated, exclusive." },
  { value: "concise",  label: "Concise",  hint: "Brief, results-oriented, no fluff." },
  { value: "bold",     label: "Bold",     hint: "Confident, accentuated, punchy." },
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
  const { t } = useTranslation();
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
  // Tax-Default: Modus + (für "custom") freier Eingabewert.
  const [taxRateMode, setTaxRateMode] = useState<"tenant" | "0" | "7" | "19" | "custom">("tenant");
  const [customTaxRate, setCustomTaxRate] = useState<string>("");
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
      const tax = brand?.defaultTaxRatePct;
      if (tax === null || tax === undefined) {
        setTaxRateMode("tenant");
        setCustomTaxRate("");
      } else {
        const n = Number(tax);
        if (n === 0) { setTaxRateMode("0"); setCustomTaxRate(""); }
        else if (n === 7) { setTaxRateMode("7"); setCustomTaxRate(""); }
        else if (n === 19) { setTaxRateMode("19"); setCustomTaxRate(""); }
        else { setTaxRateMode("custom"); setCustomTaxRate(String(tax)); }
      }
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
      toast({ title: t("pages.admin.brandDialog.formatNotSupported"), description: t("pages.admin.brandDialog.formatNotSupportedDesc", { name: file.name || "File" }), variant: "destructive" });
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({ title: t("pages.admin.brandDialog.logoTooLarge"), description: t("pages.admin.brandDialog.logoTooLargeDesc", { size: (file.size / 1024 / 1024).toFixed(1) }), variant: "destructive" });
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
          ?? (res.status === 401 ? t("pages.admin.brandDialog.sessionExpired")
              : res.status === 403 ? t("pages.admin.brandDialog.onlyAdminsCanUpload")
              : (res.status === 502 || res.status === 503 || res.status === 504)
                ? t("pages.admin.brandDialog.serverBriefly")
                : t("pages.admin.brandDialog.uploadUrlFailed", { status: res.status }));
        throw new Error(msg);
      }
      const { uploadURL, objectPath } = await res.json();
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(t("pages.admin.brandDialog.uploadFailedStatus", { status: put.status }));
      if (myToken === uploadTokenRef.current) {
        setLogoUrl(`/api/storage${objectPath}`);
      }
      await applyColors();
    } catch (e: unknown) {
      await applyColors();
      toast({ title: t("pages.admin.logoUploadFailed"), description: e instanceof Error ? e.message : t("pages.admin.brandDialog.unknown"), variant: "destructive" });
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
      toast({ title: t("pages.admin.selectCompanyFirstTitle"), description: t("pages.admin.selectCompanyFirstBody"), variant: "destructive" });
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      toast({ title: t("pages.admin.brandDialog.missingName"), variant: "destructive" });
      return;
    }
    if (!HEX_RE.test(primaryColor)) {
      toast({ title: t("pages.admin.brandDialog.primaryColorInvalid"), description: t("pages.admin.brandDialog.primaryColorInvalidHint"), variant: "destructive" });
      return;
    }
    if (secondaryColor && !HEX_RE.test(secondaryColor)) {
      toast({ title: t("pages.admin.brandDialog.secondaryColorInvalid"), description: t("pages.admin.brandDialog.secondaryColorInvalidHint"), variant: "destructive" });
      return;
    }
    const parent = parentBrandId === NO_PARENT ? null : parentBrandId;
    const ctDefault = defaultContractTypeId === NO_CONTRACT_TYPE ? null : defaultContractTypeId;
    let resolvedTaxRate: number | null;
    if (taxRateMode === "tenant") resolvedTaxRate = null;
    else if (taxRateMode === "custom") {
      const v = parseFloat(customTaxRate.replace(",", "."));
      if (!Number.isFinite(v) || v < 0 || v > 100) {
        toast({ title: "Invalid VAT rate", description: "Please enter 0–100 %.", variant: "destructive" });
        return;
      }
      resolvedTaxRate = Math.round(v * 100) / 100;
    } else {
      resolvedTaxRate = Number(taxRateMode);
    }
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
            defaultTaxRatePct: resolvedTaxRate,
          },
        });
        toast({ title: t("pages.admin.brandUpdated"), description: trimmed });
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
            defaultTaxRatePct: resolvedTaxRate,
          },
        });
        toast({ title: t("pages.admin.brandCreated"), description: trimmed });
      }
      await qc.invalidateQueries({ queryKey: getListBrandsQueryKey() });
      onOpenChange(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: status === 409 ? t("pages.admin.nameTaken") : isEdit ? t("pages.admin.brandDialog.saveFailed") : t("pages.admin.brandDialog.createFailed"),
        description: body?.error ?? (e instanceof Error ? e.message : t("pages.admin.brandDialog.unknownError")),
        variant: "destructive",
      });
    }
  };

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("pages.admin.brandDialog.titleEdit") : t("pages.admin.brandDialog.titleNew")}</DialogTitle>
          <DialogDescription>
            {t("pages.admin.brandDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="brand-company">{t("pages.admin.companyRequired")}</Label>
            <Select value={companyId} onValueChange={setCompanyId} disabled={isEdit}>
              <SelectTrigger id="brand-company" data-testid="select-brand-company">
                <SelectValue>{companies.find(c => c.id === companyId)?.name ?? t("common.select")}</SelectValue>
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
            {isEdit && <p className="text-xs text-muted-foreground">{t("pages.admin.companyLockedHint")}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-parent">{t("pages.admin.brandDialog.parentBrand")}</Label>
            <Select value={parentBrandId} onValueChange={setParentBrandId}>
              <SelectTrigger id="brand-parent" data-testid="select-brand-parent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT}>{t("pages.admin.brandDialog.parentNone")}</SelectItem>
                {parentCandidates.map((b) => (
                  <SelectItem key={b.id} value={b.id} textValue={b.name}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("pages.admin.subBrandHintFull")}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-name">{t("pages.admin.brandNameRequired")}</Label>
            <Input id="brand-name" value={name} onChange={e => setName(e.target.value)} placeholder={t("pages.admin.brandDialog.brandNamePlaceholder")} data-testid="input-brand-name" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-tone">{t("pages.admin.brandDialog.tone")}</Label>
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger id="brand-tone" data-testid="select-brand-tone">
                <SelectValue>{TONES.find(toneOpt => toneOpt.value === tone)?.label ?? tone}</SelectValue>
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
            <p className="text-xs text-muted-foreground">{t("pages.admin.brandDialog.toneHint")}</p>
          </div>

          {/* Logo */}
          <div className="space-y-1.5">
            <Label>{t("pages.admin.brandDialog.logo")}</Label>
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
                    <img src={toAssetSrc(logoUrl)} alt="Logo preview" className="max-h-full max-w-full object-contain" />
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
                      {t("pages.admin.brandDialog.logoUploading")}
                    </p>
                  ) : logoUrl ? (
                    <>
                      <p className="text-sm font-medium">{t("pages.admin.brandDialog.logoLoaded")}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("pages.admin.brandDialog.logoLoadedHint")}</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium">{t("pages.admin.brandDialog.logoDropzone")}</p>
                      <p className="text-xs text-muted-foreground mt-1">{t("pages.admin.brandDialog.logoDropzoneHint")}</p>
                    </>
                  )}
                </div>
                {logoUrl && !uploading && (
                  <Button type="button" size="sm" variant="ghost"
                    onClick={(e) => { e.stopPropagation(); setLogoUrl(""); setColorsExtracted(null); }}
                    aria-label={t("pages.admin.brandDialog.logoRemove")}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
                {!logoUrl && !uploading && (
                  <Button type="button" size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                    <Upload className="h-4 w-4 mr-1" />
                    {t("pages.admin.brandDialog.logoUpload")}
                  </Button>
                )}
              </div>
              {logoUrl && !uploading && (
                <div className="border-t grid grid-cols-2 gap-px bg-muted/30">
                  <div className="bg-white p-3 flex items-center justify-center gap-2">
                    <img src={toAssetSrc(logoUrl)} alt="" className="h-8 w-8 object-contain" />
                    <span className="px-2 py-1 rounded text-xs font-medium" style={{ background: primaryColor || "#ffffff", color: foregroundFor(primaryColor || "#ffffff") }}>
                      {t("pages.admin.brandDialog.logoOnWhite")}
                    </span>
                  </div>
                  <div className="bg-slate-900 p-3 flex items-center justify-center gap-2">
                    <img src={toAssetSrc(logoUrl)} alt="" className="h-8 w-8 object-contain" />
                    <span className="px-2 py-1 rounded text-xs font-medium" style={{ background: primaryColor || "#ffffff", color: foregroundFor(primaryColor || "#ffffff") }}>
                      {t("pages.admin.brandDialog.logoOnDark")}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{t("pages.admin.brandDialog.manualUrl")}</summary>
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
                <span>{t("pages.admin.brandDialog.colorsExtracted")}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="brand-primary">{t("pages.admin.brandDialog.primaryColor")}</Label>
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
                <p className="text-xs text-amber-700">⚠ {t("pages.admin.lightLogoWarning")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="brand-secondary">{t("pages.admin.brandDialog.secondaryColor")}</Label>
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
                  placeholder=""
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-default-contract-type">{t("pages.admin.defaultContractType")}</Label>
            <Select value={defaultContractTypeId} onValueChange={setDefaultContractTypeId}>
              <SelectTrigger id="brand-default-contract-type" data-testid="select-brand-default-contract-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONTRACT_TYPE}>—</SelectItem>
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
              {t("pages.admin.defaultContractTypeHint")}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-default-tax">Default tax rate</Label>
            <Select value={taxRateMode} onValueChange={(v) => setTaxRateMode(v as typeof taxRateMode)}>
              <SelectTrigger id="brand-default-tax" data-testid="select-brand-default-tax">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tenant">— Tenant default —</SelectItem>
                <SelectItem value="19">19 %</SelectItem>
                <SelectItem value="7">7 %</SelectItem>
                <SelectItem value="0">0 %</SelectItem>
                <SelectItem value="custom">Other…</SelectItem>
              </SelectContent>
            </Select>
            {taxRateMode === "custom" && (
              <Input
                value={customTaxRate}
                onChange={(e) => setCustomTaxRate(e.target.value)}
                placeholder="e.g. 5.5"
                inputMode="decimal"
                data-testid="input-brand-default-tax-custom"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Default tax rate for new quote positions of this brand. Can still be overridden per position.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="brand-legal">Legal name (imprint)</Label>
            <Input id="brand-legal" value={legalEntityName} onChange={e => setLegalEntityName(e.target.value)} placeholder="e.g. Helix Logistics GmbH" />
          </div>
          <div className="space-y-1.5">
            <Label>Address (imprint)</Label>
            <Input
              id="brand-street"
              value={street}
              onChange={e => setStreet(e.target.value)}
              placeholder="Street / number"
              data-testid="input-brand-street"
              aria-label="Street and number"
            />
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <Input
                id="brand-postal-code"
                value={postalCode}
                onChange={e => setPostalCode(e.target.value)}
                placeholder="ZIP"
                data-testid="input-brand-postal-code"
                aria-label="ZIP / postal code"
                inputMode="numeric"
              />
              <Input
                id="brand-city"
                value={city}
                onChange={e => setCity(e.target.value)}
                placeholder="City"
                data-testid="input-brand-city"
                aria-label="City"
              />
            </div>
          </div>

          {isEdit && brand && (
            <div className="space-y-2 pt-2 border-t">
              <div>
                <p className="text-sm font-medium">Document templates</p>
                <p className="text-xs text-muted-foreground">
                  Upload a reference PDF per document type — AI extracts the layout (colors, headers,
                  footers, columns, labels) and applies it to newly generated documents of this brand.
                </p>
              </div>
              <BrandDocumentTemplates brandId={brand.id} />
            </div>
          )}

          {isEdit && brand && (
            <div className="space-y-2 pt-2 border-t" data-testid="brand-widget-section">
              <div>
                <p className="text-sm font-medium">Lead widget</p>
                <p className="text-xs text-muted-foreground">
                  Embed a brand-themed contact form on this brand's website. Submissions become leads
                  in this brand's pipeline; optional Cal.com booking + AI summary + owner routing.
                </p>
              </div>
              <BrandWidgetSettings brandId={brand.id} />
            </div>
          )}

          {isEdit && brand && (
            <div className="space-y-2 pt-2 border-t" data-testid="brand-notifications-section">
              <div>
                <p className="text-sm font-medium">Slack & Teams Benachrichtigungen</p>
                <p className="text-xs text-muted-foreground">
                  Verbinde Slack- oder Teams-Channels per Incoming-Webhook. Pro Channel kann ausgewählt
                  werden, welche Lead-Events (neuer Lead, Termin gebucht) eine Nachricht auslösen.
                  Fehler erscheinen im Audit-Log dieser Brand und im Lead-Verlauf.
                </p>
              </div>
              <BrandNotificationChannelsSettings brandId={brand.id} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={busy || uploading} data-testid="button-brand-submit">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

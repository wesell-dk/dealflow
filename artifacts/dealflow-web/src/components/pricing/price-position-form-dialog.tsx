import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePricePosition,
  useUpdatePricePosition,
  useListBrands,
  useListCompanies,
  useListPricingCategories,
  usePreviewPricingSku,
  getListPricePositionsQueryKey,
  getGetPricingSummaryQueryKey,
  type PricePosition,
  type PricePositionInput,
  type PricePositionPatch,
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
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  position?: PricePosition;
}

const STATUS_OPTIONS: Array<{ value: "draft" | "active" | "archived"; labelKey: string }> = [
  { value: "draft", labelKey: "common.draft" },
  { value: "active", labelKey: "common.active" },
  { value: "archived", labelKey: "common.archived" },
];

export function PricePositionFormDialog({ open, onOpenChange, position }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!position;

  const createMut = useCreatePricePosition();
  const updateMut = useUpdatePricePosition();
  const brandsQ = useListBrands();
  const companiesQ = useListCompanies();
  const categoriesQ = useListPricingCategories();

  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [subcategoryId, setSubcategoryId] = useState<string>("");
  const [listPrice, setListPrice] = useState<string>("");
  const [currency, setCurrency] = useState("EUR");
  const [companyId, setCompanyId] = useState<string>("");
  const [brandId, setBrandId] = useState<string>("");
  const [validFrom, setValidFrom] = useState<string>(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState<string>("");
  const [status, setStatus] = useState<"draft" | "active" | "archived">("draft");
  const [isStandard, setIsStandard] = useState(true);

  const filteredBrands = useMemo(() => {
    return (brandsQ.data ?? []).filter(b => !companyId || b.companyId === companyId);
  }, [brandsQ.data, companyId]);

  const activeCategories = useMemo(
    () => (categoriesQ.data ?? []).filter(c => c.status === "active"),
    [categoriesQ.data],
  );

  const selectedCategory = useMemo(
    () => activeCategories.find(c => c.id === categoryId),
    [activeCategories, categoryId],
  );

  const activeSubcategories = useMemo(
    () => (selectedCategory?.subcategories ?? []).filter(s => s.status === "active"),
    [selectedCategory],
  );

  useEffect(() => {
    if (!open) return;
    if (position) {
      setName(position.name);
      setCategoryId(position.categoryId ?? "");
      setSubcategoryId(position.subcategoryId ?? "");
      setListPrice(String(position.listPrice));
      setCurrency(position.currency);
      setCompanyId(position.companyId);
      setBrandId(position.brandId);
      setValidFrom(position.validFrom);
      setValidUntil(position.validUntil ?? "");
      setStatus((position.status as "draft" | "active" | "archived") ?? "draft");
      setIsStandard(position.isStandard);
    } else {
      setName("");
      setCategoryId("");
      setSubcategoryId("");
      setListPrice("");
      setCurrency("EUR");
      setCompanyId("");
      setBrandId("");
      setValidFrom(new Date().toISOString().slice(0, 10));
      setValidUntil("");
      setStatus("draft");
      setIsStandard(true);
    }
  }, [open, position]);

  // Reset brand if it no longer matches selected company.
  useEffect(() => {
    if (!brandId) return;
    const valid = filteredBrands.some(b => b.id === brandId);
    if (!valid) setBrandId("");
  }, [filteredBrands, brandId]);

  // Reset subcategory when changing category.
  useEffect(() => {
    if (!subcategoryId) return;
    const valid = activeSubcategories.some(s => s.id === subcategoryId);
    if (!valid) setSubcategoryId("");
  }, [activeSubcategories, subcategoryId]);

  // Live SKU preview — only when creating + all required parts present
  // (Unterkategorie ist Teil der Auto-SKU und damit Pflicht).
  const canPreview = !isEdit && !!companyId && !!categoryId && !!subcategoryId && open;
  const previewParams = {
    companyId: companyId || "_",
    categoryId: categoryId || "_",
    subcategoryId: subcategoryId || "_",
  };
  const previewQ = usePreviewPricingSku(
    previewParams,
    {
      query: {
        enabled: canPreview,
        staleTime: 5_000,
        refetchOnWindowFocus: false,
        retry: false,
        queryKey: [
          "/api/v1/pricing/sku-preview",
          previewParams,
        ] as const,
      },
    },
  );

  const submit = async () => {
    const trimmedName = name.trim();
    const lp = Number(listPrice);
    if (!trimmedName) {
      toast({ title: t("common.required"), description: t("common.name"), variant: "destructive" });
      return;
    }
    if (!categoryId) {
      toast({ title: t("common.required"), description: t("pages.pricing.positionForm.categoryMissingError"), variant: "destructive" });
      return;
    }
    if (!subcategoryId) {
      toast({ title: t("common.required"), description: t("pages.pricing.positionForm.subcategoryMissingError"), variant: "destructive" });
      return;
    }
    if (!Number.isFinite(lp) || lp < 0) {
      toast({
        title: t("pages.pricing.positionForm.invalidPriceTitle"),
        description: t("pages.pricing.positionForm.invalidPriceBody"),
        variant: "destructive",
      });
      return;
    }
    if (!companyId || !brandId) {
      toast({
        title: t("pages.pricing.positionForm.missingAssignmentTitle"),
        description: t("pages.pricing.positionForm.missingAssignmentBody"),
        variant: "destructive",
      });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
      toast({
        title: t("pages.pricing.positionForm.invalidDateTitle"),
        description: t("pages.pricing.positionForm.invalidDateBody"),
        variant: "destructive",
      });
      return;
    }
    try {
      if (isEdit && position) {
        const patch: PricePositionPatch = {
          name: trimmedName,
          categoryId,
          subcategoryId,
          listPrice: lp,
          currency: currency.trim().toUpperCase() || "EUR",
          status,
          validFrom,
          validUntil: validUntil ? validUntil : null,
          brandId,
          isStandard,
        };
        await updateMut.mutateAsync({ id: position.id, data: patch });
        toast({ title: t("pages.pricing.positionForm.updatedToast"), description: position.sku });
      } else {
        const body: PricePositionInput = {
          name: trimmedName,
          categoryId,
          subcategoryId,
          listPrice: lp,
          currency: currency.trim().toUpperCase() || "EUR",
          brandId,
          companyId,
          validFrom,
        };
        const created = await createMut.mutateAsync({ data: body });
        toast({ title: t("pages.pricing.positionForm.createdToast"), description: created.sku });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListPricePositionsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetPricingSummaryQueryKey() }),
      ]);
      onOpenChange(false);
    } catch (e: unknown) {
      const httpStatus = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: httpStatus === 403
          ? t("pages.pricing.positionForm.forbiddenToast")
          : t("pages.pricing.positionForm.saveFailedToast"),
        description: body?.error ?? (e instanceof Error ? e.message : t("pages.pricing.positionForm.unknownError")),
        variant: "destructive",
      });
    }
  };

  const busy = createMut.isPending || updateMut.isPending;

  const skuLabel = isEdit ? "SKU" : t("pages.pricing.positionForm.skuAuto");
  const skuValue = isEdit
    ? position?.sku ?? ""
    : (canPreview
        ? (previewQ.isLoading
            ? t("pages.pricing.positionForm.skuLoading")
            : (previewQ.data?.nextSku ?? t("pages.pricing.positionForm.previewError")))
        : t("pages.pricing.positionForm.skuMissing"));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("pages.pricing.positionForm.titleEdit") : t("pages.pricing.positions.new")}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? t("pages.pricing.positionForm.descriptionEdit")
              : t("pages.pricing.positionForm.descriptionCreate")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pp-sku">{skuLabel}</Label>
              <Input
                id="pp-sku"
                value={skuValue}
                readOnly
                disabled
                className="font-mono text-sm bg-muted/40"
                data-testid="input-pp-sku"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("pages.pricing.positionForm.skuImmutable")}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-name">{t("common.name")} *</Label>
              <Input id="pp-name" value={name} onChange={e => setName(e.target.value)} placeholder={t("pages.pricing.positionForm.namePlaceholder")} data-testid="input-pp-name" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("pages.pricing.category")} *</Label>
              <Select value={categoryId} onValueChange={(v) => { setCategoryId(v); setSubcategoryId(""); }}>
                <SelectTrigger data-testid="select-pp-category">
                  <SelectValue placeholder={
                    categoriesQ.isLoading
                      ? t("pages.pricing.positionForm.loadingPlaceholder")
                      : t("pages.pricing.positionForm.categoryRequired")
                  } />
                </SelectTrigger>
                <SelectContent>
                  {activeCategories.map(c => (
                    <SelectItem key={c.id} value={c.id} textValue={c.name}>
                      <span className="font-mono text-xs mr-2">{c.code}</span>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("pages.pricing.subcategory")} *</Label>
              <Select
                value={subcategoryId}
                onValueChange={setSubcategoryId}
                disabled={!categoryId}
              >
                <SelectTrigger data-testid="select-pp-subcategory">
                  <SelectValue placeholder={
                    !categoryId
                      ? t("pages.pricing.positionForm.subcategoryDisabled")
                      : t("pages.pricing.positionForm.subcategoryRequired")
                  } />
                </SelectTrigger>
                <SelectContent>
                  {activeSubcategories.map(s => (
                    <SelectItem key={s.id} value={s.id} textValue={s.name}>
                      <span className="font-mono text-xs mr-2">{s.code}</span>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pp-price">{t("pages.pricing.positionForm.listPriceLabel")} *</Label>
              <Input
                id="pp-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={listPrice}
                onChange={e => setListPrice(e.target.value)}
                placeholder="240000"
                data-testid="input-pp-price"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-currency">{t("pages.pricing.positionForm.currencyLabel")}</Label>
              <Input id="pp-currency" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="EUR" data-testid="input-pp-currency" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-status">{t("pages.pricing.positionForm.statusLabel")}</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as "draft" | "active" | "archived")} disabled={!isEdit}>
                <SelectTrigger id="pp-status" data-testid="select-pp-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{t(o.labelKey, o.value)}</SelectItem>)}
                </SelectContent>
              </Select>
              {!isEdit && <p className="text-[11px] text-muted-foreground">{t("pages.pricing.positionForm.draftStartHint")}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t("pages.pricing.positionForm.companyLabel")} *</Label>
              <Select value={companyId} onValueChange={setCompanyId} disabled={isEdit}>
                <SelectTrigger data-testid="select-pp-company">
                  <SelectValue placeholder={
                    companiesQ.isLoading
                      ? t("pages.pricing.positionForm.loadingPlaceholder")
                      : t("pages.pricing.positionForm.selectPlaceholder")
                  } />
                </SelectTrigger>
                <SelectContent>
                  {(companiesQ.data ?? []).map(c => (
                    <SelectItem key={c.id} value={c.id} textValue={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isEdit && <p className="text-[11px] text-muted-foreground">{t("pages.pricing.positionForm.companyImmutable")}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>{t("pages.pricing.positionForm.brandLabel")} *</Label>
              <Select value={brandId} onValueChange={setBrandId} disabled={!companyId}>
                <SelectTrigger data-testid="select-pp-brand">
                  <SelectValue placeholder={
                    !companyId
                      ? t("pages.pricing.positionForm.brandDisabledPlaceholder")
                      : (brandsQ.isLoading
                          ? t("pages.pricing.positionForm.loadingPlaceholder")
                          : t("pages.pricing.positionForm.selectPlaceholder"))
                  } />
                </SelectTrigger>
                <SelectContent>
                  {filteredBrands.map(b => (
                    <SelectItem key={b.id} value={b.id} textValue={b.name}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pp-vfrom">{t("pages.pricing.positionForm.validFromLabel")} *</Label>
              <Input id="pp-vfrom" type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} data-testid="input-pp-validfrom" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-vto">{t("pages.pricing.positionForm.validUntilLabel")}</Label>
              <Input
                id="pp-vto"
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                disabled={!isEdit}
                data-testid="input-pp-validuntil"
              />
              {!isEdit && <p className="text-[11px] text-muted-foreground">{t("pages.pricing.positionForm.validUntilCreateHint")}</p>}
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isStandard}
                onChange={e => setIsStandard(e.target.checked)}
                data-testid="checkbox-pp-standard"
              />
              <span>{t("pages.pricing.positionForm.isStandardLabel")}</span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("pages.pricing.positionForm.cancel")}</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-pp-submit">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? t("pages.pricing.positionForm.save") : t("pages.pricing.positionForm.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

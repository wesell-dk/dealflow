import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateCompany,
  useUpdateCompany,
  useCreateBrand,
  getListCompaniesQueryKey,
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
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Edit mode if set, otherwise create. */
  company?: Company | null;
}

export function CompanyFormDialog({ open, onOpenChange, company }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateCompany();
  const updateMut = useUpdateCompany();
  const createBrandMut = useCreateBrand();
  const isEdit = !!company;

  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [country, setCountry] = useState("DE");
  const [currency, setCurrency] = useState("EUR");
  const [alsoCreateBrand, setAlsoCreateBrand] = useState(true);

  // Sync values when the dialog opens with a different company.
  useEffect(() => {
    if (open) {
      setName(company?.name ?? "");
      setLegalName(company?.legalName ?? "");
      setCountry(company?.country ?? "DE");
      setCurrency(company?.currency ?? "EUR");
      setAlsoCreateBrand(true);
    }
  }, [open, company]);

  const submit = async () => {
    const trimmedName = name.trim();
    const trimmedLegal = legalName.trim();
    const c2 = country.trim().toUpperCase();
    const c3 = currency.trim().toUpperCase();
    if (!trimmedName || !trimmedLegal) {
      toast({ title: t("pages.admin.incompleteInputTitle"), description: t("pages.admin.incompleteInputBody"), variant: "destructive" });
      return;
    }
    if (!/^[A-Z]{2}$/.test(c2)) {
      toast({ title: t("pages.admin.companyDialog.invalidCountry"), description: t("pages.admin.companyDialog.invalidCountryHint"), variant: "destructive" });
      return;
    }
    if (!/^[A-Z]{3}$/.test(c3)) {
      toast({ title: t("pages.admin.companyDialog.invalidCurrency"), description: t("pages.admin.companyDialog.invalidCurrencyHint"), variant: "destructive" });
      return;
    }
    try {
      if (isEdit && company) {
        await updateMut.mutateAsync({
          id: company.id,
          data: { name: trimmedName, legalName: trimmedLegal, country: c2, currency: c3 },
        });
        toast({ title: t("pages.admin.companyUpdated"), description: trimmedName });
      } else {
        const created = await createMut.mutateAsync({
          data: { name: trimmedName, legalName: trimmedLegal, country: c2, currency: c3 },
        });
        toast({ title: t("pages.admin.companyCreated"), description: trimmedName });

        // F10: Optionally mirror the company directly as a default brand so simple
        // tenants without a sub-brand hierarchy can sell immediately.
        if (alsoCreateBrand) {
          try {
            await createBrandMut.mutateAsync({
              data: {
                companyId: created.id,
                name: trimmedName,
                voice: "precise",
                tone: "precise",
                color: "#2D6CDF",
                primaryColor: "#2D6CDF",
                legalEntityName: trimmedLegal,
              },
            });
            await qc.invalidateQueries({ queryKey: getListBrandsQueryKey() });
            toast({ title: t("pages.admin.companyDialog.defaultBrandCreated"), description: t("pages.admin.companyDialog.defaultBrandCreatedDesc", { name: trimmedName }) });
          } catch (be) {
            // Best-effort: brand creation must not crash the company workflow
            toast({
              title: t("pages.admin.companyDialog.brandCreateFailed"),
              description: be instanceof Error ? be.message : t("pages.admin.companyDialog.brandCreateFailedFallback"),
              variant: "destructive",
            });
          }
        }
      }
      await qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
      onOpenChange(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: status === 409 ? t("pages.admin.nameTaken") : t("common.saveFailed"),
        description: body?.error ?? (e instanceof Error ? e.message : t("pages.admin.brandDialog.unknownError")),
        variant: "destructive",
      });
    }
  };

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("pages.admin.companyDialog.titleEdit") : t("pages.admin.companyDialog.titleNew")}</DialogTitle>
          <DialogDescription>
            {t("pages.admin.companyDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="company-name">{t("pages.admin.companyDialog.displayName")}</Label>
            <Input id="company-name" value={name} onChange={e => setName(e.target.value)} placeholder={t("pages.admin.companyDialog.displayNamePlaceholder")} data-testid="input-company-name" />
            <p className="text-xs text-muted-foreground">{t("pages.admin.companyDialog.displayNameHint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="company-legal">{t("pages.admin.companyDialog.legalName")}</Label>
            <Input id="company-legal" value={legalName} onChange={e => setLegalName(e.target.value)} placeholder={t("pages.admin.companyDialog.legalNamePlaceholder")} data-testid="input-company-legal" />
            <p className="text-xs text-muted-foreground">{t("pages.admin.companyDialog.legalNameHint")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="company-country">{t("pages.admin.companyDialog.country")}</Label>
              <Input id="company-country" value={country} onChange={e => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="DE" data-testid="input-company-country" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="company-currency">{t("pages.admin.companyDialog.currency")}</Label>
              <Input id="company-currency" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="EUR" data-testid="input-company-currency" />
            </div>
          </div>

          {!isEdit && (
            <label className="flex items-start gap-2 rounded-md border bg-muted/30 p-3 cursor-pointer">
              <input
                type="checkbox"
                checked={alsoCreateBrand}
                onChange={(e) => setAlsoCreateBrand(e.target.checked)}
                className="mt-0.5"
                data-testid="checkbox-company-also-brand"
              />
              <div className="text-sm flex-1">
                <div className="font-medium">{t("pages.admin.companyDialog.alsoCreateBrand")}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {t("pages.admin.companyDialog.alsoCreateBrandHint")}
                </div>
              </div>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-company-submit">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? t("common.save") : t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

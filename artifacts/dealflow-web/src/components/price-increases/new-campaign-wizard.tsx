import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePriceIncrease,
  useListAccounts,
  getListAccountsQueryKey,
  getListPriceIncreasesQueryKey,
  type PriceIncreaseCampaignCreate,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Check, ChevronRight, ChevronLeft } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const TOTAL_STEPS = 3;
const todayIso = () => new Date().toISOString().slice(0, 10);

export function NewCampaignWizard({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreatePriceIncrease();
  const { data: accounts, isLoading: accountsLoading } = useListAccounts(
    undefined,
    { query: { enabled: open, queryKey: getListAccountsQueryKey() } },
  );

  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [currency, setCurrency] = useState<"EUR" | "USD" | "GBP" | "CHF">("EUR");
  const [defaultUpliftPct, setDefaultUpliftPct] = useState<number>(3.5);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  // Reset everything whenever the dialog opens, so cancelling and re-opening
  // doesn't carry over previously entered values.
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName("");
    setEffectiveDate(todayIso());
    setCurrency("EUR");
    setDefaultUpliftPct(3.5);
    setSelectedAccountIds(new Set());
    setSearch("");
  }, [open]);

  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];
    const q = search.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.industry.toLowerCase().includes(q) ||
      a.country.toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const allFilteredSelected = filteredAccounts.length > 0
    && filteredAccounts.every(a => selectedAccountIds.has(a.id));

  const toggleAccount = (id: string) => {
    setSelectedAccountIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelectedAccountIds(prev => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredAccounts.forEach(a => next.delete(a.id));
      } else {
        filteredAccounts.forEach(a => next.add(a.id));
      }
      return next;
    });
  };

  const validateStep = (s: number): string | null => {
    if (s === 1) {
      if (name.trim().length < 2) return t("pages.priceIncreasesList.wizard.validateName");
      if (!effectiveDate) return t("pages.priceIncreasesList.wizard.validateDate");
    }
    if (s === 2) {
      if (selectedAccountIds.size === 0) return t("pages.priceIncreasesList.wizard.validateAccounts");
      if (!Number.isFinite(defaultUpliftPct) || defaultUpliftPct < 0 || defaultUpliftPct > 100) {
        return t("pages.priceIncreasesList.wizard.validateUplift");
      }
    }
    return null;
  };

  const goNext = () => {
    const err = validateStep(step);
    if (err) {
      toast({ title: err, variant: "destructive" });
      return;
    }
    setStep(s => Math.min(TOTAL_STEPS, s + 1));
  };

  const goBack = () => setStep(s => Math.max(1, s - 1));

  const submit = async () => {
    for (let s = 1; s <= 2; s++) {
      const err = validateStep(s);
      if (err) {
        toast({ title: err, variant: "destructive" });
        setStep(s);
        return;
      }
    }
    const body: PriceIncreaseCampaignCreate = {
      name: name.trim(),
      effectiveDate,
      currency,
      defaultUpliftPct: Number(defaultUpliftPct),
      accountIds: Array.from(selectedAccountIds),
    };
    try {
      await createMut.mutateAsync({ data: body });
      toast({ title: t("pages.priceIncreasesList.wizard.created"), description: name.trim() });
      await qc.invalidateQueries({ queryKey: getListPriceIncreasesQueryKey() });
      onOpenChange(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast({
        title: t("pages.priceIncreasesList.wizard.createFailed"),
        description: err?.response?.data?.error ?? String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="price-increase-wizard"
      >
        <DialogHeader>
          <DialogTitle>{t("pages.priceIncreasesList.wizard.title")}</DialogTitle>
          <DialogDescription>{t("pages.priceIncreasesList.wizard.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 py-2" data-testid="wizard-step-indicator">
          {[1, 2, 3].map((s) => {
            const reached = s <= step;
            const completed = s < step;
            return (
              <div key={s} className="flex items-center gap-2 flex-1">
                <div
                  className={`size-7 rounded-full border flex items-center justify-center text-xs font-semibold ${
                    reached ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground"
                  }`}
                >
                  {completed ? <Check className="h-3.5 w-3.5" /> : s}
                </div>
                <div className="text-xs font-medium hidden sm:block">
                  {s === 1 && t("pages.priceIncreasesList.wizard.step1Title")}
                  {s === 2 && t("pages.priceIncreasesList.wizard.step2Title")}
                  {s === 3 && t("pages.priceIncreasesList.wizard.step3Title")}
                </div>
                {s < TOTAL_STEPS && <div className="flex-1 h-px bg-border" />}
              </div>
            );
          })}
        </div>

        <div className="text-xs text-muted-foreground" data-testid="wizard-step-counter">
          {t("pages.priceIncreasesList.wizard.step", { current: step, total: TOTAL_STEPS })}
        </div>

        {step === 1 && (
          <div className="grid gap-4 py-2" data-testid="wizard-step-1">
            <div>
              <h3 className="font-semibold">{t("pages.priceIncreasesList.wizard.step1Title")}</h3>
              <p className="text-sm text-muted-foreground">{t("pages.priceIncreasesList.wizard.step1Subtitle")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pi-name">{t("pages.priceIncreasesList.wizard.name")}</Label>
              <Input
                id="pi-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("pages.priceIncreasesList.wizard.namePlaceholder")}
                data-testid="input-pi-name"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="pi-date">{t("pages.priceIncreasesList.wizard.effectiveDate")}</Label>
                <Input
                  id="pi-date"
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  data-testid="input-pi-date"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pi-currency">{t("pages.priceIncreasesList.wizard.currency")}</Label>
                <select
                  id="pi-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as typeof currency)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  data-testid="select-pi-currency"
                >
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                  <option value="CHF">CHF</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3 py-2" data-testid="wizard-step-2">
            <div>
              <h3 className="font-semibold">{t("pages.priceIncreasesList.wizard.step2Title")}</h3>
              <p className="text-sm text-muted-foreground">{t("pages.priceIncreasesList.wizard.step2Subtitle")}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="pi-uplift">{t("pages.priceIncreasesList.wizard.defaultUplift")}</Label>
                <Input
                  id="pi-uplift"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={defaultUpliftPct}
                  onChange={(e) => setDefaultUpliftPct(parseFloat(e.target.value))}
                  data-testid="input-pi-uplift"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pi-search">{t("pages.priceIncreasesList.wizard.search")}</Label>
                <Input
                  id="pi-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("pages.priceIncreasesList.wizard.search")}
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t("pages.priceIncreasesList.wizard.accountsHeader", {
                  selected: selectedAccountIds.size,
                  total: accounts?.length ?? 0,
                })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={toggleAllFiltered}
                disabled={filteredAccounts.length === 0}
                data-testid="wizard-toggle-all-accounts"
              >
                {allFilteredSelected
                  ? t("pages.priceIncreasesList.wizard.selectNone")
                  : t("pages.priceIncreasesList.wizard.selectAll")}
              </Button>
            </div>
            <div className="border rounded-md max-h-[280px] overflow-y-auto divide-y" data-testid="wizard-accounts-list">
              {accountsLoading && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 inline animate-spin mr-2" />
                  …
                </div>
              )}
              {!accountsLoading && filteredAccounts.length === 0 && (
                <div className="p-4 text-center text-sm text-muted-foreground">
                  {t("pages.priceIncreasesList.wizard.noAccounts")}
                </div>
              )}
              {filteredAccounts.map((a) => {
                const checked = selectedAccountIds.has(a.id);
                return (
                  <label
                    key={a.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40 cursor-pointer"
                    data-testid={`wizard-account-row-${a.id}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggleAccount(a.id)}
                      data-testid={`wizard-account-checkbox-${a.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {a.industry} · {a.country}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {a.openDeals} {a.openDeals === 1 ? "deal" : "deals"}
                    </Badge>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-4 py-2" data-testid="wizard-step-3">
            <div>
              <h3 className="font-semibold">{t("pages.priceIncreasesList.wizard.step3Title")}</h3>
              <p className="text-sm text-muted-foreground">{t("pages.priceIncreasesList.wizard.step3Subtitle")}</p>
            </div>
            <div className="rounded-md border bg-muted/20 p-4 grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("pages.priceIncreasesList.wizard.name")}</span>
                <span className="font-medium" data-testid="summary-name">{name.trim()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("pages.priceIncreasesList.wizard.summaryEffective")}</span>
                <span className="font-medium" data-testid="summary-date">
                  {new Date(effectiveDate).toLocaleDateString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("pages.priceIncreasesList.wizard.currency")}</span>
                <span className="font-medium" data-testid="summary-currency">{currency}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("pages.priceIncreasesList.wizard.summaryUplift")}</span>
                <span className="font-medium" data-testid="summary-uplift">+{defaultUpliftPct}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("pages.priceIncreasesList.wizard.summaryAccounts")}</span>
                <span className="font-medium" data-testid="summary-account-count">
                  {selectedAccountIds.size}
                </span>
              </div>
            </div>
            <div className="grid gap-1 max-h-40 overflow-y-auto text-sm">
              {accounts
                ?.filter(a => selectedAccountIds.has(a.id))
                .map(a => (
                  <div key={a.id} className="text-muted-foreground" data-testid={`summary-account-${a.id}`}>
                    · {a.name}
                  </div>
                ))}
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          <div className="flex-1" />
          {step > 1 && (
            <Button
              variant="outline"
              onClick={goBack}
              data-testid="wizard-back"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              {t("pages.priceIncreasesList.wizard.back")}
            </Button>
          )}
          {step < TOTAL_STEPS ? (
            <Button onClick={goNext} data-testid="wizard-next">
              {t("pages.priceIncreasesList.wizard.next")}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={submit}
              disabled={createMut.isPending}
              data-testid="wizard-submit"
            >
              {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {createMut.isPending
                ? t("pages.priceIncreasesList.wizard.creating")
                : t("pages.priceIncreasesList.wizard.create")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

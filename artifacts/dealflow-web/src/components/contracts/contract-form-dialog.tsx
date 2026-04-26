import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateContract,
  useListDeals,
  useListContractTypes,
  useRunContractClassifyContext,
  getListContractsQueryKey,
  getGetDealQueryKey,
  type ContractType,
  ContractInputJurisdiction,
  ContractInputPracticeArea,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Wand2 } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultDealId?: string;
};

const TEMPLATE_OPTIONS: Array<{ value: string; label: string; suggestedCode: string }> = [
  { value: "Mutual NDA", label: "Mutual NDA", suggestedCode: "NDA" },
  { value: "Master Services Agreement", label: "Master Services Agreement", suggestedCode: "MSA" },
  { value: "Order Form", label: "Order Form", suggestedCode: "OF" },
  { value: "Data Processing Agreement", label: "Data Processing Agreement", suggestedCode: "DPA" },
  { value: "Statement of Work", label: "Statement of Work", suggestedCode: "SOW" },
];

const JURISDICTION_OPTIONS: ContractInputJurisdiction[] = [
  ContractInputJurisdiction.DE,
  ContractInputJurisdiction.AT,
  ContractInputJurisdiction.CH,
  ContractInputJurisdiction.EN,
  ContractInputJurisdiction.US,
  ContractInputJurisdiction.OTHER,
];

const PRACTICE_AREA_OPTIONS: ContractInputPracticeArea[] = [
  ContractInputPracticeArea.it_software,
  ContractInputPracticeArea.service,
  ContractInputPracticeArea.supply_purchase,
  ContractInputPracticeArea.labor,
  ContractInputPracticeArea.data_protection,
  ContractInputPracticeArea.license,
  ContractInputPracticeArea.m_a,
  ContractInputPracticeArea.nda,
  ContractInputPracticeArea.framework,
  ContractInputPracticeArea.agb_relevant,
  ContractInputPracticeArea.other,
];

function suggestContractTypeId(template: string, types: ContractType[]): string {
  const tpl = template.toLowerCase();
  const match = TEMPLATE_OPTIONS.find(t => tpl.includes(t.value.toLowerCase()))?.suggestedCode;
  if (!match) return "";
  return types.find(t => t.code === match && t.active)?.id ?? "";
}

export function ContractFormDialog({ open, onOpenChange, defaultDealId }: Props) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const create = useCreateContract();
  const classify = useRunContractClassifyContext();

  const { data: deals } = useListDeals();
  const { data: contractTypes } = useListContractTypes();

  const [dealId, setDealId] = useState(defaultDealId ?? "");
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState(TEMPLATE_OPTIONS[1].value);
  const [contractTypeId, setContractTypeId] = useState("");
  const [contractTypeTouched, setContractTypeTouched] = useState(false);
  const [jurisdiction, setJurisdiction] = useState<ContractInputJurisdiction | "">("");
  const [practiceArea, setPracticeArea] = useState<ContractInputPracticeArea | "">("");
  const [classifyRationale, setClassifyRationale] = useState<string | null>(null);

  // Reset form whenever the dialog opens; pre-pick deal/title sensibly.
  useEffect(() => {
    if (!open) return;
    setDealId(defaultDealId ?? "");
    setTitle("");
    setTemplate(TEMPLATE_OPTIONS[1].value);
    setContractTypeTouched(false);
    setJurisdiction("");
    setPracticeArea("");
    setClassifyRationale(null);
  }, [open, defaultDealId]);

  // Auto-suggest contract type from template name unless the user has
  // explicitly chosen one already.
  useEffect(() => {
    if (contractTypeTouched) return;
    const types = contractTypes ?? [];
    if (types.length === 0) return;
    setContractTypeId(suggestContractTypeId(template, types));
  }, [template, contractTypes, contractTypeTouched]);

  const collator = useMemo(() => new Intl.Collator(i18n.language || "en"), [i18n.language]);

  const dealOptions = useMemo(
    () =>
      (deals ?? [])
        .slice()
        .sort((a, b) => collator.compare(a.name, b.name))
        .map(d => ({ value: d.id, label: `${d.name}${d.accountName ? ` · ${d.accountName}` : ""}` })),
    [deals, collator],
  );

  const typeOptions = useMemo(
    () =>
      (contractTypes ?? [])
        .filter(t => t.active)
        .slice()
        .sort((a, b) => collator.compare(a.name, b.name))
        .map(t => ({ value: t.id, label: `${t.name} (${t.code})` })),
    [contractTypes, collator],
  );

  const canClassify =
    dealId.trim() !== "" &&
    title.trim() !== "" &&
    template.trim() !== "" &&
    !classify.isPending;

  const canSubmit =
    dealId.trim() !== "" &&
    title.trim() !== "" &&
    template.trim() !== "" &&
    contractTypeId.trim() !== "" &&
    jurisdiction !== "" &&
    practiceArea !== "" &&
    !create.isPending;

  async function handleClassify() {
    if (!canClassify) return;
    try {
      const out = await classify.mutateAsync({
        data: { dealId, title: title.trim(), template },
      });
      setJurisdiction(out.result.jurisdiction as ContractInputJurisdiction);
      setPracticeArea(out.result.practiceArea as ContractInputPracticeArea);
      setClassifyRationale(out.result.rationale ?? null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("common.tryAgain");
      toast({ title: t("pages.contracts.profileClassify"), description: msg, variant: "destructive" });
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      const created = await create.mutateAsync({
        data: {
          dealId,
          title: title.trim(),
          template,
          contractTypeId,
          jurisdiction: jurisdiction as ContractInputJurisdiction,
          practiceArea: practiceArea as ContractInputPracticeArea,
        },
      });
      toast({ title: t("pages.contracts.createDialog.created"), description: created.title });
      await qc.invalidateQueries({ queryKey: getListContractsQueryKey() });
      await qc.invalidateQueries({ queryKey: getGetDealQueryKey(dealId) });
      onOpenChange(false);
      setLocation(`/contracts/${created.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("common.tryAgain");
      toast({ title: t("pages.contracts.createDialog.createFailed"), description: msg, variant: "destructive" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-new-contract">
        <DialogHeader>
          <DialogTitle>{t("pages.contracts.createDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("pages.contracts.createDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="contract-deal">{t("pages.contracts.createDialog.deal")}</Label>
            <Select value={dealId} onValueChange={setDealId}>
              <SelectTrigger id="contract-deal" data-testid="select-deal">
                <SelectValue placeholder={t("pages.contracts.createDialog.selectDeal")} />
              </SelectTrigger>
              <SelectContent>
                {dealOptions.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contract-title">{t("pages.contracts.createDialog.titleField")}</Label>
            <Input
              id="contract-title"
              data-testid="input-contract-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t("pages.contracts.createDialog.titlePlaceholder")}
              autoComplete="off"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contract-template">{t("pages.contracts.createDialog.template")}</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger id="contract-template" data-testid="select-template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="contract-type">
              {t("pages.contracts.createDialog.contractType")} <span className="text-destructive">*</span>
            </Label>
            <Select
              value={contractTypeId}
              onValueChange={(v) => { setContractTypeTouched(true); setContractTypeId(v); }}
            >
              <SelectTrigger id="contract-type" data-testid="select-contract-type">
                <SelectValue placeholder={t("pages.contracts.createDialog.selectContractType")} />
              </SelectTrigger>
              <SelectContent>
                {typeOptions.map(o => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("pages.contracts.createDialog.contractTypeHint")}
            </p>
          </div>

          {/* ── Task #228: Pflicht-Profil (Jurisdiktion + Rechtsgebiet) ── */}
          <div className="grid gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                {t("pages.contracts.profileTitle")} <span className="text-destructive">*</span>
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClassify}
                disabled={!canClassify}
                data-testid="button-classify-context"
              >
                {classify.isPending
                  ? <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                  : <Wand2 className="mr-2 h-3 w-3" />}
                {t("pages.contracts.profileClassify")}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="contract-jurisdiction" className="text-xs text-muted-foreground">
                  {t("pages.contracts.profileJurisdiction")}
                </Label>
                <Select
                  value={jurisdiction}
                  onValueChange={(v) => setJurisdiction(v as ContractInputJurisdiction)}
                >
                  <SelectTrigger id="contract-jurisdiction" data-testid="select-jurisdiction">
                    <SelectValue placeholder={t("pages.contracts.profileNone")} />
                  </SelectTrigger>
                  <SelectContent>
                    {JURISDICTION_OPTIONS.map(j => (
                      <SelectItem key={j} value={j}>{j}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="contract-practice-area" className="text-xs text-muted-foreground">
                  {t("pages.contracts.profilePracticeArea")}
                </Label>
                <Select
                  value={practiceArea}
                  onValueChange={(v) => setPracticeArea(v as ContractInputPracticeArea)}
                >
                  <SelectTrigger id="contract-practice-area" data-testid="select-practice-area">
                    <SelectValue placeholder={t("pages.contracts.profileNone")} />
                  </SelectTrigger>
                  <SelectContent>
                    {PRACTICE_AREA_OPTIONS.map(p => (
                      <SelectItem key={p} value={p}>
                        {t(`pages.contracts.practiceArea.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {classifyRationale && (
              <p className="text-xs text-muted-foreground" data-testid="text-classify-rationale">
                {t("pages.contracts.profileSuggestion")}: {classifyRationale}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("pages.contracts.createDialog.cancel")}</Button>
          <Button
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="button-create-contract"
          >
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("pages.contracts.createDialog.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

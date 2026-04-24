import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Filter,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import {
  useListDeals,
  useGetDeal,
  useListQuoteTemplates,
  useListAttachmentLibrary,
  useListIndustryProfiles,
  useCreateQuoteFromTemplate,
  useReplaceQuoteLineItems,
  useGetQuote,
} from "@workspace/api-client-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialDealId?: string;
};

type LineItemForm = {
  name: string;
  description?: string;
  quantity: number;
  listPrice: number;
  unitPrice: number;
  discountPct: number;
};

const INDUSTRIES = ["saas", "consulting", "manufacturing", "services", "other"] as const;

export function QuoteWizard({ open, onOpenChange, initialDealId }: Props) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const ambiguousScope = useAmbiguousActiveScope();

  const [step, setStep] = useState(0);
  const [dealId, setDealId] = useState<string>(initialDealId ?? "");
  const [industry, setIndustry] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [items, setItems] = useState<LineItemForm[]>([]);
  const [validityDays, setValidityDays] = useState<number>(30);
  const [notes, setNotes] = useState<string>("");
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [createdQuoteId, setCreatedQuoteId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: deals } = useListDeals();
  const { data: dealDetail } = useGetDeal(dealId, {
    query: { enabled: !!dealId, queryKey: ["wizardDeal", dealId] },
  });
  const { data: templates, isLoading: tplsLoading } = useListQuoteTemplates();
  const { data: attachments } = useListAttachmentLibrary();
  const { data: industryProfiles } = useListIndustryProfiles();
  const { data: createdQuote } = useGetQuote(createdQuoteId ?? "", {
    query: { enabled: !!createdQuoteId, queryKey: ["wizardCreatedQuote", createdQuoteId] },
  });

  const createMut = useCreateQuoteFromTemplate();
  const replaceLinesMut = useReplaceQuoteLineItems();

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setStep(0);
        setDealId(initialDealId ?? "");
        setIndustry("");
        setTemplateId("");
        setItems([]);
        setValidityDays(30);
        setNotes("");
        setAttachmentIds([]);
        setCreatedQuoteId(null);
        setSubmitting(false);
      }, 200);
    }
  }, [open, initialDealId]);

  // Determine effective industry: from selection or via deal's industry profile
  useEffect(() => {
    if (!industry && industryProfiles && industryProfiles.length > 0) {
      setIndustry(industryProfiles[0].industry);
    }
  }, [industryProfiles, industry]);

  const filteredTemplates = useMemo(() => {
    if (!templates) return [];
    if (!industry) return templates;
    return templates.filter(
      (tpl) => tpl.industry === industry || tpl.industry === "other",
    );
  }, [templates, industry]);

  const selectedTemplate = useMemo(
    () => templates?.find((t) => t.id === templateId),
    [templates, templateId],
  );

  // Apply template defaults when chosen
  useEffect(() => {
    if (selectedTemplate) {
      setItems(
        selectedTemplate.defaultLineItems.map((li) => ({
          name: li.name,
          description: li.description,
          quantity: li.quantity,
          listPrice: li.listPrice,
          unitPrice: li.unitPrice,
          discountPct: li.discountPct,
        })),
      );
      setValidityDays(selectedTemplate.defaultValidityDays);
      setAttachmentIds(selectedTemplate.defaultAttachmentLibraryIds ?? []);
    }
  }, [selectedTemplate]);

  // Suggest template via industry profile when no manual pick yet
  useEffect(() => {
    if (templateId || !industry || !industryProfiles) return;
    const profile = industryProfiles.find((p) => p.industry === industry);
    if (profile?.suggestedTemplateId) {
      setTemplateId(profile.suggestedTemplateId);
    }
  }, [industry, industryProfiles, templateId]);

  const totalAmount = useMemo(() => {
    return items.reduce((sum, it) => {
      const sub = it.quantity * it.unitPrice;
      const disc = sub * (it.discountPct / 100);
      return sum + (sub - disc);
    }, 0);
  }, [items]);

  const totalDiscountPct = useMemo(() => {
    if (!items.length) return 0;
    const sumList = items.reduce((s, it) => s + it.quantity * it.listPrice, 0);
    if (sumList === 0) return 0;
    return Math.round(((sumList - totalAmount) / sumList) * 1000) / 10;
  }, [items, totalAmount]);

  const STEPS = [
    t("quoteWizard.steps.context"),
    t("quoteWizard.steps.template"),
    t("quoteWizard.steps.lineItems"),
    t("quoteWizard.steps.terms"),
    t("quoteWizard.steps.attachments"),
    t("quoteWizard.steps.preview"),
  ];

  const canNext = (() => {
    if (step === 0) return !!dealId && !!industry;
    if (step === 1) return !!templateId;
    if (step === 2) return items.length > 0 && items.every((i) => i.name && i.quantity > 0);
    if (step === 3) return validityDays > 0;
    if (step === 4) return true;
    return false;
  })();

  const handleSubmit = async () => {
    if (!dealId || !templateId) return;
    setSubmitting(true);
    try {
      const validUntil = new Date(Date.now() + validityDays * 86400 * 1000)
        .toISOString()
        .slice(0, 10);
      const created = await createMut.mutateAsync({
        data: {
          dealId,
          templateId,
          validUntil,
          notes: notes || undefined,
          attachmentLibraryIds: attachmentIds,
        },
      });
      const versionId = created.versions?.[0]?.id;
      if (versionId) {
        await replaceLinesMut.mutateAsync({
          id: versionId,
          data: {
            items: items.map((it) => ({
              name: it.name,
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              listPrice: it.listPrice,
              discountPct: it.discountPct,
            })),
          },
        });
      }
      setCreatedQuoteId(created.id);
      setStep(5);
      toast({
        title: t("quoteWizard.created"),
        description: created.number,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        variant: "destructive",
        title: t("quoteWizard.createFailed"),
        description: msg,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const updateItem = (idx: number, patch: Partial<LineItemForm>) => {
    setItems((curr) => curr.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const removeItem = (idx: number) => setItems((curr) => curr.filter((_, i) => i !== idx));
  const addItem = () =>
    setItems((curr) => [
      ...curr,
      { name: "", quantity: 1, listPrice: 0, unitPrice: 0, discountPct: 0 },
    ]);

  const lang = i18n.resolvedLanguage ?? "de";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[90vh] overflow-y-auto"
        data-testid="quote-wizard"
      >
        <DialogHeader>
          <DialogTitle>{t("quoteWizard.title")}</DialogTitle>
          <DialogDescription>{t("quoteWizard.subtitle")}</DialogDescription>
        </DialogHeader>

        <ActiveScopeWizardHint />

        {/* Stepper */}
        <div className="flex items-center gap-2 overflow-x-auto py-2">
          {STEPS.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                      ? "bg-primary/20 text-primary border border-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={`text-xs whitespace-nowrap ${i === step ? "font-semibold" : "text-muted-foreground"}`}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <div className="w-6 h-px bg-border" />}
            </div>
          ))}
        </div>

        <div className="py-4 min-h-[300px]">
          {/* Step 0 — Context */}
          {step === 0 && (
            <div className="grid gap-4">
              <div>
                <Label>{t("common.deal")}</Label>
                {initialDealId ? (
                  <div className="mt-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    {dealDetail?.name ?? initialDealId}
                  </div>
                ) : (
                  <Select value={dealId} onValueChange={setDealId}>
                    <SelectTrigger data-testid="wizard-deal-select">
                      <SelectValue placeholder={t("quoteWizard.selectDeal")} />
                    </SelectTrigger>
                    <SelectContent>
                      {deals?.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name} — {d.accountName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label>{t("common.industry")}</Label>
                <Select value={industry} onValueChange={setIndustry}>
                  <SelectTrigger data-testid="wizard-industry-select">
                    <SelectValue placeholder={t("quoteWizard.selectIndustry")} />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRIES.map((ind) => (
                      <SelectItem key={ind} value={ind}>
                        {industryProfiles?.find((p) => p.industry === ind)?.label ??
                          t(`quoteWizard.industries.${ind}`, { defaultValue: ind })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {industry && industryProfiles?.find((p) => p.industry === industry) ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {industryProfiles.find((p) => p.industry === industry)?.description}
                  </p>
                ) : industry ? (
                  <div
                    className="mt-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs"
                    data-testid="industry-configurator-hint"
                  >
                    <div className="font-semibold mb-1">
                      {t("quoteWizard.configurator.title")}
                    </div>
                    <div className="text-muted-foreground">
                      {t("quoteWizard.configurator.subtitle")}
                    </div>
                  </div>
                ) : null}
              </div>
              <div>
                <Label>{t("quoteWizard.notes")}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t("quoteWizard.notesPlaceholder")}
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Step 1 — Template */}
          {step === 1 && (
            <div className="grid gap-3">
              {tplsLoading && <Skeleton className="h-32 w-full" />}
              {!tplsLoading && filteredTemplates.length === 0 && (
                <div className="rounded-md border p-4 text-sm text-muted-foreground">
                  {t("quoteWizard.noTemplates")}
                </div>
              )}
              {filteredTemplates.map((tpl) => {
                const selected = templateId === tpl.id;
                return (
                  <button
                    type="button"
                    key={tpl.id}
                    onClick={() => setTemplateId(tpl.id)}
                    data-testid={`wizard-template-${tpl.id}`}
                    className={`text-left rounded-lg border p-4 transition-colors hover:border-primary ${
                      selected ? "border-primary bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="font-semibold">{tpl.name}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {tpl.description}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <Badge variant="secondary" className="text-xs">
                            {tpl.industry}
                          </Badge>
                          {tpl.isSystem && (
                            <Badge variant="outline" className="text-xs">
                              {t("quoteWizard.system")}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {tpl.defaultLineItems.length} {t("quoteWizard.positions")}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {t("quoteWizard.validityDays", {
                              days: tpl.defaultValidityDays,
                            })}
                          </Badge>
                        </div>
                      </div>
                      {selected && <Check className="h-5 w-5 text-primary shrink-0" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Step 2 — Line Items */}
          {step === 2 && (
            <div className="grid gap-3">
              <div className="rounded-md border">
                <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs font-medium text-muted-foreground bg-muted/40">
                  <div className="col-span-4">{t("common.name")}</div>
                  <div className="col-span-1 text-right">{t("quoteWizard.qty")}</div>
                  <div className="col-span-2 text-right">{t("quoteWizard.listPrice")}</div>
                  <div className="col-span-2 text-right">{t("quoteWizard.unitPrice")}</div>
                  <div className="col-span-1 text-right">%</div>
                  <div className="col-span-1 text-right">{t("common.total")}</div>
                  <div className="col-span-1"></div>
                </div>
                {items.map((it, idx) => {
                  const lineTotal =
                    it.quantity * it.unitPrice * (1 - it.discountPct / 100);
                  const lineList = it.quantity * it.listPrice;
                  const marginPct = lineList > 0 ? Math.round(((lineTotal - lineList * 0.7) / Math.max(lineTotal, 1)) * 1000) / 10 : 0;
                  return (
                    <div
                      key={idx}
                      className="grid grid-cols-12 gap-2 px-3 py-2 border-t items-start"
                    >
                      <div className="col-span-4">
                        <Input
                          value={it.name}
                          onChange={(e) => updateItem(idx, { name: e.target.value })}
                          placeholder={t("common.name")}
                          data-testid={`wizard-line-name-${idx}`}
                        />
                        <Textarea
                          value={it.description ?? ""}
                          onChange={(e) =>
                            updateItem(idx, { description: e.target.value })
                          }
                          rows={1}
                          className="mt-1 text-xs"
                          placeholder={t("quoteWizard.lineDescription")}
                        />
                      </div>
                      <div className="col-span-1">
                        <Input
                          type="number"
                          step="0.01"
                          value={it.quantity}
                          onChange={(e) =>
                            updateItem(idx, { quantity: Number(e.target.value) })
                          }
                          className="text-right"
                        />
                      </div>
                      <div className="col-span-2">
                        <Input
                          type="number"
                          step="0.01"
                          value={it.listPrice}
                          onChange={(e) =>
                            updateItem(idx, { listPrice: Number(e.target.value) })
                          }
                          className="text-right"
                        />
                      </div>
                      <div className="col-span-2">
                        <Input
                          type="number"
                          step="0.01"
                          value={it.unitPrice}
                          onChange={(e) =>
                            updateItem(idx, { unitPrice: Number(e.target.value) })
                          }
                          className="text-right"
                        />
                      </div>
                      <div className="col-span-1">
                        <Input
                          type="number"
                          step="0.1"
                          value={it.discountPct}
                          onChange={(e) =>
                            updateItem(idx, { discountPct: Number(e.target.value) })
                          }
                          className="text-right"
                        />
                      </div>
                      <div className="col-span-1 text-right pt-2">
                        <div className="text-sm font-medium">
                          {lineTotal.toLocaleString(lang, {
                            maximumFractionDigits: 2,
                          })}
                        </div>
                        <div className="text-[10px] text-muted-foreground" title={t("quoteWizard.defaultMargin")}>
                          M {marginPct}%
                        </div>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(idx)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between">
                <Button variant="outline" size="sm" onClick={addItem}>
                  <Plus className="h-4 w-4 mr-1" />
                  {t("quoteWizard.addLine")}
                </Button>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">
                    Ø {t("common.discount")}: {totalDiscountPct}%
                  </div>
                  <div className="text-lg font-bold">
                    {totalAmount.toLocaleString(lang, {
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — Terms */}
          {step === 3 && (
            <div className="grid gap-4">
              <div>
                <Label>{t("quoteWizard.validityDaysLabel")}</Label>
                <Input
                  type="number"
                  value={validityDays}
                  onChange={(e) => setValidityDays(Number(e.target.value))}
                  min={1}
                  max={365}
                />
              </div>
              <div>
                <Label>{t("quoteWizard.notes")}</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={4}
                />
              </div>
              {selectedTemplate && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">
                      {t("quoteWizard.sectionsPreview")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {selectedTemplate.sections.map((s) => (
                      <div key={s.id} className="border-l-2 border-primary/30 pl-3">
                        <div className="font-medium">
                          {s.title}{" "}
                          <span className="text-xs text-muted-foreground">
                            [{s.kind}]
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-2">
                          {s.body}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Step 4 — Attachments */}
          {step === 4 && (
            <div className="grid gap-3">
              <div className="text-sm text-muted-foreground">
                {t("quoteWizard.attachmentsHint")}
              </div>
              {attachments?.map((a) => {
                const checked = attachmentIds.includes(a.id);
                return (
                  <label
                    key={a.id}
                    className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer hover:border-primary ${
                      checked ? "border-primary bg-primary/5" : ""
                    }`}
                    data-testid={`wizard-att-${a.id}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(c) => {
                        setAttachmentIds((curr) =>
                          c
                            ? [...curr, a.id]
                            : curr.filter((id) => id !== a.id),
                        );
                      }}
                    />
                    <div className="flex-1">
                      <div className="font-medium text-sm flex items-center gap-2">
                        <Paperclip className="h-3 w-3" />
                        {a.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {a.description}
                      </div>
                      <div className="mt-1 flex gap-1 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {a.category}
                        </Badge>
                        {a.tags.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(a.size / 1024).toFixed(0)} KB
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {/* Step 5 — Preview / Done */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="rounded-md border p-4 bg-primary/5">
                <div className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-primary" />
                  <span className="font-semibold">
                    {t("quoteWizard.successTitle")}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("quoteWizard.successDescription", {
                    number: createdQuote?.number ?? "",
                  })}
                </p>
              </div>
              {createdQuote && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      {createdQuote.number}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div>
                      {t("common.total")}:{" "}
                      <strong>
                        {createdQuote.totalAmount.toLocaleString(lang)}{" "}
                        {createdQuote.currency}
                      </strong>
                    </div>
                    <div>
                      {t("common.discount")}:{" "}
                      <strong>{createdQuote.discountPct}%</strong>
                    </div>
                    <div>
                      {t("common.validUntil")}:{" "}
                      <strong>
                        {new Date(createdQuote.validUntil).toLocaleDateString(lang)}
                      </strong>
                    </div>
                  </CardContent>
                </Card>
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    createdQuoteId &&
                    window.open(`/api/quotes/${createdQuoteId}/pdf`, "_blank")
                  }
                  disabled={!createdQuoteId}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {t("quoteWizard.openPdf")}
                </Button>
                <Button
                  onClick={() => {
                    onOpenChange(false);
                    if (createdQuoteId) navigate(`/quotes/${createdQuoteId}`);
                  }}
                  disabled={!createdQuoteId}
                >
                  {t("quoteWizard.openQuote")}
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex sm:flex-row sm:justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || step === 5 || submitting}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("common.back")}
          </Button>
          <div className="flex gap-2">
            {step < 4 && (
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext}
                data-testid="wizard-next"
              >
                {t("quoteWizard.next")}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}
            {step === 4 && (
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                data-testid="wizard-submit"
              >
                {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {t("quoteWizard.create")}
              </Button>
            )}
            {step === 5 && (
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t("common.cancel")}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Aktive Sicht des Users gilt als "eindeutig", wenn sie genau eine Company UND
 * genau einen Brand referenziert. Andernfalls (>1 Company, >1 Brand, 1C+0B,
 * 0C+1B) gilt sie als mehrdeutig.
 *
 * Im Quote-Wizard ist Mehrdeutigkeit *kein* Hard-Stop: der Deal-Selector im
 * ersten Schritt diktiert Company/Brand bereits eindeutig (jeder Deal hat ein
 * fixes Tupel), und die Deal-Liste ist serverseitig auf die aktive Sicht
 * eingeschränkt. Der Hook bleibt aber exportiert, damit künftige
 * Contract-/Deal-Create-Wizards (die direkt nach Company+Brand fragen) die
 * gleiche Definition verwenden können.
 */
export function useAmbiguousActiveScope(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  if (!user.activeScope.filtered) return false;
  const cIds = user.activeScope.companyIds ?? [];
  const bIds = user.activeScope.brandIds ?? [];
  return !(cIds.length === 1 && bIds.length === 1);
}

/**
 * Hint-Banner im Wizard, wenn der User aktuell in einer eingeschränkten Sicht
 * arbeitet. Bei mehrdeutiger Sicht zeigen wir einen Hinweis, dass der gewählte
 * Deal Company/Brand eindeutig festlegt — und die Deal-Liste sowieso auf die
 * aktive Sicht beschränkt ist. Bei eindeutiger Sicht ein dezenter Hinweis.
 */
function ActiveScopeWizardHint() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const ambiguous = useAmbiguousActiveScope();
  if (!user?.activeScope.filtered) return null;
  if (ambiguous) {
    return (
      <Alert
        className="bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800"
        data-testid="alert-wizard-scope-ambiguous"
      >
        <Filter className="h-4 w-4" />
        <AlertTitle className="text-sm">
          {t("scopeSwitcher.ambiguousScopeRequired")}
        </AlertTitle>
        <AlertDescription className="text-xs">
          {t("scopeSwitcher.ambiguousScopeRequiredDesc")}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert className="bg-primary/5 border-primary/30" data-testid="alert-wizard-scope-hint">
      <Filter className="h-4 w-4 text-primary" />
      <AlertTitle className="text-sm">{t("scopeSwitcher.wizardHintTitle")}</AlertTitle>
      <AlertDescription className="text-xs">
        {t("scopeSwitcher.wizardHintBody")}
      </AlertDescription>
    </Alert>
  );
}

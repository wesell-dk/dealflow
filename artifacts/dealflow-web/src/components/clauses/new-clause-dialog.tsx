import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateClause,
  getListClauseFamiliesQueryKey,
  type ClauseCreateInput,
  type ClauseFamily,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2 } from "lucide-react";

type Severity = "low" | "medium" | "high";
type TLocale = "de" | "en";

interface TranslationDraft {
  locale: TLocale;
  name: string;
  summary: string;
  body: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  families: ClauseFamily[] | undefined;
}

export function NewClauseDialog({ open, onOpenChange, families }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreateClause();

  const [familyMode, setFamilyMode] = useState<"existing" | "new">(
    families && families.length > 0 ? "existing" : "new",
  );
  const [familyId, setFamilyId] = useState<string>("");
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyDescription, setNewFamilyDescription] = useState("");

  const [variantName, setVariantName] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [severityScore, setSeverityScore] = useState<number>(50);
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [tone, setTone] = useState("standard");

  const [translations, setTranslations] = useState<TranslationDraft[]>([]);

  // Re-seed everything on open. Avoids stale state from a prior creation flow.
  useEffect(() => {
    if (!open) return;
    setFamilyMode(families && families.length > 0 ? "existing" : "new");
    setFamilyId(families && families.length > 0 ? families[0].id : "");
    setNewFamilyName("");
    setNewFamilyDescription("");
    setVariantName("");
    setSeverity("medium");
    setSeverityScore(50);
    setSummary("");
    setBody("");
    setTone("standard");
    setTranslations([]);
  }, [open, families]);

  const usedLocales = useMemo(
    () => new Set(translations.map(tr => tr.locale)),
    [translations],
  );

  const addTranslation = () => {
    const allLocales: TLocale[] = ["de", "en"];
    const next = allLocales.find(l => !usedLocales.has(l));
    if (!next) return;
    setTranslations(prev => [...prev, { locale: next, name: "", summary: "", body: "" }]);
  };

  const removeTranslation = (i: number) => {
    setTranslations(prev => prev.filter((_, idx) => idx !== i));
  };

  const updateTranslation = (i: number, patch: Partial<TranslationDraft>) => {
    setTranslations(prev => prev.map((tr, idx) => idx === i ? { ...tr, ...patch } : tr));
  };

  const submit = async () => {
    if (familyMode === "existing" && !familyId) {
      toast({ title: t("pages.clauses.newClauseDialog.validateFamily"), variant: "destructive" });
      return;
    }
    if (familyMode === "new") {
      if (newFamilyName.trim().length < 2) {
        toast({ title: t("pages.clauses.newClauseDialog.validateNewFamilyName"), variant: "destructive" });
        return;
      }
      if (newFamilyDescription.trim().length < 1) {
        toast({ title: t("pages.clauses.newClauseDialog.validateNewFamilyDescription"), variant: "destructive" });
        return;
      }
    }
    if (variantName.trim().length < 1) {
      toast({ title: t("pages.clauses.newClauseDialog.validateVariantName"), variant: "destructive" });
      return;
    }
    if (summary.trim().length < 1) {
      toast({ title: t("pages.clauses.newClauseDialog.validateVariantSummary"), variant: "destructive" });
      return;
    }
    if (!body.trim() && translations.length === 0) {
      toast({ title: t("pages.clauses.newClauseDialog.validateBodyOrTranslation"), variant: "destructive" });
      return;
    }
    if (translations.length > 0) {
      const localeSet = new Set<TLocale>();
      for (const tr of translations) {
        if (localeSet.has(tr.locale)) {
          toast({
            title: t("pages.clauses.newClauseDialog.validateTranslationLocaleUnique"),
            variant: "destructive",
          });
          return;
        }
        localeSet.add(tr.locale);
        if (!tr.name.trim() || !tr.summary.trim()) {
          toast({
            title: t("pages.clauses.newClauseDialog.validateTranslationFields"),
            variant: "destructive",
          });
          return;
        }
      }
    }

    const input: ClauseCreateInput = {
      variant: {
        name: variantName.trim(),
        severity,
        severityScore,
        summary: summary.trim(),
        body: body.trim(),
        tone: tone.trim() || "standard",
      },
      ...(familyMode === "existing"
        ? { familyId }
        : {
            newFamily: {
              name: newFamilyName.trim(),
              description: newFamilyDescription.trim(),
            },
          }),
      ...(translations.length > 0
        ? {
            translations: translations.map(tr => ({
              locale: tr.locale,
              name: tr.name.trim(),
              summary: tr.summary.trim(),
              body: tr.body.trim(),
            })),
          }
        : {}),
    };

    try {
      await createMut.mutateAsync({ data: input });
      toast({ title: t("pages.clauses.newClauseDialog.created"), description: variantName.trim() });
      await qc.invalidateQueries({ queryKey: getListClauseFamiliesQueryKey() });
      onOpenChange(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast({
        title: t("pages.clauses.newClauseDialog.createFailed"),
        description: err?.response?.data?.error ?? String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="new-clause-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("pages.clauses.newClauseDialog.title")}</DialogTitle>
          <DialogDescription>{t("pages.clauses.newClauseDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>{t("pages.clauses.newClauseDialog.familyMode")}</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={familyMode === "existing" ? "default" : "outline"}
                size="sm"
                onClick={() => setFamilyMode("existing")}
                disabled={!families || families.length === 0}
                data-testid="family-mode-existing"
              >
                {t("pages.clauses.newClauseDialog.familyExisting")}
              </Button>
              <Button
                type="button"
                variant={familyMode === "new" ? "default" : "outline"}
                size="sm"
                onClick={() => setFamilyMode("new")}
                data-testid="family-mode-new"
              >
                {t("pages.clauses.newClauseDialog.familyNew")}
              </Button>
            </div>
          </div>

          {familyMode === "existing" && (
            <div className="grid gap-2">
              <Label htmlFor="cl-family">{t("pages.clauses.newClauseDialog.selectFamily")}</Label>
              <Select value={familyId} onValueChange={setFamilyId}>
                <SelectTrigger id="cl-family" data-testid="select-clause-family">
                  <SelectValue placeholder={t("pages.clauses.newClauseDialog.selectFamilyPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {families?.map(f => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {familyMode === "new" && (
            <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
              <div className="grid gap-2">
                <Label htmlFor="nf-name">{t("pages.clauses.newClauseDialog.newFamilyName")}</Label>
                <Input
                  id="nf-name"
                  value={newFamilyName}
                  onChange={(e) => setNewFamilyName(e.target.value)}
                  placeholder={t("pages.clauses.newClauseDialog.newFamilyNamePlaceholder")}
                  data-testid="input-new-family-name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="nf-desc">{t("pages.clauses.newClauseDialog.newFamilyDescription")}</Label>
                <Textarea
                  id="nf-desc"
                  value={newFamilyDescription}
                  onChange={(e) => setNewFamilyDescription(e.target.value)}
                  placeholder={t("pages.clauses.newClauseDialog.newFamilyDescriptionPlaceholder")}
                  rows={2}
                  data-testid="input-new-family-description"
                />
              </div>
            </div>
          )}

          <div className="border-t pt-3">
            <h4 className="text-sm font-semibold mb-3">{t("pages.clauses.newClauseDialog.variantSection")}</h4>
            <div className="grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="v-name">{t("pages.clauses.newClauseDialog.variantName")}</Label>
                <Input
                  id="v-name"
                  value={variantName}
                  onChange={(e) => setVariantName(e.target.value)}
                  placeholder={t("pages.clauses.newClauseDialog.variantNamePlaceholder")}
                  data-testid="input-variant-name"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="v-sev">{t("pages.clauses.newClauseDialog.variantSeverity")}</Label>
                  <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
                    <SelectTrigger id="v-sev" data-testid="select-variant-severity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t("pages.clauses.newClauseDialog.severityLow")}</SelectItem>
                      <SelectItem value="medium">{t("pages.clauses.newClauseDialog.severityMedium")}</SelectItem>
                      <SelectItem value="high">{t("pages.clauses.newClauseDialog.severityHigh")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="v-score">{t("pages.clauses.newClauseDialog.variantSeverityScore")}</Label>
                  <Input
                    id="v-score"
                    type="number"
                    min={0}
                    max={100}
                    value={severityScore}
                    onChange={(e) => setSeverityScore(parseInt(e.target.value || "0", 10))}
                    data-testid="input-variant-severity-score"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="v-tone">{t("pages.clauses.newClauseDialog.variantTone")}</Label>
                  <Input
                    id="v-tone"
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    placeholder={t("pages.clauses.newClauseDialog.variantTonePlaceholder")}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="v-summary">{t("pages.clauses.newClauseDialog.variantSummary")}</Label>
                <Textarea
                  id="v-summary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder={t("pages.clauses.newClauseDialog.variantSummaryPlaceholder")}
                  rows={2}
                  data-testid="input-variant-summary"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="v-body">{t("pages.clauses.newClauseDialog.variantBody")}</Label>
                <Textarea
                  id="v-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("pages.clauses.newClauseDialog.variantBodyPlaceholder")}
                  rows={4}
                  data-testid="input-variant-body"
                />
              </div>
            </div>
          </div>

          <div className="border-t pt-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold">{t("pages.clauses.newClauseDialog.translationsSection")}</h4>
                <p className="text-xs text-muted-foreground">{t("pages.clauses.newClauseDialog.translationsHint")}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTranslation}
                disabled={usedLocales.size >= 2}
                data-testid="add-translation"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t("pages.clauses.newClauseDialog.addTranslation")}
              </Button>
            </div>
            {translations.map((tr, idx) => (
              <div
                key={idx}
                className="mt-3 rounded-md border bg-muted/20 p-3 grid gap-2"
                data-testid={`translation-row-${idx}`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 grid gap-1">
                    <Label>{t("pages.clauses.newClauseDialog.translationLocale")}</Label>
                    <Select
                      value={tr.locale}
                      onValueChange={(v) => updateTranslation(idx, { locale: v as TLocale })}
                    >
                      <SelectTrigger data-testid={`translation-locale-${idx}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="de">{t("pages.clauses.newClauseDialog.translationLocaleDe")}</SelectItem>
                        <SelectItem value="en">{t("pages.clauses.newClauseDialog.translationLocaleEn")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeTranslation(idx)}
                    className="self-end mb-px"
                    data-testid={`translation-remove-${idx}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid gap-2">
                  <Label>{t("pages.clauses.newClauseDialog.translationName")}</Label>
                  <Input
                    value={tr.name}
                    onChange={(e) => updateTranslation(idx, { name: e.target.value })}
                    data-testid={`translation-name-${idx}`}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{t("pages.clauses.newClauseDialog.translationSummary")}</Label>
                  <Textarea
                    value={tr.summary}
                    onChange={(e) => updateTranslation(idx, { summary: e.target.value })}
                    rows={2}
                    data-testid={`translation-summary-${idx}`}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{t("pages.clauses.newClauseDialog.translationBody")}</Label>
                  <Textarea
                    value={tr.body}
                    onChange={(e) => updateTranslation(idx, { body: e.target.value })}
                    rows={3}
                    data-testid={`translation-body-${idx}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={createMut.isPending}
            data-testid="submit-new-clause"
          >
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {createMut.isPending
              ? t("pages.clauses.newClauseDialog.creating")
              : t("pages.clauses.newClauseDialog.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

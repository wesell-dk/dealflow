import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateQuoteTemplate,
  getListQuoteTemplatesQueryKey,
  type QuoteTemplateInput,
  type QuoteTemplateSectionInput,
  type QuoteTemplateLineItem,
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
import { Loader2, Plus, Trash2, GripVertical } from "lucide-react";

const INDUSTRIES = ["saas", "consulting", "manufacturing", "services", "other"];
const SECTION_KINDS = ["cover", "intro", "scope", "terms", "appendix", "custom"];

type Section = QuoteTemplateSectionInput;
type LineItem = QuoteTemplateLineItem;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: string) => void;
}

export function TemplateFormDialog({ open, onOpenChange, onCreated }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const create = useCreateQuoteTemplate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [industry, setIndustry] = useState("services");
  const [defaultDiscountPct, setDefaultDiscountPct] = useState("0");
  const [defaultMarginPct, setDefaultMarginPct] = useState("0");
  const [defaultValidityDays, setDefaultValidityDays] = useState("30");
  const [sections, setSections] = useState<Section[]>([
    { kind: "intro", title: "Einleitung", body: "", order: 0 },
  ]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setIndustry("services");
      setDefaultDiscountPct("0");
      setDefaultMarginPct("0");
      setDefaultValidityDays("30");
      setSections([{ kind: "intro", title: "Einleitung", body: "", order: 0 }]);
      setLineItems([]);
    }
  }, [open]);

  const addSection = () => {
    setSections((prev) => [
      ...prev,
      { kind: "custom", title: "", body: "", order: prev.length },
    ]);
  };
  const removeSection = (i: number) => {
    setSections((prev) => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order: idx })));
  };
  const moveSection = (i: number, dir: -1 | 1) => {
    setSections((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, idx) => ({ ...s, order: idx }));
    });
  };
  const updateSection = (i: number, patch: Partial<Section>) => {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      { name: "", description: "", quantity: 1, unitPrice: 0, listPrice: 0, discountPct: 0 },
    ]);
  };
  const removeLineItem = (i: number) => {
    setLineItems((prev) => prev.filter((_, idx) => idx !== i));
  };
  const updateLineItem = (i: number, patch: Partial<LineItem>) => {
    setLineItems((prev) => prev.map((li, idx) => (idx === i ? { ...li, ...patch } : li)));
  };

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast({ title: "Name fehlt", variant: "destructive" });
      return;
    }
    const cleanedSections: Section[] = sections
      .filter((s) => s.title.trim())
      .map((s, idx) => ({
        kind: s.kind,
        title: s.title.trim(),
        body: s.body?.trim() ?? "",
        order: idx,
      }));
    const cleanedLineItems: LineItem[] = lineItems
      .filter((li) => li.name.trim())
      .map((li) => ({
        name: li.name.trim(),
        description: li.description?.trim() ?? "",
        quantity: Number(li.quantity) || 1,
        unitPrice: Number(li.unitPrice) || 0,
        listPrice: Number(li.listPrice) || Number(li.unitPrice) || 0,
        discountPct: Number(li.discountPct) || 0,
      }));
    const payload: QuoteTemplateInput = {
      name: trimmedName,
      description: description.trim(),
      industry,
      defaultDiscountPct: Number(defaultDiscountPct) || 0,
      defaultMarginPct: Number(defaultMarginPct) || 0,
      defaultValidityDays: Number(defaultValidityDays) || 30,
      sections: cleanedSections,
      defaultLineItems: cleanedLineItems,
    };
    try {
      const result = await create.mutateAsync({ data: payload });
      await qc.invalidateQueries({ queryKey: getListQuoteTemplatesQueryKey() });
      toast({ title: "Vorlage angelegt", description: trimmedName });
      onCreated?.(result.id);
      onOpenChange(false);
    } catch (e) {
      toast({
        title: "Anlegen fehlgeschlagen",
        description: e instanceof Error ? e.message : "Unbekannt",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!create.isPending) onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="template-form-dialog">
        <DialogHeader>
          <DialogTitle>Vorlage erstellen</DialogTitle>
          <DialogDescription>
            Eine wiederverwendbare Quote-Template — Sektionen, Standard-Konditionen und Default-Positionen
            werden bei jeder neuen Angebotserstellung übernommen.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Stammdaten */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name *</Label>
              <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="z. B. SaaS-Standard 2026"
                data-testid="template-form-name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-industry">Branche</Label>
              <Select value={industry} onValueChange={setIndustry}>
                <SelectTrigger id="tpl-industry" data-testid="template-form-industry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((i) => (
                    <SelectItem key={i} value={i}>
                      {t(`quoteWizard.industries.${i}`, { defaultValue: i })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-desc">Beschreibung</Label>
            <Textarea id="tpl-desc" rows={2} value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Wofür ist diese Vorlage gedacht?" />
          </div>

          {/* Defaults */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-discount">Standard-Rabatt %</Label>
              <Input id="tpl-discount" type="number" min={0} max={100}
                value={defaultDiscountPct}
                onChange={(e) => setDefaultDiscountPct(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-margin">Standard-Marge %</Label>
              <Input id="tpl-margin" type="number" min={0} max={100}
                value={defaultMarginPct}
                onChange={(e) => setDefaultMarginPct(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-validity">Gültigkeit (Tage)</Label>
              <Input id="tpl-validity" type="number" min={1}
                value={defaultValidityDays}
                onChange={(e) => setDefaultValidityDays(e.target.value)} />
            </div>
          </div>

          {/* Sektionen */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-base">Sektionen</Label>
              <Button type="button" size="sm" variant="outline" onClick={addSection} data-testid="template-form-add-section">
                <Plus className="h-3.5 w-3.5 mr-1" /> Sektion
              </Button>
            </div>
            <div className="space-y-2">
              {sections.map((s, i) => (
                <div key={i} className="rounded-md border p-3 space-y-2 bg-muted/20" data-testid={`template-form-section-${i}`}>
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-0.5">
                      <button type="button" className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        onClick={() => moveSection(i, -1)} disabled={i === 0} aria-label="Nach oben">
                        <GripVertical className="h-3 w-3" />↑
                      </button>
                      <button type="button" className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                        onClick={() => moveSection(i, 1)} disabled={i === sections.length - 1} aria-label="Nach unten">
                        ↓
                      </button>
                    </div>
                    <div className="flex-1 grid grid-cols-3 gap-2">
                      <Select value={s.kind} onValueChange={(v) => updateSection(i, { kind: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SECTION_KINDS.map((k) => (
                            <SelectItem key={k} value={k}>{k}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input className="col-span-2" placeholder="Titel"
                        value={s.title}
                        onChange={(e) => updateSection(i, { title: e.target.value })} />
                    </div>
                    <Button type="button" size="sm" variant="ghost"
                      onClick={() => removeSection(i)} aria-label="Sektion entfernen">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                  <Textarea rows={2} placeholder="Inhalt (Markdown möglich)"
                    value={s.body ?? ""}
                    onChange={(e) => updateSection(i, { body: e.target.value })} />
                </div>
              ))}
              {sections.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Noch keine Sektionen — füge eine hinzu.</p>
              )}
            </div>
          </div>

          {/* Standard-Positionen */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-base">Standard-Positionen</Label>
              <Button type="button" size="sm" variant="outline" onClick={addLineItem} data-testid="template-form-add-line-item">
                <Plus className="h-3.5 w-3.5 mr-1" /> Position
              </Button>
            </div>
            <div className="space-y-2">
              {lineItems.length > 0 && (
                <div className="grid grid-cols-12 gap-2 px-2 text-xs font-medium text-muted-foreground" aria-hidden="true">
                  <div className="col-span-4">Bezeichnung</div>
                  <div className="col-span-1">Menge</div>
                  <div className="col-span-2">Einzelpreis €</div>
                  <div className="col-span-2">Listenpreis €</div>
                  <div className="col-span-2">Rabatt %</div>
                  <div className="col-span-1" />
                </div>
              )}
              {lineItems.map((li, i) => (
                <div key={i} className="rounded-md border p-2 grid grid-cols-12 gap-2 items-center bg-muted/20" data-testid={`template-form-line-item-${i}`}>
                  <Input className="col-span-4" placeholder="Bezeichnung"
                    title="Produktname oder Leistung — wird genau so im Angebot angezeigt."
                    value={li.name}
                    onChange={(e) => updateLineItem(i, { name: e.target.value })} />
                  <Input className="col-span-1" type="number" min={1} placeholder="Menge"
                    title="Stückzahl dieser Position."
                    value={li.quantity}
                    onChange={(e) => updateLineItem(i, { quantity: Number(e.target.value) })} />
                  <Input className="col-span-2" type="number" min={0} placeholder="Einzelpreis"
                    title="Tatsächlicher Verkaufspreis pro Stück (Netto, in €). Das zahlt der Kunde."
                    value={li.unitPrice}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      updateLineItem(i, { unitPrice: v, listPrice: li.listPrice || v });
                    }} />
                  <Input className="col-span-2" type="number" min={0} placeholder="Listenpreis"
                    title="Standard-/UVP-Preis pro Stück (Netto). Daraus ergibt sich der effektive Rabatt gegenüber dem Einzelpreis."
                    value={li.listPrice}
                    onChange={(e) => updateLineItem(i, { listPrice: Number(e.target.value) })} />
                  <Input className="col-span-2" type="number" min={0} max={100} placeholder="Rabatt %"
                    title="Zusätzlicher prozentualer Nachlass auf den Einzelpreis (0–100)."
                    value={li.discountPct}
                    onChange={(e) => updateLineItem(i, { discountPct: Number(e.target.value) })} />
                  <Button type="button" size="sm" variant="ghost" className="col-span-1"
                    title="Diese Position entfernen"
                    onClick={() => removeLineItem(i)} aria-label="Position entfernen">
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
              {lineItems.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Optional — Default-Positionen werden bei jedem neuen Angebot vorausgefüllt.</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={create.isPending} data-testid="template-form-submit">
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Vorlage erstellen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

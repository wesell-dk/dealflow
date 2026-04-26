import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePriceBundle,
  useUpdatePriceBundle,
  useReplacePriceBundleItems,
  useListPricingCategories,
  getListPriceBundlesQueryKey,
  type PriceBundle,
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
import { PricebookPickerDialog, type PricebookPickedItem } from "./pricebook-picker-dialog";

interface BundleEditItem {
  pricePositionId: string;
  name: string;
  sku?: string;
  quantity: number;
  customDiscountPct: number;
  listPrice: number;
  currency?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bundle?: PriceBundle | null;
}

export function BundleFormDialog({ open, onOpenChange, bundle }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!bundle;

  const createMut = useCreatePriceBundle();
  const updateMut = useUpdatePriceBundle();
  const replaceMut = useReplacePriceBundleItems();
  const categoriesQ = useListPricingCategories();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [items, setItems] = useState<BundleEditItem[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      if (bundle) {
        setName(bundle.name);
        setDescription(bundle.description ?? "");
        setCategory(bundle.category ?? "");
        setItems(bundle.items.map(it => ({
          pricePositionId: it.pricePositionId,
          name: it.name ?? it.pricePositionId,
          sku: it.sku ?? undefined,
          quantity: Number(it.quantity) || 1,
          customDiscountPct: Number(it.customDiscountPct) || 0,
          listPrice: it.listPrice ?? 0,
          currency: it.currency,
        })));
      } else {
        setName(""); setDescription(""); setCategory(""); setItems([]);
      }
    }
  }, [open, bundle]);

  const addPicked = (picked: PricebookPickedItem[]) => {
    const existingIds = new Set(items.map(i => i.pricePositionId));
    const additions: BundleEditItem[] = picked
      .filter(p => !existingIds.has(p.pricePositionId))
      .map(p => ({
        pricePositionId: p.pricePositionId,
        name: p.name,
        sku: p.description,
        quantity: p.quantity,
        customDiscountPct: p.discountPct,
        listPrice: p.listPrice,
        currency: null,
      }));
    setItems(curr => [...curr, ...additions]);
  };

  const updateItem = (idx: number, patch: Partial<BundleEditItem>) =>
    setItems(curr => curr.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const removeItem = (idx: number) =>
    setItems(curr => curr.filter((_, i) => i !== idx));

  const totalList = items.reduce((s, i) => s + (i.listPrice * i.quantity), 0);

  const submit = async () => {
    if (!name.trim()) {
      toast({ title: t("bundleForm.nameRequired"), variant: "destructive" });
      return;
    }
    try {
      if (isEdit && bundle) {
        await updateMut.mutateAsync({
          id: bundle.id,
          data: {
            name: name.trim(),
            description,
            category: category.trim() || null,
          },
        });
        await replaceMut.mutateAsync({
          id: bundle.id,
          data: {
            items: items.map((it, idx) => ({
              pricePositionId: it.pricePositionId,
              quantity: it.quantity,
              customDiscountPct: it.customDiscountPct,
              position: idx,
            })),
          },
        });
        toast({ title: t("bundleForm.updated"), description: name });
      } else {
        await createMut.mutateAsync({
          data: {
            name: name.trim(),
            description,
            category: category.trim() || null,
            items: items.map((it, idx) => ({
              pricePositionId: it.pricePositionId,
              quantity: it.quantity,
              customDiscountPct: it.customDiscountPct,
              position: idx,
            })),
          },
        });
        toast({ title: t("bundleForm.created"), description: name });
      }
      await qc.invalidateQueries({ queryKey: getListPriceBundlesQueryKey() });
      onOpenChange(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast({
        title: t("bundleForm.saveFailed"),
        description: err?.response?.data?.error ?? String(e),
        variant: "destructive",
      });
    }
  };

  const isPending = createMut.isPending || updateMut.isPending || replaceMut.isPending;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl" data-testid="bundle-form-dialog">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? t("bundleForm.editTitle") : t("bundleForm.createTitle")}
            </DialogTitle>
            <DialogDescription>{t("bundleForm.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2 col-span-2">
                <Label>{t("common.name")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("bundleForm.namePlaceholder")}
                  data-testid="input-bundle-name"
                />
              </div>
              <div className="grid gap-2 col-span-2">
                <Label>{t("common.description")}</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  data-testid="input-bundle-description"
                />
              </div>
              <div className="grid gap-2">
                <Label>{t("pages.pricing.category")}</Label>
                <Select
                  value={category || "__none__"}
                  onValueChange={(v) => setCategory(v === "__none__" ? "" : v)}
                >
                  <SelectTrigger data-testid="input-bundle-category">
                    <SelectValue placeholder={categoriesQ.isLoading ? "Lade …" : "—"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" textValue="—">—</SelectItem>
                    {(categoriesQ.data ?? [])
                      .filter(c => c.status === "active")
                      .map(c => (
                        <SelectItem key={c.id} value={c.name} textValue={c.name}>
                          <span className="font-mono text-xs mr-2">{c.code}</span>
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <Label>{t("bundleForm.items")}</Label>
                <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} data-testid="bundle-form-add-items">
                  <Plus className="h-4 w-4 mr-1" />
                  {t("bundleForm.addPositions")}
                </Button>
              </div>
              <div className="rounded-md border max-h-[35vh] overflow-y-auto">
                {items.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    {t("bundleForm.noItems")}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">{t("common.name")}</th>
                        <th className="text-right px-3 py-2 font-medium w-24">{t("quoteWizard.qty")}</th>
                        <th className="text-right px-3 py-2 font-medium w-24">% {t("common.discount")}</th>
                        <th className="text-right px-3 py-2 font-medium w-28">{t("quoteWizard.listPrice")}</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => (
                        <tr key={`${it.pricePositionId}-${idx}`} className="border-t" data-testid={`bundle-form-item-${idx}`}>
                          <td className="px-3 py-2">
                            <div>{it.name}</div>
                            {it.sku && <div className="text-xs text-muted-foreground font-mono">{it.sku}</div>}
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number" min={0.01} step="0.01" value={it.quantity}
                              onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                              className="text-right h-8"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number" min={0} max={100} step="0.1" value={it.customDiscountPct}
                              onChange={(e) => updateItem(idx, { customDiscountPct: Number(e.target.value) })}
                              className="text-right h-8"
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            {it.listPrice.toLocaleString()} {it.currency ?? ""}
                          </td>
                          <td className="px-3 py-2">
                            <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              {items.length > 0 && (
                <div className="text-right text-sm mt-2">
                  <span className="text-muted-foreground">{t("bundlePicker.totalList")}: </span>
                  <span className="font-bold tabular-nums">
                    {totalList.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
            <Button onClick={submit} disabled={isPending} data-testid="bundle-form-submit">
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? t("common.save") : t("bundleForm.createTitle")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <PricebookPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onConfirm={addPicked}
      />
    </>
  );
}

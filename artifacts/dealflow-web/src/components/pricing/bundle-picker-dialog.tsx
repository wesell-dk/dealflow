import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useListPriceBundles } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Package } from "lucide-react";
import type { PricebookPickedItem } from "./pricebook-picker-dialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (items: PricebookPickedItem[]) => void;
}

export function BundlePickerDialog({ open, onOpenChange, onConfirm }: Props) {
  const { t } = useTranslation();
  const { data: bundles, isLoading } = useListPriceBundles();
  const [pickedId, setPickedId] = useState<string | null>(null);

  const handleConfirm = () => {
    if (!pickedId || !bundles) return;
    const bundle = bundles.find(b => b.id === pickedId);
    if (!bundle) return;
    const items: PricebookPickedItem[] = bundle.items.map(it => {
      const list = it.listPrice ?? 0;
      const discount = Number(it.customDiscountPct) || 0;
      const unit = list * (1 - discount / 100);
      return {
        pricePositionId: it.pricePositionId,
        name: it.name ?? it.pricePositionId,
        description: it.sku ?? `${bundle.name}`,
        quantity: Number(it.quantity) || 1,
        listPrice: list,
        unitPrice: Math.round(unit * 100) / 100,
        discountPct: discount,
      };
    });
    onConfirm(items);
    setPickedId(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setPickedId(null); onOpenChange(v); }}>
      <DialogContent className="max-w-2xl" data-testid="bundle-picker-dialog">
        <DialogHeader>
          <DialogTitle>{t("bundlePicker.title")}</DialogTitle>
          <DialogDescription>{t("bundlePicker.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 max-h-[55vh] overflow-y-auto">
          {isLoading ? (
            <>
              {[0,1,2].map(i => <Skeleton key={i} className="h-20 w-full" />)}
            </>
          ) : !bundles || bundles.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground border rounded-md">
              {t("bundlePicker.empty")}
            </div>
          ) : (
            bundles.map(b => {
              const selected = pickedId === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setPickedId(b.id)}
                  className={`text-left rounded-md border p-3 transition-colors hover:bg-muted/40 ${selected ? "border-primary bg-primary/5" : ""}`}
                  data-testid={`bundle-card-${b.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      <Package className="h-5 w-5 mt-0.5 text-primary" />
                      <div>
                        <div className="font-medium">{b.name}</div>
                        {b.description && <div className="text-xs text-muted-foreground mt-0.5">{b.description}</div>}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {b.category && <Badge variant="secondary" className="text-[10px]">{b.category}</Badge>}
                          <Badge variant="outline" className="text-[10px]">
                            {t("bundlePicker.itemsCount", { count: b.itemCount })}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">{t("bundlePicker.totalList")}</div>
                      <div className="font-bold tabular-nums text-sm">
                        {b.totalListPrice.toLocaleString()} {b.currency ?? ""}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            onClick={handleConfirm}
            disabled={!pickedId}
            data-testid="bundle-picker-confirm"
          >
            {t("bundlePicker.addBundle")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

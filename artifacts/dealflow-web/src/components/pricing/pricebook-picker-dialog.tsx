import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useListPricePositions, type PricePosition } from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search } from "lucide-react";

export interface PricebookPickedItem {
  pricePositionId: string;
  name: string;
  description?: string;
  quantity: number;
  listPrice: number;
  unitPrice: number;
  discountPct: number;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (items: PricebookPickedItem[]) => void;
}

interface PickState { selected: boolean; quantity: number }

export function PricebookPickerDialog({ open, onOpenChange, onConfirm }: Props) {
  const { t } = useTranslation();
  const { data: positions, isLoading } = useListPricePositions();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("");
  const [picks, setPicks] = useState<Record<string, PickState>>({});

  const categories = useMemo(() => {
    const set = new Set<string>();
    positions?.forEach(p => p.category && set.add(p.category));
    return ["", ...Array.from(set).sort()];
  }, [positions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (positions ?? []).filter(p => {
      if (category && p.category !== category) return false;
      if (!q) return true;
      return (
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [positions, search, category]);

  const togglePick = (pos: PricePosition) => {
    setPicks(prev => {
      const cur = prev[pos.id];
      if (cur?.selected) {
        return { ...prev, [pos.id]: { selected: false, quantity: cur.quantity || 1 } };
      }
      return { ...prev, [pos.id]: { selected: true, quantity: cur?.quantity || 1 } };
    });
  };
  const setQty = (id: string, q: number) =>
    setPicks(prev => ({ ...prev, [id]: { selected: prev[id]?.selected ?? false, quantity: Math.max(0.01, q) } }));

  const selectedCount = Object.values(picks).filter(p => p.selected).length;

  const handleConfirm = () => {
    if (!positions) return;
    const result: PricebookPickedItem[] = [];
    for (const p of positions) {
      const pk = picks[p.id];
      if (!pk?.selected) continue;
      const qty = pk.quantity || 1;
      result.push({
        pricePositionId: p.id,
        name: p.name,
        description: p.sku,
        quantity: qty,
        listPrice: p.listPrice,
        unitPrice: p.listPrice,
        discountPct: 0,
      });
    }
    onConfirm(result);
    setPicks({});
    onOpenChange(false);
  };

  const close = () => { setPicks({}); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setPicks({}); onOpenChange(v); }}>
      <DialogContent className="max-w-3xl" data-testid="pricebook-picker-dialog">
        <DialogHeader>
          <DialogTitle>{t("pricebookPicker.title")}</DialogTitle>
          <DialogDescription>{t("pricebookPicker.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("pricebookPicker.searchPlaceholder")}
                className="pl-8"
                data-testid="pricebook-picker-search"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-md border bg-background px-3 text-sm"
              data-testid="pricebook-picker-category"
            >
              {categories.map(c => (
                <option key={c} value={c}>{c || t("pricebookPicker.allCategories")}</option>
              ))}
            </select>
          </div>
          <div className="rounded-md border max-h-[50vh] overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {[0,1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {t("pricebookPicker.empty")}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="w-10"></th>
                    <th className="text-left px-3 py-2 font-medium">SKU</th>
                    <th className="text-left px-3 py-2 font-medium">{t("common.name")}</th>
                    <th className="text-left px-3 py-2 font-medium">{t("pages.pricing.category")}</th>
                    <th className="text-right px-3 py-2 font-medium">{t("quoteWizard.listPrice")}</th>
                    <th className="text-right px-3 py-2 font-medium w-24">{t("quoteWizard.qty")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => {
                    const pick = picks[p.id];
                    return (
                      <tr
                        key={p.id}
                        className={`border-t hover:bg-muted/30 ${pick?.selected ? "bg-primary/5" : ""}`}
                        data-testid={`pricebook-row-${p.id}`}
                      >
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={!!pick?.selected}
                            onCheckedChange={() => togglePick(p)}
                            data-testid={`pricebook-check-${p.id}`}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                        <td className="px-3 py-2">
                          <div>{p.name}</div>
                          {p.isStandard && <Badge variant="secondary" className="text-[10px] mt-0.5">STD</Badge>}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{p.category}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {p.listPrice.toLocaleString()} {p.currency}
                        </td>
                        <td className="px-3 py-2">
                          <Input
                            type="number"
                            min={0.01}
                            step="0.01"
                            value={pick?.quantity ?? 1}
                            onChange={(e) => setQty(p.id, Number(e.target.value))}
                            disabled={!pick?.selected}
                            className="text-right h-8"
                            data-testid={`pricebook-qty-${p.id}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <DialogFooter className="flex items-center sm:justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {t("pricebookPicker.selectedCount", { count: selectedCount })}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={close}>{t("common.cancel")}</Button>
            <Button
              onClick={handleConfirm}
              disabled={selectedCount === 0}
              data-testid="pricebook-picker-confirm"
            >
              {t("pricebookPicker.applyN", { count: selectedCount })}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetQuote,
  useReplaceQuoteLineItems,
  useListPricePositions,
  getGetQuoteQueryKey,
  type LineItem,
  type PricePosition,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Plus,
  Trash2,
  Heading1,
  Library,
  Package,
  Loader2,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { PricebookPickerDialog, type PricebookPickedItem } from "@/components/pricing/pricebook-picker-dialog";
import { BundlePickerDialog } from "@/components/pricing/bundle-picker-dialog";

type EditorRow = {
  rowKey: string;
  kind: "item" | "heading";
  name: string;
  description: string;
  quantity: number;
  listPrice: number;
  discountPct: number;
};

function fromLineItem(li: LineItem): EditorRow {
  return {
    rowKey: li.id,
    kind: li.kind === "heading" ? "heading" : "item",
    name: li.name,
    description: li.description ?? "",
    quantity: li.quantity ?? 1,
    listPrice: li.listPrice ?? li.unitPrice ?? 0,
    discountPct: li.discountPct ?? 0,
  };
}

function newRow(kind: "item" | "heading"): EditorRow {
  return {
    rowKey: `tmp_${Math.random().toString(36).slice(2, 10)}`,
    kind,
    name: "",
    description: "",
    quantity: kind === "heading" ? 0 : 1,
    listPrice: 0,
    discountPct: 0,
  };
}

function rowTotal(r: EditorRow): number {
  if (r.kind === "heading") return 0;
  const eff = r.listPrice * (1 - (r.discountPct || 0) / 100);
  return Math.round(eff * (r.quantity || 0) * 100) / 100;
}

interface SortableRowProps {
  row: EditorRow;
  index: number;
  onChange: (next: EditorRow) => void;
  onRemove: () => void;
  positions: PricePosition[] | undefined;
  currency: string;
}

function SortableRow({ row, index, onChange, onRemove, positions, currency }: SortableRowProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.rowKey,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const [popOpen, setPopOpen] = useState(false);
  const total = rowTotal(row);

  const filteredPositions = useMemo(() => {
    if (!positions) return [];
    const q = row.name.trim().toLowerCase();
    if (!q) return positions.slice(0, 8);
    return positions
      .filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [positions, row.name]);

  function applyPosition(p: PricePosition) {
    onChange({
      ...row,
      name: p.name,
      listPrice: p.listPrice,
    });
    setPopOpen(false);
  }

  if (row.kind === "heading") {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className="group flex items-center gap-2 rounded-md border-2 border-primary/30 bg-muted/40 px-2 py-2"
        data-testid={`row-heading-${index}`}
      >
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground hover:text-foreground"
          aria-label="Drag"
          data-testid={`row-drag-${index}`}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Heading1 className="h-4 w-4 text-muted-foreground" />
        <Input
          value={row.name}
          onChange={(e) => onChange({ ...row, name: e.target.value })}
          placeholder={t("quoteEditor.headingPlaceholder")}
          className="flex-1 text-base font-semibold"
          data-testid={`row-heading-name-${index}`}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={t("common.delete")}
          data-testid={`row-remove-${index}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group grid grid-cols-[auto_1fr_80px_120px_90px_110px_auto] items-start gap-2 rounded-md border bg-card p-2"
      data-testid={`row-item-${index}`}
    >
      <button
        {...attributes}
        {...listeners}
        className="mt-2 cursor-grab text-muted-foreground hover:text-foreground"
        aria-label="Drag"
        data-testid={`row-drag-${index}`}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex flex-col gap-1">
        <Popover open={popOpen} onOpenChange={setPopOpen}>
          <PopoverTrigger asChild>
            <Input
              value={row.name}
              onChange={(e) => {
                onChange({ ...row, name: e.target.value });
                if (!popOpen) setPopOpen(true);
              }}
              onFocus={() => setPopOpen(true)}
              placeholder={t("quoteEditor.namePlaceholder")}
              data-testid={`row-name-${index}`}
            />
          </PopoverTrigger>
          <PopoverContent className="w-[420px] p-0" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
            <Command shouldFilter={false}>
              <CommandInput
                placeholder={t("quoteEditor.searchPricebook")}
                value={row.name}
                onValueChange={(v) => onChange({ ...row, name: v })}
              />
              <CommandList>
                <CommandEmpty>{t("quoteEditor.noPricebookMatch")}</CommandEmpty>
                <CommandGroup heading={t("quoteEditor.pricebookGroup")}>
                  {filteredPositions.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() => applyPosition(p)}
                      data-testid={`pricebook-suggestion-${p.id}`}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {p.sku ? `${p.sku} · ` : ""}
                          {p.listPrice.toLocaleString()} {currency}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        <Input
          value={row.description}
          onChange={(e) => onChange({ ...row, description: e.target.value })}
          placeholder={t("quoteEditor.descriptionPlaceholder")}
          className="text-sm"
          data-testid={`row-description-${index}`}
        />
      </div>

      <Input
        type="number"
        min={0}
        step="any"
        value={row.quantity}
        onChange={(e) => onChange({ ...row, quantity: parseFloat(e.target.value) || 0 })}
        className="text-right"
        data-testid={`row-qty-${index}`}
      />

      <Input
        type="number"
        min={0}
        step="0.01"
        value={row.listPrice}
        onChange={(e) => onChange({ ...row, listPrice: parseFloat(e.target.value) || 0 })}
        className="text-right"
        data-testid={`row-price-${index}`}
      />

      <Input
        type="number"
        min={0}
        max={100}
        step="0.1"
        value={row.discountPct}
        onChange={(e) => onChange({ ...row, discountPct: parseFloat(e.target.value) || 0 })}
        className="text-right"
        data-testid={`row-discount-${index}`}
      />

      <div className="pt-2 text-right font-semibold tabular-nums" data-testid={`row-total-${index}`}>
        {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label={t("common.delete")}
        data-testid={`row-remove-${index}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface QuoteEditorProps {
  quoteId: string;
}

export function QuoteEditor({ quoteId }: QuoteEditorProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: quote } = useGetQuote(quoteId);
  const { data: positions } = useListPricePositions();
  const replace = useReplaceQuoteLineItems();
  const versionId = quote?.versions?.[0]?.id ?? "";

  const [rows, setRows] = useState<EditorRow[]>([]);
  const [pdfNonce, setPdfNonce] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pricebookOpen, setPricebookOpen] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  const dirtyRef = useRef(false);
  const initializedRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Initial hydration from API (only first time we get data).
  useEffect(() => {
    if (initializedRef.current || !quote) return;
    setRows((quote.lineItems ?? []).map(fromLineItem));
    initializedRef.current = true;
  }, [quote]);

  // Debounced auto-save.
  useEffect(() => {
    if (!initializedRef.current) return;
    if (!dirtyRef.current) return;
    if (!versionId) return;
    setSaveState("saving");
    const handle = setTimeout(async () => {
      try {
        await replace.mutateAsync({
          id: versionId,
          data: {
            items: rows.map((r, idx) => ({
              kind: r.kind,
              sortOrder: idx,
              name: r.name || (r.kind === "heading" ? t("quoteEditor.headingPlaceholder") : t("quoteEditor.namePlaceholder")),
              description: r.description || undefined,
              quantity: r.kind === "heading" ? 0 : r.quantity,
              listPrice: r.kind === "heading" ? 0 : r.listPrice,
              unitPrice: r.kind === "heading" ? 0 : r.listPrice * (1 - (r.discountPct || 0) / 100),
              discountPct: r.kind === "heading" ? 0 : r.discountPct,
            })),
          },
        });
        await qc.invalidateQueries({ queryKey: getGetQuoteQueryKey(quoteId) });
        dirtyRef.current = false;
        setSaveState("saved");
        setPdfNonce((n) => n + 1);
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [rows, quoteId, replace, qc, t]);

  function update(rowKey: string, patch: Partial<EditorRow>) {
    dirtyRef.current = true;
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));
  }

  function changeRow(rowKey: string, next: EditorRow) {
    update(rowKey, next);
  }

  function removeRow(rowKey: string) {
    dirtyRef.current = true;
    setRows((prev) => prev.filter((r) => r.rowKey !== rowKey));
  }

  function addRow(kind: "item" | "heading") {
    dirtyRef.current = true;
    setRows((prev) => [...prev, newRow(kind)]);
  }

  function appendPicked(items: PricebookPickedItem[]) {
    if (!items.length) return;
    dirtyRef.current = true;
    setRows((prev) => [
      ...prev,
      ...items.map((it) => ({
        rowKey: `tmp_${Math.random().toString(36).slice(2, 10)}`,
        kind: "item" as const,
        name: it.name,
        description: it.description ?? "",
        quantity: it.quantity,
        listPrice: it.listPrice,
        discountPct: it.discountPct,
      })),
    ]);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setRows((prev) => {
      const oldIdx = prev.findIndex((r) => r.rowKey === active.id);
      const newIdx = prev.findIndex((r) => r.rowKey === over.id);
      if (oldIdx < 0 || newIdx < 0) return prev;
      dirtyRef.current = true;
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  const currency = quote?.currency ?? "EUR";
  const subtotal = rows.reduce((s, r) => s + rowTotal(r), 0);
  const itemCount = rows.filter((r) => r.kind === "item").length;
  const headingCount = rows.filter((r) => r.kind === "heading").length;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>{t("quoteEditor.title")}</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="save-state">
              {saveState === "saving" && (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {t("quoteEditor.saving")}
                </span>
              )}
              {saveState === "saved" && (
                <span className="flex items-center gap-1 text-green-600">
                  <Check className="h-3 w-3" /> {t("quoteEditor.saved")}
                </span>
              )}
              {saveState === "error" && (
                <span className="text-destructive">{t("quoteEditor.saveError")}</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-[auto_1fr_80px_120px_90px_110px_auto] items-center gap-2 px-2 text-xs font-medium uppercase text-muted-foreground">
              <div />
              <div>{t("quoteEditor.colName")}</div>
              <div className="text-right">{t("quoteEditor.colQty")}</div>
              <div className="text-right">{t("quoteEditor.colPrice")}</div>
              <div className="text-right">{t("quoteEditor.colDiscount")}</div>
              <div className="text-right">{t("quoteEditor.colTotal")}</div>
              <div />
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={rows.map((r) => r.rowKey)} strategy={verticalListSortingStrategy}>
                <div className="flex flex-col gap-2" data-testid="editor-rows">
                  {rows.map((r, idx) => (
                    <SortableRow
                      key={r.rowKey}
                      row={r}
                      index={idx}
                      onChange={(next) => changeRow(r.rowKey, next)}
                      onRemove={() => removeRow(r.rowKey)}
                      positions={positions}
                      currency={currency}
                    />
                  ))}
                  {rows.length === 0 && (
                    <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                      {t("quoteEditor.empty")}
                    </div>
                  )}
                </div>
              </SortableContext>
            </DndContext>

            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => addRow("item")} data-testid="add-item-btn">
                <Plus className="mr-1 h-4 w-4" /> {t("quoteEditor.addItem")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => addRow("heading")} data-testid="add-heading-btn">
                <Heading1 className="mr-1 h-4 w-4" /> {t("quoteEditor.addHeading")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPricebookOpen(true)} data-testid="add-pricebook-btn">
                <Library className="mr-1 h-4 w-4" /> {t("quoteEditor.addFromPricebook")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setBundleOpen(true)} data-testid="add-bundle-btn">
                <Package className="mr-1 h-4 w-4" /> {t("quoteEditor.addBundle")}
              </Button>
            </div>

            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                {t("quoteEditor.summary", { items: itemCount, headings: headingCount })}
              </span>
              <span className="text-base font-bold tabular-nums" data-testid="editor-subtotal">
                {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currency}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t("quoteEditor.previewTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <iframe
              key={pdfNonce}
              title={t("quoteEditor.previewTitle")}
              src={`/api/quotes/${quoteId}/pdf#nonce=${pdfNonce}`}
              className="h-[80vh] w-full rounded-b-md border-0"
              data-testid="pdf-preview-iframe"
            />
          </CardContent>
        </Card>
      </div>

      <PricebookPickerDialog
        open={pricebookOpen}
        onOpenChange={setPricebookOpen}
        onConfirm={(items) => {
          appendPicked(items);
          setPricebookOpen(false);
        }}
      />
      <BundlePickerDialog
        open={bundleOpen}
        onOpenChange={setBundleOpen}
        onConfirm={(items) => {
          appendPicked(items);
          setBundleOpen(false);
        }}
      />
    </div>
  );
}

import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  AlertCircle,
  Eye,
  Columns2,
  Pencil,
  Keyboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  PricebookPickerDialog,
  type PricebookPickedItem,
} from "@/components/pricing/pricebook-picker-dialog";
import { BundlePickerDialog } from "@/components/pricing/bundle-picker-dialog";
import {
  QuotePreview,
  type QuotePreviewLine,
} from "@/components/quotes/quote-preview";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight } from "lucide-react";

type EditorRow = {
  rowKey: string;
  kind: "item" | "heading";
  name: string;
  description: string;
  quantity: number;
  listPrice: number;
  discountPct: number;
  /**
   * NULL = inherit (Brand-Default → Tenant-Default → 19). Persisted to API as
   * `taxRatePct` on the LineItemInput.
   */
  taxRatePct: number | null;
};

type LayoutMode = "edit" | "split" | "preview";
const LAYOUT_KEY = "dealflow.quote-editor.layout";

function fromLineItem(li: LineItem): EditorRow {
  // The server always returns a resolved `taxRatePct`. We only treat it as an
  // explicit override when the source is "line" — otherwise we want the editor
  // to keep showing "inherit" so future brand/tenant changes flow through.
  const source = (li as { taxRatePctSource?: string }).taxRatePctSource;
  const explicit = source === "line";
  return {
    rowKey: li.id,
    kind: li.kind === "heading" ? "heading" : "item",
    name: li.name,
    description: li.description ?? "",
    quantity: li.quantity ?? 1,
    listPrice: li.listPrice ?? li.unitPrice ?? 0,
    discountPct: li.discountPct ?? 0,
    taxRatePct: explicit ? Number(li.taxRatePct) : null,
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
    taxRatePct: null,
  };
}

function rowTotal(r: EditorRow): number {
  if (r.kind === "heading") return 0;
  const eff = r.listPrice * (1 - (r.discountPct || 0) / 100);
  return Math.round(eff * (r.quantity || 0) * 100) / 100;
}

function rowErrors(r: EditorRow): {
  name?: boolean;
  quantity?: boolean;
  price?: boolean;
  discount?: boolean;
} {
  if (r.kind === "heading") {
    return { name: !r.name.trim() };
  }
  return {
    name: !r.name.trim(),
    quantity: !(r.quantity > 0),
    price: r.listPrice < 0,
    discount: r.discountPct < 0 || r.discountPct > 100,
  };
}

function readLayout(): LayoutMode {
  if (typeof window === "undefined") return "split";
  try {
    const v = window.localStorage.getItem(LAYOUT_KEY);
    if (v === "edit" || v === "split" || v === "preview") return v;
  } catch {
    /* ignore */
  }
  return "split";
}

function writeLayout(v: LayoutMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAYOUT_KEY, v);
  } catch {
    /* ignore */
  }
}

function deriveTaxSummary(rows: EditorRow[], fallback: number) {
  const buckets = new Map<number, { net: number; tax: number }>();
  let net = 0;
  for (const r of rows) {
    if (r.kind !== "item") continue;
    const total = rowTotal(r);
    const rate = r.taxRatePct ?? fallback;
    net += total;
    const b = buckets.get(rate) ?? { net: 0, tax: 0 };
    b.net += total;
    b.tax += Math.round(total * (rate / 100) * 100) / 100;
    buckets.set(rate, b);
  }
  let tax = 0;
  const breakdown: { ratePct: number; net: number; tax: number }[] = [];
  for (const [ratePct, v] of [...buckets.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    tax += v.tax;
    breakdown.push({ ratePct, net: v.net, tax: v.tax });
  }
  return {
    net: Math.round(net * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    gross: Math.round((net + tax) * 100) / 100,
    breakdown,
  };
}

interface SortableRowProps {
  row: EditorRow;
  index: number;
  onChange: (next: EditorRow) => void;
  onRemove: () => void;
  positions: PricePosition[] | undefined;
  currency: string;
  brandTaxRatePct: number;
  taxRateOptions: number[];
  onEnterInsertAfter: () => void;
  onBackspaceEmpty: (rowKey: string) => void;
  registerNameInput: (rowKey: string, el: HTMLInputElement | null) => void;
}

function SortableRow({
  row,
  index,
  onChange,
  onRemove,
  positions,
  currency,
  brandTaxRatePct,
  taxRateOptions,
  onEnterInsertAfter,
  onBackspaceEmpty,
  registerNameInput,
}: SortableRowProps) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.rowKey });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const [popOpen, setPopOpen] = useState(false);
  const total = rowTotal(row);
  const errors = rowErrors(row);

  const filteredPositions = useMemo(() => {
    if (!positions) return [];
    const q = row.name.trim().toLowerCase();
    if (!q) return positions.slice(0, 8);
    return positions
      .filter(
        (p) =>
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

  function onNameKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && row.name === "" && row.kind !== "heading") {
      const empty =
        row.description === "" &&
        row.discountPct === 0 &&
        row.listPrice === 0;
      if (empty) {
        e.preventDefault();
        onBackspaceEmpty(row.rowKey);
      }
      return;
    }
    // Enter on the name input inserts a new row directly after the current
    // one, but only if the pricebook popover is closed; if it's open we let
    // Command handle suggestion selection by ignoring Enter here.
    if (e.key === "Enter" && !popOpen) {
      e.preventDefault();
      onEnterInsertAfter();
    }
  }

  function onFieldKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      onEnterInsertAfter();
    }
  }

  if (row.kind === "heading") {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          "group flex items-center gap-2 rounded-md border-2 bg-muted/40 px-2 py-2",
          errors.name ? "border-destructive/50" : "border-primary/30",
        )}
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
          ref={(el) => registerNameInput(row.rowKey, el)}
          value={row.name}
          onChange={(e) => onChange({ ...row, name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && row.name === "") {
              e.preventDefault();
              onBackspaceEmpty(row.rowKey);
            } else if (e.key === "Enter") {
              e.preventDefault();
              onEnterInsertAfter();
            }
          }}
          placeholder={t("quoteEditor.headingPlaceholder")}
          aria-invalid={errors.name || undefined}
          className={cn(
            "flex-1 text-base font-semibold",
            errors.name && "border-destructive focus-visible:ring-destructive",
          )}
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
      className={cn(
        "group flex flex-col gap-2 rounded-md border bg-card p-3 transition-colors",
        "md:grid md:grid-cols-[auto_2rem_minmax(0,1fr)_72px_110px_72px_110px_110px_auto] md:items-start md:p-2",
        Object.values(errors).some(Boolean) && "border-destructive/50",
      )}
      data-testid={`row-item-${index}`}
    >
      {/* Mobile header: drag + index + remove */}
      <div className="flex items-center justify-between md:contents">
        <div className="flex items-center gap-2 md:contents">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab text-muted-foreground hover:text-foreground md:mt-2"
            aria-label="Drag"
            data-testid={`row-drag-${index}`}
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="select-none text-xs text-muted-foreground tabular-nums md:mt-2 md:text-center">
            #{index + 1}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onRemove}
          aria-label={t("common.delete")}
          data-testid={`row-remove-${index}-mobile`}
          className="md:hidden"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-1 min-w-0">
        <Popover open={popOpen} onOpenChange={setPopOpen}>
          <PopoverTrigger asChild>
            <Input
              ref={(el) => registerNameInput(row.rowKey, el)}
              value={row.name}
              onChange={(e) => {
                onChange({ ...row, name: e.target.value });
                if (!popOpen) setPopOpen(true);
              }}
              onFocus={() => setPopOpen(true)}
              onKeyDown={onNameKeyDown}
              placeholder={t("quoteEditor.namePlaceholder")}
              aria-invalid={errors.name || undefined}
              className={cn(
                errors.name && "border-destructive focus-visible:ring-destructive",
              )}
              data-testid={`row-name-${index}`}
            />
          </PopoverTrigger>
          <PopoverContent
            className="w-[420px] p-0"
            align="start"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
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
        {errors.name && (
          <p
            className="text-xs text-destructive"
            data-testid={`row-name-error-${index}`}
          >
            {t("quoteEditor.errorNameRequired")}
          </p>
        )}
      </div>

      {/* Numeric cells: 2-column labelled grid on mobile, individual grid
          cells on md+ via `md:contents`. */}
      <div className="grid grid-cols-2 gap-2 md:contents">
        <label className="flex flex-col gap-1 md:contents">
          <span className="text-xs text-muted-foreground md:hidden">
            {t("quoteEditor.colQty")}
          </span>
          <Input
            type="number"
            min={0}
            step="any"
            value={row.quantity}
            onChange={(e) =>
              onChange({ ...row, quantity: parseFloat(e.target.value) || 0 })
            }
            onKeyDown={onFieldKeyDown}
            aria-invalid={errors.quantity || undefined}
            className={cn(
              "text-right",
              errors.quantity &&
                "border-destructive focus-visible:ring-destructive",
            )}
            data-testid={`row-qty-${index}`}
          />
          {errors.quantity && (
            <p
              className="text-xs text-destructive md:hidden"
              data-testid={`row-qty-error-${index}`}
            >
              {t("quoteEditor.errorQtyInvalid")}
            </p>
          )}
        </label>

        <label className="flex flex-col gap-1 md:contents">
          <span className="text-xs text-muted-foreground md:hidden">
            {t("quoteEditor.colPrice")}
          </span>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={row.listPrice}
            onChange={(e) =>
              onChange({ ...row, listPrice: parseFloat(e.target.value) || 0 })
            }
            onKeyDown={onFieldKeyDown}
            aria-invalid={errors.price || undefined}
            className={cn(
              "text-right",
              errors.price &&
                "border-destructive focus-visible:ring-destructive",
            )}
            data-testid={`row-price-${index}`}
          />
          {errors.price && (
            <p
              className="text-xs text-destructive md:hidden"
              data-testid={`row-price-error-${index}`}
            >
              {t("quoteEditor.errorPriceInvalid")}
            </p>
          )}
        </label>

        <label className="flex flex-col gap-1 md:contents">
          <span className="text-xs text-muted-foreground md:hidden">
            {t("quoteEditor.colDiscount")}
          </span>
          <Input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={row.discountPct}
            onChange={(e) =>
              onChange({ ...row, discountPct: parseFloat(e.target.value) || 0 })
            }
            onKeyDown={onFieldKeyDown}
            aria-invalid={errors.discount || undefined}
            className={cn(
              "text-right",
              errors.discount &&
                "border-destructive focus-visible:ring-destructive",
            )}
            data-testid={`row-discount-${index}`}
          />
          {errors.discount && (
            <p
              className="text-xs text-destructive md:hidden"
              data-testid={`row-discount-error-${index}`}
            >
              {t("quoteEditor.errorDiscountInvalid")}
            </p>
          )}
        </label>

        <label className="flex flex-col gap-1 md:contents">
          <span className="text-xs text-muted-foreground md:hidden">
            {t("quoteEditor.colTax")}
          </span>
          <Select
            value={row.taxRatePct === null ? "inherit" : String(row.taxRatePct)}
            onValueChange={(v) =>
              onChange({
                ...row,
                taxRatePct: v === "inherit" ? null : Number(v),
              })
            }
          >
            <SelectTrigger
              className="h-9 w-full"
              data-testid={`row-tax-${index}`}
              aria-label={t("quoteEditor.colTax")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">
                {t("quoteEditor.taxInherit", {
                  pct: brandTaxRatePct.toLocaleString(),
                })}
              </SelectItem>
              {taxRateOptions.map((rate) => (
                <SelectItem key={rate} value={String(rate)}>
                  {rate === 0 ? t("quoteEditor.taxFree") : `${rate}%`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <div className="flex items-center justify-between pt-1 md:contents">
        <span className="text-xs text-muted-foreground md:hidden">
          {t("quoteEditor.colTotal")}
        </span>
        <div
          className="text-right font-semibold tabular-nums md:pt-2"
          data-testid={`row-total-${index}`}
        >
          {total.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}{" "}
          {currency}
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label={t("common.delete")}
        data-testid={`row-remove-${index}`}
        onKeyDown={onFieldKeyDown}
        className="hidden md:inline-flex"
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
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [pricebookOpen, setPricebookOpen] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [layout, setLayout] = useState<LayoutMode>(() => readLayout());
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const isMobile = useIsMobile();
  const dirtyRef = useRef(false);
  const initializedRef = useRef(false);
  const nameInputsRef = useRef(new Map<string, HTMLInputElement>());
  const focusNextRef = useRef<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Initial hydration from API (only first time we get data).
  useEffect(() => {
    if (initializedRef.current || !quote) return;
    setRows((quote.lineItems ?? []).map(fromLineItem));
    initializedRef.current = true;
  }, [quote]);

  // Persist layout choice.
  useEffect(() => {
    writeLayout(layout);
  }, [layout]);

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
              name:
                r.name ||
                (r.kind === "heading"
                  ? t("quoteEditor.headingPlaceholder")
                  : t("quoteEditor.namePlaceholder")),
              description: r.description || undefined,
              quantity: r.kind === "heading" ? 0 : r.quantity,
              listPrice: r.kind === "heading" ? 0 : r.listPrice,
              unitPrice:
                r.kind === "heading"
                  ? 0
                  : r.listPrice * (1 - (r.discountPct || 0) / 100),
              discountPct: r.kind === "heading" ? 0 : r.discountPct,
              taxRatePct: r.kind === "heading" ? null : r.taxRatePct,
            })),
          },
        });
        await qc.invalidateQueries({ queryKey: getGetQuoteQueryKey(quoteId) });
        dirtyRef.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [rows, quoteId, replace, qc, t, versionId]);

  // Focus newly added rows after they render.
  useEffect(() => {
    const key = focusNextRef.current;
    if (!key) return;
    const el = nameInputsRef.current.get(key);
    if (el) {
      el.focus();
      focusNextRef.current = null;
    }
  }, [rows]);

  const registerNameInput = useCallback(
    (rowKey: string, el: HTMLInputElement | null) => {
      if (el) nameInputsRef.current.set(rowKey, el);
      else nameInputsRef.current.delete(rowKey);
    },
    [],
  );

  function changeRow(rowKey: string, next: EditorRow) {
    dirtyRef.current = true;
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? next : r)));
  }

  function removeRowByKey(rowKey: string) {
    dirtyRef.current = true;
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.rowKey === rowKey);
      const next = prev.filter((r) => r.rowKey !== rowKey);
      // Move focus to the previous row's name input, if any.
      if (idx > 0) {
        const prevKey = prev[idx - 1].rowKey;
        focusNextRef.current = prevKey;
      }
      return next;
    });
  }

  function addRow(kind: "item" | "heading") {
    dirtyRef.current = true;
    const r = newRow(kind);
    focusNextRef.current = r.rowKey;
    setRows((prev) => [...prev, r]);
  }

  function insertRowAfter(idx: number) {
    dirtyRef.current = true;
    const r = newRow("item");
    focusNextRef.current = r.rowKey;
    setRows((prev) => {
      const next = prev.slice();
      next.splice(idx + 1, 0, r);
      return next;
    });
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
        taxRatePct: null as number | null,
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

  // Global keyboard shortcuts: Cmd/Ctrl+Enter adds a row.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        addRow("item");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const currency = quote?.currency ?? "EUR";
  const subtotal = rows.reduce((s, r) => s + rowTotal(r), 0);
  const itemCount = rows.filter((r) => r.kind === "item").length;
  const headingCount = rows.filter((r) => r.kind === "heading").length;

  // Brand-resolved tax rate for "inherit" hint. We use the first item's
  // server-resolved rate as a proxy when no override is set; falls back to 19.
  const brandTaxRatePct = useMemo(() => {
    const li = quote?.lineItems?.find((x) => x.kind !== "heading");
    if (!li) return 19;
    const src = (li as { taxRatePctSource?: string }).taxRatePctSource;
    if (src && src !== "line") return Number(li.taxRatePct ?? 19);
    return 19;
  }, [quote]);

  const taxSummary = useMemo(
    () => deriveTaxSummary(rows, brandTaxRatePct),
    [rows, brandTaxRatePct],
  );

  // Tax-rate options for the per-line selector. Per task spec: derived from
  // the current quote.taxSummary.breakdown plus tax-free (0%). We also
  // include the brand-resolved rate (so it's always offerable) and any rate
  // currently set on a line so the selector never has an "orphan" value.
  const taxRateOptions = useMemo(() => {
    const set = new Set<number>([0, brandTaxRatePct]);
    for (const b of quote?.taxSummary?.breakdown ?? []) {
      set.add(Number(b.ratePct));
    }
    for (const r of rows) {
      if (r.taxRatePct !== null && r.taxRatePct !== undefined) {
        set.add(Number(r.taxRatePct));
      }
    }
    return [...set]
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);
  }, [quote, rows, brandTaxRatePct]);

  const errorCount = useMemo(
    () =>
      rows.reduce((c, r) => {
        const errs = rowErrors(r);
        return c + (Object.values(errs).some(Boolean) ? 1 : 0);
      }, 0),
    [rows],
  );

  const previewLines: QuotePreviewLine[] = useMemo(
    () =>
      rows.map((r) => ({
        id: r.rowKey,
        kind: r.kind,
        name: r.name,
        description: r.description,
        quantity: r.quantity,
        listPrice: r.listPrice,
        unitPrice: r.listPrice * (1 - (r.discountPct || 0) / 100),
        discountPct: r.discountPct,
        total: rowTotal(r),
        taxRatePct: r.taxRatePct ?? brandTaxRatePct,
      })),
    [rows, brandTaxRatePct],
  );

  // On narrow viewports, force "edit" layout (preview becomes a separate
  // collapsible section below). The user's persisted choice is kept in
  // localStorage and restored once they return to a wide viewport.
  const effectiveLayout: LayoutMode = isMobile ? "edit" : layout;
  const showEditor = effectiveLayout !== "preview";
  const showPreview = effectiveLayout !== "edit";

  return (
    <div className="space-y-4">
      {/* Sticky toolbar: save state + add actions + layout toggle */}
      <div
        className="sticky top-[3.5rem] z-10 -mx-1 px-1 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-3 py-2"
        data-testid="quote-editor-toolbar"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => addRow("item")}
            data-testid="add-item-btn"
          >
            <Plus className="mr-1 h-4 w-4" /> {t("quoteEditor.addItem")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => addRow("heading")}
            data-testid="add-heading-btn"
          >
            <Heading1 className="mr-1 h-4 w-4" /> {t("quoteEditor.addHeading")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPricebookOpen(true)}
            data-testid="add-pricebook-btn"
          >
            <Library className="mr-1 h-4 w-4" /> {t("quoteEditor.addFromPricebook")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBundleOpen(true)}
            data-testid="add-bundle-btn"
          >
            <Package className="mr-1 h-4 w-4" /> {t("quoteEditor.addBundle")}
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="ml-2 inline-flex items-center text-xs text-muted-foreground"
                  data-testid="quote-editor-shortcuts-hint"
                >
                  <Keyboard className="mr-1 h-3.5 w-3.5" />
                  {t("quoteEditor.shortcutsHint")}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <div className="text-xs space-y-1">
                  <div>
                    <strong>Enter</strong> — {t("quoteEditor.shortcutEnter")}
                  </div>
                  <div>
                    <strong>Tab</strong> — {t("quoteEditor.shortcutTab")}
                  </div>
                  <div>
                    <strong>Backspace</strong> — {t("quoteEditor.shortcutBackspace")}
                  </div>
                  <div>
                    <strong>Cmd/Ctrl + Enter</strong> —{" "}
                    {t("quoteEditor.shortcutCmdEnter")}
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-[6rem] justify-end"
            data-testid="save-state"
          >
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
              <span className="flex items-center gap-1 text-destructive">
                <AlertCircle className="h-3 w-3" /> {t("quoteEditor.saveError")}
              </span>
            )}
            {errorCount > 0 && saveState !== "saving" && (
              <span
                className="flex items-center gap-1 text-amber-600"
                data-testid="quote-editor-validation-warning"
              >
                <AlertCircle className="h-3 w-3" />
                {t("quoteEditor.validationCount", { count: errorCount })}
              </span>
            )}
          </div>
          <ToggleGroup
            type="single"
            value={layout}
            onValueChange={(v) => {
              if (v === "edit" || v === "split" || v === "preview") setLayout(v);
            }}
            size="sm"
            aria-label={t("quoteEditor.layoutLabel")}
            data-testid="quote-editor-layout-toggle"
            className="hidden md:flex"
          >
            <ToggleGroupItem
              value="edit"
              data-testid="quote-editor-layout-edit"
              aria-label={t("quoteEditor.layoutEdit")}
            >
              <Pencil className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="split"
              data-testid="quote-editor-layout-split"
              aria-label={t("quoteEditor.layoutSplit")}
            >
              <Columns2 className="h-4 w-4" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="preview"
              data-testid="quote-editor-layout-preview"
              aria-label={t("quoteEditor.layoutPreview")}
            >
              <Eye className="h-4 w-4" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-6",
          layout === "split" && "lg:grid-cols-2",
        )}
      >
        {showEditor && (
          <div className="space-y-4 min-w-0">
            <Card>
              <CardContent className="space-y-3 p-4">
                <div
                  className="hidden md:grid grid-cols-[auto_2rem_minmax(0,1fr)_72px_110px_72px_110px_110px_auto] items-center gap-2 px-2 text-xs font-medium uppercase text-muted-foreground"
                >
                  <div />
                  <div className="text-center">#</div>
                  <div>{t("quoteEditor.colName")}</div>
                  <div className="text-right">{t("quoteEditor.colQty")}</div>
                  <div className="text-right">{t("quoteEditor.colPrice")}</div>
                  <div className="text-right">{t("quoteEditor.colDiscount")}</div>
                  <div className="text-right">{t("quoteEditor.colTax")}</div>
                  <div className="text-right">{t("quoteEditor.colTotal")}</div>
                  <div />
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={rows.map((r) => r.rowKey)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="flex flex-col gap-2" data-testid="editor-rows">
                      {rows.map((r, idx) => (
                        <SortableRow
                          key={r.rowKey}
                          row={r}
                          index={idx}
                          onChange={(next) => changeRow(r.rowKey, next)}
                          onRemove={() => removeRowByKey(r.rowKey)}
                          positions={positions}
                          currency={currency}
                          brandTaxRatePct={brandTaxRatePct}
                          taxRateOptions={taxRateOptions}
                          onEnterInsertAfter={() => insertRowAfter(idx)}
                          onBackspaceEmpty={removeRowByKey}
                          registerNameInput={registerNameInput}
                        />
                      ))}
                      {rows.length === 0 && (
                        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                          {t("quoteEditor.empty")}
                        </div>
                      )}
                    </div>
                  </SortableContext>
                </DndContext>

                {/* Live tax summary */}
                <div
                  className="mt-4 grid gap-1 rounded-md border bg-muted/30 p-3 text-sm"
                  data-testid="quote-editor-tax-summary"
                >
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t("pages.quote.netto")}
                    </span>
                    <span
                      className="tabular-nums font-medium"
                      data-testid="editor-subtotal"
                    >
                      {subtotal.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      {currency}
                    </span>
                  </div>
                  {taxSummary.breakdown.map((b) => (
                    <div
                      key={b.ratePct}
                      className="flex justify-between text-xs text-muted-foreground"
                      data-testid={`editor-tax-row-${b.ratePct}`}
                    >
                      <span>
                        {b.ratePct === 0
                          ? t("pages.quote.vatExempt")
                          : t("pages.quote.vatAt", {
                              pct: (
                                Math.round(b.ratePct * 100) / 100
                              ).toLocaleString(),
                            })}
                      </span>
                      <span className="tabular-nums">
                        {b.tax.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        {currency}
                      </span>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between border-t pt-2 text-base font-bold">
                    <span>{t("pages.quote.brutto")}</span>
                    <span
                      className="tabular-nums"
                      data-testid="editor-gross-total"
                    >
                      {taxSummary.gross.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      {currency}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground pt-1">
                    {t("quoteEditor.summary", {
                      items: itemCount,
                      headings: headingCount,
                    })}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {showPreview && quote && (
          <div
            className="space-y-4 min-w-0"
            data-testid="quote-editor-preview"
          >
            {/* Backward-compat test id: previously the preview was an
                <iframe data-testid="pdf-preview-iframe">. We keep the same
                test id here so existing tests targeting it still find the
                preview container. */}
            <div data-testid="pdf-preview-iframe">
              <QuotePreview
                quoteNumber={quote.number}
                currency={currency}
                validUntil={quote.validUntil}
                language={quote.language ?? "de"}
                dealId={quote.dealId}
                dealName={quote.dealName}
                lines={previewLines}
                taxSummary={taxSummary}
                testId="quote-editor-html-preview"
              />
            </div>
          </div>
        )}
      </div>

      {/* Mobile: preview is a separate collapsible section below the editor.
          On md+ screens this whole block is hidden — the toggle handles it. */}
      {isMobile && quote && (
        <div className="md:hidden">
          <Collapsible
            open={mobilePreviewOpen}
            onOpenChange={setMobilePreviewOpen}
          >
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between"
                data-testid="quote-editor-mobile-preview-toggle"
              >
                <span className="flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  {t("quoteEditor.layoutPreview")}
                </span>
                {mobilePreviewOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <div data-testid="pdf-preview-iframe">
                <QuotePreview
                  quoteNumber={quote.number}
                  currency={currency}
                  validUntil={quote.validUntil}
                  language={quote.language ?? "de"}
                  dealId={quote.dealId}
                  dealName={quote.dealName}
                  lines={previewLines}
                  taxSummary={taxSummary}
                  testId="quote-editor-html-preview-mobile"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

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

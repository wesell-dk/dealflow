import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePricePosition,
  useUpdatePricePosition,
  useListBrands,
  useListCompanies,
  getListPricePositionsQueryKey,
  getGetPricingSummaryQueryKey,
  type PricePosition,
  type PricePositionInput,
  type PricePositionPatch,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  position?: PricePosition;
}

const STATUS_OPTIONS: Array<{ value: "draft" | "active" | "archived"; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
];

export function PricePositionFormDialog({ open, onOpenChange, position }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isEdit = !!position;

  const createMut = useCreatePricePosition();
  const updateMut = useUpdatePricePosition();
  const brandsQ = useListBrands();
  const companiesQ = useListCompanies();

  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [listPrice, setListPrice] = useState<string>("");
  const [currency, setCurrency] = useState("EUR");
  const [companyId, setCompanyId] = useState<string>("");
  const [brandId, setBrandId] = useState<string>("");
  const [validFrom, setValidFrom] = useState<string>(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState<string>("");
  const [status, setStatus] = useState<"draft" | "active" | "archived">("draft");
  const [isStandard, setIsStandard] = useState(true);

  // Brand-Liste auf gewählte Company filtern. Sub-Brands behalten wir bewusst
  // — Pricing kann Marken-spezifisch sein (Premium- vs Lite-Sub-Brand).
  const filteredBrands = useMemo(() => {
    return (brandsQ.data ?? []).filter(b => !companyId || b.companyId === companyId);
  }, [brandsQ.data, companyId]);

  useEffect(() => {
    if (!open) return;
    if (position) {
      setSku(position.sku);
      setName(position.name);
      setCategory(position.category);
      setListPrice(String(position.listPrice));
      setCurrency(position.currency);
      setCompanyId(position.companyId);
      setBrandId(position.brandId);
      setValidFrom(position.validFrom);
      setValidUntil(position.validUntil ?? "");
      setStatus((position.status as "draft" | "active" | "archived") ?? "draft");
      setIsStandard(position.isStandard);
    } else {
      setSku("");
      setName("");
      setCategory("");
      setListPrice("");
      setCurrency("EUR");
      setCompanyId("");
      setBrandId("");
      setValidFrom(new Date().toISOString().slice(0, 10));
      setValidUntil("");
      setStatus("draft");
      setIsStandard(true);
    }
  }, [open, position]);

  // Wenn Company sich ändert UND aktuelles Brand nicht mehr passt → Brand zurücksetzen.
  useEffect(() => {
    if (!brandId) return;
    const valid = filteredBrands.some(b => b.id === brandId);
    if (!valid) setBrandId("");
  }, [filteredBrands, brandId]);

  const submit = async () => {
    const trimmedSku = sku.trim();
    const trimmedName = name.trim();
    const trimmedCategory = category.trim();
    const lp = Number(listPrice);
    if (!trimmedSku || !trimmedName || !trimmedCategory) {
      toast({ title: "Required fields missing", description: "SKU, name and category are required.", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(lp) || lp < 0) {
      toast({ title: "Invalid price", description: "List price must be a non-negative number.", variant: "destructive" });
      return;
    }
    if (!companyId || !brandId) {
      toast({ title: "Assignment missing", description: "Choose a company and brand.", variant: "destructive" });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
      toast({ title: "Invalid date", description: "Valid from must be in YYYY-MM-DD format.", variant: "destructive" });
      return;
    }
    try {
      if (isEdit && position) {
        const patch: PricePositionPatch = {
          sku: trimmedSku,
          name: trimmedName,
          category: trimmedCategory,
          listPrice: lp,
          currency: currency.trim().toUpperCase() || "EUR",
          status,
          validFrom,
          validUntil: validUntil ? validUntil : null,
          brandId,
          isStandard,
        };
        await updateMut.mutateAsync({ id: position.id, data: patch });
        toast({ title: "Price position updated", description: trimmedSku });
      } else {
        const body: PricePositionInput = {
          sku: trimmedSku,
          name: trimmedName,
          category: trimmedCategory,
          listPrice: lp,
          currency: currency.trim().toUpperCase() || "EUR",
          brandId,
          companyId,
          validFrom,
        };
        await createMut.mutateAsync({ data: body });
        toast({ title: "Price position created", description: trimmedSku });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListPricePositionsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetPricingSummaryQueryKey() }),
      ]);
      onOpenChange(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: status === 403 ? "Not authorized" : "Save failed",
        description: body?.error ?? (e instanceof Error ? e.message : "Unknown error"),
        variant: "destructive",
      });
    }
  };

  const busy = createMut.isPending || updateMut.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit price position" : "New price position"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Adjust list price, status and validity. For larger structural changes use a new version."
              : "Create a standard price for a brand / company. Used by the price resolver."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pp-sku">SKU *</Label>
              <Input id="pp-sku" value={sku} onChange={e => setSku(e.target.value)} placeholder="HX-CORE-LIC" data-testid="input-pp-sku" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-category">Category *</Label>
              <Input id="pp-category" value={category} onChange={e => setCategory(e.target.value)} placeholder="Licenses, services…" data-testid="input-pp-category" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pp-name">Name *</Label>
            <Input id="pp-name" value={name} onChange={e => setName(e.target.value)} placeholder="Helix Core License" data-testid="input-pp-name" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pp-price">List price *</Label>
              <Input
                id="pp-price"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={listPrice}
                onChange={e => setListPrice(e.target.value)}
                placeholder="240000"
                data-testid="input-pp-price"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-currency">Currency</Label>
              <Input id="pp-currency" value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="EUR" data-testid="input-pp-currency" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as "draft" | "active" | "archived")} disabled={!isEdit}>
                <SelectTrigger id="pp-status" data-testid="select-pp-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {!isEdit && <p className="text-[11px] text-muted-foreground">New positions start as draft.</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Company *</Label>
              <Select value={companyId} onValueChange={setCompanyId} disabled={isEdit}>
                <SelectTrigger data-testid="select-pp-company"><SelectValue placeholder={companiesQ.isLoading ? "Loading…" : "Select"} /></SelectTrigger>
                <SelectContent>
                  {(companiesQ.data ?? []).map(c => (
                    <SelectItem key={c.id} value={c.id} textValue={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isEdit && <p className="text-[11px] text-muted-foreground">Company cannot be changed after creation.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Brand *</Label>
              <Select value={brandId} onValueChange={setBrandId} disabled={!companyId}>
                <SelectTrigger data-testid="select-pp-brand"><SelectValue placeholder={!companyId ? "Select a company first" : (brandsQ.isLoading ? "Loading…" : "Select")} /></SelectTrigger>
                <SelectContent>
                  {filteredBrands.map(b => (
                    <SelectItem key={b.id} value={b.id} textValue={b.name}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pp-vfrom">Valid from *</Label>
              <Input id="pp-vfrom" type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} data-testid="input-pp-validfrom" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-vto">Valid until</Label>
              <Input
                id="pp-vto"
                type="date"
                value={validUntil}
                onChange={e => setValidUntil(e.target.value)}
                disabled={!isEdit}
                data-testid="input-pp-validuntil"
              />
              {!isEdit && <p className="text-[11px] text-muted-foreground">Left open at creation — you can set this later if needed.</p>}
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={isStandard}
                onChange={e => setIsStandard(e.target.checked)}
                data-testid="checkbox-pp-standard"
              />
              <span>Mark as standard price (counts towards the standard-coverage KPI)</span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-pp-submit">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDuplicateQuote,
  useListDeals,
  useGetQuote,
  getListQuotesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Copy, Loader2, Search } from "lucide-react";

interface Props {
  quoteId: string;
  quoteNumber: string;
  /** Variante: full button im Header oder kompakt im Dropdown */
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
  withLabel?: boolean;
  navigateAfter?: boolean;
}

export function QuoteDuplicateButton({
  quoteId,
  quoteNumber,
  variant = "outline",
  size = "sm",
  withLabel = true,
  navigateAfter = true,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const dupMut = useDuplicateQuote();

  // Quelle laden, um den ursprünglichen Deal als Default vorzuschlagen.
  const { data: srcQuote } = useGetQuote(quoteId, {
    query: { enabled: open, queryKey: ["dupSrcQuote", quoteId] },
  });
  const { data: deals } = useListDeals(undefined, {
    query: { enabled: open, queryKey: ["dupDeals"] },
  });

  const [targetDealId, setTargetDealId] = useState<string>("");
  const [search, setSearch] = useState("");
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [includeDiscount, setIncludeDiscount] = useState(true);
  const [includeValidUntil, setIncludeValidUntil] = useState(true);

  // Beim Öffnen den Quell-Deal vorbelegen.
  useEffect(() => {
    if (open && srcQuote?.dealId && !targetDealId) {
      setTargetDealId(srcQuote.dealId);
    }
  }, [open, srcQuote?.dealId, targetDealId]);

  // Beim Schließen Auswahl zurücksetzen.
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setTargetDealId("");
        setSearch("");
        setIncludeAttachments(true);
        setIncludeNotes(true);
        setIncludeDiscount(true);
        setIncludeValidUntil(true);
      }, 200);
    }
  }, [open]);

  const filteredDeals = useMemo(() => {
    if (!deals) return [];
    const q = search.trim().toLowerCase();
    if (!q) return deals;
    return deals.filter((d) =>
      `${d.name} ${d.accountName}`.toLowerCase().includes(q),
    );
  }, [deals, search]);

  // Stelle sicher, dass der gewählte Deal im Select sichtbar bleibt, auch wenn
  // er durch den Such-Filter herausfiele.
  const visibleDeals = useMemo(() => {
    if (!targetDealId) return filteredDeals;
    if (filteredDeals.some((d) => d.id === targetDealId)) return filteredDeals;
    const sel = deals?.find((d) => d.id === targetDealId);
    return sel ? [sel, ...filteredDeals] : filteredDeals;
  }, [filteredDeals, targetDealId, deals]);

  const onConfirm = async () => {
    try {
      const created = await dupMut.mutateAsync({
        id: quoteId,
        data: {
          targetDealId: targetDealId || undefined,
          includeAttachments,
          includeNotes,
          includeDiscount,
          includeValidUntil,
        },
      });
      toast({
        title: t("pages.quotes.duplicated"),
        description: created.number,
      });
      await qc.invalidateQueries({ queryKey: getListQuotesQueryKey() });
      setOpen(false);
      if (navigateAfter) navigate(`/quotes/${created.id}`);
    } catch (e: unknown) {
      toast({
        title: t("pages.quotes.duplicateFailed"),
        description: String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
        data-testid={`quote-duplicate-${quoteId}`}
      >
        <Copy className={withLabel ? "h-4 w-4 mr-1.5" : "h-4 w-4"} />
        {withLabel && t("actions.duplicate")}
      </Button>
      <DialogContent className="sm:max-w-lg" data-testid="quote-duplicate-dialog">
        <DialogHeader>
          <DialogTitle>{t("pages.quotes.duplicateConfirmTitle")}</DialogTitle>
          <DialogDescription>
            {t("pages.quotes.duplicateDialogBody", { number: quoteNumber })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label>{t("pages.quotes.duplicateTargetDeal")}</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("pages.quotes.duplicateDealSearchPlaceholder")}
                className="pl-8"
                data-testid="quote-duplicate-deal-search"
              />
            </div>
            <Select value={targetDealId} onValueChange={setTargetDealId}>
              <SelectTrigger data-testid="quote-duplicate-deal-select">
                <SelectValue placeholder={t("pages.quotes.duplicateSelectDeal")} />
              </SelectTrigger>
              <SelectContent>
                {visibleDeals.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    {t("common.noMatches")}
                  </div>
                ) : (
                  visibleDeals.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} — {d.accountName}
                      {srcQuote?.dealId === d.id
                        ? ` (${t("pages.quotes.duplicateSourceDealHint")})`
                        : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label>{t("pages.quotes.duplicateIncludeTitle")}</Label>
            <div className="space-y-2 rounded-md border p-3">
              <label className="flex items-start gap-2 text-sm opacity-70">
                <Checkbox checked disabled />
                <div>
                  <div className="font-medium">{t("pages.quotes.duplicateLineItems")}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("pages.quotes.duplicateLineItemsHint")}
                  </div>
                </div>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={includeAttachments}
                  onCheckedChange={(v) => setIncludeAttachments(!!v)}
                  data-testid="quote-duplicate-include-attachments"
                />
                <div className="font-medium">{t("pages.quotes.duplicateAttachments")}</div>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={includeNotes}
                  onCheckedChange={(v) => setIncludeNotes(!!v)}
                  data-testid="quote-duplicate-include-notes"
                />
                <div className="font-medium">{t("pages.quotes.duplicateNotes")}</div>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={includeDiscount}
                  onCheckedChange={(v) => setIncludeDiscount(!!v)}
                  data-testid="quote-duplicate-include-discount"
                />
                <div className="font-medium">{t("pages.quotes.duplicateDiscount")}</div>
              </label>
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={includeValidUntil}
                  onCheckedChange={(v) => setIncludeValidUntil(!!v)}
                  data-testid="quote-duplicate-include-valid-until"
                />
                <div className="font-medium">{t("pages.quotes.duplicateValidUntil")}</div>
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={dupMut.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={dupMut.isPending || !targetDealId}
            data-testid={`quote-duplicate-confirm-${quoteId}`}
          >
            {dupMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("actions.duplicate")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

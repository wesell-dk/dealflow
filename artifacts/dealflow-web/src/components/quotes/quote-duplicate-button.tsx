import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useDuplicateQuote,
  getListQuotesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Copy, Loader2 } from "lucide-react";

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

  const onConfirm = async () => {
    try {
      const created = await dupMut.mutateAsync({ id: quoteId });
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
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant={variant}
          size={size}
          data-testid={`quote-duplicate-${quoteId}`}
        >
          <Copy className={withLabel ? "h-4 w-4 mr-1.5" : "h-4 w-4"} />
          {withLabel && t("actions.duplicate")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("pages.quotes.duplicateConfirmTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("pages.quotes.duplicateConfirmBody", { number: quoteNumber })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); onConfirm(); }}
            disabled={dupMut.isPending}
            data-testid={`quote-duplicate-confirm-${quoteId}`}
          >
            {dupMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("actions.duplicate")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

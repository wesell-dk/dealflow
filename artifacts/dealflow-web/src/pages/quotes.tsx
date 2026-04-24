import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useListQuotes } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, MoreHorizontal, ExternalLink, FileText } from "lucide-react";
import { QuoteWizard } from "@/components/quote-wizard";
import { QuoteDuplicateButton } from "@/components/quotes/quote-duplicate-button";

export default function Quotes() {
  const { t } = useTranslation();
  const { data: quotes, isLoading } = useListQuotes();
  const [wizardOpen, setWizardOpen] = useState(false);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.quotes.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.quotes.subtitle")}</p>
        </div>
        <Button onClick={() => setWizardOpen(true)} data-testid="quotes-new-button">
          <Plus className="h-4 w-4 mr-1" />
          {t("pages.quotes.newQuote")}
        </Button>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("common.number")}</TableHead>
              <TableHead>{t("common.deal")}</TableHead>
              <TableHead>{t("common.total")}</TableHead>
              <TableHead>{t("common.discount")}</TableHead>
              <TableHead>{t("common.status")}</TableHead>
              <TableHead>{t("common.validUntil")}</TableHead>
              <TableHead className="w-12 text-right">&nbsp;</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes?.map((quote) => (
              <TableRow key={quote.id} data-testid={`quote-row-${quote.id}`}>
                <TableCell className="font-medium">
                  <Link href={`/quotes/${quote.id}`} className="hover:underline">{quote.number}</Link>
                </TableCell>
                <TableCell>{quote.dealName}</TableCell>
                <TableCell>{quote.totalAmount.toLocaleString()} {quote.currency}</TableCell>
                <TableCell>{quote.discountPct}%</TableCell>
                <TableCell><Badge variant="outline">{quote.status}</Badge></TableCell>
                <TableCell>{new Date(quote.validUntil).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`quote-menu-${quote.id}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/quotes/${quote.id}`} data-testid={`quote-open-${quote.id}`}>
                          <ExternalLink className="h-4 w-4 mr-2" />
                          {t("common.open")}
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => window.open(`/api/quotes/${quote.id}/pdf`, "_blank")}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        {t("pages.quote.openPdf")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                        <div className="px-1.5 py-0.5">
                          <QuoteDuplicateButton
                            quoteId={quote.id}
                            quoteNumber={quote.number}
                            variant="ghost"
                            size="sm"
                          />
                        </div>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <QuoteWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}

import { useTranslation } from "react-i18next";
import { useListQuotes } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function Quotes() {
  const { t } = useTranslation();
  const { data: quotes, isLoading } = useListQuotes();

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("pages.quotes.title")}</h1>
        <p className="text-muted-foreground mt-1">{t("pages.quotes.subtitle")}</p>
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes?.map((quote) => (
              <TableRow key={quote.id}>
                <TableCell className="font-medium">
                  <Link href={`/quotes/${quote.id}`} className="hover:underline">{quote.number}</Link>
                </TableCell>
                <TableCell>{quote.dealName}</TableCell>
                <TableCell>{quote.totalAmount.toLocaleString()} {quote.currency}</TableCell>
                <TableCell>{quote.discountPct}%</TableCell>
                <TableCell><Badge variant="outline">{quote.status}</Badge></TableCell>
                <TableCell>{new Date(quote.validUntil).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
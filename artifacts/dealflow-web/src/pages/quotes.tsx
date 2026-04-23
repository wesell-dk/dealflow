import { useListQuotes } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function Quotes() {
  const { data: quotes, isLoading } = useListQuotes();

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Quotes</h1>
        <p className="text-muted-foreground mt-1">All quotes across your deals.</p>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Deal</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Valid Until</TableHead>
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
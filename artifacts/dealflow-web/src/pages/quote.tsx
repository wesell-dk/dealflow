import { useParams } from "wouter";
import { useGetQuote } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText } from "lucide-react";

export default function Quote() {
  const params = useParams();
  const id = params.id as string;
  const { data: quote, isLoading } = useGetQuote(id);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!quote) return <div className="p-8">Quote not found</div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Quote {quote.number}</h1>
          <p className="text-muted-foreground mt-1">{quote.dealName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open(`/api/quotes/${id}/pdf`, '_blank')}>
            <FileText className="h-4 w-4 mr-2" /> PDF anzeigen
          </Button>
          <Badge variant="outline">{quote.status}</Badge>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2">
          <Card>
            <CardHeader><CardTitle>Line Items</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {quote.lineItems.map(item => (
                  <div key={item.id} className="flex justify-between items-center border-b pb-2">
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">Qty: {item.quantity} &times; {item.unitPrice}</div>
                    </div>
                    <div className="font-bold">{item.total.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <div>
          <Card>
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between"><span>Total:</span> <strong>{quote.totalAmount.toLocaleString()} {quote.currency}</strong></div>
              <div className="flex justify-between"><span>Discount:</span> <strong>{quote.discountPct}%</strong></div>
              <div className="flex justify-between"><span>Margin:</span> <strong>{quote.marginPct}%</strong></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
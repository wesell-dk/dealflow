import { useParams } from "wouter";
import { useGetDeal } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Deal() {
  const params = useParams();
  const id = params.id as string;
  const { data: deal, isLoading } = useGetDeal(id);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!deal) return <div className="p-8">Deal not found</div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 border-b pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold tracking-tight">{deal.name}</h1>
          <Badge variant={deal.riskLevel === 'high' ? 'destructive' : 'secondary'}>
            Risk: {deal.riskLevel}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground">
          <span>{deal.accountName}</span>
          <span>&bull;</span>
          <Badge variant="outline">{deal.stage}</Badge>
          <span>&bull;</span>
          <span>{deal.value.toLocaleString()} {deal.currency}</span>
          <span>&bull;</span>
          <span>{deal.probability}% Probability</span>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="quotes">Quotes ({deal.quotes.length})</TabsTrigger>
          <TabsTrigger value="contracts">Contracts ({deal.contracts.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-2">
                <div><span className="font-medium">Owner:</span> {deal.ownerName}</div>
                <div><span className="font-medium">Close Date:</span> {new Date(deal.expectedCloseDate).toLocaleDateString()}</div>
                <div><span className="font-medium">Next Step:</span> {deal.nextStep || 'None'}</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="quotes" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Quotes</CardTitle></CardHeader>
            <CardContent>
              {deal.quotes.map(q => <div key={q.id} className="py-2 border-b last:border-0">{q.number} - {q.status}</div>)}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="contracts" className="mt-4">
          <Card>
            <CardHeader><CardTitle>Contracts</CardTitle></CardHeader>
            <CardContent>
              {deal.contracts.map(c => <div key={c.id} className="py-2 border-b last:border-0">{c.title} - {c.status}</div>)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
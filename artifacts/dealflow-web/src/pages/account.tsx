import { useRoute } from "wouter";
import { Link } from "wouter";
import { useGetAccount } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Building, Phone, Mail, UserCircle2 } from "lucide-react";

export default function Account() {
  const [, params] = useRoute("/accounts/:id");
  const id = params?.id || "";
  
  const { data: account, isLoading } = useGetAccount(id);

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!account) {
    return <div className="p-8">Account not found</div>;
  }

  const healthColor = account.healthScore < 60 ? "bg-red-500" : account.healthScore <= 75 ? "bg-amber-400" : "bg-green-500";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 border-b pb-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{account.name}</h1>
            <div className="flex items-center gap-4 text-muted-foreground mt-2">
              <span className="flex items-center gap-1"><Building className="h-4 w-4" /> {account.industry}</span>
              <span>&bull;</span>
              <span>{account.country}</span>
              <span>&bull;</span>
              <span>Owner: {account.ownerId || "Unassigned"}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="text-sm font-medium text-muted-foreground">Health Score</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold">{account.healthScore}</span>
              <div className="h-3 w-32 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${healthColor}`} style={{ width: `${account.healthScore}%` }} />
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex gap-6 mt-2">
          <div>
            <div className="text-sm text-muted-foreground">Open Deals</div>
            <div className="text-xl font-semibold">{account.openDeals}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Total Value</div>
            <div className="text-xl font-semibold">{account.totalValue.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {account.contacts?.map((contact) => (
                <div key={contact.id} className="flex flex-col gap-2 p-4 border rounded-lg">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <UserCircle2 className="h-8 w-8 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{contact.name}</div>
                        <div className="text-sm text-muted-foreground">{contact.role}</div>
                      </div>
                    </div>
                    {contact.isDecisionMaker && (
                      <Badge variant="secondary">Decision Maker</Badge>
                    )}
                  </div>
                  <div className="flex gap-4 text-sm text-muted-foreground mt-2">
                    <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {contact.email}</span>
                    {contact.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {contact.phone}</span>}
                  </div>
                </div>
              ))}
              {!account.contacts?.length && (
                <div className="text-center py-6 text-muted-foreground">No contacts found</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {account.deals?.map((deal) => (
                <div key={deal.id} className="flex flex-col gap-2 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-start justify-between">
                    <Link href={`/deals/${deal.id}`} className="font-medium hover:underline text-primary">
                      {deal.name}
                    </Link>
                    <Badge variant="outline">{deal.stage}</Badge>
                  </div>
                  <div className="flex justify-between text-sm mt-2">
                    <span className="font-semibold">{deal.value.toLocaleString()} {deal.currency}</span>
                    <span className="text-muted-foreground">{deal.probability}% Probability</span>
                  </div>
                </div>
              ))}
              {!account.deals?.length && (
                <div className="text-center py-6 text-muted-foreground">No deals found</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

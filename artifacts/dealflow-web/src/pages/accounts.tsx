import { Link } from "wouter";
import { useListAccounts } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Building } from "lucide-react";

export default function Accounts() {
  const { data: accounts, isLoading } = useListAccounts();

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Accounts</h1>
          <p className="text-muted-foreground mt-1">Manage your customer relationships.</p>
        </div>
      </div>

      {!accounts?.length ? (
        <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-muted/20">
          <Building className="h-10 w-10 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">No accounts found</h2>
          <p className="text-muted-foreground">Get started by creating your first account.</p>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Health Score</TableHead>
                <TableHead>Open Deals</TableHead>
                <TableHead>Total Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => {
                const healthColor = account.healthScore < 60 ? "bg-red-500" : account.healthScore <= 75 ? "bg-amber-400" : "bg-green-500";
                
                return (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">
                      <Link href={`/accounts/${account.id}`} className="hover:underline">
                        {account.name}
                      </Link>
                    </TableCell>
                    <TableCell>{account.industry}</TableCell>
                    <TableCell>{account.country}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="w-8 text-right text-xs font-medium">{account.healthScore}</span>
                        <div className="h-2 w-24 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${healthColor}`} style={{ width: `${account.healthScore}%` }} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{account.openDeals}</TableCell>
                    <TableCell>{account.totalValue.toLocaleString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { useListDeals, useGetDealPipeline } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search } from "lucide-react";

export default function Deals() {
  const [search, setSearch] = useState("");
  const { data: deals, isLoading: isLoadingDeals } = useListDeals({ search });
  const { data: pipeline, isLoading: isLoadingPipeline } = useGetDealPipeline();

  if (isLoadingDeals || isLoadingPipeline) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Deals</h1>
          <p className="text-muted-foreground mt-1">Manage your active pipeline.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {pipeline?.stages.map((stage) => (
          <Card key={stage.stage}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">{stage.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stage.count}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Value: {stage.value.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search deals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Close Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deals?.map((deal) => (
              <TableRow key={deal.id}>
                <TableCell className="font-medium">
                  <Link href={`/deals/${deal.id}`} className="hover:underline">{deal.name}</Link>
                </TableCell>
                <TableCell>{deal.accountName}</TableCell>
                <TableCell><Badge variant="outline">{deal.stage}</Badge></TableCell>
                <TableCell>{deal.value.toLocaleString()} {deal.currency}</TableCell>
                <TableCell>{deal.ownerName}</TableCell>
                <TableCell>{new Date(deal.expectedCloseDate).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
            {deals?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">No deals found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
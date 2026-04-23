import { useListContracts } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText } from "lucide-react";

export default function Contracts() {
  const { data: contracts, isLoading } = useListContracts();

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Contracts</h1>
        <p className="text-muted-foreground mt-1">All contracts across your deals.</p>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Deal</TableHead>
              <TableHead>Template</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Valid Until</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts?.map((contract) => (
              <TableRow key={contract.id}>
                <TableCell className="font-medium">
                  <Link href={`/contracts/${contract.id}`} className="flex items-center gap-2 hover:underline">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    {contract.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={`/deals/${contract.dealId}`} className="hover:underline">
                    {contract.dealName}
                  </Link>
                </TableCell>
                <TableCell>{contract.template}</TableCell>
                <TableCell>v{contract.version}</TableCell>
                <TableCell><Badge variant="outline">{contract.status}</Badge></TableCell>
                <TableCell>
                  <Badge variant={contract.riskLevel === 'high' ? 'destructive' : contract.riskLevel === 'medium' ? 'secondary' : 'default'} className={contract.riskLevel === 'low' ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20' : contract.riskLevel === 'medium' ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20' : ''}>
                    {contract.riskLevel}
                  </Badge>
                </TableCell>
                <TableCell>{contract.validUntil ? new Date(contract.validUntil).toLocaleDateString() : 'N/A'}</TableCell>
              </TableRow>
            ))}
            {contracts?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">No contracts found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

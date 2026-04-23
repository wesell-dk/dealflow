import { useRoute, Link } from "wouter";
import { useGetContract, useListClauseFamilies } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FileText, ShieldAlert, Library, Activity } from "lucide-react";
import { EntityVersions } from "@/components/ui/entity-versions";

export default function Contract() {
  const [, params] = useRoute("/contracts/:id");
  const id = params?.id as string;
  
  const { data: contract, isLoading: isLoadingContract } = useGetContract(id ?? "");
  const { data: families, isLoading: isLoadingFamilies } = useListClauseFamilies();

  if (isLoadingContract || isLoadingFamilies) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!contract) return <div className="p-8 text-center text-muted-foreground">Contract not found</div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 border-b pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-3xl font-bold tracking-tight">{contract.title}</h1>
          </div>
          <div className="flex gap-2">
            <Badge variant="outline" className="text-sm px-3 py-1">{contract.status}</Badge>
            <Badge variant={contract.riskLevel === 'high' ? 'destructive' : contract.riskLevel === 'medium' ? 'secondary' : 'default'} className={contract.riskLevel === 'low' ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20 text-sm px-3 py-1' : contract.riskLevel === 'medium' ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 text-sm px-3 py-1' : 'text-sm px-3 py-1'}>
              Risk: {contract.riskLevel}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-4 text-muted-foreground mt-2">
          <span><Link href={`/deals/${contract.dealId}`} className="hover:underline">{contract.dealName}</Link></span>
          <span>&bull;</span>
          <span>Version {contract.version}</span>
          <span>&bull;</span>
          <span>Template: {contract.template}</span>
          {contract.validUntil && (
            <>
              <span>&bull;</span>
              <span>Valid Until: {new Date(contract.validUntil).toLocaleDateString()}</span>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <CardTitle className="text-sm flex items-center gap-2 font-medium text-muted-foreground">
            <Activity className="h-4 w-4" /> Risk Score
          </CardTitle>
          <span className="text-3xl font-bold tabular-nums">{contract.riskScore ?? 0}</span>
        </CardHeader>
        <CardContent>
          <Progress value={contract.riskScore ?? 0} className="h-2" />
          <p className="text-xs text-muted-foreground mt-2">
            Calculated from {contract.clauses?.length ?? 0} clause severity weights (high·25 / medium·10 / low·3, capped at 100).
          </p>
        </CardContent>
      </Card>

      <EntityVersions entityType="contract" entityId={id} />

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b">
            <ShieldAlert className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Current Clauses</h2>
          </div>
          
          {contract.clauses?.length === 0 ? (
             <div className="p-8 text-center border rounded-md text-muted-foreground bg-muted/10">No clauses added to this contract yet.</div>
          ) : (
            <div className="space-y-4">
              {contract.clauses?.map(clause => (
                <Card key={clause.id} className="border-l-4" style={{ 
                  borderLeftColor: clause.severity === 'high' ? 'hsl(var(--destructive))' : clause.severity === 'medium' ? '#f59e0b' : '#10b981' 
                }}>
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between bg-muted/10">
                    <CardTitle className="text-base font-medium">{clause.family}</CardTitle>
                    <Badge variant="outline">{clause.variant}</Badge>
                  </CardHeader>
                  <CardContent className="py-3 px-4 text-sm">
                    {clause.summary}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
        
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b">
            <Library className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Clause Library</h2>
          </div>
          
          <div className="space-y-4 h-[600px] overflow-y-auto pr-2">
            {families?.map(family => (
              <Card key={family.id} className="bg-muted/5">
                <CardHeader className="py-3 px-4">
                  <CardTitle className="text-base font-medium">{family.name}</CardTitle>
                  <p className="text-xs text-muted-foreground">{family.description}</p>
                </CardHeader>
                <CardContent className="py-0 px-4 pb-3">
                  <div className="space-y-2 mt-2">
                    {family.variants.map(variant => (
                      <div key={variant.id} className="flex flex-col gap-1 p-2 rounded-md bg-background border text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold">{variant.name}</span>
                          <span className="flex items-center gap-1">
                            <span className={`w-2 h-2 rounded-full ${variant.severity === 'high' ? 'bg-destructive' : variant.severity === 'medium' ? 'bg-amber-500' : 'bg-green-500'}`}></span>
                            <span className="text-muted-foreground capitalize">{variant.severity}</span>
                          </span>
                        </div>
                        <span className="text-muted-foreground">{variant.summary}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

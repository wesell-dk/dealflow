import { useGetPricingSummary, useListPricePositions, useListPriceRules } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowRight, Tag, Shield, Percent, Clock, AlertTriangle } from "lucide-react";

export default function Pricing() {
  const { data: summary, isLoading: isLoadingSummary } = useGetPricingSummary();
  const { data: positions, isLoading: isLoadingPositions } = useListPricePositions();
  const { data: rules, isLoading: isLoadingRules } = useListPriceRules();

  if (isLoadingSummary || isLoadingPositions || isLoadingRules) {
    return <div className="p-8 space-y-6"><Skeleton className="h-32 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pricing Workspace</h1>
        <p className="text-muted-foreground mt-1">Manage standard price lists, discounts, and guardrails.</p>
      </div>

      {summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Positions</CardTitle>
              <Tag className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalPositions.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Active Positions</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.activePositions.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Pending Approvals</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.pendingApprovalCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Standard Coverage</CardTitle>
              <Percent className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.standardCoveragePct}%</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="positions" className="mt-2">
        <TabsList>
          <TabsTrigger value="positions">Price Positions</TabsTrigger>
          <TabsTrigger value="rules">Pricing Rules</TabsTrigger>
        </TabsList>
        
        <TabsContent value="positions" className="mt-4">
          <div className="border rounded-md bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Brand / Company</TableHead>
                  <TableHead className="text-right">List Price</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {positions?.map((pos) => (
                  <TableRow key={pos.id}>
                    <TableCell className="font-medium text-xs font-mono">{pos.sku}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {pos.name}
                        {pos.isStandard && <Badge variant="secondary" className="text-[10px]">STD</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{pos.category}</TableCell>
                    <TableCell className="text-sm">
                      <div>{pos.brandName}</div>
                      <div className="text-xs text-muted-foreground">{pos.companyName}</div>
                    </TableCell>
                    <TableCell className="text-right font-medium">{pos.listPrice.toLocaleString()} {pos.currency}</TableCell>
                    <TableCell>v{pos.version}</TableCell>
                    <TableCell>
                      <Badge variant={pos.status === 'active' ? 'default' : 'outline'} className={pos.status === 'active' ? 'bg-green-500 hover:bg-green-600' : ''}>
                        {pos.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
                {positions?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No price positions found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        
        <TabsContent value="rules" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rules?.map((rule) => (
              <Card key={rule.id}>
                <CardHeader className="pb-2">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-base font-semibold">{rule.name}</CardTitle>
                    <Badge variant={rule.status === 'active' ? 'default' : 'outline'} className={rule.status === 'active' ? 'bg-green-500 hover:bg-green-600' : ''}>
                      {rule.status}
                    </Badge>
                  </div>
                  <Badge variant="secondary" className="w-fit">{rule.scope}</Badge>
                </CardHeader>
                <CardContent className="pt-2 text-sm">
                  <div className="flex flex-col gap-2 p-3 bg-muted/20 rounded-md border">
                    <div className="font-mono text-xs p-1.5 bg-background rounded border">{rule.condition}</div>
                    <div className="flex justify-center text-muted-foreground"><ArrowRight className="h-4 w-4" /></div>
                    <div className="font-mono text-xs p-1.5 bg-primary/10 text-primary-foreground font-semibold rounded border border-primary/20 bg-primary text-primary-foreground text-center">{rule.effect}</div>
                  </div>
                  <div className="mt-4 text-xs text-muted-foreground flex justify-between items-center">
                    <span>Priority: <span className="font-medium text-foreground">{rule.priority}</span></span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {rules?.length === 0 && (
              <div className="col-span-full p-8 text-center border rounded-md text-muted-foreground bg-muted/10">No pricing rules found.</div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {summary && summary.recentChanges.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-muted-foreground" />
              Recent Changes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {summary.recentChanges.map((change) => (
                <div key={change.id} className="flex justify-between items-center border-b pb-3 last:border-0 last:pb-0 text-sm">
                  <div className="flex flex-col">
                    <span className="font-mono text-xs text-muted-foreground">{change.sku}</span>
                    <span className="font-medium">{change.change}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(change.at).toLocaleDateString()} {new Date(change.at).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

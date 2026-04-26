import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPricingSummary,
  useListPricePositions,
  useListPriceRules,
  useDeletePricePosition,
  useDeletePriceRule,
  resolvePrice,
  type ResolvedPrice,
  type PricePosition,
  type PriceRule,
  useListPriceBundles,
  useDeletePriceBundle,
  getListPriceBundlesQueryKey,
  getListPricePositionsQueryKey,
  getListPriceRulesQueryKey,
  getGetPricingSummaryQueryKey,
  type PriceBundle,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/patterns/skeletons";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Tag, Shield, Percent, Clock, AlertTriangle, Layers, CheckCircle2, Circle, Plus, Pencil, Trash2, Package } from "lucide-react";
import { BundleFormDialog } from "@/components/pricing/bundle-form-dialog";
import { PricePositionFormDialog } from "@/components/pricing/price-position-form-dialog";
import { PriceRuleFormDialog } from "@/components/pricing/price-rule-form-dialog";
import { PricingCategoriesPanel } from "@/components/pricing/categories-panel";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";

function ResolvePanel() {
  const { t } = useTranslation();
  const [sku, setSku] = useState("");
  const [brandId, setBrandId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [result, setResult] = useState<ResolvedPrice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onResolve = async () => {
    if (!sku.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const r = await resolvePrice({ sku: sku.trim(), brandId: brandId.trim() || undefined, companyId: companyId.trim() || undefined });
      setResult(r);
    } catch {
      setResult(null);
      setError(t("pages.pricing.noResult"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          {t("pages.pricing.resolveTitle")}
        </CardTitle>
        <CardDescription>{t("pages.pricing.resolveSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Input placeholder={t("pages.pricing.sku")} value={sku} onChange={(e) => setSku(e.target.value)} />
          <Input placeholder={t("pages.pricing.brandIdPlaceholder")} value={brandId} onChange={(e) => setBrandId(e.target.value)} />
          <Input placeholder={t("pages.pricing.companyIdPlaceholder")} value={companyId} onChange={(e) => setCompanyId(e.target.value)} />
          <Button onClick={onResolve} disabled={loading || !sku.trim()}>
            {t("pages.pricing.resolve")}
          </Button>
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {result && (
          <div className="space-y-3">
            <div className="flex items-baseline gap-3 border rounded-lg p-4 bg-muted/30">
              <div className="text-xs uppercase text-muted-foreground">{t("pages.pricing.price")}</div>
              <div className="text-2xl font-bold tabular-nums">
                {result.listPrice.toLocaleString()} {result.currency}
              </div>
              <Badge variant="secondary" className="ml-auto">
                {t("pages.pricing.source")}: {result.source}
              </Badge>
            </div>
            <ol className="space-y-1.5">
              {result.chain.map((step, i) => (
                <li key={i} className="flex items-center gap-3 text-sm">
                  {step.applied ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Badge variant={step.applied ? "default" : "outline"} className="w-24 justify-center">{step.level}</Badge>
                  <span className="flex-1">{step.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {step.listPrice != null ? `${step.listPrice} ${result.currency}` : "—"}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BundlesPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: bundles, isLoading } = useListPriceBundles();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PriceBundle | null>(null);
  const [deleting, setDeleting] = useState<PriceBundle | null>(null);
  const deleteMut = useDeletePriceBundle();

  const onDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMut.mutateAsync({ id: deleting.id });
      toast({ title: t("pages.pricing.bundles.deleted"), description: deleting.name });
      await qc.invalidateQueries({ queryKey: getListPriceBundlesQueryKey() });
      setDeleting(null);
    } catch (e: unknown) {
      toast({ title: t("pages.pricing.bundles.deleteFailed"), description: String(e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4" data-testid="bundles-panel">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("pages.pricing.bundles.subtitle")}</p>
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="bundles-new-button">
          <Plus className="h-4 w-4 mr-1" />
          {t("pages.pricing.bundles.create")}
        </Button>
      </div>
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {[0,1,2].map(i => <Skeleton key={i} className="h-44 w-full" />)}
        </div>
      ) : !bundles || bundles.length === 0 ? (
        <EmptyStateCard
          icon={Package}
          title={t("pages.pricing.bundles.emptyTitle", "Noch keine Bundles")}
          body={t("pages.pricing.bundles.empty")}
          hint={t("pages.pricing.bundles.emptyHint", "Bundle recurring positions for faster quotes.")}
          primaryAction={{
            label: t("pages.pricing.bundles.create"),
            onClick: () => setCreateOpen(true),
            testId: "bundles-empty-create",
          }}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3" data-testid="bundles-grid">
          {bundles.map(b => (
            <Card key={b.id} data-testid={`bundle-${b.id}`}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2">
                    <Package className="h-5 w-5 mt-0.5 text-primary" />
                    <CardTitle className="text-base">{b.name}</CardTitle>
                  </div>
                  {b.category && <Badge variant="secondary">{b.category}</Badge>}
                </div>
                {b.description && (
                  <p className="text-xs text-muted-foreground mt-1.5">{b.description}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-2.5 text-sm">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t("bundlePicker.itemsCount", { count: b.itemCount })}</span>
                  <span className="font-bold tabular-nums">
                    {b.totalListPrice.toLocaleString()} {b.currency ?? ""}
                  </span>
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5 max-h-24 overflow-y-auto">
                  {b.items.slice(0, 5).map((it, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">{it.quantity}× {it.name}</span>
                      {Number(it.customDiscountPct) > 0 && (
                        <span className="text-rose-600">-{Number(it.customDiscountPct)}%</span>
                      )}
                    </li>
                  ))}
                  {b.items.length > 5 && <li className="italic">+{b.items.length - 5}</li>}
                </ul>
                <div className="flex gap-2 pt-2 border-t">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditing(b)} data-testid={`bundle-edit-${b.id}`}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> {t("common.edit")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(b)} data-testid={`bundle-delete-${b.id}`}>
                    <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <BundleFormDialog open={createOpen} onOpenChange={setCreateOpen} />
      <BundleFormDialog open={!!editing} onOpenChange={(v) => { if (!v) setEditing(null); }} bundle={editing} />
      <AlertDialog open={!!deleting} onOpenChange={(v) => { if (!v) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.pricing.bundles.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.pricing.bundles.deleteConfirmBody", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); onDelete(); }}>
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PositionsPanel({ positions }: { positions: PricePosition[] | undefined }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PricePosition | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<PricePosition | null>(null);
  const del = useDeletePricePosition();

  const onDelete = async () => {
    if (!confirmDelete) return;
    try {
      await del.mutateAsync({ id: confirmDelete.id });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListPricePositionsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetPricingSummaryQueryKey() }),
      ]);
      toast({ title: t("pages.pricing.positions.deleted"), description: confirmDelete.sku });
      setConfirmDelete(null);
    } catch (e: unknown) {
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: t("pages.pricing.positions.deleteFailed"),
        description: body?.error ?? (e instanceof Error ? e.message : "Unbekannt"),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm text-muted-foreground">
          {t("pages.pricing.positions.count", { count: positions?.length ?? 0 })}
        </div>
        <Button
          size="sm"
          onClick={() => { setEditing(undefined); setDialogOpen(true); }}
          data-testid="button-new-price-position"
        >
          <Plus className="mr-2 h-4 w-4" /> {t("pages.pricing.positions.new")}
        </Button>
      </div>
      <div className="border rounded-md bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background z-20 md:static md:bg-transparent">
                {t("pages.pricing.positions.headers.sku")}
              </TableHead>
              <TableHead>{t("pages.pricing.positions.headers.name")}</TableHead>
              <TableHead>{t("pages.pricing.positions.headers.category")}</TableHead>
              <TableHead>{t("pages.pricing.positions.headers.brandCompany")}</TableHead>
              <TableHead className="text-right">{t("pages.pricing.positions.headers.listPrice")}</TableHead>
              <TableHead>{t("pages.pricing.positions.headers.version")}</TableHead>
              <TableHead>{t("pages.pricing.positions.headers.status")}</TableHead>
              <TableHead className="w-24 text-right">{t("pages.pricing.positions.headers.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions?.map((pos) => {
              const catLabel = pos.categoryName ?? pos.category;
              const subLabel = pos.subcategoryName;
              return (
              <TableRow key={pos.id} data-testid={`row-position-${pos.id}`}>
                <TableCell className="font-medium text-xs font-mono sticky left-0 bg-background z-10 md:static md:bg-transparent">{pos.sku}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {pos.name}
                    {pos.isStandard && <Badge variant="secondary" className="text-[10px]">STD</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {catLabel}
                  {subLabel && <span className="text-xs"> · {subLabel}</span>}
                </TableCell>
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
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => { setEditing(pos); setDialogOpen(true); }}
                      data-testid={`button-edit-position-${pos.id}`}
                      aria-label={t("common.edit")}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setConfirmDelete(pos)}
                      data-testid={`button-delete-position-${pos.id}`}
                      aria-label={t("common.delete")}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
            {positions?.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {t("pages.pricing.positions.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <PricePositionFormDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(undefined); }}
        position={editing}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => { if (!v) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.pricing.positions.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.pricing.positions.deleteConfirmBody", {
                sku: confirmDelete?.sku ?? "",
                name: confirmDelete?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete-position"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RulesPanel({ rules }: { rules: PriceRule[] | undefined }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PriceRule | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState<PriceRule | null>(null);
  const del = useDeletePriceRule();

  const onDelete = async () => {
    if (!confirmDelete) return;
    try {
      await del.mutateAsync({ id: confirmDelete.id });
      await qc.invalidateQueries({ queryKey: getListPriceRulesQueryKey() });
      toast({ title: t("pages.pricing.rules.deleted"), description: confirmDelete.name });
      setConfirmDelete(null);
    } catch (e: unknown) {
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: t("pages.pricing.rules.deleteFailed"),
        description: body?.error ?? (e instanceof Error ? e.message : "Unbekannt"),
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-3">
        <div className="text-sm text-muted-foreground">
          {t("pages.pricing.rules.count", { count: rules?.length ?? 0 })}
        </div>
        <Button
          size="sm"
          onClick={() => { setEditing(undefined); setDialogOpen(true); }}
          data-testid="button-new-price-rule"
        >
          <Plus className="mr-2 h-4 w-4" /> {t("pages.pricing.rules.new")}
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rules?.map((rule) => (
          <Card key={rule.id} data-testid={`card-rule-${rule.id}`}>
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
                <span>{t("pages.pricing.rules.priority")}: <span className="font-medium text-foreground">{rule.priority}</span></span>
                <div className="flex gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => { setEditing(rule); setDialogOpen(true); }}
                    data-testid={`button-edit-rule-${rule.id}`}
                    aria-label={t("common.edit")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setConfirmDelete(rule)}
                    data-testid={`button-delete-rule-${rule.id}`}
                    aria-label={t("common.delete")}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {rules?.length === 0 && (
          <div className="col-span-full p-8 text-center border rounded-md text-muted-foreground bg-muted/10">
            {t("pages.pricing.rules.empty")}
          </div>
        )}
      </div>

      <PriceRuleFormDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(undefined); }}
        rule={editing}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => { if (!v) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.pricing.rules.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.pricing.rules.deleteConfirmBody", { name: confirmDelete?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive hover:bg-destructive/90"
              data-testid="button-confirm-delete-rule"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function Pricing() {
  const { t } = useTranslation();
  const { data: summary, isLoading: isLoadingSummary } = useGetPricingSummary();
  const { data: positions, isLoading: isLoadingPositions } = useListPricePositions();
  const { data: rules, isLoading: isLoadingRules } = useListPriceRules();

  if (isLoadingSummary || isLoadingPositions || isLoadingRules) {
    return <div className="p-8 space-y-6"><Skeleton className="h-32 w-full" /><TableSkeleton rows={8} cols={7} /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("pages.pricing.workspaceTitle")}</h1>
        <p className="text-muted-foreground mt-1">{t("pages.pricing.subtitle")}</p>
      </div>

      {summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t("pages.pricing.kpi.totalPositions")}</CardTitle>
              <Tag className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalPositions.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t("pages.pricing.kpi.activePositions")}</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.activePositions.toLocaleString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t("pages.pricing.kpi.pendingApprovals")}</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.pendingApprovalCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">{t("pages.pricing.kpi.standardCoverage")}</CardTitle>
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
          <TabsTrigger value="positions" data-testid="tab-positions">{t("pages.pricing.tabs.positions")}</TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-rules">{t("pages.pricing.tabs.rules")}</TabsTrigger>
          <TabsTrigger value="bundles" data-testid="tab-bundles">{t("pages.pricing.tabs.bundles")}</TabsTrigger>
          <TabsTrigger value="categories" data-testid="tab-categories">{t("pages.pricing.tabs.categories")}</TabsTrigger>
          <TabsTrigger value="resolve" data-testid="tab-resolve">{t("pages.pricing.tabs.resolve")}</TabsTrigger>
        </TabsList>

        <TabsContent value="bundles" className="mt-4">
          <BundlesPanel />
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <PricingCategoriesPanel />
        </TabsContent>

        <TabsContent value="resolve" className="mt-4">
          <ResolvePanel />
        </TabsContent>

        <TabsContent value="positions" className="mt-4">
          <PositionsPanel positions={positions} />
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <RulesPanel rules={rules} />
        </TabsContent>
      </Tabs>

      {summary && summary.recentChanges.length > 0 && (
        <Card className="mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="h-5 w-5 text-muted-foreground" />
              {t("pages.pricing.recentChangesTitle")}
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

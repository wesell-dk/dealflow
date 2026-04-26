import { useState, useCallback, useRef, useMemo } from "react";
import { extractLogoColors, foregroundFor, isTooLightForPaper } from "@/lib/extract-logo-colors";
import { toAssetSrc } from "@/lib/asset-url";
import { useTranslation } from "react-i18next";
import {
  useGetTenant,
  useListCompanies,
  useListBrands,
  useUpdateBrand,
  useDeleteCompany,
  useDeleteBrand,
  getListCompaniesQueryKey,
  getListBrandsQueryKey,
  useListUsers,
  useListAdminUsers,
  useCreateAdminUser,
  useUpdateAdminUser,
  useListRoles,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useGetScopeTree,
  type Brand,
  type BrandUpdate,
  type Company,
  type AdminUser,
  useSearchGdprSubjects,
  useForgetGdprSubject,
  useListGdprAccessLog,
  useListGdprDeletionLog,
  useGetGdprRetentionPolicy,
  useUpdateGdprRetentionPolicy,
  useRunGdprRetention,
  useListContractTypes,
  useCreateContractType,
  useUpdateContractType,
  useDeleteContractType,
  useListContractPlaybooks,
  useCreateContractPlaybook,
  useUpdateContractPlaybook,
  useDeleteContractPlaybook,
  useListClauseFamilies,
  getListContractTypesQueryKey,
  getListContractPlaybooksQueryKey,
  useListIndustryProfiles,
  useCreateIndustryProfile,
  useUpdateIndustryProfile,
  useDeleteIndustryProfile,
  getListIndustryProfilesQueryKey,
  useListPermissionCatalog,
  type ContractType,
  type ContractPlaybook,
  type IndustryProfile,
  type PermissionCatalogEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { fetchUploadUrlWithRetry } from "@/lib/upload-retry";
import { CompanyFormDialog } from "@/components/admin/company-form-dialog";
import { BrandFormDialog, parseAddressLine, composeAddressLine } from "@/components/admin/brand-form-dialog";
import { ApprovalChainsCard } from "@/components/admin/approval-chains-card";
import { AiRecommendationsMetricsCard } from "@/components/admin/ai-recommendations-metrics-card";
import { LegalKnowledgeCard } from "@/components/admin/legal-knowledge-card";
import { EmailChannelsCard } from "@/components/admin/email-channels-card";
import { RegulatoryFrameworksCard } from "@/components/admin/regulatory-frameworks-card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Shield, Building2, Users, Download, Trash2, Eye, Play, ShieldAlert, Webhook, Plus, RefreshCw, Lock, Upload, X, Image as ImageIcon, ChevronDown, Sparkles } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect } from "react";

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleString(); } catch { return v; }
}

export default function Admin() {
  const { t } = useTranslation();
  const { data: tenant, isLoading: isLoadingTenant } = useGetTenant();
  const { data: companies, isLoading: isLoadingCompanies } = useListCompanies();
  const { data: brands, isLoading: isLoadingBrands } = useListBrands();
  const { data: users, isLoading: isLoadingUsers } = useListUsers();

  const [query, setQuery] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const subjectSearch = useSearchGdprSubjects(
    { subjectType: "contact", query },
    { query: { queryKey: ["gdprSubjects", query] } },
  );
  const accessLog = useListGdprAccessLog(
    selectedSubjectId ? { entityType: "contact", entityId: selectedSubjectId } : {},
    { query: { enabled: !!selectedSubjectId, queryKey: ["gdprAccessLog", selectedSubjectId] } },
  );
  const deletionLog = useListGdprDeletionLog();
  const policy = useGetGdprRetentionPolicy();
  const forget = useForgetGdprSubject();
  const updatePolicy = useUpdateGdprRetentionPolicy();
  const runSweep = useRunGdprRetention();

  const [policyDraft, setPolicyDraft] = useState<Record<string, string>>({});

  // Companies CRUD
  const qc = useQueryClient();
  const { toast } = useToast();
  const [companyDialogOpen, setCompanyDialogOpen] = useState(false);
  const [companyToEdit, setCompanyToEdit] = useState<Company | null>(null);
  const [companyToDelete, setCompanyToDelete] = useState<Company | null>(null);
  const [deleteConflict, setDeleteConflict] = useState<{ kind: "company" | "brand"; name: string; blockers: Record<string, number> } | null>(null);
  const deleteCompanyMut = useDeleteCompany();
  const onDeleteCompanyConfirm = async () => {
    if (!companyToDelete) return;
    try {
      await deleteCompanyMut.mutateAsync({ id: companyToDelete.id });
      await qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
      toast({ title: "Company deleted", description: companyToDelete.name });
      setCompanyToDelete(null);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string; blockers?: Record<string, number> } } })?.response?.data;
      if (status === 409 && body?.blockers) {
        setDeleteConflict({ kind: "company", name: companyToDelete.name, blockers: body.blockers });
        setCompanyToDelete(null);
      } else {
        toast({ title: "Delete failed", description: body?.error ?? "Unknown", variant: "destructive" });
      }
    }
  };

  // Brands CRUD
  const [brandDialogOpen, setBrandDialogOpen] = useState(false);

  const isLoading = isLoadingTenant || isLoadingCompanies || isLoadingBrands || isLoadingUsers;

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-[800px] w-full" /></div>;
  }

  const onExport = async (id: string) => {
    const resp = await fetch(
      `${import.meta.env.BASE_URL}api/gdpr/export?subjectType=contact&subjectId=${encodeURIComponent(id)}`,
      { credentials: "include" },
    );
    if (!resp.ok) {
      setStatus(`Export failed (${resp.status})`);
      return;
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gdpr-export-contact-${id}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(t("pages.admin.gdpr.exportDone"));
  };

  const onForget = async (id: string) => {
    if (!window.confirm(t("pages.admin.gdpr.forgetConfirm"))) return;
    await forget.mutateAsync({ data: { subjectType: "contact", subjectId: id } });
    setStatus(t("pages.admin.gdpr.forgetDone"));
    subjectSearch.refetch();
    deletionLog.refetch();
  };

  const currentPolicy = policy.data?.policy ?? {};
  const getPolicyVal = (k: string) =>
    policyDraft[k] ?? String((currentPolicy as Record<string, unknown>)[k] ?? "");

  const onSavePolicy = async () => {
    const body: Record<string, number> = {};
    for (const [k, v] of Object.entries(policyDraft)) {
      const n = Number(v);
      if (!Number.isNaN(n) && n > 0) body[k] = n;
    }
    await updatePolicy.mutateAsync({ data: body });
    setStatus(t("pages.admin.gdpr.retentionSaved"));
    setPolicyDraft({});
    policy.refetch();
  };

  const onRunSweep = async () => {
    await runSweep.mutateAsync();
    setStatus(t("pages.admin.gdpr.retentionRunDone"));
  };

  return (
    <div className="flex flex-col gap-6 pb-10">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-muted rounded-lg">
          <Settings className="h-6 w-6 text-foreground" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.admin.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.admin.subtitle")}</p>
        </div>
      </div>

      {tenant && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>{t("pages.admin.tenantConfig")}</CardTitle>
          </CardHeader>
          <CardContent>
            <TooltipProvider delayDuration={150}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
                <div>
                  <div className="text-sm text-muted-foreground">Tenant Name</div>
                  <div className="font-medium text-lg" data-testid="tenant-config-name">{tenant.name}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                    Plan
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Lock className="h-3 w-3 text-muted-foreground cursor-help" aria-label={t("pages.admin.platformManagedTooltip")} />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {t("pages.admin.planTooltip")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="font-medium"><Badge variant="outline">{tenant.plan}</Badge></div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground flex items-center gap-1">
                    Region
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Lock className="h-3 w-3 text-muted-foreground cursor-help" aria-label={t("pages.admin.platformManagedTooltip")} />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {t("pages.admin.regionTooltip")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="font-medium">{tenant.region}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Created</div>
                  <div className="font-medium">{new Date(tenant.createdAt).toLocaleDateString()}</div>
                </div>
              </div>
            </TooltipProvider>
            <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              {t("pages.admin.tenantStewardshipNote")}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex flex-row items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <CardTitle>{t("pages.admin.companies")}</CardTitle>
            </div>
            <Button size="sm" onClick={() => { setCompanyToEdit(null); setCompanyDialogOpen(true); }} data-testid="button-new-company">
              <Plus className="h-4 w-4 mr-1" />
              {t("pages.admin.newCompany")}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead>{t("pages.admin.legalEntity")}</TableHead>
                    <TableHead>{t("common.country")}</TableHead>
                    <TableHead>{t("common.currency")}</TableHead>
                    <TableHead className="text-right">{t("pages.admin.actionsCol")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies?.map(company => (
                    <TableRow key={company.id} data-testid={`row-company-${company.id}`}>
                      <TableCell className="font-medium">{company.name}</TableCell>
                      <TableCell className="text-muted-foreground">{company.legalName}</TableCell>
                      <TableCell>{company.country}</TableCell>
                      <TableCell>{company.currency}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => { setCompanyToEdit(company); setCompanyDialogOpen(true); }} data-testid={`button-edit-company-${company.id}`}>
                            {t("pages.admin.edit")}
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCompanyToDelete(company)} data-testid={`button-delete-company-${company.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!companies?.length && (
                    <TableRow><TableCell colSpan={5} className="text-center h-16">{t("pages.admin.noCompanies")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex flex-row items-center gap-2">
              <div className="flex space-x-[-8px]">
                <div className="h-5 w-5 rounded-full bg-blue-500 ring-2 ring-background"></div>
                <div className="h-5 w-5 rounded-full bg-red-500 ring-2 ring-background"></div>
              </div>
              <CardTitle>{t("pages.admin.brands")}</CardTitle>
            </div>
            <Button size="sm" onClick={() => setBrandDialogOpen(true)} disabled={!companies?.length} data-testid="button-new-brand">
              <Plus className="h-4 w-4 mr-1" />
              {t("pages.admin.newBrand")}
            </Button>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pages.admin.brand")}</TableHead>
                    <TableHead>{t("pages.admin.parentCompany")}</TableHead>
                    <TableHead>{t("pages.admin.voice")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brands?.map(brand => (
                    <BrandRow key={brand.id} brand={brand} />
                  ))}
                  {!brands?.length && (
                    <TableRow><TableCell colSpan={3} className="text-center h-16">{t("pages.admin.noBrands")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <CompanyFormDialog
        open={companyDialogOpen}
        onOpenChange={(v) => { setCompanyDialogOpen(v); if (!v) setCompanyToEdit(null); }}
        company={companyToEdit}
      />
      <BrandFormDialog
        open={brandDialogOpen}
        onOpenChange={setBrandDialogOpen}
        companies={companies ?? []}
      />

      <AlertDialog open={!!companyToDelete} onOpenChange={(v) => { if (!v) setCompanyToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.admin.deleteCompanyTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{companyToDelete?.name}</span> {t("pages.admin.deleteCompanyBodySuffix")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCompanyMut.isPending}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onDeleteCompanyConfirm} disabled={deleteCompanyMut.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-company">
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConflict} onOpenChange={(v) => { if (!v) setDeleteConflict(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.admin.deleteBlockedTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {deleteConflict?.kind === "company" ? t("pages.admin.kindCompany") : t("pages.admin.kindBrand")}{" "}
                  <span className="font-medium text-foreground">{deleteConflict?.name}</span> {t("pages.admin.deleteBlockedBodySuffix")}
                </p>
                <ul className="list-disc pl-5 text-sm">
                  {deleteConflict && Object.entries(deleteConflict.blockers).filter(([, n]) => n > 0).map(([k, n]) => (
                    <li key={k}><span className="font-medium">{n}</span> {k}</li>
                  ))}
                </ul>
                <p className="text-sm">{t("pages.admin.deleteBlockedFooter")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setDeleteConflict(null)}>{t("common.understood")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UserRolesCard />

      <EmailChannelsCard />

      <RolesCard />

      <IndustryProfilesCard />

      <ContractTypesCard />

      <ContractPlaybooksCard />

      <ApprovalChainsCard />

      <AiRecommendationsMetricsCard />

      <LegalKnowledgeCard />

      <RegulatoryFrameworksCard />

      {/* Erweiterte Einstellungen — Webhooks und DSGVO. Standardmäßig
          eingeklappt, weil die meisten Tenants hier mit den Defaults gut fahren
          und nichts manuell konfigurieren müssen. */}
      <AdvancedSettingsSection>

      <WebhooksSection />

      {/* GDPR Section */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>{t("pages.admin.gdpr.title")}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{t("pages.admin.gdpr.subtitle")}</p>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {status && (
            <div className="rounded-md bg-muted px-3 py-2 text-sm">{status}</div>
          )}

          {/* Subject search */}
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("pages.admin.gdpr.searchPlaceholder")}
                className="max-w-md"
              />
              <Button variant="secondary" onClick={() => subjectSearch.refetch()}>
                {t("pages.admin.gdpr.search")}
              </Button>
            </div>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("common.name")}</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subjectSearch.data?.results?.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="text-muted-foreground">{s.email}</TableCell>
                      <TableCell>
                        {s.deletedAt ? (
                          <Badge variant="destructive">{t("pages.admin.gdpr.deletedBadge")}</Badge>
                        ) : (
                          <Badge variant="outline">Active</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onExport(s.id)}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            {t("pages.admin.gdpr.export")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedSubjectId(s.id)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            {t("pages.admin.gdpr.viewAccessLog")}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={!!s.deletedAt}
                            onClick={() => onForget(s.id)}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            {t("pages.admin.gdpr.forget")}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(!subjectSearch.data?.results || subjectSearch.data.results.length === 0) && (
                    <TableRow><TableCell colSpan={4} className="text-center h-16 text-muted-foreground">{t("pages.admin.gdpr.noResults")}</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Access log for selected subject */}
          {selectedSubjectId && (
            <div className="flex flex-col gap-2">
              <div className="font-medium">{t("pages.admin.gdpr.accessLog")} — {selectedSubjectId}</div>
              <div className="border rounded-md max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("pages.admin.gdpr.colAt")}</TableHead>
                      <TableHead>{t("pages.admin.gdpr.colActor")}</TableHead>
                      <TableHead>{t("pages.admin.gdpr.colField")}</TableHead>
                      <TableHead>Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accessLog.data?.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{fmtDate(r.at)}</TableCell>
                        <TableCell>{r.actorName}</TableCell>
                        <TableCell><Badge variant="secondary">{r.field}</Badge></TableCell>
                        <TableCell>{r.action}</TableCell>
                      </TableRow>
                    ))}
                    {(!accessLog.data || accessLog.data.length === 0) && (
                      <TableRow><TableCell colSpan={4} className="text-center h-16 text-muted-foreground">{t("pages.admin.gdpr.accessLogEmpty")}</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Retention policy — Defaults sind serverseitig hinterlegt
              (3J Contacts, 2J Korrespondenz, 7J Audit, 1J Access-Log) und
              werden automatisch angewendet. Eigene Valuee überschreiben sie. */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="font-medium">{t("pages.admin.gdpr.retention")}</div>
              <Badge variant="outline" className="text-[10px]">Defaults active</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Without your own input, statutory default retention periods apply
              (German HGB/BGB and tax requirements). You only need to intervene
              here if you want to deviate from them.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {(["contactInactiveDays", "letterRespondedDays", "auditLogDays", "accessLogDays"] as const).map((k) => {
                const defaultVal = (policy.data as { defaults?: Record<string, number> })?.defaults?.[k];
                return (
                  <div key={k} className="flex flex-col gap-1">
                    <Label className="text-xs text-muted-foreground">{t(`pages.admin.gdpr.fields.${k}`)}</Label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={getPolicyVal(k)}
                      onChange={(e) => setPolicyDraft((d) => ({ ...d, [k]: e.target.value }))}
                      placeholder={defaultVal ? String(defaultVal) : "—"}
                    />
                    {defaultVal !== undefined && (
                      <span className="text-[11px] text-muted-foreground">Default: {defaultVal} days</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button onClick={onSavePolicy} disabled={Object.keys(policyDraft).length === 0}>
                {t("common.save", "Save")}
              </Button>
              <Button variant="outline" onClick={onRunSweep}>
                <Play className="h-4 w-4 mr-1" />
                {t("pages.admin.gdpr.retentionRun")}
              </Button>
            </div>
          </div>

          {/* Deletion log */}
          <div className="flex flex-col gap-2">
            <div className="font-medium">{t("pages.admin.gdpr.deletionLog")}</div>
            <div className="border rounded-md max-h-72 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("pages.admin.gdpr.colAt")}</TableHead>
                    <TableHead>{t("pages.admin.gdpr.colSubject")}</TableHead>
                    <TableHead>{t("pages.admin.gdpr.colRequestedBy")}</TableHead>
                    <TableHead>{t("pages.admin.gdpr.colReason")}</TableHead>
                    <TableHead>{t("pages.admin.gdpr.colStatus")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deletionLog.data?.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs">{fmtDate(d.requestedAt)}</TableCell>
                      <TableCell><code className="text-xs">{d.subjectType}/{d.subjectId}</code></TableCell>
                      <TableCell>{d.requestedBy}</TableCell>
                      <TableCell className="text-muted-foreground">{d.reason ?? "—"}</TableCell>
                      <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                    </TableRow>
                  ))}
                  {(!deletionLog.data || deletionLog.data.length === 0) && (
                    <TableRow><TableCell colSpan={5} className="text-center h-16 text-muted-foreground">—</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      </AdvancedSettingsSection>
    </div>
  );
}

/**
 * Klappt Webhooks und DSGVO ein. Beide sind Tenant-spezifische
 * Konfigurationen, die für die meisten Tenants out-of-the-box mit den
 * Defaults laufen — Webhook-Endpunkte gibt es erst, wenn ein Kunde
 * tatsächlich integrieren will, und die DSGVO-Aufbewahrungsregeln sind
 * server-seitig auf gesetzeskonforme Werte vorbelegt (siehe
 * `defaultRetentionPolicy` im Backend). Wir zeigen die Sektion daher
 * standardmäßig zugeklappt, damit die Hauptseite ruhig bleibt.
 */
function AdvancedSettingsSection({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-lg">
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-muted/40 rounded-t-lg" data-testid="advanced-settings-trigger">
        <div className="flex items-center gap-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">Advanced settings</span>
          <span className="text-xs text-muted-foreground">— Webhooks and GDPR (defaults already in effect)</span>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t">
        <div className="flex flex-col gap-6 p-4">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function BrandRow({ brand }: { brand: Brand }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [conflict, setConflict] = useState<Record<string, number> | null>(null);
  const [draft, setDraft] = useState<Required<Omit<BrandUpdate, "name" | "color" | "voice">>>({
    logoUrl: brand.logoUrl ?? "",
    primaryColor: brand.primaryColor ?? brand.color ?? "#2D6CDF",
    secondaryColor: brand.secondaryColor ?? "",
    tone: brand.tone ?? brand.voice ?? "",
    legalEntityName: brand.legalEntityName ?? "",
    addressLine: brand.addressLine ?? "",
    parentBrandId: brand.parentBrandId ?? null,
    defaultLanguage: brand.defaultLanguage ?? "de",
    defaultContractTypeId: brand.defaultContractTypeId ?? null,
    defaultTaxRatePct: brand.defaultTaxRatePct ?? null,
  });
  const contractTypesQ = useListContractTypes();
  // Address kept in three independent fields for editing; composed back into
  // `addressLine` on save so the API/PDFs stay byte-identical.
  const initialAddress = parseAddressLine(brand.addressLine ?? "");
  const [street, setStreet] = useState(initialAddress.street);
  const [postalCode, setPostalCode] = useState(initialAddress.postalCode);
  const [city, setCity] = useState(initialAddress.city);
  const allBrandsQ = useListBrands();
  const NO_PARENT = "_none_";
  const parentCandidates = (allBrandsQ.data ?? []).filter(b => {
    if (b.companyId !== brand.companyId) return false;
    if (b.id === brand.id) return false;
    // Block descendants
    let cur: string | null | undefined = b.parentBrandId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      if (cur === brand.id) return false;
      seen.add(cur);
      cur = (allBrandsQ.data ?? []).find(x => x.id === cur)?.parentBrandId;
    }
    return true;
  });
  const update = useUpdateBrand();
  const del = useDeleteBrand();
  const onDelete = async () => {
    try {
      await del.mutateAsync({ id: brand.id });
      await qc.invalidateQueries({ queryKey: getListBrandsQueryKey() });
      toast({ title: "Brand deleted", description: brand.name });
      setConfirmDelete(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string; blockers?: Record<string, number> } } })?.response?.data;
      if (status === 409 && body?.blockers) {
        setConfirmDelete(false);
        setConflict(body.blockers);
      } else {
        toast({ title: "Delete failed", description: body?.error ?? "Unknown", variant: "destructive" });
      }
    }
  };
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [primaryTouched, setPrimaryTouched] = useState(false);
  const [secondaryTouched, setSecondaryTouched] = useState(false);
  const [colorsExtracted, setColorsExtracted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Refs für die touched-Flags + Upload-Token, damit asynchrone Color-Apply-
  // Steps den jeweils aktuellen Stand sehen und parallele Uploads sich nicht
  // gegenseitig überschreiben (siehe identische Logik in BrandFormDialog).
  const primaryTouchedRef = useRef(false);
  const secondaryTouchedRef = useRef(false);
  const uploadTokenRef = useRef(0);
  // Hex-Validation: Picker liefert immer #RRGGBB, das danebenstehende Text-
  // Feld erlaubt aber Free-Text. Wir lehnen Ungültiges client-side ab, sonst
  // kommt eine kryptische 422 vom Backend ohne Recovery-Pfad (User-Frust).
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  const primaryInvalid = !HEX_RE.test(draft.primaryColor || "");
  const secondaryInvalid = !!draft.secondaryColor && !HEX_RE.test(draft.secondaryColor);
  const save = async () => {
    if (primaryInvalid || secondaryInvalid) {
      toast({
        title: "Invalid color",
        description: "Please use hex format #RRGGBB (e.g. #2D6CDF) or leave empty.",
        variant: "destructive",
      });
      return;
    }
    try {
      const composedAddress = composeAddressLine(street, postalCode, city);
      const payload: BrandUpdate = { ...draft, addressLine: composedAddress || null };
      await update.mutateAsync({ id: brand.id, data: payload });
      setEditing(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: status === 409 ? "Name already taken" : "Save failed",
        description: body?.error ?? (e instanceof Error ? e.message : "Unknown error"),
        variant: "destructive",
      });
    }
  };
  const onUpload = async (file: File) => {
    const ALLOWED = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
    if (!ALLOWED.includes(file.type)) {
      setUploadError("Format not supported — PNG/JPEG/SVG/WebP.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — maximum 5 MB.`);
      return;
    }
    setUploading(true); setUploadError(null);
    const myToken = ++uploadTokenRef.current;
    const colorsPromise = extractLogoColors(file).catch(() => null);
    const applyColors = async () => {
      const colors = await colorsPromise;
      if (myToken !== uploadTokenRef.current) return;
      if (!colors) return;
      setColorsExtracted(true);
      setDraft(d => ({
        ...d,
        primaryColor: primaryTouchedRef.current ? d.primaryColor : colors.primary,
        secondaryColor: secondaryTouchedRef.current ? d.secondaryColor : (colors.secondary ?? d.secondaryColor),
      }));
    };
    try {
      const res = await fetchUploadUrlWithRetry(
        `${import.meta.env.BASE_URL}api/storage/uploads/request-url`,
        {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type, kind: "logo" }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const serverMsg =
          (body as { message?: string; error?: string })?.message
          ?? (body as { error?: string })?.error;
        const msg = serverMsg
          ?? (res.status === 401 ? "Session expired — please sign in again."
              : res.status === 403 ? "Only tenant admins are allowed to upload logos."
              : (res.status === 502 || res.status === 503 || res.status === 504)
                ? "Server briefly unavailable. Please try again in a few seconds."
                : `Upload URL failed (${res.status})`);
        throw new Error(msg);
      }
      const { uploadURL, objectPath } = await res.json();
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      if (myToken === uploadTokenRef.current) {
        setDraft(d => ({ ...d, logoUrl: `/api/storage${objectPath}` }));
      }
      await applyColors();
    } catch (e: unknown) {
      // Auch bei fehlgeschlagenem Server-Upload bekommt der User die lokal
      // abgeleiteten Farben — sein Logo (URL-Eingabe) kann er später nachreichen.
      await applyColors();
      setUploadError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void onUpload(f);
  };
  return (
    <>
      <TableRow>
        <TableCell>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: brand.primaryColor ?? brand.color }}></div>
              <span className="font-medium">{brand.name}</span>
            </div>
            {brand.parentBrandId && (() => {
              const parent = (allBrandsQ.data ?? []).find(b => b.id === brand.parentBrandId);
              return parent ? (
                <span className="text-[11px] text-muted-foreground pl-6">↳ Sub-Brand unter <span className="font-medium">{parent.name}</span></span>
              ) : null;
            })()}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">{brand.companyId}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{brand.tone ?? brand.voice}</Badge>
            <Button size="sm" variant="ghost" onClick={() => setEditing(v => !v)}>
              {editing ? "Close" : "Edit"}
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)} data-testid={`button-delete-brand-${brand.id}`}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {editing && (
        <TableRow>
          <TableCell colSpan={3} className="bg-muted/30">
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="col-span-2">
                <Label>Logo</Label>
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`mt-1 cursor-pointer rounded-md border-2 border-dashed transition-colors ${
                    dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-muted-foreground/60"
                  }`}
                  data-testid={`brand-row-logo-dropzone-${brand.id}`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    onChange={e => { const f = e.target.files?.[0]; if (f) void onUpload(f); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                    disabled={uploading}
                    className="hidden"
                  />
                  <div className="flex items-center gap-4 p-4">
                    {draft.logoUrl ? (
                      // Großes Preview damit das Logo wirklich erkennbar ist —
                      // klein war's vorher kaum aussagekräftig (User-Feedback).
                      <div className="flex-shrink-0 h-24 w-24 rounded-md border bg-white p-2 flex items-center justify-center">
                        <img src={toAssetSrc(draft.logoUrl)} alt="Logo preview" className="max-h-full max-w-full object-contain" />
                      </div>
                    ) : (
                      <div className="flex-shrink-0 h-24 w-24 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-8 w-8" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0 text-sm">
                      {uploading ? (
                        <span className="text-muted-foreground">Uploading…</span>
                      ) : draft.logoUrl ? (
                        <>
                          <div className="font-medium">Drag a file or click to replace</div>
                          <div className="text-xs text-muted-foreground mt-1">The current logo is checked against white and dark grey in the preview below.</div>
                        </>
                      ) : (
                        <>
                          <div className="font-medium">Drag a file here or click</div>
                          <div className="text-xs text-muted-foreground mt-1">PNG, JPEG, SVG, WebP — up to 5 MB</div>
                        </>
                      )}
                    </div>
                    {draft.logoUrl && !uploading && (
                      <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setDraft(d => ({ ...d, logoUrl: "" })); setColorsExtracted(false); }} aria-label="Remove logo">
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                    {!draft.logoUrl && !uploading && (
                      <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                        <Upload className="h-4 w-4 mr-1" />Upload
                      </Button>
                    )}
                  </div>
                  {/* Kontrast-Vorschau: Logo + Primärfarbe gegen weißen
                      DIN-A4-Hintergrund und gegen dunkles Header-Grau. So
                      sieht der User sofort, ob ein helles/weißes Logo oder
                      eine helle Primärfarbe auf einem Ausdruck verschwindet. */}
                  {draft.logoUrl && !uploading && (
                    <div className="border-t grid grid-cols-2 gap-px bg-muted/30">
                      <div className="bg-white p-3 flex items-center justify-center gap-3" title="Effect on white paper (DIN A4 / letterhead)">
                        <img src={toAssetSrc(draft.logoUrl)} alt="" className="h-10 w-10 object-contain" />
                        <span className="px-2 py-1 rounded text-xs font-medium" style={{ background: draft.primaryColor || "#ffffff", color: foregroundFor(draft.primaryColor || "#ffffff") }}>
                          Primary · on white
                        </span>
                      </div>
                      <div className="bg-slate-900 p-3 flex items-center justify-center gap-3" title="Effect on dark header (App / Web)">
                        <img src={toAssetSrc(draft.logoUrl)} alt="" className="h-10 w-10 object-contain" />
                        <span className="px-2 py-1 rounded text-xs font-medium" style={{ background: draft.primaryColor || "#ffffff", color: foregroundFor(draft.primaryColor || "#ffffff") }}>
                          Primary · on dark
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                <Input
                  className="mt-1 text-xs"
                  value={draft.logoUrl ?? ""}
                  onChange={e => setDraft({ ...draft, logoUrl: e.target.value })}
                  placeholder="…oder URL eintragen: https://… / /api/storage/objects/…"
                />
                {uploadError && <p className="text-xs text-destructive mt-1">{uploadError}</p>}
                {colorsExtracted && (
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    Colors derived from logo — you can adjust them below.
                  </p>
                )}
              </div>
              <div className="col-span-2">
                <Label>Parent brand</Label>
                <Select
                  value={draft.parentBrandId ?? NO_PARENT}
                  onValueChange={(v) => setDraft({ ...draft, parentBrandId: v === NO_PARENT ? null : v })}
                >
                  <SelectTrigger data-testid={`select-brand-parent-${brand.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARENT}>— None (top level) —</SelectItem>
                    {parentCandidates.map(b => (
                      <SelectItem key={b.id} value={b.id} textValue={b.name}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Optional — sub-brand under a parent brand.</p>
              </div>
              <div className="col-span-2">
                <Label>Default contract type</Label>
                <Select
                  value={draft.defaultContractTypeId ?? NO_PARENT}
                  onValueChange={(v) => setDraft({ ...draft, defaultContractTypeId: v === NO_PARENT ? null : v })}
                >
                  <SelectTrigger data-testid={`select-brand-default-contract-type-${brand.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARENT}>— Heuristic from template name —</SelectItem>
                    {(contractTypesQ.data ?? []).filter(ct => ct.active !== false).map(ct => (
                      <SelectItem key={ct.id} value={ct.id} textValue={ct.name}>
                        <div className="flex flex-col">
                          <span className="font-medium">{ct.name}</span>
                          <span className="text-xs text-muted-foreground">{ct.code}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Used in "Create contract" when no contract type is explicitly chosen — before the
                  keyword heuristic on the template name.
                </p>
              </div>
              <div>
                <Label>Tone / Voice</Label>
                <Input value={draft.tone ?? ""} onChange={e => setDraft({ ...draft, tone: e.target.value })} />
              </div>
              <div>
                <Label>Primary color</Label>
                <div className="flex gap-2">
                  <Input type="color" className="w-14 p-1" value={HEX_RE.test(draft.primaryColor || "") ? (draft.primaryColor as string) : "#2D6CDF"} onChange={e => { setDraft({ ...draft, primaryColor: e.target.value }); setPrimaryTouched(true); primaryTouchedRef.current = true; }} />
                  <Input className={`flex-1 font-mono text-xs ${primaryInvalid ? "border-destructive" : ""}`} value={draft.primaryColor ?? ""} onChange={e => { setDraft({ ...draft, primaryColor: e.target.value }); setPrimaryTouched(true); primaryTouchedRef.current = true; }} placeholder="#2D6CDF" data-testid={`input-brand-primary-${brand.id}`} />
                </div>
                {primaryInvalid && (
                  <p className="mt-1 text-xs text-destructive">Please enter hex format #RRGGBB.</p>
                )}
                {/* Wenn die Primärfarbe nahezu Weiß ist, würde sie auf weißem
                    Briefkopf untergehen → wir warnen aktiv und bieten eine
                    sichere Alternative (Slate-900) an. */}
                {isTooLightForPaper(draft.primaryColor || "#ffffff") && (
                  <div className="mt-1 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                    <span className="font-medium">⚠ Very light:</span>
                    <span className="flex-1">
                      On white paper (e.g. printed contract) this color is barely visible.
                      Choose a darker shade.
                    </span>
                    <button type="button" className="underline whitespace-nowrap" onClick={() => { setDraft(d => ({ ...d, primaryColor: "#0f172a" })); setPrimaryTouched(true); primaryTouchedRef.current = true; }}>
                      Set to Slate-900
                    </button>
                  </div>
                )}
              </div>
              <div>
                <Label>Secondary color</Label>
                <div className="flex gap-2">
                  <Input type="color" className="w-14 p-1" value={HEX_RE.test(draft.secondaryColor || "") ? (draft.secondaryColor as string) : "#000000"} onChange={e => { setDraft({ ...draft, secondaryColor: e.target.value }); setSecondaryTouched(true); secondaryTouchedRef.current = true; }} />
                  <Input className={`flex-1 font-mono text-xs ${secondaryInvalid ? "border-destructive" : ""}`} value={draft.secondaryColor ?? ""} onChange={e => { setDraft({ ...draft, secondaryColor: e.target.value }); setSecondaryTouched(true); secondaryTouchedRef.current = true; }} placeholder="empty = primary color only" data-testid={`input-brand-secondary-${brand.id}`} />
                </div>
                {secondaryInvalid && (
                  <p className="mt-1 text-xs text-destructive">Please enter hex format #RRGGBB or leave empty.</p>
                )}
              </div>
              <div>
                <Label>Legal Entity Name</Label>
                <Input value={draft.legalEntityName ?? ""} onChange={e => setDraft({ ...draft, legalEntityName: e.target.value })} />
              </div>
              <div>
                <Label>Address (legal notice)</Label>
                <Input
                  value={street}
                  onChange={e => setStreet(e.target.value)}
                  placeholder="Street / house number (e.g. Sample St. 1)"
                  data-testid={`input-brand-street-${brand.id}`}
                  aria-label="Street and house number"
                />
                <div className="mt-2 grid grid-cols-[1fr_2fr] gap-2">
                  <Input
                    value={postalCode}
                    onChange={e => setPostalCode(e.target.value)}
                    placeholder="ZIP"
                    data-testid={`input-brand-postal-code-${brand.id}`}
                    aria-label="Postal code"
                    inputMode="numeric"
                  />
                  <Input
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    placeholder="City"
                    data-testid={`input-brand-city-${brand.id}`}
                    aria-label="City"
                  />
                </div>
              </div>
              <div className="col-span-2 flex justify-end gap-2">
                <Button size="sm" onClick={save} disabled={update.isPending || primaryInvalid || secondaryInvalid} data-testid={`button-brand-save-${brand.id}`}>Save</Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Brand delete?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{brand.name}</span> will be permanently removed.
              If deals or price positions are linked to it, the platform blocks deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={del.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid={`button-confirm-delete-brand-${brand.id}`}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!conflict} onOpenChange={(v) => { if (!v) setConflict(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete blocked</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Brand <span className="font-medium text-foreground">{brand.name}</span> still has linked records:</p>
                <ul className="list-disc pl-5 text-sm">
                  {conflict && Object.entries(conflict).filter(([, n]) => n > 0).map(([k, n]) => (
                    <li key={k}><span className="font-medium">{n}</span> {k}</li>
                  ))}
                </ul>
                <p className="text-sm">Please archive or reassign them first.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setConflict(null)}>Got it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type NewUserDraft = {
  name: string;
  email: string;
  role: string;
  password: string;
  tenantWide: boolean;
  scopeCompanyIds: string[];
  scopeBrandIds: string[];
};

const EMPTY_DRAFT: NewUserDraft = {
  name: "", email: "", role: "", password: "",
  tenantWide: false, scopeCompanyIds: [], scopeBrandIds: [],
};

function ScopeTreeEditor(props: {
  tenantWide: boolean;
  onTenantWideChange: (v: boolean) => void;
  companyIds: string[];
  brandIds: string[];
  onCompanyIdsChange: (v: string[]) => void;
  onBrandIdsChange: (v: string[]) => void;
}) {
  const tree = useGetScopeTree();
  const { tenantWide, onTenantWideChange, companyIds, brandIds, onCompanyIdsChange, onBrandIdsChange } = props;
  const companies = tree.data?.companies ?? [];

  const toggleCompany = (id: string) => {
    if (companyIds.includes(id)) onCompanyIdsChange(companyIds.filter(x => x !== id));
    else onCompanyIdsChange([...companyIds, id]);
  };
  const toggleBrand = (id: string) => {
    if (brandIds.includes(id)) onBrandIdsChange(brandIds.filter(x => x !== id));
    else onBrandIdsChange([...brandIds, id]);
  };

  return (
    <div className="space-y-3 border rounded-md p-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={tenantWide} onChange={e => onTenantWideChange(e.target.checked)} />
        Tenant-wide (full access)
      </label>
      <div className={tenantWide ? "opacity-40 pointer-events-none" : ""}>
        <div className="text-xs text-muted-foreground mb-2">
          Choose companies (full access to all associated brands) and/or individual brands.
        </div>
        <div className="space-y-3 max-h-72 overflow-auto">
          {companies.map(c => (
            <div key={c.id} className="border-l-2 border-muted pl-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={companyIds.includes(c.id)} onChange={() => toggleCompany(c.id)} />
                {c.name}
              </label>
              <div className="ml-6 mt-1 space-y-1">
                {c.brands.map(b => (
                  <label key={b.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={brandIds.includes(b.id)}
                      onChange={() => toggleBrand(b.id)}
                      disabled={companyIds.includes(c.id)}
                    />
                    <span className={companyIds.includes(c.id) ? "text-muted-foreground line-through" : ""}>{b.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UserRolesCard() {
  const users = useListAdminUsers();
  const roles = useListRoles();
  const createUser = useCreateAdminUser();
  const updateUser = useUpdateAdminUser();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<NewUserDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<NewUserDraft>>({});

  const roleOptions = roles.data ?? [];

  const openCreate = () => {
    setDraft({ ...EMPTY_DRAFT, role: roleOptions[0]?.name ?? "" });
    setError(null);
    setDialogOpen(true);
  };

  const submitCreate = async () => {
    setError(null);
    if (!draft.name.trim() || !draft.email.trim() || !draft.role || !draft.password) {
      setError("Please provide name, email, role and password.");
      return;
    }
    if (draft.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    try {
      await createUser.mutateAsync({
        data: {
          name: draft.name.trim(),
          email: draft.email.trim().toLowerCase(),
          role: draft.role,
          password: draft.password,
          tenantWide: draft.tenantWide,
          scopeCompanyIds: draft.scopeCompanyIds,
          scopeBrandIds: draft.scopeBrandIds,
        },
      });
      setDialogOpen(false);
      users.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed.");
    }
  };

  const toggleActive = async (u: AdminUser) => {
    await updateUser.mutateAsync({ id: u.id, data: { isActive: !u.isActive } });
    users.refetch();
  };

  const openEdit = (u: AdminUser) => {
    setEditingId(u.id);
    setEditDraft({
      role: u.role,
      tenantWide: u.tenantWide,
      scopeCompanyIds: [...u.scopeCompanyIds],
      scopeBrandIds: [...u.scopeBrandIds],
    });
  };

  const saveEdit = async (u: AdminUser) => {
    await updateUser.mutateAsync({
      id: u.id,
      data: {
        role: editDraft.role ?? u.role,
        tenantWide: editDraft.tenantWide ?? u.tenantWide,
        scopeCompanyIds: editDraft.scopeCompanyIds ?? u.scopeCompanyIds,
        scopeBrandIds: editDraft.scopeBrandIds ?? u.scopeBrandIds,
      },
    });
    setEditingId(null);
    setEditDraft({});
    users.refetch();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle>Users & permissions</CardTitle>
        </div>
        <Button size="sm" onClick={openCreate}>New user</Button>
      </CardHeader>
      <CardContent>
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data?.map(u => (
                <UserAdminRow
                  key={u.id}
                  user={u}
                  roleOptions={roleOptions}
                  isEditing={editingId === u.id}
                  editDraft={editDraft}
                  onEditDraftChange={setEditDraft}
                  onOpenEdit={() => openEdit(u)}
                  onCancelEdit={() => { setEditingId(null); setEditDraft({}); }}
                  onSaveEdit={() => saveEdit(u)}
                  onToggleActive={() => toggleActive(u)}
                  savePending={updateUser.isPending}
                />
              ))}
              {!users.data?.length && (
                <TableRow><TableCell colSpan={5} className="text-center h-24">No users</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      {dialogOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDialogOpen(false)}>
          <div className="bg-background rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Create new user</h2>
                <Button size="sm" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Name</Label>
                  <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} />
                </div>
                <div>
                  <Label>Role</Label>
                  <select
                    className="w-full border rounded-md px-2 py-1.5 bg-background"
                    value={draft.role}
                    onChange={e => setDraft({ ...draft, role: e.target.value })}
                  >
                    <option value="">— Please choose —</option>
                    {roleOptions.map(r => (
                      <option key={r.id} value={r.name}>{r.name}</option>
                    ))}
                  </select>
                  {draft.role && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {roleOptions.find(r => r.name === draft.role)?.description}
                    </p>
                  )}
                </div>
                <div>
                  <Label>Password (min. 8 characters)</Label>
                  <Input type="password" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Visibility</Label>
                <ScopeTreeEditor
                  tenantWide={draft.tenantWide}
                  onTenantWideChange={v => setDraft({ ...draft, tenantWide: v })}
                  companyIds={draft.scopeCompanyIds}
                  brandIds={draft.scopeBrandIds}
                  onCompanyIdsChange={v => setDraft({ ...draft, scopeCompanyIds: v })}
                  onBrandIdsChange={v => setDraft({ ...draft, scopeBrandIds: v })}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                <Button onClick={submitCreate} disabled={createUser.isPending}>
                  {createUser.isPending ? "Creating…" : "Create"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function UserAdminRow(props: {
  user: AdminUser;
  roleOptions: { id: string; name: string; description: string }[];
  isEditing: boolean;
  editDraft: Partial<NewUserDraft>;
  onEditDraftChange: (v: Partial<NewUserDraft>) => void;
  onOpenEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onToggleActive: () => void;
  savePending: boolean;
}) {
  const { user: u, roleOptions, isEditing, editDraft, onEditDraftChange, onOpenEdit, onCancelEdit, onSaveEdit, onToggleActive, savePending } = props;
  return (
    <>
      <TableRow>
        <TableCell>
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarFallback style={{ backgroundColor: u.avatarColor || 'var(--primary)', color: 'white' }}>
                {u.initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium leading-none">{u.name}</span>
              <span className="text-xs text-muted-foreground mt-1">{u.email}</span>
            </div>
          </div>
        </TableCell>
        <TableCell><Badge variant="outline">{u.role}</Badge></TableCell>
        <TableCell className="text-sm text-muted-foreground max-w-xs">{u.scopeSummary}</TableCell>
        <TableCell>
          {u.isActive
            ? <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Active</Badge>
            : <Badge variant="outline" className="bg-gray-100 text-gray-600">Deactivated</Badge>}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={isEditing ? onCancelEdit : onOpenEdit}>
              {isEditing ? "Close" : "Edit"}
            </Button>
            <Button size="sm" variant="outline" onClick={onToggleActive} disabled={savePending}>
              {u.isActive ? "Deactivate" : "Activate"}
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {isEditing && (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/30">
            <div className="grid md:grid-cols-2 gap-4 py-3">
              <div>
                <Label className="mb-1 block">Role</Label>
                <select
                  className="w-full border rounded-md px-2 py-1.5 bg-background"
                  value={editDraft.role ?? u.role}
                  onChange={e => onEditDraftChange({ ...editDraft, role: e.target.value })}
                >
                  {roleOptions.map(r => (
                    <option key={r.id} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="mb-1 block">Visibility</Label>
                <ScopeTreeEditor
                  tenantWide={editDraft.tenantWide ?? u.tenantWide}
                  onTenantWideChange={v => onEditDraftChange({ ...editDraft, tenantWide: v })}
                  companyIds={editDraft.scopeCompanyIds ?? u.scopeCompanyIds}
                  brandIds={editDraft.scopeBrandIds ?? u.scopeBrandIds}
                  onCompanyIdsChange={v => onEditDraftChange({ ...editDraft, scopeCompanyIds: v })}
                  onBrandIdsChange={v => onEditDraftChange({ ...editDraft, scopeBrandIds: v })}
                />
              </div>
              <div className="md:col-span-2 flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={onCancelEdit}>Cancel</Button>
                <Button size="sm" onClick={onSaveEdit} disabled={savePending}>Save</Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function RolesCard() {
  const roles = useListRoles();
  const { data: catalog } = useListPermissionCatalog();
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingIsSystem, setEditingIsSystem] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Gruppiert die Permission-Catalog-Einträge nach `category`, damit der
  // Dialog sie als sinnvolle Blöcke (Deals, Quotes, Approvals, …) zeigt
  // statt als einer langen flachen Liste mit 16+ Checkboxen.
  const grouped = useMemo(() => {
    const out: Record<string, PermissionCatalogEntry[]> = {};
    (catalog ?? []).forEach(p => {
      const cat = p.group || "Sonstige";
      if (!out[cat]) out[cat] = [];
      out[cat].push(p);
    });
    return out;
  }, [catalog]);

  const reset = () => {
    setEditingId(null); setEditingIsSystem(false);
    setName(""); setDesc(""); setPerms([]); setError(null);
  };
  const openCreate = () => { reset(); setOpen(true); };
  const openEdit = (r: { id: string; name: string; description: string; isSystem: boolean; permissions?: string[] }) => {
    reset();
    setEditingId(r.id); setEditingIsSystem(r.isSystem);
    setName(r.name); setDesc(r.description); setPerms(r.permissions ?? []);
    setOpen(true);
  };
  const togglePerm = (key: string) => {
    setPerms(p => p.includes(key) ? p.filter(x => x !== key) : [...p, key]);
  };
  const onSave = async () => {
    setError(null);
    if (!name.trim()) { setError("Name is required."); return; }
    try {
      if (editingId) {
        await updateRole.mutateAsync({ id: editingId, data: { name: name.trim(), description: desc.trim() || "—", permissions: perms } });
        toast({ title: "Role updated", description: name.trim() });
      } else {
        await createRole.mutateAsync({ data: { name: name.trim(), description: desc.trim() || "—", permissions: perms } });
        toast({ title: "Role created", description: name.trim() });
      }
      roles.refetch();
      setOpen(false); reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    }
  };
  const onDelete = async (r: { id: string; name: string }) => {
    if (!window.confirm(`Delete role "${r.name}"?`)) return;
    try {
      await deleteRole.mutateAsync({ id: r.id });
      roles.refetch();
      toast({ title: "Role deleted", description: r.name });
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : "Role may still be in use.", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>Role definitions</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Roles apply within your tenant. <span className="font-medium">System roles</span> (Tenant Admin,
            Account Executive, Deal Desk) are hard-wired — they carry permissions and cannot be edited
            or deleted. If needed, create your own <span className="font-medium">custom roles</span>
            (e.g. "Sales Lead DACH" or "Legal Reviewer") and assign them fine-grained permissions.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-create-role">
          <Plus className="h-4 w-4 mr-1" /> New role
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.data?.map(r => (
                <TableRow key={r.id} data-testid={`row-role-${r.id}`}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.description}</TableCell>
                  <TableCell className="text-xs">
                    {r.isSystem ? (
                      <Badge variant="outline" className="text-muted-foreground">implicit (system)</Badge>
                    ) : (r.permissions?.length ?? 0) === 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">— none —</span>
                    ) : (
                      <span>{r.permissions!.length} permission{r.permissions!.length === 1 ? "" : "s"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.isSystem
                      ? <Badge variant="outline">System</Badge>
                      : <Badge variant="outline" className="bg-blue-50">Custom</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <span title={r.isSystem ? "System role — permissions are hard-wired." : ""}>
                        <Button size="sm" variant="outline" onClick={() => openEdit(r)} disabled={r.isSystem} data-testid={`button-edit-role-${r.id}`}>Edit</Button>
                      </span>
                      <span title={r.isSystem ? "System role — cannot be deleted." : ""}>
                        <Button size="sm" variant="outline" onClick={() => onDelete(r)} disabled={r.isSystem} data-testid={`button-delete-role-${r.id}`}>Delete</Button>
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!roles.data?.length && (
                <TableRow><TableCell colSpan={5} className="text-center h-16">No roles</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>{editingId ? "Edit role" : "New role"}</AlertDialogTitle>
            <AlertDialogDescription>
              Select permissions from the catalog. These are checked by the backend on every request against the signed-in user.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Sales Lead DACH" disabled={editingIsSystem} data-testid="input-role-name" />
              </div>
              <div className="space-y-1">
                <Label>Description <span className="text-xs text-muted-foreground">(optional)</span></Label>
                <Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="What is this role responsible for?" disabled={editingIsSystem} data-testid="input-role-desc" />
              </div>
            </div>
            <div>
              <Label>Permissions</Label>
              <p className="text-xs text-muted-foreground mb-2">
                {perms.length} of {catalog?.length ?? 0} selected.
              </p>
              {!catalog?.length ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <div className="space-y-3 border rounded-md p-3 max-h-80 overflow-y-auto">
                  {(Object.entries(grouped) as Array<[string, PermissionCatalogEntry[]]>).map(([cat, entries]) => (
                    <div key={cat}>
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">{cat}</div>
                      <div className="grid md:grid-cols-2 gap-1.5">
                        {entries.map(p => (
                          <label
                            key={p.key}
                            className="flex items-start gap-2 px-2 py-1.5 text-sm rounded hover:bg-muted/40 cursor-pointer"
                            data-testid={`option-perm-${p.key}`}
                          >
                            <input
                              type="checkbox"
                              checked={perms.includes(p.key)}
                              onChange={() => togglePerm(p.key)}
                              disabled={editingIsSystem}
                              className="mt-0.5"
                              data-testid={`checkbox-perm-${p.key}`}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-xs"><code>{p.key}</code></div>
                              <div className="text-xs text-muted-foreground">{p.label}</div>
                              {p.description ? <div className="text-xs text-muted-foreground/80 mt-0.5">{p.description}</div> : null}
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {error && <p className="text-sm text-destructive" data-testid="text-role-error">{error}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onSave} disabled={editingIsSystem || !name.trim() || createRole.isPending || updateRole.isPending} data-testid="button-save-role">
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ───────────────── Webhooks ─────────────────

type WebhookRow = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  description: string | null;
  createdAt: string;
};

type DeliveryRow = {
  id: string;
  webhookId: string;
  event: string;
  status: string;
  attempt: number;
  statusCode: number | null;
  error: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

const ALLOWED_EVENTS = [
  "quote.accepted",
  "contract.signed",
  "approval.decided",
  "price_increase.responded",
  "order.completed",
] as const;

async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text().catch(() => "")}`);
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

function WebhooksSection() {
  const [hooks, setHooks] = useState<WebhookRow[] | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null);
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [desc, setDesc] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSecret, setLastSecret] = useState<string | null>(null);

  const reloadHooks = useCallback(async () => {
    try {
      const data = await apiFetch<WebhookRow[]>("/admin/webhooks");
      setHooks(data);
    } catch (e) {
      setErr(String(e));
    }
  }, []);
  const reloadDeliveries = useCallback(async () => {
    try {
      const data = await apiFetch<DeliveryRow[]>("/admin/webhook-deliveries?limit=50");
      setDeliveries(data);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void reloadHooks();
    void reloadDeliveries();
  }, [reloadHooks, reloadDeliveries]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || selectedEvents.size === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await apiFetch<WebhookRow & { secret: string }>("/admin/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url,
          events: Array.from(selectedEvents),
          description: desc || undefined,
          active: true,
        }),
      });
      setLastSecret(created.secret);
      setUrl("");
      setDesc("");
      setSelectedEvents(new Set());
      await reloadHooks();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (row: WebhookRow) => {
    await apiFetch(`/admin/webhooks/${row.id}`, {
      method: "PATCH",
      body: JSON.stringify({ active: !row.active }),
    });
    await reloadHooks();
  };

  const remove = async (id: string) => {
    await apiFetch(`/admin/webhooks/${id}`, { method: "DELETE" });
    await reloadHooks();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Webhook className="h-5 w-5 text-primary" />
        <div>
          <CardTitle>Webhooks</CardTitle>
          <p className="text-sm text-muted-foreground">Subscriptions and delivery history</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {err && (
          <div className="text-sm text-destructive border border-destructive/30 bg-destructive/5 px-3 py-2 rounded">
            {err}
          </div>
        )}
        {lastSecret && (
          <div className="text-sm border border-amber-400 bg-amber-50 text-amber-900 px-3 py-2 rounded">
            <div className="font-medium">New secret — copy now (shown only once):</div>
            <code className="block mt-1 font-mono text-xs break-all">{lastSecret}</code>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setLastSecret(null)}>Close</Button>
          </div>
        )}

        <form onSubmit={create} className="grid gap-3 md:grid-cols-[2fr_1fr_auto] items-end border-b pb-4">
          <div>
            <Label>URL</Label>
            <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/dealflow" required />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="optional" />
          </div>
          <Button type="submit" disabled={busy || !url || selectedEvents.size === 0}>
            <Plus className="h-4 w-4 mr-1" />Create
          </Button>
          <div className="md:col-span-3 flex flex-wrap gap-2">
            {ALLOWED_EVENTS.map((ev) => {
              const checked = selectedEvents.has(ev);
              return (
                <label key={ev} className={`text-xs px-2 py-1 rounded border cursor-pointer ${checked ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(selectedEvents);
                      if (next.has(ev)) next.delete(ev); else next.add(ev);
                      setSelectedEvents(next);
                    }}
                  />
                  {ev}
                </label>
              );
            })}
          </div>
        </form>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium">Subscriptions</h3>
            <Button size="sm" variant="outline" onClick={() => void reloadHooks()}>
              <RefreshCw className="h-3 w-3 mr-1" />Refresh
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hooks === null ? (
                <TableRow><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ) : hooks.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center h-16 text-muted-foreground">No webhooks configured yet.</TableCell></TableRow>
              ) : hooks.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-mono text-xs break-all">{h.url}</TableCell>
                  <TableCell className="text-xs">{h.events.join(", ")}</TableCell>
                  <TableCell>
                    {h.active
                      ? <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">active</Badge>
                      : <Badge variant="outline" className="bg-muted">paused</Badge>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{h.description ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => void toggleActive(h)}>
                        {h.active ? "Pause" : "Activate"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void remove(h.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium">Delivery log (last 50)</h3>
            <Button size="sm" variant="outline" onClick={() => void reloadDeliveries()}>
              <RefreshCw className="h-3 w-3 mr-1" />Refresh
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries === null ? (
                <TableRow><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ) : deliveries.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center h-16 text-muted-foreground">No deliveries.</TableCell></TableRow>
              ) : deliveries.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-xs">{fmtDate(d.createdAt)}</TableCell>
                  <TableCell className="text-xs font-mono">{d.event}</TableCell>
                  <TableCell>
                    {d.status === "success" || d.status === "delivered" ? <Badge variant="outline" className="bg-green-50 text-green-700">{d.status}</Badge>
                      : d.status === "failed" ? <Badge variant="outline" className="bg-red-50 text-red-700">failed</Badge>
                      : <Badge variant="outline">{d.status}</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">{d.attempt}</TableCell>
                  <TableCell className="text-xs">{d.statusCode ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[320px] truncate" title={d.error ?? ""}>{d.error ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertragswesen MVP Phase 1 — Contract Types & Playbooks (Tenant-Admin)
// ─────────────────────────────────────────────────────────────────────────────

function CsvTagInput({
  value,
  onChange,
  placeholder,
  testId,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [draft, setDraft] = useState(value.join(", "));
  useEffect(() => { setDraft(value.join(", ")); }, [value]);
  return (
    <Input
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const arr = draft.split(",").map(s => s.trim()).filter(Boolean);
        onChange(arr);
      }}
      placeholder={placeholder}
      data-testid={testId}
    />
  );
}

// ─── ClauseFamilyMultiSelect ──────────────────────────────────────────────
// Multi-Checkbox-Picker für Klauselfamilien. Ersetzt das frühere CSV-Eingabe-
// feld, das User zwang, kryptische `cf_xxx`-IDs zu tippen. `excludeIds` blendet
// Familien aus, die im Gegenstück (Pflicht↔Verboten) bereits gewählt sind, um
// inkonsistente Konfigurationen zu verhindern.
function ClauseFamilyMultiSelect({
  families,
  selected,
  onChange,
  testIdPrefix,
  excludeIds = [],
}: {
  families: { id: string; name: string; description?: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  testIdPrefix: string;
  excludeIds?: string[];
}) {
  const excluded = new Set(excludeIds);
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id));
    else onChange([...selected, id]);
  };
  if (families.length === 0) {
    return (
      <div className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/20">
        No clause families maintained yet. Create some first, then they will appear here for selection.
      </div>
    );
  }
  return (
    <div className="border rounded-md max-h-48 overflow-y-auto divide-y" data-testid={`multiselect-${testIdPrefix}`}>
      {families.map(f => {
        const isSel = selected.includes(f.id);
        const isExcl = excluded.has(f.id);
        return (
          <label
            key={f.id}
            className={`flex items-start gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30 ${isExcl ? "opacity-50 pointer-events-none" : ""}`}
            data-testid={`option-${testIdPrefix}-${f.id}`}
          >
            <input
              type="checkbox"
              checked={isSel}
              onChange={() => toggle(f.id)}
              disabled={isExcl}
              className="mt-0.5"
              data-testid={`checkbox-${testIdPrefix}-${f.id}`}
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium">{f.name}</div>
              {f.description ? (
                <div className="text-xs text-muted-foreground truncate">{f.description}</div>
              ) : null}
              {isExcl ? (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                  Already selected in the opposite list — not available here.
                </div>
              ) : null}
            </div>
          </label>
        );
      })}
    </div>
  );
}

// ─── IndustryProfilesCard ──────────────────────────────────────────────────
// Verwaltung von Branchen-Profilen, die im Quote-Wizard als Defaults dienen
// (Beschreibung, Standard-Vorlage, Anhangs-Bibliothek). Wird vom Wizard per
// "Branche konfigurieren"-Link unter `#industry-profiles` angesprungen.
function IndustryProfilesCard() {
  const { data: profiles, isLoading } = useListIndustryProfiles();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateIndustryProfile();
  const update = useUpdateIndustryProfile();
  const del = useDeleteIndustryProfile();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IndustryProfile | null>(null);
  const [industry, setIndustry] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  const openCreate = () => {
    setEditing(null);
    setIndustry("");
    setLabel("");
    setDescription("");
    setOpen(true);
  };
  const openEdit = (p: IndustryProfile) => {
    setEditing(p);
    setIndustry(p.industry);
    setLabel(p.label);
    setDescription(p.description ?? "");
    setOpen(true);
  };
  const onSave = async () => {
    const ind = industry.trim().toLowerCase();
    const lab = label.trim();
    if (!ind || !lab) {
      toast({ title: "Required fields missing", description: "Industry and label are required.", variant: "destructive" });
      return;
    }
    try {
      const body = { industry: ind, label: lab, description: description.trim() };
      if (editing) {
        await update.mutateAsync({ id: editing.id, data: body });
        toast({ title: "Profile updated", description: lab });
      } else {
        await create.mutateAsync({ data: body });
        toast({ title: "Profile created", description: lab });
      }
      await qc.invalidateQueries({ queryKey: getListIndustryProfilesQueryKey() });
      setOpen(false);
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    }
  };
  const onDelete = async (p: IndustryProfile) => {
    if (!confirm(`Really delete profile "${p.label}"?`)) return;
    try {
      await del.mutateAsync({ id: p.id });
      await qc.invalidateQueries({ queryKey: getListIndustryProfilesQueryKey() });
      toast({ title: "Profile deleted", description: p.label });
    } catch (e) {
      toast({ title: "Delete failed", description: e instanceof Error ? e.message : "Unknown", variant: "destructive" });
    }
  };

  return (
    <Card data-testid="card-industry-profiles" id="industry-profiles">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Industry profiles</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Define industries with description and default templates — used as preselection in the Quotes wizard.
          </p>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-new-industry-profile">
          <Plus className="h-4 w-4 mr-2" />Create profile
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-24 w-full" /> : !profiles?.length ? (
          <div className="text-sm text-muted-foreground py-4 text-center">No industry profiles created yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Industry</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-32 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.map(p => (
                <TableRow key={p.id} data-testid={`row-industry-profile-${p.industry}`}>
                  <TableCell><code className="text-xs">{p.industry}</code></TableCell>
                  <TableCell className="font-medium">{p.label}</TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-md truncate">{p.description || "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(p)} data-testid={`button-edit-industry-${p.industry}`}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => onDelete(p)} data-testid={`button-delete-industry-${p.industry}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{editing ? "Edit profile" : "Create industry profile"}</AlertDialogTitle>
            <AlertDialogDescription>
              Industry is a code key (e.g. <code>saas</code>), label is the display name.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Industry (key)</Label>
              <Input value={industry} onChange={e => setIndustry(e.target.value)} placeholder="saas" disabled={!!editing} data-testid="input-industry-key" />
            </div>
            <div className="space-y-1">
              <Label>Label</Label>
              <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Software-as-a-Service" data-testid="input-industry-label" />
            </div>
            <div className="space-y-1">
              <Label>Description</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this profile is typically used for…" data-testid="input-industry-description" />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onSave} disabled={!industry.trim() || !label.trim()} data-testid="button-save-industry">
              {editing ? "Save" : "Create"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ContractTypesCard() {
  const { t } = useTranslation();
  const { data: types, isLoading } = useListContractTypes();
  const { data: families } = useListClauseFamilies();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateContractType();
  const update = useUpdateContractType();
  const del = useDeleteContractType();

  const [editing, setEditing] = useState<ContractType | null>(null);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mandatory, setMandatory] = useState<string[]>([]);
  const [forbidden, setForbidden] = useState<string[]>([]);
  const [active, setActive] = useState(true);

  const reset = () => {
    setEditing(null); setCode(""); setName(""); setDescription("");
    setMandatory([]); setForbidden([]); setActive(true);
  };

  const openCreate = () => { reset(); setOpen(true); };
  const openEdit = (ct: ContractType) => {
    setEditing(ct);
    setCode(ct.code);
    setName(ct.name);
    setDescription(ct.description ?? "");
    setMandatory(ct.mandatoryClauseFamilyIds ?? []);
    setForbidden(ct.forbiddenClauseFamilyIds ?? []);
    setActive(ct.active);
    setOpen(true);
  };

  const onSave = async () => {
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          data: {
            name,
            description: description || null,
            mandatoryClauseFamilyIds: mandatory,
            forbiddenClauseFamilyIds: forbidden,
            active,
          },
        });
        toast({ title: t("pages.admin.contractTypes.updated") });
      } else {
        await create.mutateAsync({
          data: {
            code: code.trim(),
            name: name.trim(),
            description: description || undefined,
            mandatoryClauseFamilyIds: mandatory,
            forbiddenClauseFamilyIds: forbidden,
            active,
          },
        });
        toast({ title: t("pages.admin.contractTypes.created") });
      }
      await qc.invalidateQueries({ queryKey: getListContractTypesQueryKey() });
      setOpen(false); reset();
    } catch (err: any) {
      toast({ title: t("common.saveFailed"), description: err?.message, variant: "destructive" });
    }
  };

  const onDelete = async (ct: ContractType) => {
    try {
      await del.mutateAsync({ id: ct.id });
      await qc.invalidateQueries({ queryKey: getListContractTypesQueryKey() });
      toast({ title: t("pages.admin.contractTypes.deleted") });
    } catch (err: any) {
      toast({ title: t("common.deleteFailed"), description: err?.message, variant: "destructive" });
    }
  };

  const familyName = (id: string) => families?.find(f => f.id === id)?.name ?? id;

  return (
    <Card data-testid="card-contract-types">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <Shield className="h-5 w-5 text-primary mt-0.5" />
          <div>
            <CardTitle>{t("pages.admin.contractTypes.title")}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t("pages.admin.contractTypes.subtitle1")} <span className="font-medium">NDA</span>,
              {" "}<span className="font-medium">MSA</span>, <span className="font-medium">Order Form</span>
              {t("pages.admin.contractTypes.subtitle2")}{" "}
              <span className="font-medium">{t("pages.admin.contractTypes.subtitle3")}</span>{" "}
              {t("pages.admin.contractTypes.subtitle4")}{" "}
              <span className="font-medium">{t("pages.admin.contractTypes.subtitle5")}</span>
              {t("pages.admin.contractTypes.subtitle6")}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-new-contract-type">
          <Plus className="h-4 w-4 mr-1" /> {t("pages.admin.contractTypes.newType")}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (types?.length ?? 0) === 0 ? (
          <div className="p-6 text-center text-sm border rounded-md bg-muted/10 space-y-3">
            <p className="text-muted-foreground">
              {t("pages.admin.contractTypes.emptyTitle")}
            </p>
            <div className="flex flex-wrap justify-center gap-2 text-xs">
              <Badge variant="outline" className="font-mono">NDA</Badge>
              <Badge variant="outline" className="font-mono">MSA</Badge>
              <Badge variant="outline" className="font-mono">ORDER_FORM</Badge>
              <Badge variant="outline" className="font-mono">DPA</Badge>
              <Badge variant="outline" className="font-mono">SOW</Badge>
            </div>
            <Button size="sm" onClick={openCreate} data-testid="button-new-contract-type-empty">
              <Plus className="h-4 w-4 mr-1" /> {t("pages.admin.contractTypes.firstType")}
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pages.admin.contractTypes.colCode")}</TableHead>
                <TableHead>{t("pages.admin.contractTypes.colName")}</TableHead>
                <TableHead>{t("pages.admin.contractTypes.colMandatory")}</TableHead>
                <TableHead>{t("pages.admin.contractTypes.colForbidden")}</TableHead>
                <TableHead>{t("pages.admin.contractTypes.colActive")}</TableHead>
                <TableHead className="text-right">{t("pages.admin.contractTypes.colAction")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {types!.map(ct => (
                <TableRow key={ct.id} data-testid={`row-contract-type-${ct.id}`}>
                  <TableCell className="font-mono text-xs">{ct.code}</TableCell>
                  <TableCell className="font-medium">{ct.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {ct.mandatoryClauseFamilyIds.length === 0 ? "—" : ct.mandatoryClauseFamilyIds.map(familyName).join(", ")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {ct.forbiddenClauseFamilyIds.length === 0 ? "—" : ct.forbiddenClauseFamilyIds.map(familyName).join(", ")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={ct.active ? "border-emerald-300 text-emerald-700" : "border-slate-300 text-slate-500"}>
                      {ct.active ? t("pages.admin.ja") : t("pages.admin.nein")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => openEdit(ct)} data-testid={`button-edit-ct-${ct.id}`}>
                        {t("pages.admin.contractTypes.edit")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onDelete(ct)} data-testid={`button-delete-ct-${ct.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{editing ? t("pages.admin.contractTypes.dialog.titleEdit") : t("pages.admin.contractTypes.dialog.titleNew")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.admin.contractTypes.dialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("pages.admin.contractTypes.dialog.code")}</Label>
                <Input
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  disabled={!!editing}
                  placeholder={t("pages.admin.contractTypes.dialog.codePlaceholder")}
                  data-testid="input-ct-code"
                />
              </div>
              <div>
                <Label>{t("pages.admin.contractTypes.dialog.name")}</Label>
                <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-ct-name" />
              </div>
            </div>
            <div>
              <Label>{t("pages.admin.contractTypes.dialog.nameDesc")}</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} data-testid="input-ct-description" />
            </div>
            <div>
              <Label>{t("pages.admin.contractTypes.dialog.mandatoryFamilies")}</Label>
              <p className="text-xs text-muted-foreground mb-1.5">
                {t("pages.admin.contractTypes.dialog.mandatoryHint")}
              </p>
              <ClauseFamilyMultiSelect
                families={families ?? []}
                selected={mandatory}
                onChange={setMandatory}
                testIdPrefix="ct-mandatory"
                excludeIds={forbidden}
              />
            </div>
            <div>
              <Label>{t("pages.admin.contractTypes.dialog.forbiddenFamilies")}</Label>
              <p className="text-xs text-muted-foreground mb-1.5">
                {t("pages.admin.contractTypes.dialog.forbiddenHint")}
              </p>
              <ClauseFamilyMultiSelect
                families={families ?? []}
                selected={forbidden}
                onChange={setForbidden}
                testIdPrefix="ct-forbidden"
                excludeIds={mandatory}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="ct-active"
                type="checkbox"
                checked={active}
                onChange={e => setActive(e.target.checked)}
                data-testid="checkbox-ct-active"
              />
              <Label htmlFor="ct-active">{t("pages.admin.contractTypes.dialog.active")}</Label>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={onSave} disabled={!name.trim() || (!editing && !code.trim())} data-testid="button-save-ct">
              {t("common.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ContractPlaybooksCard() {
  const { t } = useTranslation();
  const { data: playbooks, isLoading } = useListContractPlaybooks();
  const { data: types } = useListContractTypes();
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreateContractPlaybook();
  const update = useUpdateContractPlaybook();
  const del = useDeleteContractPlaybook();

  const [editing, setEditing] = useState<ContractPlaybook | null>(null);
  const [open, setOpen] = useState(false);
  const [contractTypeId, setContractTypeId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [brandIds, setBrandIds] = useState<string[]>([]);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [active, setActive] = useState(true);

  const reset = () => {
    setEditing(null); setContractTypeId(""); setName(""); setDescription("");
    setBrandIds([]); setAllowed([]); setDefaults([]); setActive(true);
  };

  const openCreate = () => { reset(); setOpen(true); };
  const openEdit = (pb: ContractPlaybook) => {
    setEditing(pb);
    setContractTypeId(pb.contractTypeId);
    setName(pb.name);
    setDescription(pb.description ?? "");
    setBrandIds(pb.brandIds ?? []);
    setAllowed(pb.allowedClauseVariantIds ?? []);
    setDefaults(pb.defaultClauseVariantIds ?? []);
    setActive(pb.active);
    setOpen(true);
  };

  const onSave = async () => {
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          data: {
            name,
            description: description || null,
            brandIds,
            allowedClauseVariantIds: allowed,
            defaultClauseVariantIds: defaults,
            active,
          },
        });
        toast({ title: t("pages.admin.contractPlaybooks.updated") });
      } else {
        await create.mutateAsync({
          data: {
            contractTypeId,
            name: name.trim(),
            description: description || undefined,
            brandIds,
            allowedClauseVariantIds: allowed,
            defaultClauseVariantIds: defaults,
          },
        });
        toast({ title: t("pages.admin.contractPlaybooks.created") });
      }
      await qc.invalidateQueries({ queryKey: getListContractPlaybooksQueryKey() });
      setOpen(false); reset();
    } catch (err: any) {
      toast({ title: t("common.saveFailed"), description: err?.message, variant: "destructive" });
    }
  };

  const onDelete = async (pb: ContractPlaybook) => {
    try {
      await del.mutateAsync({ id: pb.id });
      await qc.invalidateQueries({ queryKey: getListContractPlaybooksQueryKey() });
      toast({ title: t("pages.admin.contractPlaybooks.deleted") });
    } catch (err: any) {
      toast({ title: t("common.deleteFailed"), description: err?.message, variant: "destructive" });
    }
  };

  const typeName = (id: string) => types?.find(ct => ct.id === id)?.name ?? id;

  return (
    <Card data-testid="card-contract-playbooks">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>{t("pages.admin.contractPlaybooks.title")}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t("pages.admin.contractPlaybooks.subtitle")}
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openCreate} disabled={(types?.length ?? 0) === 0} data-testid="button-new-playbook">
          <Plus className="h-4 w-4 mr-1" /> {t("pages.admin.contractPlaybooks.newPlaybook")}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (playbooks?.length ?? 0) === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground border rounded-md bg-muted/10">
            {t("pages.admin.contractPlaybooks.empty")}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("pages.admin.contractPlaybooks.colName")}</TableHead>
                <TableHead>{t("pages.admin.contractPlaybooks.colContractType")}</TableHead>
                <TableHead>{t("pages.admin.contractPlaybooks.colBrands")}</TableHead>
                <TableHead>{t("pages.admin.contractPlaybooks.colAllowed")}</TableHead>
                <TableHead>{t("pages.admin.contractPlaybooks.colDefaults")}</TableHead>
                <TableHead>{t("pages.admin.contractPlaybooks.colActive")}</TableHead>
                <TableHead className="text-right">{t("pages.admin.contractPlaybooks.colAction")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {playbooks!.map(pb => (
                <TableRow key={pb.id} data-testid={`row-playbook-${pb.id}`}>
                  <TableCell className="font-medium">{pb.name}</TableCell>
                  <TableCell className="text-xs">{typeName(pb.contractTypeId)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {pb.brandIds.length === 0 ? t("pages.admin.contractPlaybooks.allBrands") : pb.brandIds.join(", ")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{pb.allowedClauseVariantIds.length}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{pb.defaultClauseVariantIds.length}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={pb.active ? "border-emerald-300 text-emerald-700" : "border-slate-300 text-slate-500"}>
                      {pb.active ? t("pages.admin.ja") : t("pages.admin.nein")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => openEdit(pb)} data-testid={`button-edit-pb-${pb.id}`}>
                        {t("pages.admin.contractPlaybooks.edit")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onDelete(pb)} data-testid={`button-delete-pb-${pb.id}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{editing ? t("pages.admin.contractPlaybooks.dialog.titleEdit") : t("pages.admin.contractPlaybooks.dialog.titleNew")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("pages.admin.contractPlaybooks.dialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>{t("pages.admin.contractPlaybooks.dialog.contractType")}</Label>
              <select
                className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                value={contractTypeId}
                onChange={e => setContractTypeId(e.target.value)}
                disabled={!!editing}
                data-testid="select-pb-type"
              >
                <option value="">{t("pages.admin.contractPlaybooks.dialog.selectFallback")}</option>
                {(types ?? []).map(ct => (
                  <option key={ct.id} value={ct.id}>{ct.name} ({ct.code})</option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t("pages.admin.contractPlaybooks.dialog.name")}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-pb-name" />
            </div>
            <div>
              <Label>{t("pages.admin.contractPlaybooks.dialog.descriptionLabel")}</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} data-testid="input-pb-description" />
            </div>
            <div>
              <Label>{t("pages.admin.contractPlaybooks.dialog.brandIds")}</Label>
              <CsvTagInput value={brandIds} onChange={setBrandIds} placeholder="brd_xxx" testId="input-pb-brands" />
            </div>
            <div>
              <Label>{t("pages.admin.contractPlaybooks.dialog.allowedVariants")}</Label>
              <CsvTagInput value={allowed} onChange={setAllowed} placeholder="cv_xxx, cv_yyy" testId="input-pb-allowed" />
            </div>
            <div>
              <Label>{t("pages.admin.contractPlaybooks.dialog.defaultVariants")}</Label>
              <CsvTagInput value={defaults} onChange={setDefaults} placeholder="cv_xxx" testId="input-pb-defaults" />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="pb-active"
                type="checkbox"
                checked={active}
                onChange={e => setActive(e.target.checked)}
                data-testid="checkbox-pb-active"
              />
              <Label htmlFor="pb-active">{t("pages.admin.contractPlaybooks.dialog.active")}</Label>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={onSave}
              disabled={!name.trim() || (!editing && !contractTypeId)}
              data-testid="button-save-pb"
            >
              {t("common.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

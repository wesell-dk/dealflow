import { useState, useCallback } from "react";
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
  type ContractType,
  type ContractPlaybook,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { CompanyFormDialog } from "@/components/admin/company-form-dialog";
import { BrandFormDialog } from "@/components/admin/brand-form-dialog";
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
import { Settings, Shield, Building2, Users, Download, Trash2, Eye, Play, ShieldAlert, Webhook, Plus, RefreshCw, Lock } from "lucide-react";
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
      toast({ title: "Gesellschaft gelöscht", description: companyToDelete.name });
      setCompanyToDelete(null);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string; blockers?: Record<string, number> } } })?.response?.data;
      if (status === 409 && body?.blockers) {
        setDeleteConflict({ kind: "company", name: companyToDelete.name, blockers: body.blockers });
        setCompanyToDelete(null);
      } else {
        toast({ title: "Löschen fehlgeschlagen", description: body?.error ?? "Unbekannt", variant: "destructive" });
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
                        <Lock className="h-3 w-3 text-muted-foreground cursor-help" aria-label="Plattform-verwaltet" />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Plattform-verwaltet — nur Plattform-Administratoren ändern den Tarif.
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
                        <Lock className="h-3 w-3 text-muted-foreground cursor-help" aria-label="Plattform-verwaltet" />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        Plattform-verwaltet — Datenresidenz wird nach dem Anlegen nicht mehr geändert.
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
              Plan und Region werden zentral durch Plattform-Administratoren gepflegt. Tenant-Stammdaten wie Name, Gesellschaften, Brands, Benutzer und Webhooks bleiben in deiner Verantwortung.
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
              Neue Gesellschaft
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
                    <TableHead className="text-right">Aktionen</TableHead>
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
                            Bearbeiten
                          </Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setCompanyToDelete(company)} data-testid={`button-delete-company-${company.id}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!companies?.length && (
                    <TableRow><TableCell colSpan={5} className="text-center h-16">No companies configured</TableCell></TableRow>
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
              <CardTitle>Brands</CardTitle>
            </div>
            <Button size="sm" onClick={() => setBrandDialogOpen(true)} disabled={!companies?.length} data-testid="button-new-brand">
              <Plus className="h-4 w-4 mr-1" />
              Neuer Brand
            </Button>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Brand</TableHead>
                    <TableHead>Parent Company</TableHead>
                    <TableHead>Voice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brands?.map(brand => (
                    <BrandRow key={brand.id} brand={brand} />
                  ))}
                  {!brands?.length && (
                    <TableRow><TableCell colSpan={3} className="text-center h-16">No brands configured</TableCell></TableRow>
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
            <AlertDialogTitle>Gesellschaft löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{companyToDelete?.name}</span> wird unwiderruflich entfernt.
              Falls Brands, Deals oder Preispositionen daran hängen, blockiert die Plattform die Löschung — bitte zuerst aufräumen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCompanyMut.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={onDeleteCompanyConfirm} disabled={deleteCompanyMut.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid="button-confirm-delete-company">
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConflict} onOpenChange={(v) => { if (!v) setDeleteConflict(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Löschen blockiert</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {deleteConflict?.kind === "company" ? "Gesellschaft" : "Brand"}{" "}
                  <span className="font-medium text-foreground">{deleteConflict?.name}</span> hat noch verknüpfte Datensätze:
                </p>
                <ul className="list-disc pl-5 text-sm">
                  {deleteConflict && Object.entries(deleteConflict.blockers).filter(([, n]) => n > 0).map(([k, n]) => (
                    <li key={k}><span className="font-medium">{n}</span> {k}</li>
                  ))}
                </ul>
                <p className="text-sm">Bitte diese Datensätze zuerst archivieren oder neu zuordnen.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setDeleteConflict(null)}>Verstanden</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UserRolesCard />

      <RolesCard />

      <ContractTypesCard />

      <ContractPlaybooksCard />

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
                    <TableHead className="text-right">Aktionen</TableHead>
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
                          <Badge variant="outline">Aktiv</Badge>
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

          {/* Retention policy */}
          <div className="flex flex-col gap-3">
            <div className="font-medium">{t("pages.admin.gdpr.retention")}</div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {(["contactInactiveDays", "letterRespondedDays", "auditLogDays", "accessLogDays"] as const).map((k) => (
                <div key={k} className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">{t(`pages.admin.gdpr.fields.${k}`)}</Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    value={getPolicyVal(k)}
                    onChange={(e) => setPolicyDraft((d) => ({ ...d, [k]: e.target.value }))}
                    placeholder="—"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button onClick={onSavePolicy} disabled={Object.keys(policyDraft).length === 0}>
                {t("common.save", "Speichern")}
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
    </div>
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
  });
  const update = useUpdateBrand();
  const del = useDeleteBrand();
  const onDelete = async () => {
    try {
      await del.mutateAsync({ id: brand.id });
      await qc.invalidateQueries({ queryKey: getListBrandsQueryKey() });
      toast({ title: "Brand gelöscht", description: brand.name });
      setConfirmDelete(false);
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      const body = (e as { response?: { data?: { error?: string; blockers?: Record<string, number> } } })?.response?.data;
      if (status === 409 && body?.blockers) {
        setConfirmDelete(false);
        setConflict(body.blockers);
      } else {
        toast({ title: "Löschen fehlgeschlagen", description: body?.error ?? "Unbekannt", variant: "destructive" });
      }
    }
  };
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const save = async () => {
    const payload: BrandUpdate = { ...draft };
    await update.mutateAsync({ id: brand.id, data: payload });
    setEditing(false);
  };
  const onUpload = async (file: File) => {
    setUploading(true); setUploadError(null);
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/storage/uploads/request-url`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type }),
      });
      if (!res.ok) throw new Error(`upload URL failed (${res.status})`);
      const { uploadURL, objectPath } = await res.json();
      const put = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!put.ok) throw new Error(`PUT failed (${put.status})`);
      const servingUrl = `/api/storage${objectPath}`;
      setDraft(d => ({ ...d, logoUrl: servingUrl }));
    } catch (e: unknown) {
      setUploadError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading(false);
    }
  };
  return (
    <>
      <TableRow>
        <TableCell>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: brand.primaryColor ?? brand.color }}></div>
            <span className="font-medium">{brand.name}</span>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">{brand.companyId}</TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{brand.tone ?? brand.voice}</Badge>
            <Button size="sm" variant="ghost" onClick={() => setEditing(v => !v)}>
              {editing ? "Schließen" : "Bearbeiten"}
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
                <div className="flex items-center gap-2">
                  <Input className="flex-1" value={draft.logoUrl ?? ""} onChange={e => setDraft({ ...draft, logoUrl: e.target.value })} placeholder="https://… / data:image/… / /api/storage/objects/…" />
                  <input
                    type="file" accept="image/png,image/jpeg,image/svg+xml"
                    onChange={e => { const f = e.target.files?.[0]; if (f) void onUpload(f); }}
                    disabled={uploading}
                    className="text-sm"
                  />
                </div>
                {uploading && <p className="text-xs text-muted-foreground mt-1">Wird hochgeladen…</p>}
                {uploadError && <p className="text-xs text-destructive mt-1">{uploadError}</p>}
                {draft.logoUrl && !uploading && (
                  <img src={draft.logoUrl} alt="logo preview" className="mt-2 max-h-12 border rounded bg-white p-1" />
                )}
              </div>
              <div>
                <Label>Tone / Voice</Label>
                <Input value={draft.tone ?? ""} onChange={e => setDraft({ ...draft, tone: e.target.value })} />
              </div>
              <div>
                <Label>Primary Color</Label>
                <Input type="color" value={draft.primaryColor || "#2D6CDF"} onChange={e => setDraft({ ...draft, primaryColor: e.target.value })} />
              </div>
              <div>
                <Label>Secondary Color</Label>
                <Input type="color" value={draft.secondaryColor || "#000000"} onChange={e => setDraft({ ...draft, secondaryColor: e.target.value })} />
              </div>
              <div>
                <Label>Legal Entity Name</Label>
                <Input value={draft.legalEntityName ?? ""} onChange={e => setDraft({ ...draft, legalEntityName: e.target.value })} />
              </div>
              <div>
                <Label>Address Line</Label>
                <Input value={draft.addressLine ?? ""} onChange={e => setDraft({ ...draft, addressLine: e.target.value })} />
              </div>
              <div className="col-span-2 flex justify-end gap-2">
                <Button size="sm" onClick={save} disabled={update.isPending}>Speichern</Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Brand löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{brand.name}</span> wird unwiderruflich entfernt.
              Falls Deals oder Preispositionen daran hängen, blockiert die Plattform die Löschung.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={del.isPending} className="bg-destructive text-destructive-foreground hover:bg-destructive/90" data-testid={`button-confirm-delete-brand-${brand.id}`}>
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!conflict} onOpenChange={(v) => { if (!v) setConflict(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Löschen blockiert</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Brand <span className="font-medium text-foreground">{brand.name}</span> hat noch verknüpfte Datensätze:</p>
                <ul className="list-disc pl-5 text-sm">
                  {conflict && Object.entries(conflict).filter(([, n]) => n > 0).map(([k, n]) => (
                    <li key={k}><span className="font-medium">{n}</span> {k}</li>
                  ))}
                </ul>
                <p className="text-sm">Bitte zuerst archivieren oder neu zuordnen.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setConflict(null)}>Verstanden</AlertDialogAction>
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
        Tenant-weit (vollständiger Zugriff)
      </label>
      <div className={tenantWide ? "opacity-40 pointer-events-none" : ""}>
        <div className="text-xs text-muted-foreground mb-2">
          Wähle Companies (voller Zugriff auf alle zugehörigen Brands) und/oder einzelne Brands.
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
      setError("Bitte Name, E-Mail, Rolle und Passwort angeben.");
      return;
    }
    if (draft.password.length < 8) {
      setError("Passwort muss mindestens 8 Zeichen haben.");
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
      setError(e instanceof Error ? e.message : "Anlegen fehlgeschlagen.");
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
          <CardTitle>Benutzer & Rechte</CardTitle>
        </div>
        <Button size="sm" onClick={openCreate}>Neuer Benutzer</Button>
      </CardHeader>
      <CardContent>
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Benutzer</TableHead>
                <TableHead>Rolle</TableHead>
                <TableHead>Sichtbarkeit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
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
                <TableRow><TableCell colSpan={5} className="text-center h-24">Keine Benutzer</TableCell></TableRow>
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
                <h2 className="text-lg font-semibold">Neuen Benutzer anlegen</h2>
                <Button size="sm" variant="ghost" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Name</Label>
                  <Input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
                </div>
                <div>
                  <Label>E-Mail</Label>
                  <Input type="email" value={draft.email} onChange={e => setDraft({ ...draft, email: e.target.value })} />
                </div>
                <div>
                  <Label>Rolle</Label>
                  <select
                    className="w-full border rounded-md px-2 py-1.5 bg-background"
                    value={draft.role}
                    onChange={e => setDraft({ ...draft, role: e.target.value })}
                  >
                    <option value="">— Bitte wählen —</option>
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
                  <Label>Passwort (min. 8 Zeichen)</Label>
                  <Input type="password" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} />
                </div>
              </div>
              <div>
                <Label className="mb-2 block">Sichtbarkeit</Label>
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
                <Button variant="outline" onClick={() => setDialogOpen(false)}>Abbrechen</Button>
                <Button onClick={submitCreate} disabled={createUser.isPending}>
                  {createUser.isPending ? "Anlegen…" : "Anlegen"}
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
            ? <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Aktiv</Badge>
            : <Badge variant="outline" className="bg-gray-100 text-gray-600">Deaktiviert</Badge>}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={isEditing ? onCancelEdit : onOpenEdit}>
              {isEditing ? "Schließen" : "Bearbeiten"}
            </Button>
            <Button size="sm" variant="outline" onClick={onToggleActive} disabled={savePending}>
              {u.isActive ? "Deaktivieren" : "Aktivieren"}
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {isEditing && (
        <TableRow>
          <TableCell colSpan={5} className="bg-muted/30">
            <div className="grid md:grid-cols-2 gap-4 py-3">
              <div>
                <Label className="mb-1 block">Rolle</Label>
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
                <Label className="mb-1 block">Sichtbarkeit</Label>
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
                <Button size="sm" variant="outline" onClick={onCancelEdit}>Abbrechen</Button>
                <Button size="sm" onClick={onSaveEdit} disabled={savePending}>Speichern</Button>
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
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const deleteRole = useDeleteRole();
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onCreate = async () => {
    setError(null);
    if (!newName.trim() || !newDesc.trim()) { setError("Name und Beschreibung erforderlich."); return; }
    try {
      await createRole.mutateAsync({ data: { name: newName.trim(), description: newDesc.trim() } });
      setNewName(""); setNewDesc("");
      roles.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Anlegen fehlgeschlagen.");
    }
  };

  const onEdit = (r: { id: string; name: string; description: string }) => {
    setEditingId(r.id); setEditName(r.name); setEditDesc(r.description);
  };

  const onSaveEdit = async (id: string) => {
    await updateRole.mutateAsync({ id, data: { name: editName.trim(), description: editDesc.trim() } });
    setEditingId(null);
    roles.refetch();
  };

  const onDelete = async (r: { id: string; name: string }) => {
    if (!window.confirm(`Rolle "${r.name}" löschen?`)) return;
    try {
      await deleteRole.mutateAsync({ id: r.id });
      roles.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Löschen fehlgeschlagen (Rolle evtl. in Benutzung).");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Shield className="h-5 w-5 text-primary" />
        <CardTitle>Rollen-Definitionen</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-2 items-end">
          <div>
            <Label>Neue Rolle</Label>
            <Input placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} />
          </div>
          <div>
            <Label>Beschreibung</Label>
            <Input placeholder="Beschreibung" value={newDesc} onChange={e => setNewDesc(e.target.value)} />
          </div>
          <Button onClick={onCreate} disabled={createRole.isPending}>Hinzufügen</Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Beschreibung</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.data?.map(r => (
                <TableRow key={r.id}>
                  {editingId === r.id ? (
                    <>
                      <TableCell><Input value={editName} onChange={e => setEditName(e.target.value)} /></TableCell>
                      <TableCell><Input value={editDesc} onChange={e => setEditDesc(e.target.value)} /></TableCell>
                      <TableCell>
                        {r.isSystem
                          ? <Badge variant="outline">System</Badge>
                          : <Badge variant="outline" className="bg-blue-50">Custom</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>Abbrechen</Button>
                          <Button size="sm" onClick={() => onSaveEdit(r.id)} disabled={updateRole.isPending}>Speichern</Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.description}</TableCell>
                      <TableCell>
                        {r.isSystem
                          ? <Badge variant="outline">System</Badge>
                          : <Badge variant="outline" className="bg-blue-50">Custom</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => onEdit(r)} disabled={r.isSystem}>Bearbeiten</Button>
                          <Button size="sm" variant="outline" onClick={() => onDelete(r)} disabled={r.isSystem}>Löschen</Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {!roles.data?.length && (
                <TableRow><TableCell colSpan={4} className="text-center h-16">Keine Rollen</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
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
          <p className="text-sm text-muted-foreground">Abonnements und Zustellungs-Historie</p>
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
            <div className="font-medium">Neues Secret — jetzt kopieren (wird nur einmal angezeigt):</div>
            <code className="block mt-1 font-mono text-xs break-all">{lastSecret}</code>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setLastSecret(null)}>Schließen</Button>
          </div>
        )}

        <form onSubmit={create} className="grid gap-3 md:grid-cols-[2fr_1fr_auto] items-end border-b pb-4">
          <div>
            <Label>URL</Label>
            <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/webhooks/dealflow" required />
          </div>
          <div>
            <Label>Beschreibung</Label>
            <Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="optional" />
          </div>
          <Button type="submit" disabled={busy || !url || selectedEvents.size === 0}>
            <Plus className="h-4 w-4 mr-1" />Anlegen
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
            <h3 className="font-medium">Abonnements</h3>
            <Button size="sm" variant="outline" onClick={() => void reloadHooks()}>
              <RefreshCw className="h-3 w-3 mr-1" />Aktualisieren
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>URL</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Beschreibung</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hooks === null ? (
                <TableRow><TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ) : hooks.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center h-16 text-muted-foreground">Noch keine Webhooks konfiguriert.</TableCell></TableRow>
              ) : hooks.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="font-mono text-xs break-all">{h.url}</TableCell>
                  <TableCell className="text-xs">{h.events.join(", ")}</TableCell>
                  <TableCell>
                    {h.active
                      ? <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">aktiv</Badge>
                      : <Badge variant="outline" className="bg-muted">pausiert</Badge>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{h.description ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="outline" onClick={() => void toggleActive(h)}>
                        {h.active ? "Pausieren" : "Aktivieren"}
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
            <h3 className="font-medium">Delivery-Log (letzte 50)</h3>
            <Button size="sm" variant="outline" onClick={() => void reloadDeliveries()}>
              <RefreshCw className="h-3 w-3 mr-1" />Aktualisieren
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Zeit</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Versuche</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Fehler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries === null ? (
                <TableRow><TableCell colSpan={6}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
              ) : deliveries.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center h-16 text-muted-foreground">Keine Zustellungen.</TableCell></TableRow>
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

function ContractTypesCard() {
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
        toast({ title: "Vertragstyp aktualisiert" });
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
        toast({ title: "Vertragstyp angelegt" });
      }
      await qc.invalidateQueries({ queryKey: getListContractTypesQueryKey() });
      setOpen(false); reset();
    } catch (err: any) {
      toast({ title: "Speichern fehlgeschlagen", description: err?.message, variant: "destructive" });
    }
  };

  const onDelete = async (ct: ContractType) => {
    try {
      await del.mutateAsync({ id: ct.id });
      await qc.invalidateQueries({ queryKey: getListContractTypesQueryKey() });
      toast({ title: "Vertragstyp gelöscht" });
    } catch (err: any) {
      toast({ title: "Löschen fehlgeschlagen", description: err?.message, variant: "destructive" });
    }
  };

  const familyName = (id: string) => families?.find(f => f.id === id)?.name ?? id;

  return (
    <Card data-testid="card-contract-types">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Vertragstypen</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Definiere Pflicht- und Verbots-Klauseln je Vertragsart (NDA, MSA, Order Form …).
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openCreate} data-testid="button-new-contract-type">
          <Plus className="h-4 w-4 mr-1" /> Neuer Typ
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (types?.length ?? 0) === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground border rounded-md bg-muted/10">
            Noch keine Vertragstypen angelegt.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Pflicht-Klauseln</TableHead>
                <TableHead>Verboten</TableHead>
                <TableHead>Aktiv</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
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
                      {ct.active ? "ja" : "nein"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => openEdit(ct)} data-testid={`button-edit-ct-${ct.id}`}>
                        Bearbeiten
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
            <AlertDialogTitle>{editing ? "Vertragstyp bearbeiten" : "Neuer Vertragstyp"}</AlertDialogTitle>
            <AlertDialogDescription>
              Pflicht- und Verbots-Klauseln werden in der Klausel-Prüfung gegen Verträge ausgewertet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Code</Label>
                <Input
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  disabled={!!editing}
                  placeholder="z.B. NDA, MSA_SUB"
                  data-testid="input-ct-code"
                />
              </div>
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-ct-name" />
              </div>
            </div>
            <div>
              <Label>Beschreibung</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} data-testid="input-ct-description" />
            </div>
            <div>
              <Label>Pflicht-Klauselfamilien (IDs, Komma-getrennt)</Label>
              <CsvTagInput value={mandatory} onChange={setMandatory} placeholder="cf_xxx, cf_yyy" testId="input-ct-mandatory" />
              {(families?.length ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground mt-1">Verfügbar: {families!.map(f => f.id).join(", ")}</p>
              )}
            </div>
            <div>
              <Label>Verbotene Klauselfamilien (IDs, Komma-getrennt)</Label>
              <CsvTagInput value={forbidden} onChange={setForbidden} placeholder="cf_xxx" testId="input-ct-forbidden" />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="ct-active"
                type="checkbox"
                checked={active}
                onChange={e => setActive(e.target.checked)}
                data-testid="checkbox-ct-active"
              />
              <Label htmlFor="ct-active">Aktiv</Label>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={onSave} disabled={!name.trim() || (!editing && !code.trim())} data-testid="button-save-ct">
              Speichern
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ContractPlaybooksCard() {
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
        toast({ title: "Playbook aktualisiert" });
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
        toast({ title: "Playbook angelegt" });
      }
      await qc.invalidateQueries({ queryKey: getListContractPlaybooksQueryKey() });
      setOpen(false); reset();
    } catch (err: any) {
      toast({ title: "Speichern fehlgeschlagen", description: err?.message, variant: "destructive" });
    }
  };

  const onDelete = async (pb: ContractPlaybook) => {
    try {
      await del.mutateAsync({ id: pb.id });
      await qc.invalidateQueries({ queryKey: getListContractPlaybooksQueryKey() });
      toast({ title: "Playbook gelöscht" });
    } catch (err: any) {
      toast({ title: "Löschen fehlgeschlagen", description: err?.message, variant: "destructive" });
    }
  };

  const typeName = (id: string) => types?.find(t => t.id === id)?.name ?? id;

  return (
    <Card data-testid="card-contract-playbooks">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Vertrags-Playbooks</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Erlaubte und Default-Klauselvarianten je Vertragstyp und Brand.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={openCreate} disabled={(types?.length ?? 0) === 0} data-testid="button-new-playbook">
          <Plus className="h-4 w-4 mr-1" /> Neues Playbook
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : (playbooks?.length ?? 0) === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground border rounded-md bg-muted/10">
            Noch keine Playbooks angelegt.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Vertragstyp</TableHead>
                <TableHead>Brands</TableHead>
                <TableHead>Erlaubte Varianten</TableHead>
                <TableHead>Defaults</TableHead>
                <TableHead>Aktiv</TableHead>
                <TableHead className="text-right">Aktion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {playbooks!.map(pb => (
                <TableRow key={pb.id} data-testid={`row-playbook-${pb.id}`}>
                  <TableCell className="font-medium">{pb.name}</TableCell>
                  <TableCell className="text-xs">{typeName(pb.contractTypeId)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {pb.brandIds.length === 0 ? "alle" : pb.brandIds.join(", ")}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{pb.allowedClauseVariantIds.length}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{pb.defaultClauseVariantIds.length}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={pb.active ? "border-emerald-300 text-emerald-700" : "border-slate-300 text-slate-500"}>
                      {pb.active ? "ja" : "nein"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => openEdit(pb)} data-testid={`button-edit-pb-${pb.id}`}>
                        Bearbeiten
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
            <AlertDialogTitle>{editing ? "Playbook bearbeiten" : "Neues Playbook"}</AlertDialogTitle>
            <AlertDialogDescription>
              Lege fest, welche Klauselvarianten für einen Vertragstyp erlaubt und welche Default sind.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Vertragstyp</Label>
              <select
                className="w-full px-3 py-2 border rounded-md text-sm bg-background"
                value={contractTypeId}
                onChange={e => setContractTypeId(e.target.value)}
                disabled={!!editing}
                data-testid="select-pb-type"
              >
                <option value="">— wählen —</option>
                {(types ?? []).map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} data-testid="input-pb-name" />
            </div>
            <div>
              <Label>Beschreibung</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} data-testid="input-pb-description" />
            </div>
            <div>
              <Label>Brand-IDs (leer = alle, Komma-getrennt)</Label>
              <CsvTagInput value={brandIds} onChange={setBrandIds} placeholder="brd_xxx" testId="input-pb-brands" />
            </div>
            <div>
              <Label>Erlaubte Klausel-Varianten (cv_*, Komma-getrennt)</Label>
              <CsvTagInput value={allowed} onChange={setAllowed} placeholder="cv_xxx, cv_yyy" testId="input-pb-allowed" />
            </div>
            <div>
              <Label>Default-Klausel-Varianten (Komma-getrennt)</Label>
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
              <Label htmlFor="pb-active">Aktiv</Label>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={onSave}
              disabled={!name.trim() || (!editing && !contractTypeId)}
              data-testid="button-save-pb"
            >
              Speichern
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

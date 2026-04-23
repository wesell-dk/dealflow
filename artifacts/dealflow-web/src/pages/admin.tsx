import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetTenant,
  useListCompanies,
  useListBrands,
  useUpdateBrand,
  useListUsers,
  type Brand,
  type BrandUpdate,
  useSearchGdprSubjects,
  useForgetGdprSubject,
  useListGdprAccessLog,
  useListGdprDeletionLog,
  useGetGdprRetentionPolicy,
  useUpdateGdprRetentionPolicy,
  useRunGdprRetention,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings, Shield, Building2, Users, Download, Trash2, Eye, Play, ShieldAlert } from "lucide-react";

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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-2">
              <div>
                <div className="text-sm text-muted-foreground">Tenant Name</div>
                <div className="font-medium text-lg">{tenant.name}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Plan</div>
                <div className="font-medium"><Badge variant="outline">{tenant.plan}</Badge></div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Region</div>
                <div className="font-medium">{tenant.region}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Created</div>
                <div className="font-medium">{new Date(tenant.createdAt).toLocaleDateString()}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <CardTitle>{t("pages.admin.companies")}</CardTitle>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companies?.map(company => (
                    <TableRow key={company.id}>
                      <TableCell className="font-medium">{company.name}</TableCell>
                      <TableCell className="text-muted-foreground">{company.legalName}</TableCell>
                      <TableCell>{company.country}</TableCell>
                      <TableCell>{company.currency}</TableCell>
                    </TableRow>
                  ))}
                  {!companies?.length && (
                    <TableRow><TableCell colSpan={4} className="text-center h-16">No companies configured</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <div className="flex space-x-[-8px]">
              <div className="h-5 w-5 rounded-full bg-blue-500 ring-2 ring-background"></div>
              <div className="h-5 w-5 rounded-full bg-red-500 ring-2 ring-background"></div>
            </div>
            <CardTitle>Brands</CardTitle>
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

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <CardTitle>User Directory</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Scope</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map(user => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback style={{ backgroundColor: user.avatarColor || 'var(--primary)', color: 'white' }}>
                            {user.initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium leading-none">{user.name}</span>
                          <span className="text-xs text-muted-foreground mt-1">{user.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{user.role}</Badge></TableCell>
                    <TableCell><span className="text-sm text-muted-foreground">{user.scope}</span></TableCell>
                  </TableRow>
                ))}
                {!users?.length && (
                  <TableRow><TableCell colSpan={3} className="text-center h-24">No users found</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Required<Omit<BrandUpdate, "name" | "color" | "voice">>>({
    logoUrl: brand.logoUrl ?? "",
    primaryColor: brand.primaryColor ?? brand.color ?? "#2D6CDF",
    secondaryColor: brand.secondaryColor ?? "",
    tone: brand.tone ?? brand.voice ?? "",
    legalEntityName: brand.legalEntityName ?? "",
    addressLine: brand.addressLine ?? "",
  });
  const update = useUpdateBrand();
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
    </>
  );
}

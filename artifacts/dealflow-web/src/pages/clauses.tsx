import { useTranslation } from "react-i18next";
import { useMemo, useState } from "react";
import {
  useListClauseFamilies,
  useListBrandsWithDefaults,
  useUpdateBrandDefaultClauses,
  getListBrandsWithDefaultsQueryKey,
  useListBrandClauseOverrides,
  useUpsertBrandClauseOverride,
  useDeleteBrandClauseOverride,
  getListBrandClauseOverridesQueryKey,
  useListClauseCompatibility,
  useCreateClauseCompatibility,
  useDeleteClauseCompatibility,
  getListClauseCompatibilityQueryKey,
  useUpsertClauseVariantTranslation,
  useDeleteClauseVariantTranslation,
  getListClauseFamiliesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Library, Palette, Save, Pencil, Trash2, Link2, Plus, Languages } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function toneClass(tone: string) {
  switch (tone) {
    case "zart": return "bg-rose-500/10 text-rose-600 border-rose-500/30";
    case "moderat": return "bg-amber-500/10 text-amber-600 border-amber-500/30";
    case "standard": return "bg-sky-500/10 text-sky-600 border-sky-500/30";
    case "streng": return "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";
    case "hart": return "bg-indigo-500/10 text-indigo-600 border-indigo-500/30";
    default: return "bg-muted text-muted-foreground";
  }
}

function severityDot(severity?: string) {
  if (severity === "high") return "bg-destructive";
  if (severity === "medium") return "bg-amber-500";
  return "bg-emerald-500";
}

export default function Clauses() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isTenantAdmin = !!(user?.isPlatformAdmin || user?.role === "Tenant Admin");
  const { data: families, isLoading } = useListClauseFamilies();
  const { data: brands } = useListBrandsWithDefaults();
  const updateBrand = useUpdateBrandDefaultClauses();

  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<string | null>(null);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  async function saveBrand(brandId: string, current: Record<string, string>) {
    setSaving(brandId);
    try {
      const merged = { ...current, ...(draft[brandId] ?? {}) };
      await updateBrand.mutateAsync({ id: brandId, data: { defaults: merged } });
      await qc.invalidateQueries({ queryKey: getListBrandsWithDefaultsQueryKey() });
      setDraft(d => { const n = { ...d }; delete n[brandId]; return n; });
      toast({ title: t("pages.clauses.brandSaved") });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setSaving(null);
    }
  }

  const totalVariants = (families ?? []).reduce((sum, f) => sum + (f.variants?.length ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 border-b pb-4">
        <Library className="h-8 w-8 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.clauses.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("pages.clauses.subtitle")}</p>
        </div>
        <div className="ml-auto flex gap-2 text-sm">
          <Badge variant="outline" className="text-sm px-3 py-1">
            {families?.length ?? 0} {t("pages.clauses.families")}
          </Badge>
          <Badge variant="outline" className="text-sm px-3 py-1">
            {totalVariants} {t("pages.clauses.variants")}
          </Badge>
        </div>
      </div>

      {(brands?.length ?? 0) > 0 && (
        <Card data-testid="brand-defaults-card">
          <CardHeader className="flex flex-row items-center gap-2 space-y-0">
            <Palette className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>{t("pages.clauses.brandDefaults")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {t("pages.clauses.brandDefaultsHint")}
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {brands?.map(brand => {
              const current = brand.defaultClauseVariants ?? {};
              const pending = draft[brand.id] ?? {};
              const merged = { ...current, ...pending };
              const dirty = Object.keys(pending).length > 0;
              return (
                <div key={brand.id} className="space-y-2 pb-4 border-b last:border-b-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: brand.color }} />
                      <span className="font-semibold text-sm">{brand.name}</span>
                      <Badge variant="outline" className="text-xs">{brand.voice}</Badge>
                    </div>
                    <Button
                      size="sm"
                      disabled={!dirty || saving === brand.id}
                      onClick={() => saveBrand(brand.id, current)}
                      data-testid={`save-brand-${brand.id}`}
                    >
                      <Save className="h-3 w-3 mr-1" />
                      {t("common.save")}
                    </Button>
                  </div>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {families?.map(fam => (
                      <div key={fam.id} className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">{fam.name}</span>
                        <Select
                          value={merged[fam.id] ?? ""}
                          onValueChange={(v) => setDraft(d => ({
                            ...d,
                            [brand.id]: { ...(d[brand.id] ?? {}), [fam.id]: v },
                          }))}
                        >
                          <SelectTrigger className="h-8 text-xs" data-testid={`brand-${brand.id}-family-${fam.id}`}>
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
                          <SelectContent>
                            {fam.variants.map(v => (
                              <SelectItem key={v.id} value={v.id}>
                                <span className="text-xs">{v.tone} ({v.severityScore}) · {v.name}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {(brands?.length ?? 0) > 0 && (families?.length ?? 0) > 0 && (
        <BrandOverridesSection brands={brands ?? []} families={families ?? []} />
      )}

      {(families?.length ?? 0) > 0 && (
        <ClauseTranslationsSection
          families={families ?? []}
          isTenantAdmin={isTenantAdmin}
        />
      )}

      {isTenantAdmin && (families?.length ?? 0) > 0 && (
        <CompatibilityRulesSection families={families ?? []} />
      )}

      {(families?.length ?? 0) === 0 ? (
        <div className="p-8 text-center border rounded-md text-muted-foreground bg-muted/10">
          {t("pages.clauses.empty")}
        </div>
      ) : (
        <div className="grid gap-4">
          {families?.map(family => {
            const sorted = [...family.variants].sort((a, b) => (a.severityScore ?? 0) - (b.severityScore ?? 0));
            return (
              <Card key={family.id} data-testid={`clause-family-${family.id}`}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>{family.name}</span>
                    <Badge variant="outline" className="text-xs font-normal">
                      {family.variants.length} {t("pages.clauses.variants")}
                    </Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{family.description}</p>
                </CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sorted.map(v => (
                      <div
                        key={v.id}
                        className="flex flex-col gap-2 p-3 border rounded-md bg-background"
                        data-testid={`variant-${v.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm truncate">{v.name}</span>
                          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${severityDot(v.severity)}`} />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`${toneClass(v.tone)} text-xs`}>
                            {v.tone}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {t("pages.clauses.severityScore")}: <strong className="tabular-nums">{v.severityScore}</strong>
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{v.summary}</p>
                        {v.body && (
                          <p className="text-xs italic border-l-2 pl-2 py-0.5 text-muted-foreground/80">
                            {v.body}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

type BrandLite = { id: string; name: string; color?: string | null };
type TranslationLite = {
  id: string;
  variantId: string;
  locale: "de" | "en";
  name: string;
  summary: string;
  body: string;
  source?: string | null;
  license?: string | null;
  sourceUrl?: string | null;
};
type FamilyLite = {
  id: string;
  name: string;
  variants: Array<{
    id: string;
    name: string;
    summary?: string | null;
    body?: string | null;
    tone: string;
    severity: string;
    severityScore: number;
    translations?: TranslationLite[];
  }>;
};

function BrandOverridesSection({
  brands,
  families,
}: {
  brands: BrandLite[];
  families: FamilyLite[];
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [brandId, setBrandId] = useState<string>(brands[0]?.id ?? "");
  const { data: overrides } = useListBrandClauseOverrides(brandId, {
    query: { enabled: !!brandId, queryKey: getListBrandClauseOverridesQueryKey(brandId) },
  });
  const upsert = useUpsertBrandClauseOverride();
  const remove = useDeleteBrandClauseOverride();
  const [editing, setEditing] = useState<{ variantId: string; familyName: string; baseName: string } | null>(null);
  const [form, setForm] = useState<{
    name: string;
    summary: string;
    body: string;
    tone: string;
    severity: string;
    severityScore: string;
  }>({ name: "", summary: "", body: "", tone: "", severity: "", severityScore: "" });

  const overrideMap = useMemo(() => {
    const m = new Map<string, NonNullable<typeof overrides>[number]>();
    (overrides ?? []).forEach(o => m.set(o.baseVariantId, o));
    return m;
  }, [overrides]);

  function openEditor(variant: FamilyLite["variants"][number], familyName: string) {
    const ov = overrideMap.get(variant.id);
    setEditing({ variantId: variant.id, familyName, baseName: variant.name });
    setForm({
      name: ov?.name ?? "",
      summary: ov?.summary ?? "",
      body: ov?.body ?? "",
      tone: ov?.tone ?? "",
      severity: ov?.severity ?? "",
      severityScore: ov?.severityScore != null ? String(ov.severityScore) : "",
    });
  }

  async function save() {
    if (!editing || !brandId) return;
    const patch: Record<string, unknown> = {
      name: form.name.trim() || null,
      summary: form.summary.trim() || null,
      body: form.body.trim() || null,
      tone: form.tone.trim() || null,
      severity: form.severity.trim() || null,
      severityScore: form.severityScore.trim() === "" ? null : Number(form.severityScore),
    };
    await upsert.mutateAsync({
      brandId,
      baseVariantId: editing.variantId,
      data: patch as never,
    });
    await qc.invalidateQueries({ queryKey: getListBrandClauseOverridesQueryKey(brandId) });
    toast({ description: t("pages.clauses.overrideSaved") });
    setEditing(null);
  }

  async function removeOverride(variantId: string) {
    if (!brandId) return;
    await remove.mutateAsync({ brandId, baseVariantId: variantId });
    await qc.invalidateQueries({ queryKey: getListBrandClauseOverridesQueryKey(brandId) });
    toast({ description: t("pages.clauses.overrideRemoved") });
  }

  return (
    <Card data-testid="brand-overrides-card">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Pencil className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <CardTitle>{t("pages.clauses.clauseOverrides")}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{t("pages.clauses.clauseOverridesHint")}</p>
        </div>
        <div className="w-64">
          <Select value={brandId} onValueChange={setBrandId}>
            <SelectTrigger data-testid="override-brand-select">
              <SelectValue placeholder={t("pages.clauses.selectBrand")} />
            </SelectTrigger>
            <SelectContent>
              {brands.map(b => (
                <SelectItem key={b.id} value={b.id}>
                  <span className="flex items-center gap-2">
                    {b.color && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: b.color }} />}
                    {b.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {families.map(fam => (
          <div key={fam.id} className="space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground">{fam.name}</h4>
            <div className="grid md:grid-cols-2 gap-2">
              {fam.variants.map(v => {
                const ov = overrideMap.get(v.id);
                return (
                  <div
                    key={v.id}
                    className="flex items-center justify-between gap-2 p-2 border rounded-md text-sm"
                    data-testid={`override-row-${v.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{v.name}</div>
                      <div className="text-xs text-muted-foreground">{v.tone} · {v.severityScore}</div>
                    </div>
                    {ov && (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs">
                        {t("pages.clauses.overrideHasOverride")}
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openEditor(v, fam.name)}
                      data-testid={`override-edit-${v.id}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {ov && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeOverride(v.id)}
                        data-testid={`override-remove-${v.id}`}
                      >
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing && t("pages.clauses.overrideEditFor", { variant: editing.baseName })}
            </DialogTitle>
            <p className="text-xs text-muted-foreground">{t("pages.clauses.overrideUseBaseHint")}</p>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t("pages.clauses.overrideName")}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                data-testid="override-input-name"
              />
            </div>
            <div>
              <Label className="text-xs">{t("pages.clauses.overrideSummary")}</Label>
              <Input
                value={form.summary}
                onChange={(e) => setForm(f => ({ ...f, summary: e.target.value }))}
                data-testid="override-input-summary"
              />
            </div>
            <div>
              <Label className="text-xs">{t("pages.clauses.overrideBody")}</Label>
              <Textarea
                rows={5}
                value={form.body}
                onChange={(e) => setForm(f => ({ ...f, body: e.target.value }))}
                data-testid="override-input-body"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">{t("pages.clauses.overrideTone")}</Label>
                <Input
                  value={form.tone}
                  onChange={(e) => setForm(f => ({ ...f, tone: e.target.value }))}
                  placeholder="zart / mittel / hart"
                  data-testid="override-input-tone"
                />
              </div>
              <div>
                <Label className="text-xs">{t("pages.clauses.overrideSeverity")}</Label>
                <Select
                  value={form.severity || "__none__"}
                  onValueChange={(v) => setForm(f => ({ ...f, severity: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger data-testid="override-input-severity">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    <SelectItem value="low">low</SelectItem>
                    <SelectItem value="medium">medium</SelectItem>
                    <SelectItem value="high">high</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("pages.clauses.overrideSeverityScore")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.severityScore}
                  onChange={(e) => setForm(f => ({ ...f, severityScore: e.target.value }))}
                  data-testid="override-input-score"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button onClick={save} disabled={upsert.isPending} data-testid="override-save">
              <Save className="h-3 w-3 mr-1" />
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function CompatibilityRulesSection({ families }: { families: FamilyLite[] }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: rules } = useListClauseCompatibility();
  const create = useCreateClauseCompatibility();
  const remove = useDeleteClauseCompatibility();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ fromVariantId: string; toVariantId: string; kind: "requires" | "conflicts"; note: string }>({
    fromVariantId: "",
    toVariantId: "",
    kind: "requires",
    note: "",
  });

  const variantIndex = useMemo(() => {
    const m = new Map<string, { name: string; family: string }>();
    families.forEach(f => f.variants.forEach(v => m.set(v.id, { name: v.name, family: f.name })));
    return m;
  }, [families]);

  async function add() {
    if (!form.fromVariantId || !form.toVariantId) return;
    await create.mutateAsync({
      data: {
        fromVariantId: form.fromVariantId,
        toVariantId: form.toVariantId,
        kind: form.kind,
        note: form.note.trim() || null,
      } as never,
    });
    await qc.invalidateQueries({ queryKey: getListClauseCompatibilityQueryKey() });
    setOpen(false);
    setForm({ fromVariantId: "", toVariantId: "", kind: "requires", note: "" });
  }

  async function del(id: string) {
    await remove.mutateAsync({ id });
    await qc.invalidateQueries({ queryKey: getListClauseCompatibilityQueryKey() });
    toast({ description: t("common.deleted") });
  }

  return (
    <Card data-testid="compatibility-rules-card">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Link2 className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <CardTitle>{t("pages.clauses.compatTitle")}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{t("pages.clauses.compatHint")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" data-testid="compat-add-btn">
              <Plus className="h-3 w-3 mr-1" />
              {t("pages.clauses.compatAdd")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("pages.clauses.compatAdd")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">{t("pages.clauses.compatFromVariant")}</Label>
                <Select value={form.fromVariantId} onValueChange={(v) => setForm(f => ({ ...f, fromVariantId: v }))}>
                  <SelectTrigger data-testid="compat-from-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {families.map(fam => fam.variants.map(v => (
                      <SelectItem key={v.id} value={v.id}>{fam.name} · {v.name}</SelectItem>
                    )))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("pages.clauses.compatKind")}</Label>
                <Select value={form.kind} onValueChange={(v) => setForm(f => ({ ...f, kind: v as "requires" | "conflicts" }))}>
                  <SelectTrigger data-testid="compat-kind-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="requires">{t("pages.clauses.compatRequires")}</SelectItem>
                    <SelectItem value="conflicts">{t("pages.clauses.compatConflicts")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("pages.clauses.compatToVariant")}</Label>
                <Select value={form.toVariantId} onValueChange={(v) => setForm(f => ({ ...f, toVariantId: v }))}>
                  <SelectTrigger data-testid="compat-to-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {families.map(fam => fam.variants.map(v => (
                      <SelectItem key={v.id} value={v.id}>{fam.name} · {v.name}</SelectItem>
                    )))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("pages.clauses.compatNote")}</Label>
                <Input
                  value={form.note}
                  onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
                  data-testid="compat-note-input"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
              <Button
                onClick={add}
                disabled={!form.fromVariantId || !form.toVariantId || create.isPending}
                data-testid="compat-save-btn"
              >
                {t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {(rules?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{t("pages.clauses.compatNone")}</p>
        ) : (
          <div className="divide-y border rounded-md">
            {rules?.map(r => {
              const from = variantIndex.get(r.fromVariantId);
              const to = variantIndex.get(r.toVariantId);
              return (
                <div key={r.id} className="flex items-center gap-2 px-3 py-2 text-sm" data-testid={`compat-row-${r.id}`}>
                  <span className="font-medium truncate">{from ? `${from.family} · ${from.name}` : r.fromVariantId}</span>
                  <Badge
                    variant="outline"
                    className={r.kind === "conflicts"
                      ? "bg-rose-500/10 text-rose-600 border-rose-500/30"
                      : "bg-amber-500/10 text-amber-600 border-amber-500/30"}
                  >
                    {r.kind === "requires" ? t("pages.clauses.compatRequires") : t("pages.clauses.compatConflicts")}
                  </Badge>
                  <span className="font-medium truncate">{to ? `${to.family} · ${to.name}` : r.toVariantId}</span>
                  {r.note && <span className="text-xs text-muted-foreground italic ml-2">{r.note}</span>}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => del(r.id)}
                    data-testid={`compat-remove-${r.id}`}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ClauseTranslationsSection({
  families,
  isTenantAdmin,
}: {
  families: FamilyLite[];
  isTenantAdmin: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const upsert = useUpsertClauseVariantTranslation();
  const remove = useDeleteClauseVariantTranslation();
  const [editing, setEditing] = useState<{
    variantId: string;
    locale: "en";
    variantName: string;
    familyName: string;
  } | null>(null);
  const [form, setForm] = useState<{
    name: string;
    summary: string;
    body: string;
    source: string;
    license: string;
    sourceUrl: string;
  }>({ name: "", summary: "", body: "", source: "", license: "", sourceUrl: "" });

  function openEditor(
    variant: FamilyLite["variants"][number],
    familyName: string,
    locale: "en",
  ) {
    const tr = (variant.translations ?? []).find((x) => x.locale === locale);
    setEditing({ variantId: variant.id, locale, variantName: variant.name, familyName });
    setForm({
      name: tr?.name ?? "",
      summary: tr?.summary ?? "",
      body: tr?.body ?? "",
      source: tr?.source ?? "",
      license: tr?.license ?? "",
      sourceUrl: tr?.sourceUrl ?? "",
    });
  }

  async function save() {
    if (!editing) return;
    try {
      await upsert.mutateAsync({
        variantId: editing.variantId,
        locale: editing.locale,
        data: {
          name: form.name.trim(),
          summary: form.summary.trim(),
          body: form.body,
          source: form.source.trim() || null,
          license: form.license.trim() || null,
          sourceUrl: form.sourceUrl.trim() || null,
        },
      });
      await qc.invalidateQueries({ queryKey: getListClauseFamiliesQueryKey() });
      toast({ description: t("pages.clauses.translationSaved") });
      setEditing(null);
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  }

  async function removeTr(variantId: string, locale: "en") {
    try {
      await remove.mutateAsync({ variantId, locale });
      await qc.invalidateQueries({ queryKey: getListClauseFamiliesQueryKey() });
      toast({ description: t("pages.clauses.translationRemoved") });
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  }

  return (
    <Card data-testid="clause-translations-card">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Languages className="h-5 w-5 text-muted-foreground" />
        <div>
          <CardTitle>{t("pages.clauses.translations")}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            {t("pages.clauses.translationsHint")}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {families.map((fam) => (
          <div key={fam.id} className="space-y-2">
            <h4 className="text-sm font-semibold text-muted-foreground">{fam.name}</h4>
            <div className="grid md:grid-cols-2 gap-2">
              {fam.variants.map((v) => {
                const enTr = (v.translations ?? []).find((x) => x.locale === "en");
                return (
                  <div
                    key={v.id}
                    className="flex items-center justify-between gap-2 p-2 border rounded-md text-sm"
                    data-testid={`translation-row-${v.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{v.name}</div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs">
                          DE · {t("pages.clauses.translationPresent")}
                        </Badge>
                        {enTr ? (
                          <Badge variant="outline" className="bg-sky-500/10 text-sky-600 border-sky-500/30 text-xs">
                            EN · {t("pages.clauses.translationPresent")}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs">
                            EN · {t("pages.clauses.translationMissing")}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {isTenantAdmin && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openEditor(v, fam.name, "en")}
                          data-testid={`translation-edit-${v.id}`}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        {enTr && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeTr(v.id, "en")}
                            data-testid={`translation-remove-${v.id}`}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Languages className="h-4 w-4" />
                  {t("pages.clauses.translationEditFor", {
                    variant: `${editing.familyName} · ${editing.variantName}`,
                    locale: editing.locale.toUpperCase(),
                  })}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>{t("pages.clauses.translationName")}</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    data-testid="translation-input-name"
                  />
                </div>
                <div>
                  <Label>{t("pages.clauses.translationSummary")}</Label>
                  <Textarea
                    value={form.summary}
                    onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                    rows={3}
                    data-testid="translation-input-summary"
                  />
                </div>
                <div>
                  <Label>{t("pages.clauses.translationBody")}</Label>
                  <Textarea
                    value={form.body}
                    onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                    rows={4}
                    data-testid="translation-input-body"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>{t("pages.clauses.translationSource")}</Label>
                    <Input
                      value={form.source}
                      onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>{t("pages.clauses.translationLicense")}</Label>
                    <Input
                      value={form.license}
                      onChange={(e) => setForm((f) => ({ ...f, license: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>{t("pages.clauses.translationSourceUrl")}</Label>
                    <Input
                      value={form.sourceUrl}
                      onChange={(e) => setForm((f) => ({ ...f, sourceUrl: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  onClick={save}
                  disabled={!form.name.trim() || !form.summary.trim() || upsert.isPending}
                  data-testid="translation-save"
                >
                  <Save className="h-3 w-3 mr-1" />
                  {t("common.save")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

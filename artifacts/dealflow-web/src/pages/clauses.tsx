import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  useListClauseFamilies,
  useListBrandsWithDefaults,
  useUpdateBrandDefaultClauses,
  getListBrandsWithDefaultsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Library, Palette, Save } from "lucide-react";
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

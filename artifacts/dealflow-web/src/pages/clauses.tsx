import { useTranslation } from "react-i18next";
import { useListClauseFamilies } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Library } from "lucide-react";

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
  const { data: families, isLoading } = useListClauseFamilies();

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

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

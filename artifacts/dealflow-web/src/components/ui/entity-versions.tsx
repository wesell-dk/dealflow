import { useTranslation } from "react-i18next";
import { useListEntityVersions } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { History } from "lucide-react";

export function EntityVersions({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useListEntityVersions(entityType, entityId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          {t("pages.versions.title")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !data || data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pages.versions.noVersions")}</p>
        ) : (
          <ol className="space-y-3">
            {data.map((v) => (
              <li key={v.id} className="border-l-2 pl-3 py-1 border-primary/40">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="outline">v{v.version}</Badge>
                  <span className="font-medium">{v.label}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {t("pages.versions.savedBy")} <span className="font-medium">{v.actor}</span>
                  {" · "}
                  {new Date(v.createdAt).toLocaleString()}
                </div>
                {v.comment && (
                  <div className="text-xs mt-1 text-muted-foreground italic">{v.comment}</div>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

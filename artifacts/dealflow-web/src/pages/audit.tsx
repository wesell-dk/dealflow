import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useListAuditEntries } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History } from "lucide-react";

const actionVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  create: "default",
  update: "secondary",
  delete: "destructive",
};

export default function Audit() {
  const { t, i18n } = useTranslation();
  const { data, isLoading } = useListAuditEntries({ limit: 200 });
  const [entityType, setEntityType] = useState<string>("__all__");
  const [action, setAction] = useState<string>("__all__");
  const [search, setSearch] = useState("");

  const entityTypes = useMemo(
    () => Array.from(new Set((data ?? []).map((e) => e.entityType))).sort(),
    [data],
  );
  const actions = useMemo(
    () => Array.from(new Set((data ?? []).map((e) => e.action))).sort(),
    [data],
  );

  const filtered = useMemo(() => {
    return (data ?? []).filter((e) => {
      if (entityType !== "__all__" && e.entityType !== entityType) return false;
      if (action !== "__all__" && e.action !== action) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !e.summary.toLowerCase().includes(q) &&
          !e.actor.toLowerCase().includes(q) &&
          !e.entityId.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [data, entityType, action, search]);

  return (
    <>
      <div className="flex items-center gap-3">
        <History className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("pages.audit.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("pages.audit.subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("common.filter")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select value={entityType} onValueChange={setEntityType}>
            <SelectTrigger>
              <SelectValue placeholder={t("pages.audit.entityType")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("common.all")}</SelectItem>
              {entityTypes.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger>
              <SelectValue placeholder={t("pages.audit.action")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t("common.all")}</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder={t("common.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {filtered.length} / {data?.length ?? 0}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("pages.audit.noEntries")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.date")}</TableHead>
                  <TableHead>{t("pages.audit.entityType")}</TableHead>
                  <TableHead>{t("pages.audit.action")}</TableHead>
                  <TableHead>{t("common.user")}</TableHead>
                  <TableHead>Summary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                      {new Date(e.at).toLocaleString(i18n.resolvedLanguage)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{e.entityType}</Badge>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{e.entityId}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionVariant[e.action] ?? "outline"}>{e.action}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{e.actor}</TableCell>
                    <TableCell className="text-sm">{e.summary}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

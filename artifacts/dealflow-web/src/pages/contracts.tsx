import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useListContracts,
  useListExternalContracts,
  type Contract,
  type ExternalContract,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FileText, RefreshCw } from "lucide-react";

type Source = "all" | "internal" | "external";

type Row =
  | {
      kind: "internal";
      id: string;
      title: string;
      dealId: string;
      dealName: string;
      template: string;
      version: number;
      status: string;
      riskLevel: Contract["riskLevel"];
      validUntil: string | null;
      renewalRelevant: false;
    }
  | {
      kind: "external";
      id: string;
      title: string;
      accountId: string;
      accountName: string | null;
      fileName: string;
      status: string;
      validUntil: string | null;
      renewalRelevant: boolean;
    };

export default function Contracts() {
  const { t } = useTranslation();
  const [source, setSource] = useState<Source>("all");

  const { data: contracts, isLoading: l1 } = useListContracts();
  const { data: externals, isLoading: l2 } = useListExternalContracts();

  const isLoading = l1 || l2;

  const rows = useMemo<Row[]>(() => {
    const internal: Row[] = (contracts ?? []).map((c) => ({
      kind: "internal",
      id: c.id,
      title: c.title,
      dealId: c.dealId,
      dealName: c.dealName,
      template: c.template,
      version: c.version,
      status: c.status,
      riskLevel: c.riskLevel,
      validUntil: c.validUntil ?? null,
      renewalRelevant: false,
    }));
    const ext: Row[] = (externals ?? []).map((c: ExternalContract) => ({
      kind: "external",
      id: c.id,
      title: c.title,
      accountId: c.accountId,
      accountName: c.accountName ?? null,
      fileName: c.fileName,
      status: c.status,
      validUntil: c.effectiveTo ?? null,
      renewalRelevant: c.renewalRelevant,
    }));
    let combined: Row[] = [];
    if (source === "internal") combined = internal;
    else if (source === "external") combined = ext;
    else combined = [...internal, ...ext];
    return combined.sort((a, b) => a.title.localeCompare(b.title, "de"));
  }, [contracts, externals, source]);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.contracts.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.contracts.subtitle")}</p>
        </div>
        <div className="w-48">
          <Label className="text-xs text-muted-foreground">Quelle</Label>
          <Select value={source} onValueChange={(v) => setSource(v as Source)}>
            <SelectTrigger data-testid="contracts-source-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Alle</SelectItem>
              <SelectItem value="internal">Intern</SelectItem>
              <SelectItem value="external">Extern</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("common.title")}</TableHead>
              <TableHead>Quelle</TableHead>
              <TableHead>{t("common.deal")}</TableHead>
              <TableHead>{t("common.template")}</TableHead>
              <TableHead>{t("common.version")}</TableHead>
              <TableHead>{t("common.status")}</TableHead>
              <TableHead>{t("common.risk")}</TableHead>
              <TableHead>{t("common.validUntil")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) =>
              row.kind === "internal" ? (
                <TableRow key={`int-${row.id}`} data-testid={`contract-row-${row.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/contracts/${row.id}`} className="flex items-center gap-2 hover:underline">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell><Badge variant="outline">Intern</Badge></TableCell>
                  <TableCell>
                    <Link href={`/deals/${row.dealId}`} className="hover:underline">
                      {row.dealName}
                    </Link>
                  </TableCell>
                  <TableCell>{row.template}</TableCell>
                  <TableCell>v{row.version}</TableCell>
                  <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                  <TableCell>
                    <Badge
                      variant={row.riskLevel === 'high' ? 'destructive' : row.riskLevel === 'medium' ? 'secondary' : 'default'}
                      className={row.riskLevel === 'low'
                        ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
                        : row.riskLevel === 'medium'
                        ? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20' : ''}
                    >
                      {row.riskLevel}
                    </Badge>
                  </TableCell>
                  <TableCell>{row.validUntil ? new Date(row.validUntil).toLocaleDateString() : 'N/A'}</TableCell>
                </TableRow>
              ) : (
                <TableRow key={`ext-${row.id}`} data-testid={`contract-row-${row.id}`}>
                  <TableCell className="font-medium">
                    <Link href={`/accounts/${row.accountId}`} className="flex items-center gap-2 hover:underline">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="gap-1">
                      Extern
                      {row.renewalRelevant && <RefreshCw className="h-3 w-3" />}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link href={`/accounts/${row.accountId}`} className="text-muted-foreground hover:underline">
                      {row.accountName ?? "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.fileName}</TableCell>
                  <TableCell>—</TableCell>
                  <TableCell><Badge variant="outline">{row.status}</Badge></TableCell>
                  <TableCell>—</TableCell>
                  <TableCell>{row.validUntil ? new Date(row.validUntil).toLocaleDateString() : '—'}</TableCell>
                </TableRow>
              )
            )}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center">No contracts found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

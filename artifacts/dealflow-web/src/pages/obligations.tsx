import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListObligations,
  useUpdateObligation,
  getListObligationsQueryKey,
  type Obligation,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  AlarmClock, AlertTriangle, CheckCircle2, ClipboardList,
  FileSignature, ListChecks, Repeat,
} from "lucide-react";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { ObligationStatusBadge } from "@/components/patterns/status-badges";

type ObligationStatus = "pending" | "in_progress" | "done" | "missed" | "waived";

function typeLabel(type: string): string {
  return ({
    delivery: "Lieferung",
    reporting: "Reporting",
    sla: "SLA",
    payment: "Zahlung",
    notice: "Mitteilung",
    audit: "Audit",
  } as Record<string, string>)[type] ?? type;
}

function recurrenceLabel(r: string): string {
  return ({
    none: "Einmalig",
    monthly: "Monatlich",
    quarterly: "Quartalsweise",
    annual: "Jährlich",
  } as Record<string, string>)[r] ?? r;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function dueClass(o: Obligation): string {
  if (o.status === "done" || o.status === "waived") return "text-muted-foreground";
  if (!o.dueAt) return "";
  const due = new Date(o.dueAt).getTime();
  const now = Date.now();
  if (due < now) return "text-red-600 font-medium";
  if (due - now < 7 * 86400000) return "text-amber-600 font-medium";
  return "";
}

export default function Obligations() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("__open__");
  const [search, setSearch] = useState("");

  const queryParams = useMemo(() => {
    const p: { status?: ObligationStatus; overdueOnly?: boolean } = {};
    if (statusFilter === "__open__") {
      // Frontend-Filter: Open = nicht done, nicht waived
    } else if (statusFilter === "__overdue__") {
      p.overdueOnly = true;
    } else if (statusFilter !== "__all__") {
      p.status = statusFilter as ObligationStatus;
    }
    return p;
  }, [statusFilter]);

  const { data, isLoading } = useListObligations(queryParams);
  const update = useUpdateObligation();

  const filtered = useMemo(() => {
    let rows = data ?? [];
    if (statusFilter === "__open__") {
      rows = rows.filter(o => o.status !== "done" && o.status !== "waived");
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      rows = rows.filter(o =>
        o.description.toLowerCase().includes(s)
        || (o.contractTitle ?? "").toLowerCase().includes(s)
        || (o.accountName ?? "").toLowerCase().includes(s),
      );
    }
    return rows;
  }, [data, statusFilter, search]);

  const summary = useMemo(() => {
    const all = data ?? [];
    const open = all.filter(o => o.status !== "done" && o.status !== "waived");
    const overdue = open.filter(o => o.dueAt && new Date(o.dueAt).getTime() < Date.now());
    const next7 = open.filter(o => o.dueAt && new Date(o.dueAt).getTime() >= Date.now()
      && new Date(o.dueAt).getTime() < Date.now() + 7 * 86400000);
    const done30 = all.filter(o => o.status === "done" && o.completedAt
      && Date.now() - new Date(o.completedAt).getTime() < 30 * 86400000);
    return { open: open.length, overdue: overdue.length, next7: next7.length, done30: done30.length };
  }, [data]);

  async function setStatus(o: Obligation, status: ObligationStatus) {
    try {
      await update.mutateAsync({ id: o.id, data: { status } });
      await qc.invalidateQueries({ queryKey: getListObligationsQueryKey() });
      toast({ title: "Status aktualisiert" });
    } catch (e) {
      toast({ title: "Fehler", description: String(e), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6 p-6" data-testid="page-obligations">
      <PageHeader
        icon={ClipboardList}
        title="Pflichten (Obligations)"
        subtitle="Vertragliche Pflichten aus aktiven Verträgen — automatisch abgeleitet bei Signatur, manuell ergänzbar im Vertrags-Workspace."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card data-testid="kpi-open">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-muted-foreground" />Offen gesamt
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{summary.open}</div></CardContent>
        </Card>
        <Card data-testid="kpi-overdue">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />Überfällig
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-red-600">{summary.overdue}</div></CardContent>
        </Card>
        <Card data-testid="kpi-next7">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlarmClock className="h-4 w-4 text-amber-500" />Fällig in 7 Tagen
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-amber-600">{summary.next7}</div></CardContent>
        </Card>
        <Card data-testid="kpi-done30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />Erledigt (30 Tage)
            </CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold text-emerald-600">{summary.done30}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">Pflichten-Liste</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="Suche Beschreibung / Vertrag / Kunde…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-64"
              data-testid="input-search"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44" data-testid="select-status-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__open__">Alle offenen</SelectItem>
                <SelectItem value="__overdue__">Nur überfällig</SelectItem>
                <SelectItem value="__all__">Alle</SelectItem>
                <SelectItem value="pending">Offen</SelectItem>
                <SelectItem value="in_progress">In Arbeit</SelectItem>
                <SelectItem value="done">Erledigt</SelectItem>
                <SelectItem value="missed">Versäumt</SelectItem>
                <SelectItem value="waived">Verzichtet</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : filtered.length === 0 ? (
            <EmptyStateCard
              icon={ClipboardList}
              title="Keine Pflichten gefunden"
              body={data && data.length > 0
                ? "Keine Pflichten passen zu Suche oder Filter. Filter zurücksetzen, um alle anzuzeigen."
                : "Pflichten werden bei Vertrags-Signatur automatisch erkannt und im Vertrags-Workspace gepflegt."}
              hint="Tipp: Mit dem Filter „Alle offenen“ siehst Du laufende und überfällige Pflichten gemeinsam."
              className="border-0 shadow-none"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pflicht</TableHead>
                  <TableHead>Vertrag</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Verantwortlich</TableHead>
                  <TableHead>Fällig</TableHead>
                  <TableHead>Wiederholung</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(o => (
                  <TableRow key={o.id} data-testid={`row-obligation-${o.id}`}>
                    <TableCell className="max-w-md">
                      <div className="font-medium text-sm">{o.description}</div>
                      {o.accountName && (
                        <div className="text-xs text-muted-foreground">{o.accountName}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link href={`/contracts/${o.contractId}`}>
                        <span className="text-sm text-primary hover:underline inline-flex items-center gap-1">
                          <FileSignature className="h-3 w-3" />
                          {o.contractTitle ?? o.contractId}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-xs">{typeLabel(o.type)}</Badge></TableCell>
                    <TableCell className="text-sm">
                      {o.ownerName ?? o.ownerRole ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className={`text-sm ${dueClass(o)}`}>{fmtDate(o.dueAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {o.recurrence !== "none" && <Repeat className="h-3 w-3 inline mr-1" />}
                      {recurrenceLabel(o.recurrence)}
                    </TableCell>
                    <TableCell><ObligationStatusBadge status={o.status === "done" ? "completed" : o.status === "missed" ? "overdue" : o.status} /></TableCell>
                    <TableCell className="text-right">
                      {o.status !== "done" && o.status !== "waived" && (
                        <div className="flex justify-end gap-1">
                          {o.status === "pending" && (
                            <Button size="sm" variant="ghost" onClick={() => setStatus(o, "in_progress")}
                              data-testid={`btn-start-${o.id}`}>
                              Start
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setStatus(o, "done")}
                            data-testid={`btn-done-${o.id}`}>
                            Erledigt
                          </Button>
                          <Button size="sm" variant="ghost" className="text-muted-foreground"
                            onClick={() => setStatus(o, "waived")}
                            data-testid={`btn-waive-${o.id}`}>
                            Verzicht
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

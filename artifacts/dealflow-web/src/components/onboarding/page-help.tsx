import { useLocation, Link } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Lightbulb, ArrowRight, ListChecks, Compass, BarChart3 } from "lucide-react";
import { useOnboarding } from "@/contexts/onboarding-context";
import { getHelpForRoute, getCurrentWorkflowStep } from "@/lib/help-content";
import { WorkflowMap } from "./workflow-map";
import {
  useListAccounts,
  useListDeals,
  useListApprovals,
  useListSignaturePackages,
  useListContracts,
  useListQuotes,
  useListNegotiations,
} from "@workspace/api-client-react";

type Stat = { label: string; value: string | number; tone?: "default" | "warn" | "success" };

function StatRow({ stats, loading }: { stats: Stat[]; loading?: boolean }) {
  if (loading) {
    return <div className="text-xs text-muted-foreground italic">Lade Daten…</div>;
  }
  if (stats.length === 0) {
    return <div className="text-xs text-muted-foreground italic">Noch keine Daten erfasst.</div>;
  }
  return (
    <ul className="grid grid-cols-2 gap-2 text-xs">
      {stats.map((s, i) => (
        <li
          key={i}
          className={`rounded border px-2 py-1.5 ${
            s.tone === "warn"
              ? "border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20"
              : s.tone === "success"
                ? "border-green-200 bg-green-50 dark:border-green-900/50 dark:bg-green-950/20"
                : "bg-background"
          }`}
        >
          <div className="text-muted-foreground">{s.label}</div>
          <div className="font-semibold text-sm">{s.value}</div>
        </li>
      ))}
    </ul>
  );
}

function AccountsLive() {
  const accounts = useListAccounts();
  const deals = useListDeals();
  const loading = accounts.isLoading || deals.isLoading;
  const accountList = accounts.data ?? [];
  const dealList = deals.data ?? [];
  const accountsWithDeals = new Set(dealList.map((d) => d.accountId).filter(Boolean));
  const without = accountList.filter((a) => !accountsWithDeals.has(a.id)).length;
  const stats: Stat[] = [
    { label: "Kunden gesamt", value: accountList.length },
    { label: "Ohne aktiven Deal", value: without, tone: without > 0 ? "warn" : "default" },
  ];
  return <StatRow stats={stats} loading={loading} />;
}

function DealsLive() {
  const deals = useListDeals();
  if (deals.isLoading) return <StatRow stats={[]} loading />;
  const list = deals.data ?? [];
  const open = list.filter((d) => d.stage !== "won" && d.stage !== "lost");
  const closing = list.filter((d) => d.stage === "closing").length;
  const totalOpenValue = open.reduce((sum, d) => sum + (d.value ?? 0), 0);
  const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const stats: Stat[] = [
    { label: "Offene Deals", value: open.length },
    { label: "Im Closing", value: closing, tone: closing > 0 ? "success" : "default" },
    { label: "Pipeline-Wert", value: eur.format(totalOpenValue) },
    { label: "Gesamt erfasst", value: list.length },
  ];
  return <StatRow stats={stats} />;
}

function ApprovalsLive() {
  const q = useListApprovals();
  if (q.isLoading) return <StatRow stats={[]} loading />;
  const list = q.data ?? [];
  const pending = list.filter((a) => a.status === "pending").length;
  const approved = list.filter((a) => a.status === "approved").length;
  const rejected = list.filter((a) => a.status === "rejected").length;
  const stats: Stat[] = [
    { label: "Offen", value: pending, tone: pending > 0 ? "warn" : "default" },
    { label: "Genehmigt", value: approved, tone: "success" },
    { label: "Abgelehnt", value: rejected },
    { label: "Gesamt", value: list.length },
  ];
  return <StatRow stats={stats} />;
}

function SignaturesLive() {
  const q = useListSignaturePackages();
  if (q.isLoading) return <StatRow stats={[]} loading />;
  const list = q.data ?? [];
  const inProgress = list.filter((s) => s.status === "in_progress").length;
  const completed = list.filter((s) => s.status === "completed").length;
  const blocked = list.filter((s) => s.status === "blocked").length;
  const stats: Stat[] = [
    { label: "Aktiv unterwegs", value: inProgress, tone: inProgress > 0 ? "warn" : "default" },
    { label: "Vollständig signiert", value: completed, tone: "success" },
    { label: "Blockiert", value: blocked, tone: blocked > 0 ? "warn" : "default" },
    { label: "Gesamt", value: list.length },
  ];
  return <StatRow stats={stats} />;
}

function ContractsLive() {
  const q = useListContracts();
  if (q.isLoading) return <StatRow stats={[]} loading />;
  const list = q.data ?? [];
  const inReview = list.filter((c) => c.status === "in_review").length;
  const outForSig = list.filter((c) => c.status === "out_for_signature").length;
  const signed = list.filter((c) => c.status === "signed" || c.status === "executed").length;
  const stats: Stat[] = [
    { label: "In Review", value: inReview, tone: inReview > 0 ? "warn" : "default" },
    { label: "Bei Unterschrift", value: outForSig },
    { label: "Signiert", value: signed, tone: "success" },
    { label: "Gesamt", value: list.length },
  ];
  return <StatRow stats={stats} />;
}

function QuotesLive() {
  const q = useListQuotes();
  if (q.isLoading) return <StatRow stats={[]} loading />;
  const list = q.data ?? [];
  const draft = list.filter((c) => c.status === "draft").length;
  const sent = list.filter((c) => c.status === "sent").length;
  const accepted = list.filter((c) => c.status === "accepted").length;
  const stats: Stat[] = [
    { label: "Entwürfe", value: draft },
    { label: "Versandt", value: sent, tone: sent > 0 ? "warn" : "default" },
    { label: "Akzeptiert", value: accepted, tone: "success" },
    { label: "Gesamt", value: list.length },
  ];
  return <StatRow stats={stats} />;
}

function NegotiationsLive() {
  const q = useListNegotiations();
  if (q.isLoading) return <StatRow stats={[]} loading />;
  const list = q.data ?? [];
  const stats: Stat[] = [{ label: "Verhandlungen erfasst", value: list.length }];
  return <StatRow stats={stats} />;
}

function HomeLive() {
  const accounts = useListAccounts();
  const deals = useListDeals();
  const approvals = useListApprovals();
  if (accounts.isLoading || deals.isLoading || approvals.isLoading) return <StatRow stats={[]} loading />;
  const dealList = deals.data ?? [];
  const open = dealList.filter((d) => d.stage !== "won" && d.stage !== "lost").length;
  const pending = (approvals.data ?? []).filter((a) => a.status === "pending").length;
  const stats: Stat[] = [
    { label: "Kunden", value: (accounts.data ?? []).length },
    { label: "Offene Deals", value: open },
    { label: "Pending Approvals", value: pending, tone: pending > 0 ? "warn" : "default" },
  ];
  return <StatRow stats={stats} />;
}

function LiveDataForRoute({ path }: { path: string }) {
  if (path === "/" || path.startsWith("/dashboard")) return <HomeLive />;
  if (path.startsWith("/accounts")) return <AccountsLive />;
  if (path.startsWith("/deals")) return <DealsLive />;
  if (path.startsWith("/approvals")) return <ApprovalsLive />;
  if (path.startsWith("/signatures")) return <SignaturesLive />;
  if (path.startsWith("/contracts")) return <ContractsLive />;
  if (path.startsWith("/quotes")) return <QuotesLive />;
  if (path.startsWith("/negotiations")) return <NegotiationsLive />;
  return null;
}

export function PageHelpDrawer() {
  const [location] = useLocation();
  const { isHelpOpen, closeHelp, resetOnboarding } = useOnboarding();
  const entry = getHelpForRoute(location);
  const currentStep = getCurrentWorkflowStep(location);

  if (!entry) return null;
  const Icon = entry.icon;
  const live = isHelpOpen ? <LiveDataForRoute path={location} /> : null;

  return (
    <Sheet open={isHelpOpen} onOpenChange={(o) => { if (!o) closeHelp(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto" data-testid="page-help-drawer">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <SheetTitle>{entry.title}</SheetTitle>
              <SheetDescription>
                {currentStep ? `Schritt im Workflow: ${currentStep.title}` : "Allgemeine Übersicht"}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {live && (
            <section data-testid="page-help-live">
              <div className="flex items-center gap-2 text-sm font-semibold mb-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Aus deinen Daten
              </div>
              {live}
            </section>
          )}

          <section>
            <div className="flex items-center gap-2 text-sm font-semibold mb-2">
              <Compass className="h-4 w-4 text-primary" />
              Wozu dient diese Seite?
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{entry.purpose}</p>
          </section>

          {entry.prerequisites && entry.prerequisites.length > 0 && (
            <section>
              <div className="text-sm font-semibold mb-2">Voraussetzungen</div>
              <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
                {entry.prerequisites.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </section>
          )}

          <section>
            <div className="flex items-center gap-2 text-sm font-semibold mb-2">
              <ListChecks className="h-4 w-4 text-primary" />
              So gehst du vor
            </div>
            <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1.5">
              {entry.howTo.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </section>

          {entry.tip && (
            <section className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-3">
              <div className="flex items-start gap-2">
                <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-sm text-amber-900 dark:text-amber-100">{entry.tip}</div>
              </div>
            </section>
          )}

          {entry.nextSteps && entry.nextSteps.length > 0 && (
            <section>
              <div className="text-sm font-semibold mb-2">Sinnvoll als nächstes</div>
              <div className="flex flex-wrap gap-2">
                {entry.nextSteps.map((n, i) => (
                  <Button key={i} asChild variant="outline" size="sm" onClick={closeHelp}>
                    <Link href={n.to}>
                      {n.label}
                      <ArrowRight className="h-3.5 w-3.5 ml-1" />
                    </Link>
                  </Button>
                ))}
              </div>
            </section>
          )}

          <section>
            <WorkflowMap onNavigate={closeHelp} />
          </section>

          <div className="pt-3 border-t">
            <Button variant="ghost" size="sm" onClick={resetOnboarding} className="text-xs text-muted-foreground">
              Tour zurücksetzen
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

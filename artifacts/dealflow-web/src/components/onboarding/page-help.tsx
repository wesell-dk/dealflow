import { useLocation, Link } from "wouter";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Lightbulb, ArrowRight, ListChecks, Compass } from "lucide-react";
import { useOnboarding } from "@/contexts/onboarding-context";
import { getHelpForRoute, getCurrentWorkflowStep } from "@/lib/help-content";
import { WorkflowMap } from "./workflow-map";

export function PageHelpDrawer() {
  const [location] = useLocation();
  const { isHelpOpen, closeHelp, resetOnboarding } = useOnboarding();
  const entry = getHelpForRoute(location);
  const currentStep = getCurrentWorkflowStep(location);

  if (!entry) return null;
  const Icon = entry.icon;

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

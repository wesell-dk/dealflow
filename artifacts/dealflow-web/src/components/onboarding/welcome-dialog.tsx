import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, BookOpen, Rocket } from "lucide-react";
import { useOnboarding } from "@/contexts/onboarding-context";
import { WorkflowMap } from "./workflow-map";

export function WelcomeDialog() {
  const { isWelcomeOpen, closeWelcome, openHelp } = useOnboarding();

  return (
    <Dialog open={isWelcomeOpen} onOpenChange={(o) => { if (!o) closeWelcome(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" data-testid="welcome-dialog">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-2xl">Willkommen bei DealFlow One</DialogTitle>
              <DialogDescription>
                Deine B2B-Commercial-Execution-Plattform – vom ersten Kundenkontakt bis zur signierten Verlängerung.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2 mt-2">
          <div className="space-y-3 text-sm">
            <p>
              Die Plattform bündelt alle Schritte deines Verkaufs- und Vertragsprozesses in einer zusammenhängenden
              Story – dem <span className="font-semibold text-primary">roten Faden</span>:
            </p>
            <ul className="space-y-2 text-muted-foreground">
              <li className="flex items-start gap-2">
                <Rocket className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <span><span className="font-medium text-foreground">17 Module</span> in der Sidebar – jedes hat eine
                klare Rolle im Gesamtprozess.</span>
              </li>
              <li className="flex items-start gap-2">
                <BookOpen className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <span>Auf jeder Seite findest du oben rechts <span className="font-medium text-foreground">'?'-Hilfe</span>:
                Was kann ich hier? Wie sind die nächsten Schritte?</span>
              </li>
              <li className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <span><span className="font-medium text-foreground">Copilot</span> unterstützt dich pro Domäne mit
                Analysen, Empfehlungen und Vertrags-Reviews.</span>
              </li>
            </ul>
            <p className="text-muted-foreground italic pt-2">
              Tipp: Starte mit <span className="font-semibold not-italic text-foreground">Schritt 1 – Kunde anlegen</span>.
              Alles Weitere baut darauf auf.
            </p>
          </div>

          <WorkflowMap onNavigate={closeWelcome} />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => { openHelp(); closeWelcome(); }} data-testid="welcome-open-help">
            <BookOpen className="h-4 w-4 mr-1.5" />
            Hilfe zur aktuellen Seite
          </Button>
          <Button onClick={closeWelcome} data-testid="welcome-cta-start">
            <Rocket className="h-4 w-4 mr-1.5" />
            Los geht's
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

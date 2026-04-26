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
              <DialogTitle className="text-2xl">Welcome to DealFlow One</DialogTitle>
              <DialogDescription>
                Your B2B commercial execution platform — from first customer contact to signed renewal.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2 mt-2">
          <div className="space-y-3 text-sm">
            <p>
              The platform brings every step of your sales and contracting process together in one coherent
              story — the <span className="font-semibold text-primary">guided workflow</span>:
            </p>
            <ul className="space-y-2 text-muted-foreground">
              <li className="flex items-start gap-2">
                <Rocket className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <span><span className="font-medium text-foreground">17 modules</span> in the sidebar — each plays a
                clear role in the overall process.</span>
              </li>
              <li className="flex items-start gap-2">
                <BookOpen className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <span>On every page you'll find <span className="font-medium text-foreground">'?' Help</span> in the top right:
                what can I do here? What are the next steps?</span>
              </li>
              <li className="flex items-start gap-2">
                <Sparkles className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <span><span className="font-medium text-foreground">Copilot</span> supports you per domain with
                analyses, recommendations and contract reviews.</span>
              </li>
            </ul>
            <p className="text-muted-foreground italic pt-2">
              Tip: start with <span className="font-semibold not-italic text-foreground">Step 1 – Create customer</span>.
              Everything else builds on it.
            </p>
          </div>

          <WorkflowMap mode="inline" onNavigate={closeWelcome} />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => { openHelp(); closeWelcome(); }} data-testid="welcome-open-help">
            <BookOpen className="h-4 w-4 mr-1.5" />
            Help for the current page
          </Button>
          <Button onClick={closeWelcome} data-testid="welcome-cta-start">
            <Rocket className="h-4 w-4 mr-1.5" />
            Let's go
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

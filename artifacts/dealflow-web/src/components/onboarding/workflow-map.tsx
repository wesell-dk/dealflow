import { Link, useLocation } from "wouter";
import { Check, ChevronRight } from "lucide-react";
import { WORKFLOW_STEPS, getCurrentWorkflowStep } from "@/lib/help-content";
import { useOnboarding } from "@/contexts/onboarding-context";

type Props = {
  onNavigate?: () => void;
  variant?: "compact" | "full";
};

export function WorkflowMap({ onNavigate, variant = "full" }: Props) {
  const [location] = useLocation();
  const { completedSteps } = useOnboarding();
  const current = getCurrentWorkflowStep(location);

  return (
    <div className={variant === "full" ? "rounded-lg border bg-card p-4" : ""}>
      <div className="text-sm font-semibold mb-3">Roter Faden – B2B Commercial Workflow</div>
      <ol className="space-y-1">
        {WORKFLOW_STEPS.map((step, idx) => {
          const isCurrent = current?.key === step.key;
          const isDone = completedSteps.includes(step.key);
          const Icon = step.icon;
          return (
            <li key={step.key}>
              <Link
                href={step.route}
                onClick={onNavigate}
                className={`group flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  isCurrent
                    ? "bg-primary/10 text-primary border border-primary/30"
                    : "hover:bg-muted text-foreground"
                }`}
              >
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                    isDone
                      ? "bg-green-500/20 border-green-500 text-green-700"
                      : isCurrent
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-muted border-border text-muted-foreground"
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : idx + 1}
                </div>
                <Icon className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className={`font-medium truncate ${isCurrent ? "text-primary" : ""}`}>{step.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{step.short}</div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
              </Link>
              {idx < WORKFLOW_STEPS.length - 1 && (
                <div className="ml-[18px] h-2 w-px bg-border" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

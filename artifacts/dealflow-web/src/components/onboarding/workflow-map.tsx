import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Check, ChevronRight, ChevronDown, ArrowRight } from "lucide-react";
import { WORKFLOW_STEPS, getCurrentWorkflowStep, HELP_CONTENT } from "@/lib/help-content";
import { useOnboarding } from "@/contexts/onboarding-context";

type Props = {
  onNavigate?: () => void;
  variant?: "compact" | "full";
  /**
   * "navigate": clicking a step navigates immediately (drawer / sidebar use case).
   * "inline":   clicking a step expands an accordion with purpose + howTo, plus an
   *             explicit "Jetzt öffnen" button. Used inside the welcome dialog so
   *             the user can read about steps without losing the modal.
   */
  mode?: "navigate" | "inline";
};

export function WorkflowMap({ onNavigate, variant = "full", mode = "navigate" }: Props) {
  const [location] = useLocation();
  const { completedSteps } = useOnboarding();
  const current = getCurrentWorkflowStep(location);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className={variant === "full" ? "rounded-lg border bg-card p-4" : ""}>
      <div className="text-sm font-semibold mb-3">Workflow guide – B2B commercial flow</div>
      <ol className="space-y-1">
        {WORKFLOW_STEPS.map((step, idx) => {
          const isCurrent = current?.key === step.key;
          const isDone = completedSteps.includes(step.key);
          const isExpanded = expanded === step.key;
          const Icon = step.icon;
          const help = HELP_CONTENT[step.route];

          const Row = (
            <div
              className={`group flex items-center gap-3 rounded-md px-2 py-1.5 text-sm transition-colors ${
                isCurrent
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : isExpanded
                    ? "bg-muted"
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
              <div className="flex-1 min-w-0 text-left">
                <div className={`font-medium truncate ${isCurrent ? "text-primary" : ""}`}>{step.title}</div>
                <div className="text-xs text-muted-foreground truncate">{step.short}</div>
              </div>
              {mode === "inline" ? (
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`}
                />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
              )}
            </div>
          );

          return (
            <li key={step.key}>
              {mode === "inline" ? (
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : step.key)}
                  className="w-full"
                  aria-expanded={isExpanded}
                  data-testid={`workflow-step-${step.key}`}
                >
                  {Row}
                </button>
              ) : (
                <Link
                  href={step.route}
                  onClick={onNavigate}
                  data-testid={`workflow-step-${step.key}`}
                >
                  {Row}
                </Link>
              )}

              {mode === "inline" && isExpanded && help && (
                <div
                  className="ml-9 mt-1 mb-2 rounded-md border bg-muted/40 px-3 py-2 space-y-2 text-xs"
                  data-testid={`workflow-step-${step.key}-detail`}
                >
                  <p className="text-muted-foreground leading-relaxed">{help.purpose}</p>
                  <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
                    {help.howTo.slice(0, 3).map((h, i) => <li key={i}>{h}</li>)}
                  </ol>
                  <div className="pt-1">
                    <Link
                      href={step.route}
                      onClick={onNavigate}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      data-testid={`workflow-step-${step.key}-open`}
                    >
                      Open now <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              )}

              {idx < WORKFLOW_STEPS.length - 1 && !isExpanded && (
                <div className="ml-[18px] h-2 w-px bg-border" aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

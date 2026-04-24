import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EmptyStateCardProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  primaryAction?: { label: string; onClick: () => void; testId?: string };
  secondaryAction?: { label: string; onClick: () => void; testId?: string };
  hint?: ReactNode;
  className?: string;
  testId?: string;
}

export function EmptyStateCard({
  icon: Icon,
  title,
  body,
  primaryAction,
  secondaryAction,
  hint,
  className,
  testId,
}: EmptyStateCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-12 text-center border border-dashed rounded-lg bg-muted/20",
        className,
      )}
      data-testid={testId}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-4">
        <Icon className="h-6 w-6 text-muted-foreground" aria-hidden />
      </div>
      <h2 className="text-xl font-semibold">{title}</h2>
      {body && <p className="text-muted-foreground mt-1 max-w-md">{body}</p>}
      {(primaryAction || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {primaryAction && (
            <Button onClick={primaryAction.onClick} data-testid={primaryAction.testId}>
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction && (
            <Button variant="outline" onClick={secondaryAction.onClick} data-testid={secondaryAction.testId}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
      {hint && <div className="mt-4 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

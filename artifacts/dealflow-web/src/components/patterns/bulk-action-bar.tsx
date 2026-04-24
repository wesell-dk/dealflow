import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  children: ReactNode;
  className?: string;
}

export function BulkActionBar({ count, onClear, children, className }: BulkActionBarProps) {
  if (count === 0) return null;
  return (
    <div
      role="region"
      aria-label="Massen-Aktionen"
      className={cn(
        "fixed bottom-6 left-1/2 -translate-x-1/2 z-40",
        "flex items-center gap-2 rounded-xl border bg-background shadow-lg",
        "px-3 py-2 min-w-[320px] animate-in fade-in slide-in-from-bottom-2",
        className,
      )}
      data-testid="bulk-action-bar"
    >
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={onClear}
        aria-label="Auswahl aufheben"
      >
        <X className="h-4 w-4" />
      </Button>
      <span className="text-sm font-medium tabular-nums">
        {count} ausgewählt
      </span>
      <div className="mx-2 h-5 w-px bg-border" />
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

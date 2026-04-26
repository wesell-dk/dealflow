import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface TableSkeletonProps {
  rows?: number;
  cols?: number;
  className?: string;
  testId?: string;
}

/**
 * Skeleton placeholder shaped like a list table.
 * Uses fixed row heights so the page does not reflow when real rows arrive,
 * which keeps Cumulative Layout Shift (CLS) low.
 */
export function TableSkeleton({
  rows = 8,
  cols = 6,
  className,
  testId = "table-skeleton",
}: TableSkeletonProps) {
  const colWidths = Array.from({ length: cols }, (_, i) => {
    if (i === 0) return "w-[28%]";
    if (i === cols - 1) return "w-[12%]";
    if (i % 2 === 0) return "w-[15%]";
    return "w-[12%]";
  });

  return (
    <div
      className={cn("border rounded-md overflow-hidden", className)}
      data-testid={testId}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="bg-muted/40 border-b px-3 py-2.5 flex items-center gap-3">
        {colWidths.map((w, i) => (
          <Skeleton key={`h-${i}`} className={cn("h-3.5", w)} />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={`r-${r}`} className="px-3 py-3 flex items-center gap-3 h-[52px]">
            {colWidths.map((w, c) => (
              <Skeleton
                key={`c-${r}-${c}`}
                className={cn("h-4", w)}
                style={{ opacity: 0.5 + ((r % 3) * 0.15) }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export interface CardGridSkeletonProps {
  items?: number;
  /** Tailwind columns helper for desktop, e.g. "md:grid-cols-2 lg:grid-cols-3" */
  columnsClass?: string;
  className?: string;
  testId?: string;
}

/**
 * Skeleton placeholder shaped like a responsive grid of cards.
 */
export function CardGridSkeleton({
  items = 6,
  columnsClass = "md:grid-cols-2 lg:grid-cols-3",
  className,
  testId = "card-grid-skeleton",
}: CardGridSkeletonProps) {
  return (
    <div
      className={cn("grid gap-4", columnsClass, className)}
      data-testid={testId}
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={`card-${i}`}
          className="border rounded-md bg-card p-4 flex flex-col gap-3 h-[180px]"
        >
          <div className="flex items-start justify-between gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-3/4" />
          <div className="mt-auto flex items-center gap-2">
            <Skeleton className="h-5 w-14 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface DetailSkeletonProps {
  /** Number of secondary content blocks to render */
  blocks?: number;
  /** Show a sidebar column on the right (md+) */
  withSidebar?: boolean;
  className?: string;
  testId?: string;
}

/**
 * Skeleton for a record detail page: header band, primary content blocks,
 * and an optional right-hand sidebar.
 */
export function DetailSkeleton({
  blocks = 3,
  withSidebar = true,
  className,
  testId = "detail-skeleton",
}: DetailSkeletonProps) {
  return (
    <div
      className={cn("flex flex-col gap-6", className)}
      data-testid={testId}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col gap-3 border-b pb-4">
        <div className="flex items-start gap-3">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-3.5 w-1/2" />
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>

      <div className={cn("grid gap-6", withSidebar && "lg:grid-cols-3")}>
        <div className={cn("flex flex-col gap-4", withSidebar && "lg:col-span-2")}>
          {Array.from({ length: blocks }).map((_, i) => (
            <div
              key={`block-${i}`}
              className="border rounded-md bg-card p-5 space-y-3 min-h-[160px]"
            >
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-9/12" />
            </div>
          ))}
        </div>

        {withSidebar && (
          <div className="flex flex-col gap-4">
            <div className="border rounded-md bg-card p-5 space-y-3 min-h-[160px]">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <div className="border rounded-md bg-card p-5 space-y-3 min-h-[120px]">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/4" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

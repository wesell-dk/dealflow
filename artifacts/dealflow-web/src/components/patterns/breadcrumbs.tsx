import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
  testId?: string;
}

export function Breadcrumbs({ items, className, testId }: BreadcrumbsProps) {
  if (!items || items.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      data-testid={testId ?? "breadcrumbs"}
      className={cn(
        "flex items-center gap-1.5 text-sm text-muted-foreground",
        className,
      )}
    >
      {items.map((bc, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${bc.label}-${i}`} className="inline-flex items-center gap-1.5 min-w-0">
            {bc.href && !last ? (
              <Link
                href={bc.href}
                className="truncate transition-colors hover:text-foreground"
              >
                {bc.label}
              </Link>
            ) : (
              <span
                className={cn("truncate", last && "text-foreground")}
                aria-current={last ? "page" : undefined}
              >
                {bc.label}
              </span>
            )}
            {!last && <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />}
          </span>
        );
      })}
    </nav>
  );
}

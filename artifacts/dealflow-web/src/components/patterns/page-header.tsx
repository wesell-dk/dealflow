import type { ReactNode } from "react";
import { Link } from "wouter";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageHeaderBreadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  description?: ReactNode;
  breadcrumbs?: PageHeaderBreadcrumb[];
  icon?: LucideIcon;
  badge?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
  testId?: string;
}

export function PageHeader({
  title,
  subtitle,
  description,
  breadcrumbs,
  icon: Icon,
  badge,
  actions,
  meta,
  className,
  testId,
}: PageHeaderProps) {
  return (
    <div
      className={cn("flex flex-col gap-3 border-b pb-4 mb-6", className)}
      data-testid={testId}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {breadcrumbs.map((bc, i) => {
            const last = i === breadcrumbs.length - 1;
            return (
              <span key={`${bc.label}-${i}`} className="inline-flex items-center gap-1.5">
                {bc.href && !last ? (
                  <Link
                    href={bc.href}
                    className="transition-colors hover:text-foreground"
                  >
                    {bc.label}
                  </Link>
                ) : (
                  <span
                    className={cn(last && "text-foreground")}
                    aria-current={last ? "page" : undefined}
                  >
                    {bc.label}
                  </span>
                )}
                {!last && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
              </span>
            );
          })}
        </nav>
      )}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight truncate">{title}</h1>
              {badge}
            </div>
            {subtitle && (
              <div className="text-sm text-muted-foreground mt-0.5">{subtitle}</div>
            )}
            {description && (
              <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                {description}
              </p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:shrink-0 [&>button]:w-full sm:[&>button]:w-auto">
            {actions}
          </div>
        )}
      </div>
      {meta && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {meta}
        </div>
      )}
    </div>
  );
}

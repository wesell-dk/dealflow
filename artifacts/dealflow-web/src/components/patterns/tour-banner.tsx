import { useEffect, useState } from "react";
import { Compass, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "dealflow.tourBanner.dismissed.v1";

interface TourBannerProps {
  title?: string;
  body?: string;
  ctaLabel?: string;
  onStartTour?: () => void;
  className?: string;
}

export function TourBanner({
  title = "Willkommen bei DealFlow.One",
  body = "B2B Commercial Execution — Accounts, Deals, Verträge & Approvals an einem Ort. In 90 Sekunden orientiert.",
  ctaLabel = "Tour starten",
  onStartTour,
  className,
}: TourBannerProps) {
  const [dismissed, setDismissed] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setDismissed(window.localStorage.getItem(KEY) === "1");
  }, []);

  function dismiss() {
    setDismissed(true);
    try { window.localStorage.setItem(KEY, "1"); } catch { /* ignore */ }
  }

  if (dismissed) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
            setDismissed(false);
          }}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          data-testid="tour-banner-restart"
        >
          <Compass className="h-3 w-3" /> Tour erneut anzeigen
        </button>
      </div>
    );
  }

  return (
    <div
      className={
        "relative rounded-lg border bg-gradient-to-r from-blue-50 via-indigo-50 to-violet-50 dark:from-blue-950/40 dark:via-indigo-950/40 dark:to-violet-950/40 p-4 pr-12 " +
        (className ?? "")
      }
      role="region"
      aria-label="Onboarding-Banner"
      data-testid="tour-banner"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background shadow-sm">
          <Sparkles className="h-4 w-4 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onStartTour && (
              <Button size="sm" className="h-7 text-xs gap-1" onClick={onStartTour} data-testid="tour-banner-start">
                <Compass className="h-3.5 w-3.5" /> {ctaLabel}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={dismiss}
              data-testid="tour-banner-dismiss"
            >
              Verstanden
            </Button>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Banner schließen"
        className="absolute right-3 top-3 rounded p-1 hover:bg-background/60"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

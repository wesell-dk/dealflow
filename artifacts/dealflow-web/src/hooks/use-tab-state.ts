import { useCallback } from "react";
import { useLocation, useSearch } from "wouter";

export function useTabState(defaultTab: string): readonly [string, (next: string) => void] {
  const search = useSearch();
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const tab = params.get("tab") ?? defaultTab;

  const setTab = useCallback(
    (next: string) => {
      const p = new URLSearchParams(search);
      if (next === defaultTab) p.delete("tab");
      else p.set("tab", next);
      const qs = p.toString();
      setLocation(qs ? `${location}?${qs}` : location);
    },
    [search, location, setLocation, defaultTab],
  );

  return [tab, setTab] as const;
}

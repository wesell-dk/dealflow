import { useEffect, useState, useCallback } from "react";

export type RecentKind = "account" | "deal" | "contract" | "quote" | "negotiation";

export interface RecentItem {
  kind: RecentKind;
  id: string;
  label: string;
  href: string;
  visitedAt: number;
}

const KEY = "dealflow.recents.v1";
const MAX = 12;

function read(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as RecentItem[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(items: RecentItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
    window.dispatchEvent(new CustomEvent("dealflow.recents.changed"));
  } catch {
    /* quota exceeded */
  }
}

export function useRecents(): RecentItem[] {
  const [items, setItems] = useState<RecentItem[]>(() => read());
  useEffect(() => {
    const handler = () => setItems(read());
    window.addEventListener("dealflow.recents.changed", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("dealflow.recents.changed", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return items;
}

export function pushRecent(item: Omit<RecentItem, "visitedAt">) {
  const current = read();
  const filtered = current.filter((i) => !(i.kind === item.kind && i.id === item.id));
  const next: RecentItem[] = [{ ...item, visitedAt: Date.now() }, ...filtered].slice(0, MAX);
  write(next);
}

export function useTrackRecent(item: Omit<RecentItem, "visitedAt"> | null) {
  const stable = item ? `${item.kind}|${item.id}|${item.label}|${item.href}` : "";
  useEffect(() => {
    if (!item) return;
    pushRecent(item);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stable]);
}

export function clearRecents() {
  write([]);
}

export function useRemoveRecent() {
  return useCallback((kind: RecentKind, id: string) => {
    write(read().filter((i) => !(i.kind === kind && i.id === id)));
  }, []);
}

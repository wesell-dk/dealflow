import { useState, useEffect } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";

export interface ColumnDef {
  key: string;
  label: string;
  required?: boolean;
}

export function useColumnVisibility(storageKey: string, defs: ColumnDef[]): {
  visible: Set<string>;
  toggle: (k: string) => void;
  reset: () => void;
  setAll: (keys: string[]) => void;
} {
  const all = defs.map((d) => d.key);
  const [visible, setVisible] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set(all);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return new Set(all);
      const arr = JSON.parse(raw) as string[];
      const valid = new Set(arr.filter((k) => all.includes(k)));
      defs.forEach((d) => { if (d.required) valid.add(d.key); });
      return valid;
    } catch {
      return new Set(all);
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...visible]));
    } catch { /* ignore */ }
  }, [storageKey, visible]);

  return {
    visible,
    toggle: (k) => {
      const def = defs.find((d) => d.key === k);
      if (def?.required) return;
      setVisible((prev) => {
        const next = new Set(prev);
        if (next.has(k)) next.delete(k); else next.add(k);
        return next;
      });
    },
    reset: () => setVisible(new Set(all)),
    setAll: (keys: string[]) => {
      const next = new Set(keys.filter((k) => all.includes(k)));
      defs.forEach((d) => { if (d.required) next.add(d.key); });
      setVisible(next);
    },
  };
}

export function ColumnChooser({
  defs,
  visible,
  onToggle,
  onReset,
}: {
  defs: ColumnDef[];
  visible: Set<string>;
  onToggle: (k: string) => void;
  onReset: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5" data-testid="column-chooser">
          <Settings2 className="h-3.5 w-3.5" />
          <span className="text-xs">Spalten</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-0">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          Sichtbare Spalten
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          {defs.map((d) => {
            const checked = visible.has(d.key);
            return (
              <label
                key={d.key}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-muted cursor-pointer text-sm"
              >
                <Checkbox
                  checked={checked}
                  disabled={d.required}
                  onCheckedChange={() => onToggle(d.key)}
                />
                <span className={d.required ? "text-muted-foreground" : ""}>{d.label}</span>
                {d.required && <span className="ml-auto text-[10px] text-muted-foreground">Pflicht</span>}
              </label>
            );
          })}
        </div>
        <div className="border-t p-1">
          <Button variant="ghost" size="sm" className="w-full justify-start text-xs h-7" onClick={onReset}>
            Standard wiederherstellen
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

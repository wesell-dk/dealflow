import { useState, type ReactNode } from "react";
import { Check, ChevronDown, X, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface FilterChipOption {
  value: string;
  label: string;
}

export interface FilterChipProps<T extends string = string> {
  label: string;
  value: T | null | undefined;
  options: FilterChipOption[];
  onChange: (next: T | null) => void;
  searchable?: boolean;
  testId?: string;
}

export function FilterChip<T extends string = string>({
  label,
  value,
  options,
  onChange,
  searchable,
  testId,
}: FilterChipProps<T>) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const active = value !== null && value !== undefined && value !== "";
  const activeOpt = active ? options.find((o) => o.value === value) : undefined;
  const filtered = searchable && q
    ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase()))
    : options;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "default" : "outline"}
          size="sm"
          className={cn("h-8 gap-1.5 rounded-full", active && "pr-1")}
          data-testid={testId}
        >
          <span className="text-xs font-medium">
            {label}{active ? `: ${activeOpt?.label ?? value}` : ""}
          </span>
          {active ? (
            <span
              role="button"
              aria-label={`${label} zurücksetzen`}
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); e.preventDefault(); onChange(null); }
              }}
              className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-background/20"
            >
              <X className="h-3 w-3" />
            </span>
          ) : (
            <ChevronDown className="h-3 w-3 opacity-60" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        {searchable && (
          <div className="border-b p-2">
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Suchen…"
              className="h-8"
            />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-muted-foreground">Keine Treffer</div>
          ) : filtered.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value as T); setOpen(false); setQ(""); }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-muted text-left"
            >
              <span className="truncate">{o.label}</span>
              {value === o.value && <Check className="h-4 w-4" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function FilterChipsRow({
  children,
  onClearAll,
  hasActive,
  extra,
}: {
  children: ReactNode;
  onClearAll?: () => void;
  hasActive?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="h-4 w-4 text-muted-foreground" aria-hidden />
      {children}
      {extra}
      {hasActive && onClearAll && (
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onClearAll}>
          Alle Filter löschen
        </Button>
      )}
    </div>
  );
}

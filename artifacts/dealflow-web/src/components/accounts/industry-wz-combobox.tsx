import { useMemo, useState } from "react";
import { useListWzCodes, getListWzCodesQueryKey } from "@workspace/api-client-react";

// Reine Referenzdaten — einmal laden, dauerhaft cachen.
const WZ_QUERY_OPTIONS = {
  query: {
    queryKey: getListWzCodesQueryKey(),
    staleTime: Infinity,
    gcTime: Infinity,
  },
} as const;
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

type Props = {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
  testId?: string;
};

// Such-Combobox für WZ-2008 Branchencodes. Daten werden einmalig vom Server
// geholt und im React-Query-Cache gehalten — die Liste ist statisch, also
// staleTime quasi unbegrenzt. Nutzer können nach Code oder Bezeichnung
// suchen; Sektionsbuchstabe wird als Gruppenheader genutzt.
export function IndustryWzCombobox({ value, onChange, disabled, placeholder, testId }: Props) {
  const { data, isLoading } = useListWzCodes(WZ_QUERY_OPTIONS);
  const [open, setOpen] = useState(false);

  const grouped = useMemo(() => {
    if (!data) return [];
    const bySection = new Map<string, { sectionLabel: string; items: typeof data.codes }>();
    for (const c of data.codes) {
      const cur = bySection.get(c.section);
      if (cur) {
        cur.items.push(c);
      } else {
        bySection.set(c.section, { sectionLabel: c.sectionLabel, items: [c] });
      }
    }
    return Array.from(bySection.entries()).map(([section, v]) => ({ section, ...v }));
  }, [data]);

  const selected = data?.codes.find((c) => c.code === value) ?? null;
  const display = selected
    ? `${selected.code} · ${selected.label}`
    : (placeholder ?? "Branche wählen…");

  return (
    <Popover open={open} onOpenChange={(o) => { if (!disabled) setOpen(o); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground")}
          disabled={disabled || isLoading}
          data-testid={testId}
        >
          <span className="truncate text-left">
            {isLoading ? (
              <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Lade…</span>
            ) : display}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] min-w-[360px] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandInput placeholder="Suchen (Code oder Bezeichnung)…" />
          <CommandList className="max-h-72">
            <CommandEmpty>Keine Branche gefunden.</CommandEmpty>
            {grouped.map((g) => (
              <CommandGroup key={g.section} heading={`${g.section} — ${g.sectionLabel}`}>
                {g.items.map((c) => (
                  <CommandItem
                    key={c.code}
                    value={`${c.code} ${c.label}`}
                    onSelect={() => {
                      onChange(c.code);
                      setOpen(false);
                    }}
                    data-testid={`wz-option-${c.code}`}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === c.code ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="flex flex-col">
                      <span className="text-sm">
                        <span className="font-mono text-xs text-muted-foreground mr-2">{c.code}</span>
                        {c.label}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Hilfs-Hook für Display-Labels — z.B. in Listen / Filterchips.
export function useWzLabel(code: string | null | undefined): string {
  const { data } = useListWzCodes(WZ_QUERY_OPTIONS);
  if (!code || !data) return code ?? "";
  const hit = data.codes.find((c) => c.code === code);
  return hit ? `${hit.code} · ${hit.label}` : code;
}

type InlineProps = {
  value: string;
  onSubmit: (code: string) => void | Promise<void>;
  testId?: string;
  ariaLabel?: string;
};

// Kleiner Inline-Editor für die Branche in Tabellen/Detailseiten —
// zeigt das WZ-Label und öffnet beim Klick die Such-Combobox.
export function IndustryWzInline({ value, onSubmit, testId, ariaLabel }: InlineProps) {
  const [open, setOpen] = useState(false);
  const { data } = useListWzCodes(WZ_QUERY_OPTIONS);
  const hit = data?.codes.find((c) => c.code === value) ?? null;
  const label = hit ? `${hit.code} · ${hit.label}` : (value || "—");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel ?? "Branche bearbeiten"}
          className={cn(
            "inline-flex items-center text-left rounded px-1 py-0.5 -mx-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            !value && "text-muted-foreground italic",
          )}
          data-testid={testId}
        >
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[420px]" align="start" onOpenAutoFocus={(e) => e.preventDefault()}>
        <Command>
          <CommandInput placeholder="Branche suchen…" />
          <CommandList className="max-h-72">
            <CommandEmpty>Keine Branche gefunden.</CommandEmpty>
            {data?.codes && (
              <CommandGroup>
                {data.codes.map((c) => (
                  <CommandItem
                    key={c.code}
                    value={`${c.code} ${c.label} ${c.section} ${c.sectionLabel}`}
                    onSelect={async () => {
                      setOpen(false);
                      if (c.code !== value) await onSubmit(c.code);
                    }}
                    data-testid={`wz-option-${c.code}`}
                  >
                    <Check className={cn("mr-2 h-4 w-4", value === c.code ? "opacity-100" : "opacity-0")} />
                    <span className="text-sm">
                      <span className="font-mono text-xs text-muted-foreground mr-2">{c.code}</span>
                      {c.label}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

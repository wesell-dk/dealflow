import { useState, useRef, useEffect, type ReactNode, type KeyboardEvent } from "react";
import { Check, Pencil, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FieldKind = "text" | "number" | "currency" | "date" | "select";

export interface InlineEditOption {
  value: string;
  label: string;
}

export interface InlineEditFieldProps {
  value: string | number | null | undefined;
  kind?: FieldKind;
  options?: InlineEditOption[];
  display?: ReactNode;
  placeholder?: string;
  ariaLabel: string;
  testId?: string;
  emptyText?: string;
  className?: string;
  disabled?: boolean;
  onSubmit: (next: string) => Promise<unknown> | unknown;
}

export function InlineEditField({
  value,
  kind = "text",
  options,
  display,
  placeholder,
  ariaLabel,
  testId,
  emptyText = "—",
  className,
  disabled,
  onSubmit,
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Tracks when a select-kind commit was just initiated, so the subsequent
  // dropdown-close (onOpenChange=false) does NOT cancel/revert the value.
  const committingRef = useRef(false);

  useEffect(() => {
    if (editing) return;
    setDraft(value == null ? "" : String(value));
  }, [value, editing]);

  const stop = () => {
    setEditing(false);
    setError(null);
    setDraft(value == null ? "" : String(value));
  };

  const commit = async (override?: string) => {
    const next = override ?? draft;
    if (next === (value == null ? "" : String(value))) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit(next);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      stop();
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setEditing(true)}
        aria-label={`Edit ${ariaLabel}`}
        data-testid={testId}
        className={cn(
          "group inline-flex items-center gap-2 rounded px-1 py-0.5 -mx-1 text-left",
          "hover:bg-muted/60 focus:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring/40",
          disabled && "cursor-default opacity-70 hover:bg-transparent",
          className,
        )}
      >
        <span className={cn("min-w-[1ch]", (value == null || value === "") && "text-muted-foreground italic")}>
          {display ?? (value == null || value === "" ? emptyText : String(value))}
        </span>
        {!disabled && (
          <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 group-focus:opacity-60 transition-opacity" />
        )}
      </button>
    );
  }

  return (
    <div ref={wrapRef} className={cn("inline-flex items-center gap-1", className)}>
      {kind === "select" ? (
        <Select
          value={draft}
          onValueChange={(v) => {
            setDraft(v);
            committingRef.current = true;
            void commit(v);
          }}
          open
          onOpenChange={(o) => {
            if (o) return;
            // If a selection just triggered commit(v), don't cancel/revert here.
            if (committingRef.current) {
              committingRef.current = false;
              return;
            }
            // Closed without selection (outside-click / Escape) → cancel.
            stop();
          }}
        >
          <SelectTrigger className="h-8 min-w-[160px]" aria-label={ariaLabel}>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options?.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit()}
          onKeyDown={onKey}
          aria-label={ariaLabel}
          placeholder={placeholder}
          type={kind === "number" || kind === "currency" ? "number" : kind === "date" ? "date" : "text"}
          step={kind === "currency" ? "0.01" : undefined}
          className="h-8 min-w-[120px]"
          data-testid={testId ? `${testId}-input` : undefined}
        />
      )}
      {saving ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onMouseDown={(e) => { e.preventDefault(); void commit(); }}
            aria-label="Save"
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onMouseDown={(e) => { e.preventDefault(); stop(); }}
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
      {error && <span className="text-xs text-destructive ml-2">{error}</span>}
    </div>
  );
}

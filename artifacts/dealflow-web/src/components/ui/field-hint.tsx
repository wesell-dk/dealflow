import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { getEntry, type GlossaryGroupKey, type GlossaryEntry } from "@/lib/glossary";

type FieldHintProps =
  | {
      term: { group: GlossaryGroupKey; value: string };
      title?: string;
      text?: never;
      className?: string;
      label?: string;
    }
  | {
      term?: never;
      title: string;
      text: string;
      className?: string;
      label?: string;
    };

export function FieldHint(props: FieldHintProps) {
  const { className, label } = props;
  let title: string;
  let body: string;

  if ("term" in props && props.term) {
    const entry: GlossaryEntry | null = getEntry(props.term.group, props.term.value);
    title = props.title ?? entry?.label ?? props.term.value;
    body = entry?.long ?? entry?.short ?? "Keine Beschreibung verfügbar.";
  } else {
    title = props.title;
    body = props.text;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ?? `Erklärung zu ${title}`}
          className={cn(
            "inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
          data-testid={`field-hint-${title.toLowerCase().replace(/\s+/g, "-")}`}
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm" align="start" side="top">
        <p className="font-medium">{title}</p>
        <p className="mt-1 leading-relaxed text-muted-foreground">{body}</p>
      </PopoverContent>
    </Popover>
  );
}

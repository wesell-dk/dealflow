import { useState } from "react";
import {
  useGetLegalSourceForUser,
  useGetLegalPrecedentForUser,
  type LegalSource,
  type LegalPrecedent,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Loader2, ExternalLink } from "lucide-react";

export interface RelatedSourceItem {
  kind: "norm" | "precedent";
  id: string;
  ref: string;
  note?: string;
}

/**
 * Render-Block für KI-zitierte Quellen aus der juristischen Wissensbasis
 * (Task #227). Wird von Drafting/Risk/Redline-Antworten genutzt. Klick auf
 * eine Quelle öffnet ein Side-Sheet mit dem Original-Text (Norm-Volltext
 * bzw. Präzedenz-Snippet inkl. Counterparty/Outcome). Damit ist die
 * Quellenangabe nicht nur sichtbar, sondern nachvollziehbar.
 */
export function RelatedSourcesBlock({
  sources,
  testIdPrefix = "ai-related-source",
}: {
  sources: ReadonlyArray<RelatedSourceItem>;
  testIdPrefix?: string;
}) {
  const [open, setOpen] = useState<RelatedSourceItem | null>(null);

  if (!sources || sources.length === 0) return null;

  return (
    <div data-testid="ai-related-sources">
      <div className="text-xs font-medium mb-1">Relevante Quellen</div>
      <ul className="text-xs text-muted-foreground list-none pl-0 space-y-0.5">
        {sources.map((s, i) => (
          <li key={`${s.id}-${i}`} data-testid={`${testIdPrefix}-${s.id}`}>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-left hover:underline focus:underline focus:outline-none rounded px-0.5 -mx-0.5"
              onClick={() => setOpen(s)}
              data-testid={`${testIdPrefix}-open-${s.id}`}
              aria-label={`${s.ref} öffnen`}
            >
              <Badge
                variant="outline"
                className="text-[10px]"
                data-testid={`${testIdPrefix}-kind-${s.kind}`}
              >
                {s.kind === "norm" ? "Norm" : "Präzedenz"}
              </Badge>
              <span className="font-medium text-foreground">{s.ref}</span>
              {s.note ? <span> — <em>{s.note}</em></span> : null}
              <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <SourceDetailSheet
        item={open}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

function SourceDetailSheet({
  item,
  onClose,
}: {
  item: RelatedSourceItem | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!item} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="sm:max-w-xl w-full overflow-y-auto" data-testid="legal-source-sheet">
        {item ? (
          item.kind === "norm" ? (
            <NormDetail id={item.id} fallbackRef={item.ref} note={item.note} />
          ) : (
            <PrecedentDetail id={item.id} fallbackRef={item.ref} note={item.note} />
          )
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function NormDetail({ id, fallbackRef, note }: { id: string; fallbackRef: string; note?: string }) {
  const q = useGetLegalSourceForUser(id, {
    query: { enabled: !!id, queryKey: ["legal-source", id] },
  });
  return (
    <>
      <SheetHeader>
        <SheetTitle data-testid="legal-source-sheet-title">{q.data?.normRef ?? fallbackRef}</SheetTitle>
        <SheetDescription>
          {q.data ? `${q.data.title} — ${q.data.jurisdiction} · ${q.data.areaOfLaw}` : "Norm aus der Wissensbasis"}
        </SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-sm">
        {note ? (
          <p className="italic text-muted-foreground" data-testid="legal-source-sheet-note">
            KI-Hinweis: {note}
          </p>
        ) : null}
        {q.isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Originaltext …
          </div>
        )}
        {q.error && (
          <p className="text-destructive">Quelle konnte nicht geladen werden.</p>
        )}
        {q.data && (
          <>
            {q.data.summary && (
              <div>
                <div className="text-xs font-medium mb-1">Kurzfassung</div>
                <p className="text-muted-foreground">{q.data.summary}</p>
              </div>
            )}
            <div>
              <div className="text-xs font-medium mb-1">Volltext</div>
              <pre
                className="whitespace-pre-wrap font-sans text-foreground bg-muted rounded p-3"
                data-testid="legal-source-sheet-fulltext"
              >{q.data.fullText}</pre>
            </div>
            <SourceMeta source={q.data} />
          </>
        )}
      </div>
    </>
  );
}

function PrecedentDetail({ id, fallbackRef, note }: { id: string; fallbackRef: string; note?: string }) {
  const q = useGetLegalPrecedentForUser(id, {
    query: { enabled: !!id, queryKey: ["legal-precedent", id] },
  });
  return (
    <>
      <SheetHeader>
        <SheetTitle data-testid="legal-precedent-sheet-title">
          {q.data ? `${q.data.family} — ${q.data.counterpartyName ?? "intern"}` : fallbackRef}
        </SheetTitle>
        <SheetDescription>
          Interner Präzedenzfall aus der Vertragshistorie
        </SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-3 text-sm">
        {note ? (
          <p className="italic text-muted-foreground" data-testid="legal-precedent-sheet-note">
            KI-Hinweis: {note}
          </p>
        ) : null}
        {q.isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lade Präzedenzfall …
          </div>
        )}
        {q.error && (
          <p className="text-destructive">Präzedenzfall konnte nicht geladen werden.</p>
        )}
        {q.data && (
          <>
            <PrecedentMeta precedent={q.data} />
            <div>
              <div className="text-xs font-medium mb-1">Klausel-Snippet (signiert)</div>
              <pre
                className="whitespace-pre-wrap font-sans text-foreground bg-muted rounded p-3"
                data-testid="legal-precedent-sheet-snippet"
              >{q.data.snippet}</pre>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function SourceMeta({ source }: { source: LegalSource }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-2 border-t">
      <Badge variant="outline" className="text-[10px]">{source.hierarchy}</Badge>
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[10px] text-primary hover:underline"
          data-testid="legal-source-sheet-url"
        >
          Externe Quelle ↗
        </a>
      ) : null}
    </div>
  );
}

function PrecedentMeta({ precedent }: { precedent: LegalPrecedent }) {
  const items: Array<[string, string | null | undefined]> = [
    ["Klausel-Familie", precedent.family],
    ["Outcome", precedent.negotiationOutcome],
    ["Gegenpartei", precedent.counterpartyName],
    ["Branche", precedent.industry],
    ["Signiert", precedent.signedAt],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {items
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => (
          <div key={k}>
            <span className="text-muted-foreground">{k}: </span>
            <span className="font-medium">{v}</span>
          </div>
        ))}
    </div>
  );
}

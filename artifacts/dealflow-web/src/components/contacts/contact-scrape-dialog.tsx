import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useScrapeContactsFromWebsite,
  useCreateContact,
  getGetAccountQueryKey,
  getListContactsQueryKey,
  type ScrapedContact,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Sparkles, Globe, Mail, Phone, AlertCircle } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  defaultWebsite?: string | null;
};

export function ContactScrapeDialog({ open, onOpenChange, accountId, defaultWebsite }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const scrape = useScrapeContactsFromWebsite();
  const create = useCreateContact();

  const [website, setWebsite] = useState("");
  const [results, setResults] = useState<ScrapedContact[] | null>(null);
  const [pagesCrawled, setPagesCrawled] = useState(0);
  const [selected, setSelected] = useState<Record<number, boolean>>({});
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWebsite(defaultWebsite ?? "");
    setResults(null);
    setPagesCrawled(0);
    setSelected({});
  }, [open, defaultWebsite]);

  const runScrape = async () => {
    const w = website.trim();
    if (!w) {
      toast({ title: "Website fehlt", description: "Bitte eine URL oder Domain eintragen.", variant: "destructive" });
      return;
    }
    try {
      const res = await scrape.mutateAsync({ id: accountId, data: { website: w } });
      setResults(res.results);
      setPagesCrawled(res.pagesCrawled);
      // Vorbelegung: alle nicht-doppelten standardmäßig anhaken.
      const next: Record<number, boolean> = {};
      res.results.forEach((c, i) => { next[i] = !c.isDuplicate; });
      setSelected(next);
      if (res.results.length === 0) {
        toast({
          title: "Keine Personen gefunden",
          description: pagesCrawledMessage(res.pagesCrawled),
        });
      } else {
        toast({
          title: `${res.results.length} Vorschläge geladen`,
          description: pagesCrawledMessage(res.pagesCrawled),
        });
      }
    } catch (err) {
      toast({
        title: "Suche fehlgeschlagen",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    }
  };

  const selectedCount = useMemo(
    () => Object.values(selected).filter(Boolean).length,
    [selected],
  );

  const importSelected = async () => {
    if (!results || selectedCount === 0) return;
    setImporting(true);
    let ok = 0;
    let failed = 0;
    try {
      for (let i = 0; i < results.length; i++) {
        if (!selected[i]) continue;
        const c = results[i]!;
        try {
          await create.mutateAsync({
            id: accountId,
            data: {
              name: c.name,
              role: c.role,
              email: c.email ?? null,
              phone: c.phone ?? null,
              isDecisionMaker: c.isDecisionMaker,
            },
          });
          ok += 1;
        } catch {
          failed += 1;
        }
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetAccountQueryKey(accountId) }),
        qc.invalidateQueries({ queryKey: getListContactsQueryKey({ accountId }) }),
      ]);
      if (failed === 0) {
        toast({ title: `${ok} Kontakte übernommen` });
        onOpenChange(false);
      } else {
        toast({
          title: `${ok} übernommen, ${failed} fehlgeschlagen`,
          variant: failed > 0 ? "destructive" : "default",
        });
      }
    } finally {
      setImporting(false);
    }
  };

  const pending = scrape.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending && !importing) onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col" data-testid="contact-scrape-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Kontakte aus Website vorschlagen
          </DialogTitle>
          <DialogDescription>
            Wir durchsuchen Impressum, Team-, Kontakt- und About-Seiten nach
            Ansprechpartnern. Geschäftsführer/CEO/Vorstand werden zuverlässig
            erkannt; weitere Rollen sind Best-Effort.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="scrape-url">Website</Label>
          <div className="flex gap-2">
            <Input
              id="scrape-url"
              data-testid="contact-scrape-url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="z.B. https://acme.de"
              disabled={pending || importing}
            />
            <Button
              type="button"
              onClick={runScrape}
              disabled={pending || importing || !website.trim()}
              data-testid="contact-scrape-search"
            >
              {pending
                ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                : <Sparkles className="h-4 w-4 mr-1" />}
              Suchen
            </Button>
          </div>
        </div>

        {results !== null && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-2">
            <Globe className="h-3 w-3" />
            {pagesCrawledMessage(pagesCrawled)} · {results.length} Personen gefunden
          </div>
        )}

        {results !== null && results.length > 0 && (
          <ScrollArea className="flex-1 -mx-1 mt-2 pr-2 max-h-[50vh]">
            <div className="space-y-2 px-1" data-testid="contact-scrape-results">
              {results.map((c, idx) => (
                <label
                  key={`${c.name}-${c.email ?? "noemail"}-${idx}`}
                  className={
                    "flex items-start gap-3 p-3 border rounded-md cursor-pointer transition-colors " +
                    (c.isDuplicate ? "bg-muted/40 border-dashed" : "hover:bg-muted/30")
                  }
                >
                  <Checkbox
                    checked={Boolean(selected[idx])}
                    onCheckedChange={(v) => setSelected((s) => ({ ...s, [idx]: Boolean(v) }))}
                    disabled={importing}
                    data-testid={`contact-scrape-pick-${idx}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {c.role && <span className="text-sm text-muted-foreground">· {c.role}</span>}
                      {c.isDecisionMaker && <Badge variant="secondary">Entscheider</Badge>}
                      {c.isDuplicate && (
                        <Badge variant="outline" className="text-amber-700 border-amber-400">
                          <AlertCircle className="h-3 w-3 mr-1" /> Bereits vorhanden
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                      {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {c.email}</span>}
                      {c.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone}</span>}
                      {c.sourceUrl && <span className="italic truncate max-w-[260px]" title={c.sourceUrl}>Quelle: {c.sourceUrl}</span>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </ScrollArea>
        )}

        {results !== null && results.length === 0 && (
          <div className="text-center text-sm text-muted-foreground py-6">
            Keine Personen erkannt. Versuche eine spezifischere URL (z.B. /team oder /impressum).
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending || importing}>
            Schließen
          </Button>
          <Button
            type="button"
            onClick={importSelected}
            disabled={importing || pending || !results || selectedCount === 0}
            data-testid="contact-scrape-import"
          >
            {importing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {selectedCount > 0 ? `${selectedCount} übernehmen` : "Übernehmen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function pagesCrawledMessage(n: number): string {
  if (n === 0) return "Keine Seite konnte abgerufen werden.";
  if (n === 1) return "1 Seite durchsucht.";
  return `${n} Seiten durchsucht.`;
}

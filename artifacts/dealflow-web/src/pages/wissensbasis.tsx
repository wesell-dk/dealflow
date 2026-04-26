import { useMemo, useState } from "react";
import {
  useSearchLegalKnowledgeForUser,
  type LegalKnowledgeNormHit,
  type LegalKnowledgePrecedentHit,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Scale, Search } from "lucide-react";
import {
  RelatedSourcesBlock,
  type RelatedSourceItem,
} from "@/components/copilot/related-sources-block";

const AREAS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Alle Rechtsgebiete" },
  { value: "contract", label: "Vertragsrecht" },
  { value: "data_protection", label: "Datenschutz" },
  { value: "competition", label: "Wettbewerb" },
  { value: "commercial", label: "Handelsrecht" },
  { value: "it", label: "IT-Recht" },
  { value: "labor", label: "Arbeitsrecht" },
  { value: "tax", label: "Steuern" },
  { value: "other", label: "Sonstiges" },
];

const JURISDICTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "Alle Jurisdiktionen" },
  { value: "DE", label: "Deutschland (DE)" },
  { value: "EU", label: "Europäische Union (EU)" },
];

/**
 * Nutzer-Wissensbasis (Task #227): Hybrid-Suche über externe Rechtsquellen
 * (BGB, HGB, GWB, DSGVO, UWG, …) und interne Präzedenzfälle. Liefert die
 * gleiche Datenbasis, die die KI für Risiko-Hinweise und Klausel-Drafts
 * zitiert — aber als interaktive Suchoberfläche, damit Juristen die Quellen
 * vor dem Senden eines Mandanten-Mails nochmal selbst öffnen können.
 *
 * Filter spiegeln die Server-API: q (Volltext), family (Klausel-Familie),
 * jurisdiction, areaOfLaw, counterparty (augmentiert die Query).
 */
export default function Wissensbasis() {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [jurisdiction, setJurisdiction] = useState("all");
  const [areaOfLaw, setAreaOfLaw] = useState("all");

  const params = useMemo(() => {
    const out: {
      q?: string;
      family?: string;
      jurisdiction?: string;
      areaOfLaw?: string;
      counterparty?: string;
    } = {};
    if (q.trim()) out.q = q.trim();
    if (family.trim()) out.family = family.trim();
    if (counterparty.trim()) out.counterparty = counterparty.trim();
    if (jurisdiction !== "all") out.jurisdiction = jurisdiction;
    if (areaOfLaw !== "all") out.areaOfLaw = areaOfLaw;
    return out;
  }, [q, family, counterparty, jurisdiction, areaOfLaw]);

  const enabled =
    !!(params.q || params.family || params.counterparty || params.jurisdiction || params.areaOfLaw);

  const search = useSearchLegalKnowledgeForUser(params, {
    query: { enabled, queryKey: ["legal-knowledge-search", params] },
  });

  const sources = search.data?.sources ?? [];
  const precedents = search.data?.precedents ?? [];

  // Quellen für das wiederverwendbare Klick-zu-öffnen Block-Widget. So
  // verhalten sich Treffer hier identisch zu den Zitaten in der KI-Antwort.
  const relatedItems: RelatedSourceItem[] = useMemo(() => {
    return [
      ...sources.map((s) => ({
        kind: "norm" as const,
        id: s.id,
        ref: `${s.ref} – ${s.title}`,
      })),
      ...precedents.map((p) => ({
        kind: "precedent" as const,
        id: p.id,
        ref: `${p.family}${p.counterpartyName ? ` – ${p.counterpartyName}` : ""}`,
      })),
    ];
  }, [sources, precedents]);

  return (
    <div className="space-y-4" data-testid="page-wissensbasis">
      <div className="flex items-center gap-3">
        <Scale className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Wissensbasis</h1>
          <p className="text-sm text-muted-foreground">
            Suche über externe Rechtsquellen (BGB, HGB, GWB, DSGVO, UWG …) und
            interne Vertragspräzedenzfälle. Identische Datenbasis, die die KI
            für Risiko-Empfehlungen und Klausel-Vorschläge zitiert.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="q">Volltextsuche</Label>
              <Input
                id="q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="z. B. Haftungsbegrenzung, § 309 BGB, AGB"
                data-testid="input-search-q"
              />
            </div>
            <div>
              <Label htmlFor="family">Klausel-Familie</Label>
              <Input
                id="family"
                value={family}
                onChange={(e) => setFamily(e.target.value)}
                placeholder="z. B. liability, indemnity"
                data-testid="input-search-family"
              />
            </div>
            <div>
              <Label htmlFor="counterparty">Gegenpartei</Label>
              <Input
                id="counterparty"
                value={counterparty}
                onChange={(e) => setCounterparty(e.target.value)}
                placeholder="Firmenname (für Präzedenzfälle)"
                data-testid="input-search-counterparty"
              />
            </div>
            <div>
              <Label>Jurisdiktion</Label>
              <Select value={jurisdiction} onValueChange={setJurisdiction}>
                <SelectTrigger data-testid="select-search-jurisdiction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JURISDICTIONS.map((j) => (
                    <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rechtsgebiet</Label>
              <Select value={areaOfLaw} onValueChange={setAreaOfLaw}>
                <SelectTrigger data-testid="select-search-area">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AREAS.map((a) => (
                    <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setQ("");
                  setFamily("");
                  setCounterparty("");
                  setJurisdiction("all");
                  setAreaOfLaw("all");
                }}
                data-testid="button-search-reset"
              >
                Zurücksetzen
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {!enabled ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Search className="h-6 w-6 mx-auto mb-2 opacity-50" />
            Bitte mindestens einen Filter auswählen, um die Wissensbasis zu durchsuchen.
          </CardContent>
        </Card>
      ) : search.isLoading ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 mx-auto mb-2 animate-spin" /> Suche läuft …
          </CardContent>
        </Card>
      ) : search.error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            Suche fehlgeschlagen.
          </CardContent>
        </Card>
      ) : sources.length === 0 && precedents.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Keine Treffer.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card data-testid="card-results-sources">
            <CardHeader>
              <CardTitle className="text-base">
                Rechtsquellen <Badge variant="secondary">{sources.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Treffer.</p>
              ) : (
                sources.map((s) => <NormHitRow key={s.id} hit={s} />)
              )}
            </CardContent>
          </Card>
          <Card data-testid="card-results-precedents">
            <CardHeader>
              <CardTitle className="text-base">
                Präzedenzfälle <Badge variant="secondary">{precedents.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {precedents.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine Treffer.</p>
              ) : (
                precedents.map((p) => <PrecedentHitRow key={p.id} hit={p} />)
              )}
            </CardContent>
          </Card>

          {/* Klick-zu-öffnen Liste — gleiche Komponente wie in der KI-Antwort,
              damit der Volltext im selben Side-Sheet erscheint. */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Schnellzugriff (Volltext öffnen)</CardTitle>
              </CardHeader>
              <CardContent>
                <RelatedSourcesBlock
                  sources={relatedItems}
                  testIdPrefix="wissensbasis-source"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function NormHitRow({ hit }: { hit: LegalKnowledgeNormHit }) {
  return (
    <div className="border-b last:border-b-0 pb-2 last:pb-0" data-testid={`row-norm-${hit.id}`}>
      <div className="flex flex-wrap items-center gap-1.5 mb-1">
        <Badge variant="outline" className="text-[10px]">{hit.jurisdiction}</Badge>
        <Badge variant="outline" className="text-[10px]">{hit.areaOfLaw}</Badge>
        <Badge variant="outline" className="text-[10px]">{hit.hierarchy}</Badge>
        <span className="font-medium text-sm">{hit.ref}</span>
        <span className="text-xs text-muted-foreground">— {hit.title}</span>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3">{hit.snippet}</p>
    </div>
  );
}

function PrecedentHitRow({ hit }: { hit: LegalKnowledgePrecedentHit }) {
  return (
    <div className="border-b last:border-b-0 pb-2 last:pb-0" data-testid={`row-precedent-${hit.id}`}>
      <div className="flex flex-wrap items-center gap-1.5 mb-1">
        <Badge variant="outline" className="text-[10px]">{hit.family}</Badge>
        <Badge variant="outline" className="text-[10px]">{hit.outcome}</Badge>
        {hit.counterpartyName ? (
          <span className="font-medium text-sm">{hit.counterpartyName}</span>
        ) : null}
        {hit.industry ? (
          <span className="text-xs text-muted-foreground">— {hit.industry}</span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground line-clamp-3">{hit.snippet}</p>
    </div>
  );
}

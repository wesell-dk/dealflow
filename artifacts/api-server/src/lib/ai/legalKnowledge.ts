/**
 * Juristische Wissensbasis — Hybrid-Retrieval (Task #227)
 *
 * Liefert für eine gegebene Anfrage (Klausel-Familie + Freitext + Filter) die
 * Top-N juristisch relevanten Treffer aus zwei Quellen:
 *
 *   1. legal_sources     — externe Rechtsquellen (Gesetze, Verordnungen,
 *                          Urteile, Branchenstandards) inkl. der vom System
 *                          ausgelieferten BGB/HGB/GWB/DSGVO/UWG-Norms sowie
 *                          tenant-eigener Quellen.
 *   2. legal_precedents  — interne Präzedenzfälle aus signierten Verträgen
 *                          desselben Tenants (Klausel + Outcome).
 *
 * Scoring ist deterministisch (Token-Overlap mit IDF-ähnlicher Gewichtung):
 *   - Filter (jurisdiction, areaOfLaw, family) als harter Cutoff.
 *   - Score = Σ idf(token)  über alle Query-Tokens, die im Text/Snippet
 *     bzw. in keywords vorkommen, plus Bonus für direkte normRef-Treffer.
 *
 * Wir verzichten bewusst auf pgvector / Embeddings — die Domäne (juristische
 * Klausel-Familien) ist klein genug, dass deterministische Suche reproduzier-
 * bare Citations liefert; das ist für ein Audit-Trail wichtiger als Recall.
 */

import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  db,
  legalPrecedentsTable,
  legalSourcesTable,
} from "@workspace/db";

export interface LegalKnowledgeFilters {
  /** ISO-2 Jurisdiktion ("DE", "EU", "AT" …). Default: alle. */
  jurisdiction?: string | null;
  /** Rechtsgebiet ("contract", "data_protection" …). Default: alle. */
  areaOfLaw?: string | null;
  /** Klausel-Familie für Präzedenzfall-Suche ("liability_cap" …). */
  family?: string | null;
}

export interface NormHit {
  kind: "norm";
  id: string;
  ref: string;          // "BGB § 305"
  title: string;
  jurisdiction: string;
  areaOfLaw: string;
  hierarchy: string;
  snippet: string;      // gekürzte summary / fullText
  url: string | null;
  score: number;
}

export interface PrecedentHit {
  kind: "precedent";
  id: string;
  contractId: string;
  family: string;
  variantId: string | null;
  outcome: string;      // negotiation_outcome
  counterpartyName: string | null;
  industry: string | null;
  signedAt: string | null;
  snippet: string;
  score: number;
}

export interface LegalKnowledgeResult {
  sources: NormHit[];
  precedents: PrecedentHit[];
}

/* ───────────────────────── Tokenisierung & Scoring ───────────────────────── */

const STOP_WORDS = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "eines",
  "und", "oder", "aber", "auch", "wenn", "soll", "kann", "muss", "wird",
  "ist", "war", "sind", "sein", "haben", "hat", "hatte", "wurde",
  "im", "in", "an", "am", "auf", "zu", "zur", "zum", "bei", "von", "vom",
  "für", "fuer", "gegen", "mit", "ohne", "über", "ueber", "unter", "nach",
  "nicht", "kein", "keine", "keinen", "keiner", "alle", "als",
  "this", "that", "the", "and", "or", "of", "to", "for", "in", "on",
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-zäöüß0-9§][a-zäöüß0-9§\-]{1,}/g) ?? [])
    .filter((t) => !STOP_WORDS.has(t));
}

/**
 * IDF-Gewicht: seltene Tokens scoren höher. Ohne Korpus-Statistik nutzen wir
 * eine einfache Heuristik (kürzere Tokens = häufiger). Reproduzierbar genug
 * für Citations, deren Auswahl auditbar bleibt.
 */
function idf(token: string): number {
  if (token.startsWith("§") || /^art\b/.test(token)) return 4; // Norm-Bezug
  if (token.length >= 9) return 3.0;
  if (token.length >= 6) return 2.0;
  if (token.length >= 4) return 1.2;
  return 0.6;
}

function scoreOverlap(queryTokens: Set<string>, docTokens: string[]): number {
  let score = 0;
  const seen = new Set<string>();
  for (const tok of docTokens) {
    if (queryTokens.has(tok) && !seen.has(tok)) {
      score += idf(tok);
      seen.add(tok);
    }
  }
  return score;
}

function clip(text: string, max = 320): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

/* ───────────────────────── Kandidaten laden ───────────────────────── */

interface SearchArgs {
  tenantId: string;
  query: string;
  filters?: LegalKnowledgeFilters;
  /** Max Treffer pro Quelle. Default 4 / 4. */
  limitSources?: number;
  limitPrecedents?: number;
  /** Hartes SQL-Limit für Kandidaten vor Scoring. Default 200. */
  candidatePoolSize?: number;
}

async function loadSourceCandidates(
  args: SearchArgs,
): Promise<Array<typeof legalSourcesTable.$inferSelect>> {
  const { tenantId, filters = {}, candidatePoolSize = 200 } = args;
  const conds = [
    or(isNull(legalSourcesTable.tenantId), eq(legalSourcesTable.tenantId, tenantId)),
  ];
  if (filters.jurisdiction) conds.push(eq(legalSourcesTable.jurisdiction, filters.jurisdiction));
  if (filters.areaOfLaw) conds.push(eq(legalSourcesTable.areaOfLaw, filters.areaOfLaw));
  return db
    .select()
    .from(legalSourcesTable)
    .where(and(...conds))
    .limit(candidatePoolSize);
}

async function loadPrecedentCandidates(
  args: SearchArgs,
): Promise<Array<typeof legalPrecedentsTable.$inferSelect>> {
  const { tenantId, filters = {}, candidatePoolSize = 200 } = args;
  const conds = [eq(legalPrecedentsTable.tenantId, tenantId)];
  if (filters.family) conds.push(eq(legalPrecedentsTable.family, filters.family));
  return db
    .select()
    .from(legalPrecedentsTable)
    .where(and(...conds))
    .orderBy(sql`signed_at desc nulls last`)
    .limit(candidatePoolSize);
}

/* ───────────────────────── Public API ───────────────────────── */

export async function searchLegalKnowledge(
  args: SearchArgs,
): Promise<LegalKnowledgeResult> {
  const limitSources = args.limitSources ?? 4;
  const limitPrecedents = args.limitPrecedents ?? 4;
  const queryTokens = new Set(tokenize(args.query));

  // Wenn der User keinen Query-Text hat (z. B. nur Family-Filter), reicht
  // bereits der Filter aus — wir liefern dann einfach die jüngsten Treffer
  // ohne Score-Sortierung.
  const hasQuery = queryTokens.size > 0;

  const [sourceCands, precedentCands] = await Promise.all([
    loadSourceCandidates(args),
    loadPrecedentCandidates(args),
  ]);

  const sources: NormHit[] = sourceCands
    .map((s) => {
      const docTokens = tokenize(
        `${s.normRef} ${s.title} ${(s.keywords ?? []).join(" ")} ${s.summary} ${s.fullText}`,
      );
      const baseScore = hasQuery ? scoreOverlap(queryTokens, docTokens) : 1;
      // Bonus, wenn die Query die Norm-Referenz direkt nennt.
      const refTokens = tokenize(s.normRef);
      const refHit = refTokens.every((t) => queryTokens.has(t));
      const score = baseScore + (refHit ? 6 : 0);
      return { row: s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limitSources)
    .map(({ row, score }) => ({
      kind: "norm" as const,
      id: row.id,
      ref: row.normRef,
      title: row.title,
      jurisdiction: row.jurisdiction,
      areaOfLaw: row.areaOfLaw,
      hierarchy: row.hierarchy,
      snippet: clip(row.summary || row.fullText),
      url: row.url ?? null,
      score: Number(score.toFixed(2)),
    }));

  const precedents: PrecedentHit[] = precedentCands
    .map((p) => {
      const docTokens = tokenize(
        `${p.family} ${p.snippet} ${(p.keywords ?? []).join(" ")} ${p.counterpartyName ?? ""}`,
      );
      const baseScore = hasQuery ? scoreOverlap(queryTokens, docTokens) : 1;
      // Familie-Filter wurde per SQL angewendet → dort schon harter Cutoff.
      // Bonus für jüngere Präzedenzfälle (max +1.5 Score über die letzten ~2J).
      const recencyBonus = p.signedAt
        ? Math.max(
            0,
            1.5 -
              (Date.now() - new Date(p.signedAt).getTime()) /
                (1000 * 60 * 60 * 24 * 365 * 2),
          )
        : 0;
      return { row: p, score: baseScore + recencyBonus };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limitPrecedents)
    .map(({ row, score }) => ({
      kind: "precedent" as const,
      id: row.id,
      contractId: row.contractId,
      family: row.family,
      variantId: row.variantId,
      outcome: row.negotiationOutcome,
      counterpartyName: row.counterpartyName,
      industry: row.industry,
      signedAt: row.signedAt ? row.signedAt.toISOString() : null,
      snippet: clip(row.snippet),
      score: Number(score.toFixed(2)),
    }));

  return { sources, precedents };
}

/**
 * Format-Helfer: bereitet die Citations als kompakten Text-Block für den
 * LLM-Prompt vor. Wir hängen ihn an buildUser() an, damit das Modell die
 * Quellen 1) lesen und 2) im Output `relatedSources` referenzieren kann.
 */
export function formatLegalKnowledgeForPrompt(
  result: LegalKnowledgeResult,
): string {
  const lines: string[] = [];
  if (result.sources.length > 0) {
    lines.push("Externe Rechtsquellen (gewertet, sortiert nach Relevanz):");
    for (const s of result.sources) {
      lines.push(`- [${s.id}] ${s.ref} — ${s.title} (${s.jurisdiction}, ${s.areaOfLaw}). ${s.snippet}`);
    }
  }
  if (result.precedents.length > 0) {
    lines.push("");
    lines.push("Interne Präzedenzfälle (signierte Verträge):");
    for (const p of result.precedents) {
      const cp = p.counterpartyName ? ` mit ${p.counterpartyName}` : "";
      const dat = p.signedAt ? ` (${p.signedAt.slice(0, 10)})` : "";
      lines.push(`- [${p.id}] ${p.family} — Outcome: ${p.outcome}${cp}${dat}. ${p.snippet}`);
    }
  }
  if (lines.length === 0) return "";
  return [
    "",
    "── JURISTISCHE WISSENSBASIS ──",
    ...lines,
    "",
    "Verwende NUR die oben gelisteten Quellen, wenn du Empfehlungen mit",
    'Rechts- oder Präzedenzfall-Bezug gibst. Trage die referenzierten IDs',
    'im Output-Feld "relatedSources" als {kind, id, ref} ein.',
  ].join("\n");
}

/* ───────────────────────── Auto-Indexing für Präzedenzfälle ───────────────────────── */

import {
  contractsTable,
  contractClausesTable,
  clauseVariantsTable,
  accountsTable,
} from "@workspace/db";
import { randomUUID } from "node:crypto";

/**
 * Indexiert alle Klauseln eines (signierten) Vertrags als Präzedenzfälle.
 * Idempotent: existierende Einträge werden über die uniqueIndex auf
 * (tenantId, contractClauseId) ersetzt.
 *
 * Wird aufgerufen:
 *   a) automatisch beim Status-Übergang nach 'signed' (siehe routes/dealflow.ts)
 *   b) manuell via POST /admin/legal-precedents/backfill
 */
export async function indexContractPrecedents(args: {
  tenantId: string;
  contractId: string;
}): Promise<{ indexed: number }> {
  const [contract] = await db
    .select()
    .from(contractsTable)
    .where(
      and(eq(contractsTable.id, args.contractId), eq(contractsTable.tenantId, args.tenantId)),
    );
  if (!contract) return { indexed: 0 };
  // Wir indexieren nur signierte Verträge — alles andere wäre rauschen.
  if (contract.status !== "signed" && contract.status !== "active") return { indexed: 0 };

  const clauses = await db
    .select()
    .from(contractClausesTable)
    .where(eq(contractClausesTable.contractId, contract.id));

  const variantIds = clauses
    .map((c) => c.activeVariantId)
    .filter((v): v is string => Boolean(v));
  const variants = variantIds.length
    ? await db.select().from(clauseVariantsTable).where(inArray(clauseVariantsTable.id, variantIds))
    : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));

  let counterparty: { name: string | null; industry: string | null } = {
    name: null,
    industry: null,
  };
  if (contract.accountId) {
    const [acc] = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, contract.accountId));
    if (acc) counterparty = { name: acc.name ?? null, industry: acc.industry ?? null };
  }

  const valueCents = contract.valueAmount
    ? Math.round(Number(contract.valueAmount) * 100)
    : null;

  let indexed = 0;
  for (const cl of clauses) {
    // Snippet: bevorzugt der editierte Body (das, was tatsächlich unter-
    // schrieben wurde), sonst die Variant-Referenz, sonst die Klausel-
    // Zusammenfassung.
    const variant = cl.activeVariantId ? variantById.get(cl.activeVariantId) : undefined;
    const snippet =
      cl.editedBody?.trim() ||
      (variant && (variant.body?.trim() || variant.summary?.trim())) ||
      cl.summary;
    if (!snippet || snippet.length < 12) continue; // zu kurz, kein Lerneffekt
    // negotiationOutcome bestimmen: edited_body gesetzt + variant.tone vorhanden
    //   → "custom"; sonst Mapping aus cl.variant ("soft"|"standard"|"hard").
    let outcome: string;
    if (cl.editedBody && cl.editedBody.trim().length > 0) outcome = "custom";
    else if (cl.variant === "soft") outcome = "softened";
    else if (cl.variant === "hard") outcome = "hardened";
    else outcome = "standard";

    const keywords = Array.from(new Set(tokenize(`${cl.family} ${snippet}`))).slice(0, 30);

    const id = `lp_${randomUUID().slice(0, 12)}`;
    await db
      .insert(legalPrecedentsTable)
      .values({
        id,
        tenantId: args.tenantId,
        contractId: contract.id,
        contractClauseId: cl.id,
        family: cl.family,
        variantId: cl.activeVariantId ?? null,
        negotiationOutcome: outcome,
        counterpartyAccountId: contract.accountId ?? null,
        counterpartyName: counterparty.name,
        industry: counterparty.industry,
        contractValueCents: valueCents,
        signedAt: contract.signedAt ?? null,
        snippet: clip(snippet, 1200),
        keywords,
      })
      .onConflictDoUpdate({
        target: [legalPrecedentsTable.tenantId, legalPrecedentsTable.contractClauseId],
        set: {
          family: cl.family,
          variantId: cl.activeVariantId ?? null,
          negotiationOutcome: outcome,
          counterpartyAccountId: contract.accountId ?? null,
          counterpartyName: counterparty.name,
          industry: counterparty.industry,
          contractValueCents: valueCents,
          signedAt: contract.signedAt ?? null,
          snippet: clip(snippet, 1200),
          keywords,
        },
      });
    indexed++;
  }
  return { indexed };
}

/**
 * Reindex aller signierten Verträge eines Tenants. Wird über den Admin-Tab
 * "Wissensbasis → Präzedenzfälle" angestoßen, wenn die Tabelle initial leer
 * ist oder die Klausel-Familien-Taxonomie geändert wurde.
 */
export async function backfillPrecedentsForTenant(
  tenantId: string,
): Promise<{ contracts: number; indexed: number }> {
  const rows = await db
    .select({ id: contractsTable.id })
    .from(contractsTable)
    .where(
      and(
        eq(contractsTable.tenantId, tenantId),
        or(eq(contractsTable.status, "signed"), eq(contractsTable.status, "active")),
      ),
    );
  let totalIndexed = 0;
  for (const c of rows) {
    const r = await indexContractPrecedents({ tenantId, contractId: c.id });
    totalIndexed += r.indexed;
  }
  return { contracts: rows.length, indexed: totalIndexed };
}

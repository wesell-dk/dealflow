/**
 * Contract Consistency & Completeness Linter (Task #230)
 *
 * Deterministischer, regelbasierter Vertrags-Lint. Pure-TS-Modul ohne
 * DB-Zugriff: bekommt einen ContractLintInput und liefert eine Liste
 * `ContractLintFinding[]` zurück. Die Routenebene ist verantwortlich, den
 * Input aus den DB-Tabellen zusammenzubauen — der Linter selbst ist seiteneffektfrei
 * und damit trivial zu unit-testen.
 *
 * Kategorien (siehe Spec):
 *   - cross_reference     "§ 5", "Ziffer 7.2", "Section 4" → Ziel existiert?
 *   - definitions         in Anführungszeichen definierte Begriffe → später wieder verwendet?
 *   - attachments         "Anlage X", "Annex Y" → existiert eine Anlage mit dieser Nummer?
 *   - mandatory_clauses   contractTypesTable.mandatoryClauseFamilyIds vorhanden?
 *   - forbidden_clauses   contractTypesTable.forbiddenClauseFamilyIds NICHT vorhanden?
 *   - numeric_consistency widersprüchliche Frist-/Geld-Angaben für denselben Begriff
 *
 * Severity:
 *   - error  Hard-Stop für Approval/Signatur (fehlende Pflicht-Familie,
 *            Forbidden-Familie aktiv, widersprüchliche Pflicht-Zahlen)
 *   - warn   Sichtbarer Hinweis, kein Hard-Stop (fehlende Anlage,
 *            unbekanntes Querverweis-Ziel)
 *   - info   Kosmetisch (Definition definiert aber nie verwendet)
 *
 * Findings sind absichtlich `id`-stabil (sortiert + deterministisch), damit
 * die UI Re-Renders nicht versehentlich die "fix"-Buttons neu bindet.
 */

export type LintSeverity = "error" | "warn" | "info";
export type LintCategory =
  | "cross_reference"
  | "definitions"
  | "attachments"
  | "mandatory_clauses"
  | "forbidden_clauses"
  | "numeric_consistency";

export interface ContractLintFinding {
  /** Stabiler Hash-artiger Key, damit React die Findings stable keyen kann. */
  id: string;
  category: LintCategory;
  severity: LintSeverity;
  /** Maschinenlesbarer Code für Tests / Telemetry (z. B. "missing_family"). */
  code: string;
  /** Deutsche Anzeigemeldung. */
  message: string;
  /** Optional: ID der konkreten Klausel, an der das Finding hängt — UI scrollt dorthin. */
  contractClauseId?: string;
  /** Optional: Roher Treffer-Snippet (max. 120 Zeichen) für Kontext. */
  snippet?: string;
  /** Optional: Konkreter Lösungsvorschlag, wird in der UI als "Fix"-Button vorgeschlagen. */
  suggestion?: string;
  /**
   * Optional: maschinenlesbarer Quick-Fix, den der Client (oder ein späteres
   * Skript) automatisch ausführen kann. Aktuell nur 'add_mandatory_family'
   * — weitere Fixes lassen sich additiv ergänzen.
   */
  fix?:
    | { kind: "add_mandatory_family"; familyId: string }
    | { kind: "remove_forbidden_family"; familyId: string; clauseId: string };
}

/**
 * Häufig in deutschen Verträgen verwendete „Rollen-Begriffe", die ohne
 * Definition (= ohne Bindung an eine reale Partei) zu Mehrdeutigkeit führen.
 * Bewusst klein gehalten und gut belegt — wir wollen lieber 5 sicher
 * erkannte Fälle als 50 mit False-Positives.
 */
const PARTY_ROLE_TERMS = [
  "Auftragnehmer", "Auftragnehmerin",
  "Auftraggeber", "Auftraggeberin",
  "Lieferant", "Lieferantin",
  "Lizenzgeber", "Lizenzgeberin",
  "Lizenznehmer", "Lizenznehmerin",
  "Verkäufer", "Verkaeufer",
  "Käufer", "Kaeufer",
] as const;

export interface ContractLintInput {
  contract: {
    id: string;
    title: string;
    /** Optional: zusammengesetzter Volltext des Vertrags. Wenn nicht gesetzt,
     * baut der Linter den Text deterministisch aus `clauses` (Reihenfolge!). */
    body?: string | null;
  };
  clauses: Array<{
    id: string;
    family: string;
    familyId: string | null;
    body: string | null;
    summary: string | null;
    editedBody?: string | null;
    editedSummary?: string | null;
    /** 1-basierte Reihenfolge im Vertrag (für § N Auflösung). */
    ordinal?: number;
  }>;
  contractType: {
    id: string;
    code: string;
    mandatoryClauseFamilyIds: string[];
    forbiddenClauseFamilyIds: string[];
  } | null;
  /**
   * Anzahl der dem Vertrag angehefteten Anlagen (für „Anlage X" Auflösung).
   * `null` bedeutet „unbekannt" — die Aufrufseite konnte nicht zuverlässig
   * ermitteln, wie viele Anlagen der Vertrag hat (z. B. weil noch kein
   * Attachments-Modell existiert). In diesem Fall unterdrückt der Linter
   * alle „Anlage fehlt"-Findings, um False-Positives zu vermeiden, und
   * emittiert stattdessen ein einzelnes `info`-Finding mit der Liste der
   * referenzierten Anlagen, damit der Nutzer weiß, dass der Linter sie sah.
   */
  attachmentCount: number | null;
  /** Lookup, um Family-Namen für Fix-Suggestions zu zeigen. */
  familyNameById?: Map<string, string>;
}

export interface ContractLintReport {
  contractId: string;
  generatedAt: string;
  findings: ContractLintFinding[];
  counts: { error: number; warn: number; info: number; total: number };
}

// ───────────────────────── Pure helpers ─────────────────────────

function effectiveClauseBody(c: ContractLintInput["clauses"][number]): string {
  return [c.editedBody ?? c.body ?? "", c.editedSummary ?? c.summary ?? ""]
    .filter(Boolean)
    .join("\n");
}

function assembleContractText(input: ContractLintInput): string {
  if (input.contract.body && input.contract.body.trim().length > 0) {
    return input.contract.body;
  }
  // Reihenfolge: nach `ordinal` falls gesetzt, sonst Reihenfolge im Array.
  const ordered = [...input.clauses].sort((a, b) => {
    if (a.ordinal != null && b.ordinal != null) return a.ordinal - b.ordinal;
    return 0;
  });
  return ordered
    .map((c, i) => `§ ${c.ordinal ?? i + 1} ${c.family}\n${effectiveClauseBody(c)}`)
    .join("\n\n");
}

function snippetAround(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + len + 30);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function makeId(parts: Array<string | number>): string {
  // Stabiler, aber nicht kryptographisch sicherer Key — reicht als React-key.
  return parts.map(p => String(p).replace(/\s+/g, "_")).join("|");
}

// ───────────────────────── Detection helpers ─────────────────────────

/**
 * Findet alle Querverweise. Akzeptiert "§ 5", "§5", "§§ 5 und 6",
 * "Ziffer 7.2", "Ziff. 3", "Section 4", "Abschnitt 2".
 * Gibt jeden Treffer mit Position und Ziel-Index zurück.
 */
function findCrossReferences(text: string): Array<{ raw: string; targets: number[]; index: number }> {
  const results: Array<{ raw: string; targets: number[]; index: number }> = [];
  // §-Querverweise (auch §§)
  const reParagraph = /§{1,2}\s*([0-9]+(?:\.[0-9]+)*(?:\s*(?:und|,|&)\s*[0-9]+(?:\.[0-9]+)*)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = reParagraph.exec(text)) !== null) {
    const numbers = m[1].split(/\s*(?:und|,|&)\s*/).map(s => parseInt(s.split(".")[0], 10)).filter(n => Number.isFinite(n));
    results.push({ raw: m[0], targets: numbers, index: m.index });
  }
  const reZiffer = /(?:Ziffer|Ziff\.?|Section|Abschnitt|Klausel)\s+([0-9]+(?:\.[0-9]+)*)/gi;
  while ((m = reZiffer.exec(text)) !== null) {
    const n = parseInt(m[1].split(".")[0], 10);
    if (Number.isFinite(n)) results.push({ raw: m[0], targets: [n], index: m.index });
  }
  return results;
}

/**
 * Findet "Anlage 1", "Anlage A", "Annex 2", "Appendix B".
 */
function findAttachmentRefs(text: string): Array<{ raw: string; ordinal: number | string; index: number }> {
  const results: Array<{ raw: string; ordinal: number | string; index: number }> = [];
  const re = /(?:Anlage|Annex|Appendix|Anhang)\s+([0-9]+|[A-Z])\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1];
    const n = parseInt(raw, 10);
    results.push({ raw: m[0], ordinal: Number.isFinite(n) ? n : raw, index: m.index });
  }
  return results;
}

/**
 * Findet Definitionen in Anführungszeichen, optional gefolgt von einer
 * Klammer-Definition: „Auftragnehmer" (im Folgenden „Auftragnehmer").
 * Liefert die Begriffe normalisiert (Lower-Case Ohne Anführungszeichen).
 */
function findDefinedTerms(text: string): Array<{ term: string; index: number }> {
  const results: Array<{ term: string; index: number }> = [];
  // Anführungszeichen-Paare:
  //   - deutsch:  „…"  (U+201E … U+201C)  — Druck-/Lehrbuchstil
  //   - deutsch:  „…"  (U+201E … U+201D)  — Word-Standard / Office
  //   - englisch: "…"  (U+201C … U+201D)  — typographisch
  //   - englisch: "…"  (U+0022 … U+0022)  — ASCII-„dumb quotes"
  //   - französ.: «…»  (U+00AB … U+00BB)
  // Wir akzeptieren jede sinnvolle Kombination — das Mismatch zwischen
  // öffnender und schließender Quote ist in der Praxis (Word-Autokorrektur
  // vs. manuelle Eingabe) sehr häufig.
  const re = /[\u201E\u201C\u00AB"]([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜa-zäöüß-]+)*)[\u201C\u201D\u00BB"]/g;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = re.exec(text)) !== null) {
    const term = m[1].trim();
    if (term.length < 3 || term.length > 60) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ term, index: m.index });
  }
  return results;
}

/**
 * Findet alle Frist-Angaben in Tagen/Wochen/Monaten/Jahren mit dem
 * Schlüssel-Begriff davor (Heuristik: das letzte Substantiv vor der Zahl
 * im selben Satz). Gibt pro „Begriff" die Liste der gefundenen Frist-Werte
 * in Tagen-Äquivalent zurück, damit Widersprüche erkennbar sind.
 */
function findDeadlineMentions(text: string): Map<string, Array<{ value: number; raw: string; index: number }>> {
  const map = new Map<string, Array<{ value: number; raw: string; index: number }>>();
  // Anker auf das Frist-Schlüsselwort. So ist die "Subject"-Erkennung robust
  // auch bei Sätzen wie "Die Kündigungsfrist beträgt 30 Tage".
  const re = /\b(Kündigungs?frist|Kuendigungs?frist|Nachfrist|Zahlungs?frist|Rüge?frist|Rueg?efrist|Abnahmefrist|Gewährleistungs?frist|Gewaehrleistungs?frist|Frist|Laufzeit|Verlängerung|Verlaengerung|Verzugsfrist)[a-zäöüß]*[^.]{0,60}?(\d{1,4})\s*(Tag(?:e|en)?|Werktag(?:e|en)?|Woche(?:n)?|Monat(?:e|en)?|Jahr(?:e|en)?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const subject = m[1].trim();
    const n = parseInt(m[2], 10);
    if (!Number.isFinite(n)) continue;
    const unit = m[3].toLowerCase();
    const days = unit.startsWith("tag") || unit.startsWith("werktag") ? n
      : unit.startsWith("woche") ? n * 7
      : unit.startsWith("monat") ? n * 30
      : unit.startsWith("jahr") ? n * 365 : n;
    // Normalisiere: "Kündigungsfrist" und "Kuendigungsfrist" → derselbe Bucket.
    const key = subject.toLowerCase()
      .replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u").replace(/ß/g, "ss");
    const list = map.get(key) ?? [];
    list.push({ value: days, raw: m[0], index: m.index });
    map.set(key, list);
  }
  return map;
}

// ───────────────────────── Main entry ─────────────────────────

export function runContractLint(input: ContractLintInput): ContractLintReport {
  const findings: ContractLintFinding[] = [];
  const text = assembleContractText(input);
  const totalClauses = input.clauses.length;
  const familyName = (id: string) => input.familyNameById?.get(id) ?? id;

  // 1) Pflicht-Klauseln
  if (input.contractType) {
    const presentFamilies = new Set(
      input.clauses.map(c => c.familyId).filter((x): x is string => Boolean(x)),
    );
    for (const fid of input.contractType.mandatoryClauseFamilyIds) {
      if (!presentFamilies.has(fid)) {
        findings.push({
          id: makeId(["mandatory", fid]),
          category: "mandatory_clauses",
          severity: "error",
          code: "missing_mandatory_family",
          message: `Pflicht-Klauselfamilie "${familyName(fid)}" fehlt im Vertrag (Vertragstyp ${input.contractType.code}).`,
          suggestion: `Füge eine Klausel der Familie "${familyName(fid)}" ein.`,
          fix: { kind: "add_mandatory_family", familyId: fid },
        });
      }
    }

    // 2) Verbotene Klauseln
    const forbiddenSet = new Set(input.contractType.forbiddenClauseFamilyIds);
    for (const c of input.clauses) {
      if (c.familyId && forbiddenSet.has(c.familyId)) {
        findings.push({
          id: makeId(["forbidden", c.id]),
          category: "forbidden_clauses",
          severity: "error",
          code: "forbidden_family_present",
          message: `Klauselfamilie "${familyName(c.familyId)}" ist für Vertragstyp ${input.contractType.code} verboten.`,
          contractClauseId: c.id,
          suggestion: `Entferne die Klausel oder wechsle den Vertragstyp.`,
          fix: { kind: "remove_forbidden_family", familyId: c.familyId, clauseId: c.id },
        });
      }
    }
  }

  // 3) Cross-References
  const xrefs = findCrossReferences(text);
  for (const ref of xrefs) {
    for (const target of ref.targets) {
      if (target < 1 || target > totalClauses) {
        findings.push({
          id: makeId(["xref", ref.index, target]),
          category: "cross_reference",
          severity: "warn",
          code: "xref_target_missing",
          message: `Querverweis "${ref.raw.trim()}" zeigt auf § ${target}, aber der Vertrag hat nur ${totalClauses} Klauseln.`,
          snippet: snippetAround(text, ref.index, ref.raw.length),
        });
      }
    }
  }

  // 4) Anlagen-Referenzen
  // Nur prüfen, wenn `attachmentCount` bekannt ist. Bei `null` (kein
  // Attachments-Modell verfügbar) emittieren wir KEINE „fehlt"-Warnungen,
  // sondern nur einen einzigen Info-Hinweis mit den gefundenen Referenzen,
  // damit der Reviewer sieht, dass der Linter sie wahrgenommen hat — aber
  // nicht fälschlich behauptet, sie wären nicht hochgeladen.
  const attRefs = findAttachmentRefs(text);
  const refdAttIndices = uniq(attRefs.map(r => r.ordinal));
  if (input.attachmentCount === null) {
    if (refdAttIndices.length > 0) {
      const list = refdAttIndices.map(o => `Anlage ${o}`).join(", ");
      findings.push({
        id: makeId(["attachment", "unknown"]),
        category: "attachments",
        severity: "info",
        code: "attachment_tracking_unavailable",
        message: `Der Vertrag referenziert Anlage(n): ${list}. Konsistenz-Check übersprungen — Anlagen-Tracking ist für diesen Vertrag (noch) nicht aktiv.`,
      });
    }
  } else {
    for (const ord of refdAttIndices) {
      if (typeof ord === "number" && ord > input.attachmentCount) {
        const first = attRefs.find(r => r.ordinal === ord)!;
        findings.push({
          id: makeId(["attachment", String(ord)]),
          category: "attachments",
          severity: "warn",
          code: "attachment_missing",
          message: `Anlage ${ord} wird im Text referenziert, aber der Vertrag hat nur ${input.attachmentCount} Anlage(n).`,
          snippet: snippetAround(text, first.index, first.raw.length),
          suggestion: `Lade Anlage ${ord} hoch oder entferne den Verweis.`,
        });
      } else if (typeof ord === "string" && input.attachmentCount === 0) {
        const first = attRefs.find(r => r.ordinal === ord)!;
        findings.push({
          id: makeId(["attachment", ord]),
          category: "attachments",
          severity: "warn",
          code: "attachment_missing",
          message: `Anlage ${ord} wird im Text referenziert, aber der Vertrag hat keine Anlagen.`,
          snippet: snippetAround(text, first.index, first.raw.length),
        });
      }
    }
  }

  // 5) Definitionen
  const defs = findDefinedTerms(text);
  for (const d of defs) {
    // Wird der Begriff später (oder davor) wieder verwendet?
    const re = new RegExp(`\\b${d.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    let count = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      count++;
      if (count > 1) break;
    }
    if (count <= 1) {
      findings.push({
        id: makeId(["def", d.term]),
        category: "definitions",
        severity: "info",
        code: "defined_term_unused",
        message: `Definierter Begriff "${d.term}" wird im Vertrag nicht erneut verwendet.`,
        snippet: snippetAround(text, d.index, d.term.length + 4),
      });
    }
  }

  // 5b) Undefinierte Rollen-Begriffe — wenn der Vertrag z. B. „Auftragnehmer"
  // oder „Lizenznehmer" verwendet, aber nirgendwo eine Definition (in
  // Anführungszeichen + „bedeutet/heißt/im Folgenden") existiert, ist die
  // Partei mehrdeutig. Wir matchen nur unsere kuratierte Liste, um Rauschen
  // zu vermeiden — nicht jeder großgeschriebene Begriff ist ein Rollen-Term.
  const definedTermSet = new Set(defs.map(d => d.term.toLowerCase()));
  const definitionMarkerRe = /(bedeutet|bezeichnet|im Folgenden|heißt|heisst|ist nachfolgend|nachfolgend genannt)/i;
  for (const role of PARTY_ROLE_TERMS) {
    const useRe = new RegExp(`\\b${role}\\b`, "g");
    let useCount = 0;
    let firstIdx = -1;
    let m: RegExpExecArray | null;
    while ((m = useRe.exec(text)) !== null) {
      if (firstIdx < 0) firstIdx = m.index;
      useCount++;
      if (useCount > 1) break;
    }
    if (useCount === 0) continue;
    if (definedTermSet.has(role.toLowerCase())) continue;
    // Suche eine Definition in der Nähe der ersten Verwendung.
    const window = text.slice(Math.max(0, firstIdx - 60), Math.min(text.length, firstIdx + role.length + 60));
    if (definitionMarkerRe.test(window)) continue;
    findings.push({
      id: makeId(["undef", role]),
      category: "definitions",
      severity: "warn",
      code: "undefined_party_term",
      message: `Rollen-Begriff "${role}" wird verwendet, ist aber nirgends definiert (z. B. „Lieferant" bedeutet ABC GmbH).`,
      snippet: snippetAround(text, firstIdx, role.length),
      suggestion: `Definiere "${role}" einmal explizit (z. B. am Vertragsanfang: "${role}" bedeutet …).`,
    });
  }

  // 6) Numerische / Frist-Konsistenz
  const deadlines = findDeadlineMentions(text);
  for (const [subject, list] of deadlines.entries()) {
    const distinctDays = uniq(list.map(l => l.value));
    if (distinctDays.length > 1) {
      const summary = list.map(l => l.raw.trim()).join(" vs. ");
      findings.push({
        id: makeId(["num", subject]),
        category: "numeric_consistency",
        severity: "warn",
        code: "deadline_inconsistency",
        message: `Widersprüchliche Frist für "${subject}": ${summary}`,
        snippet: snippetAround(text, list[0].index, list[0].raw.length),
        suggestion: `Vereinheitliche die Frist (z. B. ${distinctDays[0]} Tage).`,
      });
    }
  }

  // Stabile Sortierung: error → warn → info, dann alphabetisch nach id.
  const sevRank: Record<LintSeverity, number> = { error: 0, warn: 1, info: 2 };
  findings.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || a.id.localeCompare(b.id));

  const counts = {
    error: findings.filter(f => f.severity === "error").length,
    warn: findings.filter(f => f.severity === "warn").length,
    info: findings.filter(f => f.severity === "info").length,
    total: findings.length,
  };

  return {
    contractId: input.contract.id,
    generatedAt: new Date().toISOString(),
    findings,
    counts,
  };
}

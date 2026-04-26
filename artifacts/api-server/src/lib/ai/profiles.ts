/**
 * Spezialgebiets- und Jurisdiktions-Profile (Task #228)
 *
 * Liefert pro (Rechtsgebiet × Jurisdiktion) ein deterministisches System-
 * Prompt-Fragment, das in den Drafting-, Risiko- und Redline-Copilot
 * eingespielt wird. Das Fragment macht Domänenwissen explizit, das ein
 * Senior-Anwalt bei der Prüfung mitbringt — z. B. "AGB-Kontrolle nach
 * §§ 305 ff. BGB", "AVV nach Art. 28 DSGVO", "Mitbestimmung bei
 * deutschen Arbeitsverhältnissen".
 *
 * Außerdem stellt das Modul:
 *  - die kanonischen Listen `PRACTICE_AREAS` / `JURISDICTIONS`
 *  - eine Übersetzung Rechtsgebiet → Wissensbasis-`areaOfLaw`
 *  - DE-Anzeigelabels für die UI
 *
 * bereit, damit Schema, OpenAPI, Routes und Frontend ein einheitliches Set
 * an Werten verwenden.
 */

export const PRACTICE_AREAS = [
  "it_software",
  "service",
  "supply_purchase",
  "labor",
  "data_protection",
  "license",
  "m_a",
  "nda",
  "framework",
  "agb_relevant",
  "other",
] as const;

export type PracticeArea = (typeof PRACTICE_AREAS)[number];

export const JURISDICTIONS = ["DE", "AT", "CH", "EN", "US", "OTHER"] as const;

export type Jurisdiction = (typeof JURISDICTIONS)[number];

export const PRACTICE_AREA_LABELS_DE: Record<PracticeArea, string> = {
  it_software: "IT-/Software",
  service: "Dienstleistung",
  supply_purchase: "Lieferung/Kauf",
  labor: "Arbeitsrecht",
  data_protection: "Datenschutz/AVV",
  license: "Lizenz",
  m_a: "M&A",
  nda: "NDA",
  framework: "Rahmenvertrag",
  agb_relevant: "AGB-relevant",
  other: "Sonstiges",
};

export const JURISDICTION_LABELS_DE: Record<Jurisdiction, string> = {
  DE: "Deutschland",
  AT: "Österreich",
  CH: "Schweiz",
  EN: "England/UK",
  US: "USA",
  OTHER: "Sonstige",
};

/**
 * Mapping vom Vertrags-Rechtsgebiet (UI-Enum) auf den `areaOfLaw`-Wert in
 * `legal_sources`. Letzteres ist eine kleinere Taxonomie (siehe
 * legalKnowledge.ts: contract | data_protection | competition | commercial |
 * it | labor | tax | other). Wir nutzen sie als Pflicht-Filter im Retrieval.
 */
export function practiceAreaToAreaOfLaw(
  area: PracticeArea | string | null | undefined,
): string | null {
  switch (area) {
    case "it_software":
      return "it";
    case "service":
    case "supply_purchase":
    case "framework":
    case "license":
    case "m_a":
    case "nda":
    case "agb_relevant":
      return "contract";
    case "labor":
      return "labor";
    case "data_protection":
      return "data_protection";
    case "other":
    case null:
    case undefined:
    case "":
      return null;
    default:
      return null;
  }
}

export function isPracticeArea(value: unknown): value is PracticeArea {
  return typeof value === "string" && (PRACTICE_AREAS as readonly string[]).includes(value);
}

export function isJurisdiction(value: unknown): value is Jurisdiction {
  return typeof value === "string" && (JURISDICTIONS as readonly string[]).includes(value);
}

/**
 * Liefert das Domänen-Prompt-Fragment für die KI. Das Fragment wird hinten
 * an den User-Prompt angehängt (siehe ContractRiskInput.profileFragment u. a.).
 *
 * Aufbau pro Eintrag:
 *   - Rolle: Welche Brille trägt der Reviewer (Anwaltsspezialisierung)?
 *   - Schwerpunkte: Themen, die der Reviewer immer prüft.
 *   - Normquellen: Konkrete Gesetzes-Bezugspunkte (Citation-Anker).
 *
 * Wichtig: Wir bauen das Fragment deterministisch — kein KI-Aufruf, damit
 * dieselben Eingaben immer dasselbe Fragment ergeben (Reproduzierbarkeit
 * für Audit-Trails und Tests).
 */
export function getProfileFragment(opts: {
  jurisdiction?: string | null;
  practiceArea?: string | null;
}): string {
  const j = (opts.jurisdiction ?? "").trim();
  const a = (opts.practiceArea ?? "").trim();

  if (!j && !a) {
    return (
      "DOMAIN PROFILE: not specified. Apply general commercial-contract " +
      "review heuristics. Note in your output that no domain profile was " +
      "selected so the user can refine before relying on the recommendation."
    );
  }

  const lines: string[] = ["DOMAIN PROFILE:"];
  const aLabel = isPracticeArea(a) ? PRACTICE_AREA_LABELS_DE[a] : a || "—";
  const jLabel = isJurisdiction(j) ? JURISDICTION_LABELS_DE[j] : j || "—";
  lines.push(`- Rechtsgebiet: ${aLabel} (${a || "n/a"})`);
  lines.push(`- Jurisdiktion: ${jLabel} (${j || "n/a"})`);

  // Jurisdictional baseline (governing-law level).
  if (j === "DE") {
    lines.push(
      "- Baseline: Apply German commercial law (BGB, HGB). For B2C and " +
      "AGB-Verträge apply Inhaltskontrolle nach §§ 305-310 BGB. Consider " +
      "Schriftformerfordernisse (§ 126 BGB) and Verbraucher-Rechte where " +
      "the counterparty is a Verbraucher.",
    );
  } else if (j === "AT") {
    lines.push(
      "- Baseline: Apply Austrian law (ABGB, UGB) and AGB-Kontrolle (§§ 879, " +
      "864a ABGB, KSchG for B2C). Cite Austrian norms where relevant.",
    );
  } else if (j === "CH") {
    lines.push(
      "- Baseline: Apply Swiss law (OR — Schweizer Obligationenrecht). " +
      "Consider Art. 8 UWG and AGB-Kontrolle nach Art. 8 UWG (Globalübernahme).",
    );
  } else if (j === "EN") {
    lines.push(
      "- Baseline: Apply English law. Consider Unfair Contract Terms Act 1977, " +
      "Consumer Rights Act 2015 (B2C) and the requirement for clearly " +
      "incorporated terms.",
    );
  } else if (j === "US") {
    lines.push(
      "- Baseline: Apply U.S. state-law principles. Note that limitation-of-" +
      "liability clauses are generally enforceable but unconscionability " +
      "(UCC §2-302) and consequential-damages exclusions are jurisdiction-" +
      "specific. Highlight state-specific risks if the contract names a state.",
    );
  } else if (j === "OTHER" || (j && !isJurisdiction(j))) {
    lines.push(
      "- Baseline: Jurisdiction is non-standard. State that you cannot apply " +
      "specific local law and limit recommendations to language-/structure-" +
      "level findings.",
    );
  }

  // Practice-area heuristics (mostly DE-flavoured; the orchestrator should
  // combine with the baseline above so e.g. AT + data_protection still gets
  // GDPR-Art.-28 guidance).
  switch (a) {
    case "it_software":
      lines.push(
        "- Focus: Lizenz- und Nutzungsrechte (umfassend / einfach / " +
        "ausschließlich), Rechte an Arbeitsergebnissen (Source vs. Object " +
        "Code, Open-Source-Compliance), SLAs und Pönalen, Wartung/Updates, " +
        "Drittlizenzen, Haftung bei Datenverlust, Audit-Rechte. Frage immer " +
        "nach Verarbeitung personenbezogener Daten (→ AVV-Bedarf).",
      );
      break;
    case "service":
      lines.push(
        "- Focus: Dienstvertrag vs. Werkvertrag-Abgrenzung (§§ 611, 631 BGB), " +
        "Abnahme/Mängelhaftung, Vergütungsmodell (T&M vs. Fixed Price), " +
        "Subunternehmer, Mitwirkungspflichten, Eskalation.",
      );
      break;
    case "supply_purchase":
      lines.push(
        "- Focus: Eigentumsvorbehalt (einfach/erweitert/verlängert), " +
        "Gewährleistung und Mängelrechte (§§ 434 ff. BGB), Lieferzeit & " +
        "Verzug, Force Majeure, INCOTERMS-Verweise, Haftung für Folgeschäden.",
      );
      break;
    case "labor":
      lines.push(
        "- Focus: Befristung (TzBfG), Probezeit/Kündigungsfrist (§ 622 BGB), " +
        "Kündigungsschutz (KSchG ab 6 Monate Betriebszugehörigkeit), " +
        "AGG-Compliance, Wettbewerbsverbot (§§ 74 ff. HGB), Mitbestimmung des " +
        "Betriebsrats (§§ 87, 99 BetrVG). Bei DE: Hinweis auf MiLoG-Schwelle.",
      );
      break;
    case "data_protection":
      lines.push(
        "- Focus: AVV nach Art. 28 DSGVO (Mindestinhalte: Art und Zweck, " +
        "Dauer, Kategorien betroffener Personen, TOMs), Verantwortlichkeit, " +
        "Sub-Auftragsverarbeiter (Art. 28 III lit. d), Löschung/Rückgabe " +
        "(Art. 28 III lit. g), Drittlandsübermittlung (SCCs / Art. 46 DSGVO), " +
        "Meldepflichten (Art. 33), Audit-Rechte. Bei sensiblen Daten zusätzlich " +
        "Art. 9 DSGVO + besondere Schutzmaßnahmen.",
      );
      break;
    case "license":
      lines.push(
        "- Focus: Umfang (territorial, zeitlich, sachlich), " +
        "Übertragbarkeit/Unterlizenzierung, Rechte-/Pflichten-Asymmetrien, " +
        "Royalty-Modell, Audit-Rechte, IP-Indemnification (Schad- und " +
        "Klagloshaltung bei Verletzungsklagen Dritter).",
      );
      break;
    case "m_a":
      lines.push(
        "- Focus: W&R-Katalog (Garantien), Disclosure-Letter, Earn-out, " +
        "Closing-Bedingungen (CPs), MAC-Klauseln, Indemnification-Caps, " +
        "Verjährung, Wettbewerbsverbot der Verkäufer, Change-of-Control-" +
        "Trigger in Bestandsverträgen.",
      );
      break;
    case "nda":
      lines.push(
        "- Focus: Definition Vertrauliche Informationen (positiv und negativ), " +
        "Dauer der Geheimhaltung (üblich 3-5 Jahre, bei Geschäftsgeheimnissen " +
        "auch unbefristet), Rückgabe/Vernichtung, einseitig vs. gegenseitig, " +
        "Vertragsstrafe (DE: nur nach AGB-Kontrolle stand-fest), Carve-outs.",
      );
      break;
    case "framework":
      lines.push(
        "- Focus: Anwendungsbereich des Rahmens vs. Einzelaufträge (Vorrang-" +
        "Klausel), Mindestabnahme/Forecast, Preisanpassung, Laufzeit & " +
        "Kündigung der Einzelaufträge vs. Rahmen, Reporting-Pflichten.",
      );
      break;
    case "agb_relevant":
      lines.push(
        "- Focus: Inhaltskontrolle nach §§ 305-310 BGB ist DEFAULT. Prüfe " +
        "Klausel-für-Klausel auf Verstöße gegen § 307 (unangemessene " +
        "Benachteiligung), § 308 (Klauselverbote mit Wertungsmöglichkeit) und " +
        "§ 309 (Klauselverbote ohne Wertungsmöglichkeit). Markiere AGB-" +
        "kritische Klauseln als 'high'.",
      );
      break;
    case "other":
      lines.push(
        "- Focus: Specific practice area not classified — fall back to " +
        "general commercial-contract heuristics (formation, risk, exit) and " +
        "flag the missing classification.",
      );
      break;
  }

  // Cross-cutting reminder so the model always groups output by domain area
  // (consumed by the UI for the grouped risk-findings view).
  lines.push(
    "- When you emit riskSignals, add an `area` label (in German, e.g. " +
    "'IT-Recht', 'Datenschutz', 'AGB-Kontrolle') so findings can be grouped.",
  );

  return lines.join("\n");
}

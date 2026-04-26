/**
 * Initial-Seed der externen Rechtsquellen (Task #227).
 *
 * Inhalt: zentrale deutsche Privat-/Vertragsrechtsnormen sowie EU-DSGVO,
 * die für B2B-Vertrieb regelmäßig in Vertragsverhandlungen referenziert
 * werden. Tenant-NULL = systemweit verfügbar; jeder Tenant kann zusätzlich
 * eigene Quellen anlegen.
 *
 * Idempotent: nutzt unique(tenant_id, norm_ref) und ON CONFLICT DO NOTHING.
 * Wir aktualisieren bestehende System-Quellen NICHT automatisch — falls eine
 * Norm geändert wurde, ist das ein bewusster Eingriff (z. B. Gesetzesnovelle).
 */
import { db, legalSourcesTable } from "@workspace/db";
import { logger } from "./logger";

interface SeedSource {
  id: string;
  normRef: string;
  title: string;
  jurisdiction: string;
  areaOfLaw: string;
  hierarchy: string;
  fullText: string;
  summary: string;
  keywords: string[];
  url?: string;
  validFrom?: string;
}

const SOURCES: SeedSource[] = [
  // ─── BGB — AGB-Kontrolle (§§ 305-310) ───
  {
    id: "ls_bgb_305",
    normRef: "BGB § 305",
    title: "Einbeziehung Allgemeiner Geschäftsbedingungen in den Vertrag",
    jurisdiction: "DE",
    areaOfLaw: "contract",
    hierarchy: "statute",
    fullText:
      "Allgemeine Geschäftsbedingungen sind alle für eine Vielzahl von Verträgen vorformulierten Vertragsbedingungen, die eine Vertragspartei (Verwender) der anderen Vertragspartei bei Abschluss eines Vertrags stellt. AGB werden nur dann Bestandteil eines Vertrags, wenn der Verwender bei Vertragsschluss die andere Vertragspartei ausdrücklich oder durch deutlich sichtbaren Aushang auf sie hinweist und ihr die Möglichkeit verschafft, in zumutbarer Weise Kenntnis zu nehmen, und die andere Vertragspartei mit ihrer Geltung einverstanden ist.",
    summary:
      "Definition AGB; Einbeziehungsvoraussetzungen (Hinweis, zumutbare Kenntnisnahme, Einverständnis). Im B2B-Verkehr gelten erleichterte Anforderungen (§ 310).",
    keywords: ["AGB", "Einbeziehung", "Geschäftsbedingungen", "Verwender", "B2B"],
    url: "https://dejure.org/gesetze/BGB/305.html",
  },
  {
    id: "ls_bgb_305c",
    normRef: "BGB § 305c",
    title: "Überraschende und mehrdeutige Klauseln",
    jurisdiction: "DE",
    areaOfLaw: "contract",
    hierarchy: "statute",
    fullText:
      "Bestimmungen in Allgemeinen Geschäftsbedingungen, die nach den Umständen, insbesondere nach dem äußeren Erscheinungsbild des Vertrags, so ungewöhnlich sind, dass der Vertragspartner des Verwenders mit ihnen nicht zu rechnen braucht, werden nicht Vertragsbestandteil. Zweifel bei der Auslegung Allgemeiner Geschäftsbedingungen gehen zu Lasten des Verwenders.",
    summary:
      "Überraschende AGB-Klauseln werden nicht Vertragsbestandteil. Mehrdeutigkeiten gehen zu Lasten des Verwenders (Unklarheitenregel).",
    keywords: ["AGB", "überraschend", "Unklarheitenregel", "Auslegung", "Verwender"],
    url: "https://dejure.org/gesetze/BGB/305c.html",
  },
  {
    id: "ls_bgb_307",
    normRef: "BGB § 307",
    title: "Inhaltskontrolle — unangemessene Benachteiligung",
    jurisdiction: "DE",
    areaOfLaw: "contract",
    hierarchy: "statute",
    fullText:
      "Bestimmungen in Allgemeinen Geschäftsbedingungen sind unwirksam, wenn sie den Vertragspartner des Verwenders entgegen den Geboten von Treu und Glauben unangemessen benachteiligen. Eine unangemessene Benachteiligung kann sich auch daraus ergeben, dass die Bestimmung nicht klar und verständlich ist (Transparenzgebot). Eine unangemessene Benachteiligung ist im Zweifel anzunehmen, wenn eine Bestimmung mit wesentlichen Grundgedanken der gesetzlichen Regelung, von der abgewichen wird, nicht zu vereinbaren ist, oder wesentliche Rechte oder Pflichten, die sich aus der Natur des Vertrags ergeben, so einschränkt, dass die Erreichung des Vertragszwecks gefährdet ist.",
    summary:
      "Generalklausel der AGB-Inhaltskontrolle. Unwirksamkeit bei unangemessener Benachteiligung (Treu und Glauben). Transparenzgebot. Auch im B2B anwendbar.",
    keywords: [
      "AGB",
      "Inhaltskontrolle",
      "unangemessene Benachteiligung",
      "Transparenzgebot",
      "Treu und Glauben",
      "Haftungsausschluss",
    ],
    url: "https://dejure.org/gesetze/BGB/307.html",
  },
  {
    id: "ls_bgb_308",
    normRef: "BGB § 308",
    title: "Klauselverbote mit Wertungsmöglichkeit",
    jurisdiction: "DE",
    areaOfLaw: "contract",
    hierarchy: "statute",
    fullText:
      "In Allgemeinen Geschäftsbedingungen ist insbesondere unwirksam: 1. Annahme- und Leistungsfristen; 2. Nachfrist; 3. Rücktrittsvorbehalt; 4. Änderungsvorbehalt; 5. fingierte Erklärungen; 6. fingierter Zugang; 7. Abwicklung von Verträgen; 8. Nichtverfügbarkeit der Leistung.",
    summary:
      "Konkrete Klauselverbote mit Wertungsmöglichkeit (Annahmefristen, Änderungsvorbehalte, fingierte Erklärungen). Kein automatisches Verbot — Einzelfallabwägung.",
    keywords: ["AGB", "Klauselverbot", "Annahmefrist", "Änderungsvorbehalt"],
    url: "https://dejure.org/gesetze/BGB/308.html",
  },
  {
    id: "ls_bgb_309",
    normRef: "BGB § 309",
    title: "Klauselverbote ohne Wertungsmöglichkeit",
    jurisdiction: "DE",
    areaOfLaw: "contract",
    hierarchy: "statute",
    fullText:
      "Auch soweit eine Abweichung von den gesetzlichen Vorschriften zulässig ist, ist in Allgemeinen Geschäftsbedingungen unwirksam: 1. kurzfristige Preiserhöhungen; 2. Leistungsverweigerungsrechte; 3. Aufrechnungsverbot; 4. Mahnung, Fristsetzung; 5. Pauschalierung von Schadensersatzansprüchen; 6. Vertragsstrafe; 7. Haftungsausschluss bei Verletzung von Leben, Körper, Gesundheit und bei grobem Verschulden; 8. sonstige Haftungsausschlüsse; …",
    summary:
      "Absolute AGB-Verbote (kein Ermessen): Haftungsausschluss bei Vorsatz/grober Fahrlässigkeit, bei Personenschäden; pauschalierter Schadensersatz; Aufrechnungsverbot. Wichtigste Norm für Haftungsklauseln.",
    keywords: [
      "AGB",
      "Haftungsausschluss",
      "grobe Fahrlässigkeit",
      "Vorsatz",
      "Vertragsstrafe",
      "Aufrechnungsverbot",
      "Schadensersatz",
    ],
    url: "https://dejure.org/gesetze/BGB/309.html",
  },
  {
    id: "ls_bgb_310",
    normRef: "BGB § 310",
    title: "Anwendungsbereich (B2B-Modifikation der AGB-Kontrolle)",
    jurisdiction: "DE",
    areaOfLaw: "contract",
    hierarchy: "statute",
    fullText:
      "§ 305 Absatz 2 und 3, § 308 Nummer 1, 2 bis 8 und § 309 finden keine Anwendung auf Allgemeine Geschäftsbedingungen, die gegenüber einem Unternehmer verwendet werden. § 307 Absatz 1 und 2 sowie die §§ 305c und 306 finden Anwendung. Bei der Beurteilung ist auf die im Handelsverkehr geltenden Gewohnheiten und Gebräuche angemessene Rücksicht zu nehmen.",
    summary:
      "Im B2B sind §§ 305 II/III, 308, 309 nicht direkt anwendbar — wohl aber § 307 (Generalklausel) sowie §§ 305c, 306. Die Wertungen aus §§ 308/309 strahlen aber als Indizwirkung in die Inhaltskontrolle nach § 307 aus.",
    keywords: ["AGB", "B2B", "Unternehmer", "Indizwirkung", "Handelsbrauch"],
    url: "https://dejure.org/gesetze/BGB/310.html",
  },
  // ─── BGB — Schuldrecht AT ───
  {
    id: "ls_bgb_280",
    normRef: "BGB § 280",
    title: "Schadensersatz wegen Pflichtverletzung",
    jurisdiction: "DE",
    areaOfLaw: "contract",
    hierarchy: "statute",
    fullText:
      "Verletzt der Schuldner eine Pflicht aus dem Schuldverhältnis, so kann der Gläubiger Ersatz des hierdurch entstehenden Schadens verlangen. Dies gilt nicht, wenn der Schuldner die Pflichtverletzung nicht zu vertreten hat. Schadensersatz wegen Verzögerung der Leistung kann der Gläubiger nur unter der zusätzlichen Voraussetzung des § 286 verlangen.",
    summary:
      "Zentrale Anspruchsgrundlage für Schadensersatz wegen Pflichtverletzung. Verschulden wird vermutet — Schuldner muss Exkulpation beweisen.",
    keywords: [
      "Schadensersatz",
      "Pflichtverletzung",
      "Verschulden",
      "Haftung",
      "Schuldner",
    ],
    url: "https://dejure.org/gesetze/BGB/280.html",
  },
  {
    id: "ls_bgb_311",
    normRef: "BGB § 311",
    title: "Rechtsgeschäftliche und rechtsgeschäftsähnliche Schuldverhältnisse (c.i.c.)",
    jurisdiction: "DE",
    areaOfLaw: "contract",
    hierarchy: "statute",
    fullText:
      "Ein Schuldverhältnis mit Pflichten nach § 241 Absatz 2 entsteht auch durch die Aufnahme von Vertragsverhandlungen, die Anbahnung eines Vertrags oder ähnliche geschäftliche Kontakte. Verletzungen vorvertraglicher Pflichten begründen Haftung nach § 280.",
    summary:
      "Vorvertragliche Schuldverhältnisse (culpa in contrahendo). Verletzung von Aufklärungs-/Rücksichtnahmepflichten in der Anbahnung kann zu Schadensersatz führen.",
    keywords: ["c.i.c.", "vorvertraglich", "culpa in contrahendo", "Anbahnung"],
    url: "https://dejure.org/gesetze/BGB/311.html",
  },
  {
    id: "ls_bgb_433",
    normRef: "BGB § 433",
    title: "Vertragstypische Pflichten beim Kaufvertrag",
    jurisdiction: "DE",
    areaOfLaw: "contract",
    hierarchy: "statute",
    fullText:
      "Durch den Kaufvertrag wird der Verkäufer einer Sache verpflichtet, dem Käufer die Sache zu übergeben und das Eigentum an der Sache zu verschaffen. Der Verkäufer hat dem Käufer die Sache frei von Sach- und Rechtsmängeln zu verschaffen. Der Käufer ist verpflichtet, dem Verkäufer den vereinbarten Kaufpreis zu zahlen und die gekaufte Sache abzunehmen.",
    summary:
      "Grundpflichten Kaufvertrag: Übergabe + Eigentumsverschaffung mängelfrei vs. Kaufpreiszahlung + Abnahme.",
    keywords: ["Kaufvertrag", "Übergabe", "Eigentum", "Mängelfreiheit", "Kaufpreis"],
    url: "https://dejure.org/gesetze/BGB/433.html",
  },
  {
    id: "ls_bgb_626",
    normRef: "BGB § 626",
    title: "Außerordentliche Kündigung aus wichtigem Grund",
    jurisdiction: "DE",
    areaOfLaw: "contract",
    hierarchy: "statute",
    fullText:
      "Das Dienstverhältnis kann von jedem Vertragsteil aus wichtigem Grund ohne Einhaltung einer Kündigungsfrist gekündigt werden, wenn Tatsachen vorliegen, auf Grund derer dem Kündigenden unter Berücksichtigung aller Umstände des Einzelfalls und unter Abwägung der Interessen beider Vertragsteile die Fortsetzung des Dienstverhältnisses bis zum Ablauf der Kündigungsfrist nicht zugemutet werden kann. Die Kündigung kann nur innerhalb von zwei Wochen erfolgen.",
    summary:
      "Außerordentliche Kündigung aus wichtigem Grund (auch für Dauerschuldverhältnisse außerhalb des Arbeitsrechts indikativ). Zwei-Wochen-Frist ab Kenntnis.",
    keywords: ["Kündigung", "wichtiger Grund", "fristlos", "Dauerschuldverhältnis"],
    url: "https://dejure.org/gesetze/BGB/626.html",
  },
  // ─── HGB — Handelsverkehr ───
  {
    id: "ls_hgb_343",
    normRef: "HGB § 343",
    title: "Handelsgeschäfte",
    jurisdiction: "DE",
    areaOfLaw: "commercial",
    hierarchy: "statute",
    fullText:
      "Handelsgeschäfte sind alle Geschäfte eines Kaufmanns, die zum Betriebe seines Handelsgewerbes gehören.",
    summary:
      "Definition Handelsgeschäft. Aktiviert die handelsrechtlichen Sonderregeln (§§ 343 ff. HGB) für B2B-Verträge.",
    keywords: ["Handelsgeschäft", "Kaufmann", "B2B"],
    url: "https://dejure.org/gesetze/HGB/343.html",
  },
  {
    id: "ls_hgb_346",
    normRef: "HGB § 346",
    title: "Handelsbräuche",
    jurisdiction: "DE",
    areaOfLaw: "commercial",
    hierarchy: "statute",
    fullText:
      "Unter Kaufleuten ist in Ansehung der Bedeutung und Wirkung von Handlungen und Unterlassungen auf die im Handelsverkehre geltenden Gewohnheiten und Gebräuche Rücksicht zu nehmen.",
    summary:
      "Handelsbräuche als Auslegungs-/Ergänzungsmaßstab. Wichtig für B2B-AGB (§ 310 BGB).",
    keywords: ["Handelsbrauch", "Auslegung", "Handelsverkehr"],
    url: "https://dejure.org/gesetze/HGB/346.html",
  },
  {
    id: "ls_hgb_347",
    normRef: "HGB § 347",
    title: "Sorgfalt eines ordentlichen Kaufmanns",
    jurisdiction: "DE",
    areaOfLaw: "commercial",
    hierarchy: "statute",
    fullText:
      "Wer aus einem Geschäfte, das auf seiner Seite ein Handelsgeschäft ist, einem anderen zur Sorgfalt verpflichtet ist, hat für die Sorgfalt eines ordentlichen Kaufmanns einzustehen.",
    summary:
      "Erhöhter Sorgfaltsmaßstab im B2B (Kaufmannssorgfalt). Beeinflusst Verschuldensbewertung im Schadensersatz.",
    keywords: ["Sorgfalt", "Kaufmann", "Haftungsmaßstab"],
    url: "https://dejure.org/gesetze/HGB/347.html",
  },
  {
    id: "ls_hgb_350",
    normRef: "HGB § 350",
    title: "Formfreiheit für Bürgschaft, Schuldversprechen, Schuldanerkenntnis (Handelsgeschäft)",
    jurisdiction: "DE",
    areaOfLaw: "commercial",
    hierarchy: "statute",
    fullText:
      "Auf eine Bürgschaft, ein Schuldversprechen oder ein Schuldanerkenntnis findet, sofern auf Seiten des Bürgen, des Versprechenden oder des Anerkennenden das Geschäft ein Handelsgeschäft ist, die Formvorschrift des § 766 Satz 1, 2, des § 780 oder des § 781 Satz 1 BGB keine Anwendung.",
    summary:
      "Im Handelsverkehr sind Bürgschaft/Schuldversprechen formfrei möglich (kein Schriftformerfordernis nach BGB).",
    keywords: ["Form", "Bürgschaft", "Handelsgeschäft", "Schriftform"],
    url: "https://dejure.org/gesetze/HGB/350.html",
  },
  // ─── GWB — Wettbewerb ───
  {
    id: "ls_gwb_1",
    normRef: "GWB § 1",
    title: "Verbot wettbewerbsbeschränkender Vereinbarungen",
    jurisdiction: "DE",
    areaOfLaw: "competition",
    hierarchy: "statute",
    fullText:
      "Vereinbarungen zwischen Unternehmen, Beschlüsse von Unternehmensvereinigungen und aufeinander abgestimmte Verhaltensweisen, die eine Verhinderung, Einschränkung oder Verfälschung des Wettbewerbs bezwecken oder bewirken, sind verboten.",
    summary:
      "Kartellverbot. Relevant bei Preisabsprachen, Marktaufteilung, Vertriebsbindungen in B2B-Verträgen.",
    keywords: ["Kartell", "Wettbewerb", "Preisabsprache", "Vertriebsbindung"],
    url: "https://dejure.org/gesetze/GWB/1.html",
  },
  {
    id: "ls_gwb_19",
    normRef: "GWB § 19",
    title: "Verbotenes Verhalten von marktbeherrschenden Unternehmen",
    jurisdiction: "DE",
    areaOfLaw: "competition",
    hierarchy: "statute",
    fullText:
      "Die missbräuchliche Ausnutzung einer marktbeherrschenden Stellung durch ein oder mehrere Unternehmen ist verboten. Ein Missbrauch liegt insbesondere vor, wenn ein marktbeherrschendes Unternehmen ein anderes Unternehmen unbillig behindert oder ohne sachlich gerechtfertigten Grund von Geschäftsverkehr ungleich behandelt.",
    summary:
      "Missbrauchsverbot für marktbeherrschende Unternehmen. Wichtig bei Konditionenmissbrauch, Lieferverweigerung, Diskriminierung.",
    keywords: ["Marktbeherrschung", "Missbrauch", "Diskriminierung", "Konditionen"],
    url: "https://dejure.org/gesetze/GWB/19.html",
  },
  // ─── DSGVO ───
  {
    id: "ls_dsgvo_6",
    normRef: "DSGVO Art. 6",
    title: "Rechtmäßigkeit der Verarbeitung",
    jurisdiction: "EU",
    areaOfLaw: "data_protection",
    hierarchy: "regulation",
    fullText:
      "Die Verarbeitung ist nur rechtmäßig, wenn mindestens eine der folgenden Bedingungen erfüllt ist: a) Einwilligung; b) Vertragserfüllung; c) rechtliche Verpflichtung; d) lebenswichtige Interessen; e) öffentliches Interesse; f) berechtigte Interessen.",
    summary:
      "Rechtsgrundlagen der Datenverarbeitung. Im B2B meist lit. b (Vertragserfüllung) oder lit. f (berechtigtes Interesse).",
    keywords: [
      "DSGVO",
      "Rechtsgrundlage",
      "Einwilligung",
      "berechtigtes Interesse",
      "Datenverarbeitung",
    ],
    url: "https://dejure.org/gesetze/DSGVO/6.html",
  },
  {
    id: "ls_dsgvo_28",
    normRef: "DSGVO Art. 28",
    title: "Auftragsverarbeitung",
    jurisdiction: "EU",
    areaOfLaw: "data_protection",
    hierarchy: "regulation",
    fullText:
      "Erfolgt eine Verarbeitung im Auftrag eines Verantwortlichen, so arbeitet dieser nur mit Auftragsverarbeitern, die hinreichend Garantien dafür bieten, dass geeignete technische und organisatorische Maßnahmen so durchgeführt werden, dass die Verarbeitung im Einklang mit den Anforderungen dieser Verordnung erfolgt. Die Verarbeitung durch einen Auftragsverarbeiter erfolgt auf der Grundlage eines Vertrags.",
    summary:
      "Anforderungen an Auftragsverarbeitungs-Vereinbarung (AVV). Pflicht-Inhalte: Gegenstand, Dauer, TOMs, Subunternehmer, Weisungen, Löschung.",
    keywords: [
      "DSGVO",
      "Auftragsverarbeitung",
      "AVV",
      "Subunternehmer",
      "TOM",
      "Auftragsverarbeiter",
    ],
    url: "https://dejure.org/gesetze/DSGVO/28.html",
  },
  {
    id: "ls_dsgvo_32",
    normRef: "DSGVO Art. 32",
    title: "Sicherheit der Verarbeitung",
    jurisdiction: "EU",
    areaOfLaw: "data_protection",
    hierarchy: "regulation",
    fullText:
      "Unter Berücksichtigung des Stands der Technik treffen der Verantwortliche und der Auftragsverarbeiter geeignete technische und organisatorische Maßnahmen, um ein dem Risiko angemessenes Schutzniveau zu gewährleisten; diese Maßnahmen schließen gegebenenfalls Pseudonymisierung und Verschlüsselung ein.",
    summary:
      "Pflicht zu technisch-organisatorischen Maßnahmen (TOMs): Pseudonymisierung, Verschlüsselung, Verfügbarkeit, regelmäßige Überprüfung.",
    keywords: ["DSGVO", "TOM", "Verschlüsselung", "Pseudonymisierung", "Sicherheit"],
    url: "https://dejure.org/gesetze/DSGVO/32.html",
  },
  // ─── UWG ───
  {
    id: "ls_uwg_3",
    normRef: "UWG § 3",
    title: "Verbot unlauterer geschäftlicher Handlungen",
    jurisdiction: "DE",
    areaOfLaw: "competition",
    hierarchy: "statute",
    fullText:
      "Unlautere geschäftliche Handlungen sind unzulässig. Die im Anhang dieses Gesetzes aufgeführten geschäftlichen Handlungen gegenüber Verbrauchern sind stets unzulässig.",
    summary:
      "Generalklausel des Lauterkeitsrechts. Im B2B-Vertrieb relevant für Marketingaussagen, Vergleiche, Aussagen über Wettbewerber.",
    keywords: ["UWG", "unlauter", "geschäftliche Handlung"],
    url: "https://dejure.org/gesetze/UWG/3.html",
  },
  {
    id: "ls_uwg_5",
    normRef: "UWG § 5",
    title: "Irreführende geschäftliche Handlungen",
    jurisdiction: "DE",
    areaOfLaw: "competition",
    hierarchy: "statute",
    fullText:
      "Unlauter handelt, wer eine irreführende geschäftliche Handlung vornimmt, die geeignet ist, den Verbraucher oder sonstigen Marktteilnehmer zu einer geschäftlichen Entscheidung zu veranlassen, die er andernfalls nicht getroffen hätte.",
    summary:
      "Irreführungsverbot. Achtung bei Produktversprechen, Verfügbarkeitsangaben, Preis- und Leistungsvergleichen im Angebot.",
    keywords: ["UWG", "Irreführung", "Werbeaussage", "Marktteilnehmer"],
    url: "https://dejure.org/gesetze/UWG/5.html",
  },
  {
    id: "ls_uwg_7",
    normRef: "UWG § 7",
    title: "Unzumutbare Belästigungen",
    jurisdiction: "DE",
    areaOfLaw: "competition",
    hierarchy: "statute",
    fullText:
      "Eine geschäftliche Handlung, durch die ein Marktteilnehmer in unzumutbarer Weise belästigt wird, ist unzulässig. Dies gilt insbesondere für Werbung, obwohl erkennbar ist, dass der angesprochene Marktteilnehmer diese Werbung nicht wünscht.",
    summary:
      "Spam-/Cold-Call-Verbot. B2B-Werbeanrufe bedürfen mutmaßlicher Einwilligung; E-Mail-Werbung an Unternehmen nur mit ausdrücklicher Zustimmung.",
    keywords: ["UWG", "Belästigung", "Werbung", "Cold Call", "Spam", "Einwilligung"],
    url: "https://dejure.org/gesetze/UWG/7.html",
  },
];

export async function seedLegalSourcesIdempotent(): Promise<void> {
  // Standardquellen sind tenantId NULL → über alle Tenants sichtbar.
  // ON CONFLICT (tenant_id, norm_ref) DO NOTHING — wir überschreiben nicht,
  // damit Tenant-spezifische Anpassungen erhalten bleiben.
  const rows = SOURCES.map((s) => ({
    id: s.id,
    tenantId: null,
    normRef: s.normRef,
    title: s.title,
    jurisdiction: s.jurisdiction,
    areaOfLaw: s.areaOfLaw,
    hierarchy: s.hierarchy,
    fullText: s.fullText,
    summary: s.summary,
    keywords: s.keywords,
    url: s.url ?? null,
    validFrom: s.validFrom ?? null,
  }));
  await db.insert(legalSourcesTable).values(rows).onConflictDoNothing();
  logger.info({ count: rows.length }, "Seeded legal_sources (system)");
}

// Helpers für die Crawler-basierte Account-Anreicherung
// (Endpoint POST /accounts/enrich-from-website).
//
// Hauptzweck: verhindern, dass aus einem <title>Impressum | Foo Bar</title>
// der Firmenname "Impressum | Foo Bar" wird. Stattdessen sollen wir
// einen plausibel rechtsformbehafteten Namen liefern (oder gar keinen).

// `\b` würde bei punkt-endenden Formen wie "S.A." nicht matchen, weil nach dem
// abschließenden Punkt kein Wort-Übergang stattfindet. Daher explizite
// Lookarounds, die nur Buchstaben/Ziffern als „angrenzendes Wort" verstehen.
const LEGAL_FORM_RE =
  /(?<![A-Za-z0-9])(?:GmbH(?:\s*&\s*Co\.?\s*KG)?|AG|UG\s*\(haftungsbeschränkt\)|UG|KG|OHG|SE|eG|e\.G\.|e\.V\.|e\.K\.|GbR|mbH|S\.E\.|gAG|gGmbH|Stiftung|Ltd\.?|LLC|Inc\.?|Corp\.?|S\.A\.S\.|S\.A\.|S\.r\.l\.|S\.L\.|B\.V\.|N\.V\.|Sp\.\s*z\s*o\.o\.|AB|AS|Oy|A\/S|sp\.\s*j\.|S\.p\.A\.|Ltda\.?|Pty\.?\s*Ltd\.?|PLC)(?![A-Za-z0-9])/i;

const BOILERPLATE_TOKENS_RE =
  /^(?:impressum|imprint|legal\s*notice|legal\s*info|legal|disclaimer|kontakt|contact|home|startseite|start|about|über\s*uns|ueber\s*uns|datenschutz|privacy(?:\s*policy)?|agb|terms|menu|menü|loading|404|not\s*found|index|willkommen|welcome)$/i;

/**
 * Liefert true, wenn der String eine Rechtsform enthält (GmbH, AG, GbR, …).
 * Wird genutzt, um zu entscheiden, ob ein Kandidat ein plausibler
 * Firmenname mit Rechtsform ist.
 */
export function hasLegalForm(s: string): boolean {
  return LEGAL_FORM_RE.test(s);
}

// Wörter, die niemals in einem Firmennamen vorkommen sollen — wenn sie als
// Präfix auftauchen, werden sie weggeschnitten (auch ohne Trenner).
const LEADING_BOILERPLATE_RE =
  /^(?:Impressum|Imprint|Legal\s*Notice|Legal\s*Info|Disclaimer|Kontakt|Contact|Home|Startseite|Über\s*uns|Ueber\s*uns|Datenschutz|Privacy(?:\s*Policy)?|AGB|Terms|Willkommen|Welcome)\b\s*[:|–—\-•·]?\s*/i;

/**
 * Säubert einen Kandidaten-Firmennamen:
 *  - Whitespace normalisieren
 *  - Führendes Boilerplate-Wort (Impressum, Kontakt, …) abschneiden — auch
 *    wenn dahinter eine Rechtsform steht (User-Requirement: Name darf nie
 *    mit „Impressum" beginnen).
 *  - Wenn Rest leer, zu kurz oder ein bekanntes Boilerplate-Wort → null
 *
 * Diese Funktion wirft NIE — sie liefert immer einen sauberen String oder null.
 */
export function sanitizeCompanyName(input: string | null | undefined): string | null {
  if (!input) return null;
  let cleaned = input.replace(/\s+/g, " ").trim();
  if (cleaned.length < 2) return null;
  // Führende Boilerplate-Wörter entfernen — auch mehrfach hintereinander
  // (z. B. „Impressum Kontakt Foo GmbH"). Maximal 3 Iterationen reichen
  // praktisch immer und verhindern eine theoretische Endlosschleife.
  for (let i = 0; i < 3; i++) {
    const stripped = cleaned.replace(LEADING_BOILERPLATE_RE, "").trim();
    if (stripped === cleaned) break;
    cleaned = stripped;
  }
  if (cleaned.length < 2) return null;
  if (BOILERPLATE_TOKENS_RE.test(cleaned)) return null;
  return cleaned;
}

/**
 * Wandelt einen <title>-Text in einen Firmennamen-Kandidaten um.
 *
 * - Trenner sind: |, –, —, -, :, • und ·.
 * - Erkennt Boilerplate-Tokens an Präfix UND Suffix-Position und schneidet sie ab.
 *   Beispiele:
 *     "Impressum | direct&friendly Bio Produkte"  → "direct&friendly Bio Produkte"
 *     "Foo Bar GmbH – Impressum"                  → "Foo Bar GmbH"
 *     "Home | Foo Bar"                            → "Foo Bar"
 *     "Foo Bar | Kontakt"                         → "Foo Bar"
 * - Wenn nach dem Strippen nur noch ein Boilerplate-Token übrig bleibt → null.
 * - Wenn mehrere Segmente übrig bleiben, bevorzugt das mit einer Rechtsform;
 *   sonst das längste.
 */
export function extractCompanyNameFromTitle(rawTitle: string | null | undefined): string | null {
  if (!rawTitle) return null;
  const title = rawTitle.replace(/\s+/g, " ").trim();
  if (!title) return null;

  const segments = title
    .split(/\s*[|–—\-:•·]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Boilerplate-Segmente raus.
  const cleaned = segments.filter((s) => !BOILERPLATE_TOKENS_RE.test(s));

  if (cleaned.length === 0) return null;
  if (cleaned.length === 1) return sanitizeCompanyName(cleaned[0]!);

  // Mehrere Kandidaten: bevorzuge eines mit Rechtsform.
  const withForm = cleaned.find((s) => LEGAL_FORM_RE.test(s));
  if (withForm) return sanitizeCompanyName(withForm);

  // Sonst das längste — Marken/Firmennamen sind fast immer länger als Slogans.
  cleaned.sort((a, b) => b.length - a.length);
  return sanitizeCompanyName(cleaned[0]!);
}

/**
 * Sucht im freien Plaintext (z. B. aus dem Impressum) die erste Phrase,
 * die wie "Foo Bar GmbH", "Foo & Co. KG", "Foo AG" aussieht.
 *
 * Akzeptiert nur Phrasen, deren erstes "Wort" mit einem Großbuchstaben
 * beginnt; verwirft offensichtliche Header-Bezeichner ("Impressum nach …").
 */
export function findLegalEntityInText(text: string | null | undefined): string | null {
  if (!text) return null;
  // Zeilenweise scannen ist viel robuster als ein einzelner greedy Regex
  // (sonst frisst der Head Sätze wie "Anbieter dieser Webseite ist die"
  // mit). Firmenangaben im Impressum stehen praktisch immer auf einer
  // eigenen Zeile.
  const lines = text.split(/\r?\n/);
  const FORM_TOKEN =
    "(GmbH(?:\\s*&\\s*Co\\.?\\s*KG)?|AG|UG\\s*\\(haftungsbeschränkt\\)|UG|KG|OHG|SE|eG|e\\.G\\.|e\\.V\\.|e\\.K\\.|GbR|mbH|gAG|gGmbH|Ltd\\.?|LLC|Inc\\.?|S\\.A\\.S\\.|S\\.A\\.|S\\.r\\.l\\.|B\\.V\\.|N\\.V\\.)";
  // Head: Großbuchstabe oder Kleinbuchstabe (für "direct&friendly"),
  // 1..5 Tokens, KEINE Satzzeichen außer & . - ' / im Token.
  const lineRe = new RegExp(
    "^\\s*([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9.&'\\-/]*(?:\\s+[A-Za-zÄÖÜäöüß0-9.&'\\-/]+){0,4})\\s+" +
      FORM_TOKEN +
      "(?=[\\s,;.]|$)",
  );
  const JUNK_HEAD_TOKEN =
    /^(?:Impressum|Imprint|Kontakt|Contact|Home|Startseite|Anbieter|Verantwortlich|Inhaber|Betreiber|Firma|Sitz|Eingetragen|Vertretungsberechtigt|Geschäftsführ\w*|Handelsregister|Registergericht|Telefon|Email|E-Mail|Tel|Webseite|Website|USt|Rechtsform|Geschäftssitz)$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = lineRe.exec(line);
    if (!m) continue;
    const head = m[1]!.trim();
    const form = m[2]!;
    const firstWord = head.split(/\s+/)[0]!.replace(/[^A-Za-zÄÖÜäöüß]+$/u, "");
    if (JUNK_HEAD_TOKEN.test(head) || JUNK_HEAD_TOKEN.test(firstWord)) continue;
    // Erstes Zeichen muss Buchstabe sein (Kleinschreibung erlaubt für
    // Markennamen wie "direct&friendly").
    if (!/^[A-Za-zÄÖÜäöüß]/.test(head)) continue;
    return `${head} ${form}`.replace(/\s+/g, " ").trim();
  }
  return null;
}

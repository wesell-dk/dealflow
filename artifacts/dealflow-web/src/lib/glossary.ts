export type GlossaryEntry = {
  label: string;
  short: string;
  long?: string;
};

export type GlossaryGroup = Record<string, GlossaryEntry>;

export const DEAL_STAGES: GlossaryGroup = {
  qualified: {
    label: "Qualifiziert",
    short: "Bedarf bestätigt, Budget grob bekannt – ein realer Kauf-Anlass existiert.",
    long: "Erstkontakt hat stattgefunden, der Kunde hat einen konkreten Anlass und das Budget liegt im plausiblen Rahmen. Noch keine Lösung definiert.",
  },
  discovery: {
    label: "Discovery",
    short: "Anforderungen, Stakeholder und Entscheidungsweg werden geklärt.",
    long: "Tiefes Verständnis aufbauen: Pains, technische Anforderungen, Buying Center, Zeitplan, Mitbewerber. Ergebnis ist ein gemeinsam verstandener Scope.",
  },
  proposal: {
    label: "Angebot",
    short: "Konkretes Angebot ist erstellt und beim Kunden – Reaktion ausstehend.",
    long: "Ein Quote mit Positionen, Preisen und Konditionen liegt versendet vor. Genehmigungen für Discounts/Sonderkonditionen sind eingeholt.",
  },
  negotiation: {
    label: "Verhandlung",
    short: "Konditionen, Klauseln oder Preise werden mit dem Kunden ausgehandelt.",
    long: "Der Kunde stellt Gegenforderungen – z.B. zu Preis, Laufzeit, SLA, Haftung. Verhandlungsschritte werden im Bereich Verhandlungen dokumentiert.",
  },
  closing: {
    label: "Closing",
    short: "Vertrag liegt zur Unterschrift bereit – nur noch formelle Schritte fehlen.",
    long: "Inhalte sind beidseitig akzeptiert, Unterzeichner sind benannt, Vertrag wartet auf Signatur. Risiko ist deutlich reduziert, Forecast hochgewichtet.",
  },
  won: {
    label: "Won",
    short: "Vertrag ist unterschrieben – der Deal zählt zum Umsatz.",
    long: "Geschlossen. Ab hier übernehmen Auftragsbestätigung, Onboarding und ggf. Renewal-Planung im Bereich Folgegeschäft.",
  },
  lost: {
    label: "Lost",
    short: "Deal verloren oder vom Kunden abgesagt – Lost-Reason wird erfasst.",
    long: "Wichtig: Verlustgrund festhalten (Preis, Mitbewerber, Timing, Budget). Diese Daten speisen Reports und Pricing-Analysen.",
  },
};

export const QUOTE_STATUS: GlossaryGroup = {
  draft: {
    label: "Entwurf",
    short: "Angebot wird gerade erstellt – noch nicht versendet, nicht freigegeben.",
  },
  pending_approval: {
    label: "Freigabe ausstehend",
    short: "Discount oder Sonderkondition liegt über dem Schwellwert – wartet auf Genehmigung.",
  },
  approved: {
    label: "Freigegeben",
    short: "Intern abgenommen, kann an den Kunden versendet werden.",
  },
  sent: {
    label: "Versendet",
    short: "Beim Kunden eingegangen – Reaktion (Annahme/Ablehnung) ausstehend.",
  },
  accepted: {
    label: "Angenommen",
    short: "Kunde hat das Angebot bestätigt – Vertrag/Order folgt.",
  },
  rejected: {
    label: "Abgelehnt",
    short: "Kunde lehnt das Angebot ab – ggf. neue Version erforderlich.",
  },
  expired: {
    label: "Abgelaufen",
    short: "Gültigkeitsdatum überschritten – Verlängerung oder neues Angebot nötig.",
  },
};

export const CONTRACT_STATUS: GlossaryGroup = {
  draft: {
    label: "Entwurf",
    short: "Vertragsentwurf wird intern vorbereitet – noch nicht beim Kunden.",
  },
  in_negotiation: {
    label: "In Verhandlung",
    short: "Klauseln und Konditionen werden mit dem Kunden ausgetauscht.",
  },
  pending_signature: {
    label: "Wartet auf Unterschrift",
    short: "Inhalte sind final – Unterzeichner sind benannt, Signaturprozess läuft.",
  },
  active: {
    label: "Aktiv",
    short: "Vertrag ist unterschrieben und in Kraft.",
  },
  expired: {
    label: "Abgelaufen",
    short: "Vertragslaufzeit ist beendet – Renewal-Aktion erforderlich.",
  },
  terminated: {
    label: "Gekündigt",
    short: "Vertrag wurde vor Ablauf beendet – Kündigungsgrund ist dokumentiert.",
  },
};

export const APPROVAL_STATUS: GlossaryGroup = {
  pending: {
    label: "Offen",
    short: "Wartet auf Entscheidung des verantwortlichen Genehmigers.",
  },
  approved: {
    label: "Freigegeben",
    short: "Genehmigt – das auslösende Quote/Vertrag kann fortfahren.",
  },
  rejected: {
    label: "Abgelehnt",
    short: "Nicht genehmigt – Begründung ist im Audit-Log gespeichert.",
  },
  escalated: {
    label: "Eskaliert",
    short: "An die nächste Hierarchie-Stufe weitergeleitet (z.B. Sales Director).",
  },
};

export const SIGNATURE_STATUS: GlossaryGroup = {
  pending: {
    label: "Offen",
    short: "Anfrage ist beim Unterzeichner – noch nicht gehandelt.",
  },
  signed: {
    label: "Unterschrieben",
    short: "Signatur liegt vor – rechtsgültig dokumentiert.",
  },
  declined: {
    label: "Abgelehnt",
    short: "Unterzeichner hat die Signatur verweigert – Vertrag muss überarbeitet werden.",
  },
};

export const ATTACHMENT_CATEGORIES: GlossaryGroup = {
  datasheet: {
    label: "Datenblatt",
    short: "Technische Spezifikation eines Produkts oder einer Leistung.",
  },
  terms: {
    label: "Bedingungen",
    short: "AGB, DPA, NDA oder andere rechtliche Rahmen-Dokumente.",
  },
  reference: {
    label: "Referenz",
    short: "Case Study, Kundenstimme oder vergleichbares Vertrauens-Material.",
  },
  certificate: {
    label: "Zertifikat",
    short: "Compliance-, Sicherheits- oder Qualitätsnachweis (z.B. ISO 27001).",
  },
  other: {
    label: "Sonstiges",
    short: "Alles, was nicht in die obigen Kategorien passt.",
  },
};

export const TENANT_PLANS: GlossaryGroup = {
  Starter: {
    label: "Starter",
    short: "Einstiegsplan – kleine Teams, Grundfunktionen, Basis-Limits.",
  },
  Growth: {
    label: "Growth",
    short: "Wachsende Teams – höhere Limits, erweiterte Reports und Approvals.",
  },
  Business: {
    label: "Business",
    short: "Mittlere Unternehmen – SSO, granulare Rollen, erweiterte Audit-Funktionen.",
  },
  Enterprise: {
    label: "Enterprise",
    short: "Konzernkunden – dedizierte Region, individuelle SLAs, On-Prem-Optionen.",
  },
};

export const TENANT_REGIONS: GlossaryGroup = {
  EU: {
    label: "EU",
    short: "Datenresidenz in der Europäischen Union (Frankfurt) – DSGVO-konform.",
  },
  US: {
    label: "US",
    short: "Datenresidenz in den USA (Virginia) – passend für nordamerikanische Kunden.",
  },
  UK: {
    label: "UK",
    short: "Datenresidenz im Vereinigten Königreich (London) – getrennt von EU-Daten.",
  },
  APAC: {
    label: "APAC",
    short: "Datenresidenz in Asien-Pazifik (Singapur) – Latenz-optimiert für die Region.",
  },
};

export const CONCEPTS: GlossaryGroup = {
  brand: {
    label: "Marke",
    short: "Bestimmt Branding, Vertragsklauseln, Standardpreise und Templates für diesen Deal.",
    long: "Eine Marke (Brand) bündelt visuelles Branding, Default-Klauseln, Listenpreise und Approval-Schwellen. Die hier gewählte Marke wird auf alle Folge-Dokumente (Quote, Vertrag, AB) automatisch übertragen.",
  },
  company: {
    label: "Company",
    short: "Verkaufende juristische Einheit (z.B. „DealFlow GmbH“). Bestimmt Rechnungssteller und Steuer-Setup.",
  },
  owner: {
    label: "Verantwortlich",
    short: "Account Owner – die Person, die diesen Deal aktiv vorantreibt.",
    long: "Owner sieht den Deal in seinem persönlichen Forecast und ist Ansprechpartner für Folge-Tasks (Approvals, Verhandlungen, Renewals).",
  },
  value: {
    label: "Wert",
    short: "Erwarteter Auftragswert in Euro – Basis für Forecast und Pipeline-Analytics.",
    long: "Bei Subscription-Deals: ARR (Annual Recurring Revenue). Bei Einmal-Deals: Gesamtsumme. Wird in Reports nach Phase und Wahrscheinlichkeit gewichtet.",
  },
  expectedCloseDate: {
    label: "Erwartetes Abschlussdatum",
    short: "Datum, an dem der Deal voraussichtlich gewonnen oder verloren ist – speist Forecast-Buckets.",
  },
  probability: {
    label: "Wahrscheinlichkeit",
    short: "Subjektive Einschätzung in Prozent (0–100). Wird mit dem Wert multipliziert, um den Forecast-Beitrag zu berechnen.",
  },
  scope: {
    label: "Scope",
    short: "Welche Marken und Companies ein User sehen darf. Steuert Sichtbarkeit und Bearbeitungsrechte.",
  },
};

export const GLOSSARY = {
  dealStages: DEAL_STAGES,
  quoteStatus: QUOTE_STATUS,
  contractStatus: CONTRACT_STATUS,
  approvalStatus: APPROVAL_STATUS,
  signatureStatus: SIGNATURE_STATUS,
  attachmentCategories: ATTACHMENT_CATEGORIES,
  tenantPlans: TENANT_PLANS,
  tenantRegions: TENANT_REGIONS,
  concepts: CONCEPTS,
} as const;

export type GlossaryGroupKey = keyof typeof GLOSSARY;

export function getEntry(group: GlossaryGroupKey, value: string): GlossaryEntry | null {
  const g = GLOSSARY[group];
  return (g && g[value]) ?? null;
}

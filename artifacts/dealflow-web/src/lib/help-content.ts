import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  FileStack,
  Paperclip,
  BadgeDollarSign,
  CheckSquare,
  FileSignature,
  Handshake,
  PenTool,
  TrendingUp,
  ClipboardCheck,
  BarChart3,
  History,
  Bot,
  Settings,
} from "lucide-react";

export type HelpAction = {
  label: string;
  to: string;
};

export type HelpEntry = {
  route: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  purpose: string;
  howTo: string[];
  prerequisites?: string[];
  nextSteps?: HelpAction[];
  tip?: string;
};

export const WORKFLOW_STEPS: Array<{
  key: string;
  route: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  short: string;
}> = [
  { key: "account",    route: "/accounts",            icon: Users,           title: "1. Kunde",         short: "Kunde anlegen" },
  { key: "deal",       route: "/deals",               icon: Briefcase,       title: "2. Deal",          short: "Opportunity erfassen" },
  { key: "quote",      route: "/quotes",              icon: FileText,        title: "3. Angebot",       short: "Quote erstellen" },
  { key: "approval",   route: "/approvals",           icon: CheckSquare,     title: "4. Freigabe",      short: "Approval einholen" },
  { key: "negotiation",route: "/negotiations",        icon: Handshake,       title: "5. Verhandlung",   short: "Konditionen finalisieren" },
  { key: "contract",   route: "/contracts",           icon: FileSignature,   title: "6. Vertrag",       short: "Vertrag entwerfen" },
  { key: "signature",  route: "/signatures",          icon: PenTool,         title: "7. Unterschrift",  short: "Signatur einholen" },
  { key: "order",      route: "/order-confirmations", icon: ClipboardCheck,  title: "8. Auftrag",       short: "Auftragsbestätigung" },
  { key: "renewal",    route: "/price-increases",     icon: TrendingUp,      title: "9. Folgegeschäft", short: "Preiserhöhung / Renewal" },
];

export const HELP_CONTENT: Record<string, HelpEntry> = {
  "/": {
    route: "/",
    icon: LayoutDashboard,
    title: "Startseite",
    purpose: "Zentrale Übersicht: deine Pipeline, offene Aufgaben, Risiken und Copilot-Hinweise auf einen Blick.",
    howTo: [
      "Kennzahlen-Kacheln (Offene Deals, Win-Rate, Ø Zykluszeit) zeigen den aktuellen Stand deiner Pipeline.",
      "Die Aufgabenliste rechts bündelt offene Freigaben, Unterschriften und Angebote.",
      "Copilot-Hinweise schlagen die nächste sinnvolle Aktion vor – meist mit direktem Sprung in den Deal.",
    ],
    nextSteps: [
      { label: "Pipeline öffnen", to: "/deals" },
      { label: "Offene Freigaben", to: "/approvals" },
    ],
    tip: "Kommst du frisch rein? Beginne mit 'Kunde anlegen', um den roten Faden Account → Deal → Angebot → Vertrag zu starten.",
  },
  "/accounts": {
    route: "/accounts",
    icon: Users,
    title: "Kunden",
    purpose: "Stammdaten aller Geschäftskunden inkl. Health-Score, offene Deals und Gesamtwert.",
    howTo: [
      "Klick oben rechts auf 'Kunde anlegen', um einen neuen Account mit Name, Branche und Land zu erstellen.",
      "Klick auf einen Kundennamen, um Kontakte und alle zugehörigen Deals zu sehen.",
      "Health-Score zeigt sofort, ob ein Kunde aktive Aufmerksamkeit braucht (rot) oder stabil ist (grün).",
    ],
    nextSteps: [
      { label: "Erste Deals der Pipeline", to: "/deals" },
    ],
    tip: "Lege Kunden bewusst sauber an – sie sind der Ankerpunkt für alle Deals, Verträge und Auftragsbestätigungen.",
  },
  "/deals": {
    route: "/deals",
    icon: Briefcase,
    title: "Deals",
    purpose: "Aktive Verkaufschancen – die Pipeline-Ansicht zeigt Phasen, Werte und Verantwortliche.",
    howTo: [
      "'Deal anlegen' öffnet das Formular mit Pflichtfeldern (Kunde, Marke, Wert, Phase, Verantwortlich).",
      "Phasen: Qualifiziert → Discovery → Angebot → Verhandlung → Closing → Won/Lost.",
      "Klick auf einen Deal für Details, Quotes, Verträge und Aktivitätshistorie.",
    ],
    prerequisites: ["Mindestens ein Kunde existiert."],
    nextSteps: [
      { label: "Angebot erstellen", to: "/quotes" },
      { label: "Vertrag entwerfen", to: "/contracts" },
    ],
    tip: "Halte 'Nächster Schritt' und 'erwartetes Abschlussdatum' aktuell – darauf basieren Forecasts und Copilot-Empfehlungen.",
  },
  "/quotes": {
    route: "/quotes",
    icon: FileText,
    title: "Angebote",
    purpose: "Konkrete Preisangebote für Deals – versionierbar, mit Margen-/Rabatt-Logik und Genehmigungs-Workflow.",
    howTo: [
      "'Neues Angebot' öffnet den Wizard und führt durch Deal-Auswahl, Positionen und Konditionen.",
      "Jedes Angebot hat eine fortlaufende Nummer und versionierten Verlauf.",
      "Status-Badge (Draft, Pending Approval, Approved, Sent) zeigt den aktuellen Workflow-Schritt.",
    ],
    prerequisites: ["Es existiert ein Deal in einer aktiven Phase."],
    nextSteps: [
      { label: "Genehmigungen prüfen", to: "/approvals" },
    ],
    tip: "Discount > Schwellwert? Das System erstellt automatisch eine Approval-Aufgabe – im Bereich Freigaben sichtbar.",
  },
  "/templates": {
    route: "/templates",
    icon: FileStack,
    title: "Vorlagen",
    purpose: "Wiederverwendbare Bausteine für Verträge und Angebote – Klauseln, Standardtexte, branding-spezifische Defaults.",
    howTo: [
      "Templates sind nach Marke / Vertragstyp organisiert.",
      "Markiere produktive Versionen als 'aktiv', Drafts bleiben unsichtbar für andere User.",
      "Änderungen wirken sich nur auf neu erzeugte Verträge aus – existierende behalten ihre Version.",
    ],
    tip: "Pflege Templates als zentrales Asset – sie sparen Verhandlungszeit und reduzieren Compliance-Risiko.",
  },
  "/attachments": {
    route: "/attachments",
    icon: Paperclip,
    title: "Anhänge",
    purpose: "Hochgeladene Dokumente (NDA, RFPs, Spezifikationen) zentral verwaltet, an Deal/Quote/Vertrag verknüpfbar.",
    howTo: [
      "Datei hochladen → Metadaten setzen (Typ, Sichtbarkeit) → an Entität koppeln.",
      "Sichtbarkeit 'intern' bleibt im Team, 'extern' kann mit Kunden geteilt werden.",
    ],
  },
  "/pricing": {
    route: "/pricing",
    icon: BadgeDollarSign,
    title: "Preisgestaltung",
    purpose: "Stammpreise, Margen-Schwellen und Discount-Regeln – die Grundlage für Angebots- und Approval-Logik.",
    howTo: [
      "Definiere pro Marke Listenpreise und Margen-Floors.",
      "Discount-Schwellwerte triggern automatisch Approvals im Angebot.",
    ],
    tip: "Saubere Preislogik = weniger Eskalationen. Pflege Stammpreise quartalsweise.",
  },
  "/approvals": {
    route: "/approvals",
    icon: CheckSquare,
    title: "Freigaben",
    purpose: "Alle ausstehenden Genehmigungen – Discounts, Sonderkonditionen, Vertrags-Klauseln.",
    howTo: [
      "Freigabe-Aufgaben werden automatisch durch Quotes/Verträge erzeugt, sobald Schwellwerte überschritten sind.",
      "Freigeben oder ablehnen mit Begründung – die Entscheidung wird im Audit-Log persistiert.",
    ],
    nextSteps: [
      { label: "Audit-Log öffnen", to: "/audit" },
    ],
    tip: "Copilot kann pro Freigabe eine 'Approval Readiness'-Analyse liefern (im Detailbereich).",
  },
  "/contracts": {
    route: "/contracts",
    icon: FileSignature,
    title: "Verträge",
    purpose: "Verbindliche Vereinbarungen – Entwurf, Verhandlung, Unterschrift, Aktivierung.",
    howTo: [
      "Vertrag aus einem gewonnenen Deal erstellen – nutzt Brand-Defaults und Klauseln.",
      "Status-Flow: Draft → In Negotiation → Pending Signature → Active → (Renewal/Amendment).",
      "Im Detailbereich findest du Klauseln, Risiken (Copilot) und Verlauf.",
    ],
    prerequisites: ["Ein Deal in Phase 'Closing' oder 'Won'."],
    nextSteps: [
      { label: "Verhandlung öffnen", to: "/negotiations" },
      { label: "Unterschrift einholen", to: "/signatures" },
    ],
  },
  "/negotiations": {
    route: "/negotiations",
    icon: Handshake,
    title: "Verhandlungen",
    purpose: "Strukturiert dokumentierte Verhandlungs-Sessions zu Verträgen – Punkte, Gegenangebote, Status.",
    howTo: [
      "Verhandlungen werden auf Vertragsbasis angelegt – jede Session erfasst Diskussionspunkte.",
      "Copilot kann 'Negotiation Support'-Hinweise je Punkt geben (im Detail).",
    ],
  },
  "/signatures": {
    route: "/signatures",
    icon: PenTool,
    title: "Unterschriften",
    purpose: "Übersicht aller offenen und abgeschlossenen Signaturprozesse mit Status pro Unterzeichner.",
    howTo: [
      "Signatur-Anforderung wird beim Übergang Vertrag → 'Pending Signature' automatisch erzeugt.",
      "Status pro Unterzeichner: pending / signed / declined.",
    ],
  },
  "/price-increases": {
    route: "/price-increases",
    icon: TrendingUp,
    title: "Preiserhöhungen",
    purpose: "Geplante & laufende Preisanpassungen für Bestandskunden – Begründung, Höhe, Kommunikations-Status.",
    howTo: [
      "Erstelle eine Preiserhöhungs-Aktion pro Kunden- oder Vertragsgruppe.",
      "Begründung + Höhe + geplantes Wirksamkeitsdatum – Copilot kann Argumentation vorschlagen.",
    ],
  },
  "/order-confirmations": {
    route: "/order-confirmations",
    icon: ClipboardCheck,
    title: "Auftragsbestätigungen",
    purpose: "Bestätigte Bestellungen aus aktiven Verträgen – Übergabe an Liefer-/Abrechnungssystem.",
    howTo: [
      "Auftragsbestätigungen entstehen aus aktiven Verträgen mit konkreter Bestellung.",
      "Status: Draft → Sent → Confirmed.",
    ],
  },
  "/reports": {
    route: "/reports",
    icon: BarChart3,
    title: "Berichte",
    purpose: "Aggregierte Pipeline-, Forecast- und Performance-Berichte über Marken, Owner und Zeiträume.",
    howTo: [
      "Filter (Zeitraum, Marke, Phase) anwenden, dann Bericht öffnen.",
      "Exportiere als CSV oder teile den Link mit Stakeholdern.",
    ],
  },
  "/audit": {
    route: "/audit",
    icon: History,
    title: "Audit-Log",
    purpose: "Lückenlose Historie kritischer Aktionen – Freigaben, Vertragsänderungen, Logins, Konfiguration.",
    howTo: [
      "Filtere nach Akteur, Aktionstyp oder Zeitraum.",
      "Jeder Eintrag enthält Tenant, Zeitstempel, Aktor und Payload-Diff.",
    ],
  },
  "/copilot": {
    route: "/copilot",
    icon: Bot,
    title: "Copilot",
    purpose: "AI-gestützte Analysen je Domäne – Deal-Summary, Pricing-Review, Vertragsrisiken, Approval-Readiness u.a.",
    howTo: [
      "Wähle einen Modus (z.B. 'Deal Summary') und das Zielobjekt – Copilot liefert ein strukturiertes Ergebnis.",
      "Ergebnisse werden als 'Insight' am Deal/Vertrag persistiert und sind dort wieder auffindbar.",
    ],
    tip: "Copilot ergänzt – ersetzt nie. Lies Begründung & Quellen, bevor du eine Empfehlung übernimmst.",
  },
  "/admin": {
    route: "/admin",
    icon: Settings,
    title: "Verwaltung",
    purpose: "Tenant-Konfiguration: Marken, Companies, User, Rollen, Scopes.",
    howTo: [
      "User anlegen / einladen, Rolle und Scope (welche Companies/Brands sichtbar sind) zuweisen.",
      "Marken konfigurieren inkl. Default-Klauseln und Branding.",
    ],
    tip: "Scopes sind essenziell für Multi-Brand-Setup – ein User sieht nur Daten in seinem aktiven Scope.",
  },
};

export function getHelpForRoute(path: string): HelpEntry | null {
  if (HELP_CONTENT[path]) return HELP_CONTENT[path];
  for (const key of Object.keys(HELP_CONTENT)) {
    if (key !== "/" && path.startsWith(key)) return HELP_CONTENT[key];
  }
  return HELP_CONTENT["/"] ?? null;
}

export function getCurrentWorkflowStep(path: string) {
  return WORKFLOW_STEPS.find(s => path === s.route || (s.route !== "/" && path.startsWith(s.route))) ?? null;
}

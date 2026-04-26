/**
 * Initial-Seed der Regulatorik-Bibliothek (Task #231).
 *
 * Inhalt: 5 EU-/DE-System-Regulierungen, die in B2B-Verträgen regelmäßig
 * relevant werden:
 *   - DSGVO/AVV (Art. 28 Auftragsverarbeitung)
 *   - EU AI Act (Hochrisiko-KI)
 *   - DSA (Digital Services Act)
 *   - NIS2 (Netz- und Informationssicherheit)
 *   - LkSG (Lieferkettensorgfaltspflichtengesetz)
 *
 * tenantId = NULL → systemweit verfügbar; Tenants können zusätzlich eigene
 * Frameworks anlegen oder die Liste nicht-anwendbar markieren.
 *
 * Idempotent: nutzt unique(tenant_id, code) und ON CONFLICT DO NOTHING.
 * System-Frameworks werden NICHT automatisch upgedated — Gesetzes-Novellen
 * sind ein bewusster Eingriff (neuer code oder version-Bump per Admin-API).
 */
import { db, regulatoryFrameworksTable, regulatoryRequirementsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

interface SeedRequirement {
  id: string;
  code: string;
  title: string;
  description: string;
  normRef: string;
  recommendedClauseFamily?: string | null;
  recommendedClauseText?: string | null;
  severity?: "must" | "should" | "info";
  sortOrder?: number;
}

interface SeedFramework {
  id: string;
  code: string;
  title: string;
  shortLabel: string;
  jurisdiction: string;
  summary: string;
  url?: string;
  applicabilityRules: Array<{ kind: string; values?: string[]; note?: string }>;
  sortOrder: number;
  requirements: SeedRequirement[];
}

const FRAMEWORKS: SeedFramework[] = [
  // ─── DSGVO/AVV ─────────────────────────────────────────────────────────
  {
    id: "rf_gdpr_avv",
    code: "GDPR_AVV",
    title: "DSGVO — Auftragsverarbeitungsvereinbarung (Art. 28)",
    shortLabel: "DSGVO/AVV",
    jurisdiction: "EU",
    summary:
      "Verarbeitet ein Auftragsverarbeiter personenbezogene Daten im Auftrag eines Verantwortlichen, ist nach Art. 28 DSGVO eine schriftliche Vereinbarung zwingend erforderlich. Die AVV muss Gegenstand, Dauer, Art und Zweck der Verarbeitung, die Art der Daten, die Kategorien betroffener Personen sowie die Pflichten des Auftragsverarbeiters regeln.",
    url: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    applicabilityRules: [
      { kind: "data_processing", note: "Personenbezogene Daten werden vom Auftragnehmer im Auftrag verarbeitet." },
      { kind: "contract_type", values: ["dpa", "msa", "framework", "saas"], note: "Klassische AVV/DPA-Konstellationen." },
      { kind: "jurisdiction", values: ["DE", "EU", "AT"], note: "Geltungsbereich DSGVO." },
    ],
    sortOrder: 10,
    requirements: [
      {
        id: "rr_gdpr_avv_subject",
        code: "AVV-3.1.A",
        title: "Gegenstand & Dauer der Verarbeitung",
        description:
          "Die AVV muss Gegenstand und Dauer der Verarbeitung explizit benennen.",
        normRef: "DSGVO Art. 28 Abs. 3 S. 1",
        recommendedClauseFamily: "data_processing",
        severity: "must",
        sortOrder: 10,
      },
      {
        id: "rr_gdpr_avv_purpose",
        code: "AVV-3.1.B",
        title: "Art & Zweck der Verarbeitung",
        description:
          "Art und Zweck der Verarbeitung sowie die Art der personenbezogenen Daten und Kategorien betroffener Personen sind zu benennen.",
        normRef: "DSGVO Art. 28 Abs. 3 S. 1",
        recommendedClauseFamily: "data_processing",
        severity: "must",
        sortOrder: 20,
      },
      {
        id: "rr_gdpr_avv_instructions",
        code: "AVV-3.2.A",
        title: "Verarbeitung nur auf dokumentierte Weisung",
        description:
          "Der Auftragsverarbeiter darf die Daten nur auf dokumentierte Weisung des Verantwortlichen verarbeiten.",
        normRef: "DSGVO Art. 28 Abs. 3 lit. a",
        recommendedClauseFamily: "data_processing",
        recommendedClauseText:
          "Der Auftragnehmer verarbeitet die personenbezogenen Daten ausschließlich auf dokumentierte Weisung des Auftraggebers, einschließlich in Bezug auf die Übermittlung in Drittländer.",
        severity: "must",
        sortOrder: 30,
      },
      {
        id: "rr_gdpr_avv_confidentiality",
        code: "AVV-3.2.B",
        title: "Vertraulichkeit der zur Verarbeitung befugten Personen",
        description:
          "Personen, die zur Verarbeitung der personenbezogenen Daten befugt sind, müssen sich zur Vertraulichkeit verpflichtet haben.",
        normRef: "DSGVO Art. 28 Abs. 3 lit. b",
        recommendedClauseFamily: "confidentiality",
        severity: "must",
        sortOrder: 40,
      },
      {
        id: "rr_gdpr_avv_tom",
        code: "AVV-3.2.C",
        title: "Technische und organisatorische Maßnahmen (TOM)",
        description:
          "Der Auftragsverarbeiter muss alle gemäß Art. 32 erforderlichen Maßnahmen ergreifen (TOM-Anhang).",
        normRef: "DSGVO Art. 28 Abs. 3 lit. c i. V. m. Art. 32",
        recommendedClauseFamily: "data_security",
        severity: "must",
        sortOrder: 50,
      },
      {
        id: "rr_gdpr_avv_subprocessors",
        code: "AVV-3.2.D",
        title: "Unterauftragsverarbeiter",
        description:
          "Voraussetzungen für die Inanspruchnahme weiterer Auftragsverarbeiter (vorherige Genehmigung, gleichwertige Verpflichtung).",
        normRef: "DSGVO Art. 28 Abs. 3 lit. d, Abs. 2 und 4",
        recommendedClauseFamily: "data_processing",
        severity: "must",
        sortOrder: 60,
      },
      {
        id: "rr_gdpr_avv_data_subject_rights",
        code: "AVV-3.2.E",
        title: "Unterstützung bei Betroffenenrechten",
        description:
          "Unterstützung des Verantwortlichen bei der Erfüllung der Betroffenenrechte (Art. 12-23 DSGVO).",
        normRef: "DSGVO Art. 28 Abs. 3 lit. e",
        recommendedClauseFamily: "data_processing",
        severity: "must",
        sortOrder: 70,
      },
      {
        id: "rr_gdpr_avv_breach_assist",
        code: "AVV-3.2.F",
        title: "Unterstützung bei Sicherheits-/Meldepflichten",
        description:
          "Unterstützung bei Datenschutz-Folgenabschätzung, Sicherheit (Art. 32) und Meldepflichten (Art. 33-36).",
        normRef: "DSGVO Art. 28 Abs. 3 lit. f",
        recommendedClauseFamily: "data_processing",
        severity: "must",
        sortOrder: 80,
      },
      {
        id: "rr_gdpr_avv_return_delete",
        code: "AVV-3.2.G",
        title: "Rückgabe oder Löschung nach Vertragsende",
        description:
          "Nach Abschluss der Erbringung der Verarbeitungsleistungen sind die Daten zurückzugeben oder zu löschen.",
        normRef: "DSGVO Art. 28 Abs. 3 lit. g",
        recommendedClauseFamily: "data_processing",
        severity: "must",
        sortOrder: 90,
      },
      {
        id: "rr_gdpr_avv_audit",
        code: "AVV-3.2.H",
        title: "Nachweis- und Auditrechte",
        description:
          "Der Auftragsverarbeiter stellt alle erforderlichen Informationen zum Nachweis der Einhaltung zur Verfügung und ermöglicht Audits.",
        normRef: "DSGVO Art. 28 Abs. 3 lit. h",
        recommendedClauseFamily: "audit",
        severity: "must",
        sortOrder: 100,
      },
    ],
  },
  // ─── EU AI Act ────────────────────────────────────────────────────────
  {
    id: "rf_eu_ai_act",
    code: "EU_AI_ACT",
    title: "EU AI Act — Verordnung über Künstliche Intelligenz",
    shortLabel: "AI Act",
    jurisdiction: "EU",
    summary:
      "Die KI-Verordnung (EU 2024/1689) regelt das Inverkehrbringen, die Inbetriebnahme und die Verwendung von KI-Systemen in der EU. Insbesondere für Hochrisiko-KI gelten umfangreiche Pflichten zu Risikomanagement, Daten-Governance, technischer Dokumentation, menschlicher Aufsicht und Konformitätsbewertung.",
    url: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj",
    applicabilityRules: [
      { kind: "ai_usage", note: "KI-System wird im Rahmen der Leistung eingesetzt oder bereitgestellt." },
      { kind: "high_risk_industry", values: ["finance", "healthcare", "education", "hr", "public_sector", "critical_infrastructure"] },
    ],
    sortOrder: 20,
    requirements: [
      {
        id: "rr_aia_classification",
        code: "AIA-CLS",
        title: "Klassifizierung des KI-Systems",
        description:
          "Vertragliche Klärung, ob ein Hochrisiko-KI-System (Anhang III) oder allgemeines KI-System vorliegt; zugewiesene Rolle (Anbieter, Betreiber, Einführer, Händler).",
        normRef: "AI Act Art. 6, Art. 25",
        recommendedClauseFamily: "ai_governance",
        severity: "must",
        sortOrder: 10,
      },
      {
        id: "rr_aia_risk_mgmt",
        code: "AIA-RMS",
        title: "Risikomanagementsystem",
        description:
          "Für Hochrisiko-KI ist ein dokumentiertes Risikomanagementsystem über den gesamten Lebenszyklus einzurichten.",
        normRef: "AI Act Art. 9",
        recommendedClauseFamily: "ai_governance",
        severity: "must",
        sortOrder: 20,
      },
      {
        id: "rr_aia_data_governance",
        code: "AIA-DGV",
        title: "Daten-Governance & Trainingsdaten",
        description:
          "Trainings-, Validierungs- und Testdaten unterliegen Qualitäts- und Repräsentativitäts­anforderungen.",
        normRef: "AI Act Art. 10",
        recommendedClauseFamily: "ai_governance",
        severity: "must",
        sortOrder: 30,
      },
      {
        id: "rr_aia_technical_doc",
        code: "AIA-DOC",
        title: "Technische Dokumentation",
        description:
          "Technische Dokumentation gemäß Anhang IV ist vor Inverkehrbringen zu erstellen und auf Anfrage zur Verfügung zu stellen.",
        normRef: "AI Act Art. 11",
        recommendedClauseFamily: "ai_governance",
        severity: "must",
        sortOrder: 40,
      },
      {
        id: "rr_aia_transparency",
        code: "AIA-TRN",
        title: "Transparenz & Information der Nutzer",
        description:
          "Nutzer/Betroffene sind über die Verwendung des KI-Systems, dessen Funktionsweise, Genauigkeit und Limitationen zu informieren (insb. bei Interaktion mit natürlichen Personen).",
        normRef: "AI Act Art. 13, Art. 50",
        recommendedClauseFamily: "ai_governance",
        recommendedClauseText:
          "Der Anbieter informiert den Betreiber über die bestimmungsgemäße Verwendung, Fähigkeiten, Genauigkeitsmetriken und bekannten Limitationen des KI-Systems sowie über erforderliche Maßnahmen menschlicher Aufsicht.",
        severity: "must",
        sortOrder: 50,
      },
      {
        id: "rr_aia_human_oversight",
        code: "AIA-OVR",
        title: "Menschliche Aufsicht",
        description:
          "Hochrisiko-KI-Systeme müssen so gestaltet sein, dass natürliche Personen sie wirksam beaufsichtigen können.",
        normRef: "AI Act Art. 14",
        recommendedClauseFamily: "ai_governance",
        severity: "must",
        sortOrder: 60,
      },
      {
        id: "rr_aia_accuracy_robustness",
        code: "AIA-ACC",
        title: "Genauigkeit, Robustheit, Cybersicherheit",
        description:
          "Hochrisiko-KI-Systeme müssen ein angemessenes Maß an Genauigkeit, Robustheit und Cybersicherheit gewährleisten.",
        normRef: "AI Act Art. 15",
        recommendedClauseFamily: "ai_governance",
        severity: "must",
        sortOrder: 70,
      },
      {
        id: "rr_aia_post_market",
        code: "AIA-PMM",
        title: "Post-Market-Monitoring & Vorfallsmeldung",
        description:
          "Anbieter müssen ein Post-Market-Monitoring-System betreiben und schwerwiegende Vorfälle melden.",
        normRef: "AI Act Art. 72, Art. 73",
        recommendedClauseFamily: "ai_governance",
        severity: "must",
        sortOrder: 80,
      },
    ],
  },
  // ─── DSA — Digital Services Act ───────────────────────────────────────
  {
    id: "rf_dsa",
    code: "DSA",
    title: "Digital Services Act (Verordnung (EU) 2022/2065)",
    shortLabel: "DSA",
    jurisdiction: "EU",
    summary:
      "Der DSA regelt Pflichten von Anbietern digitaler Vermittlungsdienste, insb. Hosting-Dienste, Online-Plattformen und sehr große Plattformen (VLOP). Schwerpunkte: Transparenz, Kontaktstellen, Notice-and-Action, Beschwerdesystem, Werbe-Transparenz, Risikobewertung.",
    url: "https://eur-lex.europa.eu/eli/reg/2022/2065/oj",
    applicabilityRules: [
      { kind: "service_type", values: ["hosting", "platform", "marketplace"], note: "Vermittlungs-/Hosting-/Plattform-Dienst." },
      { kind: "industry", values: ["digital", "marketplace", "social_media", "saas"] },
    ],
    sortOrder: 30,
    requirements: [
      {
        id: "rr_dsa_contact",
        code: "DSA-CON",
        title: "Zentrale Kontaktstelle & gesetzlicher Vertreter",
        description:
          "Bestimmung einer zentralen Kontaktstelle (Behörden/Nutzer) sowie ggf. eines gesetzlichen Vertreters in der Union.",
        normRef: "DSA Art. 11, Art. 13",
        recommendedClauseFamily: "compliance_contact",
        severity: "must",
        sortOrder: 10,
      },
      {
        id: "rr_dsa_terms",
        code: "DSA-TRM",
        title: "Transparente AGB",
        description:
          "AGB müssen Inhalte, Verfahren und Werkzeuge zur Inhaltsmoderation klar und verständlich beschreiben.",
        normRef: "DSA Art. 14",
        recommendedClauseFamily: "terms_of_service",
        severity: "must",
        sortOrder: 20,
      },
      {
        id: "rr_dsa_notice_action",
        code: "DSA-NAA",
        title: "Notice-and-Action-Mechanismus",
        description:
          "Hosting-Anbieter müssen leicht zugängliche Mechanismen bereitstellen, mit denen rechtswidrige Inhalte gemeldet werden können, und über Maßnahmen begründet entscheiden.",
        normRef: "DSA Art. 16, Art. 17",
        recommendedClauseFamily: "content_moderation",
        severity: "must",
        sortOrder: 30,
      },
      {
        id: "rr_dsa_complaints",
        code: "DSA-CPL",
        title: "Internes Beschwerdemanagementsystem",
        description:
          "Online-Plattformen müssen Nutzern ein internes Beschwerdesystem für Moderationsentscheidungen anbieten.",
        normRef: "DSA Art. 20",
        recommendedClauseFamily: "complaint_handling",
        severity: "must",
        sortOrder: 40,
      },
      {
        id: "rr_dsa_ad_transparency",
        code: "DSA-ADT",
        title: "Werbung — Transparenz",
        description:
          "Plattformen müssen Werbung als solche kenntlich machen und Hauptparameter der Werbeanzeige offenlegen.",
        normRef: "DSA Art. 26",
        recommendedClauseFamily: "advertising",
        severity: "should",
        sortOrder: 50,
      },
      {
        id: "rr_dsa_traders",
        code: "DSA-TRA",
        title: "Rückverfolgbarkeit von Unternehmern (Marketplace)",
        description:
          "Marktplätze müssen Identität der Unternehmer feststellen und übermitteln (KYC-light).",
        normRef: "DSA Art. 30",
        recommendedClauseFamily: "marketplace_kyc",
        severity: "must",
        sortOrder: 60,
      },
    ],
  },
  // ─── NIS2 ─────────────────────────────────────────────────────────────
  {
    id: "rf_nis2",
    code: "NIS2",
    title: "NIS2-Richtlinie — Netz- und Informationssicherheit",
    shortLabel: "NIS2",
    jurisdiction: "EU",
    summary:
      "Die NIS2-Richtlinie (EU 2022/2555) erweitert die Pflichten zu Cybersicherheit, Risikomanagement und Vorfallsmeldung für wesentliche und wichtige Einrichtungen erheblich. Sie betrifft auch Lieferanten kritischer Sektoren und ist über vertragliche Sicherheitsanforderungen entlang der Lieferkette weiterzugeben.",
    url: "https://eur-lex.europa.eu/eli/dir/2022/2555/oj",
    applicabilityRules: [
      { kind: "industry", values: ["critical_infrastructure", "energy", "transport", "banking", "finance", "health", "digital_infrastructure", "public_administration", "ict_service_management", "manufacturing", "food", "waste", "chemicals"], note: "Wesentliche/wichtige Einrichtungen nach Anhang I/II." },
      { kind: "service_type", values: ["it_services", "cloud", "managed_services", "saas"], note: "ITK-Lieferanten kritischer Sektoren." },
    ],
    sortOrder: 40,
    requirements: [
      {
        id: "rr_nis2_riskmgmt",
        code: "NIS2-RSM",
        title: "Risikomanagement-Maßnahmen für die Cybersicherheit",
        description:
          "Geeignete und verhältnismäßige technische, operative und organisatorische Maßnahmen zur Beherrschung der Risiken (Art. 21 Abs. 2 a-j).",
        normRef: "NIS2 Art. 21",
        recommendedClauseFamily: "data_security",
        severity: "must",
        sortOrder: 10,
      },
      {
        id: "rr_nis2_incident_report",
        code: "NIS2-IRP",
        title: "Meldepflichten bei erheblichen Sicherheitsvorfällen",
        description:
          "Frühwarnung binnen 24 h, Vorfallsmeldung binnen 72 h, Abschlussbericht binnen 1 Monat an die zuständige CSIRT/Behörde.",
        normRef: "NIS2 Art. 23",
        recommendedClauseFamily: "incident_response",
        recommendedClauseText:
          "Der Auftragnehmer informiert den Auftraggeber unverzüglich, spätestens innerhalb von 24 Stunden nach Kenntniserlangung über erhebliche Sicherheitsvorfälle, und unterstützt bei den nach NIS2 Art. 23 erforderlichen Folgemeldungen.",
        severity: "must",
        sortOrder: 20,
      },
      {
        id: "rr_nis2_supply_chain",
        code: "NIS2-SCS",
        title: "Sicherheit der Lieferkette",
        description:
          "Sicherheitsbezogene Aspekte in den Beziehungen zu unmittelbaren Lieferanten und Diensteanbietern sind vertraglich zu regeln.",
        normRef: "NIS2 Art. 21 Abs. 2 lit. d",
        recommendedClauseFamily: "supply_chain_security",
        severity: "must",
        sortOrder: 30,
      },
      {
        id: "rr_nis2_bcm",
        code: "NIS2-BCM",
        title: "Business Continuity & Backup-Management",
        description:
          "Aufrechterhaltung des Geschäftsbetriebs (Backup-Management, Wiederherstellung nach Notfällen, Krisenmanagement).",
        normRef: "NIS2 Art. 21 Abs. 2 lit. c",
        recommendedClauseFamily: "business_continuity",
        severity: "must",
        sortOrder: 40,
      },
      {
        id: "rr_nis2_access_control",
        code: "NIS2-AC",
        title: "Zugriffskontrolle & MFA",
        description:
          "Konzepte für Zugriffskontrolle, Asset-Management und ggf. Multi-Faktor-Authentifizierung.",
        normRef: "NIS2 Art. 21 Abs. 2 lit. i, j",
        recommendedClauseFamily: "data_security",
        severity: "must",
        sortOrder: 50,
      },
    ],
  },
  // ─── LkSG ─────────────────────────────────────────────────────────────
  {
    id: "rf_lksg",
    code: "LkSG",
    title: "Lieferkettensorgfaltspflichtengesetz (LkSG)",
    shortLabel: "LkSG",
    jurisdiction: "DE",
    summary:
      "Das LkSG verpflichtet Unternehmen ab definierten Mitarbeiterschwellen zur Achtung menschenrechtlicher und umweltbezogener Sorgfaltspflichten in ihren Lieferketten. Wesentliche Bestandteile: Risikomanagement, Risikoanalysen, Präventions- und Abhilfemaßnahmen, Beschwerdeverfahren, Dokumentations- und Berichtspflichten.",
    url: "https://www.gesetze-im-internet.de/lksg/",
    applicabilityRules: [
      { kind: "industry", values: ["manufacturing", "retail", "consumer_goods", "automotive", "textile", "food", "chemicals", "construction"], note: "Klassische Lieferketten-Industrien." },
      { kind: "size_bracket", values: ["1000+", "3000+"], note: "LkSG-Schwellen (1.000 bzw. 3.000 MA)." },
      { kind: "contract_type", values: ["framework", "msa", "supply"], note: "Lieferanten-/Rahmenverträge." },
    ],
    sortOrder: 50,
    requirements: [
      {
        id: "rr_lksg_policy",
        code: "LKSG-POL",
        title: "Grundsatzerklärung & Verhaltenskodex",
        description:
          "Vertragliche Verpflichtung des Lieferanten auf eine Grundsatzerklärung zu Menschenrechten und Umwelt sowie auf den Lieferanten-Code-of-Conduct.",
        normRef: "LkSG § 6 Abs. 2",
        recommendedClauseFamily: "supplier_code",
        recommendedClauseText:
          "Der Auftragnehmer bestätigt die Einhaltung des Verhaltenskodex für Lieferanten und verpflichtet sich, die Anforderungen des Lieferkettensorgfaltspflichtengesetzes (LkSG) angemessen umzusetzen und entlang seiner eigenen Lieferkette weiterzugeben.",
        severity: "must",
        sortOrder: 10,
      },
      {
        id: "rr_lksg_risk_analysis",
        code: "LKSG-RA",
        title: "Mitwirkung an Risikoanalysen",
        description:
          "Lieferant unterstützt jährliche und anlassbezogene Risikoanalysen (Selbstauskünfte, Audits, Nachweise).",
        normRef: "LkSG § 5",
        recommendedClauseFamily: "supplier_audit",
        severity: "must",
        sortOrder: 20,
      },
      {
        id: "rr_lksg_prevention",
        code: "LKSG-PRV",
        title: "Präventions- und Abhilfemaßnahmen",
        description:
          "Verpflichtung zu Präventionsmaßnahmen und unverzüglicher Umsetzung von Abhilfemaßnahmen bei festgestellten Verstößen.",
        normRef: "LkSG §§ 6, 7",
        recommendedClauseFamily: "supplier_remediation",
        severity: "must",
        sortOrder: 30,
      },
      {
        id: "rr_lksg_complaint",
        code: "LKSG-CPL",
        title: "Beschwerdeverfahren",
        description:
          "Lieferant gewährleistet eigenes Beschwerdeverfahren oder beteiligt sich am Verfahren des Auftraggebers.",
        normRef: "LkSG § 8",
        recommendedClauseFamily: "complaint_handling",
        severity: "must",
        sortOrder: 40,
      },
      {
        id: "rr_lksg_information",
        code: "LKSG-INF",
        title: "Informations- und Auskunftsrechte",
        description:
          "Auskunfts-, Audit- und Einsichtsrechte des Auftraggebers; Pflicht zur Information über schwerwiegende Risiken.",
        normRef: "LkSG §§ 6, 7",
        recommendedClauseFamily: "audit",
        severity: "must",
        sortOrder: 50,
      },
      {
        id: "rr_lksg_termination",
        code: "LKSG-TRM",
        title: "Beendigungsrechte bei schwerwiegenden Verstößen",
        description:
          "Außerordentliches Kündigungsrecht des Auftraggebers bei wiederholten oder schweren Verstößen gegen menschenrechtliche/umweltbezogene Pflichten.",
        normRef: "LkSG § 7 Abs. 3",
        recommendedClauseFamily: "termination",
        severity: "must",
        sortOrder: 60,
      },
    ],
  },
];

export async function seedRegulatoryFrameworksIdempotent(): Promise<void> {
  let insertedFrameworks = 0;
  let insertedRequirements = 0;
  for (const f of FRAMEWORKS) {
    // System-Eintrag (tenantId = NULL); ON CONFLICT auf (tenant_id, code).
    const inserted = await db
      .insert(regulatoryFrameworksTable)
      .values({
        id: f.id,
        tenantId: null,
        code: f.code,
        title: f.title,
        shortLabel: f.shortLabel,
        jurisdiction: f.jurisdiction,
        summary: f.summary,
        url: f.url ?? null,
        version: "1.0",
        applicabilityRules: f.applicabilityRules,
        active: true,
        sortOrder: f.sortOrder,
      })
      // Konfliktziel = PK (id). Die deterministischen Seed-IDs (rf_*)
      // garantieren Idempotenz; (tenant_id, code) wäre ungeeignet, weil
      // PostgreSQL NULL in Unique-Indizes als „distinct" behandelt und das
      // System-Framework (tenantId = NULL) sonst beim Re-Seed gegen die
      // PK-Constraint laufen würde.
      .onConflictDoNothing({ target: regulatoryFrameworksTable.id })
      .returning({ id: regulatoryFrameworksTable.id });
    if (inserted.length) insertedFrameworks++;
    for (const r of f.requirements) {
      const insR = await db
        .insert(regulatoryRequirementsTable)
        .values({
          id: r.id,
          frameworkId: f.id,
          code: r.code,
          title: r.title,
          description: r.description,
          normRef: r.normRef,
          recommendedClauseFamily: r.recommendedClauseFamily ?? null,
          recommendedClauseText: r.recommendedClauseText ?? null,
          severity: r.severity ?? "must",
          sortOrder: r.sortOrder ?? 0,
        })
        .onConflictDoNothing({ target: regulatoryRequirementsTable.id })
        .returning({ id: regulatoryRequirementsTable.id });
      if (insR.length) insertedRequirements++;
    }
  }
  // Vermeide unused-import Warnung; sql wird hier ggf. erweitert.
  void sql;
  if (insertedFrameworks || insertedRequirements) {
    logger.info(
      { insertedFrameworks, insertedRequirements },
      "Regulatorik-Bibliothek (System-Frameworks) seeded.",
    );
  }
}

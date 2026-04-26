import { sql, and, like, eq, or } from "drizzle-orm";
import {
  db,
  tenantsTable,
  companiesTable,
  brandsTable,
  usersTable,
  accountsTable,
  contactsTable,
  dealsTable,
  quotesTable,
  quoteVersionsTable,
  lineItemsTable,
  pricePositionsTable,
  priceRulesTable,
  approvalsTable,
  contractsTable,
  clauseFamiliesTable,
  clauseVariantsTable,
  clauseVariantTranslationsTable,
  contractClausesTable,
  negotiationsTable,
  customerReactionsTable,
  signaturePackagesTable,
  contractAmendmentsTable,
  amendmentClausesTable,
  signersTable,
  priceIncreaseCampaignsTable,
  priceIncreaseLettersTable,
  timelineEventsTable,
  copilotInsightsTable,
  copilotThreadsTable,
  copilotMessagesTable,
  auditLogTable,
  orderConfirmationsTable,
  orderConfirmationChecksTable,
  entityVersionsTable,
  rolesTable,
  quoteTemplatesTable,
  quoteTemplateSectionsTable,
  attachmentLibraryTable,
  industryProfilesTable,
  pricePositionBundlesTable,
  pricePositionBundleItemsTable,
  contractTypesTable,
  contractPlaybooksTable,
  obligationsTable,
  clauseDeviationsTable,
  cuadCategoriesTable,
  clauseFamilyCuadCategoriesTable,
  contractTypeCuadExpectationsTable,
} from "@workspace/db";
import { hashPassword } from "./auth";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";

const id = (prefix: string, n: number) => `${prefix}_${String(n).padStart(3, "0")}`;
const now = new Date();
const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Idempotent runtime DDL guard. We don't ship Drizzle migration files —
 * schema is normally reconciled via `pnpm --filter db push` (also wired
 * into the post-merge script). On databases that pre-date a column the
 * code now relies on, push may have been skipped or failed, and the
 * runtime would crash with `column "..." does not exist`.
 *
 * This function adds any such columns with `ADD COLUMN IF NOT EXISTS`
 * so the API boots cleanly even on stale DBs. It MUST be called before
 * any other startup work that touches the affected tables (seeds,
 * insight generators, request handlers).
 *
 * Add new entries here whenever the Drizzle schema gains a column that
 * an existing live database might not have yet.
 */
export async function ensureSchemaColumns(): Promise<void> {
  await db.execute(
    sql`ALTER TABLE "quotes" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone`,
  );
  await db.execute(
    sql`ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone`,
  );
  // Juristische Wissensbasis (Task #227). DDL-Guard, falls drizzle push noch
  // nicht gelaufen ist — sonst crasht der erste seedLegalSourcesIdempotent().
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "legal_sources" (
      "id" text PRIMARY KEY,
      "tenant_id" text,
      "norm_ref" text NOT NULL,
      "title" text NOT NULL,
      "jurisdiction" text NOT NULL DEFAULT 'DE',
      "area_of_law" text NOT NULL,
      "hierarchy" text NOT NULL DEFAULT 'statute',
      "full_text" text NOT NULL,
      "summary" text NOT NULL,
      "keywords" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "valid_from" date,
      "valid_until" date,
      "url" text,
      "created_at" timestamp with time zone NOT NULL DEFAULT now(),
      "updated_at" timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "legal_sources_tenant_area_idx" ON "legal_sources" ("tenant_id","area_of_law")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "legal_sources_jurisdiction_idx" ON "legal_sources" ("jurisdiction","area_of_law")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "legal_sources_tenant_norm_uq" ON "legal_sources" ("tenant_id","norm_ref")`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "legal_precedents" (
      "id" text PRIMARY KEY,
      "tenant_id" text NOT NULL,
      "contract_id" text NOT NULL,
      "contract_clause_id" text,
      "family" text NOT NULL,
      "variant_id" text,
      "negotiation_outcome" text NOT NULL DEFAULT 'standard',
      "counterparty_account_id" text,
      "counterparty_name" text,
      "industry" text,
      "contract_value_cents" integer,
      "signed_at" timestamp with time zone,
      "snippet" text NOT NULL,
      "keywords" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "created_at" timestamp with time zone NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "legal_precedents_tenant_family_idx" ON "legal_precedents" ("tenant_id","family")`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "legal_precedents_tenant_signed_idx" ON "legal_precedents" ("tenant_id","signed_at")`);
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "legal_precedents_clause_uq" ON "legal_precedents" ("tenant_id","contract_clause_id")`);
}

export async function seedIfEmpty(): Promise<void> {
  const existing = await db.select({ c: sql<number>`count(*)::int` }).from(tenantsTable);
  if ((existing[0]?.c ?? 0) > 0) {
    logger.info("Seed skipped: tenant exists");
    return;
  }
  logger.info("Seeding DealFlow One demo data...");

  await db.insert(tenantsTable).values({
    id: "tn_root",
    name: "Helix Industrial Group",
    plan: "Enterprise",
    region: "EU",
  });

  const companies = [
    { id: "co_helix", tenantId: "tn_root", name: "Helix DACH", legalName: "Helix Industrial GmbH", country: "DE", currency: "EUR" },
    { id: "co_helix_uk", tenantId: "tn_root", name: "Helix UK", legalName: "Helix Industrial Ltd.", country: "GB", currency: "GBP" },
    { id: "co_helix_us", tenantId: "tn_root", name: "Helix North America", legalName: "Helix Industrial Inc.", country: "US", currency: "USD" },
  ];
  await db.insert(companiesTable).values(companies);

  // Brand-specific default clause variants (familyId -> variantId).
  // helix_pro = premium/strict; helix_core = standard; helix_uk = moderate; helix_velocity = bold/softer.
  // Tiny inline SVG logos (data URIs) so PDF rendering works without external network.
  const logoDataUri = (label: string, color: string) => {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='220' height='72' viewBox='0 0 220 72'>`
      + `<rect x='0' y='0' width='72' height='72' rx='14' fill='${color}'/>`
      + `<text x='36' y='47' font-family='Helvetica,Arial' font-size='34' font-weight='700' fill='white' text-anchor='middle'>H</text>`
      + `<text x='88' y='36' font-family='Helvetica,Arial' font-size='20' font-weight='700' fill='${color}'>Helix</text>`
      + `<text x='88' y='58' font-family='Helvetica,Arial' font-size='14' fill='#6b7280'>${label}</text>`
      + `</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  };
  const brands = [
    { id: "br_helix", companyId: "co_helix", name: "Helix Core", color: "#2D6CDF", voice: "precise",
      logoUrl: logoDataUri("Core", "#2D6CDF"),
      primaryColor: "#2D6CDF", secondaryColor: "#1E3A8A", tone: "precise",
      legalEntityName: "Helix Industrial GmbH",
      addressLine: "Lyoner Straße 14, 60528 Frankfurt am Main, Deutschland",
      defaultClauseVariants: {
        cf_liab: "cv_liab_3", cf_term: "cv_term_3", cf_data: "cv_data_3",
        cf_pay: "cv_pay_3", cf_sla: "cv_sla_3", cf_ip: "cv_ip_3",
      } },
    { id: "br_helix_pro", companyId: "co_helix", name: "Helix Pro", color: "#0F766E", voice: "premium",
      logoUrl: logoDataUri("Pro", "#0F766E"),
      primaryColor: "#0F766E", secondaryColor: "#064E3B", tone: "premium",
      legalEntityName: "Helix Industrial GmbH · Pro Division",
      addressLine: "Lyoner Straße 14, 60528 Frankfurt am Main, Deutschland",
      defaultClauseVariants: {
        cf_liab: "cv_liab_4", cf_term: "cv_term_4", cf_data: "cv_data_4",
        cf_pay: "cv_pay_4", cf_sla: "cv_sla_4", cf_ip: "cv_ip_4",
      } },
    { id: "br_helix_uk", companyId: "co_helix_uk", name: "Helix UK", color: "#9333EA", voice: "concise",
      logoUrl: logoDataUri("UK", "#9333EA"),
      primaryColor: "#9333EA", secondaryColor: "#4C1D95", tone: "concise",
      legalEntityName: "Helix Industrial Ltd.",
      addressLine: "5 Merchant Square, London W2 1AY, United Kingdom",
      defaultClauseVariants: {
        cf_liab: "cv_liab_2", cf_term: "cv_term_2", cf_data: "cv_data_2",
        cf_pay: "cv_pay_2", cf_sla: "cv_sla_2", cf_ip: "cv_ip_2",
      } },
    { id: "br_helix_us", companyId: "co_helix_us", name: "Helix Velocity", color: "#DC2626", voice: "bold",
      logoUrl: logoDataUri("Velocity", "#DC2626"),
      primaryColor: "#DC2626", secondaryColor: "#7F1D1D", tone: "bold",
      legalEntityName: "Helix Industrial Inc.",
      addressLine: "350 Mission Street, San Francisco, CA 94105, USA",
      defaultClauseVariants: {
        cf_liab: "cv_liab_1", cf_term: "cv_term_1", cf_data: "cv_data_1",
        cf_pay: "cv_pay_1", cf_sla: "cv_sla_1", cf_ip: "cv_ip_1",
      } },
  ];
  await db.insert(brandsTable).values(brands);

  // Default password for all demo users: "dealflow"
  const demoPwHash = hashPassword("dealflow");
  const users = [
    { id: "u_anna",   name: "Anna Brandt",      email: "anna@helix.com",   role: "Account Executive",  scope: "co_helix",     initials: "AB", avatarColor: "#2D6CDF",
      passwordHash: demoPwHash, isActive: true, tenantId: "tn_root", tenantWide: false, scopeCompanyIds: JSON.stringify(["co_helix"]),                       scopeBrandIds: JSON.stringify([]) },
    { id: "u_marcel", name: "Marcel Voss",      email: "marcel@helix.com", role: "Senior AE",          scope: "co_helix",     initials: "MV", avatarColor: "#0F766E",
      passwordHash: demoPwHash, isActive: true, tenantId: "tn_root", tenantWide: false, scopeCompanyIds: JSON.stringify(["co_helix"]),                       scopeBrandIds: JSON.stringify([]) },
    { id: "u_sara",   name: "Sara Lindqvist",   email: "sara@helix.com",   role: "Deal Desk",          scope: "tn_root",      initials: "SL", avatarColor: "#9333EA",
      passwordHash: demoPwHash, isActive: true, tenantId: "tn_root", tenantWide: true,  scopeCompanyIds: JSON.stringify([]),                                  scopeBrandIds: JSON.stringify([]) },
    { id: "u_james",  name: "James Whitfield",  email: "james@helix.com",  role: "Regional Director",  scope: "co_helix_uk",  initials: "JW", avatarColor: "#DC2626",
      passwordHash: demoPwHash, isActive: true, tenantId: "tn_root", tenantWide: false, scopeCompanyIds: JSON.stringify(["co_helix_uk"]),                    scopeBrandIds: JSON.stringify([]) },
    { id: "u_priya",  name: "Priya Raman",      email: "priya@helix.com",  role: "Tenant Admin",       scope: "tn_root",      initials: "PR", avatarColor: "#EA580C",
      passwordHash: demoPwHash, isActive: true, tenantId: "tn_root", tenantWide: true,  scopeCompanyIds: JSON.stringify([]),                                  scopeBrandIds: JSON.stringify([]),
      isPlatformAdmin: true },
    { id: "u_tom",    name: "Tom Becker",       email: "tom@helix.com",    role: "Account Executive",  scope: "co_helix_us",  initials: "TB", avatarColor: "#0EA5E9",
      passwordHash: demoPwHash, isActive: true, tenantId: "tn_root", tenantWide: false, scopeCompanyIds: JSON.stringify(["co_helix_us"]),                    scopeBrandIds: JSON.stringify([]) },
  ];
  await db.insert(usersTable).values(users);

  await db.insert(rolesTable).values([
    { id: "ro_account_exec", name: "Account Executive", description: "Klassische Sales-Rolle für Deal-Ownership.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_senior_ae", name: "Senior AE", description: "Erfahrener Account Executive, größere Deals.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_deal_desk", name: "Deal Desk", description: "Pricing- und Deal-Support, tenant-weite Sicht.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_regional_dir", name: "Regional Director", description: "Regionale Verantwortung über Companies.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_vp_commercial", name: "VP Commercial", description: "Commercial-Leitung, tenant-weite Sicht.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_sales_rep", name: "Sales Rep", description: "Führt Deals im zugewiesenen Scope, kann Angebote und Verträge vorbereiten.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_sales_mgr", name: "Sales Manager", description: "Pipeline-Verantwortung, Approval für Rabatte im Limit.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_revops", name: "RevOps", description: "Preislisten, Pricing-Regeln, Reports, Datenqualität.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_legal", name: "Legal Reviewer", description: "Klausel-Freigaben, Risiko-Bewertung, Nachtrags-Freigabe.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_finance", name: "Finance Approver", description: "Finanz-Approval hoher Rabatte und Margen-Ausnahmen.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_tenant_admin", name: "Tenant Admin", description: "Volle Rechte, Benutzer und Rollen verwalten.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_readonly_exec", name: "Read-Only Executive", description: "Nur Lesezugriff auf alle Daten des Tenants.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_brand_mgr", name: "Brand Manager", description: "Brand-Konfiguration, Klausel-Defaults, Logo und Farben.", isSystem: true, tenantId: "tn_root" },
    { id: "ro_integration_admin", name: "Integration Admin", description: "Webhooks, Integrationen, Datenimport.", isSystem: true, tenantId: "tn_root" },
  ]);

  const accountsData = [
    { id: "acc_001", name: "Vorwerk Logistics", industry: "Logistics", country: "DE", healthScore: 82, ownerId: "u_anna" },
    { id: "acc_002", name: "Nordstern AG", industry: "Manufacturing", country: "DE", healthScore: 71, ownerId: "u_marcel" },
    { id: "acc_003", name: "BlueRiver Energy", industry: "Energy", country: "GB", healthScore: 64, ownerId: "u_james" },
    { id: "acc_004", name: "Castell Foods", industry: "FMCG", country: "DE", healthScore: 88, ownerId: "u_anna" },
    { id: "acc_005", name: "Helvetia Pharma", industry: "Pharma", country: "CH", healthScore: 76, ownerId: "u_marcel" },
    { id: "acc_006", name: "Atlas Mobility", industry: "Automotive", country: "DE", healthScore: 58, ownerId: "u_marcel" },
    { id: "acc_007", name: "Northwind Retail", industry: "Retail", country: "GB", healthScore: 69, ownerId: "u_james" },
    { id: "acc_008", name: "Fjord Maritime", industry: "Shipping", country: "NO", healthScore: 73, ownerId: "u_anna" },
    { id: "acc_009", name: "Apex Components", industry: "Manufacturing", country: "US", healthScore: 81, ownerId: "u_tom" },
    { id: "acc_010", name: "Cascade Robotics", industry: "Industrial", country: "US", healthScore: 79, ownerId: "u_tom" },
  ];
  await db.insert(accountsTable).values(accountsData);

  const contactsData = [
    { id: "ct_001", accountId: "acc_001", name: "Klaus Vorwerk", email: "k.vorwerk@vorwerk-log.de", role: "Head of Procurement", isDecisionMaker: true, phone: "+49 30 555 0101" },
    { id: "ct_002", accountId: "acc_001", name: "Lena Hoffmann", email: "l.hoffmann@vorwerk-log.de", role: "Operations Lead", isDecisionMaker: false, phone: "+49 30 555 0102" },
    { id: "ct_003", accountId: "acc_002", name: "Dr. Stefan Reuter", email: "s.reuter@nordstern.de", role: "CFO", isDecisionMaker: true, phone: "+49 40 555 0201" },
    { id: "ct_004", accountId: "acc_003", name: "Eleanor Whitcombe", email: "e.whitcombe@blueriver.co.uk", role: "Director of Engineering", isDecisionMaker: true, phone: "+44 20 555 0301" },
    { id: "ct_005", accountId: "acc_004", name: "Maria Castell", email: "m.castell@castellfoods.de", role: "CEO", isDecisionMaker: true, phone: "+49 89 555 0401" },
    { id: "ct_006", accountId: "acc_005", name: "Andreas Vogt", email: "a.vogt@helvetia-pharma.ch", role: "VP Procurement", isDecisionMaker: true, phone: "+41 44 555 0501" },
    { id: "ct_007", accountId: "acc_006", name: "Julia Kraus", email: "j.kraus@atlas-mob.de", role: "Strategic Sourcing", isDecisionMaker: false, phone: "+49 711 555 0601" },
    { id: "ct_008", accountId: "acc_007", name: "Oliver Hayes", email: "o.hayes@northwind.co.uk", role: "Head of Supply", isDecisionMaker: true, phone: "+44 161 555 0701" },
    { id: "ct_009", accountId: "acc_008", name: "Ingrid Solberg", email: "i.solberg@fjord.no", role: "Procurement Manager", isDecisionMaker: true, phone: "+47 22 555 0801" },
    { id: "ct_010", accountId: "acc_009", name: "Daniel Park", email: "d.park@apex-cmp.com", role: "VP Manufacturing", isDecisionMaker: true, phone: "+1 415 555 0901" },
    { id: "ct_011", accountId: "acc_010", name: "Rachel Iyer", email: "r.iyer@cascaderobotics.com", role: "CTO", isDecisionMaker: true, phone: "+1 206 555 1001" },
  ];
  await db.insert(contactsTable).values(contactsData);

  const stages = ["qualified", "discovery", "proposal", "negotiation", "closing", "won", "lost"];
  const stageLabels: Record<string, string> = {
    qualified: "Qualified",
    discovery: "Discovery",
    proposal: "Proposal",
    negotiation: "Negotiation",
    closing: "Closing",
    won: "Won",
    lost: "Lost",
  };
  void stageLabels;

  const dealsSeed = [
    ["Vorwerk - Fleet Modernisation 2026",  "acc_001", "negotiation",  450000,  "EUR", 65, "u_anna",   "br_helix",     "co_helix",    "medium", 28, "Send revised pricing by Friday"],
    ["Vorwerk - Maintenance Add-on",         "acc_001", "proposal",     85000,   "EUR", 50, "u_anna",   "br_helix_pro", "co_helix",    "low",    21, "Schedule technical workshop"],
    ["Nordstern - Capacity Expansion",       "acc_002", "closing",      1250000, "EUR", 80, "u_marcel", "br_helix_pro", "co_helix",    "high",   10, "Legal review on liability cap"],
    ["BlueRiver - Pipeline Sensors",         "acc_003", "negotiation",  680000,  "GBP", 60, "u_james",  "br_helix_uk",  "co_helix_uk", "medium", 35, "Confirm SLA tiers"],
    ["Castell - Annual Renewal",             "acc_004", "qualified",    220000,  "EUR", 35, "u_anna",   "br_helix",     "co_helix",    "low",    60, "Discovery call next week"],
    ["Helvetia - Cleanroom Upgrade",         "acc_005", "discovery",    540000,  "EUR", 40, "u_marcel", "br_helix_pro", "co_helix",    "medium", 75, "Site assessment scheduled"],
    ["Atlas - Robotics Integration",         "acc_006", "proposal",     920000,  "EUR", 55, "u_marcel", "br_helix",     "co_helix",    "high",   42, "Awaiting CAPEX approval"],
    ["Northwind - Distribution Centre",      "acc_007", "negotiation",  380000,  "GBP", 70, "u_james",  "br_helix_uk",  "co_helix_uk", "medium", 18, "Counterproposal under review"],
    ["Fjord - Vessel Telemetry",             "acc_008", "closing",      640000,  "EUR", 85, "u_anna",   "br_helix",     "co_helix",    "low",    7,  "Final signature pending"],
    ["Apex - Production Line Refit",         "acc_009", "discovery",    1100000, "USD", 30, "u_tom",    "br_helix_us",  "co_helix_us", "medium", 90, "ROI analysis in progress"],
    ["Cascade - Robotics Platform",          "acc_010", "proposal",     780000,  "USD", 60, "u_tom",    "br_helix_us",  "co_helix_us", "low",    45, "Demo this Thursday"],
    ["BlueRiver - Maintenance Contract",     "acc_003", "won",          120000,  "GBP", 100,"u_james",  "br_helix_uk",  "co_helix_uk", "low",    -15,"Closed last sprint"],
    ["Nordstern - Spare Parts Programme",    "acc_002", "won",          340000,  "EUR", 100,"u_marcel", "br_helix",     "co_helix",    "low",    -22,"Renewal scheduled"],
    ["Atlas - Pilot Programme",              "acc_006", "lost",         180000,  "EUR", 0,  "u_marcel", "br_helix",     "co_helix",    "high",   -10,"Lost on price"],
  ] as const;

  await db.insert(dealsTable).values(dealsSeed.map((d, i) => ({
    id: id("dl", i + 1),
    name: d[0],
    accountId: d[1],
    stage: d[2],
    value: String(d[3]),
    currency: d[4],
    probability: d[5],
    ownerId: d[6],
    brandId: d[7],
    companyId: d[8],
    riskLevel: d[9],
    expectedCloseDate: isoDate(daysFromNow(d[10])),
    nextStep: d[11],
  })));

  // Quotes for some deals
  const quoteRows = [
    { dealIdx: 1, num: "Q-2026-0118", status: "sent",     ver: 3, total: 450000, disc: 8.5, margin: 32.4, days: 14 },
    { dealIdx: 1, num: "Q-2026-0118", status: "draft",    ver: 1, total: 480000, disc: 4.0, margin: 36.1, days: 14 },
    { dealIdx: 2, num: "Q-2026-0124", status: "sent",     ver: 1, total: 85000,  disc: 5.0, margin: 41.0, days: 30 },
    { dealIdx: 3, num: "Q-2026-0102", status: "accepted", ver: 2, total: 1250000,disc: 12.0,margin: 28.5, days: 7  },
    { dealIdx: 4, num: "Q-2026-0131", status: "sent",     ver: 2, total: 680000, disc: 9.0, margin: 29.8, days: 21 },
    { dealIdx: 7, num: "Q-2026-0108", status: "sent",     ver: 1, total: 920000, disc: 7.5, margin: 33.2, days: 28 },
    { dealIdx: 8, num: "Q-2026-0135", status: "sent",     ver: 2, total: 380000, disc: 11.0,margin: 27.4, days: 10 },
    { dealIdx: 9, num: "Q-2026-0140", status: "accepted", ver: 1, total: 640000, disc: 6.0, margin: 35.0, days: 5  },
    { dealIdx: 11,num: "Q-2026-0144", status: "draft",    ver: 1, total: 780000, disc: 0.0, margin: 38.0, days: 30 },
  ];
  // Note: a "single" quote may have multiple versions. We'll group rows with same number.
  const quoteIds = new Map<string, string>();
  let qCounter = 0;
  for (const q of quoteRows) {
    if (!quoteIds.has(q.num)) {
      qCounter += 1;
      const qid = id("qt", qCounter);
      quoteIds.set(q.num, qid);
      const dealId = id("dl", q.dealIdx);
      await db.insert(quotesTable).values({
        id: qid,
        dealId,
        number: q.num,
        status: q.status,
        currentVersion: q.ver,
        currency: dealsSeed[q.dealIdx - 1]![4],
        validUntil: isoDate(daysFromNow(q.days)),
      });
    }
  }
  let qvCounter = 0;
  let liCounter = 0;
  for (const q of quoteRows) {
    qvCounter += 1;
    const quoteId = quoteIds.get(q.num)!;
    const qvid = id("qv", qvCounter);
    await db.insert(quoteVersionsTable).values({
      id: qvid,
      quoteId,
      version: q.ver,
      totalAmount: String(q.total),
      discountPct: String(q.disc),
      marginPct: String(q.margin),
      status: q.status,
      notes: q.ver === 1 ? "Initial proposal" : `Version ${q.ver} – customer requested ${q.disc}% discount`,
    });
    const lineCount = 3 + (q.ver % 3);
    const items = [
      ["Helix Core Platform – Annual License", 240000, 240000, q.disc],
      ["Implementation & Onboarding",          85000,  92000,  0],
      ["Premium Support 24/7",                 48000,  52000,  q.disc / 2],
      ["Integration Services",                 35000,  38000,  q.disc],
      ["Training Programme",                   12000,  12000,  0],
    ];
    for (let i = 0; i < lineCount && i < items.length; i++) {
      liCounter += 1;
      const it = items[i]!;
      const unit = it[1] as number;
      const list = it[2] as number;
      const disc = it[3] as number;
      await db.insert(lineItemsTable).values({
        id: id("li", liCounter),
        quoteVersionId: qvid,
        name: it[0] as string,
        description: null,
        quantity: "1",
        unitPrice: String(unit),
        listPrice: String(list),
        discountPct: String(disc),
        total: String(unit),
      });
    }
  }

  // Pricing
  const positionSeed = [
    ["HX-CORE-LIC",   "Helix Core Platform License",   "Software", 240000, "EUR", "active",  "br_helix",     "co_helix"],
    ["HX-PRO-LIC",    "Helix Pro Platform License",    "Software", 360000, "EUR", "active",  "br_helix_pro", "co_helix"],
    ["HX-IMPL",       "Implementation & Onboarding",   "Service",  85000,  "EUR", "active",  "br_helix",     "co_helix"],
    ["HX-SUP-PREM",   "Premium Support 24/7",          "Service",  48000,  "EUR", "active",  "br_helix",     "co_helix"],
    ["HX-INTEG",      "Integration Services (per project)","Service",35000,"EUR", "active",  "br_helix",     "co_helix"],
    ["HX-TRAIN",      "Training Programme",            "Service",  12000,  "EUR", "active",  "br_helix",     "co_helix"],
    ["HX-CORE-UK",    "Helix Core Platform License",   "Software", 210000, "GBP", "active",  "br_helix_uk",  "co_helix_uk"],
    ["HX-CORE-US",    "Helix Core Platform License",   "Software", 265000, "USD", "active",  "br_helix_us",  "co_helix_us"],
    ["HX-VEL-LIC",    "Helix Velocity Edge License",   "Software", 195000, "USD", "draft",   "br_helix_us",  "co_helix_us"],
    ["HX-SENS-PIPE",  "Pipeline Sensor Suite",         "Hardware", 32000,  "EUR", "active",  "br_helix_pro", "co_helix"],
    ["HX-SENS-VESL",  "Vessel Telemetry Module",       "Hardware", 28000,  "EUR", "active",  "br_helix",     "co_helix"],
    ["HX-ROBOT-INT",  "Robotics Integration Pack",     "Hardware", 145000, "EUR", "review",  "br_helix_pro", "co_helix"],
  ];
  await db.insert(pricePositionsTable).values(positionSeed.map((p, i) => ({
    id: id("pp", i + 1),
    sku: p[0] as string,
    name: p[1] as string,
    category: p[2] as string,
    listPrice: String(p[3]),
    currency: p[4] as string,
    status: p[5] as string,
    validFrom: isoDate(daysFromNow(-90)),
    validUntil: null,
    brandId: p[6] as string,
    companyId: p[7] as string,
    version: 2,
    isStandard: true,
  })));

  // Demo-Bundles: vorgefertigte Pakete von Preispositionen
  await db.insert(pricePositionBundlesTable).values([
    { id: "ppb_starter",  tenantId: "tn_root", name: "Starter-Plan",      description: "Einstieg: Lizenz + Onboarding + Basistraining.",         category: "Plan",     brandId: "br_helix",     companyId: "co_helix" },
    { id: "ppb_pro",      tenantId: "tn_root", name: "Professional-Plan", description: "Pro-Lizenz mit Premium-Support und Integrationen.",     category: "Plan",     brandId: "br_helix_pro", companyId: "co_helix" },
    { id: "ppb_hardware", tenantId: "tn_root", name: "Hardware-Bundle",   description: "Sensorik-Paket für Pipeline + Vessel-Telemetrie.",      category: "Hardware", brandId: "br_helix",     companyId: "co_helix" },
  ]);
  await db.insert(pricePositionBundleItemsTable).values([
    // Starter-Plan
    { id: "ppbi_001", bundleId: "ppb_starter", pricePositionId: "pp_001", quantity: "1", customDiscountPct: "0", position: 0 },
    { id: "ppbi_002", bundleId: "ppb_starter", pricePositionId: "pp_003", quantity: "1", customDiscountPct: "0", position: 1 },
    { id: "ppbi_003", bundleId: "ppb_starter", pricePositionId: "pp_006", quantity: "1", customDiscountPct: "0", position: 2 },
    // Professional-Plan
    { id: "ppbi_004", bundleId: "ppb_pro",     pricePositionId: "pp_002", quantity: "1", customDiscountPct: "0", position: 0 },
    { id: "ppbi_005", bundleId: "ppb_pro",     pricePositionId: "pp_004", quantity: "1", customDiscountPct: "0", position: 1 },
    { id: "ppbi_006", bundleId: "ppb_pro",     pricePositionId: "pp_005", quantity: "1", customDiscountPct: "5", position: 2 },
    { id: "ppbi_007", bundleId: "ppb_pro",     pricePositionId: "pp_006", quantity: "1", customDiscountPct: "0", position: 3 },
    // Hardware-Bundle
    { id: "ppbi_008", bundleId: "ppb_hardware", pricePositionId: "pp_010", quantity: "5", customDiscountPct: "10", position: 0 },
    { id: "ppbi_009", bundleId: "ppb_hardware", pricePositionId: "pp_011", quantity: "3", customDiscountPct: "10", position: 1 },
  ]);

  await db.insert(priceRulesTable).values([
    { id: "pr_001", tenantId: "tn_root", name: "Volume tier > 500k EUR", scope: "global", condition: "deal.value > 500000", effect: "auto-discount up to 8%", priority: 10, status: "active" },
    { id: "pr_002", tenantId: "tn_root", name: "Multi-year commitment uplift", scope: "global", condition: "term >= 36 months", effect: "additional 5% discount", priority: 20, status: "active" },
    { id: "pr_003", tenantId: "tn_root", name: "Strategic account exception", scope: "co_helix", condition: "account.tier = strategic", effect: "deal-desk approval required", priority: 5, status: "active" },
    { id: "pr_004", tenantId: "tn_root", name: "Hardware bundle margin floor", scope: "co_helix", condition: "category = Hardware", effect: "block discount > 12%", priority: 15, status: "active" },
    { id: "pr_005", tenantId: "tn_root", name: "UK FY26 list price", scope: "co_helix_uk", condition: "currency = GBP", effect: "use UK price book v2", priority: 1, status: "draft" },
  ]);

  // Approvals
  await db.insert(approvalsTable).values([
    { id: "ap_001", dealId: "dl_001", type: "discount", reason: "Customer requested 12% discount above 8% threshold", requestedBy: "u_anna",   status: "pending",  priority: "high",   impactValue: "54000",  currency: "EUR", deadline: daysFromNow(2) },
    { id: "ap_002", dealId: "dl_003", type: "legal",    reason: "Liability cap waiver requested by Nordstern",         requestedBy: "u_marcel", status: "pending",  priority: "high",   impactValue: "1250000",currency: "EUR", deadline: daysFromNow(1) },
    { id: "ap_003", dealId: "dl_004", type: "discount", reason: "9% discount on multi-year commitment",                 requestedBy: "u_james",  status: "pending",  priority: "medium", impactValue: "61200",  currency: "GBP", deadline: daysFromNow(4) },
    { id: "ap_004", dealId: "dl_007", type: "margin",   reason: "Margin below 33% floor due to integration scope",      requestedBy: "u_marcel", status: "pending",  priority: "medium", impactValue: "92000",  currency: "EUR", deadline: daysFromNow(5) },
    { id: "ap_005", dealId: "dl_008", type: "discount", reason: "Volume discount escalation – 11%",                     requestedBy: "u_james",  status: "approved", priority: "medium", impactValue: "41800",  currency: "GBP", deadline: daysFromNow(-2), decidedAt: daysFromNow(-1), decidedBy: "u_priya", decisionComment: "Approved with margin floor maintained." },
    { id: "ap_006", dealId: "dl_011", type: "exception",reason: "Bundle pricing override for new logo",                  requestedBy: "u_tom",    status: "pending",  priority: "low",    impactValue: "39000",  currency: "USD", deadline: daysFromNow(7) },
    { id: "ap_007", dealId: "dl_002", type: "discount", reason: "Add-on bundled at 5% courtesy discount",                requestedBy: "u_anna",   status: "rejected", priority: "low",    impactValue: "4250",   currency: "EUR", deadline: daysFromNow(-3), decidedAt: daysFromNow(-2), decidedBy: "u_sara", decisionComment: "Use standard renewal terms instead." },
  ]);

  // Clause families & variants
  const families = [
    { id: "cf_liab",  name: "Liability",          description: "Limitation of liability and damages." },
    { id: "cf_term",  name: "Term & Termination", description: "Duration, renewal and termination rights." },
    { id: "cf_data",  name: "Data Protection",    description: "Processing of personal data and confidentiality." },
    { id: "cf_pay",   name: "Payment Terms",      description: "Invoicing, currency and payment schedule." },
    { id: "cf_sla",   name: "Service Levels",     description: "Uptime, response and resolution commitments." },
    { id: "cf_ip",    name: "Intellectual Property", description: "Ownership, license scope and derivatives." },
    { id: "cf_warr",  name: "Gewährleistung",     description: "Mängelhaftung, Rüge- und Nachbesserungsrechte." },
    { id: "cf_conf",  name: "Geheimhaltung",      description: "Vertraulichkeit, Schutz vertraulicher Informationen." },
    { id: "cf_juris", name: "Gerichtsstand",      description: "Anwendbares Recht und Gerichtsstand." },
  ];
  await db.insert(clauseFamiliesTable).values(families);

  // 5 Varianten je Familie: zart(1) / moderat(2) / standard(3) / streng(4) / hart(5)
  // severity: 1-2 → high (für uns), 3 → medium, 4-5 → low
  const sevFromScore = (s: number) => (s <= 2 ? "high" : s === 3 ? "medium" : "low");
  const variantRows: Array<{ id: string; familyId: string; name: string; tone: string; severityScore: number; summary: string; body: string }> = [
    // Liability
    { id: "cv_liab_1", familyId: "cf_liab", tone: "zart",     severityScore: 1, name: "Unbegrenzt bei IP-Verletzung", summary: "Unbegrenzte Haftung bei IP-Infringement-Ansprüchen.", body: "Der Anbieter haftet unbegrenzt für alle Ansprüche aus Verletzungen geistiger Eigentumsrechte Dritter, einschließlich direkter und indirekter Schäden." },
    { id: "cv_liab_2", familyId: "cf_liab", tone: "moderat",  severityScore: 2, name: "3× Jahresgebühr",              summary: "Haftung auf 3× Jahresgebühr gedeckelt.", body: "Die Gesamthaftung des Anbieters ist auf das Dreifache der jährlich gezahlten Gebühren beschränkt." },
    { id: "cv_liab_3", familyId: "cf_liab", tone: "standard", severityScore: 3, name: "2× Jahresgebühr",              summary: "Standard-Cap: 2× Jahresgebühr.", body: "Die Gesamthaftung ist auf das Zweifache der innerhalb der letzten 12 Monate gezahlten Gebühren begrenzt." },
    { id: "cv_liab_4", familyId: "cf_liab", tone: "streng",   severityScore: 4, name: "12-Monats-Cap",                summary: "Cap auf 12-Monats-Gebühren.", body: "Die Haftung ist auf die Summe der in den 12 Monaten vor dem Schadensereignis gezahlten Gebühren beschränkt." },
    { id: "cv_liab_5", familyId: "cf_liab", tone: "hart",     severityScore: 5, name: "6-Monats-Cap, grobe Fahrlässigkeit ausgeschlossen", summary: "Harter Cap: 6 Monate; leichte Fahrlässigkeit ausgeschlossen.", body: "Haftung gedeckelt auf 6-Monats-Gebühren. Haftung für leichte Fahrlässigkeit, Folgeschäden und entgangenen Gewinn ausgeschlossen." },
    // Term & Termination
    { id: "cv_term_1", familyId: "cf_term", tone: "zart",     severityScore: 1, name: "Jederzeitige Kündigung 30 Tage", summary: "Kunde kann jederzeit mit 30 Tagen kündigen.", body: "Der Kunde kann den Vertrag jederzeit ohne Grund mit 30 Tagen Kündigungsfrist beenden." },
    { id: "cv_term_2", familyId: "cf_term", tone: "moderat",  severityScore: 2, name: "12 Monate mit Opt-out",         summary: "12 Monate Mindestlaufzeit, Opt-out nach Monat 6.", body: "Mindestlaufzeit 12 Monate, Opt-out zum Monat 6 mit 60 Tagen Frist." },
    { id: "cv_term_3", familyId: "cf_term", tone: "standard", severityScore: 3, name: "24 Monate mit Opt-out",         summary: "24 Monate mit Opt-out zu Monat 12.", body: "Mindestlaufzeit 24 Monate; einseitiges Opt-out-Recht zu Monat 12 mit 90 Tagen Frist." },
    { id: "cv_term_4", familyId: "cf_term", tone: "streng",   severityScore: 4, name: "36 Monate Auto-Renewal",        summary: "36 Monate, automatische Verlängerung um 12.", body: "36 Monate Mindestlaufzeit, automatische Verlängerung um 12 Monate; Kündigung 90 Tage vor Ablauf." },
    { id: "cv_term_5", familyId: "cf_term", tone: "hart",     severityScore: 5, name: "60 Monate, Exit-Fee",           summary: "60 Monate, Early-Termination-Fee 50% Restwert.", body: "Laufzeit 60 Monate. Vorzeitige Kündigung führt zu einer Entschädigung in Höhe von 50% des Restwerts." },
    // Data Protection
    { id: "cv_data_1", familyId: "cf_data", tone: "zart",     severityScore: 1, name: "Kunden-Hosting, volle Audit-Rechte", summary: "On-Prem beim Kunden, volle Auditrechte ohne Ankündigung.", body: "Datenverarbeitung ausschließlich beim Kunden. Kunde kann jederzeit ohne Vorankündigung prüfen." },
    { id: "cv_data_2", familyId: "cf_data", tone: "moderat",  severityScore: 2, name: "Kunden-Hosting mit Audit",      summary: "Kundengehostet mit jährlichem Audit.", body: "Datenverarbeitung in Kundenumgebung. Jährliches Audit-Recht mit 30 Tagen Vorankündigung." },
    { id: "cv_data_3", familyId: "cf_data", tone: "standard", severityScore: 3, name: "EU-Hosting, SCC",               summary: "EU-Rechenzentren, Standardvertragsklauseln.", body: "Alle personenbezogenen Daten werden in EU-Rechenzentren verarbeitet. Standardvertragsklauseln (SCC) und TOMs Anlage B." },
    { id: "cv_data_4", familyId: "cf_data", tone: "streng",   severityScore: 4, name: "EU-Hosting + Subprozessoren-Whitelist", summary: "EU-Hosting, genehmigte Subprozessoren.", body: "EU-Hosting; Einsatz von Subprozessoren erfordert schriftliche Genehmigung durch den Kunden." },
    { id: "cv_data_5", familyId: "cf_data", tone: "hart",     severityScore: 5, name: "Regional EU + Haftungsausschluss", summary: "EU-Hosting; Datenschutzhaftung beim Kunden.", body: "EU-Hosting; Kunde bleibt Verantwortlicher; Anbieter haftet nur bei Vorsatz für DSGVO-Verstöße." },
    // Payment Terms
    { id: "cv_pay_1",  familyId: "cf_pay",  tone: "zart",     severityScore: 1, name: "Netto 90 mit Skonto",           summary: "Zahlungsziel 90 Tage, 3% Skonto bei 30 Tagen.", body: "Zahlungsziel 90 Tage netto. 3% Skonto bei Zahlung innerhalb von 30 Tagen." },
    { id: "cv_pay_2",  familyId: "cf_pay",  tone: "moderat",  severityScore: 2, name: "Netto 60",                      summary: "Netto 60 Tage.", body: "Zahlungsziel 60 Tage netto." },
    { id: "cv_pay_3",  familyId: "cf_pay",  tone: "standard", severityScore: 3, name: "Netto 30",                      summary: "Netto 30 Tage.", body: "Zahlungsziel 30 Tage netto ab Rechnungsdatum." },
    { id: "cv_pay_4",  familyId: "cf_pay",  tone: "streng",   severityScore: 4, name: "Netto 14",                      summary: "Netto 14 Tage, Verzugszinsen.", body: "Zahlungsziel 14 Tage netto. Bei Verzug 9% Zinsen über Basiszinssatz." },
    { id: "cv_pay_5",  familyId: "cf_pay",  tone: "hart",     severityScore: 5, name: "Vorauskasse",                   summary: "Zahlung vor Leistungserbringung.", body: "Rechnung vorab; Leistungserbringung erst nach Zahlungseingang." },
    // Service Levels
    { id: "cv_sla_1",  familyId: "cf_sla",  tone: "zart",     severityScore: 1, name: "99,99% mit Pönale 50%",         summary: "99,99% Uptime, Pönale bis 50% Monatsgebühr.", body: "Verfügbarkeit 99,99% pro Monat. Service-Credits bis 50% der Monatsgebühr bei Unterschreitung." },
    { id: "cv_sla_2",  familyId: "cf_sla",  tone: "moderat",  severityScore: 2, name: "99,95% mit 25% Credit",         summary: "99,95% Uptime, 25% Credit-Cap.", body: "Verfügbarkeit 99,95%; Service-Credits gedeckelt bei 25% der Monatsgebühr." },
    { id: "cv_sla_3",  familyId: "cf_sla",  tone: "standard", severityScore: 3, name: "99,9% mit 10% Credit",          summary: "99,9% Uptime, 10% Credit-Cap.", body: "Verfügbarkeit 99,9%; Service-Credits bis 10% der Monatsgebühr." },
    { id: "cv_sla_4",  familyId: "cf_sla",  tone: "streng",   severityScore: 4, name: "99,5% ohne Credits",            summary: "99,5% Uptime, keine Credits.", body: "Zielverfügbarkeit 99,5%; keine automatischen Service-Credits." },
    { id: "cv_sla_5",  familyId: "cf_sla",  tone: "hart",     severityScore: 5, name: "Best Effort",                   summary: "Best-Effort-Verfügbarkeit.", body: "Verfügbarkeit nach bestem Bemühen ohne Zusicherung oder Credits." },
    // Intellectual Property
    { id: "cv_ip_1",   familyId: "cf_ip",   tone: "zart",     severityScore: 1, name: "Volle Abtretung inkl. Derivate", summary: "Alle Derivate gehen an Kunden.", body: "Sämtliche im Rahmen des Vertrags geschaffenen Arbeitsergebnisse und Derivate werden an den Kunden abgetreten." },
    { id: "cv_ip_2",   familyId: "cf_ip",   tone: "moderat",  severityScore: 2, name: "Abtretung kundenspezifischer Derivate", summary: "Nur maßgeschneiderte Derivate abgetreten.", body: "Kundenspezifische Derivate werden abgetreten; Standard-Komponenten verbleiben beim Anbieter." },
    { id: "cv_ip_3",   familyId: "cf_ip",   tone: "standard", severityScore: 3, name: "Nutzungslizenz nicht-exklusiv",  summary: "Nicht-exklusive Nutzungslizenz.", body: "Kunde erhält eine nicht-exklusive, nicht-übertragbare Nutzungslizenz; IP verbleibt beim Anbieter." },
    { id: "cv_ip_4",   familyId: "cf_ip",   tone: "streng",   severityScore: 4, name: "Nutzungslizenz mit Audit",       summary: "Nicht-exklusiv mit Nutzungsaudit.", body: "Nicht-exklusive Nutzungslizenz; Anbieter hat Auditrecht bezüglich Nutzungsumfang." },
    { id: "cv_ip_5",   familyId: "cf_ip",   tone: "hart",     severityScore: 5, name: "Named-User, keine Abtretung",    summary: "Named-User-Lizenz, keine Übertragung.", body: "Lizenz gebunden an benannte Nutzer; Weitergabe oder Übertragung ausgeschlossen." },
    // Gewährleistung
    { id: "cv_warr_1", familyId: "cf_warr", tone: "zart",     severityScore: 1, name: "24 Monate, ohne Rügepflicht",    summary: "24 Monate Gewährleistung ohne Rügepflicht.", body: "Der Anbieter gewährleistet die vertragsgemäße Beschaffenheit der Leistung für 24 Monate ab Übergabe; eine Rügepflicht besteht nicht." },
    { id: "cv_warr_2", familyId: "cf_warr", tone: "moderat",  severityScore: 2, name: "18 Monate, qualifizierte Rüge",  summary: "18 Monate Gewährleistung mit Rüge binnen 14 Tagen.", body: "Der Kunde rügt erkennbare Mängel innerhalb von 14 Tagen schriftlich; Gewährleistungsfrist beträgt 18 Monate." },
    { id: "cv_warr_3", familyId: "cf_warr", tone: "standard", severityScore: 3, name: "12 Monate, gesetzliche Rüge",    summary: "12 Monate, Rüge nach §377 HGB.", body: "Es gilt eine Gewährleistungsfrist von 12 Monaten ab Lieferung; die Rügeobliegenheit nach §377 HGB bleibt unberührt." },
    { id: "cv_warr_4", familyId: "cf_warr", tone: "streng",   severityScore: 4, name: "6 Monate, Nachbesserung exklusiv", summary: "6 Monate; Nachbesserung als ausschließlicher Rechtsbehelf.", body: "Gewährleistungsfrist 6 Monate. Bei Mängeln steht dem Kunden ausschließlich das Recht auf Nachbesserung zu; Minderung und Rücktritt sind ausgeschlossen." },
    { id: "cv_warr_5", familyId: "cf_warr", tone: "hart",     severityScore: 5, name: "Ausschluss bei SaaS-Updates",     summary: "Keine Gewährleistung für vom Anbieter veröffentlichte Updates.", body: "Eine Gewährleistung für vom Anbieter bereitgestellte Updates und Patches ist ausgeschlossen, soweit gesetzlich zulässig." },
    // Geheimhaltung
    { id: "cv_conf_1", familyId: "cf_conf", tone: "zart",     severityScore: 1, name: "Unbefristet, Vertragsstrafe",    summary: "Unbefristete Geheimhaltung mit Vertragsstrafe je Verstoß.", body: "Vertrauliche Informationen sind zeitlich unbegrenzt geheim zu halten. Bei jedem Verstoß ist eine Vertragsstrafe von EUR 25.000 verwirkt." },
    { id: "cv_conf_2", familyId: "cf_conf", tone: "moderat",  severityScore: 2, name: "10 Jahre nach Vertragsende",     summary: "10 Jahre Nachlaufzeit für vertrauliche Informationen.", body: "Die Geheimhaltungspflichten gelten für 10 Jahre über das Vertragsende hinaus." },
    { id: "cv_conf_3", familyId: "cf_conf", tone: "standard", severityScore: 3, name: "5 Jahre nach Vertragsende",      summary: "5 Jahre Nachlaufzeit; übliche Ausnahmen.", body: "Vertrauliche Informationen werden für 5 Jahre nach Vertragsende geheim gehalten; übliche Ausnahmen (öffentlich bekannt, gesetzlich gefordert) gelten." },
    { id: "cv_conf_4", familyId: "cf_conf", tone: "streng",   severityScore: 4, name: "3 Jahre, Notice-and-Cure",       summary: "3 Jahre Nachlaufzeit; Heilungsfrist 30 Tage.", body: "Geheimhaltungspflicht 3 Jahre nach Vertragsende. Bei Verletzung erhält die verletzende Partei eine Heilungsfrist von 30 Tagen." },
    { id: "cv_conf_5", familyId: "cf_conf", tone: "hart",     severityScore: 5, name: "Vertragsdauer + 12 Monate",       summary: "Geheimhaltung nur während Vertragslaufzeit + 12 Monate.", body: "Geheimhaltungspflichten enden 12 Monate nach Vertragsende; danach ist eine Verwendung außerhalb wettbewerbsrechtlicher Schranken zulässig." },
    // Gerichtsstand
    { id: "cv_juris_1", familyId: "cf_juris", tone: "zart",    severityScore: 1, name: "Sitz des Kunden, deutsches Recht", summary: "Gerichtsstand am Sitz des Kunden, deutsches Recht.", body: "Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Ausschließlicher Gerichtsstand ist der Sitz des Kunden." },
    { id: "cv_juris_2", familyId: "cf_juris", tone: "moderat", severityScore: 2, name: "Frankfurt a.M., Schiedsklausel",  summary: "Schiedsverfahren DIS, Sitz Frankfurt a.M.", body: "Streitigkeiten werden nach der DIS-Schiedsgerichtsordnung entschieden. Schiedsort ist Frankfurt am Main; Verfahrenssprache Deutsch." },
    { id: "cv_juris_3", familyId: "cf_juris", tone: "standard",severityScore: 3, name: "Sitz des Anbieters, deutsches Recht", summary: "Gerichtsstand am Sitz des Anbieters; deutsches Recht.", body: "Ausschließlicher Gerichtsstand ist der Sitz des Anbieters. Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts." },
    { id: "cv_juris_4", familyId: "cf_juris", tone: "streng",  severityScore: 4, name: "London, englisches Recht",        summary: "Englisches Recht; Gerichtsstand London.", body: "Es gilt das Recht von England und Wales. Ausschließlicher Gerichtsstand ist London." },
    { id: "cv_juris_5", familyId: "cf_juris", tone: "hart",    severityScore: 5, name: "ICC Schiedsverfahren Singapur",   summary: "ICC-Schiedsverfahren mit Sitz Singapur.", body: "Streitigkeiten werden ausschließlich durch ein Schiedsverfahren nach den ICC-Regeln in Singapur entschieden. Verfahrenssprache Englisch." },
  ];
  await db.insert(clauseVariantsTable).values(variantRows.map(v => ({
    id: v.id, familyId: v.familyId, name: v.name, summary: v.summary, body: v.body,
    severity: sevFromScore(v.severityScore), severityScore: v.severityScore, tone: v.tone,
  })));

  // Sprachfassungen: DE spiegelt die Basis-Variante; EN aus dem Legal-Review.
  const enTranslations = LEGAL_REVIEWED_EN_TRANSLATIONS;
  const translationRows: Array<{
    id: string; variantId: string; locale: string; name: string; summary: string; body: string;
    source: string | null; license: string | null; sourceUrl: string | null;
  }> = [];
  for (const v of variantRows) {
    translationRows.push({
      id: `cvt_${v.id}_de`,
      variantId: v.id,
      locale: "de",
      name: v.name,
      summary: v.summary,
      body: v.body,
      source: "legal-reviewed",
      license: "Internal",
      sourceUrl: null,
    });
    const en = enTranslations[v.id];
    if (en) {
      translationRows.push({
        id: `cvt_${v.id}_en`,
        variantId: v.id,
        locale: "en",
        name: en.name,
        summary: en.summary,
        body: en.body,
        source: "legal-reviewed",
        license: "Internal",
        sourceUrl: null,
      });
    }
  }
  await db.insert(clauseVariantTranslationsTable).values(translationRows);

  // Contracts
  const contracts = [
    { id: "ctr_001", dealId: "dl_003", title: "Nordstern – Capacity Expansion MSA", status: "in_review", version: 3, riskLevel: "high",   template: "Master Services Agreement" },
    { id: "ctr_002", dealId: "dl_001", title: "Vorwerk – Fleet Modernisation Order Form", status: "drafting",  version: 1, riskLevel: "medium", template: "Order Form" },
    { id: "ctr_003", dealId: "dl_009", title: "Fjord – Vessel Telemetry MSA",        status: "signed",    version: 2, riskLevel: "low",    template: "Master Services Agreement" },
    { id: "ctr_004", dealId: "dl_004", title: "BlueRiver – Pipeline Sensors SOW",    status: "in_review", version: 2, riskLevel: "medium", template: "Statement of Work" },
    { id: "ctr_005", dealId: "dl_008", title: "Northwind – DC Rollout Order Form",   status: "out_for_signature", version: 1, riskLevel: "low", template: "Order Form" },
  ];
  await db.insert(contractsTable).values(contracts.map(c => ({ ...c, validUntil: isoDate(daysFromNow(365)) })));

  const ccSeed: Array<{ id: string; contractId: string; familyId: string; activeVariantId: string }> = [
    { id: "cc_001", contractId: "ctr_001", familyId: "cf_liab", activeVariantId: "cv_liab_1" }, // zart — Eskalation erwartet
    { id: "cc_002", contractId: "ctr_001", familyId: "cf_term", activeVariantId: "cv_term_4" },
    { id: "cc_003", contractId: "ctr_001", familyId: "cf_sla",  activeVariantId: "cv_sla_2"  },
    { id: "cc_004", contractId: "ctr_001", familyId: "cf_pay",  activeVariantId: "cv_pay_2"  },
    { id: "cc_005", contractId: "ctr_002", familyId: "cf_liab", activeVariantId: "cv_liab_4" },
    { id: "cc_006", contractId: "ctr_002", familyId: "cf_term", activeVariantId: "cv_term_2" },
    { id: "cc_007", contractId: "ctr_003", familyId: "cf_liab", activeVariantId: "cv_liab_2" },
    { id: "cc_008", contractId: "ctr_003", familyId: "cf_sla",  activeVariantId: "cv_sla_2"  },
    { id: "cc_009", contractId: "ctr_004", familyId: "cf_data", activeVariantId: "cv_data_3" },
    { id: "cc_010", contractId: "ctr_005", familyId: "cf_pay",  activeVariantId: "cv_pay_3"  },
  ];
  const famMap = new Map(families.map(f => [f.id, f.name]));
  const varMap = new Map(variantRows.map(v => [v.id, v]));
  await db.insert(contractClausesTable).values(ccSeed.map(cc => {
    const v = varMap.get(cc.activeVariantId)!;
    return {
      id: cc.id, contractId: cc.contractId,
      familyId: cc.familyId, activeVariantId: cc.activeVariantId,
      family: famMap.get(cc.familyId) ?? "", variant: v.name,
      severity: sevFromScore(v.severityScore), summary: v.summary,
    };
  }));

  // Negotiations
  await db.insert(negotiationsTable).values([
    { id: "ng_001", dealId: "dl_001", status: "active",      round: 3, lastReactionType: "counterproposal", riskLevel: "medium" },
    { id: "ng_002", dealId: "dl_003", status: "active",      round: 4, lastReactionType: "objection",       riskLevel: "high"   },
    { id: "ng_003", dealId: "dl_004", status: "active",      round: 2, lastReactionType: "question",        riskLevel: "medium" },
    { id: "ng_004", dealId: "dl_008", status: "concluded",   round: 3, lastReactionType: "acceptance",      riskLevel: "low"    },
    { id: "ng_005", dealId: "dl_007", status: "active",      round: 1, lastReactionType: "objection",       riskLevel: "high"   },
  ]);

  await db.insert(customerReactionsTable).values([
    { id: "cr_001", negotiationId: "ng_001", type: "counterproposal", topic: "Pricing",     summary: "Asked for 12% volume discount given multi-site rollout.",        source: "Email – Klaus Vorwerk", priority: "high",   impactPct: "12",  priceDeltaPct: "-12" },
    { id: "cr_002", negotiationId: "ng_001", type: "question",        topic: "Implementation", summary: "Wants confirmation on rollout timeline across 3 sites.",      source: "Workshop call",        priority: "medium", impactPct: null },
    { id: "cr_003", negotiationId: "ng_002", type: "objection",       topic: "Liability",   summary: "Refusing standard cap; demanding uncapped IP indemnity.",        source: "Legal redline",        priority: "high",   impactPct: null, requestedClauseVariantId: "cv_001" },
    { id: "cr_004", negotiationId: "ng_002", type: "counterproposal", topic: "Payment",     summary: "Proposes Net 60 instead of Net 30.",                            source: "CFO email",            priority: "medium", impactPct: "2.5", paymentTermsDeltaDays: 30 },
    { id: "cr_005", negotiationId: "ng_003", type: "question",        topic: "SLA",         summary: "Requesting clarity on response times during weekends.",          source: "Procurement call",     priority: "medium", impactPct: null },
    { id: "cr_006", negotiationId: "ng_004", type: "acceptance",      topic: "Final terms", summary: "Confirmed acceptance of revised counter.",                       source: "Email – Oliver Hayes", priority: "low",    impactPct: null },
    { id: "cr_007", negotiationId: "ng_005", type: "objection",       topic: "Total price", summary: "Concerns about CAPEX impact – wants phased rollout pricing.",    source: "CFO meeting",          priority: "high",   impactPct: "15",  priceDeltaPct: "-8", termMonthsDelta: 12 },
  ]);

  // Signatures
  const sigs = [
    // Sequential, warten auf CFO nach Solberg-Signatur
    { id: "sg_001", dealId: "dl_009", title: "Fjord – Vessel Telemetry MSA + Order Form", status: "in_progress", mode: "sequential", reminderIntervalHours: 48, escalationAfterHours: 120, lastReminderAt: daysFromNow(-1), deadline: daysFromNow(3) },
    // Parallel, ein Signer durch, einer steht aus
    { id: "sg_002", dealId: "dl_008", title: "Northwind – DC Rollout Order Form",          status: "in_progress", mode: "parallel",   reminderIntervalHours: 24, escalationAfterHours: 96,  lastReminderAt: null,            deadline: daysFromNow(6) },
    // Blocked durch Decline
    { id: "sg_003", dealId: "dl_003", title: "Nordstern – Capacity Expansion MSA",         status: "blocked",     mode: "sequential", reminderIntervalHours: 48, escalationAfterHours: 120, lastReminderAt: null,            deadline: daysFromNow(14) },
    { id: "sg_004", dealId: "dl_012", title: "BlueRiver Maintenance Contract",             status: "completed",   mode: "sequential", reminderIntervalHours: 48, escalationAfterHours: 120, lastReminderAt: null,            deadline: daysFromNow(-7) },
  ];
  await db.insert(signaturePackagesTable).values(sigs);

  await db.insert(signersTable).values([
    { id: "sn_001", packageId: "sg_001", name: "Ingrid Solberg", email: "i.solberg@fjord.no", role: "Procurement Manager", order: 1, status: "signed",  sentAt: daysFromNow(-4), viewedAt: daysFromNow(-3), signedAt: daysFromNow(-1), isFallback: false },
    { id: "sn_002", packageId: "sg_001", name: "Erik Lindahl",   email: "e.lindahl@fjord.no", role: "CFO",                 order: 2, status: "sent",    sentAt: daysFromNow(-1), viewedAt: null,            lastReminderAt: daysFromNow(-1), isFallback: false },
    { id: "sn_003", packageId: "sg_002", name: "Oliver Hayes",   email: "o.hayes@northwind.co.uk", role: "Head of Supply",  order: 1, status: "signed",  sentAt: daysFromNow(-3), viewedAt: daysFromNow(-3), signedAt: daysFromNow(-2), isFallback: false },
    { id: "sn_004", packageId: "sg_002", name: "Priya Raman",    email: "priya@helix.com",   role: "VP Commercial",        order: 2, status: "viewed",  sentAt: daysFromNow(-3), viewedAt: daysFromNow(-1), isFallback: false },
    { id: "sn_005", packageId: "sg_003", name: "Dr. Stefan Reuter", email: "s.reuter@nordstern.de", role: "CFO",            order: 1, status: "declined", sentAt: daysFromNow(-5), viewedAt: daysFromNow(-4), declinedAt: daysFromNow(-2), declineReason: "Haftungs-Cap nicht akzeptiert, Legal-Review gefordert.", isFallback: false },
    { id: "sn_006", packageId: "sg_003", name: "Marcel Voss",    email: "marcel@helix.com",  role: "Senior AE",            order: 2, status: "pending", sentAt: null, isFallback: false },
    { id: "sn_007", packageId: "sg_004", name: "Eleanor Whitcombe", email: "e.whitcombe@blueriver.co.uk", role: "Director", order: 1, status: "signed", sentAt: daysFromNow(-10), viewedAt: daysFromNow(-9), signedAt: daysFromNow(-8), isFallback: false },
    { id: "sn_008", packageId: "sg_004", name: "James Whitfield",  email: "james@helix.com", role: "Regional Director",    order: 2, status: "signed", sentAt: daysFromNow(-10), viewedAt: daysFromNow(-8), signedAt: daysFromNow(-7), isFallback: false },
  ]);

  // Contract Amendments (Nachträge zu ctr_003 Fjord, der signed ist)
  await db.insert(contractAmendmentsTable).values([
    {
      id: "am_001",
      originalContractId: "ctr_003",
      number: "C-2026-003-A1",
      type: "price-change",
      title: "Preisanpassung +4,5% (Index-Klausel)",
      description: "Jährliche Indexierung auf Basis VPI, wie in §9.3 des Originalvertrags vereinbart.",
      status: "active",
      effectiveFrom: isoDate(daysFromNow(-30)),
      createdBy: "Priya Raman",
    },
    {
      id: "am_002",
      originalContractId: "ctr_003",
      number: "C-2026-003-A2",
      type: "scope-change",
      title: "Erweiterung um Wartungspaket Pro",
      description: "Zusätzliches Wartungspaket inkl. 24/7 Priority Support. Preisaufschlag separat geregelt.",
      status: "in_review",
      effectiveFrom: null,
      createdBy: "James Whitfield",
    },
  ]);
  await db.insert(amendmentClausesTable).values([
    {
      id: "ac_001",
      amendmentId: "am_001",
      operation: "modify",
      family: "Payment",
      familyId: "cf_pay",
      beforeVariantId: null,
      afterVariantId: null,
      beforeSummary: "Preisliste Stand 2025, Net 30",
      afterSummary: "Preisliste +4,5% gemäß VPI, Net 30 unverändert",
      severity: "low",
    },
    {
      id: "ac_002",
      amendmentId: "am_002",
      operation: "add",
      family: "SLA",
      familyId: "cf_sla",
      beforeVariantId: null,
      afterVariantId: "cv_sla_2",
      beforeSummary: null,
      afterSummary: "24/7 Priority Support mit 2h-Reaktionszeit für P1-Incidents",
      severity: "medium",
    },
  ]);

  // Price increases
  await db.insert(priceIncreaseCampaignsTable).values([
    { id: "pi_001", name: "FY26 Annual Uplift – DACH", status: "in_progress", effectiveDate: isoDate(daysFromNow(45)), currency: "EUR", averageUpliftPct: "4.5" },
    { id: "pi_002", name: "FY26 Annual Uplift – UK",   status: "drafting",    effectiveDate: isoDate(daysFromNow(60)), currency: "GBP", averageUpliftPct: "3.8" },
    { id: "pi_003", name: "Hardware Index Adjustment", status: "completed",   effectiveDate: isoDate(daysFromNow(-30)), currency: "EUR", averageUpliftPct: "6.2" },
  ]);

  await db.insert(priceIncreaseLettersTable).values([
    { id: "pl_001", campaignId: "pi_001", accountId: "acc_001", status: "accepted", upliftPct: "4.5", sentAt: daysFromNow(-10), respondedAt: daysFromNow(-3) },
    { id: "pl_002", campaignId: "pi_001", accountId: "acc_002", status: "accepted", upliftPct: "4.2", sentAt: daysFromNow(-10), respondedAt: daysFromNow(-5) },
    { id: "pl_003", campaignId: "pi_001", accountId: "acc_004", status: "negotiating", upliftPct: "5.0", sentAt: daysFromNow(-9), respondedAt: daysFromNow(-2) },
    { id: "pl_004", campaignId: "pi_001", accountId: "acc_005", status: "pending",  upliftPct: "4.8", sentAt: daysFromNow(-8), respondedAt: null },
    { id: "pl_005", campaignId: "pi_001", accountId: "acc_006", status: "rejected", upliftPct: "5.5", sentAt: daysFromNow(-9), respondedAt: daysFromNow(-1) },
    { id: "pl_006", campaignId: "pi_002", accountId: "acc_003", status: "pending",  upliftPct: "3.8", sentAt: null, respondedAt: null },
    { id: "pl_007", campaignId: "pi_002", accountId: "acc_007", status: "pending",  upliftPct: "4.1", sentAt: null, respondedAt: null },
    { id: "pl_008", campaignId: "pi_003", accountId: "acc_001", status: "accepted", upliftPct: "6.2", sentAt: daysFromNow(-45), respondedAt: daysFromNow(-32) },
    { id: "pl_009", campaignId: "pi_003", accountId: "acc_002", status: "accepted", upliftPct: "6.5", sentAt: daysFromNow(-45), respondedAt: daysFromNow(-30) },
  ]);

  // Timeline events
  const tl = [
    { type: "deal_stage", title: "Vorwerk moved to Negotiation", description: "Deal advanced from Proposal to Negotiation.", actor: "Anna Brandt",  dealId: "dl_001", at: daysFromNow(-2) },
    { type: "quote_sent", title: "Quote Q-2026-0118 v3 sent",     description: "Revised pricing with 8.5% volume discount.", actor: "Anna Brandt",  dealId: "dl_001", at: daysFromNow(-1) },
    { type: "approval",   title: "Discount approval requested",    description: "12% discount on Vorwerk fleet deal pending Deal Desk.", actor: "Anna Brandt", dealId: "dl_001", at: daysFromNow(-1) },
    { type: "contract",   title: "Nordstern MSA in Legal review",  description: "Liability cap waiver under counsel review.", actor: "Sara Lindqvist", dealId: "dl_003", at: daysFromNow(-3) },
    { type: "negotiation",title: "BlueRiver SLA question raised",  description: "Customer asked about weekend response times.", actor: "James Whitfield", dealId: "dl_004", at: daysFromNow(-1) },
    { type: "signature",  title: "Fjord – first signer signed",    description: "Ingrid Solberg signed; CFO pending.", actor: "System", dealId: "dl_009", at: daysFromNow(-1) },
    { type: "deal_won",   title: "Nordstern Spare Parts Won",      description: "EUR 340k closed-won.", actor: "Marcel Voss", dealId: "dl_013", at: daysFromNow(-22) },
    { type: "price",      title: "Hardware index uplift completed", description: "6.2% applied across DACH hardware portfolio.", actor: "Priya Raman", dealId: null, at: daysFromNow(-30) },
    { type: "copilot",    title: "Risk detected on Atlas deal",     description: "Discount erosion detected vs. similar won deals.", actor: "Copilot", dealId: "dl_007", at: daysFromNow(-1) },
    { type: "quote_sent", title: "Northwind v2 quote sent",         description: "Counter quote with phased rollout option.", actor: "James Whitfield", dealId: "dl_008", at: daysFromNow(-2) },
  ];
  await db.insert(timelineEventsTable).values(
    tl.map((t, i) => ({ id: id("tl", i + 1), tenantId: "tn_root", ...t })),
  );

  // Copilot — insights are generated dynamically by insights/generators.ts
  // from reactions, approvals, letters and quote-versions. No static seed.

  await db.insert(copilotThreadsTable).values([
    { id: "ct_th_001", tenantId: "tn_root", title: "Wie gehe ich mit Vorwerks 12%-Forderung um?",    scope: "deal:dl_001", lastMessage: "Vorschlag 9% + Mehrjahres-Bindung. Marge bleibt über 30% Floor.",                messageCount: 6 },
    { id: "ct_th_002", tenantId: "tn_root", title: "Renewal-Mail für Castell entwerfen",             scope: "deal:dl_005", lastMessage: "In deinem Stil entworfen. Soll ich einen Pro-Tier-Upsell-Absatz ergänzen?",     messageCount: 4 },
    { id: "ct_th_003", tenantId: "tn_root", title: "Gewonnene vs. verlorene Deals dieses Quartal",  scope: "global",       lastMessage: "Rabattdisziplin ist der stärkste Prädiktor (R² 0,71).",                          messageCount: 9 },
    { id: "ct_th_004", tenantId: "tn_root", title: "Nordstern Legal-Redlines zusammenfassen",        scope: "deal:dl_003", lastMessage: "4 materielle Änderungen; 2 erfordern Deal Desk + Legal.",                        messageCount: 5 },
  ]);

  // Copilot messages for existing threads
  await db.insert(copilotMessagesTable).values([
    { id: "cm_001", tenantId: "tn_root", threadId: "ct_th_001", role: "user",      content: "Vorwerk fordert 12% Rabatt. Was ist vertretbar?" },
    { id: "cm_002", tenantId: "tn_root", threadId: "ct_th_001", role: "assistant", content: "Median gewonnener Deals im DACH-Segment liegt bei 7,8%. Gegenangebot mit 9% bei 24-monatiger Bindung hält die Marge über 30%." },
    { id: "cm_003", tenantId: "tn_root", threadId: "ct_th_001", role: "user",      content: "Was, wenn sie die Laufzeitverlängerung ablehnen?" },
    { id: "cm_004", tenantId: "tn_root", threadId: "ct_th_001", role: "assistant", content: "Biete 8% mit Quartals-Mengen-Rabatt ab 110% Forecast. Netto-Effekt gleich, Optik besser." },
    { id: "cm_005", tenantId: "tn_root", threadId: "ct_th_002", role: "user",      content: "Entwirf eine Renewal-Mail für Castell." },
    { id: "cm_006", tenantId: "tn_root", threadId: "ct_th_002", role: "assistant", content: "In deinem Stil entworfen. Soll ich einen Pro-Tier-Upsell-Absatz ergänzen?" },
    { id: "cm_007", tenantId: "tn_root", threadId: "ct_th_003", role: "user",      content: "Vergleiche gewonnene vs. verlorene Deals dieses Quartal." },
    { id: "cm_008", tenantId: "tn_root", threadId: "ct_th_003", role: "assistant", content: "Rabattdisziplin (R² 0,71) ist der stärkste Prädiktor. Verlorene Deals lagen im Schnitt bei 13,4% Rabatt vs. 7,8% bei gewonnenen." },
    { id: "cm_009", tenantId: "tn_root", threadId: "ct_th_004", role: "user",      content: "Fasse die Nordstern Legal-Redlines zusammen." },
    { id: "cm_010", tenantId: "tn_root", threadId: "ct_th_004", role: "assistant", content: "4 materielle Änderungen; Haftungs-Cap-Verzicht und IP-Freistellung erfordern Deal Desk + Legal-Freigabe." },
  ]);

  // Audit log — all seeded under tn_root (the only tenant we ship with).
  await db.insert(auditLogTable).values([
    { id: "au_001", tenantId: "tn_root", entityType: "deal",     entityId: "dl_001", action: "discount_changed",  actor: "Anna Brandt",      summary: "Rabatt auf Vorwerk-Renewal von 8% auf 12% angehoben.",          beforeJson: '{"discount":8}',  afterJson: '{"discount":12}', at: daysFromNow(-2) },
    { id: "au_002", tenantId: "tn_root", entityType: "contract", entityId: "ctr_001", action: "clause_swapped",    actor: "Sara Lindqvist",   summary: "Haftungs-Cap-Klausel auf Standard-Variante umgestellt.",          beforeJson: null, afterJson: null, at: daysFromNow(-3) },
    { id: "au_003", tenantId: "tn_root", entityType: "price",    entityId: "pr_001", action: "price_overridden",  actor: "Priya Raman",      summary: "Override auf PRO-200 (-4,5%) für Atlas-Account.",                 beforeJson: '{"price":1280}', afterJson: '{"price":1222}', at: daysFromNow(-5) },
    { id: "au_004", tenantId: "tn_root", entityType: "deal",     entityId: "dl_007", action: "stage_changed",     actor: "Marcel Voss",      summary: "Atlas Energy von Verhandlung → Closing verschoben.",              beforeJson: null, afterJson: null, at: daysFromNow(-1) },
    { id: "au_005", tenantId: "tn_root", entityType: "letter",   entityId: "pl_001", action: "letter_sent",       actor: "Priya Raman",      summary: "Hardware-Uplift-Schreiben an 14 Kunden versendet.",               beforeJson: null, afterJson: null, at: daysFromNow(-6) },
    { id: "au_006", tenantId: "tn_root", entityType: "deal",     entityId: "dl_003", action: "comment_added",     actor: "James Whitfield",  summary: "Champion bestätigte erhaltene Budget-Freigabe.",                  beforeJson: null, afterJson: null, at: daysFromNow(-4) },
    { id: "au_007", tenantId: "tn_root", entityType: "contract", entityId: "ctr_005", action: "version_published", actor: "Sara Lindqvist",   summary: "Northwind v2 mit Stufen-Rollout-Option veröffentlicht.",          beforeJson: null, afterJson: null, at: daysFromNow(-2) },
    { id: "au_008", tenantId: "tn_root", entityType: "order",    entityId: "oc_001", action: "handover_started",  actor: "Anna Brandt",      summary: "Handover-Prüfungen für OC-2026-001 gestartet.",                   beforeJson: null, afterJson: null, at: daysFromNow(-1) },
  ]);

  // Order confirmations
  await db.insert(orderConfirmationsTable).values([
    { id: "oc_001", dealId: "dl_001", contractId: "ctr_002", number: "OC-2026-001", status: "ready_for_handover", readinessScore: 100, totalAmount: "184500.00",  currency: "EUR", expectedDelivery: isoDate(daysFromNow(21)), handoverAt: null,            salesOwnerId: "u_anna",   onboardingOwnerId: null,     handoverStartedAt: null,             handoverNote: null, handoverContact: null, handoverContactEmail: null, handoverDeliveryDate: null, handoverCriticalNotes: null, slaDays: 7,  completedAt: null,             createdAt: daysFromNow(-3) },
    { id: "oc_002", dealId: "dl_005", contractId: null,     number: "OC-2026-002", status: "checks_pending",      readinessScore: 64,  totalAmount: "92800.00",   currency: "EUR", expectedDelivery: isoDate(daysFromNow(35)), handoverAt: null,            salesOwnerId: "u_marcel", onboardingOwnerId: null,     handoverStartedAt: null,             handoverNote: null, handoverContact: null, handoverContactEmail: null, handoverDeliveryDate: null, handoverCriticalNotes: null, slaDays: 7,  completedAt: null,             createdAt: daysFromNow(-2) },
    { id: "oc_003", dealId: "dl_013", contractId: null,     number: "OC-2026-003", status: "in_onboarding",       readinessScore: 100, totalAmount: "340000.00",  currency: "EUR", expectedDelivery: isoDate(daysFromNow(-5)),  handoverAt: daysFromNow(-7), salesOwnerId: "u_sara",   onboardingOwnerId: "u_priya", handoverStartedAt: daysFromNow(-3), handoverNote: "Kunde erwartet Kickoff mit technischer Betriebsleitung.", handoverContact: "Jens Walter", handoverContactEmail: "j.walter@vorwerk.de", handoverDeliveryDate: isoDate(daysFromNow(14)), handoverCriticalNotes: "Firewall-Freigabe für Telemetrie-Port 8443 benötigt.", slaDays: 7,  completedAt: null,             createdAt: daysFromNow(-25) },
    { id: "oc_004", dealId: "dl_007", contractId: null,     number: "OC-2026-004", status: "checks_pending",      readinessScore: 38,  totalAmount: "1240000.00", currency: "EUR", expectedDelivery: isoDate(daysFromNow(60)), handoverAt: null,            salesOwnerId: "u_james",  onboardingOwnerId: null,     handoverStartedAt: null,             handoverNote: null, handoverContact: null, handoverContactEmail: null, handoverDeliveryDate: null, handoverCriticalNotes: null, slaDays: 14, completedAt: null,             createdAt: daysFromNow(-1) },
  ]);

  await db.insert(orderConfirmationChecksTable).values([
    { id: "ocx_001", orderConfirmationId: "oc_001", label: "Bonität geprüft",             status: "ok",      detail: "EUR 250k Limit verfügbar.",             required: true  },
    { id: "ocx_002", orderConfirmationId: "oc_001", label: "Steuer- und USt-Daten",       status: "ok",      detail: "DE-USt-ID validiert.",                  required: true  },
    { id: "ocx_003", orderConfirmationId: "oc_001", label: "Lieferadresse bestätigt",     status: "ok",      detail: "Standort Wuppertal freigegeben.",       required: true  },
    { id: "ocx_004", orderConfirmationId: "oc_001", label: "Zahlungsziele abgestimmt",    status: "ok",      detail: "Net45 durch Kunde bestätigt.",          required: true  },
    { id: "ocx_005", orderConfirmationId: "oc_002", label: "Bonität geprüft",             status: "ok",      detail: "EUR 100k Limit verfügbar.",             required: true  },
    { id: "ocx_006", orderConfirmationId: "oc_002", label: "ERP-Artikelmapping",          status: "warning", detail: "2 von 14 SKUs unvollständig.",          required: false },
    { id: "ocx_007", orderConfirmationId: "oc_002", label: "Logistik-Slot reserviert",    status: "pending", detail: "Warten auf Spediteur-Bestätigung.",     required: true  },
    { id: "ocx_008", orderConfirmationId: "oc_003", label: "Alle Pflicht-Checks grün",    status: "ok",      detail: "Übergabe an Onboarding abgeschlossen.", required: true  },
    { id: "ocx_009", orderConfirmationId: "oc_004", label: "Bonität geprüft",             status: "blocked", detail: "Exposure übersteigt Limit um EUR 240k.",required: true  },
    { id: "ocx_010", orderConfirmationId: "oc_004", label: "Exportkontroll-Screening",    status: "warning", detail: "Dual-Use-Prüfung erforderlich.",        required: false },
  ]);

  // Entity versions
  await db.insert(entityVersionsTable).values([
    { id: "ev_001", entityType: "contract",       entityId: "ctr_001", version: 1, label: "Draft v1",     snapshot: '{"clauses":12}', actor: "Anna Brandt",    comment: "Initial draft from template.",                  createdAt: daysFromNow(-14) },
    { id: "ev_002", entityType: "contract",       entityId: "ctr_001", version: 2, label: "Legal v2",     snapshot: '{"clauses":13}', actor: "Sara Lindqvist", comment: "Liability cap aligned to standard.",            createdAt: daysFromNow(-8) },
    { id: "ev_003", entityType: "contract",       entityId: "ctr_001", version: 3, label: "Customer v3",  snapshot: '{"clauses":13}', actor: "Anna Brandt",    comment: "Customer redlines accepted on payment terms.", createdAt: daysFromNow(-3) },
    { id: "ev_004", entityType: "contract",       entityId: "ctr_005", version: 1, label: "Draft v1",     snapshot: '{"clauses":10}', actor: "James Whitfield",comment: "Northwind initial.",                            createdAt: daysFromNow(-10) },
    { id: "ev_005", entityType: "contract",       entityId: "ctr_005", version: 2, label: "Phased v2",    snapshot: '{"clauses":11}', actor: "James Whitfield",comment: "Phased rollout option added.",                  createdAt: daysFromNow(-2) },
    { id: "ev_006", entityType: "price_position", entityId: "pp_001",  version: 1, label: "Base list",    snapshot: '{"price":1280}', actor: "Priya Raman",    comment: "List price baseline.",                          createdAt: daysFromNow(-30) },
    { id: "ev_007", entityType: "price_position", entityId: "pp_001",  version: 2, label: "Atlas override",snapshot:'{"price":1222}', actor: "Priya Raman",    comment: "-4.5% override for Atlas Energy.",              createdAt: daysFromNow(-5) },
    { id: "ev_008", entityType: "quote",          entityId: "qt_001",  version: 1, label: "Initial offer", snapshot: '{"discount":5}', actor: "Anna Brandt",    comment: "First version sent to customer.",               createdAt: daysFromNow(-12) },
    { id: "ev_009", entityType: "quote",          entityId: "qt_001",  version: 2, label: "Discounted",    snapshot: '{"discount":8}', actor: "Anna Brandt",    comment: "Increased discount after negotiation.",         createdAt: daysFromNow(-4) },
  ]);

  await seedQuoteTemplatesIdempotent();

  logger.info("Seed complete.");
}

/**
 * Idempotent seed for quote templates, attachment library, and industry profiles.
 * Safe to run on every boot — uses onConflictDoNothing on primary key.
 */
export async function seedQuoteTemplatesIdempotent(): Promise<void> {
  // ─── Quote Templates (3 system templates: SaaS, Consulting, Manufacturing) ───
  await db.insert(quoteTemplatesTable).values([
    {
      id: "qtpl_saas",
      tenantId: "tn_root",
      companyId: null,
      brandId: null,
      name: "SaaS Subscription (System)",
      description: "Standardvorlage für SaaS-Subscriptions mit MRR-orientierter Preisgestaltung.",
      industry: "saas",
      isSystem: true,
      defaultDiscountPct: "8",
      defaultMarginPct: "70",
      defaultValidityDays: 30,
      defaultLineItems: [
        { name: "Platform Subscription (Annual)", description: "Pro-User-Lizenz, jährlich abrechenbar.", quantity: 50, unitPrice: 480, listPrice: 480, discountPct: 0 },
        { name: "Professional Onboarding", description: "Implementierung, Datenmigration, Schulung (Remote).", quantity: 1, unitPrice: 8500, listPrice: 9500, discountPct: 10 },
        { name: "Premium Support (Gold SLA)", description: "24/7-Support, < 1 h Reaktionszeit für P1.", quantity: 1, unitPrice: 4800, listPrice: 4800, discountPct: 0 },
      ],
      defaultAttachmentLibraryIds: ["att_dpa", "att_sla_gold", "att_security_overview"],
    },
    {
      id: "qtpl_consulting",
      tenantId: "tn_root",
      companyId: null,
      brandId: null,
      name: "Beratung Festpreis (System)",
      description: "Vorlage für T&M-orientierte Beratungs-Engagements mit Phasen und Meilensteinen.",
      industry: "consulting",
      isSystem: true,
      defaultDiscountPct: "5",
      defaultMarginPct: "45",
      defaultValidityDays: 21,
      defaultLineItems: [
        { name: "Discovery & Assessment", description: "2 Wochen, Senior Consultant + Solution Architect.", quantity: 80, unitPrice: 180, listPrice: 200, discountPct: 10 },
        { name: "Design & Konzeption", description: "Lösungsdesign, Architekturentscheidungen, Roadmap.", quantity: 120, unitPrice: 180, listPrice: 200, discountPct: 10 },
        { name: "Implementierung", description: "Build-Phase, agil, 2-Wochen-Sprints.", quantity: 240, unitPrice: 165, listPrice: 180, discountPct: 8 },
        { name: "Hypercare (4 Wochen)", description: "Stabilisierung nach Go-Live.", quantity: 1, unitPrice: 12000, listPrice: 14000, discountPct: 14 },
      ],
      defaultAttachmentLibraryIds: ["att_company_profile", "att_case_studies", "att_team_cv"],
    },
    {
      id: "qtpl_manufacturing",
      tenantId: "tn_root",
      companyId: null,
      brandId: null,
      name: "Industrie Komplettangebot (System)",
      description: "Vorlage für Anlagen/Komponenten + Service-Vertrag mit INCOTERMS und Gewährleistung.",
      industry: "manufacturing",
      isSystem: true,
      defaultDiscountPct: "4",
      defaultMarginPct: "32",
      defaultValidityDays: 45,
      defaultLineItems: [
        { name: "Anlage Typ A-Serie", description: "Inkl. Montage, Inbetriebnahme, FAT.", quantity: 1, unitPrice: 145000, listPrice: 158000, discountPct: 8 },
        { name: "Ersatzteilpaket Erstausstattung", description: "Verschleißteile für 12 Monate Betrieb.", quantity: 1, unitPrice: 18500, listPrice: 19800, discountPct: 7 },
        { name: "Service-Vertrag Gold (24 Monate)", description: "2 Wartungseinsätze/Jahr, < 24 h Vor-Ort-Reaktion.", quantity: 1, unitPrice: 22400, listPrice: 24000, discountPct: 7 },
        { name: "Schulung Bedienpersonal", description: "3 Tage vor Ort, max. 6 Teilnehmer.", quantity: 1, unitPrice: 4800, listPrice: 5200, discountPct: 8 },
      ],
      defaultAttachmentLibraryIds: ["att_datasheet_typeA", "att_warranty_terms", "att_incoterms_dap"],
    },
  ]).onConflictDoNothing();

  await db.insert(quoteTemplateSectionsTable).values([
    // SaaS
    { id: "qtsec_saas_cover",  templateId: "qtpl_saas",  kind: "cover",  title: "Kommerzielles Angebot",
      body: "Vielen Dank für Ihr Interesse an unserer Plattform. Dieses Angebot fasst Lizenzen, Onboarding und Support für Ihre Organisation zusammen.", order: 0 },
    { id: "qtsec_saas_intro",  templateId: "qtpl_saas",  kind: "intro",  title: "Einleitung",
      body: "Mit dieser Subscription erhalten Sie Zugang zur vollständigen Plattform inklusive aller Standard-Module. Die Lizenzierung erfolgt pro aktiven User auf Jahresbasis.", order: 1 },
    { id: "qtsec_saas_scope",  templateId: "qtpl_saas",  kind: "scope",  title: "Leistungsumfang",
      body: "Im Lieferumfang enthalten: Plattform-Lizenz, technisches Onboarding (8 Wochen), Datenmigration aus bestehenden Systemen, Schulung der Key-User sowie Premium-Support gemäß SLA Gold.", order: 2 },
    { id: "qtsec_saas_terms",  templateId: "qtpl_saas",  kind: "terms",  title: "Vertragskonditionen",
      body: "Laufzeit 36 Monate, jährliche Abrechnung im Voraus. Zahlungsziel 30 Tage netto. Preisanpassung jährlich gemäß VPI, max. 4 %. Kündigung 90 Tage zum Ende der Vertragslaufzeit.", order: 3 },
    { id: "qtsec_saas_appx",   templateId: "qtpl_saas",  kind: "appendix", title: "Anhänge",
      body: "Auftragsverarbeitungsvertrag (DPA), SLA Gold, Security Overview sowie technisches Datenblatt sind Bestandteil dieses Angebots.", order: 4 },

    // Consulting
    { id: "qtsec_cons_cover",  templateId: "qtpl_consulting",  kind: "cover",  title: "Beratungsangebot",
      body: "Wir freuen uns, Ihnen unser Angebot für die Begleitung Ihres Vorhabens zu unterbreiten. Schwerpunkte: Discovery, Design und schrittweise Implementierung.", order: 0 },
    { id: "qtsec_cons_intro",  templateId: "qtpl_consulting",  kind: "intro",  title: "Vorgehen",
      body: "Wir arbeiten in vier Phasen: Discovery (2 Wochen) → Design (3 Wochen) → Implementierung (12 Wochen, agil) → Hypercare (4 Wochen). Sie erhalten wöchentlich Status-Updates.", order: 1 },
    { id: "qtsec_cons_scope",  templateId: "qtpl_consulting",  kind: "scope",  title: "Leistungsumfang",
      body: "Senior Consultant + Solution Architect über die gesamte Laufzeit, ergänzt um 2 Implementierungs-Engineers in der Build-Phase. Aufwandsbasierte Abrechnung pro Phase nach Festpreis-Korridor (+/- 10 %).", order: 2 },
    { id: "qtsec_cons_terms",  templateId: "qtpl_consulting",  kind: "terms",  title: "Konditionen",
      body: "Reisekosten nach Aufwand. Zahlungsziel 21 Tage netto. Storno-Regelung: bis 14 Tage vor Sprint-Start kostenfrei. Geistige Eigentumsrechte am Ergebnis gehen mit Bezahlung an Sie über.", order: 3 },

    // Manufacturing
    { id: "qtsec_mfg_cover",   templateId: "qtpl_manufacturing", kind: "cover",  title: "Industrielles Angebot",
      body: "Komplettangebot für Lieferung, Montage, Inbetriebnahme und Service Ihrer Anlage. Inklusive Schulung und Erstausstattung Ersatzteile.", order: 0 },
    { id: "qtsec_mfg_intro",   templateId: "qtpl_manufacturing", kind: "intro",  title: "Anlage und Konfiguration",
      body: "Die angebotene Anlage entspricht der Konfiguration aus unserem gemeinsamen Workshop. Lieferzeit ab Werk: 12-14 Wochen ab schriftlicher Auftragsbestätigung.", order: 1 },
    { id: "qtsec_mfg_scope",   templateId: "qtpl_manufacturing", kind: "scope",  title: "Leistungsumfang",
      body: "Anlage A-Serie (1 Stück), Werks-FAT, Verpackung exportgerecht, Lieferung DAP, Montage und Inbetriebnahme vor Ort, FAT-Protokoll, Schulung des Bedienpersonals (3 Tage).", order: 2 },
    { id: "qtsec_mfg_terms",   templateId: "qtpl_manufacturing", kind: "terms",  title: "Konditionen und Gewährleistung",
      body: "INCOTERMS 2020 DAP. Zahlungsplan 30/60/10 (Bestellung/Lieferung/Abnahme). Gewährleistung 24 Monate ab Inbetriebnahme. Eigentumsvorbehalt bis vollständiger Bezahlung. Haftung gemäß BGB / HGB.", order: 3 },
    { id: "qtsec_mfg_appx",    templateId: "qtpl_manufacturing", kind: "appendix", title: "Beigefügte Unterlagen",
      body: "Technisches Datenblatt Typ A, Gewährleistungsbedingungen, INCOTERMS-Erläuterung DAP. Ergänzend stellen wir auf Anfrage Konformitätserklärungen und Zertifikate zur Verfügung.", order: 4 },
  ]).onConflictDoNothing();

  // ─── Attachment Library ───
  await db.insert(attachmentLibraryTable).values([
    { id: "att_dpa",                tenantId: "tn_root", companyId: null, brandId: null,
      name: "Auftragsverarbeitungsvertrag (DPA) v3.2",
      description: "Standard-DPA gemäß Art. 28 DSGVO. Stand 03/2026.",
      category: "terms", tags: ["dsgvo", "dpa", "datenschutz"],
      mimeType: "application/pdf", size: 184320,
      objectPath: "/objects/uploads/seed-dpa-v3-2.pdf",
      version: 3, createdBy: "user_priya" },
    { id: "att_sla_gold",           tenantId: "tn_root", companyId: null, brandId: null,
      name: "SLA Gold (24/7, < 1 h P1)",
      description: "Service Level Agreement Gold-Stufe für Premium-Support.",
      category: "terms", tags: ["sla", "support", "gold"],
      mimeType: "application/pdf", size: 97280,
      objectPath: "/objects/uploads/seed-sla-gold.pdf",
      version: 2, createdBy: "user_priya" },
    { id: "att_security_overview",  tenantId: "tn_root", companyId: null, brandId: null,
      name: "Security & Compliance Overview",
      description: "Übersicht ISO 27001, SOC 2 Type II, Verschlüsselung, Backups.",
      category: "datasheet", tags: ["security", "iso27001", "soc2"],
      mimeType: "application/pdf", size: 412672,
      objectPath: "/objects/uploads/seed-security-overview.pdf",
      version: 4, createdBy: "user_priya" },
    { id: "att_company_profile",    tenantId: "tn_root", companyId: null, brandId: null,
      name: "Helix Company Profile 2026",
      description: "Unternehmensvorstellung, Referenzen, Zertifizierungen.",
      category: "reference", tags: ["company", "referenzen"],
      mimeType: "application/pdf", size: 1485312,
      objectPath: "/objects/uploads/seed-company-profile.pdf",
      version: 5, createdBy: "user_priya" },
    { id: "att_case_studies",       tenantId: "tn_root", companyId: null, brandId: null,
      name: "Case Studies Beratung (DACH)",
      description: "5 ausgewählte Beratungs-Case-Studies aus dem DACH-Raum.",
      category: "reference", tags: ["case-study", "beratung"],
      mimeType: "application/pdf", size: 968704,
      objectPath: "/objects/uploads/seed-case-studies.pdf",
      version: 2, createdBy: "user_anna" },
    { id: "att_team_cv",            tenantId: "tn_root", companyId: null, brandId: null,
      name: "Team-Lebensläufe Senior Consulting",
      description: "Anonymisierte CVs der Senior-Consultants und Architekten.",
      category: "reference", tags: ["team", "cv", "beratung"],
      mimeType: "application/pdf", size: 524288,
      objectPath: "/objects/uploads/seed-team-cv.pdf",
      version: 1, createdBy: "user_anna" },
    { id: "att_datasheet_typeA",    tenantId: "tn_root", companyId: null, brandId: null,
      name: "Technisches Datenblatt Anlage Typ A",
      description: "Technische Spezifikation, Schnittstellen, Aufstellplan.",
      category: "datasheet", tags: ["technik", "anlage", "typ-a"],
      mimeType: "application/pdf", size: 716800,
      objectPath: "/objects/uploads/seed-datasheet-typeA.pdf",
      version: 6, createdBy: "user_priya" },
    { id: "att_warranty_terms",     tenantId: "tn_root", companyId: null, brandId: null,
      name: "Gewährleistungsbedingungen 2026",
      description: "Standard-Gewährleistung 24 Monate ab IBN.",
      category: "terms", tags: ["gewaehrleistung", "warranty"],
      mimeType: "application/pdf", size: 102400,
      objectPath: "/objects/uploads/seed-warranty.pdf",
      version: 3, createdBy: "user_priya" },
    { id: "att_incoterms_dap",      tenantId: "tn_root", companyId: null, brandId: null,
      name: "INCOTERMS 2020 - DAP Erläuterung",
      description: "Erläuterung der DAP-Klausel und Pflichtenverteilung.",
      category: "terms", tags: ["incoterms", "dap", "logistik"],
      mimeType: "application/pdf", size: 88064,
      objectPath: "/objects/uploads/seed-incoterms-dap.pdf",
      version: 1, createdBy: "user_priya" },
  ]).onConflictDoNothing();

  // ─── Industry Profiles ───
  await db.insert(industryProfilesTable).values([
    { id: "iprof_saas",          tenantId: "tn_root", industry: "saas",
      label: "Software / SaaS",
      description: "Subscription-zentrierte Vorlage mit DPA, SLA und Security-Overview.",
      defaultClauseVariants: { liability: "cap_12m_fees", payment_terms: "net_30", auto_renewal: "12m_with_90d_notice" },
      suggestedTemplateId: "qtpl_saas",
      suggestedAttachmentLibraryIds: ["att_dpa", "att_sla_gold", "att_security_overview"] },
    { id: "iprof_consulting",    tenantId: "tn_root", industry: "consulting",
      label: "Beratung / Professional Services",
      description: "T&M- und Festpreis-Mischmodell mit Reisekosten- und Storno-Regelung.",
      defaultClauseVariants: { liability: "cap_2x_fees", payment_terms: "net_21", ip_ownership: "client_on_payment" },
      suggestedTemplateId: "qtpl_consulting",
      suggestedAttachmentLibraryIds: ["att_company_profile", "att_case_studies", "att_team_cv"] },
    { id: "iprof_manufacturing", tenantId: "tn_root", industry: "manufacturing",
      label: "Industrie / Maschinenbau",
      description: "Anlagen-Komplettangebote mit INCOTERMS, Gewährleistung und Service.",
      defaultClauseVariants: { liability: "cap_contract_value", payment_terms: "30_60_10", warranty: "24m_from_ibn" },
      suggestedTemplateId: "qtpl_manufacturing",
      suggestedAttachmentLibraryIds: ["att_datasheet_typeA", "att_warranty_terms", "att_incoterms_dap"] },
  ]).onConflictDoNothing();
}

/**
 * Build a tiny, valid PDF with a title and short body.
 * Hand-crafted to avoid pulling in the React PDF renderer for placeholder seed
 * documents. The result is well below 1 KB and opens cleanly in any PDF viewer.
 */
function buildPlaceholderPdf(title: string, subtitle: string): Buffer {
  // Escape parentheses and backslashes for PDF string literals.
  const esc = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const safeTitle = esc(title.slice(0, 80));
  const safeSubtitle = esc(subtitle.slice(0, 120));
  const stream = `BT /F1 22 Tf 60 760 Td (${safeTitle}) Tj ET\nBT /F1 12 Tf 60 720 Td (${safeSubtitle}) Tj ET\nBT /F1 10 Tf 60 680 Td (DealFlow.One Demo-Dokument - Inhalt zu Demonstrationszwecken.) Tj ET\n`;
  const streamLen = Buffer.byteLength(stream, "latin1");
  // No EOL marker between the stream payload and `endstream` so that
  // /Length matches exactly the bytes between `stream\n` and `endstream`.
  const objs: string[] = [
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`,
    `4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}endstream\nendobj\n`,
    `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
  ];
  const header = `%PDF-1.4\n`;
  let body = header;
  const offsets: number[] = [];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += o;
  }
  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(body + xref + trailer, "latin1");
}

/**
 * Idempotent: ensure SEED-only attachment_library rows actually have a file in
 * private object storage. Strictly scoped to root-tenant rows whose objectPath
 * starts with the seed prefix, so customer-uploaded attachments are NEVER
 * touched (no risk of silently replacing a missing tenant document with a
 * fake placeholder). Safe to call on every server start.
 */
const SEED_OBJECT_PATH_PREFIX = "/objects/uploads/seed-";
export async function seedPlaceholderObjectsIdempotent(): Promise<void> {
  const rows = await db
    .select({
      id: attachmentLibraryTable.id,
      name: attachmentLibraryTable.name,
      description: attachmentLibraryTable.description,
      mimeType: attachmentLibraryTable.mimeType,
      objectPath: attachmentLibraryTable.objectPath,
    })
    .from(attachmentLibraryTable)
    .where(
      and(
        eq(attachmentLibraryTable.tenantId, "tn_root"),
        like(attachmentLibraryTable.objectPath, `${SEED_OBJECT_PATH_PREFIX}%`),
      ),
    );
  if (rows.length === 0) return;

  const svc = new ObjectStorageService();
  let uploaded = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.objectPath.startsWith("/objects/")) {
      skipped++;
      continue;
    }
    try {
      if (await svc.objectEntityExists(r.objectPath)) {
        skipped++;
        continue;
      }
      const isPdf = (r.mimeType ?? "").toLowerCase() === "application/pdf";
      if (!isPdf) {
        // We can only generate PDFs as placeholders; non-PDF seed paths are
        // skipped and will surface a 404 on download (acceptable for non-seed
        // tenant uploads which legitimately may have been deleted).
        skipped++;
        continue;
      }
      const buf = buildPlaceholderPdf(r.name, r.description ?? "");
      await svc.uploadObjectEntity(r.objectPath, buf, "application/pdf");
      uploaded++;
    } catch (err) {
      logger.warn(
        { err, attachmentId: r.id, path: r.objectPath },
        "Placeholder upload failed",
      );
    }
  }
  if (uploaded > 0) {
    logger.info({ uploaded, skipped }, "Seeded placeholder attachments");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vertragswesen MVP Phase 1 — idempotente Augmentation:
//  • ContractTypes (NDA, MSA, OF) + Playbooks (Standard, Strategic)
//  • obligationTemplates auf ausgewählten Klauselvarianten
//  • Backfill der neuen contract-Felder (tenant/company/brand/account)
//  • Demo Deviations (für ctr_001, ctr_004) und Obligations (für ctr_003)
// Läuft auf jedem Boot; bestehende Reihen werden nicht doppelt eingefügt.
// ─────────────────────────────────────────────────────────────────────────────
export async function seedContractMvpAugmentationIdempotent(): Promise<void> {
  // Skip wenn noch keine Tenant-Daten vorhanden sind (Schema-only DB).
  const [{ c: tenantCount } = { c: 0 }] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(tenantsTable);
  if (tenantCount === 0) return;

  // 1) ContractTypes ───────────────────────────────────────────────────────
  await db.insert(contractTypesTable).values([
    {
      id: "ct_nda",
      tenantId: "tn_root",
      code: "NDA",
      name: "Geheimhaltungsvereinbarung (NDA)",
      description: "Beidseitige Vertraulichkeitsvereinbarung vor Pre-Sales-Phase.",
      mandatoryClauseFamilyIds: ["cf_data"],
      forbiddenClauseFamilyIds: [],
      defaultPlaybookId: null,
      active: true,
    },
    {
      id: "ct_msa",
      tenantId: "tn_root",
      code: "MSA",
      name: "Master Services Agreement",
      description: "Rahmenvertrag mit Klauselsteuerung über Playbook.",
      mandatoryClauseFamilyIds: ["cf_liab", "cf_term", "cf_data", "cf_pay"],
      forbiddenClauseFamilyIds: [],
      defaultPlaybookId: "pb_msa_std",
      active: true,
    },
    {
      id: "ct_of",
      tenantId: "tn_root",
      code: "OF",
      name: "Order Form",
      description: "Bestellschein als Anhang zum MSA.",
      mandatoryClauseFamilyIds: ["cf_pay"],
      forbiddenClauseFamilyIds: [],
      defaultPlaybookId: null,
      active: true,
    },
  ]).onConflictDoNothing();

  // 2) Playbooks ──────────────────────────────────────────────────────────
  await db.insert(contractPlaybooksTable).values([
    {
      id: "pb_msa_std",
      tenantId: "tn_root",
      contractTypeId: "ct_msa",
      name: "MSA Standard",
      description: "Sales-Selbstbedienung, Standard-Klauseln, einfache Approvals.",
      brandIds: [],
      companyIds: [],
      allowedClauseVariantIds: [
        "cv_liab_3", "cv_liab_4",
        "cv_term_2", "cv_term_3", "cv_term_4",
        "cv_data_3", "cv_data_4",
        "cv_pay_2", "cv_pay_3", "cv_pay_4",
        "cv_sla_2", "cv_sla_3",
        "cv_ip_3", "cv_ip_4",
      ],
      defaultClauseVariantIds: ["cv_liab_3", "cv_term_3", "cv_data_3", "cv_pay_3", "cv_sla_3", "cv_ip_3"],
      approvalRules: [
        { trigger: "discount_pct_above", threshold: 10, approverRole: "Sales Manager" },
        { trigger: "payment_terms_above_days", threshold: 45, approverRole: "Finance" },
        { trigger: "liability_cap_above_eur", threshold: 1000000, approverRole: "Legal" },
      ],
      active: true,
    },
    {
      id: "pb_msa_strategic",
      tenantId: "tn_root",
      contractTypeId: "ct_msa",
      name: "MSA Strategic Account",
      description: "Strategische Großkunden, Legal-First, alle Varianten zulässig.",
      brandIds: [],
      companyIds: [],
      allowedClauseVariantIds: [
        "cv_liab_1", "cv_liab_2", "cv_liab_3", "cv_liab_4",
        "cv_term_2", "cv_term_3", "cv_term_4", "cv_term_5",
        "cv_data_3", "cv_data_4", "cv_data_5",
        "cv_pay_1", "cv_pay_2", "cv_pay_3",
        "cv_sla_1", "cv_sla_2", "cv_sla_3",
        "cv_ip_2", "cv_ip_3", "cv_ip_4",
      ],
      defaultClauseVariantIds: ["cv_liab_2", "cv_term_3", "cv_data_4", "cv_pay_2", "cv_sla_2", "cv_ip_2"],
      approvalRules: [
        { trigger: "discount_pct_above", threshold: 15, approverRole: "VP Sales" },
        { trigger: "liability_cap_above_eur", threshold: 5000000, approverRole: "General Counsel" },
      ],
      active: true,
    },
  ]).onConflictDoNothing();

  // 3) obligationTemplates auf ausgewählten Klauselvarianten ─────────────
  // Werden nur gesetzt, wenn das Feld noch leer (NULL) ist — überschreibt nichts.
  const obligationTemplateUpdates: Array<{ id: string; templates: Array<{ type: string; description: string; dueOffsetDays?: number; recurrence?: "none" | "monthly" | "quarterly" | "annual"; ownerRole?: string }> }> = [
    { id: "cv_data_3", templates: [{ type: "audit", description: "Jährliches DPA-Audit durchführen und Bericht ablegen.", dueOffsetDays: 365, recurrence: "annual", ownerRole: "DPO" }] },
    { id: "cv_data_4", templates: [
      { type: "audit", description: "Jährliches DPA-Audit + Subprozessoren-Liste prüfen.", dueOffsetDays: 365, recurrence: "annual", ownerRole: "DPO" },
      { type: "notice", description: "Subprozessor-Wechsel mind. 30 Tage vorab anzeigen.", dueOffsetDays: 30, recurrence: "none", ownerRole: "Legal" },
    ]},
    { id: "cv_sla_2", templates: [{ type: "reporting", description: "Monatlicher SLA-Report (Verfügbarkeit, Incidents) an Kunden.", dueOffsetDays: 30, recurrence: "monthly", ownerRole: "Customer Success" }] },
    { id: "cv_sla_3", templates: [{ type: "reporting", description: "Quartalsbericht zur Verfügbarkeit (99,9% Ziel).", dueOffsetDays: 90, recurrence: "quarterly", ownerRole: "Customer Success" }] },
    { id: "cv_term_4", templates: [{ type: "notice", description: "Auto-Renewal: Kündigungsfrist 90 Tage vor Ablauf prüfen.", dueOffsetDays: 270, recurrence: "annual", ownerRole: "Account Manager" }] },
    { id: "cv_pay_3", templates: [{ type: "payment", description: "Erste Rechnung 30 Tage nach Vertragsbeginn fällig.", dueOffsetDays: 30, recurrence: "none", ownerRole: "Finance" }] },
  ];
  for (const upd of obligationTemplateUpdates) {
    await db.update(clauseVariantsTable)
      .set({ obligationTemplates: upd.templates })
      .where(and(eq(clauseVariantsTable.id, upd.id), sql`${clauseVariantsTable.obligationTemplates} IS NULL`));
  }

  // 4) Backfill neue contract-Felder aus deal→company→brand-Kette ─────────
  const allContracts = await db.select().from(contractsTable);
  const allDeals = await db.select().from(dealsTable);
  const dealById = new Map(allDeals.map(d => [d.id, d]));
  for (const c of allContracts) {
    if (c.tenantId && c.companyId) continue; // schon gefüllt
    const d = dealById.get(c.dealId);
    if (!d) continue;
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, d.companyId));
    if (!co) continue;
    const valueCurrency = d.currency ?? co.currency ?? "EUR";
    const valueAmountStr = d.value != null ? String(d.value) : null;
    const isMsa = c.template?.toLowerCase().includes("master services");
    const isOf = c.template?.toLowerCase().includes("order form");
    const contractTypeId = isMsa ? "ct_msa" : isOf ? "ct_of" : null;
    const playbookId = contractTypeId === "ct_msa" ? "pb_msa_std" : null;
    const isSigned = c.status === "signed" || c.status === "active";
    const effectiveFrom = isSigned ? isoDate(daysFromNow(-30)) : null;
    const effectiveTo = isSigned ? isoDate(daysFromNow(335)) : null;
    await db.update(contractsTable).set({
      tenantId: co.tenantId,
      companyId: d.companyId,
      brandId: d.brandId ?? null,
      accountId: d.accountId ?? null,
      contractTypeId,
      playbookId,
      language: "de",
      currency: valueCurrency,
      valueAmount: valueAmountStr,
      valueCurrency,
      effectiveFrom,
      effectiveTo,
      autoRenewal: isMsa ? true : false,
      renewalNoticeDays: isMsa ? 90 : null,
      terminationNoticeDays: isMsa ? 90 : 30,
      governingLaw: co.country === "DE" ? "Deutsches Recht" : co.country === "CH" ? "Schweizer Recht" : co.country === "AT" ? "Österreichisches Recht" : "Local law",
      jurisdiction: co.country === "DE" ? "Hamburg" : co.country === "CH" ? "Zürich" : co.country === "AT" ? "Wien" : "Local courts",
      currentVersion: c.version,
      signedAt: isSigned ? daysFromNow(-30) : null,
    }).where(eq(contractsTable.id, c.id));
  }

  // 5) Demo-Obligations für signierten Vertrag ctr_003 (Fjord MSA) ───────
  const [ctr003] = await db.select().from(contractsTable).where(eq(contractsTable.id, "ctr_003"));
  if (ctr003) {
    const obligationSeed = [
      { id: "ob_ctr003_001", contractId: "ctr_003", type: "reporting",  description: "Monatlicher SLA-Report (Verfügbarkeit, Incidents) an Fjord.",                  dueAt: daysFromNow(7),    recurrence: "monthly",   ownerRole: "Customer Success", source: "derived",  status: "in_progress", clauseId: "cc_008", escalationDays: 3 },
      { id: "ob_ctr003_002", contractId: "ctr_003", type: "audit",      description: "Jährliches DPA-Audit für Fjord durchführen und Bericht ablegen.",            dueAt: daysFromNow(180),  recurrence: "annual",    ownerRole: "DPO",              source: "derived",  status: "pending",     clauseId: "cc_007", escalationDays: 14 },
      { id: "ob_ctr003_003", contractId: "ctr_003", type: "delivery",   description: "Vessel-Telemetry-Module Tranche 2 (12 Schiffe) bis Q2 ausliefern.",           dueAt: daysFromNow(45),   recurrence: "none",      ownerRole: "Project Lead",     source: "manual",   status: "in_progress", clauseId: null, escalationDays: 7 },
      { id: "ob_ctr003_004", contractId: "ctr_003", type: "notice",     description: "Auto-Renewal: Kündigungsfrist 90 Tage vor Ablauf an Fjord erinnern.",         dueAt: daysFromNow(245),  recurrence: "annual",    ownerRole: "Account Manager",  source: "derived",  status: "pending",     clauseId: null, escalationDays: 5 },
      { id: "ob_ctr003_005", contractId: "ctr_003", type: "reporting",  description: "Quartalsmeeting Service-Review mit Erik Lindahl (CFO) terminieren.",          dueAt: daysFromNow(60),   recurrence: "quarterly", ownerRole: "Account Manager",  source: "manual",   status: "pending",     clauseId: null, escalationDays: 3 },
      { id: "ob_ctr003_006", contractId: "ctr_003", type: "payment",    description: "Index-Anpassung +4,5% (Amendment am_001) zur nächsten Abrechnung.",            dueAt: daysFromNow(-2),   recurrence: "none",      ownerRole: "Finance",          source: "manual",   status: "pending",     clauseId: null, escalationDays: 1 },
      { id: "ob_ctr003_007", contractId: "ctr_003", type: "delivery",   description: "Onboarding der zwei neuen Schiffe (Sirius, Polaris) durchführen.",            dueAt: daysFromNow(-5),   recurrence: "none",      ownerRole: "Customer Success", source: "manual",   status: "missed",      clauseId: null, escalationDays: 2 },
    ];
    await db.insert(obligationsTable).values(obligationSeed.map(o => ({
      id: o.id,
      tenantId: ctr003.tenantId ?? "tn_root",
      contractId: o.contractId,
      brandId: ctr003.brandId ?? null,
      accountId: ctr003.accountId ?? null,
      clauseId: o.clauseId,
      type: o.type,
      description: o.description,
      dueAt: o.dueAt,
      recurrence: o.recurrence,
      ownerRole: o.ownerRole,
      status: o.status,
      source: o.source,
      escalationDays: o.escalationDays,
    }))).onConflictDoNothing();

    // Counter aktualisieren
    const [{ c: obCount } = { c: 0 }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(obligationsTable)
      .where(eq(obligationsTable.contractId, "ctr_003"));
    await db.update(contractsTable).set({ obligationsCount: obCount }).where(eq(contractsTable.id, "ctr_003"));
  }

  // 6) Demo-Deviations für ctr_001 (Nordstern MSA, in_review) ───────────
  const [ctr001] = await db.select().from(contractsTable).where(eq(contractsTable.id, "ctr_001"));
  if (ctr001) {
    await db.insert(clauseDeviationsTable).values([
      {
        id: "dv_ctr001_001",
        tenantId: ctr001.tenantId ?? "tn_root",
        contractId: "ctr_001",
        clauseId: "cc_001",
        familyId: "cf_liab",
        deviationType: "variant_change",
        severity: "high",
        description: "Haftung 'Unbegrenzt bei IP-Verletzung' (cv_liab_1) liegt außerhalb des MSA-Standard-Playbooks (Standard wäre cv_liab_3 oder cv_liab_4).",
        evidence: { playbookId: "pb_msa_std", actualVariantId: "cv_liab_1", allowedVariantIds: ["cv_liab_3", "cv_liab_4"] },
        policyId: "pb_msa_std",
        requiresApproval: true,
      },
      {
        id: "dv_ctr001_002",
        tenantId: ctr001.tenantId ?? "tn_root",
        contractId: "ctr_001",
        clauseId: "cc_002",
        familyId: "cf_term",
        deviationType: "variant_change",
        severity: "medium",
        description: "Auto-Renewal-Klausel (cv_term_4) verlangt 90 Tage Kündigungsfrist — Kunde fordert 60.",
        evidence: { playbookId: "pb_msa_std", actualVariantId: "cv_term_4" },
        policyId: "pb_msa_std",
        requiresApproval: true,
      },
      {
        id: "dv_ctr001_003",
        tenantId: ctr001.tenantId ?? "tn_root",
        contractId: "ctr_001",
        clauseId: "cc_004",
        familyId: "cf_pay",
        deviationType: "threshold_breach",
        severity: "low",
        description: "Zahlungsziel Netto 60 (cv_pay_2) überschreitet Standard-Schwellwert 45 Tage.",
        evidence: { rule: "payment_terms_above_days", threshold: 45, actual: 60 },
        policyId: "pb_msa_std",
        requiresApproval: false,
      },
    ]).onConflictDoNothing();

    const [{ c: dvCount } = { c: 0 }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(clauseDeviationsTable)
      .where(and(eq(clauseDeviationsTable.contractId, "ctr_001"), sql`${clauseDeviationsTable.resolvedAt} IS NULL`));
    await db.update(contractsTable).set({ openDeviationsCount: dvCount }).where(eq(contractsTable.id, "ctr_001"));
  }

  // Demo-Deviations für ctr_004 (BlueRiver SOW, in_review) ───────────
  const [ctr004] = await db.select().from(contractsTable).where(eq(contractsTable.id, "ctr_004"));
  if (ctr004) {
    await db.insert(clauseDeviationsTable).values([
      {
        id: "dv_ctr004_001",
        tenantId: ctr004.tenantId ?? "tn_root",
        contractId: "ctr_004",
        clauseId: "cc_009",
        familyId: "cf_data",
        deviationType: "text_edit",
        severity: "medium",
        description: "Text-Bearbeitung in Data-Klausel (cv_data_3): Kunden-Redline beim Audit-Recht.",
        evidence: { kind: "text_edit", clauseVariantId: "cv_data_3" },
        policyId: null,
        requiresApproval: true,
      },
      {
        id: "dv_ctr004_002",
        tenantId: ctr004.tenantId ?? "tn_root",
        contractId: "ctr_004",
        clauseId: "cc_009",
        familyId: "cf_liab",
        deviationType: "missing_required",
        severity: "high",
        description: "Pflicht-Klausel 'Liability' fehlt im SOW (Pflicht laut MSA-Standard).",
        evidence: { mandatoryFamilyId: "cf_liab" },
        policyId: "pb_msa_std",
        requiresApproval: true,
      },
    ]).onConflictDoNothing();

    const [{ c: dv4Count } = { c: 0 }] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(clauseDeviationsTable)
      .where(and(eq(clauseDeviationsTable.contractId, "ctr_004"), sql`${clauseDeviationsTable.resolvedAt} IS NULL`));
    await db.update(contractsTable).set({ openDeviationsCount: dv4Count }).where(eq(contractsTable.id, "ctr_004"));
  }

  // 7) Sprachfassungen + neue Klausel-Familien (idempotent) ─────────────
  await augmentClauseTranslations();

  // 8) CUAD Vollständigkeits-Check ─────────────────────────────────────
  await seedCuadDefaultsIdempotent();

  logger.info("Contract MVP augmentation completed");
}

/**
 * Legal-reviewte englische Sprachfassungen der Standardklauseln.
 *
 * Quelle bisher: "bonterms-style" – maschinell aus den deutschen Originalen
 * generierte Übersetzungen, damit der Sprachumschalter sofort lauffähig ist.
 *
 * Diese Texte wurden vom Legal-Team gegen die deutschen Variantenbodies
 * abgeglichen und an mehreren Stellen für die englischsprachige Vertragspraxis
 * geschärft (u. a. § 288(2) BGB-Verweis bei Verzugszinsen, vollständige Namen
 * der DIS- und ICC-Schiedsregeln, präzisere SCC/TOM-Formulierung, sowie
 * "indefinitely" statt "without time limit" bei der Geheimhaltung).
 *
 * Single source of truth – wird sowohl beim Initial-Seed als auch von
 * `augmentClauseTranslations()` verwendet, damit Augment- und Redaktions-Pass
 * nicht auseinanderlaufen.
 */
const LEGAL_REVIEWED_EN_TRANSLATIONS: Record<string, { name: string; summary: string; body: string }> = {
  cv_liab_1: { name: "Unlimited for IP infringement", summary: "Unlimited liability for IP infringement claims.", body: "Provider shall be liable without limitation for any claims arising out of the infringement of third-party intellectual property rights, including direct and indirect damages." },
  cv_liab_2: { name: "3× annual fees cap", summary: "Liability capped at 3× annual fees.", body: "Provider's aggregate liability shall be limited to three (3) times the fees paid in the preceding twelve (12) months." },
  cv_liab_3: { name: "2× annual fees cap", summary: "Standard cap: 2× annual fees.", body: "Aggregate liability is limited to two (2) times the fees paid in the twelve (12) months preceding the claim." },
  cv_liab_4: { name: "12-month fees cap", summary: "Cap at trailing 12-month fees.", body: "Liability is capped at the fees paid during the twelve (12) months preceding the event giving rise to the claim." },
  cv_liab_5: { name: "6-month cap, ordinary negligence excluded", summary: "Hard cap: 6 months; ordinary negligence excluded.", body: "Liability is capped at six (6) months of fees. Liability for ordinary negligence, consequential damages, and lost profits is excluded." },
  cv_term_1: { name: "Termination for convenience, 30 days", summary: "Customer may terminate at any time with 30 days' notice.", body: "Customer may terminate this agreement at any time without cause upon thirty (30) days' prior written notice." },
  cv_term_2: { name: "12 months with opt-out", summary: "12-month minimum term, opt-out after month 6.", body: "Initial term of twelve (12) months with a one-time opt-out at month six (6) on sixty (60) days' prior written notice." },
  cv_term_3: { name: "24 months with opt-out", summary: "24 months with opt-out at month 12.", body: "Initial term of twenty-four (24) months with a one-time opt-out at month twelve (12) on ninety (90) days' prior written notice." },
  cv_term_4: { name: "36 months auto-renewal", summary: "36 months with 12-month auto-renewal.", body: "Initial term of thirty-six (36) months; automatic renewal for successive twelve (12) month periods unless either party gives written notice of non-renewal at least ninety (90) days prior to expiration." },
  cv_term_5: { name: "60 months, exit fee", summary: "60-month term; early-termination fee 50% of remaining value.", body: "Term of sixty (60) months. Early termination by Customer triggers a fee equal to fifty percent (50%) of the remaining contract value." },
  cv_data_1: { name: "Customer hosting, full audit", summary: "On-prem at customer; unlimited audit rights without notice.", body: "All data processing takes place on Customer's premises. Customer may audit at any time without prior notice." },
  cv_data_2: { name: "Customer hosting with audit", summary: "Customer-hosted with annual audit.", body: "Data processing within the Customer environment. Customer has an annual audit right exercisable upon thirty (30) days' prior written notice." },
  cv_data_3: { name: "EU hosting, SCC", summary: "EU data centres; Standard Contractual Clauses apply.", body: "All personal data is processed exclusively in EU data centres. The Standard Contractual Clauses (SCC) and the technical and organisational measures (TOMs) set out in Annex B form an integral part of this agreement." },
  cv_data_4: { name: "EU hosting + sub-processor whitelist", summary: "EU hosting; approved sub-processors only.", body: "All personal data is processed in EU data centres. Engagement of any sub-processor requires Customer's prior written approval." },
  cv_data_5: { name: "Regional EU + liability disclaimer", summary: "EU hosting; data-protection liability remains with Customer.", body: "Personal data is processed in EU data centres. Customer remains the controller for the purposes of the GDPR. Provider's liability under data-protection law is limited to wilful misconduct." },
  cv_pay_1:  { name: "Net 90 with early-pay discount", summary: "Net 90 days, 3% discount within 30 days.", body: "Invoices are due within ninety (90) days net of the invoice date. A 3% early-payment discount applies if payment is received within thirty (30) days." },
  cv_pay_2:  { name: "Net 60", summary: "Net 60 days.", body: "Invoices are due within sixty (60) days net of the invoice date." },
  cv_pay_3:  { name: "Net 30", summary: "Net 30 days.", body: "Invoices are due within thirty (30) days net of the invoice date." },
  cv_pay_4:  { name: "Net 14, statutory default interest", summary: "Net 14 days; statutory default interest applies.", body: "Invoices are due within fourteen (14) days net of the invoice date. In the event of default, interest accrues at nine (9) percentage points above the statutory base rate (§ 288(2) BGB)." },
  cv_pay_5:  { name: "Prepayment", summary: "Payment in advance of service delivery.", body: "Provider issues an invoice in advance; service delivery commences only upon receipt of payment in full." },
  cv_sla_1:  { name: "99.99% with 50% credits", summary: "99.99% uptime; service credits up to 50% of monthly fee.", body: "Monthly availability target of 99.99%. Service credits of up to fifty percent (50%) of the applicable monthly fee apply for any breach." },
  cv_sla_2:  { name: "99.95% with 25% credits", summary: "99.95% uptime; 25% credit cap.", body: "Monthly availability target of 99.95%. Service credits are capped at twenty-five percent (25%) of the applicable monthly fee." },
  cv_sla_3:  { name: "99.9% with 10% credits", summary: "99.9% uptime; 10% credit cap.", body: "Monthly availability target of 99.9%. Service credits are capped at ten percent (10%) of the applicable monthly fee." },
  cv_sla_4:  { name: "99.5%, no credits", summary: "99.5% uptime; no service credits.", body: "Target availability of 99.5%. No automatic service credits apply." },
  cv_sla_5:  { name: "Best effort", summary: "Best-effort availability.", body: "Availability is provided on a best-effort basis without warranty or service credits." },
  cv_ip_1:   { name: "Full assignment incl. derivatives", summary: "All work product and derivatives assigned to Customer.", body: "All work product and derivatives created under this agreement are assigned to Customer upon creation." },
  cv_ip_2:   { name: "Assignment of customer-specific derivatives", summary: "Only customer-specific derivatives are assigned.", body: "Customer-specific derivatives are assigned to Customer upon creation; standard components remain the property of Provider." },
  cv_ip_3:   { name: "Non-exclusive license", summary: "Non-exclusive, non-transferable license.", body: "Customer receives a non-exclusive, non-transferable license to use the deliverables. All intellectual property rights remain with Provider." },
  cv_ip_4:   { name: "License with audit", summary: "Non-exclusive license with usage audit.", body: "Customer receives a non-exclusive license to use the deliverables. Provider has the right to audit the scope of use upon reasonable prior notice." },
  cv_ip_5:   { name: "Named-user, no transfer", summary: "Named-user license; no transfer.", body: "The license is limited to named users designated by Customer. Transfer or assignment of the license is excluded." },
  cv_warr_1: { name: "24 months, no notice obligation", summary: "24-month warranty without notice obligation.", body: "Provider warrants conformity of the deliverables for twenty-four (24) months from acceptance. Customer is under no obligation to give notice of defects." },
  cv_warr_2: { name: "18 months, qualified notice", summary: "18-month warranty; notice within 14 days.", body: "Customer shall give written notice of obvious defects within fourteen (14) days. The warranty period is eighteen (18) months from acceptance." },
  cv_warr_3: { name: "12 months, statutory notice", summary: "12 months; statutory notice rules apply.", body: "A warranty period of twelve (12) months from delivery applies. The statutory duty to inspect and notify under § 377 HGB remains unaffected." },
  cv_warr_4: { name: "6 months, exclusive cure right", summary: "6 months; cure as the exclusive remedy.", body: "Warranty period of six (6) months. Customer's sole and exclusive remedy is Provider's right to cure; price reduction and rescission are excluded." },
  cv_warr_5: { name: "Warranty disclaimer for SaaS updates", summary: "No warranty for provider-issued updates.", body: "Provider disclaims any warranty for updates and patches it provides, to the extent permitted by applicable law." },
  cv_conf_1: { name: "Indefinite, contractual penalty", summary: "Indefinite confidentiality with penalty per breach.", body: "Confidential Information shall be kept strictly confidential for an indefinite period. Each breach of this obligation triggers a contractual penalty of EUR 25,000." },
  cv_conf_2: { name: "10 years post-term", summary: "10-year survival of confidentiality.", body: "The confidentiality obligations survive for ten (10) years after termination or expiry of this agreement." },
  cv_conf_3: { name: "5 years post-term", summary: "5-year survival; standard exclusions.", body: "Confidential Information shall remain confidential for five (5) years after termination or expiry of this agreement. Customary exceptions (publicly known information, legal disclosure obligations) apply." },
  cv_conf_4: { name: "3 years, notice-and-cure", summary: "3-year survival; 30-day cure window.", body: "The confidentiality obligations survive for three (3) years after termination or expiry. Upon breach, the breaching party shall be granted a thirty (30) day period to cure." },
  cv_conf_5: { name: "Term + 12 months", summary: "Confidentiality during the term and for 12 months thereafter only.", body: "The confidentiality obligations end twelve (12) months after termination or expiry of this agreement. Thereafter, use is permitted subject to applicable competition law." },
  cv_juris_1:{ name: "Customer's seat, German law", summary: "Jurisdiction at Customer's seat; German law.", body: "This agreement is governed by the laws of the Federal Republic of Germany, excluding the United Nations Convention on Contracts for the International Sale of Goods. Exclusive jurisdiction lies with the courts at Customer's registered seat." },
  cv_juris_2:{ name: "Frankfurt, DIS arbitration", summary: "DIS arbitration; seat in Frankfurt am Main.", body: "All disputes arising out of or in connection with this agreement shall be finally settled under the Arbitration Rules of the German Arbitration Institute (DIS). The seat of arbitration is Frankfurt am Main; the language of the proceedings is German." },
  cv_juris_3:{ name: "Provider's seat, German law", summary: "Jurisdiction at Provider's seat; German law.", body: "This agreement is governed by the laws of the Federal Republic of Germany, excluding the United Nations Convention on Contracts for the International Sale of Goods. Exclusive jurisdiction lies with the courts at Provider's registered seat." },
  cv_juris_4:{ name: "London, English law", summary: "English law; jurisdiction in London.", body: "This agreement is governed by the laws of England and Wales. The courts of London shall have exclusive jurisdiction." },
  cv_juris_5:{ name: "ICC arbitration in Singapore", summary: "ICC arbitration seated in Singapore.", body: "All disputes arising out of or in connection with this agreement shall be finally settled under the Rules of Arbitration of the International Chamber of Commerce (ICC), with the seat of arbitration in Singapore. The language of the proceedings is English." },
};

async function augmentClauseTranslations(): Promise<void> {
  const newFamilies = [
    { id: "cf_warr",  name: "Gewährleistung",     description: "Mängelhaftung, Rüge- und Nachbesserungsrechte." },
    { id: "cf_conf",  name: "Geheimhaltung",      description: "Vertraulichkeit, Schutz vertraulicher Informationen." },
    { id: "cf_juris", name: "Gerichtsstand",      description: "Anwendbares Recht und Gerichtsstand." },
  ];
  await db.insert(clauseFamiliesTable).values(newFamilies).onConflictDoNothing();

  const sevFromScore = (s: number) => (s <= 2 ? "high" : s === 3 ? "medium" : "low");
  const newVariants: Array<{ id: string; familyId: string; tone: string; severityScore: number; name: string; summary: string; body: string }> = [
    { id: "cv_warr_1", familyId: "cf_warr", tone: "zart",     severityScore: 1, name: "24 Monate, ohne Rügepflicht",    summary: "24 Monate Gewährleistung ohne Rügepflicht.", body: "Der Anbieter gewährleistet die vertragsgemäße Beschaffenheit der Leistung für 24 Monate ab Übergabe; eine Rügepflicht besteht nicht." },
    { id: "cv_warr_2", familyId: "cf_warr", tone: "moderat",  severityScore: 2, name: "18 Monate, qualifizierte Rüge",  summary: "18 Monate Gewährleistung mit Rüge binnen 14 Tagen.", body: "Der Kunde rügt erkennbare Mängel innerhalb von 14 Tagen schriftlich; Gewährleistungsfrist beträgt 18 Monate." },
    { id: "cv_warr_3", familyId: "cf_warr", tone: "standard", severityScore: 3, name: "12 Monate, gesetzliche Rüge",    summary: "12 Monate, Rüge nach §377 HGB.", body: "Es gilt eine Gewährleistungsfrist von 12 Monaten ab Lieferung; die Rügeobliegenheit nach §377 HGB bleibt unberührt." },
    { id: "cv_warr_4", familyId: "cf_warr", tone: "streng",   severityScore: 4, name: "6 Monate, Nachbesserung exklusiv", summary: "6 Monate; Nachbesserung als ausschließlicher Rechtsbehelf.", body: "Gewährleistungsfrist 6 Monate. Bei Mängeln steht dem Kunden ausschließlich das Recht auf Nachbesserung zu; Minderung und Rücktritt sind ausgeschlossen." },
    { id: "cv_warr_5", familyId: "cf_warr", tone: "hart",     severityScore: 5, name: "Ausschluss bei SaaS-Updates",     summary: "Keine Gewährleistung für vom Anbieter veröffentlichte Updates.", body: "Eine Gewährleistung für vom Anbieter bereitgestellte Updates und Patches ist ausgeschlossen, soweit gesetzlich zulässig." },
    { id: "cv_conf_1", familyId: "cf_conf", tone: "zart",     severityScore: 1, name: "Unbefristet, Vertragsstrafe",    summary: "Unbefristete Geheimhaltung mit Vertragsstrafe je Verstoß.", body: "Vertrauliche Informationen sind zeitlich unbegrenzt geheim zu halten. Bei jedem Verstoß ist eine Vertragsstrafe von EUR 25.000 verwirkt." },
    { id: "cv_conf_2", familyId: "cf_conf", tone: "moderat",  severityScore: 2, name: "10 Jahre nach Vertragsende",     summary: "10 Jahre Nachlaufzeit für vertrauliche Informationen.", body: "Die Geheimhaltungspflichten gelten für 10 Jahre über das Vertragsende hinaus." },
    { id: "cv_conf_3", familyId: "cf_conf", tone: "standard", severityScore: 3, name: "5 Jahre nach Vertragsende",      summary: "5 Jahre Nachlaufzeit; übliche Ausnahmen.", body: "Vertrauliche Informationen werden für 5 Jahre nach Vertragsende geheim gehalten; übliche Ausnahmen (öffentlich bekannt, gesetzlich gefordert) gelten." },
    { id: "cv_conf_4", familyId: "cf_conf", tone: "streng",   severityScore: 4, name: "3 Jahre, Notice-and-Cure",       summary: "3 Jahre Nachlaufzeit; Heilungsfrist 30 Tage.", body: "Geheimhaltungspflicht 3 Jahre nach Vertragsende. Bei Verletzung erhält die verletzende Partei eine Heilungsfrist von 30 Tagen." },
    { id: "cv_conf_5", familyId: "cf_conf", tone: "hart",     severityScore: 5, name: "Vertragsdauer + 12 Monate",       summary: "Geheimhaltung nur während Vertragslaufzeit + 12 Monate.", body: "Geheimhaltungspflichten enden 12 Monate nach Vertragsende; danach ist eine Verwendung außerhalb wettbewerbsrechtlicher Schranken zulässig." },
    { id: "cv_juris_1", familyId: "cf_juris", tone: "zart",    severityScore: 1, name: "Sitz des Kunden, deutsches Recht", summary: "Gerichtsstand am Sitz des Kunden, deutsches Recht.", body: "Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts. Ausschließlicher Gerichtsstand ist der Sitz des Kunden." },
    { id: "cv_juris_2", familyId: "cf_juris", tone: "moderat", severityScore: 2, name: "Frankfurt a.M., Schiedsklausel",  summary: "Schiedsverfahren DIS, Sitz Frankfurt a.M.", body: "Streitigkeiten werden nach der DIS-Schiedsgerichtsordnung entschieden. Schiedsort ist Frankfurt am Main; Verfahrenssprache Deutsch." },
    { id: "cv_juris_3", familyId: "cf_juris", tone: "standard",severityScore: 3, name: "Sitz des Anbieters, deutsches Recht", summary: "Gerichtsstand am Sitz des Anbieters; deutsches Recht.", body: "Ausschließlicher Gerichtsstand ist der Sitz des Anbieters. Es gilt deutsches Recht unter Ausschluss des UN-Kaufrechts." },
    { id: "cv_juris_4", familyId: "cf_juris", tone: "streng",  severityScore: 4, name: "London, englisches Recht",        summary: "Englisches Recht; Gerichtsstand London.", body: "Es gilt das Recht von England und Wales. Ausschließlicher Gerichtsstand ist London." },
    { id: "cv_juris_5", familyId: "cf_juris", tone: "hart",    severityScore: 5, name: "ICC Schiedsverfahren Singapur",   summary: "ICC-Schiedsverfahren mit Sitz Singapur.", body: "Streitigkeiten werden ausschließlich durch ein Schiedsverfahren nach den ICC-Regeln in Singapur entschieden. Verfahrenssprache Englisch." },
  ];
  await db.insert(clauseVariantsTable).values(newVariants.map(v => ({
    id: v.id, familyId: v.familyId, name: v.name, summary: v.summary, body: v.body,
    severity: sevFromScore(v.severityScore), severityScore: v.severityScore, tone: v.tone,
  }))).onConflictDoNothing();

  // Wenn cv_juris_4 zuvor mit englischem Body persistiert wurde, jetzt korrigieren.
  await db.update(clauseVariantsTable)
    .set({ body: "Es gilt das Recht von England und Wales. Ausschließlicher Gerichtsstand ist London." })
    .where(and(
      eq(clauseVariantsTable.id, "cv_juris_4"),
      like(clauseVariantsTable.body, "It is governed by the laws of England%"),
    ));

  const enTranslations = LEGAL_REVIEWED_EN_TRANSLATIONS;

  const allVariants = await db.select().from(clauseVariantsTable);
  const existingTranslations = await db.select().from(clauseVariantTranslationsTable);
  const haveKey = new Set(existingTranslations.map(t => `${t.variantId}:${t.locale}`));

  const toInsert: Array<typeof clauseVariantTranslationsTable.$inferInsert> = [];
  for (const v of allVariants) {
    if (!haveKey.has(`${v.id}:de`)) {
      toInsert.push({
        id: `cvt_${v.id}_de`,
        variantId: v.id,
        locale: "de",
        name: v.name,
        summary: v.summary ?? "",
        body: v.body ?? "",
        source: "legal-reviewed",
        license: "Internal",
        sourceUrl: null,
      });
    }
    const en = enTranslations[v.id];
    if (en && !haveKey.has(`${v.id}:en`)) {
      toInsert.push({
        id: `cvt_${v.id}_en`,
        variantId: v.id,
        locale: "en",
        name: en.name,
        summary: en.summary,
        body: en.body,
        source: "legal-reviewed",
        license: "Internal",
        sourceUrl: null,
      });
    }
  }
  if (toInsert.length > 0) {
    await db.insert(clauseVariantTranslationsTable).values(toInsert).onConflictDoNothing();
    logger.info({ count: toInsert.length }, "Clause variant translations augmented");
  }

  // Redaktionspass: Übersetzungen mit den alten Auto-Markern auf die legal-reviewten
  // Texte/Labels heben. Dadurch übernehmen bereits geseedete DBs die geprüften Inhalte.
  await redactAutoTranslations();
}

/**
 * Hebt bestehende clause_variant_translations-Zeilen, die noch mit den
 * Augment-Markern "bonterms-style" oder "internal-baseline" gespeichert sind,
 * auf den final geprüften Stand: aktualisierte Texte (siehe
 * `LEGAL_REVIEWED_EN_TRANSLATIONS`) und neue Quelle/Lizenz "legal-reviewed" /
 * "Internal" / leere Source-URL.
 */
async function redactAutoTranslations(): Promise<void> {
  const legacyRows = await db.select().from(clauseVariantTranslationsTable)
    .where(or(
      eq(clauseVariantTranslationsTable.source, "bonterms-style"),
      eq(clauseVariantTranslationsTable.source, "internal-baseline"),
    ));
  if (legacyRows.length === 0) return;

  const variantsById = new Map(
    (await db.select().from(clauseVariantsTable)).map(v => [v.id, v]),
  );

  let updated = 0;
  const now = new Date();
  for (const row of legacyRows) {
    const next: Partial<typeof clauseVariantTranslationsTable.$inferInsert> = {
      source: "legal-reviewed",
      license: "Internal",
      sourceUrl: null,
      updatedAt: now,
    };
    if (row.locale === "en") {
      const en = LEGAL_REVIEWED_EN_TRANSLATIONS[row.variantId];
      if (en) {
        next.name = en.name;
        next.summary = en.summary;
        next.body = en.body;
      }
    } else if (row.locale === "de") {
      // DE-Backfills haben bisher die Variante 1:1 gespiegelt. Nach dem Fix
      // an cv_juris_4 (deutscher Body) muss die Übersetzung mitgezogen werden.
      const v = variantsById.get(row.variantId);
      if (v) {
        next.name = v.name;
        next.summary = v.summary ?? "";
        next.body = v.body ?? "";
      }
    }
    await db.update(clauseVariantTranslationsTable)
      .set(next)
      .where(eq(clauseVariantTranslationsTable.id, row.id));
    updated += 1;
  }
  logger.info({ updated }, "Clause variant translations redacted to legal-reviewed");
}

// CUAD (Contract Understanding Atticus Dataset) — 41 standard categories.
// Tenant-agnostic taxonomy + default mapping clause-family ↔ CUAD +
// default per-contract-type expectations for the seeded NDA/MSA/OF.
const CUAD_CATEGORIES: Array<{ id: string; code: string; name: string; description: string }> = [
  { id: "cuad_document_name",                     code: "DOCUMENT_NAME",                     name: "Document Name",                     description: "The name of the contract" },
  { id: "cuad_parties",                           code: "PARTIES",                           name: "Parties",                           description: "The two or more parties who signed the contract" },
  { id: "cuad_agreement_date",                    code: "AGREEMENT_DATE",                    name: "Agreement Date",                    description: "Date the contract was signed / executed" },
  { id: "cuad_effective_date",                    code: "EFFECTIVE_DATE",                    name: "Effective Date",                    description: "Date when contractual obligations begin" },
  { id: "cuad_expiration_date",                   code: "EXPIRATION_DATE",                   name: "Expiration Date",                   description: "Date when contract initially expires" },
  { id: "cuad_renewal_term",                      code: "RENEWAL_TERM",                      name: "Renewal Term",                      description: "Renewal term after initial term expires" },
  { id: "cuad_notice_period_to_terminate_renewal", code: "NOTICE_PERIOD_TO_TERMINATE_RENEWAL", name: "Notice Period To Terminate Renewal", description: "Notice period required to terminate renewal" },
  { id: "cuad_governing_law",                     code: "GOVERNING_LAW",                     name: "Governing Law",                     description: "Which state/country's laws govern the agreement" },
  { id: "cuad_most_favored_nation",               code: "MOST_FAVORED_NATION",               name: "Most Favored Nation",               description: "Better terms granted to a third party must also be offered" },
  { id: "cuad_non_compete",                       code: "NON_COMPETE",                       name: "Non-Compete",                       description: "Restriction on competing in certain geographies/markets" },
  { id: "cuad_exclusivity",                       code: "EXCLUSIVITY",                       name: "Exclusivity",                       description: "Exclusive dealing / sole supplier obligation" },
  { id: "cuad_no_solicit_of_customers",           code: "NO_SOLICIT_OF_CUSTOMERS",           name: "No-Solicit Of Customers",           description: "Restriction on soliciting counterparty's customers" },
  { id: "cuad_competitive_restriction_exception", code: "COMPETITIVE_RESTRICTION_EXCEPTION", name: "Competitive Restriction Exception", description: "Exceptions to competitive restrictions" },
  { id: "cuad_no_solicit_of_employees",           code: "NO_SOLICIT_OF_EMPLOYEES",           name: "No-Solicit Of Employees",           description: "Restriction on soliciting counterparty's employees" },
  { id: "cuad_non_disparagement",                 code: "NON_DISPARAGEMENT",                 name: "Non-Disparagement",                 description: "Prohibition on negative public statements" },
  { id: "cuad_termination_for_convenience",       code: "TERMINATION_FOR_CONVENIENCE",       name: "Termination For Convenience",       description: "Right to terminate without cause" },
  { id: "cuad_rofr_rofo_rofn",                    code: "ROFR_ROFO_ROFN",                    name: "Right Of First Refusal / Offer / Negotiation", description: "Pre-emption rights" },
  { id: "cuad_change_of_control",                 code: "CHANGE_OF_CONTROL",                 name: "Change Of Control",                 description: "Effect of merger / acquisition" },
  { id: "cuad_anti_assignment",                   code: "ANTI_ASSIGNMENT",                   name: "Anti-Assignment",                   description: "Restriction on assignment of the contract" },
  { id: "cuad_revenue_profit_sharing",            code: "REVENUE_PROFIT_SHARING",            name: "Revenue / Profit Sharing",          description: "Revenue or profit share arrangement" },
  { id: "cuad_price_restrictions",                code: "PRICE_RESTRICTIONS",                name: "Price Restrictions",                description: "Restrictions on price changes / pricing" },
  { id: "cuad_minimum_commitment",                code: "MINIMUM_COMMITMENT",                name: "Minimum Commitment",                description: "Guaranteed minimum volume / spend" },
  { id: "cuad_volume_restriction",                code: "VOLUME_RESTRICTION",                name: "Volume Restriction",                description: "Maximum / minimum volume restrictions" },
  { id: "cuad_ip_ownership_assignment",           code: "IP_OWNERSHIP_ASSIGNMENT",           name: "IP Ownership Assignment",           description: "Who owns IP created under the contract" },
  { id: "cuad_joint_ip_ownership",                code: "JOINT_IP_OWNERSHIP",                name: "Joint IP Ownership",                description: "Joint ownership of IP" },
  { id: "cuad_license_grant",                     code: "LICENSE_GRANT",                     name: "License Grant",                     description: "Scope of license granted" },
  { id: "cuad_non_transferable_license",          code: "NON_TRANSFERABLE_LICENSE",          name: "Non-Transferable License",          description: "License is not assignable / transferable" },
  { id: "cuad_affiliate_license_licensor",        code: "AFFILIATE_LICENSE_LICENSOR",        name: "Affiliate License — Licensor",      description: "Licensor's affiliates can grant license" },
  { id: "cuad_affiliate_license_licensee",        code: "AFFILIATE_LICENSE_LICENSEE",        name: "Affiliate License — Licensee",      description: "Licensee's affiliates can use license" },
  { id: "cuad_unlimited_all_you_can_eat_license", code: "UNLIMITED_ALL_YOU_CAN_EAT_LICENSE", name: "Unlimited / All-You-Can-Eat License", description: "Unrestricted use license" },
  { id: "cuad_irrevocable_or_perpetual_license",  code: "IRREVOCABLE_OR_PERPETUAL_LICENSE",  name: "Irrevocable / Perpetual License",   description: "License cannot be revoked / never expires" },
  { id: "cuad_source_code_escrow",                code: "SOURCE_CODE_ESCROW",                name: "Source Code Escrow",                description: "Source code held in escrow" },
  { id: "cuad_post_termination_services",         code: "POST_TERMINATION_SERVICES",         name: "Post-Termination Services",         description: "Services after contract end" },
  { id: "cuad_audit_rights",                      code: "AUDIT_RIGHTS",                      name: "Audit Rights",                      description: "Right to audit counterparty" },
  { id: "cuad_uncapped_liability",                code: "UNCAPPED_LIABILITY",                name: "Uncapped Liability",                description: "Liability is not capped" },
  { id: "cuad_cap_on_liability",                  code: "CAP_ON_LIABILITY",                  name: "Cap On Liability",                  description: "Cap on aggregate liability" },
  { id: "cuad_liquidated_damages",                code: "LIQUIDATED_DAMAGES",                name: "Liquidated Damages",                description: "Pre-agreed damages for breach" },
  { id: "cuad_warranty_duration",                 code: "WARRANTY_DURATION",                 name: "Warranty Duration",                 description: "Duration of warranties" },
  { id: "cuad_insurance",                         code: "INSURANCE",                         name: "Insurance",                         description: "Required insurance coverage" },
  { id: "cuad_covenant_not_to_sue",               code: "COVENANT_NOT_TO_SUE",               name: "Covenant Not To Sue",               description: "Promise not to sue counterparty" },
  { id: "cuad_third_party_beneficiary",           code: "THIRD_PARTY_BENEFICIARY",           name: "Third Party Beneficiary",           description: "Third parties that can enforce the contract" },
];

// Default mapping clause-family → CUAD categories (system-wide / tenantId NULL).
const DEFAULT_FAMILY_CUAD_MAP: Record<string, string[]> = {
  cf_liab: ["cuad_cap_on_liability", "cuad_uncapped_liability", "cuad_liquidated_damages"],
  cf_term: ["cuad_expiration_date", "cuad_renewal_term", "cuad_notice_period_to_terminate_renewal", "cuad_termination_for_convenience"],
  cf_data: ["cuad_audit_rights"],
  cf_pay:  ["cuad_revenue_profit_sharing", "cuad_minimum_commitment"],
  cf_sla:  ["cuad_warranty_duration"],
  cf_ip:   ["cuad_ip_ownership_assignment", "cuad_license_grant", "cuad_non_transferable_license"],
};

// Default expectations per contract type (which CUAD categories should be present).
// 'expected' = pflicht-bauteil, 'recommended' = nice-to-have.
const DEFAULT_CT_CUAD_EXPECTATIONS: Record<string, Array<{ id: string; req: "expected" | "recommended" }>> = {
  ct_nda: [
    { id: "cuad_parties",            req: "expected" },
    { id: "cuad_effective_date",     req: "expected" },
    { id: "cuad_expiration_date",    req: "expected" },
    { id: "cuad_governing_law",      req: "expected" },
    { id: "cuad_audit_rights",       req: "recommended" },
    { id: "cuad_anti_assignment",    req: "recommended" },
  ],
  ct_msa: [
    { id: "cuad_parties",                          req: "expected" },
    { id: "cuad_effective_date",                   req: "expected" },
    { id: "cuad_expiration_date",                  req: "expected" },
    { id: "cuad_renewal_term",                     req: "expected" },
    { id: "cuad_notice_period_to_terminate_renewal", req: "expected" },
    { id: "cuad_governing_law",                    req: "expected" },
    { id: "cuad_cap_on_liability",                 req: "expected" },
    { id: "cuad_warranty_duration",                req: "expected" },
    { id: "cuad_audit_rights",                     req: "expected" },
    { id: "cuad_ip_ownership_assignment",          req: "expected" },
    { id: "cuad_license_grant",                    req: "expected" },
    { id: "cuad_anti_assignment",                  req: "expected" },
    { id: "cuad_termination_for_convenience",      req: "expected" },
    { id: "cuad_insurance",                        req: "recommended" },
    { id: "cuad_change_of_control",                req: "recommended" },
    { id: "cuad_source_code_escrow",               req: "recommended" },
  ],
  ct_of: [
    { id: "cuad_parties",         req: "expected" },
    { id: "cuad_effective_date",  req: "expected" },
    { id: "cuad_expiration_date", req: "expected" },
    { id: "cuad_minimum_commitment", req: "recommended" },
  ],
};

export async function seedCuadDefaultsIdempotent(): Promise<void> {
  // 1) Categories (tenant-agnostic taxonomy).
  await db.insert(cuadCategoriesTable).values(
    CUAD_CATEGORIES.map((c, idx) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      sortOrder: idx,
    })),
  ).onConflictDoNothing();

  // 2) Default family ↔ CUAD mapping (tenantId NULL = system mapping).
  const familyMappings: Array<typeof clauseFamilyCuadCategoriesTable.$inferInsert> = [];
  for (const [familyId, cuadIds] of Object.entries(DEFAULT_FAMILY_CUAD_MAP)) {
    for (const cuadId of cuadIds) {
      familyMappings.push({
        id: `cfcuad_${familyId}_${cuadId}`.slice(0, 64),
        tenantId: null,
        familyId,
        cuadCategoryId: cuadId,
      });
    }
  }
  if (familyMappings.length) {
    await db.insert(clauseFamilyCuadCategoriesTable).values(familyMappings).onConflictDoNothing();
  }

  // 3) Default per-contract-type expectations (only for tn_root seeded contract types).
  const ctExpectations: Array<typeof contractTypeCuadExpectationsTable.$inferInsert> = [];
  for (const [contractTypeId, items] of Object.entries(DEFAULT_CT_CUAD_EXPECTATIONS)) {
    for (const it of items) {
      ctExpectations.push({
        id: `ctcuad_${contractTypeId}_${it.id}`.slice(0, 64),
        tenantId: "tn_root",
        contractTypeId,
        cuadCategoryId: it.id,
        requirement: it.req,
      });
    }
  }
  if (ctExpectations.length) {
    await db.insert(contractTypeCuadExpectationsTable).values(ctExpectations).onConflictDoNothing();
  }
}

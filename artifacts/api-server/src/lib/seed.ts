import { sql } from "drizzle-orm";
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
} from "@workspace/db";
import { hashPassword } from "./auth";
import { logger } from "./logger";

const id = (prefix: string, n: number) => `${prefix}_${String(n).padStart(3, "0")}`;
const now = new Date();
const daysFromNow = (d: number) => new Date(now.getTime() + d * 86400000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

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
      passwordHash: demoPwHash, isActive: true, tenantId: "tn_root", tenantWide: true,  scopeCompanyIds: JSON.stringify([]),                                  scopeBrandIds: JSON.stringify([]) },
    { id: "u_tom",    name: "Tom Becker",       email: "tom@helix.com",    role: "Account Executive",  scope: "co_helix_us",  initials: "TB", avatarColor: "#0EA5E9",
      passwordHash: demoPwHash, isActive: true, tenantId: "tn_root", tenantWide: false, scopeCompanyIds: JSON.stringify(["co_helix_us"]),                    scopeBrandIds: JSON.stringify([]) },
  ];
  await db.insert(usersTable).values(users);

  await db.insert(rolesTable).values([
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

  await db.insert(priceRulesTable).values([
    { id: "pr_001", name: "Volume tier > 500k EUR", scope: "global", condition: "deal.value > 500000", effect: "auto-discount up to 8%", priority: 10, status: "active" },
    { id: "pr_002", name: "Multi-year commitment uplift", scope: "global", condition: "term >= 36 months", effect: "additional 5% discount", priority: 20, status: "active" },
    { id: "pr_003", name: "Strategic account exception", scope: "co_helix", condition: "account.tier = strategic", effect: "deal-desk approval required", priority: 5, status: "active" },
    { id: "pr_004", name: "Hardware bundle margin floor", scope: "co_helix", condition: "category = Hardware", effect: "block discount > 12%", priority: 15, status: "active" },
    { id: "pr_005", name: "UK FY26 list price", scope: "co_helix_uk", condition: "currency = GBP", effect: "use UK price book v2", priority: 1, status: "draft" },
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
  ];
  await db.insert(clauseVariantsTable).values(variantRows.map(v => ({
    id: v.id, familyId: v.familyId, name: v.name, summary: v.summary, body: v.body,
    severity: sevFromScore(v.severityScore), severityScore: v.severityScore, tone: v.tone,
  })));

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
  await db.insert(timelineEventsTable).values(tl.map((t, i) => ({ id: id("tl", i + 1), ...t })));

  // Copilot — insights are generated dynamically by insights/generators.ts
  // from reactions, approvals, letters and quote-versions. No static seed.

  await db.insert(copilotThreadsTable).values([
    { id: "ct_th_001", title: "Wie gehe ich mit Vorwerks 12%-Forderung um?",    scope: "deal:dl_001", lastMessage: "Vorschlag 9% + Mehrjahres-Bindung. Marge bleibt über 30% Floor.",                messageCount: 6 },
    { id: "ct_th_002", title: "Renewal-Mail für Castell entwerfen",             scope: "deal:dl_005", lastMessage: "In deinem Stil entworfen. Soll ich einen Pro-Tier-Upsell-Absatz ergänzen?",     messageCount: 4 },
    { id: "ct_th_003", title: "Gewonnene vs. verlorene Deals dieses Quartal",  scope: "global",       lastMessage: "Rabattdisziplin ist der stärkste Prädiktor (R² 0,71).",                          messageCount: 9 },
    { id: "ct_th_004", title: "Nordstern Legal-Redlines zusammenfassen",        scope: "deal:dl_003", lastMessage: "4 materielle Änderungen; 2 erfordern Deal Desk + Legal.",                        messageCount: 5 },
  ]);

  // Copilot messages for existing threads
  await db.insert(copilotMessagesTable).values([
    { id: "cm_001", threadId: "ct_th_001", role: "user",      content: "Vorwerk fordert 12% Rabatt. Was ist vertretbar?" },
    { id: "cm_002", threadId: "ct_th_001", role: "assistant", content: "Median gewonnener Deals im DACH-Segment liegt bei 7,8%. Gegenangebot mit 9% bei 24-monatiger Bindung hält die Marge über 30%." },
    { id: "cm_003", threadId: "ct_th_001", role: "user",      content: "Was, wenn sie die Laufzeitverlängerung ablehnen?" },
    { id: "cm_004", threadId: "ct_th_001", role: "assistant", content: "Biete 8% mit Quartals-Mengen-Rabatt ab 110% Forecast. Netto-Effekt gleich, Optik besser." },
    { id: "cm_005", threadId: "ct_th_002", role: "user",      content: "Entwirf eine Renewal-Mail für Castell." },
    { id: "cm_006", threadId: "ct_th_002", role: "assistant", content: "In deinem Stil entworfen. Soll ich einen Pro-Tier-Upsell-Absatz ergänzen?" },
    { id: "cm_007", threadId: "ct_th_003", role: "user",      content: "Vergleiche gewonnene vs. verlorene Deals dieses Quartal." },
    { id: "cm_008", threadId: "ct_th_003", role: "assistant", content: "Rabattdisziplin (R² 0,71) ist der stärkste Prädiktor. Verlorene Deals lagen im Schnitt bei 13,4% Rabatt vs. 7,8% bei gewonnenen." },
    { id: "cm_009", threadId: "ct_th_004", role: "user",      content: "Fasse die Nordstern Legal-Redlines zusammen." },
    { id: "cm_010", threadId: "ct_th_004", role: "assistant", content: "4 materielle Änderungen; Haftungs-Cap-Verzicht und IP-Freistellung erfordern Deal Desk + Legal-Freigabe." },
  ]);

  // Audit log
  await db.insert(auditLogTable).values([
    { id: "au_001", entityType: "deal",     entityId: "dl_001", action: "discount_changed",  actor: "Anna Brandt",      summary: "Rabatt auf Vorwerk-Renewal von 8% auf 12% angehoben.",          beforeJson: '{"discount":8}',  afterJson: '{"discount":12}', at: daysFromNow(-2) },
    { id: "au_002", entityType: "contract", entityId: "ctr_001", action: "clause_swapped",    actor: "Sara Lindqvist",   summary: "Haftungs-Cap-Klausel auf Standard-Variante umgestellt.",          beforeJson: null, afterJson: null, at: daysFromNow(-3) },
    { id: "au_003", entityType: "price",    entityId: "pr_001", action: "price_overridden",  actor: "Priya Raman",      summary: "Override auf PRO-200 (-4,5%) für Atlas-Account.",                 beforeJson: '{"price":1280}', afterJson: '{"price":1222}', at: daysFromNow(-5) },
    { id: "au_004", entityType: "deal",     entityId: "dl_007", action: "stage_changed",     actor: "Marcel Voss",      summary: "Atlas Energy von Verhandlung → Closing verschoben.",              beforeJson: null, afterJson: null, at: daysFromNow(-1) },
    { id: "au_005", entityType: "letter",   entityId: "pl_001", action: "letter_sent",       actor: "Priya Raman",      summary: "Hardware-Uplift-Schreiben an 14 Kunden versendet.",               beforeJson: null, afterJson: null, at: daysFromNow(-6) },
    { id: "au_006", entityType: "deal",     entityId: "dl_003", action: "comment_added",     actor: "James Whitfield",  summary: "Champion bestätigte erhaltene Budget-Freigabe.",                  beforeJson: null, afterJson: null, at: daysFromNow(-4) },
    { id: "au_007", entityType: "contract", entityId: "ctr_005", action: "version_published", actor: "Sara Lindqvist",   summary: "Northwind v2 mit Stufen-Rollout-Option veröffentlicht.",          beforeJson: null, afterJson: null, at: daysFromNow(-2) },
    { id: "au_008", entityType: "order",    entityId: "oc_001", action: "handover_started",  actor: "Anna Brandt",      summary: "Handover-Prüfungen für OC-2026-001 gestartet.",                   beforeJson: null, afterJson: null, at: daysFromNow(-1) },
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

  logger.info("Seed complete.");
}

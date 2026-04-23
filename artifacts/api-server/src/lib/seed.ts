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

  const brands = [
    { id: "br_helix", companyId: "co_helix", name: "Helix Core", color: "#2D6CDF", voice: "precise" },
    { id: "br_helix_pro", companyId: "co_helix", name: "Helix Pro", color: "#0F766E", voice: "premium" },
    { id: "br_helix_uk", companyId: "co_helix_uk", name: "Helix UK", color: "#9333EA", voice: "concise" },
    { id: "br_helix_us", companyId: "co_helix_us", name: "Helix Velocity", color: "#DC2626", voice: "bold" },
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
    { id: "u_priya",  name: "Priya Raman",      email: "priya@helix.com",  role: "VP Commercial",      scope: "tn_root",      initials: "PR", avatarColor: "#EA580C",
      passwordHash: demoPwHash, isActive: true, tenantId: "tn_root", tenantWide: true,  scopeCompanyIds: JSON.stringify([]),                                  scopeBrandIds: JSON.stringify([]) },
    { id: "u_tom",    name: "Tom Becker",       email: "tom@helix.com",    role: "Account Executive",  scope: "co_helix_us",  initials: "TB", avatarColor: "#0EA5E9",
      passwordHash: demoPwHash, isActive: true, tenantId: "tn_root", tenantWide: false, scopeCompanyIds: JSON.stringify(["co_helix_us"]),                    scopeBrandIds: JSON.stringify([]) },
  ];
  await db.insert(usersTable).values(users);

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

  const variants: Array<{ id: string; familyId: string; name: string; severity: string; summary: string }> = [
    { id: "cv_liab_std", familyId: "cf_liab", name: "Standard cap (12 months fees)", severity: "low",    summary: "Liability capped at 12 months of fees paid." },
    { id: "cv_liab_2x",  familyId: "cf_liab", name: "2x annual fees",                severity: "medium", summary: "Cap raised to 2x annual fees." },
    { id: "cv_liab_un",  familyId: "cf_liab", name: "Uncapped for IP infringement",  severity: "high",   summary: "Uncapped liability for IP infringement claims." },
    { id: "cv_term_36",  familyId: "cf_term", name: "36-month auto-renew",           severity: "low",    summary: "Initial term 36 months with 90-day notice." },
    { id: "cv_term_24",  familyId: "cf_term", name: "24-month with opt-out",         severity: "medium", summary: "24-month term with opt-out at month 12." },
    { id: "cv_data_eu",  familyId: "cf_data", name: "EU-hosted data",                severity: "low",    summary: "All data hosted in EU; SCCs included." },
    { id: "cv_data_loc", familyId: "cf_data", name: "Customer-hosted",               severity: "medium", summary: "Customer-hosted deployment with audit rights." },
    { id: "cv_pay_n30",  familyId: "cf_pay",  name: "Net 30",                        severity: "low",    summary: "Standard net-30 payment terms." },
    { id: "cv_pay_n60",  familyId: "cf_pay",  name: "Net 60",                        severity: "medium", summary: "Extended net-60 terms with discount surrender." },
    { id: "cv_sla_99",   familyId: "cf_sla",  name: "99.5% uptime",                  severity: "low",    summary: "99.5% monthly uptime, credits up to 10%." },
    { id: "cv_sla_999",  familyId: "cf_sla",  name: "99.9% uptime",                  severity: "medium", summary: "99.9% uptime with 25% credit ceiling." },
    { id: "cv_ip_lic",   familyId: "cf_ip",   name: "License only",                  severity: "low",    summary: "Customer receives non-exclusive license; Helix retains IP." },
    { id: "cv_ip_assign",familyId: "cf_ip",   name: "Assignment of derivatives",     severity: "high",   summary: "Custom derivatives assigned to customer." },
  ];
  await db.insert(clauseVariantsTable).values(variants);

  // Contracts
  const contracts = [
    { id: "ctr_001", dealId: "dl_003", title: "Nordstern – Capacity Expansion MSA", status: "in_review", version: 3, riskLevel: "high",   template: "Master Services Agreement" },
    { id: "ctr_002", dealId: "dl_001", title: "Vorwerk – Fleet Modernisation Order Form", status: "drafting",  version: 1, riskLevel: "medium", template: "Order Form" },
    { id: "ctr_003", dealId: "dl_009", title: "Fjord – Vessel Telemetry MSA",        status: "signed",    version: 2, riskLevel: "low",    template: "Master Services Agreement" },
    { id: "ctr_004", dealId: "dl_004", title: "BlueRiver – Pipeline Sensors SOW",    status: "in_review", version: 2, riskLevel: "medium", template: "Statement of Work" },
    { id: "ctr_005", dealId: "dl_008", title: "Northwind – DC Rollout Order Form",   status: "out_for_signature", version: 1, riskLevel: "low", template: "Order Form" },
  ];
  await db.insert(contractsTable).values(contracts.map(c => ({ ...c, validUntil: isoDate(daysFromNow(365)) })));

  await db.insert(contractClausesTable).values([
    { id: "cc_001", contractId: "ctr_001", family: "Liability",          variant: "Uncapped for IP infringement", severity: "high",   summary: "Customer requires uncapped IP indemnity." },
    { id: "cc_002", contractId: "ctr_001", family: "Term & Termination", variant: "36-month auto-renew",          severity: "low",    summary: "36 months with 90-day notice." },
    { id: "cc_003", contractId: "ctr_001", family: "Service Levels",     variant: "99.9% uptime",                 severity: "medium", summary: "Tightened to 99.9% with 25% credit ceiling." },
    { id: "cc_004", contractId: "ctr_001", family: "Payment Terms",      variant: "Net 60",                       severity: "medium", summary: "Customer requested Net 60." },
    { id: "cc_005", contractId: "ctr_002", family: "Liability",          variant: "Standard cap (12 months fees)",severity: "low",    summary: "Default cap of 12 months." },
    { id: "cc_006", contractId: "ctr_002", family: "Term & Termination", variant: "24-month with opt-out",        severity: "medium", summary: "24 months with month-12 opt-out." },
    { id: "cc_007", contractId: "ctr_003", family: "Liability",          variant: "2x annual fees",               severity: "medium", summary: "Cap negotiated to 2x annual fees." },
    { id: "cc_008", contractId: "ctr_003", family: "Service Levels",     variant: "99.9% uptime",                 severity: "medium", summary: "99.9% uptime SLA." },
    { id: "cc_009", contractId: "ctr_004", family: "Data Protection",    variant: "EU-hosted data",               severity: "low",    summary: "EU hosting with SCCs." },
    { id: "cc_010", contractId: "ctr_005", family: "Payment Terms",      variant: "Net 30",                       severity: "low",    summary: "Standard payment terms." },
  ]);

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
    { id: "sg_001", dealId: "dl_009", title: "Fjord – Vessel Telemetry MSA + Order Form", status: "in_progress", deadline: daysFromNow(3) },
    { id: "sg_002", dealId: "dl_008", title: "Northwind – DC Rollout Order Form",          status: "in_progress", deadline: daysFromNow(6) },
    { id: "sg_003", dealId: "dl_003", title: "Nordstern – Capacity Expansion MSA",         status: "draft",       deadline: daysFromNow(14) },
    { id: "sg_004", dealId: "dl_012",title: "BlueRiver Maintenance Contract",              status: "completed",   deadline: daysFromNow(-7) },
  ];
  await db.insert(signaturePackagesTable).values(sigs);

  await db.insert(signersTable).values([
    { id: "sn_001", packageId: "sg_001", name: "Ingrid Solberg", email: "i.solberg@fjord.no", role: "Procurement Manager", order: 1, status: "signed",  signedAt: daysFromNow(-1) },
    { id: "sn_002", packageId: "sg_001", name: "Erik Lindahl",   email: "e.lindahl@fjord.no", role: "CFO",                 order: 2, status: "pending", signedAt: null },
    { id: "sn_003", packageId: "sg_002", name: "Oliver Hayes",   email: "o.hayes@northwind.co.uk", role: "Head of Supply",  order: 1, status: "signed",  signedAt: daysFromNow(-2) },
    { id: "sn_004", packageId: "sg_002", name: "Priya Raman",    email: "priya@helix.com",   role: "VP Commercial",        order: 2, status: "pending", signedAt: null },
    { id: "sn_005", packageId: "sg_003", name: "Dr. Stefan Reuter", email: "s.reuter@nordstern.de", role: "CFO",            order: 1, status: "pending", signedAt: null },
    { id: "sn_006", packageId: "sg_003", name: "Marcel Voss",    email: "marcel@helix.com",  role: "Senior AE",            order: 2, status: "pending", signedAt: null },
    { id: "sn_007", packageId: "sg_004", name: "Eleanor Whitcombe", email: "e.whitcombe@blueriver.co.uk", role: "Director", order: 1, status: "signed", signedAt: daysFromNow(-8) },
    { id: "sn_008", packageId: "sg_004", name: "James Whitfield",  email: "james@helix.com", role: "Regional Director",    order: 2, status: "signed", signedAt: daysFromNow(-7) },
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

  // Copilot
  await db.insert(copilotInsightsTable).values([
    { id: "ci_001", kind: "risk",        title: "Vorwerk Rabattrisiko",                 summary: "12% Rabatt liegen über dem Median von 7,8% gewonnener Deals in diesem Segment.", severity: "high",   dealId: "dl_001", suggestedAction: "Gegenangebot 9% + 24-Monats-Bindung." },
    { id: "ci_002", kind: "next_action", title: "Technischen Workshop planen",          summary: "Vorwerk-Add-on hängt seit 9 Tagen; Champion hat einen Workshop angefragt.",       severity: "medium", dealId: "dl_002", suggestedAction: "3 Workshop-Slot-Vorschläge heute senden." },
    { id: "ci_003", kind: "risk",        title: "Nordstern Legal blockiert",            summary: "Haftungs-Cap-Verzicht seit 3 Tagen offen; Wettbewerber in 2. Runde.",              severity: "high",   dealId: "dl_003", suggestedAction: "An Sara Lindqvist eskalieren." },
    { id: "ci_004", kind: "opportunity", title: "Castell Renewal-Fenster offen",        summary: "Castell Health-Score 88; idealer Moment für 22% Expansion.",                       severity: "low",    dealId: "dl_005", suggestedAction: "Pro-Tier-Upgrade pitchen." },
    { id: "ci_005", kind: "next_action", title: "Atlas CAPEX-Freigabe verzögert sich",  summary: "Kunden-CAPEX-Zyklus endet in 14 Tagen.",                                          severity: "medium", dealId: "dl_007", suggestedAction: "Gestaffeltes Zahlungsmodell vorschlagen." },
    { id: "ci_006", kind: "risk",        title: "Apex ROI-Analyse offen",               summary: "30% Abschluss-Wahrscheinlichkeit; ROI-Deck noch nicht geteilt.",                  severity: "medium", dealId: "dl_010", suggestedAction: "ROI-Rechner innerhalb 48h teilen." },
  ]);

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
    { id: "oc_001", dealId: "dl_001", contractId: "ctr_002", number: "OC-2026-001", status: "ready",      readinessScore: 100, totalAmount: "184500.00", currency: "EUR", expectedDelivery: isoDate(daysFromNow(21)), handoverAt: null,                createdAt: daysFromNow(-3) },
    { id: "oc_002", dealId: "dl_005", contractId: null,    number: "OC-2026-002", status: "in_review",  readinessScore: 64, totalAmount: "92800.00",  currency: "EUR", expectedDelivery: isoDate(daysFromNow(35)), handoverAt: null,                createdAt: daysFromNow(-2) },
    { id: "oc_003", dealId: "dl_013", contractId: null,    number: "OC-2026-003", status: "handed_over",readinessScore: 100,totalAmount: "340000.00", currency: "EUR", expectedDelivery: isoDate(daysFromNow(-5)),  handoverAt: daysFromNow(-7),     createdAt: daysFromNow(-25) },
    { id: "oc_004", dealId: "dl_007", contractId: null,    number: "OC-2026-004", status: "blocked",    readinessScore: 38, totalAmount: "1240000.00",currency: "EUR", expectedDelivery: isoDate(daysFromNow(60)), handoverAt: null,                createdAt: daysFromNow(-1) },
  ]);

  await db.insert(orderConfirmationChecksTable).values([
    { id: "ocx_001", orderConfirmationId: "oc_001", label: "Credit limit verified",    status: "ok",      detail: "EUR 250k available." },
    { id: "ocx_002", orderConfirmationId: "oc_001", label: "Tax & VAT data complete",  status: "ok",      detail: "DE VAT validated." },
    { id: "ocx_003", orderConfirmationId: "oc_001", label: "Delivery address confirmed",status: "ok",     detail: "Site Wuppertal." },
    { id: "ocx_004", orderConfirmationId: "oc_001", label: "Payment terms aligned",    status: "ok",      detail: "Net45 reconfirmed by customer." },
    { id: "ocx_005", orderConfirmationId: "oc_002", label: "Credit limit verified",    status: "ok",      detail: "EUR 100k available." },
    { id: "ocx_006", orderConfirmationId: "oc_002", label: "ERP article mapping",      status: "warning", detail: "2 of 14 SKUs pending mapping." },
    { id: "ocx_007", orderConfirmationId: "oc_002", label: "Logistics slot reserved",  status: "pending", detail: "Awaiting carrier confirmation." },
    { id: "ocx_008", orderConfirmationId: "oc_003", label: "All checks completed",     status: "ok",      detail: "Handed over to Operations." },
    { id: "ocx_009", orderConfirmationId: "oc_004", label: "Credit limit verified",    status: "blocked", detail: "Exposure exceeds limit by EUR 240k." },
    { id: "ocx_010", orderConfirmationId: "oc_004", label: "Export control screening", status: "warning", detail: "Dual-use review required." },
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

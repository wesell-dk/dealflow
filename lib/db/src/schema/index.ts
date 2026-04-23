import {
  pgTable,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
} from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey();
const ts = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

// Org
export const tenantsTable = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  plan: text("plan").notNull(),
  region: text("region").notNull(),
  createdAt: ts("created_at"),
});

export const companiesTable = pgTable("companies", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  legalName: text("legal_name").notNull(),
  country: text("country").notNull(),
  currency: text("currency").notNull(),
});

export const brandsTable = pgTable("brands", {
  id: id(),
  companyId: text("company_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  voice: text("voice").notNull(),
});

export const usersTable = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  scope: text("scope").notNull(),
  initials: text("initials").notNull(),
  avatarColor: text("avatar_color"),
});

// Accounts / contacts
export const accountsTable = pgTable("accounts", {
  id: id(),
  name: text("name").notNull(),
  industry: text("industry").notNull(),
  country: text("country").notNull(),
  healthScore: integer("health_score").notNull(),
  ownerId: text("owner_id"),
});

export const contactsTable = pgTable("contacts", {
  id: id(),
  accountId: text("account_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  isDecisionMaker: boolean("is_decision_maker").notNull().default(false),
  phone: text("phone"),
});

// Deals
export const dealsTable = pgTable("deals", {
  id: id(),
  name: text("name").notNull(),
  accountId: text("account_id").notNull(),
  stage: text("stage").notNull(),
  value: numeric("value").notNull(),
  currency: text("currency").notNull(),
  probability: integer("probability").notNull(),
  expectedCloseDate: date("expected_close_date").notNull(),
  ownerId: text("owner_id").notNull(),
  brandId: text("brand_id").notNull(),
  companyId: text("company_id").notNull(),
  riskLevel: text("risk_level").notNull(),
  nextStep: text("next_step"),
  updatedAt: ts("updated_at"),
});

// Quotes
export const quotesTable = pgTable("quotes", {
  id: id(),
  dealId: text("deal_id").notNull(),
  number: text("number").notNull(),
  status: text("status").notNull(),
  currentVersion: integer("current_version").notNull().default(1),
  currency: text("currency").notNull(),
  validUntil: date("valid_until").notNull(),
  createdAt: ts("created_at"),
});

export const quoteVersionsTable = pgTable("quote_versions", {
  id: id(),
  quoteId: text("quote_id").notNull(),
  version: integer("version").notNull(),
  totalAmount: numeric("total_amount").notNull(),
  discountPct: numeric("discount_pct").notNull(),
  marginPct: numeric("margin_pct").notNull(),
  status: text("status").notNull(),
  notes: text("notes"),
  createdAt: ts("created_at"),
});

export const lineItemsTable = pgTable("line_items", {
  id: id(),
  quoteVersionId: text("quote_version_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  quantity: numeric("quantity").notNull(),
  unitPrice: numeric("unit_price").notNull(),
  listPrice: numeric("list_price").notNull(),
  discountPct: numeric("discount_pct").notNull(),
  total: numeric("total").notNull(),
});

// Pricing
export const pricePositionsTable = pgTable("price_positions", {
  id: id(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  listPrice: numeric("list_price").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  validFrom: date("valid_from").notNull(),
  validUntil: date("valid_until"),
  brandId: text("brand_id").notNull(),
  companyId: text("company_id").notNull(),
  version: integer("version").notNull().default(1),
  isStandard: boolean("is_standard").notNull().default(true),
});

export const priceRulesTable = pgTable("price_rules", {
  id: id(),
  name: text("name").notNull(),
  scope: text("scope").notNull(),
  condition: text("condition").notNull(),
  effect: text("effect").notNull(),
  priority: integer("priority").notNull(),
  status: text("status").notNull(),
});

// Approvals
export const approvalsTable = pgTable("approvals", {
  id: id(),
  dealId: text("deal_id").notNull(),
  type: text("type").notNull(),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull(),
  status: text("status").notNull(),
  priority: text("priority").notNull(),
  impactValue: numeric("impact_value").notNull(),
  currency: text("currency").notNull(),
  deadline: timestamp("deadline", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  decisionComment: text("decision_comment"),
  createdAt: ts("created_at"),
});

// Contracts
export const contractsTable = pgTable("contracts", {
  id: id(),
  dealId: text("deal_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull().default(1),
  riskLevel: text("risk_level").notNull(),
  template: text("template").notNull(),
  validUntil: date("valid_until"),
  createdAt: ts("created_at"),
});

export const clauseFamiliesTable = pgTable("clause_families", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull(),
});

export const clauseVariantsTable = pgTable("clause_variants", {
  id: id(),
  familyId: text("family_id").notNull(),
  name: text("name").notNull(),
  severity: text("severity").notNull(),
  summary: text("summary").notNull(),
});

export const contractClausesTable = pgTable("contract_clauses", {
  id: id(),
  contractId: text("contract_id").notNull(),
  family: text("family").notNull(),
  variant: text("variant").notNull(),
  severity: text("severity").notNull(),
  summary: text("summary").notNull(),
});

// Negotiations
export const negotiationsTable = pgTable("negotiations", {
  id: id(),
  dealId: text("deal_id").notNull(),
  status: text("status").notNull(),
  round: integer("round").notNull().default(1),
  lastReactionType: text("last_reaction_type").notNull(),
  riskLevel: text("risk_level").notNull(),
  updatedAt: ts("updated_at"),
});

export const customerReactionsTable = pgTable("customer_reactions", {
  id: id(),
  negotiationId: text("negotiation_id").notNull(),
  type: text("type").notNull(),
  topic: text("topic").notNull(),
  summary: text("summary").notNull(),
  source: text("source").notNull(),
  priority: text("priority").notNull(),
  impactPct: numeric("impact_pct"),
  createdAt: ts("created_at"),
});

// Signatures
export const signaturePackagesTable = pgTable("signature_packages", {
  id: id(),
  dealId: text("deal_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  deadline: timestamp("deadline", { withTimezone: true }),
  createdAt: ts("created_at"),
});

export const signersTable = pgTable("signers", {
  id: id(),
  packageId: text("package_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  order: integer("order_index").notNull(),
  status: text("status").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }),
});

// Price increases
export const priceIncreaseCampaignsTable = pgTable("price_increase_campaigns", {
  id: id(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  effectiveDate: date("effective_date").notNull(),
  currency: text("currency").notNull(),
  averageUpliftPct: numeric("average_uplift_pct").notNull(),
  createdAt: ts("created_at"),
});

export const priceIncreaseLettersTable = pgTable("price_increase_letters", {
  id: id(),
  campaignId: text("campaign_id").notNull(),
  accountId: text("account_id").notNull(),
  status: text("status").notNull(),
  upliftPct: numeric("uplift_pct").notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
});

// Timeline events
export const timelineEventsTable = pgTable("timeline_events", {
  id: id(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  actor: text("actor").notNull(),
  dealId: text("deal_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// Copilot
export const copilotInsightsTable = pgTable("copilot_insights", {
  id: id(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  severity: text("severity").notNull(),
  dealId: text("deal_id").notNull(),
  suggestedAction: text("suggested_action"),
  createdAt: ts("created_at"),
});

export const copilotThreadsTable = pgTable("copilot_threads", {
  id: id(),
  title: text("title").notNull(),
  scope: text("scope").notNull(),
  lastMessage: text("last_message").notNull(),
  messageCount: integer("message_count").notNull().default(1),
  updatedAt: ts("updated_at"),
});

import {
  pgTable,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
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
  retentionPolicy: jsonb("retention_policy")
    .$type<{
      contactInactiveDays?: number;
      letterRespondedDays?: number;
      auditLogDays?: number;
      accessLogDays?: number;
    }>()
    .default({})
    .notNull(),
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
  defaultClauseVariants: jsonb("default_clause_variants").$type<Record<string, string>>().default({}).notNull(),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  secondaryColor: text("secondary_color"),
  tone: text("tone"),
  legalEntityName: text("legal_entity_name"),
  addressLine: text("address_line"),
});

export const usersTable = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  scope: text("scope").notNull(),
  initials: text("initials").notNull(),
  avatarColor: text("avatar_color"),
  // Auth
  passwordHash: text("password_hash").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  tenantId: text("tenant_id").notNull().default("tn_root"),
  // Scope-RBAC: tenantWide=true → sieht alles im Tenant.
  // Sonst: scopeCompanyIds (JSON text[]) + scopeBrandIds (JSON text[]).
  // brandIds werden additiv gewertet (siehe scope.ts).
  tenantWide: boolean("tenant_wide").notNull().default(false),
  scopeCompanyIds: text("scope_company_ids").notNull().default("[]"),
  scopeBrandIds: text("scope_brand_ids").notNull().default("[]"),
});

export const rolesTable = pgTable("roles", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isSystem: boolean("is_system").notNull().default(false),
  tenantId: text("tenant_id").notNull().default("tn_root"),
});

export const sessionsTable = pgTable("sessions", {
  id: id(),
  userId: text("user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: ts("created_at"),
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
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  pseudonymizedAt: timestamp("pseudonymized_at", { withTimezone: true }),
});

// GDPR: deletion log (soft-delete + pseudonymization audit)
export const subjectsDeletionLogTable = pgTable("subjects_deletion_log", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  subjectType: text("subject_type").notNull(),
  subjectId: text("subject_id").notNull(),
  requestedBy: text("requested_by").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("completed"),
  pseudonymBefore: jsonb("pseudonym_before").$type<Record<string, unknown>>(),
  requestedAt: ts("requested_at"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// GDPR: access log — protokolliert lesende Zugriffe auf PII-Felder
export const accessLogTable = pgTable("access_log", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  field: text("field").notNull(),
  action: text("action").notNull().default("read"),
  at: ts("at"),
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
  templateId: text("template_id"),
  sectionsSnapshot: jsonb("sections_snapshot")
    .$type<Array<{ kind: string; title: string; body: string; order: number }>>()
    .default([])
    .notNull(),
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

// Quote templates (reusable section + line-item bundles per industry)
export const quoteTemplatesTable = pgTable("quote_templates", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id"),
  brandId: text("brand_id"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  industry: text("industry").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  defaultDiscountPct: numeric("default_discount_pct").notNull().default("0"),
  defaultMarginPct: numeric("default_margin_pct").notNull().default("30"),
  defaultValidityDays: integer("default_validity_days").notNull().default(30),
  defaultLineItems: jsonb("default_line_items")
    .$type<Array<{
      name: string;
      description?: string;
      quantity: number;
      unitPrice: number;
      listPrice: number;
      discountPct: number;
    }>>()
    .default([])
    .notNull(),
  defaultAttachmentLibraryIds: jsonb("default_attachment_library_ids")
    .$type<string[]>()
    .default([])
    .notNull(),
  createdAt: ts("created_at"),
});

export const quoteTemplateSectionsTable = pgTable("quote_template_sections", {
  id: id(),
  templateId: text("template_id").notNull(),
  kind: text("kind").notNull(), // cover | intro | scope | terms | appendix | custom
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  order: integer("order_index").notNull().default(0),
});

// Reusable attachment library (Datasheets, AGB, Referenzen, etc.)
export const attachmentLibraryTable = pgTable("attachment_library", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  companyId: text("company_id"),
  brandId: text("brand_id"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull(), // datasheet | terms | reference | certificate | other
  tags: jsonb("tags").$type<string[]>().default([]).notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  objectPath: text("object_path").notNull(),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  createdAt: ts("created_at"),
});

// Per-quote-version attachments (linked to library or ad-hoc upload)
export const quoteAttachmentsTable = pgTable("quote_attachments", {
  id: id(),
  quoteVersionId: text("quote_version_id").notNull(),
  libraryAssetId: text("library_asset_id"),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  objectPath: text("object_path").notNull(),
  label: text("label"),
  order: integer("order_index").notNull().default(0),
  createdAt: ts("created_at"),
});

// Industry profile defaults: clause variants + suggested template & attachments
export const industryProfilesTable = pgTable("industry_profiles", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  industry: text("industry").notNull(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  defaultClauseVariants: jsonb("default_clause_variants")
    .$type<Record<string, string>>()
    .default({})
    .notNull(),
  suggestedTemplateId: text("suggested_template_id"),
  suggestedAttachmentLibraryIds: jsonb("suggested_attachment_library_ids")
    .$type<string[]>()
    .default([])
    .notNull(),
  createdAt: ts("created_at"),
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
  amendmentId: text("amendment_id"),
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
  severityScore: integer("severity_score").notNull().default(3),
  summary: text("summary").notNull(),
  body: text("body").notNull().default(""),
  tone: text("tone").notNull().default("standard"),
});

export const contractAmendmentsTable = pgTable("contract_amendments", {
  id: id(),
  originalContractId: text("original_contract_id").notNull(),
  number: text("number").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull(),
  effectiveFrom: date("effective_from"),
  createdBy: text("created_by"),
  createdAt: ts("created_at"),
});

export const amendmentClausesTable = pgTable("amendment_clauses", {
  id: id(),
  amendmentId: text("amendment_id").notNull(),
  operation: text("operation").notNull(),
  family: text("family").notNull(),
  familyId: text("family_id"),
  beforeVariantId: text("before_variant_id"),
  afterVariantId: text("after_variant_id"),
  beforeSummary: text("before_summary"),
  afterSummary: text("after_summary"),
  severity: text("severity"),
});

export const contractClausesTable = pgTable("contract_clauses", {
  id: id(),
  contractId: text("contract_id").notNull(),
  family: text("family").notNull(),
  variant: text("variant").notNull(),
  severity: text("severity").notNull(),
  summary: text("summary").notNull(),
  familyId: text("family_id"),
  activeVariantId: text("active_variant_id"),
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
  priceDeltaPct: numeric("price_delta_pct"),
  termMonthsDelta: integer("term_months_delta"),
  paymentTermsDeltaDays: integer("payment_terms_delta_days"),
  requestedClauseVariantId: text("requested_clause_variant_id"),
  linkedQuoteVersionId: text("linked_quote_version_id"),
  linkedApprovalId: text("linked_approval_id"),
  createdAt: ts("created_at"),
});

// Signatures
export const signaturePackagesTable = pgTable("signature_packages", {
  id: id(),
  dealId: text("deal_id").notNull(),
  amendmentId: text("amendment_id"),
  title: text("title").notNull(),
  status: text("status").notNull(),
  mode: text("mode").notNull().default("sequential"),
  reminderIntervalHours: integer("reminder_interval_hours").notNull().default(48),
  escalationAfterHours: integer("escalation_after_hours").notNull().default(120),
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  orderConfirmationId: text("order_confirmation_id"),
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
  sentAt: timestamp("sent_at", { withTimezone: true }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  declineReason: text("decline_reason"),
  lastReminderAt: timestamp("last_reminder_at", { withTimezone: true }),
  isFallback: boolean("is_fallback").notNull().default(false),
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
  triggerType: text("trigger_type"),
  triggerEntityRef: text("trigger_entity_ref"),
  status: text("status").notNull().default("open"),
  actionType: text("action_type"),
  actionPayload: jsonb("action_payload"),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  createdAt: ts("created_at"),
}, (t) => [
  uniqueIndex("copilot_insights_trigger_uniq")
    .on(t.triggerType, t.triggerEntityRef),
]);

export const copilotThreadsTable = pgTable("copilot_threads", {
  id: id(),
  title: text("title").notNull(),
  scope: text("scope").notNull(),
  lastMessage: text("last_message").notNull(),
  messageCount: integer("message_count").notNull().default(1),
  updatedAt: ts("updated_at"),
});

export const copilotMessagesTable = pgTable("copilot_messages", {
  id: id(),
  threadId: text("thread_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: ts("created_at"),
});

// Audit log
export const auditLogTable = pgTable("audit_log", {
  id: id(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  summary: text("summary").notNull(),
  at: ts("at"),
});

// Order confirmation & handover
export const orderConfirmationsTable = pgTable("order_confirmations", {
  id: id(),
  dealId: text("deal_id").notNull(),
  contractId: text("contract_id"),
  number: text("number").notNull(),
  status: text("status").notNull(),
  readinessScore: integer("readiness_score").notNull().default(0),
  totalAmount: numeric("total_amount").notNull(),
  currency: text("currency").notNull(),
  expectedDelivery: date("expected_delivery"),
  handoverAt: timestamp("handover_at", { withTimezone: true }),
  salesOwnerId: text("sales_owner_id"),
  onboardingOwnerId: text("onboarding_owner_id"),
  handoverStartedAt: timestamp("handover_started_at", { withTimezone: true }),
  handoverNote: text("handover_note"),
  handoverContact: text("handover_contact"),
  handoverContactEmail: text("handover_contact_email"),
  handoverDeliveryDate: date("handover_delivery_date"),
  handoverCriticalNotes: text("handover_critical_notes"),
  slaDays: integer("sla_days").notNull().default(7),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: ts("created_at"),
});

export const orderConfirmationChecksTable = pgTable("order_confirmation_checks", {
  id: id(),
  orderConfirmationId: text("order_confirmation_id").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull(),
  detail: text("detail"),
  required: boolean("required").notNull().default(true),
});

// Generic entity versions (for contracts, price positions, etc.)
export const entityVersionsTable = pgTable("entity_versions", {
  id: id(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  version: integer("version").notNull(),
  label: text("label").notNull(),
  snapshot: text("snapshot").notNull(),
  actor: text("actor").notNull(),
  comment: text("comment"),
  createdAt: ts("created_at"),
});

// Idempotency cache for POST/PATCH/PUT/DELETE with Idempotency-Key header.
export const idempotencyKeysTable = pgTable("idempotency_keys", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  key: text("key").notNull(),
  route: text("route").notNull(),
  method: text("method").notNull(),
  requestHash: text("request_hash").notNull(),
  statusCode: integer("status_code").notNull(),
  responseBody: jsonb("response_body").notNull(),
  createdAt: ts("created_at"),
}, (t) => ({
  unq: uniqueIndex("idempotency_keys_tenant_user_key_route_idx").on(t.tenantId, t.userId, t.key, t.route, t.method),
}));

// Webhook subscriptions per tenant.
export const webhooksTable = pgTable("webhooks", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  url: text("url").notNull(),
  events: jsonb("events").$type<string[]>().notNull(),
  secret: text("secret").notNull(),
  active: boolean("active").notNull().default(true),
  description: text("description"),
  createdAt: ts("created_at"),
});

// Log of outbound webhook delivery attempts.
export const webhookDeliveriesTable = pgTable("webhook_deliveries", {
  id: id(),
  webhookId: text("webhook_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull(), // queued | success | failed
  attempt: integer("attempt").notNull().default(0),
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  error: text("error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: ts("created_at"),
});

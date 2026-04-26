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
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
  // Tenant-weiter Default für Vertragssprache (de/en). Wird genutzt, wenn weder
  // Brand noch der explizite Body-Wert eine Sprache vorgeben.
  defaultLanguage: text("default_language").notNull().default("de"),
  // Konfiguration für die Klausel-Vorschlags-Pipeline (Task #77).
  // diffThresholdPct: ab welchem Textunterschied (0-100) zur nächstgelegenen
  // Variante eine ad-hoc-Bearbeitung als Vorschlag gequeued wird.
  // repeatThreshold: wie oft eine bereits abgelehnte Variante wieder auftauchen
  // muss, bis sie erneut in die Inbox darf (Spam-Schutz).
  clauseSuggestionConfig: jsonb("clause_suggestion_config")
    .$type<{ diffThresholdPct?: number; repeatThreshold?: number }>()
    .default({})
    .notNull(),
  // Tenant-weiter Default-USt-Satz (in Prozent). Wird angewendet, wenn weder
  // Brand- noch Positions-Override gesetzt ist. Standard 19 (DE).
  defaultTaxRatePct: numeric("default_tax_rate_pct").notNull().default("19"),
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
  // Optional Eltern-Brand für Multi-Tier-Hierarchien
  // (z. B. "Abundance" → "weCREATE", "ReturnSuite").
  parentBrandId: text("parent_brand_id"),
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
  // Default-Vertragssprache für diese Brand (de/en). Wenn null → Tenant-Default.
  defaultLanguage: text("default_language"),
  // Bevorzugter Vertragstyp (FK auf contract_types.id, nullable). Wenn gesetzt
  // und der POST /contracts-Aufruf liefert KEINEN expliziten contractTypeId,
  // wird dieser Wert verwendet (vor der Template-Heuristik). Gibt Brand-Admins
  // damit eine deterministische Vorgabe statt sich auf das Schlagwort-Mapping
  // im Templatenamen verlassen zu müssen.
  // ON DELETE SET NULL spiegelt die Runtime-Semantik (POST /contracts fällt
  // auf die Heuristik zurück, wenn der Vertragstyp inaktiv/weg ist).
  defaultContractTypeId: text("default_contract_type_id")
    .references((): AnyPgColumn => contractTypesTable.id, { onDelete: "set null" }),
  // Brand-Vorlage für die "Per E-Mail senden"-Aktion auf Angeboten.
  // Beide Felder optional: NULL → Fallback-Default aus dem Versand-Endpoint
  // wird verwendet. Platzhalter: {{number}}, {{customer}}, {{brand}}, {{validUntil}}.
  quoteEmailSubjectTemplate: text("quote_email_subject_template"),
  quoteEmailBodyTemplate: text("quote_email_body_template"),
  // Brand-Override für USt-Satz (in Prozent). NULL → Tenant-Default.
  defaultTaxRatePct: numeric("default_tax_rate_pct"),
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
  // Active UI scope (User-Wahl im Header). NULL = "alle erlaubten" (kein Filter).
  // Server intersected aktiver Scope IMMER mit den erlaubten Permissions.
  activeScopeCompanyIds: text("active_scope_company_ids"),
  activeScopeBrandIds: text("active_scope_brand_ids"),
  // Plattform-weite Super-Admin-Berechtigung. Darf neue Mandanten anlegen
  // und Tenant-übergreifende Plattform-Routen aufrufen. KEIN Cross-Tenant-
  // Datenzugriff auf Kunden/Deals/etc. — diese bleiben tenant-isoliert.
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
});

export const rolesTable = pgTable("roles", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  isSystem: boolean("is_system").notNull().default(false),
  tenantId: text("tenant_id").notNull().default("tn_root"),
  // Liste der Permission-Keys (z. B. "deal:write", "approval:approve").
  // Für System-Rollen ist das eine read-only Information; bei Custom-Rollen
  // editierbar. Backend prüft nicht permissions[] direkt, sondern mappt die
  // Rolle des Users auf die Permission-Liste in `routes/dealflow.ts`.
  permissions: jsonb("permissions").$type<string[]>().default([]).notNull(),
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
  // Erweiterte Stammdaten (alle optional). Werden im Detail/Anlage-Dialog
  // gepflegt und können per Web-Anreicherung (Nominatim/Impressum) automatisch
  // vorgeschlagen werden.
  website: text("website"),
  phone: text("phone"),
  billingAddress: text("billing_address"),
  vatId: text("vat_id"),
  sizeBracket: text("size_bracket"), // z. B. "1-10", "11-50", "51-200", ...
  primaryContactId: text("primary_contact_id"),
  // Soft-Delete: gesetzt = archiviert. Standard-Listen blenden archivierte
  // Accounts aus, hartes Löschen ist eine separate Eskalation. So bleiben
  // Datensätze für Audit/Wiederaufnahme erhalten.
  archivedAt: timestamp("archived_at", { withTimezone: true }),
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
  // Sprachfassung des Angebots (de/en). NULL → wird beim Lesen aus
  // Brand-/Tenant-Default abgeleitet.
  language: text("language"),
  // Letzter erfolgreicher E-Mail-Versand an den Kunden. NULL = noch nicht
  // versendet. Nur für UI-Anzeige; einzelne Versuche (auch fehlgeschlagene)
  // landen zusätzlich im audit_log.
  sentAt: timestamp("sent_at", { withTimezone: true }),
  // Komma-getrennte Empfänger-Adressen aus dem letzten erfolgreichen Versand.
  sentTo: text("sent_to"),
  // Optionaler Freitext-Grund, wenn das Angebot abgelehnt wurde.
  // Wird beim Statuswechsel auf 'rejected' am Angebot gespeichert.
  rejectionReason: text("rejection_reason"),
  // Soft-Archive: ungleich NULL → Angebot ist archiviert (aus dem Standard-
  // Listing ausgeblendet, Bulk-Aktion „Archivieren" auf der Quotes-Liste).
  archivedAt: timestamp("archived_at", { withTimezone: true }),
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
  // 'item' (default) → echte Position mit Preis. 'heading' → reine
  // Zwischenüberschrift, die nur die Positionstabelle strukturiert.
  kind: text("kind").notNull().default("item"),
  // Stabile Reihenfolge innerhalb einer quote_version (kleinster Wert zuerst).
  // Bestehende Daten erhalten 0 und werden bei der nächsten Speicherung normalisiert.
  sortOrder: integer("sort_order").notNull().default(0),
  name: text("name").notNull(),
  description: text("description"),
  quantity: numeric("quantity").notNull(),
  unitPrice: numeric("unit_price").notNull(),
  listPrice: numeric("list_price").notNull(),
  discountPct: numeric("discount_pct").notNull(),
  total: numeric("total").notNull(),
  // Positions-USt-Satz in Prozent. NULL → fallback auf Brand- bzw.
  // Tenant-Default. `total` ist immer netto (ohne USt) — Bruttowerte werden
  // serverseitig in der Quote-Antwort als taxSummary aggregiert.
  taxRatePct: numeric("tax_rate_pct"),
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
      taxRatePct?: number | null;
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

// Registry of every object minted via the upload flow, used to verify
// that a client-supplied objectPath was issued to *this* tenant before
// linking it from attachment_library or quote_attachments. Without this
// check, a caller could attach an arbitrary object path (or one leaked
// from another tenant) and gain read access via /storage/objects/*.
export const uploadedObjectsTable = pgTable("uploaded_objects", {
  objectPath: text("object_path").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id"),
  kind: text("kind").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
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

// Bundles: vorgefertigte Pakete von Preispositionen (z. B. "Starter-Plan",
// "Hardware-Bundle XL"). Werden im QuoteWizard mit einem Klick als ganze
// Gruppe ins Angebot übernommen. Tenant-isoliert; optional brand/company-
// scoped (NULL = tenant-weit).
export const pricePositionBundlesTable = pgTable("price_position_bundles", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category"),
  brandId: text("brand_id"),
  companyId: text("company_id"),
  createdAt: ts("created_at"),
});

export const pricePositionBundleItemsTable = pgTable("price_position_bundle_items", {
  id: id(),
  bundleId: text("bundle_id").notNull(),
  pricePositionId: text("price_position_id").notNull(),
  quantity: numeric("quantity").notNull().default("1"),
  customDiscountPct: numeric("custom_discount_pct").notNull().default("0"),
  position: integer("position").notNull().default(0),
});

export const priceRulesTable = pgTable("price_rules", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  scope: text("scope").notNull(),
  condition: text("condition").notNull(),
  effect: text("effect").notNull(),
  priority: integer("priority").notNull(),
  status: text("status").notNull(),
});

// Approvals — single-stage hat decidedBy/decidedAt direkt am Datensatz; bei
// mehrstufigen Approvals bildet `stages` einen Snapshot der Chain ab und
// `currentStageIdx` zeigt auf die aktuell offene Stage. `chainTemplateId`
// referenziert das Template, aus dem der Snapshot gezogen wurde.
export type ApprovalStage = {
  order: number;
  label: string;
  approverRole?: string | null;
  approverUserId?: string | null;
  status: "pending" | "approved" | "rejected" | "skipped";
  decidedBy?: string | null;
  decidedAt?: string | null;
  delegatedFrom?: string | null;
  comment?: string | null;
};

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
  // Multi-Step. Bei leerem stages-Array verhält sich das Approval wie früher
  // (single-stage, decide entscheidet das Ganze).
  chainTemplateId: text("chain_template_id"),
  stages: jsonb("stages").$type<ApprovalStage[]>().notNull().default([]),
  currentStageIdx: integer("current_stage_idx").notNull().default(0),
});

// Chain-Template: definiert, welche Stages für welchen Trigger durchlaufen
// werden. Conditions matchen auf einen Trigger-Payload (z. B. {discountPct: 25}).
export type ApprovalChainCondition = {
  field: string;          // z. B. "discountPct" | "deltaScore" | "valueAmount"
  op: "gt" | "gte" | "lt" | "lte" | "eq";
  value: number | string;
};

export type ApprovalChainStageDef = {
  order: number;
  label: string;
  approverRole?: string | null;
  approverUserId?: string | null;
};

export const approvalChainTemplatesTable = pgTable("approval_chain_templates", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  // Trigger korrespondiert mit approvalsTable.type (z. B. "clause_change",
  // "discount", "amendment_review").
  triggerType: text("trigger_type").notNull(),
  conditions: jsonb("conditions").$type<ApprovalChainCondition[]>().notNull().default([]),
  stages: jsonb("stages").$type<ApprovalChainStageDef[]>().notNull().default([]),
  // Niedriger Wert = höhere Priorität bei Match-Auflösung.
  priority: integer("priority").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at"),
});

// User-Vertretung. Während [validFrom, validUntil] und active=true wird
// `toUserId` zusätzlich als gültiger Approver akzeptiert, sobald `fromUserId`
// die aktuelle Stage entscheiden soll. Der eigentliche Approver bleibt
// weiterhin entscheidungsberechtigt — die Vertretung ergänzt nur.
export const userDelegationsTable = pgTable("user_delegations", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  fromUserId: text("from_user_id").notNull(),
  toUserId: text("to_user_id").notNull(),
  reason: text("reason"),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at"),
}, (t) => ({
  byFromUser: index("user_delegations_from_user_idx").on(t.tenantId, t.fromUserId),
}));

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
  // MVP Phase 1: Multi-Brand/Lifecycle-Felder
  tenantId: text("tenant_id"),
  companyId: text("company_id"),
  brandId: text("brand_id"),
  accountId: text("account_id"),
  contractTypeId: text("contract_type_id"),
  playbookId: text("playbook_id"),
  acceptedQuoteVersionId: text("accepted_quote_version_id"),
  language: text("language"),
  currency: text("currency"),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  autoRenewal: boolean("auto_renewal").default(false),
  renewalNoticeDays: integer("renewal_notice_days"),
  terminationNoticeDays: integer("termination_notice_days"),
  governingLaw: text("governing_law"),
  jurisdiction: text("jurisdiction"),
  riskScore: integer("risk_score"),
  valueAmount: numeric("value_amount", { precision: 18, scale: 2 }),
  valueCurrency: text("value_currency"),
  currentVersion: integer("current_version"),
  openDeviationsCount: integer("open_deviations_count").default(0),
  obligationsCount: integer("obligations_count").default(0),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  // Verweis auf den Vorgänger-Vertrag, wenn dieser Vertrag aus einer Renewal
  // als Folgevertrag erzeugt wurde. Erlaubt 1) das Re-Issue im UI sichtbar
  // zu machen und 2) beim Signieren des Folgevertrags die Renewal automatisch
  // auf "won" zu schalten (siehe POST /renewals/:id/issue-followup).
  predecessorContractId: text("predecessor_contract_id"),
}, (t) => ({
  // Pro Tenant darf jeder Vorvertrag nur EINEN Folgevertrag-Draft haben — sonst
  // gäbe es bei zwei parallelen "Folgevertrag anlegen"-Klicks zwei Drafts und
  // mapRenewal wüsste nicht, welcher der "richtige" ist. Postgres behandelt
  // NULL als distinct, daher konstrainen wir nur effektiv die Folgeverträge.
  predecessorUq: uniqueIndex("contracts_tenant_predecessor_uq")
    .on(t.tenantId, t.predecessorContractId),
}));

export const contractTypesTable = pgTable("contract_types", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  mandatoryClauseFamilyIds: jsonb("mandatory_clause_family_ids").$type<string[]>().notNull().default([]),
  forbiddenClauseFamilyIds: jsonb("forbidden_clause_family_ids").$type<string[]>().notNull().default([]),
  defaultPlaybookId: text("default_playbook_id"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at"),
}, (t) => ({ codeIdx: uniqueIndex("contract_types_tenant_code").on(t.tenantId, t.code) }));

export const contractPlaybooksTable = pgTable("contract_playbooks", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  contractTypeId: text("contract_type_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  brandIds: jsonb("brand_ids").$type<string[]>().notNull().default([]),
  companyIds: jsonb("company_ids").$type<string[]>().notNull().default([]),
  allowedClauseVariantIds: jsonb("allowed_clause_variant_ids").$type<string[]>().notNull().default([]),
  defaultClauseVariantIds: jsonb("default_clause_variant_ids").$type<string[]>().notNull().default([]),
  approvalRules: jsonb("approval_rules").$type<Array<{ trigger: string; threshold?: number; approverRole: string }>>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at"),
});

export const clauseFamiliesTable = pgTable("clause_families", {
  id: id(),
  name: text("name").notNull(),
  description: text("description").notNull(),
});

// CUAD (Contract Understanding Atticus Dataset) — 41 standard clause categories
// for vendor-side gap detection. Tenant-agnostic taxonomy seeded by system.
export const cuadCategoriesTable = pgTable("cuad_categories", {
  id: id(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => ({
  codeIdx: uniqueIndex("cuad_categories_code_uq").on(t.code),
}));

// n:m mapping clause family ↔ CUAD category. Tenant-agnostic (system mapping)
// with optional tenant override row supported by tenantId nullable.
export const clauseFamilyCuadCategoriesTable = pgTable("clause_family_cuad_categories", {
  id: id(),
  tenantId: text("tenant_id"),
  familyId: text("family_id").notNull(),
  cuadCategoryId: text("cuad_category_id").notNull(),
  createdAt: ts("created_at"),
}, (t) => ({
  pairIdx: uniqueIndex("clause_family_cuad_pair_uq").on(t.tenantId, t.familyId, t.cuadCategoryId),
}));

// Per-contract-type expectation that a CUAD category is present.
// requirement: 'expected' (must be there) | 'recommended' (nice to have)
export const contractTypeCuadExpectationsTable = pgTable("contract_type_cuad_expectations", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  contractTypeId: text("contract_type_id").notNull(),
  cuadCategoryId: text("cuad_category_id").notNull(),
  requirement: text("requirement").notNull().default("expected"),
  createdAt: ts("created_at"),
}, (t) => ({
  pairIdx: uniqueIndex("contract_type_cuad_pair_uq").on(t.contractTypeId, t.cuadCategoryId),
}));

export const clauseVariantsTable = pgTable("clause_variants", {
  id: id(),
  familyId: text("family_id").notNull(),
  name: text("name").notNull(),
  severity: text("severity").notNull(),
  severityScore: integer("severity_score").notNull().default(3),
  summary: text("summary").notNull(),
  body: text("body").notNull().default(""),
  tone: text("tone").notNull().default("standard"),
  obligationTemplates: jsonb("obligation_templates").$type<Array<{
    type: string;
    description: string;
    dueOffsetDays?: number;
    recurrence?: "none" | "monthly" | "quarterly" | "annual";
    ownerRole?: string;
  }>>(),
});

// Pro Klausel-Variante existieren ein oder mehrere Sprachfassungen (de/en/…).
// Die Basis-Felder name/summary/body in clauseVariantsTable gelten als
// "Quell-Sprache" (typischerweise DE) und werden hier durch zusätzliche Locales
// ergänzt. Wenn eine Sprachfassung fehlt, fällt die Vertrags-Materialisierung
// auf die Basis-Variante zurück und markiert sie als translationMissing.
export const clauseVariantTranslationsTable = pgTable("clause_variant_translations", {
  id: id(),
  variantId: text("variant_id").notNull(),
  // ISO 639-1 Sprach-Code (de | en). Der Tenant unterstützt aktuell nur de/en.
  locale: text("locale").notNull(),
  name: text("name").notNull(),
  summary: text("summary").notNull(),
  body: text("body").notNull().default(""),
  // Optionaler Quell-/Lizenz-Hinweis pro Sprachfassung
  // (z. B. "bonterms-mutual-2024", "CC-BY-4.0", "Internal").
  source: text("source"),
  license: text("license"),
  sourceUrl: text("source_url"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
}, (t) => ({
  byVariantLocale: uniqueIndex("clause_variant_translations_variant_locale_uq").on(t.variantId, t.locale),
  byLocale: index("clause_variant_translations_locale_idx").on(t.locale),
}));

// Brand-spezifische Overrides einer System-Klausel-Variante (Tonalität, Text, Severity).
// Wenn vorhanden, wird beim Materialisieren eines Vertrags der Brand-Override verwendet.
export const brandClauseVariantOverridesTable = pgTable("brand_clause_variant_overrides", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  brandId: text("brand_id").notNull(),
  baseVariantId: text("base_variant_id").notNull(),
  // Optional: leer = "übernimm Base"
  name: text("name"),
  summary: text("summary"),
  body: text("body"),
  tone: text("tone"),
  severity: text("severity"),
  severityScore: integer("severity_score"),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
}, (t) => ({
  byBrandVariant: uniqueIndex("brand_clause_overrides_brand_variant_uq").on(t.brandId, t.baseVariantId),
  byTenantBrand: index("brand_clause_overrides_tenant_brand_idx").on(t.tenantId, t.brandId),
}));

// Kompatibilitäts-Regeln zwischen Klausel-Varianten:
// kind = 'requires' → Wenn fromVariantId ausgewählt ist, MUSS toVariantId ebenfalls aktiv sein.
// kind = 'conflicts' → fromVariantId und toVariantId dürfen nicht zusammen aktiv sein.
export const clauseVariantCompatibilityTable = pgTable("clause_variant_compatibility", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  fromVariantId: text("from_variant_id").notNull(),
  toVariantId: text("to_variant_id").notNull(),
  kind: text("kind").notNull(),
  note: text("note"),
  createdAt: ts("created_at"),
}, (t) => ({
  byTenantFromTo: uniqueIndex("clause_compat_tenant_from_to_kind_uq").on(t.tenantId, t.fromVariantId, t.toVariantId, t.kind),
  byTenantFrom: index("clause_compat_tenant_from_idx").on(t.tenantId, t.fromVariantId),
}));

export const clauseDeviationsTable = pgTable("clause_deviations", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  contractId: text("contract_id").notNull(),
  clauseId: text("clause_id").notNull(),
  familyId: text("family_id").notNull(),
  deviationType: text("deviation_type").notNull(),
  severity: text("severity").notNull(),
  description: text("description").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  policyId: text("policy_id"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  approvalCaseId: text("approval_case_id"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  resolutionNote: text("resolution_note"),
  createdAt: ts("created_at"),
}, (t) => ({
  contractIdx: index("clause_deviations_contract_idx").on(t.contractId),
  tenantIdx: index("clause_deviations_tenant_idx").on(t.tenantId),
}));

export const obligationsTable = pgTable("obligations", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  contractId: text("contract_id").notNull(),
  brandId: text("brand_id"),
  accountId: text("account_id"),
  clauseId: text("clause_id"),
  type: text("type").notNull(),
  description: text("description").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  recurrence: text("recurrence").notNull().default("none"),
  ownerId: text("owner_id"),
  ownerRole: text("owner_role"),
  status: text("status").notNull().default("pending"),
  source: text("source").notNull().default("derived"),
  escalationDays: integer("escalation_days"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedBy: text("completed_by"),
  createdAt: ts("created_at"),
}, (t) => ({
  contractIdx: index("obligations_contract_idx").on(t.contractId),
  tenantIdx: index("obligations_tenant_idx").on(t.tenantId),
  ownerIdx: index("obligations_owner_idx").on(t.ownerId),
  statusIdx: index("obligations_status_idx").on(t.status),
}));

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
  // Ad-hoc Bearbeitungen direkt am Vertragsslot. Wenn gesetzt, hat dieser Text
  // Vorrang vor dem Variant-Body und triggert ggf. einen Klausel-Vorschlag.
  // (Task #77 — Lernen aus Vertragsarbeit.)
  editedName: text("edited_name"),
  editedSummary: text("edited_summary"),
  editedBody: text("edited_body"),
  editedReason: text("edited_reason"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  editedBy: text("edited_by"),
});

// Klausel-Vorschläge entstehen, wenn während aktiver Vertragsarbeit eine
// Klausel ad-hoc erfasst oder ein Variant-Body deutlich überarbeitet wird.
// Reviewer entscheiden in der Inbox, ob die Vorschläge als neue Variante,
// Ersatz, Übersetzung oder verworfen werden sollen.
export const clauseSuggestionsTable = pgTable("clause_suggestions", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  status: text("status").notNull().default("open"),
  sourceType: text("source_type").notNull(),
  contractId: text("contract_id"),
  contractClauseId: text("contract_clause_id"),
  familyId: text("family_id"),
  baseVariantId: text("base_variant_id"),
  brandId: text("brand_id"),
  proposedName: text("proposed_name").notNull(),
  proposedSummary: text("proposed_summary").notNull(),
  proposedBody: text("proposed_body").notNull(),
  proposedTone: text("proposed_tone"),
  proposedSeverity: text("proposed_severity"),
  diffPct: numeric("diff_pct"),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  contentHash: text("content_hash").notNull(),
  authorId: text("author_id"),
  authorName: text("author_name"),
  firstSeenAt: ts("first_seen_at"),
  lastSeenAt: ts("last_seen_at"),
  decisionAt: timestamp("decision_at", { withTimezone: true }),
  decisionBy: text("decision_by"),
  decisionAction: text("decision_action"),
  decisionNote: text("decision_note"),
  createdVariantId: text("created_variant_id"),
}, (t) => [
  uniqueIndex("clause_suggestions_hash_uniq").on(t.tenantId, t.contentHash),
]);

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
//
// `tenantId` is REQUIRED for every row. Historically the table relied on
// `dealId → deals.companyId → companies.tenantId` for tenant scoping, but
// `dealId` is nullable (e.g. for global system events like "Hardware index
// uplift completed"). Without an explicit tenantId column those rows were
// invisible to every tenant — and any new INSERT site that forgot to set
// a `dealId` could leak across tenants. The column makes isolation a hard
// SQL constraint instead of an application-side filter.
export const timelineEventsTable = pgTable("timeline_events", {
  id: id(),
  // No DB default: every INSERT must provide tenantId explicitly. A missing
  // tenantId fails fast with a NOT NULL violation instead of silently
  // landing in tn_root. Backfill of pre-existing rows ran with the default
  // in place; callers and seed.ts now always set this field explicitly.
  tenantId: text("tenant_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  actor: text("actor").notNull(),
  dealId: text("deal_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
});

// Copilot
//
// `tenantId` is REQUIRED on every copilot row (insights, threads, messages).
// Without it, list endpoints would have to fall back to indirect filtering
// (e.g. dealId membership) which silently leaks "global" or unbound rows
// across tenants. With the column in place every list endpoint filters by
// SQL on tenantId and a second tenant cannot see another tenant's copilot
// state. The default `tn_root` exists only so historical rows from before
// the column was introduced backfill cleanly; every writer in the codebase
// sets tenantId explicitly.
export const copilotInsightsTable = pgTable("copilot_insights", {
  id: id(),
  tenantId: text("tenant_id").notNull().default("tn_root"),
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
  // Tenant-scoped uniqueness: a (triggerType, triggerEntityRef) pair must be
  // unique within a single tenant, never globally — otherwise an AI insight
  // re-run for tenant A could overwrite tenant B's insight if they shared the
  // same entity ref convention. Required for cross-tenant data isolation.
  uniqueIndex("copilot_insights_trigger_uniq")
    .on(t.tenantId, t.triggerType, t.triggerEntityRef),
]);

export const copilotThreadsTable = pgTable("copilot_threads", {
  id: id(),
  tenantId: text("tenant_id").notNull().default("tn_root"),
  title: text("title").notNull(),
  scope: text("scope").notNull(),
  lastMessage: text("last_message").notNull(),
  messageCount: integer("message_count").notNull().default(1),
  updatedAt: ts("updated_at"),
});

export const copilotMessagesTable = pgTable("copilot_messages", {
  id: id(),
  tenantId: text("tenant_id").notNull().default("tn_root"),
  threadId: text("thread_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: ts("created_at"),
});

// Audit log
//
// `tenantId` is REQUIRED for every row. Previously the writer relied on the
// reader to verify each entity belongs to the caller's tenant via
// `entityInScope`, which silently denied access for unknown entity types
// (safe but fragile: a forgotten case in the switch statement quietly hides
// an entire class of rows from everyone). With an explicit tenantId column
// the reader filters by SQL and the writer is forced to set the column at
// every call site.
export const auditLogTable = pgTable("audit_log", {
  id: id(),
  // No DB default: every INSERT must provide tenantId explicitly. A missing
  // tenantId fails fast with a NOT NULL violation instead of silently
  // landing in tn_root. Backfill of pre-existing rows ran with the default
  // in place; writeAudit makes the tenantId parameter required at the type
  // level, so a forgotten call site is a compile error.
  tenantId: text("tenant_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  summary: text("summary").notNull(),
  // Snapshot des aktiven Scopes zum Zeitpunkt der Mutation: JSON
  // {tenantWide:boolean, companyIds:string[]|null, brandIds:string[]|null}
  // null = "keine Einschränkung". Hilft beim Auditieren, mit welcher Sicht
  // eine Aktion ausgeführt wurde.
  activeScopeJson: text("active_scope_json"),
  at: ts("at"),
});

// Order confirmation & handover
export const orderConfirmationsTable = pgTable("order_confirmations", {
  id: id(),
  dealId: text("deal_id").notNull(),
  contractId: text("contract_id"),
  // Quelle: aus welchem Angebot (+ Version) wurde diese Bestätigung erzeugt?
  // NULL für historische OCs (z.B. aus Signatur-Abschluss ohne Angebotsbezug).
  sourceQuoteId: text("source_quote_id"),
  sourceQuoteVersionId: text("source_quote_version_id"),
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

// AI invocations — Audit-Trail für jeden LLM-Roundtrip. Pflicht für
// Auditierbarkeit, Cost-Tracking und Debugging der AI-Layer (siehe
// artifacts/api-server/src/lib/ai/auditLog.ts).
export const aiInvocationsTable = pgTable("ai_invocations", {
  id: id(),
  // Wer hat die Inferenz ausgelöst (users.id).
  actor: text("actor").notNull(),
  // Tenant-Snapshot (Pflicht — verhindert Cross-Tenant-Reporting-Lecks).
  tenantId: text("tenant_id").notNull(),
  // Snapshot des aktiven Scopes zum Zeitpunkt des Aufrufs (vgl. audit_log).
  activeScopeJson: text("active_scope_json"),
  // Stabiler Prompt-Key aus PROMPT_REGISTRY (z. B. "diagnostic.ping").
  promptKey: text("prompt_key").notNull(),
  // Tatsächlich verwendetes Modell (laut Provider-Antwort).
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  // success | validation_error | provider_error | config_error
  status: text("status").notNull(),
  errorClass: text("error_class"),
  errorMessage: text("error_message"),
  // Optionale Bindung an eine Fach-Entität (z. B. "deal" / "ctr_..." ).
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  createdAt: ts("created_at"),
}, (t) => [
  // Audit/Cost-Queries laufen fast immer pro Tenant + Zeitfenster.
  index("ai_invocations_tenant_created_idx").on(t.tenantId, t.createdAt),
  // Kosten-/Latenz-Auswertung pro Prompt über die Zeit.
  index("ai_invocations_prompt_created_idx").on(t.promptKey, t.createdAt),
  // Lookup von "alle Inferenzen für diesen Deal/Vertrag/Quote".
  index("ai_invocations_entity_idx").on(t.entityType, t.entityId),
]);

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

// Saved Views (HubSpot-style Tabs auf Listen-Seiten)
export const savedViewsTable = pgTable("saved_views", {
  id: id(),
  userId: text("user_id").notNull(),
  entityType: text("entity_type").notNull(), // "account" | "deal"
  name: text("name").notNull(),
  filters: jsonb("filters").notNull().default({}),
  columns: jsonb("columns").notNull().default([]),
  sortBy: text("sort_by"),
  sortDir: text("sort_dir"),
  position: integer("position").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  isShared: boolean("is_shared").notNull().default(false),
  tenantId: text("tenant_id").notNull().default("tn_root"),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

// External Contracts: Bestandsvertraege, die nicht ueber DealFlow erstellt
// wurden (vom Vorgaenger-CLM, vom Kunden, vom Anwalt). Persistiert wird die
// Datei in Object-Storage plus die strukturierten Kerndaten (KI-extrahiert
// + ggf. nachkorrigiert). confidenceJson haelt pro Feldname einen 0..1-Wert,
// den die UI als Vertrauensindikator anzeigt.
export const externalContractsTable = pgTable("external_contracts", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  accountId: text("account_id").notNull(),
  brandId: text("brand_id"),
  contractTypeCode: text("contract_type_code"),
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  status: text("status").notNull().default("confirmed"),
  title: text("title").notNull(),
  parties: jsonb("parties").$type<Array<{ role: string; name: string }>>().notNull().default([]),
  currency: text("currency"),
  valueAmount: numeric("value_amount", { precision: 18, scale: 2 }),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  autoRenewal: boolean("auto_renewal").notNull().default(false),
  renewalNoticeDays: integer("renewal_notice_days"),
  terminationNoticeDays: integer("termination_notice_days"),
  governingLaw: text("governing_law"),
  jurisdiction: text("jurisdiction"),
  identifiedClauseFamilies: jsonb("identified_clause_families")
    .$type<Array<{ familyId?: string | null; name: string; confidence: number }>>()
    .notNull()
    .default([]),
  confidenceJson: jsonb("confidence_json")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  aiInvocationId: text("ai_invocation_id"),
  notes: text("notes"),
  uploadedBy: text("uploaded_by"),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
}, (t) => ({
  byTenantAccount: index("external_contracts_tenant_account_idx").on(t.tenantId, t.accountId),
  byTenantBrand: index("external_contracts_tenant_brand_idx").on(t.tenantId, t.brandId),
  byEffectiveTo: index("external_contracts_effective_to_idx").on(t.effectiveTo),
}));

// Renewal-Engine: pro Vertrag, der in den Notice-Korridor wandert, wird
// hier eine Opportunity materialisiert. Stabiler PK pro (contract, dueDate),
// damit der Materialisierungs-Job idempotent bleibt.
export const renewalOpportunitiesTable = pgTable("renewal_opportunities", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  // contractId/externalContractId sind polymorph: genau einer ist gesetzt.
  // contractId zeigt auf einen DealFlow-internen Vertrag, externalContractId
  // auf einen extern hochgeladenen Bestandsvertrag (siehe Task #67).
  contractId: text("contract_id"),
  externalContractId: text("external_contract_id"),
  accountId: text("account_id").notNull(),
  brandId: text("brand_id"),
  // dueDate = Vertrags-effectiveTo (= geplanter Renewal-Stichtag).
  dueDate: date("due_date").notNull(),
  // noticeDeadline = dueDate - renewalNoticeDays (= letzte Frist zum Kündigen).
  noticeDeadline: date("notice_deadline").notNull(),
  riskScore: integer("risk_score").notNull().default(50),
  riskFactors: jsonb("risk_factors")
    .$type<Array<{ key: string; label: string; points: number; detail?: string }>>()
    .notNull()
    .default([]),
  // open|snoozed|won|lost|cancelled
  status: text("status").notNull().default("open"),
  valueAmount: numeric("value_amount", { precision: 18, scale: 2 }),
  currency: text("currency"),
  snoozedUntil: date("snoozed_until"),
  // decidedAt is set only when status transitions to a terminal state
  // (won/lost/cancelled). Nullable on purpose; do not use ts() here.
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decidedBy: text("decided_by"),
  notes: text("notes"),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
}, (t) => ({
  byTenantStatus: index("renewals_tenant_status_idx").on(t.tenantId, t.status),
  // Idempotenz pro Quell-Vertrag — als partielle Indexe, weil immer nur
  // eine der beiden Spalten gesetzt ist.
  byContractDue: uniqueIndex("renewals_contract_due_uq")
    .on(t.contractId, t.dueDate)
    .where(sql`${t.contractId} is not null`),
  byExternalContractDue: uniqueIndex("renewals_ext_contract_due_uq")
    .on(t.externalContractId, t.dueDate)
    .where(sql`${t.externalContractId} is not null`),
  byNoticeDeadline: index("renewals_notice_deadline_idx").on(t.tenantId, t.noticeDeadline),
  byTenantBrand: index("renewals_tenant_brand_idx").on(t.tenantId, t.brandId),
}));

// Klausel-Import (Task #76) — pro hochgeladener Datei wird ein Job angelegt.
// Ein Job hat 0..n Suggestions (= durch die KI segmentierte Klausel-Kandidaten),
// die der Klausel-Editor in der Review-UI per Suggestion einzeln entscheidet
// (accept→Variante anlegen / reject / discard). Der Job dient als Container
// fuer die Datei-Metadaten, das AI-Invocation-Trace und die Audit-Spur.
//
// Status-Flow:
//   extracting       — Datei wurde gerade hochgeladen, Text-Extraktion laeuft
//   processing       — Text liegt vor, AI-Segmentierung laeuft
//   awaiting_review  — Suggestions stehen, Editor muss entscheiden
//   completed        — alle Suggestions entschieden (accept/reject)
//   failed           — Text- oder AI-Fehler; errorMessage erklaert die Ursache
export const clauseImportJobsTable = pgTable("clause_import_jobs", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  // Brand fuer den die Klauseln vorgesehen sind. Optional, weil eine
  // Anwalts-NDA bibliotheksweit verwendbar sein kann.
  brandId: text("brand_id"),
  // Vertrags-Typ-Code aus contractTypesTable.code (z. B. "nda", "msa").
  // Frei-Text-Fallback erlaubt, weil Sprache/Quelle stark variieren kann.
  contractTypeCode: text("contract_type_code"),
  // ISO-639-1 Sprach-Code (de | en). Bestimmt, ob accepted-Suggestions als
  // Basis-Variante (de) oder als Translation auf einer existierenden
  // Variante (en) angelegt werden.
  language: text("language").notNull().default("de"),
  // Optionaler Kurz-Hinweis des Importers
  // (z. B. "Standard-NDA bis 2024 von Kanzlei X geprueft").
  note: text("note"),
  // Datei-Metadaten — analog externalContractsTable.
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  // extracting | processing | awaiting_review | completed | failed
  status: text("status").notNull().default("extracting"),
  // Aggregat-Counts werden bei jeder Suggestion-Entscheidung neu berechnet.
  suggestionCount: integer("suggestion_count").notNull().default(0),
  acceptedCount: integer("accepted_count").notNull().default(0),
  rejectedCount: integer("rejected_count").notNull().default(0),
  pendingCount: integer("pending_count").notNull().default(0),
  // AI-Invocation-Id der Segmentierung (fuer Audit + Replay).
  aiInvocationId: text("ai_invocation_id"),
  // Optional: Anzahl Zeichen im extrahierten Text + ob er gekuerzt wurde
  // (Limit aus extractContractText.ts).
  charCount: integer("char_count"),
  truncated: boolean("truncated").notNull().default(false),
  // Letzte Fehlermeldung (Text-Extraktion oder AI). Nur befuellt, wenn
  // status='failed'. Wird im Frontend als Begruendung angezeigt.
  errorMessage: text("error_message"),
  uploadedBy: text("uploaded_by"),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
}, (t) => ({
  byTenantStatus: index("clause_import_jobs_tenant_status_idx").on(t.tenantId, t.status),
  byTenantCreated: index("clause_import_jobs_tenant_created_idx").on(t.tenantId, t.createdAt),
}));

// Pro Job 0..n Suggestions = ein Klausel-Kandidat aus der Segmentierung.
// Die Suggestion traegt die Roh-Daten (extractedText, vorgeschlagene
// Familie/Variante, Alternativen) UND die spaetere User-Entscheidung
// (accept/reject + ggf. createdVariantId). Damit ist die Importgeschichte
// vollstaendig rekonstruierbar.
export const clauseImportSuggestionsTable = pgTable("clause_import_suggestions", {
  id: id(),
  jobId: text("job_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  // Sortierung im Original-Dokument (von oben nach unten).
  orderIndex: integer("order_index").notNull(),
  // Der von der KI vorgeschlagene Klausel-Name (z. B. "Vertraulichkeit (5J)").
  suggestedName: text("suggested_name").notNull(),
  // Kurz-Zusammenfassung in 1-2 Saetzen, vom Modell.
  suggestedSummary: text("suggested_summary").notNull().default(""),
  // Volltext der Klausel, wie aus dem Dokument extrahiert.
  extractedText: text("extracted_text").notNull(),
  // Heuristisch geschaetzte Seitenzahl im Original-Dokument (1-basiert).
  // Optional, weil PDFs ohne Seiten-Marker nur Text liefern.
  pageHint: integer("page_hint"),
  // Vorgeschlagener Tonfall: zart | moderat | standard | streng | hart.
  suggestedTone: text("suggested_tone").notNull().default("standard"),
  // low | medium | high — Severity-Score wird aus tone abgeleitet, ein
  // separater Score-Wert ist fuer den Initial-Insert nicht noetig.
  suggestedSeverity: text("suggested_severity").notNull().default("medium"),
  // Best-Match aus der bestehenden Familien-Taxonomie (clauseFamiliesTable.id).
  // null = "keine passende Familie gefunden, neue Familie noetig".
  suggestedFamilyId: text("suggested_family_id"),
  suggestedFamilyName: text("suggested_family_name"),
  // Optional: aehnlichste vorhandene Variante (clauseVariantsTable.id),
  // mit Aehnlichkeits-Score 0..1. Wenn vorhanden, schlaegt das Frontend
  // "an existierende Variante anhaengen" vor (z. B. als Translation oder
  // Brand-Override).
  matchedVariantId: text("matched_variant_id"),
  similarityScore: numeric("similarity_score", { precision: 5, scale: 4 }),
  // Bis zu 3 alternative Familien-Vorschlaege mit Konfidenz; werden im
  // Review-UI als Drop-Down angeboten, wenn der Editor den primaeren
  // Vorschlag ablehnt.
  alternativeMatches: jsonb("alternative_matches")
    .$type<Array<{ familyId: string; familyName: string; confidence: number }>>()
    .notNull()
    .default([]),
  // pending_review | accepted | rejected
  status: text("status").notNull().default("pending_review"),
  // Wenn akzeptiert: id der entstandenen Klausel-Variante
  // (oder, bei language!='de', der Translation-id, dann ist
  // createdVariantId die Parent-Variant-id).
  createdVariantId: text("created_variant_id"),
  createdTranslationId: text("created_translation_id"),
  decisionNote: text("decision_note"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
}, (t) => ({
  byJobOrder: index("clause_import_suggestions_job_order_idx").on(t.jobId, t.orderIndex),
  byTenantStatus: index("clause_import_suggestions_tenant_status_idx").on(t.tenantId, t.status),
}));

// Magic-Link-Zugang fuer externe Anwaelte/Berater. Pro Vertrag werden ein
// oder mehrere Collaborator-Datensaetze angelegt, jeder mit einem eigenen
// gehashten Token (Plaintext nur 1x bei Erstellung zurueck), Capabilities
// (view / comment / edit_fields / sign_party), Ablaufdatum (max. 30 Tage)
// und optionaler IP-Allowlist. Revoke setzt revokedAt; Token-Lookups muessen
// revokedAt + expiresAt + ggfs. ipAllowlist pruefen.
export const externalCollaboratorsTable = pgTable("external_collaborators", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  contractId: text("contract_id").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  organization: text("organization"),
  capabilities: jsonb("capabilities").$type<string[]>().notNull().default([]),
  // Wenn capabilities `edit_fields` enthaelt: Liste der erlaubten Vertrags-
  // Felder (z.B. ["effectiveFrom","effectiveTo","jurisdiction","governingLaw"]).
  // Andere Felder bleiben fuer den Magic-Link-Inhaber strikt read-only.
  editableFields: jsonb("editable_fields").$type<string[]>().notNull().default([]),
  // Optionale IP-Allowlist. Leer/[] = keine Einschraenkung. Eintraege koennen
  // einzelne IPs (v4/v6) oder CIDR-Blocks sein (z.B. "203.0.113.0/24").
  // Treffer-Pruefung erfolgt bei jedem Token-Aufruf gegen req.ip.
  ipAllowlist: jsonb("ip_allowlist").$type<string[]>().notNull().default([]),
  // sha256(plaintext) — Plaintext nie speichern, beim Erstellen 1x als
  // tokenPlaintext zurueckgegeben.
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: text("revoked_by"),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at"),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => ({
  byTenantContract: index("external_collab_tenant_contract_idx").on(t.tenantId, t.contractId),
  byContractEmail: uniqueIndex("external_collab_contract_email_uq").on(t.contractId, t.email),
  byTokenHash: uniqueIndex("external_collab_token_hash_uq").on(t.tokenHash),
}));

// Audit-Trail fuer jede Magic-Link-Aktion (view, comment, revoke, ...).
// Wird sowohl auf der Tenant-Seite (Aktivitaeten-Card) als auch im
// globalen audit-log gelesen.
export const externalCollaboratorEventsTable = pgTable("external_collaborator_events", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  collaboratorId: text("collaborator_id").notNull(),
  contractId: text("contract_id").notNull(),
  // 'created' | 'viewed' | 'commented' | 'revoked' | 'expired_attempt'
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at"),
}, (t) => ({
  byTenantContract: index("external_collab_events_tenant_contract_idx").on(t.tenantId, t.contractId),
  byCollaborator: index("external_collab_events_collab_idx").on(t.collaboratorId),
}));

// Vertrags-Kommentare. Werden sowohl von internen Usern als auch von
// externen Collaboratoren (mit comment-Capability) geschrieben.
export const contractCommentsTable = pgTable("contract_comments", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  contractId: text("contract_id").notNull(),
  // 'user' fuer interne Tenant-User, 'external' fuer Magic-Link-Collaborator
  authorType: text("author_type").notNull(),
  authorUserId: text("author_user_id"),
  externalCollaboratorId: text("external_collaborator_id"),
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  // Optional: Kommentar haengt an einer bestimmten Klausel-Zeile.
  contractClauseId: text("contract_clause_id"),
  createdAt: ts("created_at"),
}, (t) => ({
  byTenantContract: index("contract_comments_tenant_contract_idx").on(t.tenantId, t.contractId),
  byContractCreated: index("contract_comments_contract_created_idx").on(t.contractId, t.createdAt),
}));

// =============================================================================
// AI-Empfehlungen mit Vertrauensanzeige + Lerneffekt (Task #69)
// =============================================================================
// Persistiert jede AI-Empfehlung (z. B. Copilot-Suggestion, Klausel-Vorschlag)
// inkl. Konfidenz-Score und User-Entscheidung. Wird als Lern-Signal fuer:
//  - Acceptance-Rate pro promptKey (Admin-Dashboard "KI-Vertrauensgenauigkeit")
//  - Konfidenz-Kalibrierung (Bucket 0-25/25-50/50-75/75-100 % vs. acceptance)
//  - Audit + Replay (suggestionJson erlaubt nachtraegliches Anzeigen)
// genutzt. Tenant-isoliert; entityType/entityId binden die Empfehlung an die
// fachliche Entitaet (z. B. "deal" / "contract").
export const aiRecommendationsTable = pgTable("ai_recommendations", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  // Stabiler Prompt-Key aus PROMPT_REGISTRY (z. B. "copilot.next_step").
  promptKey: text("prompt_key").notNull(),
  // Optionales Binding an die Fach-Entitaet, fuer die der Vorschlag gedacht ist.
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  // Roh-Vorschlag des Modells (string/object/array, je nach Prompt).
  suggestion: jsonb("suggestion").$type<unknown>().notNull(),
  // Konfidenz 0.000 - 1.000. Modell-eigene oder kalibrierte Schaetzung.
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
  // pending | accepted | rejected | modified
  status: text("status").notNull().default("pending"),
  // Bei status=modified: tatsaechlich uebernommener (vom User editierter) Vorschlag.
  modifiedSuggestion: jsonb("modified_suggestion").$type<unknown>(),
  // Optionales Freitext-Feedback (max 2000 chars, app-seitig validiert).
  feedbackText: text("feedback_text"),
  // Wer hat entschieden (users.id) und wann.
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  // Verbindung zur konkreten LLM-Inferenz (ai_invocations.id) — optional,
  // damit recordRecommendation auch ohne Audit-Eintrag nutzbar bleibt.
  aiInvocationId: text("ai_invocation_id"),
  createdAt: ts("created_at"),
}, (t) => [
  // Reporting/Listing pro Tenant + Prompt + Zeitfenster.
  index("ai_recommendations_tenant_prompt_idx").on(t.tenantId, t.promptKey, t.createdAt),
  // "Empfehlungen fuer diese Entity" (z. B. Copilot-Panel im Deal).
  index("ai_recommendations_entity_idx").on(t.tenantId, t.entityType, t.entityId, t.createdAt),
  // Status-Filter im Admin-Dashboard / Metrics.
  index("ai_recommendations_tenant_status_idx").on(t.tenantId, t.status),
]);

// Anonymisierter Lerneffekt-Datensatz pro KI-Entscheidung (Task #69).
// Im Gegensatz zu `ai_recommendations` enthaelt diese Tabelle KEINE
// Verbindung zum entscheidenden User und KEINEN modifiziert/Roh-Vorschlag,
// sondern nur die Telemetrie, die wir fuer das Trainings-/Tuning-Backlog
// brauchen: prompt_key, model, outcome, Konfidenz, ob Begruendung erfasst
// wurde. Tenant-Scope bleibt fuer das Reporting erhalten — wir vermeiden
// Cross-Tenant-Lecks, koennen aber nicht "User X mochte Vorschlag Y" zurueck
// rekonstruieren.
export const aiFeedbackTable = pgTable("ai_feedback", {
  id: id(),
  tenantId: text("tenant_id").notNull(),
  promptKey: text("prompt_key").notNull(),
  // Kanonischer Modellname (z. B. "gpt-4o-2024-08-06"), aus ai_invocations
  // gespiegelt — null wenn keine Inferenz-Zeile verknuepft war.
  modelName: text("model_name"),
  // accepted | rejected | modified
  outcome: text("outcome").notNull(),
  // 0..1 Konfidenz, mit der die KI den Vorschlag ausgegeben hat.
  confidence: numeric("confidence", { precision: 4, scale: 3 }),
  // Hat der User Freitext-Begruendung gegeben? (Kein Inhalt — nur Flag.)
  hasFeedbackText: boolean("has_feedback_text").notNull().default(false),
  // Soft-Link auf ai_recommendations.id (kein FK, weil ai_recommendations
  // nach Aufbewahrungsfrist geloescht werden darf, ai_feedback bleibt).
  recommendationId: text("recommendation_id"),
  createdAt: ts("created_at"),
}, (t) => [
  index("ai_feedback_tenant_prompt_idx").on(t.tenantId, t.promptKey, t.createdAt),
  index("ai_feedback_tenant_outcome_idx").on(t.tenantId, t.outcome),
]);

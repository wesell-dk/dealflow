/**
 * AI Context Assembly Layer
 *
 * Baut für jede Domäne (Deal, Contract, Quote) einen typisierten,
 * scope-validierten Snapshot, der direkt als `input` an einen Prompt
 * übergeben werden kann.
 *
 * Sicherheitsregel (Spec): „Es darf niemals Kontext aus nicht berechtigten
 * Companies oder Brands in die AI gelangen. Rechte gelten auch für AI."
 *
 *   - Jeder Builder ruft zuerst `entityScopeStatus(req, type, id)`.
 *   - "missing"   → wirft NotInScopeError("missing")    → Route mappt 404
 *   - "forbidden" → wirft NotInScopeError("forbidden")  → Route mappt 403
 *   - "ok"        → DB-Loads + Rückgabe
 *
 *   - Builder lädt NUR Daten innerhalb derselben Tenant-/Company-/Brand-
 *     Grenze wie die Wurzel-Entität. Es werden bewusst keine "ähnliche
 *     Deals"- oder "andere Kunden"-Aggregate geladen, weil das Scope-Lecks
 *     erlauben würde.
 *
 *   - Geld- und Datumsfelder werden zu primitiven Strings/Numbers normalisiert,
 *     damit der Prompt-Layer sie deterministisch in den User-Text einbauen
 *     kann (Anthropic mag keine ISO-Date-Objekte in JSON).
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  accountsTable,
  approvalsTable,
  brandsTable,
  companiesTable,
  contactsTable,
  contractsTable,
  contractClausesTable,
  dealsTable,
  lineItemsTable,
  pricePositionsTable,
  quoteVersionsTable,
  quotesTable,
  timelineEventsTable,
  type usersTable,
} from "@workspace/db";
import type { Request } from "express";
import { entityScopeStatus, getScope } from "../scope.js";

// ───────────────────────── Errors ─────────────────────────

export class NotInScopeError extends Error {
  constructor(
    public readonly status: "missing" | "forbidden",
    public readonly entityType: string,
    public readonly entityId: string,
  ) {
    super(
      `${entityType} "${entityId}" ${status === "missing" ? "not found" : "out of scope"}`,
    );
    this.name = "NotInScopeError";
  }
}

// ───────────────────────── Shared types ─────────────────────────

interface CompanyRef {
  id: string;
  name: string;
  legalName: string;
  country: string;
  currency: string;
}

interface BrandRef {
  id: string;
  name: string;
  voice: string;
  tone: string | null;
  legalEntityName: string | null;
}

interface AccountRef {
  id: string;
  name: string;
  industry: string;
  country: string;
  healthScore: number;
  decisionMakers: Array<{ name: string; role: string }>;
}

interface DealRef {
  id: string;
  name: string;
  stage: string;
  value: string;
  currency: string;
  probability: number;
  riskLevel: string;
  expectedCloseDate: string;
  nextStep: string | null;
  ownerName: string | null;
}

interface QuoteVersionSummary {
  id: string;
  version: number;
  totalAmount: string;
  discountPct: string;
  marginPct: string;
  status: string;
  notes: string | null;
}

interface LineItemSummary {
  name: string;
  quantity: string;
  unitPrice: string;
  listPrice: string;
  discountPct: string;
  total: string;
}

interface ContractClauseSummary {
  family: string;
  variant: string;
  severity: string;
  summary: string;
  activeVariantId: string | null;
}

interface ApprovalSummary {
  id: string;
  type: string;
  status: string;
  priority: string;
  reason: string;
  impactValue: string;
  currency: string;
  decidedAt: string | null;
  decisionComment: string | null;
}

interface TimelineEntry {
  type: string;
  title: string;
  description: string;
  at: string;
}

// Public context shapes — diese gehen 1:1 in die Prompts.

export interface DealContext {
  deal: DealRef;
  account: AccountRef;
  company: CompanyRef;
  brand: BrandRef;
  activeQuote: {
    id: string;
    number: string;
    status: string;
    currency: string;
    validUntil: string;
    currentVersion: QuoteVersionSummary | null;
    lineItems: LineItemSummary[];
  } | null;
  openApprovals: ApprovalSummary[];
  contracts: Array<{
    id: string;
    title: string;
    status: string;
    version: number;
    riskLevel: string;
  }>;
  timeline: TimelineEntry[];
}

export interface QuoteContext {
  quote: {
    id: string;
    number: string;
    status: string;
    currency: string;
    validUntil: string;
    currentVersion: number;
  };
  versions: QuoteVersionSummary[];
  activeVersion: QuoteVersionSummary | null;
  lineItems: LineItemSummary[];
  pricePositions: Array<{
    sku: string;
    name: string;
    listPrice: string;
    currency: string;
    isStandard: boolean;
  }>;
  deal: DealRef;
  account: AccountRef;
  brand: BrandRef;
  openApprovals: ApprovalSummary[];
}

export interface ContractContext {
  contract: {
    id: string;
    title: string;
    status: string;
    version: number;
    riskLevel: string;
    template: string;
    validUntil: string | null;
  };
  clauses: ContractClauseSummary[];
  deal: DealRef;
  account: AccountRef;
  brand: BrandRef;
  relatedQuote: {
    id: string;
    number: string;
    status: string;
    totalAmount: string | null;
    discountPct: string | null;
  } | null;
  openApprovals: ApprovalSummary[];
}

export interface ApprovalContext {
  approval: ApprovalSummary;
  deal: DealRef;
  account: AccountRef;
  brand: BrandRef;
  relatedQuoteVersion: QuoteVersionSummary | null;
  contract: {
    id: string;
    title: string;
    status: string;
    riskLevel: string;
  } | null;
}

// ───────────────────────── Helpers ─────────────────────────

type User = typeof usersTable.$inferSelect;

async function loadDealRef(dealId: string): Promise<DealRef | null> {
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
  if (!d) return null;
  return {
    id: d.id,
    name: d.name,
    stage: d.stage,
    value: String(d.value),
    currency: d.currency,
    probability: d.probability,
    riskLevel: d.riskLevel,
    expectedCloseDate: String(d.expectedCloseDate),
    nextStep: d.nextStep,
    ownerName: null,
  };
}

async function loadAccount(accountId: string): Promise<AccountRef | null> {
  const [a] = await db.select().from(accountsTable).where(eq(accountsTable.id, accountId));
  if (!a) return null;
  const dms = await db
    .select({ name: contactsTable.name, role: contactsTable.role })
    .from(contactsTable)
    .where(
      and(
        eq(contactsTable.accountId, a.id),
        eq(contactsTable.isDecisionMaker, true),
      ),
    );
  return {
    id: a.id,
    name: a.name,
    industry: a.industry,
    country: a.country,
    healthScore: a.healthScore,
    decisionMakers: dms.map((c) => ({ name: c.name, role: c.role })),
  };
}

async function loadCompany(companyId: string): Promise<CompanyRef | null> {
  const [c] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    legalName: c.legalName,
    country: c.country,
    currency: c.currency,
  };
}

async function loadBrand(brandId: string): Promise<BrandRef | null> {
  const [b] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
  if (!b) return null;
  return {
    id: b.id,
    name: b.name,
    voice: b.voice,
    tone: b.tone,
    legalEntityName: b.legalEntityName,
  };
}

function quoteVersionSummary(
  v: typeof quoteVersionsTable.$inferSelect,
): QuoteVersionSummary {
  return {
    id: v.id,
    version: v.version,
    totalAmount: String(v.totalAmount),
    discountPct: String(v.discountPct),
    marginPct: String(v.marginPct),
    status: v.status,
    notes: v.notes,
  };
}

function lineItemSummary(
  li: typeof lineItemsTable.$inferSelect,
): LineItemSummary {
  return {
    name: li.name,
    quantity: String(li.quantity),
    unitPrice: String(li.unitPrice),
    listPrice: String(li.listPrice),
    discountPct: String(li.discountPct),
    total: String(li.total),
  };
}

function approvalSummary(
  a: typeof approvalsTable.$inferSelect,
): ApprovalSummary {
  return {
    id: a.id,
    type: a.type,
    status: a.status,
    priority: a.priority,
    reason: a.reason,
    impactValue: String(a.impactValue),
    currency: a.currency,
    decidedAt: a.decidedAt ? a.decidedAt.toISOString() : null,
    decisionComment: a.decisionComment,
  };
}

async function ensureScope(
  req: Request,
  user: User,
  entityType: string,
  entityId: string,
): Promise<void> {
  void user;
  const status = await entityScopeStatus(req, entityType, entityId);
  if (status === "missing") throw new NotInScopeError("missing", entityType, entityId);
  if (status === "forbidden") throw new NotInScopeError("forbidden", entityType, entityId);
}

// ───────────────────────── Public builders ─────────────────────────

export async function buildDealContext(
  req: Request,
  dealId: string,
): Promise<DealContext> {
  const scope = getScope(req);
  await ensureScope(req, scope.user, "deal", dealId);

  const deal = await loadDealRef(dealId);
  if (!deal) throw new NotInScopeError("missing", "deal", dealId);
  // Wir wissen aus entityScopeStatus, dass die Wurzel-Entität in-scope ist.
  // Account/Company/Brand sind durch das Datenmodell an den Deal gebunden,
  // d.h. wenn der Deal in-scope ist, sind seine Stammdaten ebenfalls in-scope.
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, dealId));
  const [account, company, brand] = await Promise.all([
    loadAccount(d!.accountId),
    loadCompany(d!.companyId),
    loadBrand(d!.brandId),
  ]);
  if (!account || !company || !brand) {
    throw new NotInScopeError("missing", "deal", dealId);
  }

  // Aktuelles Quote (höchste Version, status != 'cancelled' bevorzugt) — wir
  // nehmen das jüngste pro Deal.
  const quoteRows = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.dealId, dealId))
    .orderBy(desc(quotesTable.createdAt));
  const activeQuoteRow = quoteRows[0] ?? null;

  let activeQuote: DealContext["activeQuote"] = null;
  if (activeQuoteRow) {
    const [vRow] = await db
      .select()
      .from(quoteVersionsTable)
      .where(
        and(
          eq(quoteVersionsTable.quoteId, activeQuoteRow.id),
          eq(quoteVersionsTable.version, activeQuoteRow.currentVersion),
        ),
      );
    let lineItems: LineItemSummary[] = [];
    if (vRow) {
      const lis = await db
        .select()
        .from(lineItemsTable)
        .where(eq(lineItemsTable.quoteVersionId, vRow.id));
      lineItems = lis.map(lineItemSummary);
    }
    activeQuote = {
      id: activeQuoteRow.id,
      number: activeQuoteRow.number,
      status: activeQuoteRow.status,
      currency: activeQuoteRow.currency,
      validUntil: String(activeQuoteRow.validUntil),
      currentVersion: vRow ? quoteVersionSummary(vRow) : null,
      lineItems,
    };
  }

  const apprRows = await db
    .select()
    .from(approvalsTable)
    .where(
      and(
        eq(approvalsTable.dealId, dealId),
        inArray(approvalsTable.status, ["pending", "in_review", "open"]),
      ),
    )
    .orderBy(desc(approvalsTable.createdAt));

  const contractRows = await db
    .select()
    .from(contractsTable)
    .where(eq(contractsTable.dealId, dealId))
    .orderBy(desc(contractsTable.createdAt));

  const tlRows = await db
    .select()
    .from(timelineEventsTable)
    .where(eq(timelineEventsTable.dealId, dealId))
    .orderBy(desc(timelineEventsTable.at))
    .limit(20);

  return {
    deal,
    account,
    company,
    brand,
    activeQuote,
    openApprovals: apprRows.map(approvalSummary),
    contracts: contractRows.map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      version: c.version,
      riskLevel: c.riskLevel,
    })),
    timeline: tlRows.map((t) => ({
      type: t.type,
      title: t.title,
      description: t.description,
      at: t.at.toISOString(),
    })),
  };
}

export async function buildQuoteContext(
  req: Request,
  quoteId: string,
): Promise<QuoteContext> {
  const scope = getScope(req);
  await ensureScope(req, scope.user, "quote", quoteId);

  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, quoteId));
  if (!q) throw new NotInScopeError("missing", "quote", quoteId);

  // Deal liegt in-scope, weil entityScopeStatus("quote") über deal-id prüft.
  const deal = await loadDealRef(q.dealId);
  if (!deal) throw new NotInScopeError("missing", "quote", quoteId);
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, q.dealId));
  const [account, brand] = await Promise.all([
    loadAccount(d!.accountId),
    loadBrand(d!.brandId),
  ]);
  if (!account || !brand) throw new NotInScopeError("missing", "quote", quoteId);

  const versionRows = await db
    .select()
    .from(quoteVersionsTable)
    .where(eq(quoteVersionsTable.quoteId, q.id))
    .orderBy(asc(quoteVersionsTable.version));
  const versions = versionRows.map(quoteVersionSummary);
  const activeVersion = versions.find((v) => v.version === q.currentVersion) ?? null;

  let lineItems: LineItemSummary[] = [];
  const activeVersionRow = versionRows.find((v) => v.version === q.currentVersion);
  if (activeVersionRow) {
    const lis = await db
      .select()
      .from(lineItemsTable)
      .where(eq(lineItemsTable.quoteVersionId, activeVersionRow.id));
    lineItems = lis.map(lineItemSummary);
  }

  // Preispositionen aus derselben Brand+Company — same-tenant garantiert,
  // weil brand+company aus dem Deal kommen und der Deal in-scope ist.
  const positions = await db
    .select()
    .from(pricePositionsTable)
    .where(
      and(
        eq(pricePositionsTable.brandId, d!.brandId),
        eq(pricePositionsTable.companyId, d!.companyId),
      ),
    )
    .limit(20);

  const apprRows = await db
    .select()
    .from(approvalsTable)
    .where(
      and(
        eq(approvalsTable.dealId, q.dealId),
        inArray(approvalsTable.status, ["pending", "in_review", "open"]),
      ),
    );

  return {
    quote: {
      id: q.id,
      number: q.number,
      status: q.status,
      currency: q.currency,
      validUntil: String(q.validUntil),
      currentVersion: q.currentVersion,
    },
    versions,
    activeVersion,
    lineItems,
    pricePositions: positions.map((p) => ({
      sku: p.sku,
      name: p.name,
      listPrice: String(p.listPrice),
      currency: p.currency,
      isStandard: p.isStandard,
    })),
    deal,
    account,
    brand,
    openApprovals: apprRows.map(approvalSummary),
  };
}

export async function buildContractContext(
  req: Request,
  contractId: string,
): Promise<ContractContext> {
  const scope = getScope(req);
  await ensureScope(req, scope.user, "contract", contractId);

  const [c] = await db
    .select()
    .from(contractsTable)
    .where(eq(contractsTable.id, contractId));
  if (!c) throw new NotInScopeError("missing", "contract", contractId);

  const deal = await loadDealRef(c.dealId);
  if (!deal) throw new NotInScopeError("missing", "contract", contractId);
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, c.dealId));
  const [account, brand] = await Promise.all([
    loadAccount(d!.accountId),
    loadBrand(d!.brandId),
  ]);
  if (!account || !brand) throw new NotInScopeError("missing", "contract", contractId);

  const clauseRows = await db
    .select()
    .from(contractClausesTable)
    .where(eq(contractClausesTable.contractId, c.id));
  const clauses: ContractClauseSummary[] = clauseRows.map((cl) => ({
    family: cl.family,
    variant: cl.variant,
    severity: cl.severity,
    summary: cl.summary,
    activeVariantId: cl.activeVariantId,
  }));

  const [relatedQuoteRow] = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.dealId, c.dealId))
    .orderBy(desc(quotesTable.createdAt))
    .limit(1);
  let relatedQuote: ContractContext["relatedQuote"] = null;
  if (relatedQuoteRow) {
    const [vRow] = await db
      .select()
      .from(quoteVersionsTable)
      .where(
        and(
          eq(quoteVersionsTable.quoteId, relatedQuoteRow.id),
          eq(quoteVersionsTable.version, relatedQuoteRow.currentVersion),
        ),
      );
    relatedQuote = {
      id: relatedQuoteRow.id,
      number: relatedQuoteRow.number,
      status: relatedQuoteRow.status,
      totalAmount: vRow ? String(vRow.totalAmount) : null,
      discountPct: vRow ? String(vRow.discountPct) : null,
    };
  }

  const apprRows = await db
    .select()
    .from(approvalsTable)
    .where(
      and(
        eq(approvalsTable.dealId, c.dealId),
        inArray(approvalsTable.status, ["pending", "in_review", "open"]),
      ),
    );

  return {
    contract: {
      id: c.id,
      title: c.title,
      status: c.status,
      version: c.version,
      riskLevel: c.riskLevel,
      template: c.template,
      validUntil: c.validUntil ? String(c.validUntil) : null,
    },
    clauses,
    deal,
    account,
    brand,
    relatedQuote,
    openApprovals: apprRows.map(approvalSummary),
  };
}

export async function buildApprovalContext(
  req: Request,
  approvalId: string,
): Promise<ApprovalContext> {
  const scope = getScope(req);
  await ensureScope(req, scope.user, "approval", approvalId);

  const [a] = await db
    .select()
    .from(approvalsTable)
    .where(eq(approvalsTable.id, approvalId));
  if (!a) throw new NotInScopeError("missing", "approval", approvalId);

  const deal = await loadDealRef(a.dealId);
  if (!deal) throw new NotInScopeError("missing", "approval", approvalId);
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, a.dealId));
  const [account, brand] = await Promise.all([
    loadAccount(d!.accountId),
    loadBrand(d!.brandId),
  ]);
  if (!account || !brand) throw new NotInScopeError("missing", "approval", approvalId);

  // Heuristik: jüngste Quote-Version desselben Deals — typisch der Anlass
  // einer Pricing-/Discount-Approval.
  const [recentQuoteRow] = await db
    .select()
    .from(quotesTable)
    .where(eq(quotesTable.dealId, a.dealId))
    .orderBy(desc(quotesTable.createdAt))
    .limit(1);
  let relatedQuoteVersion: QuoteVersionSummary | null = null;
  if (recentQuoteRow) {
    const [v] = await db
      .select()
      .from(quoteVersionsTable)
      .where(
        and(
          eq(quoteVersionsTable.quoteId, recentQuoteRow.id),
          eq(quoteVersionsTable.version, recentQuoteRow.currentVersion),
        ),
      );
    if (v) relatedQuoteVersion = quoteVersionSummary(v);
  }

  const [contractRow] = await db
    .select()
    .from(contractsTable)
    .where(eq(contractsTable.dealId, a.dealId))
    .orderBy(desc(contractsTable.createdAt))
    .limit(1);

  void scope;

  return {
    approval: approvalSummary(a),
    deal,
    account,
    brand,
    relatedQuoteVersion,
    contract: contractRow
      ? {
          id: contractRow.id,
          title: contractRow.title,
          status: contractRow.status,
          riskLevel: contractRow.riskLevel,
        }
      : null,
  };
}

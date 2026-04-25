import { Router, type IRouter, type Request, type Response } from 'express';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { randomUUID, randomBytes } from 'node:crypto';
import { ObjectStorageService } from '../lib/objectStorage';
import { extractTextFromUpload } from '../lib/extractContractText';
import { validateInline } from '../middlewares/validate';
import * as Z from '@workspace/api-zod';
import { z } from 'zod';

async function resolveLogoForPdf(logoUrl: string | null | undefined): Promise<string | null> {
  if (!logoUrl) return null;
  const m = logoUrl.match(/^(?:\/api)?\/storage\/objects\/(.+)$/) ?? logoUrl.match(/^\/objects\/(.+)$/);
  if (!m) return logoUrl;
  try {
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(`/objects/${m[1]}`);
    const [buf] = await file.download();
    const [meta] = await file.getMetadata();
    const ct = (meta?.contentType as string | undefined) ?? 'image/png';
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
import {
  allowedAccountIds,
  allowedBrandIds,
  allowedCompanyIds,
  allowedDealIds,
  dealScopeSql,
  dealsWhereSql,
  getScope,
  isAccountAllowed,
  entityInScope,
  entityScopeStatus,
  copilotThreadVisible,
  permittedCompanyIds,
  permittedBrandIds,
  hasActiveScopeFilter,
  activeScopeSnapshot,
} from '../lib/scope';
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
  pricePositionBundlesTable,
  pricePositionBundleItemsTable,
  priceRulesTable,
  approvalsTable,
  approvalChainTemplatesTable,
  userDelegationsTable,
  type ApprovalStage,
  type ApprovalChainCondition,
  type ApprovalChainStageDef,
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
  contractAmendmentsTable,
  amendmentClausesTable,
  contractTypesTable,
  contractPlaybooksTable,
  obligationsTable,
  clauseDeviationsTable,
  rolesTable,
  quoteTemplatesTable,
  quoteTemplateSectionsTable,
  attachmentLibraryTable,
  quoteAttachmentsTable,
  industryProfilesTable,
  uploadedObjectsTable,
  savedViewsTable,
  externalContractsTable,
  renewalOpportunitiesTable,
  brandClauseVariantOverridesTable,
  clauseVariantTranslationsTable,
  clauseVariantCompatibilityTable,
  externalCollaboratorsTable,
  aiRecommendationsTable,
  externalCollaboratorEventsTable,
  contractCommentsTable,
} from '@workspace/db';
import { createHash } from 'node:crypto';
import {
  generatePriceRejectionForReaction,
  generateHighDiscountForApproval,
  generateStaleLetterForLetter,
  generateLowMarginForQuoteVersion,
  resolveInsightsFor,
} from '../insights/generators';
import {
  exportSubjectZip,
  forgetSubject,
  logPiiAccess,
  runRetentionSweep,
  runRetentionSweepForTenant,
} from '../gdpr/service';
import {
  subjectsDeletionLogTable,
  accessLogTable,
  webhooksTable,
  webhookDeliveriesTable,
} from '@workspace/db';
import { emitEvent, WEBHOOK_EVENTS, assertSafeWebhookUrl, assertSafeResolvedUrl } from '../lib/webhooks';
import { parseAsOf, resolveSnapshot, isInvalidAsOf } from '../lib/asOf';
import { runStructured, isAIConfigured, AIOrchestrationError } from '../lib/ai';
import { recordRecommendation, clampConfidence } from '../lib/ai/recommendations.js';
import type { HelpAssistantInput } from '../lib/ai/prompts/dealflow';
import { runAgent, type AgentTrace } from '../lib/ai/agent.js';
import { HELP_BOT_TOOLS_AS_AGENT_TOOLS } from '../lib/ai/tools/dealflowAgent.js';
import {
  buildDealContext,
  buildQuoteContext,
  buildContractContext,
  buildApprovalContext,
  NotInScopeError,
  type DealContext,
  type QuoteContext,
  type ContractContext,
  type ApprovalContext,
} from '../lib/ai/context';

const router: IRouter = Router();

const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const iso = (d: Date | string | null | undefined) =>
  d == null ? null : (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

// Helpers to map joined data
async function getUserMap(tenantId?: string) {
  const list = tenantId
    ? await db.select().from(usersTable).where(eq(usersTable.tenantId, tenantId))
    : await db.select().from(usersTable);
  return new Map(list.map(u => [u.id, u]));
}
async function getAccountMap() {
  const list = await db.select().from(accountsTable);
  return new Map(list.map(a => [a.id, a]));
}
async function getBrandMap() {
  const list = await db.select().from(brandsTable);
  return new Map(list.map(b => [b.id, b]));
}
async function getCompanyMap() {
  const list = await db.select().from(companiesTable);
  return new Map(list.map(c => [c.id, c]));
}
async function getDealMap() {
  const list = await db.select().from(dealsTable);
  return new Map(list.map(d => [d.id, d]));
}

const stageLabels: Record<string, string> = {
  qualified: 'Qualified',
  discovery: 'Discovery',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  closing: 'Closing',
  won: 'Won',
  lost: 'Lost',
};

async function buildDeal(d: typeof dealsTable.$inferSelect, ctx: {
  accs: Map<string, typeof accountsTable.$inferSelect>;
  users: Map<string, typeof usersTable.$inferSelect>;
  brands: Map<string, typeof brandsTable.$inferSelect>;
  companies: Map<string, typeof companiesTable.$inferSelect>;
}) {
  return {
    id: d.id,
    name: d.name,
    accountId: d.accountId,
    accountName: ctx.accs.get(d.accountId)?.name ?? 'Unknown',
    stage: d.stage,
    value: num(d.value),
    currency: d.currency,
    probability: d.probability,
    expectedCloseDate: typeof d.expectedCloseDate === 'string' ? d.expectedCloseDate : iso(d.expectedCloseDate)!.slice(0, 10),
    ownerId: d.ownerId,
    ownerName: ctx.users.get(d.ownerId)?.name ?? 'Unknown',
    brandId: d.brandId,
    brandName: ctx.brands.get(d.brandId)?.name ?? 'Unknown',
    companyId: d.companyId,
    companyName: ctx.companies.get(d.companyId)?.name ?? 'Unknown',
    riskLevel: d.riskLevel,
    nextStep: d.nextStep,
    updatedAt: iso(d.updatedAt)!,
  };
}

async function dealCtx(tenantId?: string) {
  const [accs, users, brands, companies] = await Promise.all([
    getAccountMap(), getUserMap(tenantId), getBrandMap(), getCompanyMap(),
  ]);
  return { accs, users, brands, companies };
}

// ── Scope helpers (per request) ──
// Policy: 404 for truly non-existent IDs; 403 for scope violations on existing rows.
async function gateDeal(req: Request, res: Response, dealId: string): Promise<boolean> {
  const status = await entityScopeStatus(req, 'deal', dealId);
  if (status === 'ok') return true;
  res.status(status === 'missing' ? 404 : 403).json({ error: status === 'missing' ? 'not found' : 'forbidden' });
  return false;
}
async function gateAccount(req: Request, res: Response, accountId: string): Promise<boolean> {
  const status = await entityScopeStatus(req, 'account', accountId);
  if (status === 'ok') return true;
  res.status(status === 'missing' ? 404 : 403).json({ error: status === 'missing' ? 'not found' : 'forbidden' });
  return false;
}
async function scopedDealIds(req: Request): Promise<string[]> {
  return [...(await allowedDealIds(req))];
}

// ── ORG ──
router.get('/orgs/tenant', async (req, res) => {
  const scope = getScope(req);
  const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, scope.tenantId));
  if (!t) { res.status(404).json({ error: 'no tenant' }); return; }
  res.json({ ...t, createdAt: iso(t.createdAt) });
});

router.get('/orgs/companies', async (req, res) => {
  const scope = getScope(req);
  const usePermitted = req.query.permitted === 'true' || req.query.permitted === '1';
  const rows = await db.select().from(companiesTable).where(eq(companiesTable.tenantId, scope.tenantId));
  // Picker mode: bypass active filter, return Permission set only.
  if (usePermitted) {
    if (scope.tenantWide) { res.json(rows); return; }
    const permitted = new Set<string>(await permittedCompanyIds(req));
    const permittedB = await permittedBrandIds(req);
    if (permittedB.length) {
      const bs = await db.select().from(brandsTable).where(inArray(brandsTable.id, permittedB));
      for (const b of bs) permitted.add(b.companyId);
    }
    res.json(rows.filter(c => permitted.has(c.id)));
    return;
  }
  // Default: apply Permission ∩ Active.
  if (scope.tenantWide && !hasActiveScopeFilter(scope)) { res.json(rows); return; }
  const allowed = new Set<string>(await allowedCompanyIds(req));
  const activeB = await allowedBrandIds(req);
  if (activeB.length) {
    const bs = await db.select().from(brandsTable).where(inArray(brandsTable.id, activeB));
    for (const b of bs) allowed.add(b.companyId);
  }
  res.json(rows.filter(c => allowed.has(c.id)));
});
router.get('/orgs/brands', async (req, res) => {
  const scope = getScope(req);
  const usePermitted = req.query.permitted === 'true' || req.query.permitted === '1';
  // Tenant-bound: only brands whose company belongs to the user's tenant.
  const rows = await db
    .select({ brand: brandsTable })
    .from(brandsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
    .where(eq(companiesTable.tenantId, scope.tenantId));
  const brands = rows.map(r => r.brand);
  let visible: typeof brands;
  if (usePermitted) {
    if (scope.tenantWide) {
      visible = brands;
    } else {
      const pc = await permittedCompanyIds(req);
      const pb = await permittedBrandIds(req);
      visible = brands.filter(b => pc.includes(b.companyId) || pb.includes(b.id));
    }
  } else if (scope.tenantWide && !hasActiveScopeFilter(scope)) {
    visible = brands;
  } else {
    const ac = await allowedCompanyIds(req);
    const ab = await allowedBrandIds(req);
    visible = brands.filter(b => ac.includes(b.companyId) || ab.includes(b.id));
  }
  res.json(visible.map(mapBrand));
});
// ── Companies & Brands: CRUD (Tenant-Admin) ──
// Country/Currency-Codes konsequent normalisieren (ISO-Standard ist Großbuchstaben).
function normCountry(c: string): string { return c.trim().toUpperCase(); }
function normCurrency(c: string): string { return c.trim().toUpperCase(); }
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

router.post('/orgs/companies', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateCompanyBody })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const b = req.body as { name: string; legalName: string; country: string; currency: string };
  const name = b.name.trim();
  const country = normCountry(b.country);
  const currency = normCurrency(b.currency);
  if (!/^[A-Z]{2}$/.test(country)) { res.status(422).json({ error: 'country must be ISO-3166 alpha-2 (DE, CH, AT, …)' }); return; }
  if (!/^[A-Z]{3}$/.test(currency)) { res.status(422).json({ error: 'currency must be ISO-4217 (EUR, CHF, USD, …)' }); return; }
  // Eindeutigkeit pro Tenant.
  const existing = await db.select().from(companiesTable)
    .where(and(eq(companiesTable.tenantId, scope.tenantId), eq(companiesTable.name, name)));
  if (existing.length) { res.status(409).json({ error: `company "${name}" already exists in this tenant` }); return; }
  const newId = `co_${randomBytes(6).toString('hex')}`;
  const row = {
    id: newId,
    tenantId: scope.tenantId,
    name,
    legalName: b.legalName.trim(),
    country,
    currency,
  };
  await db.insert(companiesTable).values(row);
  await writeAuditFromReq(req, {
    entityType: 'company',
    entityId: newId,
    action: 'create',
    actor: scope.user.name,
    summary: `Gesellschaft "${name}" angelegt`,
    after: row,
  });
  res.status(201).json(row);
});

router.patch('/orgs/companies/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdateCompanyParams, body: Z.UpdateCompanyBody })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  if (existing.tenantId !== scope.tenantId) { res.status(403).json({ error: 'forbidden' }); return; }
  const body = req.body as Partial<{ name: string; legalName: string; country: string; currency: string }>;
  const patch: Partial<typeof companiesTable.$inferInsert> = {};
  if (typeof body.name === 'string') {
    const v = body.name.trim();
    if (!v) { res.status(422).json({ error: 'name must not be empty' }); return; }
    if (v !== existing.name) {
      const dup = await db.select().from(companiesTable)
        .where(and(eq(companiesTable.tenantId, scope.tenantId), eq(companiesTable.name, v)));
      if (dup.length) { res.status(409).json({ error: `company "${v}" already exists in this tenant` }); return; }
    }
    patch.name = v;
  }
  if (typeof body.legalName === 'string') {
    const v = body.legalName.trim();
    if (!v) { res.status(422).json({ error: 'legalName must not be empty' }); return; }
    patch.legalName = v;
  }
  if (typeof body.country === 'string') {
    const v = normCountry(body.country);
    if (!/^[A-Z]{2}$/.test(v)) { res.status(422).json({ error: 'country must be ISO-3166 alpha-2' }); return; }
    patch.country = v;
  }
  if (typeof body.currency === 'string') {
    const v = normCurrency(body.currency);
    if (!/^[A-Z]{3}$/.test(v)) { res.status(422).json({ error: 'currency must be ISO-4217' }); return; }
    patch.currency = v;
  }
  if (Object.keys(patch).length) {
    await db.update(companiesTable).set(patch).where(eq(companiesTable.id, existing.id));
  }
  const [updated] = await db.select().from(companiesTable).where(eq(companiesTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'company',
    entityId: existing.id,
    action: 'update',
    actor: scope.user.name,
    summary: `Gesellschaft "${existing.name}" aktualisiert`,
    before: existing,
    after: updated,
  });
  res.json(updated);
});

router.delete('/orgs/companies/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.DeleteCompanyParams })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  if (existing.tenantId !== scope.tenantId) { res.status(403).json({ error: 'forbidden' }); return; }
  // Blocker prüfen — Hard-Delete mit Cascade wäre Datenverlust; wir verlangen explizites Aufräumen.
  // quotes/contracts haben keinen direkten companyId-FK — sie hängen über deals.
  // Daher genügt es, brands/deals/pricePositions zu zählen; ein nicht-leeres deals
  // impliziert noch lebende Quotes/Contracts.
  const [brandsCount, dealsCount, ppCount] = await Promise.all([
    db.$count(brandsTable, eq(brandsTable.companyId, existing.id)),
    db.$count(dealsTable, eq(dealsTable.companyId, existing.id)),
    db.$count(pricePositionsTable, eq(pricePositionsTable.companyId, existing.id)),
  ]);
  if (brandsCount + dealsCount + ppCount > 0) {
    res.status(409).json({
      error: 'in use',
      blockers: {
        brands: brandsCount,
        deals: dealsCount,
        pricePositions: ppCount,
      },
    });
    return;
  }
  await db.delete(companiesTable).where(eq(companiesTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'company',
    entityId: existing.id,
    action: 'delete',
    actor: scope.user.name,
    summary: `Gesellschaft "${existing.name}" gelöscht`,
    before: existing,
  });
  res.status(204).send();
});

router.post('/orgs/brands', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateBrandBody })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const b = req.body as {
    companyId: string; name: string;
    parentBrandId?: string | null;
    color?: string | null; voice?: string | null;
    logoUrl?: string | null; primaryColor?: string | null; secondaryColor?: string | null;
    tone?: string | null; legalEntityName?: string | null; addressLine?: string | null;
  };
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, b.companyId));
  if (!company) { res.status(404).json({ error: 'company not found' }); return; }
  if (company.tenantId !== scope.tenantId) { res.status(403).json({ error: 'forbidden' }); return; }
  const name = b.name.trim();
  if (!name) { res.status(422).json({ error: 'name must not be empty' }); return; }
  let parentBrandId: string | null = null;
  if (b.parentBrandId !== undefined && b.parentBrandId !== null && b.parentBrandId !== '') {
    const [parent] = await db.select().from(brandsTable).where(eq(brandsTable.id, b.parentBrandId));
    if (!parent) { res.status(422).json({ error: 'parentBrandId not found' }); return; }
    if (parent.companyId !== b.companyId) {
      res.status(422).json({ error: 'parent brand must belong to same company' }); return;
    }
    parentBrandId = parent.id;
  }
  const dup = await db.select().from(brandsTable)
    .where(and(eq(brandsTable.companyId, b.companyId), eq(brandsTable.name, name)));
  if (dup.length) { res.status(409).json({ error: `brand "${name}" already exists for this company` }); return; }
  // Defaults & Hex-Validierung.
  const color = (b.color ?? b.primaryColor ?? '#2D6CDF').trim();
  if (!HEX_RE.test(color)) { res.status(422).json({ error: 'color must be #RRGGBB hex' }); return; }
  const primaryColor = b.primaryColor ? b.primaryColor.trim() : color;
  if (primaryColor && !HEX_RE.test(primaryColor)) { res.status(422).json({ error: 'primaryColor must be #RRGGBB hex' }); return; }
  if (b.secondaryColor && b.secondaryColor !== '' && !HEX_RE.test(b.secondaryColor.trim())) {
    res.status(422).json({ error: 'secondaryColor must be #RRGGBB hex' }); return;
  }
  const newId = `br_${randomBytes(6).toString('hex')}`;
  const row: typeof brandsTable.$inferInsert = {
    id: newId,
    companyId: b.companyId,
    parentBrandId,
    name,
    color,
    voice: (b.voice ?? b.tone ?? 'precise').trim() || 'precise',
    defaultClauseVariants: {},
    logoUrl: b.logoUrl?.trim() || null,
    primaryColor,
    secondaryColor: b.secondaryColor?.trim() || null,
    tone: b.tone?.trim() || (b.voice?.trim() || null),
    legalEntityName: b.legalEntityName?.trim() || null,
    addressLine: b.addressLine?.trim() || null,
  };
  await db.insert(brandsTable).values(row);
  const [inserted] = await db.select().from(brandsTable).where(eq(brandsTable.id, newId));
  await writeAuditFromReq(req, {
    entityType: 'brand',
    entityId: newId,
    action: 'create',
    actor: scope.user.name,
    summary: `Brand "${name}" für Gesellschaft "${company.name}" angelegt`,
    after: inserted,
  });
  res.status(201).json(mapBrand(inserted!));
});

router.delete('/orgs/brands/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.DeleteBrandParams })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(brandsTable).where(eq(brandsTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, existing.companyId));
  if (!company || company.tenantId !== scope.tenantId) {
    res.status(403).json({ error: 'forbidden' }); return;
  }
  // quotes/contracts hängen über deals → keine direkten brandId-FKs nötig.
  const [dealsCount, ppCount] = await Promise.all([
    db.$count(dealsTable, eq(dealsTable.brandId, existing.id)),
    db.$count(pricePositionsTable, eq(pricePositionsTable.brandId, existing.id)),
  ]);
  if (dealsCount + ppCount > 0) {
    res.status(409).json({
      error: 'in use',
      blockers: {
        deals: dealsCount,
        pricePositions: ppCount,
      },
    });
    return;
  }
  await db.delete(brandsTable).where(eq(brandsTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'brand',
    entityId: existing.id,
    action: 'delete',
    actor: scope.user.name,
    summary: `Brand "${existing.name}" gelöscht`,
    before: existing,
  });
  res.status(204).send();
});

router.get('/orgs/users', async (req, res) => {
  const scope = getScope(req);
  const rows = await db.select().from(usersTable).where(eq(usersTable.tenantId, scope.tenantId));
  res.json(rows.map(u => ({
    id: u.id, name: u.name, email: u.email, role: u.role, scope: u.scope,
    initials: u.initials, avatarColor: u.avatarColor,
  })));
});
router.get('/orgs/me', async (req, res) => {
  const scope = getScope(req);
  const u = scope.user;
  const allowedCompanyIds = await permittedCompanyIds(req);
  const allowedBrandIdsList = await permittedBrandIds(req);
  res.json({
    id: u.id, name: u.name, email: u.email, role: u.role, scope: u.scope,
    initials: u.initials, avatarColor: u.avatarColor,
    tenantId: u.tenantId, tenantWide: scope.tenantWide,
    // Backwards-compat
    companyIds: scope.companyIds, brandIds: scope.brandIds,
    // Allowed scope (Permission, vollständig)
    allowedScope: {
      tenantWide: scope.tenantWide,
      companyIds: allowedCompanyIds,
      brandIds: allowedBrandIdsList,
    },
    // Active scope (UI-Wahl). NULL-Listen = "alle erlaubten" für die jeweilige
    // Dimension. Wenn beide Listen null sind, ist kein Filter aktiv.
    activeScope: {
      companyIds: scope.activeCompanyIds,
      brandIds: scope.activeBrandIds,
      filtered: hasActiveScopeFilter(scope),
    },
  });
});

const ACTIVE_SCOPE_COOKIE = 'df_active_scope';

router.patch('/orgs/me/active-scope', async (req, res) => {
  if (!validateInline(req, res, { body: Z.UpdateActiveScopeBody })) return;
  const scope = getScope(req);
  const body = req.body as { companyIds?: string[] | null; brandIds?: string[] | null };
  // Normalize: undefined → null (=Reset für die jeweilige Dimension)
  const reqCompanies = body.companyIds === undefined ? null : body.companyIds;
  const reqBrands = body.brandIds === undefined ? null : body.brandIds;
  // Validate against PERMITTED set (not active-filtered) — Restricted User darf
  // aktiven Scope nur als Teilmenge der erlaubten Permissions setzen.
  const permittedC = new Set(await permittedCompanyIds(req));
  const permittedB = new Set(await permittedBrandIds(req));
  if (reqCompanies !== null) {
    for (const cid of reqCompanies) {
      if (!permittedC.has(cid)) {
        res.status(403).json({ error: `companyId "${cid}" not permitted` });
        return;
      }
    }
  }
  if (reqBrands !== null) {
    for (const bid of reqBrands) {
      if (!permittedB.has(bid)) {
        res.status(403).json({ error: `brandId "${bid}" not permitted` });
        return;
      }
    }
  }
  // Persist
  await db.update(usersTable)
    .set({
      activeScopeCompanyIds: reqCompanies === null ? null : JSON.stringify(reqCompanies),
      activeScopeBrandIds: reqBrands === null ? null : JSON.stringify(reqBrands),
    })
    .where(eq(usersTable.id, scope.user.id));
  // Cookie spiegeln (für no-flash beim Boot)
  const cookieVal = JSON.stringify({
    companyIds: reqCompanies,
    brandIds: reqBrands,
  });
  res.cookie(ACTIVE_SCOPE_COOKIE, cookieVal, {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 30,
    path: '/',
  });
  // Audit-Log Snapshot — hier explizit den NEUEN Scope speichern
  // (writeAuditFromReq würde den alten/Pre-Update-Scope nehmen).
  await writeAudit({
    tenantId: scope.tenantId,
    entityType: 'user',
    entityId: scope.user.id,
    action: 'scope.switch',
    summary: reqCompanies === null && reqBrands === null
      ? 'Aktiver Scope zurückgesetzt'
      : `Aktiver Scope geändert: ${reqCompanies?.length ?? 0} Companies, ${reqBrands?.length ?? 0} Brands`,
    after: { companyIds: reqCompanies, brandIds: reqBrands },
    actor: scope.user.name,
    activeScope: {
      tenantWide: scope.tenantWide,
      companyIds: reqCompanies,
      brandIds: reqBrands,
    },
  });
  res.json({
    activeScope: {
      companyIds: reqCompanies,
      brandIds: reqBrands,
      filtered: reqCompanies !== null || reqBrands !== null,
    },
    allowedScope: {
      tenantWide: scope.tenantWide,
      companyIds: [...permittedC],
      brandIds: [...permittedB],
    },
  });
});

// ── ACCOUNTS ──
router.get('/accounts', async (req, res) => {
  // Tenant + scope-bound at the SQL level: only fetch accounts whose IDs
  // appear in `allowedAccountIds`. Deal aggregates are then re-filtered by
  // `allowedDealIds` so a restricted user who owns an account cannot see or
  // infer out-of-scope deal counts/values from cross-team activity.
  //
  // Soft-Delete-Filter: standardmäßig nur "aktive" (archivedAt IS NULL).
  // Mit ?status=archived nur archivierte, ?status=all beides — gedacht für
  // den Archiv-Tab und Wiederherstellungs-Workflows.
  const statusParam = String(req.query.status ?? 'active').toLowerCase();
  const status: 'active' | 'archived' | 'all' =
    statusParam === 'archived' || statusParam === 'all' ? statusParam : 'active';
  const accIds = await allowedAccountIds(req);
  if (accIds.size === 0) { res.json([]); return; }
  const accIdList = [...accIds];
  const dealIds = await allowedDealIds(req);
  const archiveCond =
    status === 'active' ? isNull(accountsTable.archivedAt)
    : status === 'archived' ? sql`${accountsTable.archivedAt} IS NOT NULL`
    : undefined;
  const accs = await db.select().from(accountsTable)
    .where(archiveCond
      ? and(inArray(accountsTable.id, accIdList), archiveCond)
      : inArray(accountsTable.id, accIdList));
  const accDeals = dealIds.size === 0 ? [] : await db.select().from(dealsTable)
    .where(inArray(dealsTable.accountId, accIdList));
  res.json(accs.map(a => {
    const ds = accDeals.filter(d => d.accountId === a.id && dealIds.has(d.id) && d.stage !== 'won' && d.stage !== 'lost');
    return {
      ...a,
      openDeals: ds.length,
      totalValue: ds.reduce((s, d) => s + num(d.value), 0),
    };
  }));
});

router.post('/accounts', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateAccountBody })) return;
  const body = req.body as {
    name: string; industry: string; country: string;
    website?: string | null; phone?: string | null;
    billingAddress?: string | null; vatId?: string | null;
    sizeBracket?: string | null; ownerId?: string | null;
  };
  const id = `acc_${randomUUID().slice(0, 8)}`;
  let resolvedOwnerId: string | null = getScope(req).user.id;
  if (body.ownerId !== undefined) {
    const ownerCheck = await resolveOwnerId(req, res, body.ownerId);
    if (!ownerCheck.ok) return;
    resolvedOwnerId = ownerCheck.value;
  }
  await db.insert(accountsTable).values({
    id, name: body.name, industry: body.industry, country: body.country,
    healthScore: 70, ownerId: resolvedOwnerId,
    website: body.website?.trim() || null,
    phone: body.phone?.trim() || null,
    billingAddress: body.billingAddress?.trim() || null,
    vatId: body.vatId?.trim() || null,
    sizeBracket: body.sizeBracket?.trim() || null,
  });
  const [a] = await db.select().from(accountsTable).where(eq(accountsTable.id, id));
  res.status(201).json({ ...a, openDeals: 0, totalValue: 0 });
});

router.get('/accounts/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetAccountParams })) return;
  if (!(await gateAccount(req, res, req.params.id))) return;
  const [a] = await db.select().from(accountsTable).where(eq(accountsTable.id, req.params.id));
  if (!a) { res.status(404).json({ error: 'not found' }); return; }
  const contacts = await db.select().from(contactsTable).where(eq(contactsTable.accountId, a.id));
  const dealIds = await allowedDealIds(req);
  const allDs = await db.select().from(dealsTable).where(eq(dealsTable.accountId, a.id));
  const ds = allDs.filter(d => dealIds.has(d.id));
  const ctx = await dealCtx(getScope(req).tenantId);
  const openDeals = ds.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  res.json({
    ...a,
    openDeals: openDeals.length,
    totalValue: openDeals.reduce((s, d) => s + num(d.value), 0),
    contacts,
    deals: await Promise.all(ds.map(d => buildDeal(d, ctx))),
  });
});

// Validates ownerId against current tenant. Returns:
//   { ok:true, value:string|null }  -> safe to assign
//   { ok:false }                    -> response was already sent (422)
async function resolveOwnerId(
  req: import('express').Request,
  res: import('express').Response,
  ownerId: string | null | undefined,
): Promise<{ ok: true; value: string | null } | { ok: false }> {
  if (ownerId === null || ownerId === '') return { ok: true, value: null };
  if (ownerId === undefined) return { ok: true, value: null };
  const scope = getScope(req);
  const [owner] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, ownerId), eq(usersTable.tenantId, scope.tenantId)));
  if (!owner) {
    res.status(422).json({ error: 'invalid ownerId for tenant' });
    return { ok: false };
  }
  return { ok: true, value: ownerId };
}

router.patch('/accounts/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdateAccountParams, body: Z.UpdateAccountBody })) return;
  if (!(await gateAccount(req, res, req.params.id))) return;
  // Archivierte Accounts sind read-only. Stammdaten/Owner werden erst nach
  // Wiederherstellung wieder editierbar, damit "archiviert" wirklich
  // bedeutet "ruhend". Lesen (GET /:id) bleibt erlaubt, damit Restore-
  // Workflows aus Detailansichten möglich sind.
  const [archCheck] = await db.select({ archivedAt: accountsTable.archivedAt })
    .from(accountsTable).where(eq(accountsTable.id, req.params.id));
  if (archCheck?.archivedAt) {
    res.status(409).json({ error: 'account archived', message: 'Der Account ist archiviert. Bitte zuerst wiederherstellen, um Änderungen vorzunehmen.' });
    return;
  }
  const b = req.body as {
    name?: string; industry?: string; country?: string; healthScore?: number;
    ownerId?: string | null;
    website?: string | null; phone?: string | null;
    billingAddress?: string | null; vatId?: string | null;
    sizeBracket?: string | null; primaryContactId?: string | null;
  };
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (b.name !== undefined) update.name = b.name;
  if (b.industry !== undefined) update.industry = b.industry;
  if (b.country !== undefined) update.country = b.country;
  if (b.healthScore !== undefined) update.healthScore = b.healthScore;
  if (b.ownerId !== undefined) {
    const ownerCheck = await resolveOwnerId(req, res, b.ownerId);
    if (!ownerCheck.ok) return;
    update.ownerId = ownerCheck.value;
  }
  // Optionale Stammdatenfelder — alle nullable; leere Strings → null normalisieren.
  const optStr = (v: unknown): string | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t === '' ? null : t;
  };
  for (const k of ['website', 'phone', 'billingAddress', 'vatId', 'sizeBracket', 'primaryContactId'] as const) {
    const norm = optStr((b as Record<string, unknown>)[k]);
    if (norm !== undefined) update[k] = norm;
  }
  await db.update(accountsTable).set(update).where(eq(accountsTable.id, req.params.id));
  const [a] = await db.select().from(accountsTable).where(eq(accountsTable.id, req.params.id));
  if (!a) { res.status(404).json({ error: 'not found' }); return; }
  const dealIds = await allowedDealIds(req);
  const allDs = await db.select().from(dealsTable).where(eq(dealsTable.accountId, a.id));
  const ds = allDs.filter(d => dealIds.has(d.id));
  const openDeals = ds.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  res.json({
    ...a,
    openDeals: openDeals.length,
    totalValue: openDeals.reduce((s, d) => s + num(d.value), 0),
  });
});

router.get('/contacts', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListContactsQueryParams })) return;
  // Tenant + scope-bound at the SQL level via allowedAccountIds (joins
  // deals→companies on tenantId). Cross-tenant contacts can never be
  // returned because their accountId is not in this tenant's set.
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : null;
  const accIds = await allowedAccountIds(req);
  if (accIds.size === 0) { res.json([]); return; }
  if (accountId && !accIds.has(accountId)) { res.json([]); return; }
  const targetAccountIds = accountId ? [accountId] : [...accIds];
  const visible = await db.select().from(contactsTable)
    .where(inArray(contactsTable.accountId, targetAccountIds));
  // PII access log
  const scope = getScope(req);
  const piiContacts = visible.filter(c => !c.deletedAt);
  for (const c of piiContacts) {
    await logPiiAccess({
      tenantId: scope.tenantId,
      actorUserId: scope.user.id,
      entityType: 'contact',
      entityId: c.id,
      fields: ['name', 'email', 'phone'],
    }).catch(() => undefined);
  }
  res.json(visible);
});

// ── CONTACT WRITE OPS (am Kunden anlegen / bearbeiten / löschen) ──
//
// Visibility & Schreibrecht: gleiche Regel wie /accounts/:id PATCH —
// gateAccount entscheidet, ob der aufrufende Nutzer den Account sieht und
// damit auch dessen Kontakte pflegen darf. Ein Read-Only-Nutzer (kein
// Schreibrecht) sieht den Account ohnehin nicht im allowedAccountIds-Set.
//
// Audit & PII: jede Mutation erzeugt einen Audit-Log-Eintrag mit before/after
// (PII bleibt im Tenant-eigenen audit_log und wird vom GDPR-Forget-Sweep
// pseudonymisiert mitbehandelt).

function trimOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

router.post('/accounts/:id/contacts', async (req, res) => {
  if (!validateInline(req, res, { params: Z.CreateContactParams, body: Z.CreateContactBody })) return;
  if (!(await gateAccount(req, res, req.params.id))) return;
  const b = req.body as {
    name: string;
    role?: string;
    email?: string | null;
    phone?: string | null;
    isDecisionMaker?: boolean;
  };
  const name = (b.name ?? '').trim();
  if (!name) { res.status(422).json({ error: 'name required' }); return; }
  const email = trimOrNull(b.email);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(422).json({ error: 'invalid email' }); return;
  }
  const id = `ct_${randomUUID().slice(0, 8)}`;
  const row = {
    id,
    accountId: req.params.id,
    name,
    role: (b.role ?? '').trim(),
    email: email ?? '',
    phone: trimOrNull(b.phone),
    isDecisionMaker: Boolean(b.isDecisionMaker),
  };
  await db.insert(contactsTable).values(row);
  await writeAuditFromReq(req, {
    entityType: 'contact',
    entityId: id,
    action: 'create',
    summary: `Kontakt "${row.name}" am Kunden angelegt`,
    after: { ...row },
  });
  res.status(201).json(row);
});

router.patch('/contacts/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdateContactParams, body: Z.UpdateContactBody })) return;
  const [existing] = await db.select().from(contactsTable).where(eq(contactsTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateAccount(req, res, existing.accountId))) return;
  const b = req.body as {
    name?: string;
    role?: string;
    email?: string | null;
    phone?: string | null;
    isDecisionMaker?: boolean;
  };
  const update: Record<string, unknown> = {};
  if (typeof b.name === 'string') {
    const n = b.name.trim();
    if (!n) { res.status(422).json({ error: 'name required' }); return; }
    update.name = n;
  }
  if (typeof b.role === 'string') update.role = b.role.trim();
  if (b.email !== undefined) {
    const e = trimOrNull(b.email);
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      res.status(422).json({ error: 'invalid email' }); return;
    }
    update.email = e ?? '';
  }
  if (b.phone !== undefined) update.phone = trimOrNull(b.phone);
  if (b.isDecisionMaker !== undefined) update.isDecisionMaker = Boolean(b.isDecisionMaker);
  if (Object.keys(update).length === 0) {
    res.json(existing); return;
  }
  await db.update(contactsTable).set(update).where(eq(contactsTable.id, req.params.id));
  const [after] = await db.select().from(contactsTable).where(eq(contactsTable.id, req.params.id));
  await writeAuditFromReq(req, {
    entityType: 'contact',
    entityId: req.params.id,
    action: 'update',
    summary: `Kontakt "${after?.name ?? existing.name}" aktualisiert`,
    before: existing,
    after: after ?? null,
  });
  res.json(after ?? existing);
});

router.delete('/contacts/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.DeleteContactParams })) return;
  const [existing] = await db.select().from(contactsTable).where(eq(contactsTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateAccount(req, res, existing.accountId))) return;
  // Wenn Account auf diesen Kontakt zeigt, primaryContactId leeren — sonst
  // hängen wir auf eine ID, die es nicht mehr gibt.
  await db.update(accountsTable)
    .set({ primaryContactId: null })
    .where(and(eq(accountsTable.id, existing.accountId), eq(accountsTable.primaryContactId, existing.id)));
  await db.delete(contactsTable).where(eq(contactsTable.id, req.params.id));
  await writeAuditFromReq(req, {
    entityType: 'contact',
    entityId: req.params.id,
    action: 'delete',
    summary: `Kontakt "${existing.name}" gelöscht`,
    before: existing,
  });
  res.status(204).send();
});

// ── PEOPLE-CRAWLER (Vorschläge aus Website) ─────────────────────────────────
// Reuse fetchWithLimit / SSRF-Logik aus dem Firmen-Anreicherungs-Crawler.
// Ziel: Geschäftsführer/CEO/Vorstand zuverlässig + best-effort weitere
// Ansprechpartner aus Impressum, Über-uns, Team, Kontakt finden.

const CONTACT_SCRAPE_PATHS = [
  '', // origin (Startseite)
  '/impressum', '/imprint', '/legal',
  '/team', '/unser-team', '/our-team',
  '/ueber-uns', '/über-uns', '/about', '/about-us', '/about/us',
  '/kontakt', '/contact', '/contact-us',
  '/management', '/leadership', '/people', '/company/team',
];

// (label, isDecisionMaker). Reihenfolge ist relevant: spezifischere Patterns
// zuerst, damit z. B. "Managing Director" vor "Director" greift.
const ROLE_PATTERNS: Array<{ regex: RegExp; label: string; decisionMaker: boolean }> = [
  // ── Decision-Maker (DE) ─────────────────────────────────────────────────
  { regex: /\bGeschäftsführer(?:in)?\b/i, label: 'Geschäftsführer', decisionMaker: true },
  { regex: /\b(Geschäftsführung|GF)\b/i,  label: 'Geschäftsführung', decisionMaker: true },
  { regex: /\bVorstands?vorsitzende[rn]?\b/i, label: 'Vorstandsvorsitzender', decisionMaker: true },
  { regex: /\bVorstand\b/i,               label: 'Vorstand', decisionMaker: true },
  { regex: /\bInhaber(?:in)?\b/i,         label: 'Inhaber', decisionMaker: true },
  { regex: /\bEigentümer(?:in)?\b/i,      label: 'Eigentümer', decisionMaker: true },
  { regex: /\b(Mit)?[Gg]ründer(?:in)?\b/, label: 'Gründer', decisionMaker: true },
  { regex: /\bGesellschafter(?:in)?\b/i,  label: 'Gesellschafter', decisionMaker: true },
  // ── Decision-Maker (EN) ─────────────────────────────────────────────────
  { regex: /\bManaging\s+Director\b/i,    label: 'Managing Director', decisionMaker: true },
  { regex: /\bChief\s+Executive\s+Officer\b/i, label: 'CEO', decisionMaker: true },
  { regex: /\bCEO\b/,                     label: 'CEO', decisionMaker: true },
  { regex: /\bCo-?Founder\b/i,            label: 'Co-Founder', decisionMaker: true },
  { regex: /\bFounder\b/i,                label: 'Founder', decisionMaker: true },
  { regex: /\bOwner\b/i,                  label: 'Owner', decisionMaker: true },
  { regex: /\bPresident\b/i,              label: 'President', decisionMaker: true },
  // ── Andere C-Level / leitende Rollen (kein Auto-Entscheider, aber Ansprechpartner) ─
  { regex: /\bProkurist(?:in)?\b/i,       label: 'Prokurist', decisionMaker: false },
  { regex: /\bCFO\b/,                     label: 'CFO', decisionMaker: false },
  { regex: /\bCTO\b/,                     label: 'CTO', decisionMaker: false },
  { regex: /\bCOO\b/,                     label: 'COO', decisionMaker: false },
  { regex: /\bCIO\b/,                     label: 'CIO', decisionMaker: false },
  { regex: /\bCMO\b/,                     label: 'CMO', decisionMaker: false },
  { regex: /\bCRO\b/,                     label: 'CRO', decisionMaker: false },
  { regex: /\bCPO\b/,                     label: 'CPO', decisionMaker: false },
  { regex: /\bCSO\b/,                     label: 'CSO', decisionMaker: false },
  { regex: /\bChief\s+\w+(?:\s+\w+)?\s+Officer\b/i, label: 'Chief Officer', decisionMaker: false },
  { regex: /\bVice\s+President\b/i,       label: 'Vice President', decisionMaker: false },
  { regex: /\bVP\s+[A-ZÄÖÜ][\w-]+/,       label: 'VP', decisionMaker: false },
  { regex: /\bDirector\b/i,               label: 'Director', decisionMaker: false },
  { regex: /\bHead\s+of\s+[A-ZÄÖÜ][\w&\- ]+/, label: 'Head of', decisionMaker: false },
  { regex: /\bBereichsleiter(?:in)?\b/i,  label: 'Bereichsleiter', decisionMaker: false },
  { regex: /\bAbteilungsleiter(?:in)?\b/i,label: 'Abteilungsleiter', decisionMaker: false },
  { regex: /\bLeiter(?:in)?\b/i,          label: 'Leiter', decisionMaker: false },
];

// Auch Personennamen mit gängigen akademischen Titeln (Dr., Prof., Mag., Dipl.-Ing.)
// und Adelsprädikaten (van, von, de) — bewusst konservativ, sonst halten wir
// jede Phrase aus zwei Großbuchstaben-Wörtern für einen Namen.
const NAME_RE = /\b(?:(?:Dr|Prof|Prof\.?\s*Dr|Mag|Dipl\.-?Ing|Dipl\.-?Kfm)\.?\s+)?[A-ZÄÖÜ][a-zäöüß\-]{1,}(?:\s+(?:van|von|de|del|der|den)\s+)?(?:\s+[A-ZÄÖÜ][a-zäöüß\-]{1,}){1,2}\b/;

function extractNameFromText(text: string): string | null {
  const m = text.match(NAME_RE);
  return m ? m[0].trim() : null;
}

function detectRole(text: string): { label: string; decisionMaker: boolean; match: string } | null {
  for (const r of ROLE_PATTERNS) {
    const m = text.match(r.regex);
    if (m) return { label: r.label, decisionMaker: r.decisionMaker, match: m[0] };
  }
  return null;
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
function deobfuscateEmails(t: string): string {
  return t
    .replace(/\s*\(\s*at\s*\)\s*/gi, '@')
    .replace(/\s*\[\s*at\s*\]\s*/gi, '@')
    .replace(/\s+at\s+([A-Z0-9.-]+)\s+(?:dot|\.)\s+([A-Z]{2,})/gi, '@$1.$2')
    .replace(/\{at\}/gi, '@')
    .replace(/&#64;/g, '@')
    .replace(/&commat;/g, '@');
}

function extractEmailFromText(text: string): string | null {
  const cleaned = deobfuscateEmails(text);
  const m = cleaned.match(EMAIL_RE);
  return m ? m[0].trim().toLowerCase() : null;
}

const PHONE_RE = /(?:Tel(?:efon)?\.?|Phone|T:|Fon)[:\s]*((?:\+|00)?[\d][\d\s().\/-]{6,}\d)/i;
const PHONE_BARE_RE = /\b(\+\d{1,3}[\s().\/-]?\d[\d\s().\/-]{5,}\d)\b/;
function extractPhoneFromText(text: string): string | null {
  const m = text.match(PHONE_RE) ?? text.match(PHONE_BARE_RE);
  if (!m) return null;
  return (m[1] ?? m[0]).replace(/[\s().\/-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Tags entfernen, aber Block-Grenzen als Newlines erhalten — wichtig für die
// "Name auf Zeile X, Rolle auf Zeile X+1"-Heuristik.
function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|td|dd|dt|figcaption)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return text
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0);
}

type ScrapedPerson = {
  name: string;
  role: string;
  email: string | null;
  phone: string | null;
  isDecisionMaker: boolean;
  sourceUrl: string;
};

function findPeopleOnPage(html: string, sourceUrl: string): ScrapedPerson[] {
  // mailto-Links liefern oft Name → E-Mail-Paare zuverlässig. Diese Map nutzen
  // wir später, um bei einem gefundenen Namen ohne E-Mail noch eine E-Mail
  // zuzuordnen.
  const mailtoByName = new Map<string, string>();
  const mailtoEmails = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="mailto:([^"?]+)"[^>]*>([^<]+)<\/a>/gi)) {
    const email = (m[1] ?? '').trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) continue;
    mailtoEmails.add(email);
    const label = (m[2] ?? '').replace(/\s+/g, ' ').trim();
    const name = extractNameFromText(label);
    if (name) mailtoByName.set(name.toLowerCase(), email);
  }

  const lines = htmlToLines(html);
  const found: ScrapedPerson[] = [];
  const seen = new Set<string>(); // dedupe-Key innerhalb dieser Seite

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.length > 240) continue; // Fließtext überspringen
    const role = detectRole(line);
    if (!role) continue;

    // Name-Kandidaten: gleiche Zeile (Rolle entfernt), Vorzeile, Folgezeile.
    const sameLineSansRole = line.replace(role.match, ' ').replace(/\s{2,}/g, ' ').trim();
    const candidates = [
      extractNameFromText(sameLineSansRole),
      i > 0 ? extractNameFromText(lines[i - 1] ?? '') : null,
      i < lines.length - 1 ? extractNameFromText(lines[i + 1] ?? '') : null,
    ].filter((n): n is string => Boolean(n));
    if (candidates.length === 0) continue;
    const name = candidates[0]!;

    // Kontext-Fenster (5 Zeilen) für E-Mail/Telefon in der Nähe.
    const ctxLines = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(' ');
    let email = extractEmailFromText(ctxLines);
    if (!email) {
      const m = mailtoByName.get(name.toLowerCase());
      if (m) email = m;
    }
    const phone = extractPhoneFromText(ctxLines);

    const key = `${name.toLowerCase()}|${email ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    found.push({
      name,
      role: role.label,
      email,
      phone,
      isDecisionMaker: role.decisionMaker,
      sourceUrl,
    });
  }
  return found;
}

router.post('/accounts/:id/contacts/scrape-from-website', async (req, res) => {
  if (!validateInline(req, res, { params: Z.ScrapeContactsFromWebsiteParams, body: Z.ScrapeContactsFromWebsiteBody })) return;
  if (!(await gateAccount(req, res, req.params.id))) return;

  const raw = (req.body as { website?: unknown })?.website;
  if (typeof raw !== 'string' || !raw.trim()) {
    res.status(422).json({ error: 'website required' }); return;
  }
  let url: URL;
  try {
    const trimmed = raw.trim();
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withProto);
    if (!/^https?:$/i.test(url.protocol)) throw new Error('bad proto');
  } catch {
    res.status(422).json({ error: 'invalid website url' }); return;
  }
  // SSRF-Schutz analog zu enrich-from-website.
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local') ||
      /^(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01]))\./.test(host)) {
    res.status(422).json({ error: 'host not allowed' }); return;
  }

  const candidates = CONTACT_SCRAPE_PATHS.map((p) => `${url.origin}${p}`);
  const results: ScrapedPerson[] = [];
  let pagesCrawled = 0;
  const dedupe = new Map<string, ScrapedPerson>();
  for (const cand of candidates) {
    const html = await fetchWithLimit(cand);
    if (!html || html.length < 200) continue;
    pagesCrawled += 1;
    const people = findPeopleOnPage(html, cand);
    for (const p of people) {
      const key = `${p.name.toLowerCase()}|${(p.email ?? '').toLowerCase()}`;
      const prev = dedupe.get(key);
      if (!prev) {
        dedupe.set(key, p);
        continue;
      }
      // Decision-Maker-Treffer hat Vorrang vor anderen.
      if (!prev.isDecisionMaker && p.isDecisionMaker) {
        dedupe.set(key, { ...p, email: prev.email ?? p.email, phone: prev.phone ?? p.phone });
      } else if (!prev.email && p.email) {
        prev.email = p.email;
      } else if (!prev.phone && p.phone) {
        prev.phone = p.phone;
      }
    }
  }
  for (const p of dedupe.values()) results.push(p);

  // Duplikate gegen bestehende Kontakte am Account markieren (Namens- oder
  // E-Mail-Match, case-insensitive).
  const existing = await db.select().from(contactsTable).where(eq(contactsTable.accountId, req.params.id));
  const existingNames = new Set(existing.map((c) => c.name.trim().toLowerCase()));
  const existingEmails = new Set(existing.filter((c) => c.email).map((c) => c.email.trim().toLowerCase()));
  const enriched = results.map((p) => ({
    ...p,
    isDuplicate: existingNames.has(p.name.toLowerCase()) ||
                 (p.email != null && existingEmails.has(p.email.toLowerCase())),
  }));

  // Sortierung: Entscheider zuerst, dann mit E-Mail, dann Name.
  enriched.sort((a, b) => {
    if (a.isDecisionMaker !== b.isDecisionMaker) return a.isDecisionMaker ? -1 : 1;
    const aE = a.email ? 0 : 1; const bE = b.email ? 0 : 1;
    if (aE !== bE) return aE - bE;
    return a.name.localeCompare(b.name);
  });

  res.json({
    website: url.origin,
    pagesCrawled,
    results: enriched,
  });
});

// ── DEALS ──
router.get('/deals', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListDealsQueryParams })) return;
  const scope = getScope(req);
  const filters = [];
  if (req.query.stage)     filters.push(eq(dealsTable.stage, String(req.query.stage)));
  if (req.query.ownerId)   filters.push(eq(dealsTable.ownerId, String(req.query.ownerId)));
  if (req.query.companyId) filters.push(eq(dealsTable.companyId, String(req.query.companyId)));
  if (req.query.brandId)   filters.push(eq(dealsTable.brandId, String(req.query.brandId)));
  filters.push(dealsWhereSql(scope));
  const rows = await db.select().from(dealsTable)
    .where(and(...filters))
    .orderBy(desc(dealsTable.updatedAt));
  const ctx = await dealCtx(getScope(req).tenantId);
  let result = await Promise.all(rows.map(d => buildDeal(d, ctx)));
  if (req.query.search) {
    const q = String(req.query.search).toLowerCase();
    result = result.filter(d =>
      d.name.toLowerCase().includes(q) || d.accountName.toLowerCase().includes(q),
    );
  }
  res.json(result);
});

router.post('/deals', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateDealBody })) return;
  const b = req.body;
  const scope = getScope(req);
  // Tenant-bound for every user (including tenantWide): companyId must belong
  // to the user's tenant.
  const company = (await db.select().from(companiesTable).where(eq(companiesTable.id, b.companyId)))[0];
  if (!company || company.tenantId !== scope.tenantId) {
    res.status(403).json({ error: 'forbidden (out of tenant)' }); return;
  }
  // Intersection (Permission ∩ Active) für POST: aktive Sicht muss companyId
  // ODER brandId enthalten. Tenant-weit + kein aktiver Filter ⇒ pass-through.
  if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
    const okCompany = (await allowedCompanyIds(req)).includes(b.companyId);
    const okBrand = (await allowedBrandIds(req)).includes(b.brandId);
    if (!okCompany && !okBrand) {
      res.status(403).json({ error: 'forbidden (out of scope)' }); return;
    }
  }
  // Authz: der referenzierte Account muss existieren und für den User sichtbar
  // sein. Ohne diesen Check könnte jemand mit gültigem company/brand-Scope
  // Deals an fremde Accounts hängen (IDOR / Cross-Account-Linkage).
  const allowedAccs = await allowedAccountIds(req);
  if (!allowedAccs.has(b.accountId)) {
    res.status(403).json({ error: 'forbidden (account not in scope)' }); return;
  }
  // Archivierte Accounts sind read-only — neue Deals würden bei Wieder-
  // herstellung verwirrend auftauchen. User soll erst restoren.
  const [accCheck] = await db.select({ archivedAt: accountsTable.archivedAt })
    .from(accountsTable).where(eq(accountsTable.id, b.accountId));
  if (accCheck?.archivedAt) {
    res.status(422).json({ error: 'account archived', message: 'Der Account ist archiviert. Bitte zuerst wiederherstellen.' });
    return;
  }
  // Owner muss innerhalb des Tenants liegen (Cross-Tenant-Owner-Assignment verhindern).
  const [owner] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, b.ownerId), eq(usersTable.tenantId, scope.tenantId)));
  if (!owner) { res.status(422).json({ error: 'invalid ownerId for tenant' }); return; }
  const id = `dl_${randomUUID().slice(0, 8)}`;
  await db.insert(dealsTable).values({
    id, name: b.name, accountId: b.accountId, stage: b.stage, value: String(b.value),
    currency: company?.currency ?? 'EUR', probability: 30,
    expectedCloseDate: b.expectedCloseDate, ownerId: b.ownerId, brandId: b.brandId,
    companyId: b.companyId, riskLevel: 'low', nextStep: null,
  });
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
  const ctx = await dealCtx(getScope(req).tenantId);
  res.status(201).json(await buildDeal(d!, ctx));
});

router.get('/deals/pipeline', async (req, res) => {
  const rows = await db.select().from(dealsTable).where(dealsWhereSql(getScope(req)));
  const ctx = await dealCtx(getScope(req).tenantId);
  const stages = ['qualified', 'discovery', 'proposal', 'negotiation', 'closing', 'won', 'lost'];
  const out = await Promise.all(stages.map(async stage => {
    const deals = rows.filter(d => d.stage === stage);
    return {
      stage,
      label: stageLabels[stage] ?? stage,
      count: deals.length,
      value: deals.reduce((s, d) => s + num(d.value), 0),
      deals: await Promise.all(deals.map(d => buildDeal(d, ctx))),
    };
  }));
  res.json({ stages: out });
});

router.get('/deals/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetDealParams })) return;
  if (!(await gateDeal(req, res, req.params.id))) return;
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, req.params.id));
  if (!d) { res.status(404).json({ error: 'not found' }); return; }
  const ctx = await dealCtx(getScope(req).tenantId);
  const base = await buildDeal(d, ctx);
  const [quotes, contracts, approvals, sigs, contacts, negs] = await Promise.all([
    db.select().from(quotesTable).where(eq(quotesTable.dealId, d.id)),
    db.select().from(contractsTable).where(eq(contractsTable.dealId, d.id)),
    db.select().from(approvalsTable).where(eq(approvalsTable.dealId, d.id)),
    db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.dealId, d.id)),
    db.select().from(contactsTable).where(eq(contactsTable.accountId, d.accountId)),
    db.select().from(negotiationsTable).where(eq(negotiationsTable.dealId, d.id)),
  ]);
  res.json({
    ...base,
    quotes: quotes.map(q => mapQuote(q, base.name)),
    contracts: contracts.map(c => mapContract(c, base.name)),
    approvals: await Promise.all(
      approvals.map(a => mapApproval(a, base.name, ctx.users, getScope(req).user.id, getScope(req).tenantId)),
    ),
    signatures: sigs.map(s => mapSignaturePackageSummary(s, base.name)),
    contacts,
    negotiations: negs.map(n => mapNegotiation(n, base.name)),
  });
});

router.patch('/deals/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdateDealParams, body: Z.UpdateDealBody })) return;
  if (!(await gateDeal(req, res, req.params.id))) return;
  const b = req.body;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ['name', 'stage', 'probability', 'riskLevel', 'nextStep', 'expectedCloseDate']) {
    if (b[k] !== undefined) update[k] = b[k];
  }
  if (b.value !== undefined) update.value = String(b.value);
  if (b.brandId !== undefined) {
    const bid = b.brandId === null ? null : String(b.brandId);
    if (bid !== null) {
      const [bb] = await db.select().from(brandsTable).where(eq(brandsTable.id, bid));
      if (!bb) { res.status(400).json({ error: 'brandId not found' }); return; }
      if (!(await brandVisible(req, bb))) { res.status(403).json({ error: 'brand not in scope' }); return; }
    }
    update.brandId = bid;
  }
  await db.update(dealsTable).set(update).where(eq(dealsTable.id, req.params.id));
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, req.params.id));
  if (!d) { res.status(404).json({ error: 'not found' }); return; }
  const ctx = await dealCtx(getScope(req).tenantId);
  res.json(await buildDeal(d, ctx));
});

router.get('/deals/:id/timeline', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetDealTimelineParams })) return;
  if (!(await gateDeal(req, res, req.params.id))) return;
  const rows = await db.select().from(timelineEventsTable)
    .where(eq(timelineEventsTable.dealId, req.params.id))
    .orderBy(desc(timelineEventsTable.at));
  const dealMap = await getDealMap();
  res.json(rows.map(t => ({
    id: t.id, type: t.type, title: t.title, description: t.description,
    actor: t.actor, dealId: t.dealId, dealName: t.dealId ? (dealMap.get(t.dealId)?.name ?? null) : null,
    at: iso(t.at)!,
  })));
});

// ── QUOTES ──
function mapQuote(q: typeof quotesTable.$inferSelect, dealName: string) {
  return {
    id: q.id, dealId: q.dealId, dealName,
    number: q.number, status: q.status, currentVersion: q.currentVersion,
    totalAmount: 0, discountPct: 0, marginPct: 0,
    currency: q.currency,
    createdAt: iso(q.createdAt)!,
    validUntil: typeof q.validUntil === 'string' ? q.validUntil : iso(q.validUntil)!.slice(0, 10),
    language: (q.language === 'en' ? 'en' : 'de') as 'de' | 'en',
  };
}

async function enrichQuote(q: typeof quotesTable.$inferSelect, dealName: string) {
  const versions = await db.select().from(quoteVersionsTable)
    .where(eq(quoteVersionsTable.quoteId, q.id))
    .orderBy(desc(quoteVersionsTable.version));
  const current = versions.find(v => v.version === q.currentVersion) ?? versions[0];
  return {
    ...mapQuote(q, dealName),
    totalAmount: num(current?.totalAmount),
    discountPct: num(current?.discountPct),
    marginPct: num(current?.marginPct),
  };
}

router.get('/quotes', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListQuotesQueryParams })) return;
  const filters = [];
  if (req.query.dealId) filters.push(eq(quotesTable.dealId, String(req.query.dealId)));
  if (req.query.status) filters.push(eq(quotesTable.status, String(req.query.status)));
  const dealIds = await scopedDealIds(req);
  if (dealIds.length === 0) { res.json([]); return; }
  filters.push(inArray(quotesTable.dealId, dealIds));
  const rows = await db.select().from(quotesTable)
    .where(and(...filters))
    .orderBy(desc(quotesTable.createdAt));
  const dealMap = await getDealMap();
  const out = await Promise.all(rows.map(q => enrichQuote(q, dealMap.get(q.dealId)?.name ?? 'Unknown')));
  res.json(out);
});

router.post('/quotes', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateQuoteBody })) return;
  const b = req.body as { dealId: string; validUntil?: string; language?: 'de' | 'en' };
  if (!(await gateDeal(req, res, b.dealId))) return;
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, b.dealId));
  if (!d) { res.status(404).json({ error: 'deal not found' }); return; }
  const id = `qt_${randomUUID().slice(0, 8)}`;
  const number = `Q-2026-${Math.floor(Math.random() * 9000) + 1000}`;
  const language = b.language && SUPPORTED_LOCALES.includes(b.language)
    ? b.language
    : await resolveDefaultLanguage({ brandId: d.brandId, tenantId: getScope(req).tenantId });
  await db.insert(quotesTable).values({
    id, dealId: d.id, number, status: 'draft', currentVersion: 1,
    currency: d.currency,
    language,
    validUntil: b.validUntil ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  });
  const qvId = `qv_${randomUUID().slice(0, 8)}`;
  await db.insert(quoteVersionsTable).values({
    id: qvId, quoteId: id, version: 1, totalAmount: String(d.value),
    discountPct: '0', marginPct: '35', status: 'draft', notes: 'Initial draft',
  });
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
  res.status(201).json(await enrichQuote(q!, d.name));
});

router.get('/quotes/current', async (req, res) => {
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : null;
  if (!accountId) { res.status(422).json({ error: 'accountId is required' }); return; }
  const accIds = await allowedAccountIds(req);
  if (!isAccountAllowed(accIds, accountId)) { res.status(404).json({ error: 'not found' }); return; }
  // Deals des Accounts → Quotes mit Status accepted → neuste Version.
  // WICHTIG: Schnittmenge mit allowedDealIds, sonst Datenleck für scope-restricted User.
  const deals = await db.select().from(dealsTable).where(eq(dealsTable.accountId, accountId));
  if (deals.length === 0) { res.status(404).json({ error: 'no accepted quote for account' }); return; }
  const allowedSet = new Set(await allowedDealIds(req));
  const dealIds = deals.map(d => d.id).filter(id => allowedSet.has(id));
  if (dealIds.length === 0) { res.status(404).json({ error: 'no accepted quote for account' }); return; }
  const quotes = await db.select().from(quotesTable)
    .where(and(eq(quotesTable.status, 'accepted'), inArray(quotesTable.dealId, dealIds)))
    .orderBy(desc(quotesTable.createdAt));
  if (quotes.length === 0) { res.status(404).json({ error: 'no accepted quote for account' }); return; }
  const q = quotes[0]!;
  const versions = await db.select().from(quoteVersionsTable)
    .where(eq(quoteVersionsTable.quoteId, q.id))
    .orderBy(desc(quoteVersionsTable.version));
  const v = versions[0];
  if (!v) { res.status(404).json({ error: 'quote without versions' }); return; }
  res.json({
    accountId,
    quoteId: q.id,
    versionId: v.id,
    version: v.version,
    status: q.status,
    total: num(v.totalAmount),
    currency: q.currency ?? 'EUR',
    acceptedAt: iso(q.createdAt),
  });
});

router.get('/quotes/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetQuoteParams })) return;
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, req.params.id));
  if (!q) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, q.dealId))) return;
  if (isInvalidAsOf(req.query.asOf)) { res.status(422).json({ error: 'invalid asOf' }); return; }
  const asOf = parseAsOf(req.query.asOf);
  if (asOf) {
    // Quote history lives in quote_versions (not entity_versions). Pick the
    // latest version whose createdAt <= asOf; validTo = createdAt of the
    // immediate successor (if any).
    const allVersions = await db.select().from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.quoteId, q.id))
      .orderBy(asc(quoteVersionsTable.createdAt));
    const idx = (() => {
      let last = -1;
      for (let i = 0; i < allVersions.length; i++) {
        if (allVersions[i]!.createdAt.getTime() <= asOf.getTime()) last = i;
      }
      return last;
    })();
    if (idx < 0) { res.status(404).json({ error: 'no snapshot for asOf' }); return; }
    const chosen = allVersions[idx]!;
    const next = allVersions[idx + 1];
    const lines = await db.select().from(lineItemsTable)
      .where(eq(lineItemsTable.quoteVersionId, chosen.id));
    const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, q.dealId));
    const base = await enrichQuote(q, d?.name ?? 'Unknown');
    res.json({
      ...base,
      versions: allVersions.map(v => ({
        id: v.id, quoteId: v.quoteId, version: v.version,
        totalAmount: num(v.totalAmount), discountPct: num(v.discountPct),
        marginPct: num(v.marginPct), status: v.status, notes: v.notes,
        createdAt: iso(v.createdAt)!,
      })),
      lineItems: lines.map(l => ({
        id: l.id, quoteVersionId: l.quoteVersionId, name: l.name,
        description: l.description, quantity: num(l.quantity),
        unitPrice: num(l.unitPrice), listPrice: num(l.listPrice),
        discountPct: num(l.discountPct), total: num(l.total),
      })),
      meta: {
        source: 'version',
        validFrom: iso(chosen.createdAt),
        validTo: next ? iso(next.createdAt) : null,
        generatedAt: new Date().toISOString(),
        asOf: asOf.toISOString(),
        version: chosen.version,
      },
    });
    return;
  }
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, q.dealId));
  const versions = await db.select().from(quoteVersionsTable)
    .where(eq(quoteVersionsTable.quoteId, q.id))
    .orderBy(desc(quoteVersionsTable.version));
  const current = versions.find(v => v.version === q.currentVersion) ?? versions[0];
  const lines = current
    ? await db.select().from(lineItemsTable).where(eq(lineItemsTable.quoteVersionId, current.id))
    : [];
  const base = await enrichQuote(q, d?.name ?? 'Unknown');
  res.json({
    ...base,
    versions: versions.map(v => ({
      id: v.id, quoteId: v.quoteId, version: v.version,
      totalAmount: num(v.totalAmount), discountPct: num(v.discountPct),
      marginPct: num(v.marginPct), status: v.status, notes: v.notes,
      createdAt: iso(v.createdAt)!,
    })),
    lineItems: lines.map(l => ({
      id: l.id, quoteVersionId: l.quoteVersionId, name: l.name,
      description: l.description, quantity: num(l.quantity),
      unitPrice: num(l.unitPrice), listPrice: num(l.listPrice),
      discountPct: num(l.discountPct), total: num(l.total),
    })),
    meta: {
      source: 'live',
      validFrom: iso(q.createdAt),
      validTo: null,
      generatedAt: new Date().toISOString(),
      version: q.currentVersion,
    },
  });
});

router.get('/quotes/:id/pdf', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetQuotePdfParams })) return;
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, req.params.id));
  if (!q) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, q.dealId))) return;
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, q.dealId));
  const versions = await db.select().from(quoteVersionsTable)
    .where(eq(quoteVersionsTable.quoteId, q.id))
    .orderBy(desc(quoteVersionsTable.version));
  const current = versions.find(v => v.version === q.currentVersion) ?? versions[0];
  const lines = current
    ? await db.select().from(lineItemsTable).where(eq(lineItemsTable.quoteVersionId, current.id))
    : [];
  const attachments = current
    ? await db.select().from(quoteAttachmentsTable)
        .where(eq(quoteAttachmentsTable.quoteVersionId, current.id))
        .orderBy(asc(quoteAttachmentsTable.order))
    : [];
  let brand: typeof brandsTable.$inferSelect | undefined;
  if (d?.brandId) {
    const [b] = await db.select().from(brandsTable).where(eq(brandsTable.id, d.brandId));
    brand = b;
  }
  const { renderQuotePdf } = await import('../pdf/quote');
  const stream = await renderQuotePdf({
    number: q.number,
    currency: q.currency,
    status: q.status,
    validUntil: String(q.validUntil),
    language: q.language === 'en' ? 'en' : 'de',
    dealName: d?.name ?? 'Unknown',
    version: current?.version ?? 1,
    totalAmount: num(current?.totalAmount),
    discountPct: num(current?.discountPct),
    marginPct: num(current?.marginPct),
    notes: current?.notes ?? null,
    lines: lines.map(l => ({
      name: l.name,
      description: l.description ?? null,
      quantity: num(l.quantity),
      unitPrice: num(l.unitPrice),
      listPrice: num(l.listPrice),
      discountPct: num(l.discountPct),
      total: num(l.total),
    })),
    brand: brand ? {
      name: brand.name,
      logoUrl: await resolveLogoForPdf(brand.logoUrl),
      primaryColor: brand.primaryColor ?? brand.color,
      secondaryColor: brand.secondaryColor ?? null,
      legalEntityName: brand.legalEntityName ?? null,
      addressLine: brand.addressLine ?? null,
      tone: brand.tone ?? null,
    } : null,
    sections: (current?.sectionsSnapshot ?? []) as Array<{ kind: string; title: string; body: string; order: number }>,
    attachments: attachments.map(a => ({
      name: a.name,
      label: a.label,
      mimeType: a.mimeType,
      size: a.size,
    })),
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="quote-${q.number}.pdf"`);
  stream.pipe(res);
});

// PATCH quote — currently only supports updating the language.
router.patch('/quotes/:id', async (req, res) => {
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, req.params.id));
  if (!q) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, q.dealId))) return;
  const body = (req.body ?? {}) as { language?: unknown };
  const patch: Partial<typeof quotesTable.$inferInsert> = {};
  if (body.language !== undefined) {
    if (typeof body.language !== 'string' || !SUPPORTED_LOCALES.includes(body.language as SupportedLocale)) {
      res.status(400).json({ error: 'language must be one of de|en' }); return;
    }
    if (body.language !== q.language) patch.language = body.language as SupportedLocale;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(quotesTable).set(patch).where(eq(quotesTable.id, q.id));
    await writeAuditFromReq(req, {
      entityType: 'quote', entityId: q.id, action: 'language_changed',
      summary: `Angebotssprache: ${q.language ?? 'de'} → ${patch.language}`,
      before: { language: q.language }, after: { language: patch.language },
    });
  }
  const [updated] = await db.select().from(quotesTable).where(eq(quotesTable.id, q.id));
  const dealMap = await getDealMap();
  res.json(mapQuote(updated!, dealMap.get(updated!.dealId)?.name ?? 'Unknown'));
});

router.post('/quotes/:id/versions', async (req, res) => {
  if (!validateInline(req, res, { params: Z.CreateQuoteVersionParams, body: Z.CreateQuoteVersionBody })) return;
  const b = req.body;
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, req.params.id));
  if (!q) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, q.dealId))) return;
  const versions = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, q.id));
  const current = versions.find(v => v.version === q.currentVersion);
  const baseTotal = num(current?.totalAmount) || 100000;
  const newTotal = baseTotal * (1 - (b.discountPct - num(current?.discountPct)) / 100);
  const newVersion = (versions.reduce((m, v) => Math.max(m, v.version), 0) || 0) + 1;
  const id = `qv_${randomUUID().slice(0, 8)}`;
  await db.insert(quoteVersionsTable).values({
    id, quoteId: q.id, version: newVersion,
    totalAmount: String(Math.round(newTotal)),
    discountPct: String(b.discountPct),
    marginPct: String(Math.max(15, num(current?.marginPct) - (b.discountPct - num(current?.discountPct)))),
    status: 'draft', notes: b.notes ?? `Version ${newVersion}`,
  });
  await db.update(quotesTable).set({ currentVersion: newVersion }).where(eq(quotesTable.id, q.id));
  const [created] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, id));
  res.status(201).json({
    id: created!.id, quoteId: created!.quoteId, version: created!.version,
    totalAmount: num(created!.totalAmount), discountPct: num(created!.discountPct),
    marginPct: num(created!.marginPct), status: created!.status, notes: created!.notes,
    createdAt: iso(created!.createdAt)!,
  });
});

router.post('/quotes/:id/accept', async (req, res) => {
  if (!validateInline(req, res, { params: Z.AcceptQuoteParams })) return;
  const [q0] = await db.select().from(quotesTable).where(eq(quotesTable.id, req.params.id));
  if (!q0) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, q0.dealId))) return;
  await db.update(quotesTable).set({ status: 'accepted' }).where(eq(quotesTable.id, req.params.id));
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, req.params.id));
  if (!q) { res.status(404).json({ error: 'not found' }); return; }
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, q.dealId));

  // Auto-Fill: Wenn der Deal noch keinen Wert hat (== 0), übernehme den
  // totalAmount der neusten Quote-Version. So können Vertriebler einen Deal
  // ohne Wert anlegen und ihn nach Angebotsannahme automatisch befüllen lassen.
  if (d && (Number(d.value) === 0 || d.value === null)) {
    const [latest] = await db.select().from(quoteVersionsTable)
      .where(eq(quoteVersionsTable.quoteId, q.id))
      .orderBy(desc(quoteVersionsTable.version))
      .limit(1);
    const total = latest ? Number(latest.totalAmount) : 0;
    if (total > 0) {
      await db.update(dealsTable)
        .set({ value: String(total), updatedAt: new Date() })
        .where(eq(dealsTable.id, d.id));
      await writeAuditFromReq(req, {
        entityType: 'deal', entityId: d.id, action: 'value_autofill',
        summary: `Deal-Wert automatisch aus akzeptiertem Angebot übernommen: ${total.toLocaleString('de-DE')} €`,
        before: { value: d.value },
        after: { value: total },
      });
    }
  }

  void emitEvent(getScope(req).tenantId, 'quote.accepted', { quoteId: q.id, dealId: q.dealId });
  res.json(await enrichQuote(q, d?.name ?? 'Unknown'));
});

// ── QUOTE TEMPLATES ──
type QuoteTemplateRow = typeof quoteTemplatesTable.$inferSelect;
type QuoteTemplateSectionRow = typeof quoteTemplateSectionsTable.$inferSelect;

/**
 * Visibility-Check für Rows mit (companyId|brandId|null,null) Scope-Stamping.
 * Wendet Permission ∩ Active-Filter konsistent an.
 */
async function scopedRowVisibleAsync(
  req: Request,
  row: { tenantId: string; companyId?: string | null; brandId?: string | null },
): Promise<boolean> {
  const scope = getScope(req);
  if (row.tenantId !== scope.tenantId) return false;
  if (scope.tenantWide && !hasActiveScopeFilter(scope)) return true;
  if (!row.companyId && !row.brandId) return !hasActiveScopeFilter(scope);
  const allowedC = await allowedCompanyIds(req);
  const allowedB = await allowedBrandIds(req);
  if (row.companyId && allowedC.includes(row.companyId)) return true;
  if (row.brandId && allowedB.includes(row.brandId)) return true;
  return false;
}

function mapQuoteTemplate(t: QuoteTemplateRow, sections: QuoteTemplateSectionRow[]) {
  return {
    id: t.id,
    tenantId: t.tenantId,
    companyId: t.companyId,
    brandId: t.brandId,
    name: t.name,
    description: t.description,
    industry: t.industry,
    isSystem: t.isSystem,
    defaultDiscountPct: num(t.defaultDiscountPct),
    defaultMarginPct: num(t.defaultMarginPct),
    defaultValidityDays: t.defaultValidityDays,
    defaultLineItems: t.defaultLineItems ?? [],
    defaultAttachmentLibraryIds: t.defaultAttachmentLibraryIds ?? [],
    sections: sections
      .filter(s => s.templateId === t.id)
      .sort((a, b) => a.order - b.order)
      .map(s => ({ id: s.id, kind: s.kind, title: s.title, body: s.body, order: s.order })),
    createdAt: iso(t.createdAt)!,
  };
}

router.get('/quote-templates', async (req, res) => {
  const scope = getScope(req);
  const filters = [eq(quoteTemplatesTable.tenantId, scope.tenantId)];
  if (req.query.industry) filters.push(eq(quoteTemplatesTable.industry, String(req.query.industry)));
  const rows = await db.select().from(quoteTemplatesTable)
    .where(and(...filters))
    .orderBy(asc(quoteTemplatesTable.name));
  const visFlags = await Promise.all(rows.map(t => scopedRowVisibleAsync(req, t)));
  const visible = rows.filter((_, i) => visFlags[i]);
  const ids = visible.map(t => t.id);
  const sections = ids.length
    ? await db.select().from(quoteTemplateSectionsTable).where(inArray(quoteTemplateSectionsTable.templateId, ids))
    : [];
  res.json(visible.map(t => mapQuoteTemplate(t, sections)));
});

router.get('/quote-templates/:id', async (req, res) => {
  const scope = getScope(req);
  const [t] = await db.select().from(quoteTemplatesTable).where(eq(quoteTemplatesTable.id, req.params.id));
  if (!t || !(await scopedRowVisibleAsync(req, t))) { res.status(404).json({ error: 'not found' }); return; }
  const sections = await db.select().from(quoteTemplateSectionsTable)
    .where(eq(quoteTemplateSectionsTable.templateId, t.id));
  res.json(mapQuoteTemplate(t, sections));
});

const QuoteTemplateSectionInput = z.object({
  kind: z.string().min(1).max(40),
  title: z.string().min(1).max(200),
  body: z.string().max(20000).optional().default(''),
  order: z.number().int().optional(),
});
const QuoteTemplateLineItemInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  quantity: z.number().nonnegative(),
  unitPrice: z.number().nonnegative(),
  listPrice: z.number().nonnegative(),
  discountPct: z.number().min(0).max(100),
});
const QuoteTemplateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  industry: z.string().min(1).max(60),
  companyId: z.string().optional().nullable(),
  brandId: z.string().optional().nullable(),
  defaultDiscountPct: z.number().min(0).max(100).optional().default(0),
  defaultMarginPct: z.number().min(0).max(100).optional().default(30),
  defaultValidityDays: z.number().int().min(1).max(365).optional().default(30),
  defaultLineItems: z.array(QuoteTemplateLineItemInput).optional().default([]),
  defaultAttachmentLibraryIds: z.array(z.string()).optional().default([]),
  sections: z.array(QuoteTemplateSectionInput).optional().default([]),
});

router.post('/quote-templates', async (req, res) => {
  if (!validateInline(req, res, { body: QuoteTemplateBody })) return;
  const scope = getScope(req);
  const b = req.body as z.infer<typeof QuoteTemplateBody>;
  if (b.brandId) {
    const [bb] = await db.select().from(brandsTable).where(eq(brandsTable.id, b.brandId));
    if (!bb || !(await brandVisible(req, bb))) { res.status(403).json({ error: 'brand not in scope' }); return; }
  }
  if (b.companyId && (!scope.tenantWide || hasActiveScopeFilter(scope))) {
    if (!(await allowedCompanyIds(req)).includes(b.companyId)) {
      res.status(403).json({ error: 'company not in scope' }); return;
    }
  }
  const id = `qtpl_${randomUUID().slice(0, 8)}`;
  await db.insert(quoteTemplatesTable).values({
    id, tenantId: scope.tenantId,
    companyId: b.companyId ?? null, brandId: b.brandId ?? null,
    name: b.name, description: b.description ?? '', industry: b.industry,
    isSystem: false,
    defaultDiscountPct: String(b.defaultDiscountPct ?? 0),
    defaultMarginPct: String(b.defaultMarginPct ?? 30),
    defaultValidityDays: b.defaultValidityDays ?? 30,
    defaultLineItems: b.defaultLineItems ?? [],
    defaultAttachmentLibraryIds: b.defaultAttachmentLibraryIds ?? [],
  });
  if (b.sections?.length) {
    await db.insert(quoteTemplateSectionsTable).values(
      b.sections.map((s, i) => ({
        id: `qtsec_${randomUUID().slice(0, 8)}`,
        templateId: id, kind: s.kind, title: s.title,
        body: s.body ?? '', order: s.order ?? i,
      })),
    );
  }
  const [t] = await db.select().from(quoteTemplatesTable).where(eq(quoteTemplatesTable.id, id));
  const sections = await db.select().from(quoteTemplateSectionsTable).where(eq(quoteTemplateSectionsTable.templateId, id));
  res.status(201).json(mapQuoteTemplate(t!, sections));
});

router.patch('/quote-templates/:id', async (req, res) => {
  if (!validateInline(req, res, { body: QuoteTemplateBody })) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(quoteTemplatesTable).where(eq(quoteTemplatesTable.id, req.params.id));
  if (!existing || !(await scopedRowVisibleAsync(req, existing))) { res.status(404).json({ error: 'not found' }); return; }
  if (existing.isSystem && !scope.tenantWide) { res.status(403).json({ error: 'cannot edit system template' }); return; }
  const b = req.body as z.infer<typeof QuoteTemplateBody>;
  // Prevent re-stamping the template to a target outside Permission ∩ Active.
  if (b.brandId) {
    const [bb] = await db.select().from(brandsTable).where(eq(brandsTable.id, b.brandId));
    if (!bb || !(await brandVisible(req, bb))) { res.status(403).json({ error: 'brand not in scope' }); return; }
  }
  if (b.companyId && (!scope.tenantWide || hasActiveScopeFilter(scope))) {
    if (!(await allowedCompanyIds(req)).includes(b.companyId)) {
      res.status(403).json({ error: 'company not in scope' }); return;
    }
  }
  await db.update(quoteTemplatesTable).set({
    name: b.name, description: b.description ?? '', industry: b.industry,
    companyId: b.companyId ?? null, brandId: b.brandId ?? null,
    defaultDiscountPct: String(b.defaultDiscountPct ?? 0),
    defaultMarginPct: String(b.defaultMarginPct ?? 30),
    defaultValidityDays: b.defaultValidityDays ?? 30,
    defaultLineItems: b.defaultLineItems ?? [],
    defaultAttachmentLibraryIds: b.defaultAttachmentLibraryIds ?? [],
  }).where(eq(quoteTemplatesTable.id, req.params.id));
  // Replace sections (idempotent)
  await db.delete(quoteTemplateSectionsTable).where(eq(quoteTemplateSectionsTable.templateId, req.params.id));
  if (b.sections?.length) {
    await db.insert(quoteTemplateSectionsTable).values(
      b.sections.map((s, i) => ({
        id: `qtsec_${randomUUID().slice(0, 8)}`,
        templateId: req.params.id, kind: s.kind, title: s.title,
        body: s.body ?? '', order: s.order ?? i,
      })),
    );
  }
  const [t] = await db.select().from(quoteTemplatesTable).where(eq(quoteTemplatesTable.id, req.params.id));
  const sections = await db.select().from(quoteTemplateSectionsTable).where(eq(quoteTemplateSectionsTable.templateId, req.params.id));
  res.json(mapQuoteTemplate(t!, sections));
});

router.delete('/quote-templates/:id', async (req, res) => {
  const scope = getScope(req);
  const [existing] = await db.select().from(quoteTemplatesTable).where(eq(quoteTemplatesTable.id, req.params.id));
  if (!existing || !(await scopedRowVisibleAsync(req, existing))) { res.status(404).json({ error: 'not found' }); return; }
  if (existing.isSystem) { res.status(403).json({ error: 'cannot delete system template' }); return; }
  await db.delete(quoteTemplateSectionsTable).where(eq(quoteTemplateSectionsTable.templateId, req.params.id));
  await db.delete(quoteTemplatesTable).where(eq(quoteTemplatesTable.id, req.params.id));
  res.status(204).end();
});

// ── ATTACHMENT LIBRARY ──
async function assertOwnedObjectPath(
  req: Request, res: Response, scope: ReturnType<typeof getScope>, objectPath: string,
): Promise<boolean> {
  if (!objectPath || !objectPath.startsWith('/objects/')) {
    res.status(400).json({ error: 'objectPath must start with /objects/' });
    return false;
  }
  const [row] = await db
    .select()
    .from(uploadedObjectsTable)
    .where(eq(uploadedObjectsTable.objectPath, objectPath));
  if (!row) {
    res.status(400).json({ error: 'objectPath not registered (use /storage/uploads/request-url first)' });
    return false;
  }
  if (row.tenantId !== scope.tenantId) {
    res.status(403).json({ error: 'objectPath not owned by tenant' });
    return false;
  }
  return true;
}

function mapAttachmentLibraryItem(a: typeof attachmentLibraryTable.$inferSelect) {
  return {
    id: a.id, tenantId: a.tenantId,
    companyId: a.companyId, brandId: a.brandId,
    name: a.name, description: a.description, category: a.category,
    tags: a.tags ?? [], mimeType: a.mimeType, size: a.size,
    objectPath: a.objectPath, version: a.version,
    createdBy: a.createdBy, createdAt: iso(a.createdAt)!,
  };
}

const AttachmentLibraryBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  category: z.enum(['datasheet', 'terms', 'reference', 'certificate', 'other']),
  tags: z.array(z.string()).optional().default([]),
  mimeType: z.string().min(1).max(120),
  size: z.number().int().nonnegative(),
  objectPath: z.string().min(1).max(500),
  companyId: z.string().optional().nullable(),
  brandId: z.string().optional().nullable(),
});

router.get('/attachment-library', async (req, res) => {
  const scope = getScope(req);
  const filters = [eq(attachmentLibraryTable.tenantId, scope.tenantId)];
  if (req.query.category) filters.push(eq(attachmentLibraryTable.category, String(req.query.category)));
  let rows = await db.select().from(attachmentLibraryTable).where(and(...filters)).orderBy(desc(attachmentLibraryTable.createdAt));
  const visFlags = await Promise.all(rows.map(a => scopedRowVisibleAsync(req, a)));
  rows = rows.filter((_, i) => visFlags[i]);
  if (req.query.tag) {
    const tag = String(req.query.tag).toLowerCase();
    rows = rows.filter(a => (a.tags ?? []).some(t => t.toLowerCase() === tag));
  }
  res.json(rows.map(mapAttachmentLibraryItem));
});

router.post('/attachment-library', async (req, res) => {
  if (!validateInline(req, res, { body: AttachmentLibraryBody })) return;
  const scope = getScope(req);
  const b = req.body as z.infer<typeof AttachmentLibraryBody>;
  if (b.brandId) {
    const [bb] = await db.select().from(brandsTable).where(eq(brandsTable.id, b.brandId));
    if (!bb || !(await brandVisible(req, bb))) { res.status(403).json({ error: 'brand not in scope' }); return; }
  }
  if (b.companyId && (!scope.tenantWide || hasActiveScopeFilter(scope))) {
    if (!(await allowedCompanyIds(req)).includes(b.companyId)) {
      res.status(403).json({ error: 'company not in scope' }); return;
    }
  }
  if (!(await assertOwnedObjectPath(req, res, scope, b.objectPath))) return;
  const id = `att_${randomUUID().slice(0, 8)}`;
  await db.insert(attachmentLibraryTable).values({
    id, tenantId: scope.tenantId,
    companyId: b.companyId ?? null, brandId: b.brandId ?? null,
    name: b.name, description: b.description ?? '', category: b.category,
    tags: b.tags ?? [], mimeType: b.mimeType, size: b.size,
    objectPath: b.objectPath, version: 1,
    createdBy: scope.user.id,
  });
  const [a] = await db.select().from(attachmentLibraryTable).where(eq(attachmentLibraryTable.id, id));
  res.status(201).json(mapAttachmentLibraryItem(a!));
});

router.delete('/attachment-library/:id', async (req, res) => {
  const scope = getScope(req);
  const [a] = await db.select().from(attachmentLibraryTable).where(eq(attachmentLibraryTable.id, req.params.id));
  if (!a || !(await scopedRowVisibleAsync(req, a))) { res.status(404).json({ error: 'not found' }); return; }
  await db.delete(attachmentLibraryTable).where(eq(attachmentLibraryTable.id, req.params.id));
  res.status(204).end();
});

// ── INDUSTRY PROFILES ──
function mapIndustryProfile(p: typeof industryProfilesTable.$inferSelect) {
  return {
    id: p.id, tenantId: p.tenantId, industry: p.industry, label: p.label,
    description: p.description, defaultClauseVariants: p.defaultClauseVariants ?? {},
    suggestedTemplateId: p.suggestedTemplateId,
    suggestedAttachmentLibraryIds: p.suggestedAttachmentLibraryIds ?? [],
    createdAt: iso(p.createdAt)!,
  };
}

const IndustryProfileBody = z.object({
  industry: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  defaultClauseVariants: z.record(z.string(), z.string()).optional().default({}),
  suggestedTemplateId: z.string().optional().nullable(),
  suggestedAttachmentLibraryIds: z.array(z.string()).optional().default([]),
});

router.get('/industry-profiles', async (req, res) => {
  const scope = getScope(req);
  const rows = await db.select().from(industryProfilesTable)
    .where(eq(industryProfilesTable.tenantId, scope.tenantId))
    .orderBy(asc(industryProfilesTable.label));
  res.json(rows.map(mapIndustryProfile));
});

router.post('/industry-profiles', async (req, res) => {
  if (!validateInline(req, res, { body: IndustryProfileBody })) return;
  const scope = getScope(req);
  const b = req.body as z.infer<typeof IndustryProfileBody>;
  const id = `iprof_${randomUUID().slice(0, 8)}`;
  await db.insert(industryProfilesTable).values({
    id, tenantId: scope.tenantId, industry: b.industry, label: b.label,
    description: b.description ?? '',
    defaultClauseVariants: b.defaultClauseVariants ?? {},
    suggestedTemplateId: b.suggestedTemplateId ?? null,
    suggestedAttachmentLibraryIds: b.suggestedAttachmentLibraryIds ?? [],
  });
  const [p] = await db.select().from(industryProfilesTable).where(eq(industryProfilesTable.id, id));
  res.status(201).json(mapIndustryProfile(p!));
});

router.patch('/industry-profiles/:id', async (req, res) => {
  if (!validateInline(req, res, { body: IndustryProfileBody })) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(industryProfilesTable).where(eq(industryProfilesTable.id, req.params.id));
  if (!existing || existing.tenantId !== scope.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  const b = req.body as z.infer<typeof IndustryProfileBody>;
  await db.update(industryProfilesTable).set({
    industry: b.industry, label: b.label, description: b.description ?? '',
    defaultClauseVariants: b.defaultClauseVariants ?? {},
    suggestedTemplateId: b.suggestedTemplateId ?? null,
    suggestedAttachmentLibraryIds: b.suggestedAttachmentLibraryIds ?? [],
  }).where(eq(industryProfilesTable.id, req.params.id));
  const [p] = await db.select().from(industryProfilesTable).where(eq(industryProfilesTable.id, req.params.id));
  res.json(mapIndustryProfile(p!));
});

router.delete('/industry-profiles/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.DeleteIndustryProfileParams })) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(industryProfilesTable).where(eq(industryProfilesTable.id, req.params.id));
  if (!existing || existing.tenantId !== scope.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  await db.delete(industryProfilesTable).where(eq(industryProfilesTable.id, req.params.id));
  await writeAuditFromReq(req, {
    entityType: 'industry_profile', entityId: req.params.id, action: 'deleted',
    summary: `Branchen-Profil "${existing.label}" gelöscht`,
  });
  res.status(204).end();
});

// ── QUOTE FROM TEMPLATE / LINE ITEMS / ATTACHMENTS ──
function calcLineTotal(item: { quantity: number; unitPrice: number; discountPct: number }) {
  return Math.round(item.quantity * item.unitPrice * (1 - item.discountPct / 100));
}

const QuoteFromTemplateBody = z.object({
  dealId: z.string().min(1),
  templateId: z.string().min(1),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(4000).optional(),
  attachmentLibraryIds: z.array(z.string()).optional(),
});

router.post('/quotes/from-template', async (req, res) => {
  if (!validateInline(req, res, { body: QuoteFromTemplateBody })) return;
  const scope = getScope(req);
  const b = req.body as z.infer<typeof QuoteFromTemplateBody>;
  if (!(await gateDeal(req, res, b.dealId))) return;
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, b.dealId));
  if (!d) { res.status(404).json({ error: 'deal not found' }); return; }
  const [tpl] = await db.select().from(quoteTemplatesTable).where(eq(quoteTemplatesTable.id, b.templateId));
  if (!tpl || !(await scopedRowVisibleAsync(req, tpl))) { res.status(404).json({ error: 'template not found' }); return; }

  const validUntil = b.validUntil ?? new Date(Date.now() + tpl.defaultValidityDays * 86400000).toISOString().slice(0, 10);
  const id = `qt_${randomUUID().slice(0, 8)}`;
  const number = `Q-2026-${Math.floor(Math.random() * 9000) + 1000}`;
  await db.insert(quotesTable).values({
    id, dealId: d.id, number, status: 'draft', currentVersion: 1,
    currency: d.currency, validUntil,
  });
  const qvId = `qv_${randomUUID().slice(0, 8)}`;
  const tplLines = tpl.defaultLineItems ?? [];
  const lineRows = tplLines.map(li => {
    const total = calcLineTotal(li);
    return {
      id: `li_${randomUUID().slice(0, 8)}`,
      quoteVersionId: qvId, name: li.name, description: li.description ?? null,
      quantity: String(li.quantity), unitPrice: String(li.unitPrice),
      listPrice: String(li.listPrice), discountPct: String(li.discountPct),
      total: String(total),
    };
  });
  const totalAmount = lineRows.reduce((s, l) => s + Number(l.total), 0);
  const tplSections = await db.select().from(quoteTemplateSectionsTable)
    .where(eq(quoteTemplateSectionsTable.templateId, tpl.id))
    .orderBy(asc(quoteTemplateSectionsTable.order));
  const sectionsSnapshot = tplSections.map(s => ({
    kind: s.kind, title: s.title, body: s.body, order: s.order,
  }));
  await db.insert(quoteVersionsTable).values({
    id: qvId, quoteId: id, version: 1,
    totalAmount: String(totalAmount),
    discountPct: String(tpl.defaultDiscountPct ?? 0),
    marginPct: String(tpl.defaultMarginPct ?? 30),
    status: 'draft',
    notes: b.notes ?? `Created from template "${tpl.name}"`,
    templateId: tpl.id,
    sectionsSnapshot,
  });
  if (lineRows.length) {
    await db.insert(lineItemsTable).values(lineRows);
  }

  // Attach library items: combine template defaults + explicit override
  const attIds = Array.from(new Set([
    ...(tpl.defaultAttachmentLibraryIds ?? []),
    ...(b.attachmentLibraryIds ?? []),
  ]));
  if (attIds.length) {
    const libsAll = await db.select().from(attachmentLibraryTable)
      .where(and(eq(attachmentLibraryTable.tenantId, scope.tenantId), inArray(attachmentLibraryTable.id, attIds)));
    const visFlags = await Promise.all(libsAll.map(a => scopedRowVisibleAsync(req, a)));
    const libs = libsAll.filter((_, i) => visFlags[i]);
    if (libs.length) {
      await db.insert(quoteAttachmentsTable).values(libs.map((a, i) => ({
        id: `qatt_${randomUUID().slice(0, 8)}`,
        quoteVersionId: qvId, libraryAssetId: a.id,
        name: a.name, mimeType: a.mimeType, size: a.size,
        objectPath: a.objectPath, label: a.description || null,
        order: i,
      })));
    }
  }

  // Return enriched quote detail (re-uses /quotes/:id logic shape)
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
  const versions = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, id));
  const lines = await db.select().from(lineItemsTable).where(eq(lineItemsTable.quoteVersionId, qvId));
  const base = await enrichQuote(q!, d.name);
  res.status(201).json({
    ...base,
    versions: versions.map(v => ({
      id: v.id, quoteId: v.quoteId, version: v.version,
      totalAmount: num(v.totalAmount), discountPct: num(v.discountPct),
      marginPct: num(v.marginPct), status: v.status, notes: v.notes,
      createdAt: iso(v.createdAt)!,
    })),
    lineItems: lines.map(l => ({
      id: l.id, quoteVersionId: l.quoteVersionId, name: l.name,
      description: l.description, quantity: num(l.quantity),
      unitPrice: num(l.unitPrice), listPrice: num(l.listPrice),
      discountPct: num(l.discountPct), total: num(l.total),
    })),
    meta: {
      source: 'live', validFrom: iso(q!.createdAt), validTo: null,
      generatedAt: new Date().toISOString(), version: 1,
    },
  });
});

const ReplaceLineItemsBody = z.object({
  items: z.array(z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    quantity: z.number().nonnegative(),
    unitPrice: z.number().nonnegative(),
    listPrice: z.number().nonnegative(),
    discountPct: z.number().min(0).max(100),
  })),
});

async function replaceLineItemsHandler(req: Request, res: Response, qvIdParam: string) {
  if (!validateInline(req, res, { body: ReplaceLineItemsBody })) return;
  const [qv] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, qvIdParam));
  if (!qv) { res.status(404).json({ error: 'version not found' }); return; }
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, qv.quoteId));
  if (!q) { res.status(404).json({ error: 'quote not found' }); return; }
  if (!(await gateDeal(req, res, q.dealId))) return;
  if (qv.status !== 'draft') { res.status(409).json({ error: 'version not draft' }); return; }
  const b = req.body as z.infer<typeof ReplaceLineItemsBody>;
  await db.delete(lineItemsTable).where(eq(lineItemsTable.quoteVersionId, qv.id));
  const rows = b.items.map(li => {
    const total = calcLineTotal(li);
    return {
      id: `li_${randomUUID().slice(0, 8)}`,
      quoteVersionId: qv.id, name: li.name,
      description: li.description ?? null,
      quantity: String(li.quantity), unitPrice: String(li.unitPrice),
      listPrice: String(li.listPrice), discountPct: String(li.discountPct),
      total: String(total),
    };
  });
  if (rows.length) await db.insert(lineItemsTable).values(rows);
  const totalAmount = rows.reduce((s, r) => s + Number(r.total), 0);
  await db.update(quoteVersionsTable)
    .set({ totalAmount: String(totalAmount) })
    .where(eq(quoteVersionsTable.id, qv.id));
  res.json({
    items: rows.map(r => ({
      id: r.id, quoteVersionId: r.quoteVersionId, name: r.name,
      description: r.description, quantity: Number(r.quantity),
      unitPrice: Number(r.unitPrice), listPrice: Number(r.listPrice),
      discountPct: Number(r.discountPct), total: Number(r.total),
    })),
    totalAmount,
  });
}

router.put('/quote-versions/:id/line-items', (req, res) =>
  replaceLineItemsHandler(req, res, req.params.id),
);

// Spec-compatibility alias: PATCH /quotes/:id/versions/:vid/line-items
router.patch('/quotes/:id/versions/:vid/line-items', async (req, res) => {
  const [qv] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, req.params.vid));
  if (!qv || qv.quoteId !== req.params.id) {
    res.status(404).json({ error: 'version not found' });
    return;
  }
  return replaceLineItemsHandler(req, res, req.params.vid);
});

function mapQuoteAttachment(a: typeof quoteAttachmentsTable.$inferSelect) {
  return {
    id: a.id, quoteVersionId: a.quoteVersionId,
    libraryAssetId: a.libraryAssetId, name: a.name, label: a.label,
    mimeType: a.mimeType, size: a.size, objectPath: a.objectPath,
    order: a.order, createdAt: iso(a.createdAt)!,
  };
}

router.get('/quote-versions/:id/attachments', async (req, res) => {
  const [qv] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, req.params.id));
  if (!qv) { res.status(404).json({ error: 'version not found' }); return; }
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, qv.quoteId));
  if (!q) { res.status(404).json({ error: 'quote not found' }); return; }
  if (!(await gateDeal(req, res, q.dealId))) return;
  const rows = await db.select().from(quoteAttachmentsTable)
    .where(eq(quoteAttachmentsTable.quoteVersionId, qv.id))
    .orderBy(asc(quoteAttachmentsTable.order));
  res.json(rows.map(mapQuoteAttachment));
});

const QuoteAttachmentBody = z.object({
  libraryAssetId: z.string().optional(),
  name: z.string().max(200).optional(),
  label: z.string().max(200).optional(),
  mimeType: z.string().max(120).optional(),
  size: z.number().int().nonnegative().optional(),
  objectPath: z.string().max(500).optional(),
  order: z.number().int().optional(),
});

router.post('/quote-versions/:id/attachments', async (req, res) => {
  if (!validateInline(req, res, { body: QuoteAttachmentBody })) return;
  const scope = getScope(req);
  const [qv] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, req.params.id));
  if (!qv) { res.status(404).json({ error: 'version not found' }); return; }
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, qv.quoteId));
  if (!q) { res.status(404).json({ error: 'quote not found' }); return; }
  if (!(await gateDeal(req, res, q.dealId))) return;
  if (qv.status !== 'draft') { res.status(409).json({ error: 'version not draft' }); return; }
  const b = req.body as z.infer<typeof QuoteAttachmentBody>;

  let payload: typeof quoteAttachmentsTable.$inferInsert;
  if (b.libraryAssetId) {
    const [a] = await db.select().from(attachmentLibraryTable).where(eq(attachmentLibraryTable.id, b.libraryAssetId));
    if (!a || !(await scopedRowVisibleAsync(req, a))) { res.status(404).json({ error: 'library asset not found' }); return; }
    payload = {
      id: `qatt_${randomUUID().slice(0, 8)}`,
      quoteVersionId: qv.id, libraryAssetId: a.id,
      name: b.name ?? a.name, mimeType: a.mimeType, size: a.size,
      objectPath: a.objectPath, label: b.label ?? a.description ?? null,
      order: b.order ?? 0,
    };
  } else {
    if (!b.name || !b.mimeType || b.size == null || !b.objectPath) {
      res.status(400).json({ error: 'name, mimeType, size, objectPath required for ad-hoc attachment' });
      return;
    }
    if (!(await assertOwnedObjectPath(req, res, scope, b.objectPath))) return;
    payload = {
      id: `qatt_${randomUUID().slice(0, 8)}`,
      quoteVersionId: qv.id, libraryAssetId: null,
      name: b.name, mimeType: b.mimeType, size: b.size,
      objectPath: b.objectPath, label: b.label ?? null,
      order: b.order ?? 0,
    };
  }
  await db.insert(quoteAttachmentsTable).values(payload);
  const [created] = await db.select().from(quoteAttachmentsTable).where(eq(quoteAttachmentsTable.id, payload.id));
  res.status(201).json(mapQuoteAttachment(created!));
});

router.delete('/quote-attachments/:id', async (req, res) => {
  const [a] = await db.select().from(quoteAttachmentsTable).where(eq(quoteAttachmentsTable.id, req.params.id));
  if (!a) { res.status(404).json({ error: 'not found' }); return; }
  const [qv] = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.id, a.quoteVersionId));
  if (!qv) { res.status(404).json({ error: 'version not found' }); return; }
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, qv.quoteId));
  if (!q) { res.status(404).json({ error: 'quote not found' }); return; }
  if (!(await gateDeal(req, res, q.dealId))) return;
  if (qv.status !== 'draft') { res.status(409).json({ error: 'version not draft' }); return; }
  await db.delete(quoteAttachmentsTable).where(eq(quoteAttachmentsTable.id, req.params.id));
  res.status(204).end();
});

// ── PRICING ──
function mapPricePosition(p: typeof pricePositionsTable.$inferSelect, brandName: string, companyName: string) {
  return {
    id: p.id, sku: p.sku, name: p.name, category: p.category,
    listPrice: num(p.listPrice), currency: p.currency, status: p.status,
    validFrom: typeof p.validFrom === 'string' ? p.validFrom : iso(p.validFrom)!.slice(0, 10),
    validUntil: p.validUntil ? (typeof p.validUntil === 'string' ? p.validUntil : iso(p.validUntil)!.slice(0, 10)) : null,
    brandId: p.brandId, brandName, companyId: p.companyId, companyName,
    version: p.version, isStandard: p.isStandard,
  };
}

router.get('/price-positions', async (req, res) => {
  const scope = getScope(req);
  // Tenant-bound: only positions whose company belongs to the user's tenant.
  const rows = await db
    .select({ p: pricePositionsTable })
    .from(pricePositionsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, pricePositionsTable.companyId))
    .where(eq(companiesTable.tenantId, scope.tenantId));
  const tenantRows = rows.map(r => r.p);
  const brands = await getBrandMap();
  const companies = await getCompanyMap();
  const allowC = await allowedCompanyIds(req);
  const allowB = await allowedBrandIds(req);
  const filtered = (scope.tenantWide && !hasActiveScopeFilter(scope))
    ? tenantRows
    : tenantRows.filter(p => allowC.includes(p.companyId) || allowB.includes(p.brandId));
  res.json(filtered.map(p => mapPricePosition(p, brands.get(p.brandId)?.name ?? '', companies.get(p.companyId)?.name ?? '')));
});

router.post('/price-positions', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreatePricePositionBody })) return;
  const scope = getScope(req);
  const b = req.body;
  // Scope-check target brand/company. Apply intersection (Permission ∩ Active).
  if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
    const brandAllowed = (await allowedBrandIds(req)).includes(b.brandId);
    const companyAllowed = (await allowedCompanyIds(req)).includes(b.companyId);
    if (!brandAllowed && !companyAllowed) { res.status(403).json({ error: 'forbidden' }); return; }
  } else {
    // tenantWide must still be bound to own tenant: verify company belongs to tenant.
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, b.companyId));
    if (!co || co.tenantId !== scope.tenantId) { res.status(403).json({ error: 'forbidden' }); return; }
  }
  const id = `pp_${randomUUID().slice(0, 8)}`;
  await db.insert(pricePositionsTable).values({
    id, sku: b.sku, name: b.name, category: b.category, listPrice: String(b.listPrice),
    currency: b.currency, status: 'draft', validFrom: b.validFrom, validUntil: null,
    brandId: b.brandId, companyId: b.companyId, version: 1, isStandard: true,
  });
  const [p] = await db.select().from(pricePositionsTable).where(eq(pricePositionsTable.id, id));
  const brands = await getBrandMap();
  const companies = await getCompanyMap();
  res.status(201).json(mapPricePosition(p!, brands.get(p!.brandId)?.name ?? '', companies.get(p!.companyId)?.name ?? ''));
});

router.patch('/price-positions/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdatePricePositionParams, body: Z.UpdatePricePositionBody })) return;
  const stP = await entityScopeStatus(req, 'price_position', req.params.id);
  if (stP !== 'ok') { res.status(stP === 'missing' ? 404 : 403).json({ error: stP === 'missing' ? 'not found' : 'forbidden' }); return; }
  const [existing] = await db.select().from(pricePositionsTable).where(eq(pricePositionsTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  const b = req.body;
  // Brand-Wechsel respektiert das Scope-Modell: das neue Brand muss im Tenant sein.
  if (b.brandId && b.brandId !== existing.brandId) {
    const [br] = await db.select().from(brandsTable).where(eq(brandsTable.id, b.brandId));
    if (!br || br.companyId !== existing.companyId) { res.status(422).json({ error: 'brand outside company scope' }); return; }
  }
  const patch: Partial<typeof pricePositionsTable.$inferInsert> = {};
  if (b.sku !== undefined) patch.sku = b.sku;
  if (b.name !== undefined) patch.name = b.name;
  if (b.category !== undefined) patch.category = b.category;
  if (b.listPrice !== undefined) patch.listPrice = String(b.listPrice);
  if (b.currency !== undefined) patch.currency = b.currency;
  if (b.status !== undefined) patch.status = b.status;
  if (b.validFrom !== undefined) patch.validFrom = b.validFrom;
  if (b.validUntil !== undefined) patch.validUntil = b.validUntil;
  if (b.brandId !== undefined) patch.brandId = b.brandId;
  if (b.isStandard !== undefined) patch.isStandard = b.isStandard;
  if (Object.keys(patch).length > 0) {
    await db.update(pricePositionsTable).set(patch).where(eq(pricePositionsTable.id, req.params.id));
  }
  await writeAuditFromReq(req, {
    entityType: 'price_position', entityId: req.params.id, action: 'updated',
    summary: `Preis ${existing.sku} aktualisiert`,
  });
  const [p] = await db.select().from(pricePositionsTable).where(eq(pricePositionsTable.id, req.params.id));
  const brands = await getBrandMap();
  const companies = await getCompanyMap();
  res.json(mapPricePosition(p!, brands.get(p!.brandId)?.name ?? '', companies.get(p!.companyId)?.name ?? ''));
});

router.delete('/price-positions/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.DeletePricePositionParams })) return;
  const stP = await entityScopeStatus(req, 'price_position', req.params.id);
  if (stP !== 'ok') { res.status(stP === 'missing' ? 404 : 403).json({ error: stP === 'missing' ? 'not found' : 'forbidden' }); return; }
  const [existing] = await db.select().from(pricePositionsTable).where(eq(pricePositionsTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  await db.delete(pricePositionsTable).where(eq(pricePositionsTable.id, req.params.id));
  await writeAuditFromReq(req, {
    entityType: 'price_position', entityId: req.params.id, action: 'deleted',
    summary: `Preis ${existing.sku} gelöscht`,
  });
  res.status(204).end();
});

router.get('/price-rules', async (req, res) => {
  const scope = getScope(req);
  // Tenant-bound: rule-scope must be 'global' or a companyId/brandId inside
  // the user's tenant. Global rules are only shown if the user has a tenant.
  const [tenantCoRows, tenantBrRows] = await Promise.all([
    db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.tenantId, scope.tenantId)),
    db.select({ id: brandsTable.id })
      .from(brandsTable)
      .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
      .where(eq(companiesTable.tenantId, scope.tenantId)),
  ]);
  const tenantCos = new Set(tenantCoRows.map(c => c.id));
  const tenantBrs = new Set(tenantBrRows.map(b => b.id));
  const rows = await db.select().from(priceRulesTable).where(eq(priceRulesTable.tenantId, scope.tenantId));
  const tenantRows = rows.filter(r =>
    r.scope === 'global' || tenantCos.has(r.scope) || tenantBrs.has(r.scope));
  if (scope.tenantWide && !hasActiveScopeFilter(scope)) { res.json(tenantRows); return; }
  const allowedBrandsArr = await allowedBrandIds(req);
  const allowedCompaniesArr = await allowedCompanyIds(req);
  const allowedScopes = new Set<string>(['global', ...allowedCompaniesArr, ...allowedBrandsArr]);
  res.json(tenantRows.filter(r => allowedScopes.has(r.scope)));
});

// F03 PriceRule CRUD: scope ist 'global' | brandId | companyId — alle drei Pfade müssen
// auf den eigenen Tenant beschränkt bleiben, sonst kann ein Tenant globale Rules
// für andere überschreiben (Sicherheitsrelevant).
// Hinweis: Tenant-Ownership existierender Rules wird über `priceRulesTable.tenantId`
// vor dem Aufruf geprüft (siehe PATCH/DELETE). Diese Funktion validiert nur den
// *Ziel*-Scope-String relativ zum aufrufenden Tenant + Permission-Scope.
async function ensureRuleScopeAllowed(req: import('express').Request, scopeStr: string): Promise<true | { status: number; error: string }> {
  if (scopeStr === 'global') return true;
  // Tenant-bound check
  const scope = getScope(req);
  const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, scopeStr));
  if (co) {
    if (co.tenantId !== scope.tenantId) return { status: 403, error: 'forbidden' };
    if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
      const allowed = await allowedCompanyIds(req);
      if (!allowed.includes(co.id)) return { status: 403, error: 'forbidden' };
    }
    return true;
  }
  const [br] = await db.select().from(brandsTable).where(eq(brandsTable.id, scopeStr));
  if (br) {
    const [bco] = await db.select().from(companiesTable).where(eq(companiesTable.id, br.companyId));
    if (!bco || bco.tenantId !== scope.tenantId) return { status: 403, error: 'forbidden' };
    if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
      const allowed = await allowedBrandIds(req);
      if (!allowed.includes(br.id)) return { status: 403, error: 'forbidden' };
    }
    return true;
  }
  return { status: 422, error: 'unknown scope (must be "global", companyId or brandId)' };
}

router.post('/price-rules', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreatePriceRuleBody })) return;
  const b = req.body;
  const ok = await ensureRuleScopeAllowed(req, b.scope);
  if (ok !== true) { res.status(ok.status).json({ error: ok.error }); return; }
  const scope = getScope(req);
  const id = `pr_${randomUUID().slice(0, 8)}`;
  await db.insert(priceRulesTable).values({
    id, tenantId: scope.tenantId,
    name: b.name, scope: b.scope, condition: b.condition, effect: b.effect,
    priority: b.priority, status: b.status ?? 'draft',
  });
  await writeAuditFromReq(req, {
    entityType: 'price_rule', entityId: id, action: 'created',
    summary: `Pricing-Regel "${b.name}" angelegt`,
  });
  const [r] = await db.select().from(priceRulesTable).where(eq(priceRulesTable.id, id));
  res.status(201).json(r);
});

router.patch('/price-rules/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdatePriceRuleParams, body: Z.UpdatePriceRuleBody })) return;
  const [existing] = await db.select().from(priceRulesTable).where(eq(priceRulesTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  // Tenant-Ownership zuerst (auch für scope='global'!).
  const callerScope = getScope(req);
  if (existing.tenantId !== callerScope.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  // Permission-Scope für aktuellen Scope-String.
  const ok1 = await ensureRuleScopeAllowed(req, existing.scope);
  if (ok1 !== true) { res.status(ok1.status).json({ error: ok1.error }); return; }
  const b = req.body;
  // Bei Scope-Wechsel zusätzlich Ziel-Scope prüfen.
  if (b.scope && b.scope !== existing.scope) {
    const ok2 = await ensureRuleScopeAllowed(req, b.scope);
    if (ok2 !== true) { res.status(ok2.status).json({ error: ok2.error }); return; }
  }
  const patch: Partial<typeof priceRulesTable.$inferInsert> = {};
  if (b.name !== undefined) patch.name = b.name;
  if (b.scope !== undefined) patch.scope = b.scope;
  if (b.condition !== undefined) patch.condition = b.condition;
  if (b.effect !== undefined) patch.effect = b.effect;
  if (b.priority !== undefined) patch.priority = b.priority;
  if (b.status !== undefined) patch.status = b.status;
  if (Object.keys(patch).length > 0) {
    await db.update(priceRulesTable).set(patch).where(eq(priceRulesTable.id, req.params.id));
  }
  await writeAuditFromReq(req, {
    entityType: 'price_rule', entityId: req.params.id, action: 'updated',
    summary: `Pricing-Regel "${existing.name}" aktualisiert`,
  });
  const [r] = await db.select().from(priceRulesTable).where(eq(priceRulesTable.id, req.params.id));
  res.json(r);
});

router.delete('/price-rules/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.DeletePriceRuleParams })) return;
  const [existing] = await db.select().from(priceRulesTable).where(eq(priceRulesTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  const callerScope = getScope(req);
  if (existing.tenantId !== callerScope.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  const ok = await ensureRuleScopeAllowed(req, existing.scope);
  if (ok !== true) { res.status(ok.status).json({ error: ok.error }); return; }
  await db.delete(priceRulesTable).where(eq(priceRulesTable.id, req.params.id));
  await writeAuditFromReq(req, {
    entityType: 'price_rule', entityId: req.params.id, action: 'deleted',
    summary: `Pricing-Regel "${existing.name}" gelöscht`,
  });
  res.status(204).end();
});

router.get('/pricing/summary', async (req, res) => {
  const scope = getScope(req);
  // Tenant-bound: only positions whose company belongs to the user's tenant.
  const tenantPositions = (await db
    .select({ p: pricePositionsTable })
    .from(pricePositionsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, pricePositionsTable.companyId))
    .where(eq(companiesTable.tenantId, scope.tenantId))
  ).map(r => r.p);
  const allowedBrands = new Set(await allowedBrandIds(req));
  const allowedCompanies = new Set(await allowedCompanyIds(req));
  const positions = (scope.tenantWide && !hasActiveScopeFilter(scope))
    ? tenantPositions
    : tenantPositions.filter(p => allowedBrands.has(p.brandId) || allowedCompanies.has(p.companyId));
  const dealIds = await scopedDealIds(req);
  const pendingApprovalCount = dealIds.length === 0 ? 0 : (await db
    .select({ c: sql<number>`count(*)::int` })
    .from(approvalsTable)
    .where(and(
      eq(approvalsTable.status, 'pending'),
      eq(approvalsTable.type, 'discount'),
      inArray(approvalsTable.dealId, dealIds),
    )))[0]?.c ?? 0;
  res.json({
    totalPositions: positions.length,
    activePositions: positions.filter(p => p.status === 'active').length,
    pendingApprovalCount,
    standardCoveragePct: Math.round(positions.filter(p => p.isStandard).length / Math.max(1, positions.length) * 1000) / 10,
    recentChanges: [
      { id: 'rc_1', sku: 'HX-CORE-LIC', change: 'List price uplift to EUR 240,000', at: iso(new Date(Date.now() - 2 * 86400000))! },
      { id: 'rc_2', sku: 'HX-PRO-LIC',  change: 'New version v2 published',         at: iso(new Date(Date.now() - 5 * 86400000))! },
      { id: 'rc_3', sku: 'HX-VEL-LIC',  change: 'Created as draft (US)',            at: iso(new Date(Date.now() - 7 * 86400000))! },
    ],
  });
});

// ── APPROVALS ──
import { canUserDecideStage, currentStage as getCurrentStage, buildApprovalStageFields } from '../lib/approvalChains';

async function mapApproval(
  a: typeof approvalsTable.$inferSelect, dealName: string,
  users: Map<string, typeof usersTable.$inferSelect>,
  callerUserId: string, tenantId: string,
) {
  const stages = (a.stages ?? []) as ApprovalStage[];
  const stagesOut = stages.map((s) => ({
    order: s.order,
    label: s.label,
    approverRole: s.approverRole ?? null,
    approverUserId: s.approverUserId ?? null,
    status: s.status,
    decidedBy: s.decidedBy ?? null,
    decidedByName: s.decidedBy ? users.get(s.decidedBy)?.name ?? null : null,
    decidedAt: s.decidedAt ?? null,
    delegatedFrom: s.delegatedFrom ?? null,
    delegatedFromName: s.delegatedFrom ? users.get(s.delegatedFrom)?.name ?? null : null,
    comment: s.comment ?? null,
  }));
  // canDecide: nur wenn Approval noch offen ist
  let canDecide = false;
  let canDecideOnBehalfOf: string | null = null;
  const isOpen = a.status !== 'approved' && a.status !== 'rejected';
  if (isOpen) {
    if (stages.length > 0) {
      const stage = getCurrentStage(stages, a.currentStageIdx);
      if (stage && stage.status === 'pending') {
        const r = await canUserDecideStage(callerUserId, stage, tenantId);
        canDecide = r.allowed;
        canDecideOnBehalfOf = r.delegatedFrom;
      }
    } else {
      // Legacy single-stage: jeder mit deal-scope darf entscheiden (bisheriges Verhalten)
      canDecide = true;
    }
  }
  return {
    id: a.id, dealId: a.dealId, dealName, type: a.type, reason: a.reason,
    requestedBy: a.requestedBy, requestedByName: users.get(a.requestedBy)?.name ?? 'Unknown',
    status: a.status, priority: a.priority, createdAt: iso(a.createdAt)!,
    deadline: iso(a.deadline), impactValue: num(a.impactValue), currency: a.currency,
    decidedAt: iso(a.decidedAt), decidedBy: a.decidedBy, decisionComment: a.decisionComment,
    amendmentId: a.amendmentId,
    chainTemplateId: a.chainTemplateId ?? null,
    stages: stagesOut,
    currentStageIdx: a.currentStageIdx,
    canDecide,
    canDecideOnBehalfOf,
  };
}

router.get('/approvals', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListApprovalsQueryParams })) return;
  const filters = [];
  if (req.query.status) filters.push(eq(approvalsTable.status, String(req.query.status)));
  if (req.query.amendmentId) filters.push(eq(approvalsTable.amendmentId, String(req.query.amendmentId)));
  const dealIds = await scopedDealIds(req);
  if (dealIds.length === 0) { res.json([]); return; }
  filters.push(inArray(approvalsTable.dealId, dealIds));
  const rows = await db.select().from(approvalsTable).where(and(...filters)).orderBy(desc(approvalsTable.createdAt));
  const dealMap = await getDealMap();
  const scope = getScope(req);
  const users = await getUserMap(scope.tenantId);
  const out = await Promise.all(
    rows.map(a => mapApproval(a, dealMap.get(a.dealId)?.name ?? 'Unknown', users, scope.user.id, scope.tenantId)),
  );
  res.json(out);
});

router.post('/approvals/:id/decide', async (req, res) => {
  if (!validateInline(req, res, { params: Z.DecideApprovalParams, body: Z.DecideApprovalBody })) return;
  const b = req.body;
  const [pre] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, req.params.id));
  if (!pre) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, pre.dealId))) return;
  if (pre.status === 'approved' || pre.status === 'rejected') {
    res.status(409).json({ error: 'approval already decided' });
    return;
  }
  const scope = getScope(req);
  const decisionRaw = String(b.decision ?? '').toLowerCase();
  const decision: 'approve' | 'reject' | null =
    decisionRaw === 'approve' || decisionRaw === 'approved' ? 'approve' :
    decisionRaw === 'reject' || decisionRaw === 'rejected' ? 'reject' : null;
  if (!decision) {
    // Legacy: erlaube freie status-Strings nur wenn keine Stages existieren.
    if ((pre.stages ?? []).length > 0) {
      res.status(400).json({ error: 'decision must be "approve" or "reject" for staged approvals' });
      return;
    }
  }
  const stages = (pre.stages ?? []) as ApprovalStage[];

  if (stages.length > 0) {
    const idx = pre.currentStageIdx;
    const stage = stages[idx];
    if (!stage || stage.status !== 'pending') {
      res.status(409).json({ error: 'no pending stage to decide' });
      return;
    }
    const perm = await canUserDecideStage(scope.user.id, stage, scope.tenantId);
    if (!perm.allowed) {
      res.status(403).json({ error: 'not allowed to decide this stage' });
      return;
    }
    const nowIso = new Date().toISOString();
    const newStages = stages.map((s, i) => {
      if (i !== idx) return s;
      return {
        ...s,
        status: decision === 'approve' ? 'approved' as const : 'rejected' as const,
        decidedBy: scope.user.id,
        decidedAt: nowIso,
        delegatedFrom: perm.delegatedFrom,
        comment: b.comment ?? null,
      };
    });
    let newOverallStatus = pre.status;
    let newIdx = idx;
    let setDecidedAt: Date | null = null;
    let setDecidedBy: string | null = null;
    let setComment: string | null = null;
    if (decision === 'reject') {
      newOverallStatus = 'rejected';
      setDecidedAt = new Date();
      setDecidedBy = scope.user.id;
      setComment = b.comment ?? null;
    } else {
      // approve
      const isLast = idx >= stages.length - 1;
      if (isLast) {
        newOverallStatus = 'approved';
        setDecidedAt = new Date();
        setDecidedBy = scope.user.id;
        setComment = b.comment ?? null;
      } else {
        newIdx = idx + 1;
        // Status bleibt 'pending'/'in_review' — die nächste Stage ist jetzt offen.
      }
    }
    await db.update(approvalsTable).set({
      stages: newStages,
      currentStageIdx: newIdx,
      status: newOverallStatus,
      decidedAt: setDecidedAt ?? pre.decidedAt,
      decidedBy: setDecidedBy ?? pre.decidedBy,
      decisionComment: setComment ?? pre.decisionComment,
    }).where(eq(approvalsTable.id, req.params.id));
    void emitEvent(scope.tenantId, 'approval.stage.decided', {
      approvalId: pre.id, dealId: pre.dealId, stageOrder: stage.order,
      decision: decision === 'approve' ? 'approved' : 'rejected',
      decidedBy: scope.user.id,
      delegatedFrom: perm.delegatedFrom,
    });
    if (newOverallStatus === 'approved' || newOverallStatus === 'rejected') {
      void emitEvent(scope.tenantId, 'approval.decided', {
        approvalId: pre.id, dealId: pre.dealId, decision: newOverallStatus,
      });
    }
  } else {
    // Legacy single-stage path (backwards-compatible)
    await db.update(approvalsTable).set({
      status: b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : b.decision,
      decisionComment: b.comment ?? null, decidedAt: new Date(), decidedBy: scope.user.id,
    }).where(eq(approvalsTable.id, req.params.id));
    void emitEvent(scope.tenantId, 'approval.decided', {
      approvalId: pre.id, dealId: pre.dealId,
      decision: b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : b.decision,
    });
  }

  const [a] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, req.params.id));
  if (!a) { res.status(404).json({ error: 'not found' }); return; }
  const dealMap = await getDealMap();
  const users = await getUserMap(scope.tenantId);
  res.json(await mapApproval(a, dealMap.get(a.dealId)?.name ?? 'Unknown', users, scope.user.id, scope.tenantId));
});

// ── APPROVAL CHAIN TEMPLATES (Tenant-Admin) ──
// Achtung: tenantWide bedeutet nur volle Daten-Sichtbarkeit, NICHT Admin.
// Admin-Rechte verlangen explizit role="Tenant Admin" (oder Platform-Admin).
function isTenantAdmin(req: Request): boolean {
  const u = getScope(req).user;
  if (u.isPlatformAdmin) return true;
  const role = (u.role ?? '').trim().toLowerCase();
  return role === 'tenant admin' || role === 'tenant_admin';
}

function mapChain(t: typeof approvalChainTemplatesTable.$inferSelect) {
  return {
    id: t.id, tenantId: t.tenantId, name: t.name,
    description: t.description ?? null,
    triggerType: t.triggerType,
    conditions: (t.conditions ?? []) as ApprovalChainCondition[],
    stages: (t.stages ?? []) as ApprovalChainStageDef[],
    priority: t.priority,
    active: t.active,
    createdAt: iso(t.createdAt)!,
  };
}

router.get('/approval-chains', async (req, res) => {
  const scope = getScope(req);
  const rows = await db.select().from(approvalChainTemplatesTable)
    .where(eq(approvalChainTemplatesTable.tenantId, scope.tenantId))
    .orderBy(asc(approvalChainTemplatesTable.priority), asc(approvalChainTemplatesTable.name));
  res.json(rows.map(mapChain));
});

router.post('/approval-chains', async (req, res) => {
  if (!isTenantAdmin(req)) { res.status(403).json({ error: 'tenant admin required' }); return; }
  if (!validateInline(req, res, { body: Z.CreateApprovalChainBody })) return;
  const b = req.body;
  if (!b.stages || b.stages.length === 0) { res.status(400).json({ error: 'at least one stage required' }); return; }
  for (const s of b.stages) {
    if (!s.approverRole && !s.approverUserId) {
      res.status(400).json({ error: `stage ${s.order} requires approverRole or approverUserId` });
      return;
    }
  }
  const id = `apc_${randomUUID().slice(0, 8)}`;
  const scope = getScope(req);
  await db.insert(approvalChainTemplatesTable).values({
    id, tenantId: scope.tenantId, name: b.name,
    description: b.description ?? null,
    triggerType: b.triggerType,
    conditions: (b.conditions ?? []) as ApprovalChainCondition[],
    stages: b.stages as ApprovalChainStageDef[],
    priority: typeof b.priority === 'number' ? b.priority : 100,
    active: typeof b.active === 'boolean' ? b.active : true,
  });
  const [row] = await db.select().from(approvalChainTemplatesTable).where(eq(approvalChainTemplatesTable.id, id));
  res.status(201).json(mapChain(row!));
});

router.patch('/approval-chains/:id', async (req, res) => {
  if (!isTenantAdmin(req)) { res.status(403).json({ error: 'tenant admin required' }); return; }
  if (!validateInline(req, res, { params: Z.UpdateApprovalChainParams, body: Z.UpdateApprovalChainBody })) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(approvalChainTemplatesTable)
    .where(and(
      eq(approvalChainTemplatesTable.id, req.params.id),
      eq(approvalChainTemplatesTable.tenantId, scope.tenantId),
    ));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  const b = req.body;
  if (b.stages && b.stages.length > 0) {
    for (const s of b.stages) {
      if (!s.approverRole && !s.approverUserId) {
        res.status(400).json({ error: `stage ${s.order} requires approverRole or approverUserId` });
        return;
      }
    }
  }
  await db.update(approvalChainTemplatesTable).set({
    name: b.name,
    description: b.description ?? null,
    triggerType: b.triggerType,
    conditions: (b.conditions ?? []) as ApprovalChainCondition[],
    stages: b.stages as ApprovalChainStageDef[],
    priority: typeof b.priority === 'number' ? b.priority : existing.priority,
    active: typeof b.active === 'boolean' ? b.active : existing.active,
  }).where(eq(approvalChainTemplatesTable.id, req.params.id));
  const [row] = await db.select().from(approvalChainTemplatesTable).where(eq(approvalChainTemplatesTable.id, req.params.id));
  res.json(mapChain(row!));
});

router.delete('/approval-chains/:id', async (req, res) => {
  if (!isTenantAdmin(req)) { res.status(403).json({ error: 'tenant admin required' }); return; }
  const scope = getScope(req);
  const [existing] = await db.select().from(approvalChainTemplatesTable)
    .where(and(
      eq(approvalChainTemplatesTable.id, req.params.id),
      eq(approvalChainTemplatesTable.tenantId, scope.tenantId),
    ));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  await db.delete(approvalChainTemplatesTable).where(eq(approvalChainTemplatesTable.id, req.params.id));
  res.status(204).end();
});

// ── USER DELEGATIONS ──
function mapDelegation(
  d: typeof userDelegationsTable.$inferSelect,
  users: Map<string, typeof usersTable.$inferSelect>,
) {
  return {
    id: d.id, fromUserId: d.fromUserId,
    fromUserName: users.get(d.fromUserId)?.name ?? null,
    toUserId: d.toUserId,
    toUserName: users.get(d.toUserId)?.name ?? null,
    reason: d.reason ?? null,
    validFrom: iso(d.validFrom)!, validUntil: iso(d.validUntil)!,
    active: d.active, createdAt: iso(d.createdAt)!,
  };
}

router.get('/me/delegations', async (req, res) => {
  const scope = getScope(req);
  const all = await db.select().from(userDelegationsTable)
    .where(eq(userDelegationsTable.tenantId, scope.tenantId));
  const users = await getUserMap(scope.tenantId);
  const outgoing = all.filter(d => d.fromUserId === scope.user.id).map(d => mapDelegation(d, users));
  const incoming = all.filter(d => d.toUserId === scope.user.id).map(d => mapDelegation(d, users));
  res.json({ outgoing, incoming });
});

router.post('/me/delegations', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateMyDelegationBody })) return;
  const b = req.body;
  const scope = getScope(req);
  if (b.toUserId === scope.user.id) { res.status(400).json({ error: 'cannot delegate to self' }); return; }
  const [target] = await db.select().from(usersTable).where(eq(usersTable.id, b.toUserId));
  if (!target || target.tenantId !== scope.tenantId) {
    res.status(400).json({ error: 'target user not in tenant' });
    return;
  }
  const validFrom = new Date(b.validFrom);
  const validUntil = new Date(b.validUntil);
  if (!(validFrom < validUntil)) { res.status(400).json({ error: 'validFrom must be before validUntil' }); return; }
  const id = `udl_${randomUUID().slice(0, 8)}`;
  await db.insert(userDelegationsTable).values({
    id, tenantId: scope.tenantId,
    fromUserId: scope.user.id, toUserId: b.toUserId,
    reason: b.reason ?? null,
    validFrom, validUntil, active: true,
  });
  const [row] = await db.select().from(userDelegationsTable).where(eq(userDelegationsTable.id, id));
  const users = await getUserMap(scope.tenantId);
  res.status(201).json(mapDelegation(row!, users));
});

router.patch('/me/delegations/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdateMyDelegationParams, body: Z.UpdateMyDelegationBody })) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(userDelegationsTable)
    .where(and(
      eq(userDelegationsTable.id, req.params.id),
      eq(userDelegationsTable.tenantId, scope.tenantId),
      eq(userDelegationsTable.fromUserId, scope.user.id),
    ));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  const b = req.body;
  const patch: Partial<typeof userDelegationsTable.$inferInsert> = {};
  if (typeof b.toUserId === 'string') {
    if (b.toUserId === scope.user.id) { res.status(400).json({ error: 'cannot delegate to self' }); return; }
    const [target] = await db.select().from(usersTable).where(eq(usersTable.id, b.toUserId));
    if (!target || target.tenantId !== scope.tenantId) { res.status(400).json({ error: 'target user not in tenant' }); return; }
    patch.toUserId = b.toUserId;
  }
  if ('reason' in b) patch.reason = b.reason ?? null;
  if (typeof b.validFrom === 'string') patch.validFrom = new Date(b.validFrom);
  if (typeof b.validUntil === 'string') patch.validUntil = new Date(b.validUntil);
  if (typeof b.active === 'boolean') patch.active = b.active;
  const newFrom = patch.validFrom ?? existing.validFrom;
  const newUntil = patch.validUntil ?? existing.validUntil;
  if (!(newFrom < newUntil)) { res.status(400).json({ error: 'validFrom must be before validUntil' }); return; }
  if (Object.keys(patch).length > 0) {
    await db.update(userDelegationsTable).set(patch).where(eq(userDelegationsTable.id, req.params.id));
  }
  const [row] = await db.select().from(userDelegationsTable).where(eq(userDelegationsTable.id, req.params.id));
  const users = await getUserMap(scope.tenantId);
  res.json(mapDelegation(row!, users));
});

router.delete('/me/delegations/:id', async (req, res) => {
  const scope = getScope(req);
  const [existing] = await db.select().from(userDelegationsTable)
    .where(and(
      eq(userDelegationsTable.id, req.params.id),
      eq(userDelegationsTable.tenantId, scope.tenantId),
      eq(userDelegationsTable.fromUserId, scope.user.id),
    ));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  await db.delete(userDelegationsTable).where(eq(userDelegationsTable.id, req.params.id));
  res.status(204).end();
});

// ── CONTRACTS ──
function mapContract(c: typeof contractsTable.$inferSelect, dealName: string, clauses?: { severity: string }[]) {
  const sevWeight: Record<string, number> = { high: 25, medium: 10, low: 3 };
  const raw = (clauses ?? []).reduce((s, cl) => s + (sevWeight[cl.severity] ?? 0), 0);
  const riskScore = Math.min(100, raw);
  return {
    id: c.id, dealId: c.dealId, dealName, title: c.title, status: c.status,
    version: c.version, riskLevel: c.riskLevel, riskScore, createdAt: iso(c.createdAt)!,
    template: c.template,
    validUntil: c.validUntil ? (typeof c.validUntil === 'string' ? c.validUntil : iso(c.validUntil)!.slice(0, 10)) : null,
    language: normalizeLocale(c.language),
  };
}

const SUPPORTED_LOCALES = ['de', 'en'] as const;
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

function normalizeLocale(value: string | null | undefined): SupportedLocale {
  return value === 'en' ? 'en' : 'de';
}

async function resolveDefaultLanguage(opts: {
  brandId?: string | null;
  tenantId: string;
}): Promise<SupportedLocale> {
  if (opts.brandId) {
    const [b] = await db.select().from(brandsTable).where(eq(brandsTable.id, opts.brandId));
    if (b?.defaultLanguage) return normalizeLocale(b.defaultLanguage);
  }
  const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, opts.tenantId));
  if (t?.defaultLanguage) return normalizeLocale(t.defaultLanguage);
  return 'de';
}

async function loadVariantTranslations(variantIds: string[]): Promise<Map<string, Map<string, typeof clauseVariantTranslationsTable.$inferSelect>>> {
  if (variantIds.length === 0) return new Map();
  const rows = await db.select().from(clauseVariantTranslationsTable)
    .where(inArray(clauseVariantTranslationsTable.variantId, variantIds));
  const out = new Map<string, Map<string, typeof clauseVariantTranslationsTable.$inferSelect>>();
  for (const r of rows) {
    let inner = out.get(r.variantId);
    if (!inner) { inner = new Map(); out.set(r.variantId, inner); }
    inner.set(r.locale, r);
  }
  return out;
}

function pickClauseTranslation(
  variant: typeof clauseVariantsTable.$inferSelect | undefined,
  translations: Map<string, typeof clauseVariantTranslationsTable.$inferSelect> | undefined,
  locale: SupportedLocale,
): { name: string | null; summary: string | null; body: string | null; usedLocale: SupportedLocale; missing: boolean } {
  const t = translations?.get(locale);
  if (t) {
    return { name: t.name, summary: t.summary, body: t.body, usedLocale: locale, missing: false };
  }
  // Locale missing → fallback to base variant ('de' source) but flag as missing if the
  // requested locale was non-DE.
  return {
    name: variant?.name ?? null,
    summary: variant?.summary ?? null,
    body: variant?.body ?? null,
    usedLocale: 'de',
    missing: locale !== 'de',
  };
}

router.get('/contracts', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListContractsQueryParams })) return;
  const dealIds = await scopedDealIds(req);
  if (dealIds.length === 0) { res.json([]); return; }
  const filters = [inArray(contractsTable.dealId, dealIds)];
  if (req.query.dealId) filters.push(eq(contractsTable.dealId, String(req.query.dealId)));
  const rows = await db.select().from(contractsTable).where(and(...filters)).orderBy(desc(contractsTable.createdAt));
  const dealMap = await getDealMap();
  const allClauses = await db.select().from(contractClausesTable);
  const clausesByContract = new Map<string, typeof allClauses>();
  for (const cl of allClauses) {
    const arr = clausesByContract.get(cl.contractId) ?? [];
    arr.push(cl);
    clausesByContract.set(cl.contractId, arr);
  }
  res.json(rows.map(c => mapContract(c, dealMap.get(c.dealId)?.name ?? 'Unknown', clausesByContract.get(c.id))));
});

router.post('/contracts', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateContractBody })) return;
  const b = req.body as { dealId: string; title: string; template: string; brandId?: string; language?: 'de' | 'en' };
  if (!(await gateDeal(req, res, b.dealId))) return;
  // Pre-validate brand (existence + visibility) BEFORE any writes.
  let brandForSeed: typeof brandsTable.$inferSelect | undefined;
  let effectiveBrandId: string | null = b.brandId ?? null;
  if (!effectiveBrandId) {
    const [deal] = await db.select().from(dealsTable).where(eq(dealsTable.id, b.dealId));
    effectiveBrandId = deal?.brandId ?? null;
  }
  if (effectiveBrandId) {
    const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, effectiveBrandId));
    if (!brand) { res.status(404).json({ error: 'brand not found' }); return; }
    if (!(await brandVisible(req, brand))) { res.status(403).json({ error: 'forbidden' }); return; }
    brandForSeed = brand;
  }
  const tenantIdForSeed = getScope(req).tenantId;
  const language: SupportedLocale = b.language && SUPPORTED_LOCALES.includes(b.language)
    ? b.language
    : await resolveDefaultLanguage({ brandId: effectiveBrandId, tenantId: tenantIdForSeed });
  const id = `ctr_${randomUUID().slice(0, 8)}`;
  await db.insert(contractsTable).values({
    id, dealId: b.dealId, title: b.title, status: 'drafting',
    version: 1, riskLevel: 'low', template: b.template,
    language,
    validUntil: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
  });
  // Seed clauses from brand defaults if provided
  if (brandForSeed) {
    const brand = brandForSeed;
    if (brand.defaultClauseVariants) {
      const families = await db.select().from(clauseFamiliesTable);
      const variants = await db.select().from(clauseVariantsTable);
      const vById = new Map(variants.map(v => [v.id, v]));
      // Lade alle Brand-Overrides einmal
      const overrides = await db.select().from(brandClauseVariantOverridesTable).where(and(
        eq(brandClauseVariantOverridesTable.tenantId, tenantIdForSeed),
        eq(brandClauseVariantOverridesTable.brandId, brand.id),
      ));
      const ovByVariant = new Map(overrides.map(o => [o.baseVariantId, o]));
      // Lade Übersetzungen für die Vertragssprache, damit der Snapshot
      // (variant/summary) bereits in der richtigen Sprache materialisiert wird.
      const seedVariantIds = families
        .map(f => (brand.defaultClauseVariants as Record<string, string>)[f.id])
        .filter((v): v is string => Boolean(v));
      const trMap = await loadVariantTranslations(seedVariantIds);
      const rows = families
        .map(f => {
          const vId = (brand.defaultClauseVariants as Record<string, string>)[f.id];
          const v = vId ? vById.get(vId) : undefined;
          if (!v) return null;
          const ov = ovByVariant.get(v.id);
          const resolved = applyOverride(v, ov, brand.id);
          const sev = resolved.severity || severityLabelFromScore(resolved.severityScore);
          // Brand-Override hat Vorrang vor der Übersetzung; ohne Override wird
          // die Locale-Variante verwendet (Fallback DE).
          let snapName = resolved.name;
          let snapSummary = resolved.summary;
          if (!ov) {
            const tr = pickClauseTranslation(v, trMap.get(v.id), language);
            if (tr.name) snapName = tr.name;
            if (tr.summary) snapSummary = tr.summary;
          }
          return {
            id: `cc_${randomUUID().slice(0, 8)}`,
            contractId: id, familyId: f.id, activeVariantId: v.id,
            family: f.name, variant: snapName, severity: sev, summary: snapSummary,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (rows.length) await db.insert(contractClausesTable).values(rows);
    }
  }
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, id));
  const dealMap = await getDealMap();
  res.status(201).json(mapContract(c!, dealMap.get(c!.dealId)?.name ?? 'Unknown'));
});

// PATCH contract — currently only supports updating the language.
router.patch('/contracts/:id', async (req, res) => {
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  const body = (req.body ?? {}) as { language?: unknown };
  const patch: Partial<typeof contractsTable.$inferInsert> = {};
  if (body.language !== undefined) {
    if (typeof body.language !== 'string' || !SUPPORTED_LOCALES.includes(body.language as SupportedLocale)) {
      res.status(400).json({ error: 'language must be one of de|en' }); return;
    }
    if (body.language === c.language) {
      // no-op
    } else {
      patch.language = body.language as SupportedLocale;
    }
  }
  if (Object.keys(patch).length > 0) {
    await db.update(contractsTable).set(patch).where(eq(contractsTable.id, c.id));
    await writeAuditFromReq(req, {
      entityType: 'contract', entityId: c.id, action: 'language_changed',
      summary: `Vertragssprache: ${c.language ?? 'de'} → ${patch.language}`,
      before: { language: c.language }, after: { language: patch.language },
    });
  }
  const [updated] = await db.select().from(contractsTable).where(eq(contractsTable.id, c.id));
  const dealMap = await getDealMap();
  res.json(mapContract(updated!, dealMap.get(updated!.dealId)?.name ?? 'Unknown'));
});

function mapBrand(b: typeof brandsTable.$inferSelect) {
  return {
    id: b.id, companyId: b.companyId, name: b.name, color: b.color, voice: b.voice,
    defaultClauseVariants: b.defaultClauseVariants ?? {},
    logoUrl: b.logoUrl ?? null,
    primaryColor: b.primaryColor ?? null,
    secondaryColor: b.secondaryColor ?? null,
    tone: b.tone ?? null,
    legalEntityName: b.legalEntityName ?? null,
    addressLine: b.addressLine ?? null,
    parentBrandId: b.parentBrandId ?? null,
  };
}

async function brandVisible(req: Request, b: typeof brandsTable.$inferSelect): Promise<boolean> {
  const scope = getScope(req);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, b.companyId));
  if (!company || company.tenantId !== scope.tenantId) return false;
  // Permission ∩ Active für jeden nicht-tenant-weit-uneingeschränkten Fall.
  if (scope.tenantWide && !hasActiveScopeFilter(scope)) return true;
  const allowedC = await allowedCompanyIds(req);
  const allowedB = await allowedBrandIds(req);
  if (allowedC.includes(b.companyId)) return true;
  if (allowedB.includes(b.id)) return true;
  return false;
}

router.get('/brands', async (req, res) => {
  const scope = getScope(req);
  const rows = await db
    .select()
    .from(brandsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
    .where(eq(companiesTable.tenantId, scope.tenantId));
  const brands = rows.map(r => r.brands);
  if (scope.tenantWide && !hasActiveScopeFilter(scope)) {
    res.json(brands.map(mapBrand)); return;
  }
  const allowedC = new Set(await allowedCompanyIds(req));
  const allowedB = new Set(await allowedBrandIds(req));
  res.json(brands.filter(b => allowedC.has(b.companyId) || allowedB.has(b.id)).map(mapBrand));
});

router.patch('/brands/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdateBrandParams, body: Z.UpdateBrandBody })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(brandsTable).where(eq(brandsTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, existing.companyId));
  if (!company || company.tenantId !== scope.tenantId) {
    res.status(403).json({ error: 'forbidden' }); return;
  }
  if (!(await brandVisible(req, existing))) {
    res.status(403).json({ error: 'forbidden' }); return;
  }
  const body: Record<string, unknown> = req.body ?? {};
  const patch: Partial<typeof brandsTable.$inferInsert> = {};
  // parentBrandId separat behandeln (nullable, mit Self-/Company-Validation).
  if ('parentBrandId' in body) {
    const v = body.parentBrandId;
    if (v === null || v === '') {
      patch.parentBrandId = null;
    } else if (typeof v === 'string') {
      if (v === existing.id) { res.status(422).json({ error: 'parentBrandId must not equal own id' }); return; }
      const [parent] = await db.select().from(brandsTable).where(eq(brandsTable.id, v));
      if (!parent) { res.status(422).json({ error: 'parentBrandId not found' }); return; }
      if (parent.companyId !== existing.companyId) {
        res.status(422).json({ error: 'parent brand must belong to same company' }); return;
      }
      // Verhindere triviale Zyklen: kein Vorfahre darf sich auf existing.id beziehen.
      let cur: typeof brandsTable.$inferSelect | null = parent;
      const visited = new Set<string>();
      while (cur && cur.parentBrandId) {
        if (visited.has(cur.id)) break;
        visited.add(cur.id);
        if (cur.parentBrandId === existing.id) {
          res.status(422).json({ error: 'parentBrandId would create a cycle' }); return;
        }
        const [next] = await db.select().from(brandsTable).where(eq(brandsTable.id, cur.parentBrandId));
        cur = next ?? null;
      }
      patch.parentBrandId = v;
    }
  }
  const strFields = ['name', 'color', 'voice', 'logoUrl', 'primaryColor', 'secondaryColor', 'tone', 'legalEntityName', 'addressLine'] as const;
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  for (const k of strFields) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v !== null && typeof v !== 'string') continue;
    if (v !== null) {
      // logoUrl may be an inline data: URI (PNG/SVG) which legitimately exceeds
      // the short text limit. Cap at 256 KB to bound DB row size.
      const maxLen = k === 'logoUrl' ? 256 * 1024 : 512;
      if (v.length > maxLen) { res.status(400).json({ error: `${k} too long` }); return; }
      if ((k === 'color' || k === 'primaryColor' || k === 'secondaryColor') && v !== '' && !hexRe.test(v)) {
        res.status(400).json({ error: `${k} must be #RRGGBB hex` }); return;
      }
      if (k === 'logoUrl' && v !== '') {
        const lower = v.toLowerCase();
        const okStored = lower.startsWith('/api/storage/') || lower.startsWith('/storage/') || lower.startsWith('/objects/');
        const okData = lower.startsWith('data:image/svg+xml') || lower.startsWith('data:image/png') || lower.startsWith('data:image/jpeg');
        const okHttps = lower.startsWith('https://');
        if (!(okStored || okData || okHttps)) {
          res.status(400).json({ error: 'logoUrl must be https://, data:image/*, or a stored object path' }); return;
        }
        if (okHttps && /\/(?:api\/)?(?:storage\/)?objects\//i.test(v)) {
          res.status(400).json({ error: 'logoUrl must not embed an /objects/ path inside an HTTPS URL' }); return;
        }
        if (okStored) {
          const m = v.match(/^(?:\/api)?\/storage\/objects\/(.+)$/) ?? v.match(/^\/objects\/(.+)$/);
          if (!m) { res.status(400).json({ error: 'logoUrl: malformed stored path' }); return; }
          const objectPath = `/objects/${m[1]}`;
          if (!(await assertOwnedObjectPath(req, res, scope, objectPath))) return;
          (patch as Record<string, unknown>)[k] = objectPath;
          continue;
        }
      }
    }
    (patch as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(brandsTable).set(patch).where(eq(brandsTable.id, existing.id));
  }
  const [updated] = await db.select().from(brandsTable).where(eq(brandsTable.id, existing.id));
  await writeAuditFromReq(req, {    entityType: 'brand',
    entityId: existing.id,
    action: 'update',
    actor: scope.user.name,
    summary: `Brand "${existing.name}" aktualisiert`,
    before: existing,
    after: updated,
  });
  res.json(mapBrand(updated!));
});

router.patch('/brands/:id/default-clauses', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdateBrandDefaultClausesParams, body: Z.UpdateBrandDefaultClausesBody })) return;
  const body: { defaults?: Record<string, string> } = req.body ?? {};
  const { defaults } = body;
  if (!defaults || typeof defaults !== 'object') {
    res.status(400).json({ error: 'defaults required' }); return;
  }
  const [existing] = await db.select().from(brandsTable).where(eq(brandsTable.id, req.params.id));
  if (!existing) { res.status(404).json({ error: 'brand not found' }); return; }
  if (!(await brandVisible(req, existing))) {
    res.status(403).json({ error: 'forbidden' }); return;
  }
  const variants = await db.select().from(clauseVariantsTable);
  const vById = new Map(variants.map(v => [v.id, v]));
  for (const [famId, varId] of Object.entries(defaults)) {
    const v = vById.get(varId);
    if (!v || v.familyId !== famId) {
      res.status(400).json({ error: `variant ${varId} does not belong to family ${famId}` });
      return;
    }
  }
  await db.update(brandsTable)
    .set({ defaultClauseVariants: defaults })
    .where(eq(brandsTable.id, req.params.id));
  await writeAuditFromReq(req, {    entityType: 'brand', entityId: req.params.id, action: 'default_clauses_updated',
    summary: `Brand defaults aktualisiert (${Object.keys(defaults).length} Familien)`,
    before: existing.defaultClauseVariants, after: defaults,
  });
  const [updated] = await db.select().from(brandsTable).where(eq(brandsTable.id, req.params.id));
  res.json(mapBrand(updated!));
});

router.get('/contracts/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetContractParams })) return;
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  if (isInvalidAsOf(req.query.asOf)) { res.status(422).json({ error: 'invalid asOf' }); return; }
  const asOf = parseAsOf(req.query.asOf);
  if (asOf) {
    type ContractSnap =
      | { contract: typeof contractsTable.$inferSelect; clauses: (typeof contractClausesTable.$inferSelect)[] }
      | (typeof contractsTable.$inferSelect);
    const snap = await resolveSnapshot<ContractSnap>('contract', c.id, asOf);
    if (!snap) { res.status(404).json({ error: 'no snapshot for asOf' }); return; }
    const hasWrapper = snap.data && typeof snap.data === 'object' && 'contract' in (snap.data as Record<string, unknown>);
    const snapC = hasWrapper
      ? (snap.data as { contract: Partial<typeof contractsTable.$inferSelect> }).contract
      : (snap.data as Partial<typeof contractsTable.$inferSelect>);
    // Merge over live contract so response shape stays canonical even when
    // older/thin snapshots are missing fields.
    const rehydrated: typeof contractsTable.$inferSelect = {
      ...c,
      ...(snapC ?? {}),
      createdAt: snapC?.createdAt
        ? new Date(snapC.createdAt as unknown as string)
        : c.createdAt,
    };
    const snapClauses = hasWrapper
      ? ((snap.data as { clauses?: (typeof contractClausesTable.$inferSelect)[] }).clauses ?? [])
      : [];
    // If snapshot didn't store clauses, fall back to the live clauses (shape
    // consistency > point-in-time clause fidelity for thin legacy snapshots).
    const effectiveClauses = snapClauses.length > 0
      ? snapClauses
      : await db.select().from(contractClausesTable).where(eq(contractClausesTable.contractId, c.id));
    const dealMapA = await getDealMap();
    const variantsAllA = await db.select().from(clauseVariantsTable);
    const vByIdA = new Map(variantsAllA.map(v => [v.id, v]));
    const languageA = normalizeLocale(rehydrated.language);
    const variantIdsA = effectiveClauses.map(cl => cl.activeVariantId).filter((v): v is string => Boolean(v));
    const trMapA = await loadVariantTranslations(variantIdsA);
    const mappedClauses = effectiveClauses.map(cl => {
      const active = cl.activeVariantId ? vByIdA.get(cl.activeVariantId) : undefined;
      const tr = pickClauseTranslation(active, cl.activeVariantId ? trMapA.get(cl.activeVariantId) : undefined, languageA);
      return {
        id: cl.id, contractId: cl.contractId, family: cl.family,
        variant: tr.name ?? cl.variant,
        severity: cl.severity,
        summary: tr.summary ?? cl.summary,
        familyId: cl.familyId ?? null, activeVariantId: cl.activeVariantId ?? null,
        severityScore: active?.severityScore ?? 3,
        tone: active?.tone ?? 'standard',
        body: tr.body ?? active?.body ?? '',
        translationLocale: tr.usedLocale,
        translationMissing: tr.missing,
      };
    });
    res.json({
      ...mapContract(rehydrated, dealMapA.get(rehydrated.dealId)?.name ?? 'Unknown', snapClauses),
      clauses: mappedClauses,
      meta: {
        source: 'version',
        validFrom: snap.validFrom,
        validTo: snap.validTo,
        generatedAt: new Date().toISOString(),
        asOf: asOf.toISOString(),
        version: snap.version,
      },
    });
    return;
  }
  const dealMap = await getDealMap();
  const rawClauses = await db.select().from(contractClausesTable).where(eq(contractClausesTable.contractId, c.id));
  const variantsAll = await db.select().from(clauseVariantsTable);
  const vById = new Map(variantsAll.map(v => [v.id, v]));
  const language = normalizeLocale(c.language);
  const variantIds = rawClauses.map(cl => cl.activeVariantId).filter((v): v is string => Boolean(v));
  const trMap = await loadVariantTranslations(variantIds);
  const clauses = rawClauses.map(cl => {
    const active = cl.activeVariantId ? vById.get(cl.activeVariantId) : undefined;
    const tr = pickClauseTranslation(active, cl.activeVariantId ? trMap.get(cl.activeVariantId) : undefined, language);
    return {
      id: cl.id, contractId: cl.contractId, family: cl.family,
      variant: tr.name ?? cl.variant,
      severity: cl.severity,
      summary: tr.summary ?? cl.summary,
      familyId: cl.familyId ?? null, activeVariantId: cl.activeVariantId ?? null,
      severityScore: active?.severityScore ?? 3,
      tone: active?.tone ?? 'standard',
      body: tr.body ?? active?.body ?? '',
      translationLocale: tr.usedLocale,
      translationMissing: tr.missing,
    };
  });
  res.json({
    ...mapContract(c, dealMap.get(c.dealId)?.name ?? 'Unknown', rawClauses),
    clauses,
    meta: {
      source: 'live',
      validFrom: iso(c.createdAt),
      validTo: null,
      generatedAt: new Date().toISOString(),
      version: c.version,
    },
  });
});

// ── CONTRACT AMENDMENTS ──
function mapAmendment(a: typeof contractAmendmentsTable.$inferSelect) {
  return {
    id: a.id,
    originalContractId: a.originalContractId,
    number: a.number,
    type: a.type,
    title: a.title,
    description: a.description ?? null,
    status: a.status,
    effectiveFrom: a.effectiveFrom ? String(a.effectiveFrom) : null,
    createdBy: a.createdBy ?? null,
    createdAt: iso(a.createdAt)!,
  };
}

function mapAmendmentChange(c: typeof amendmentClausesTable.$inferSelect) {
  return {
    id: c.id,
    amendmentId: c.amendmentId,
    operation: c.operation,
    family: c.family,
    familyId: c.familyId ?? null,
    beforeVariantId: c.beforeVariantId ?? null,
    afterVariantId: c.afterVariantId ?? null,
    beforeSummary: c.beforeSummary ?? null,
    afterSummary: c.afterSummary ?? null,
    severity: c.severity ?? null,
  };
}

async function nextAmendmentNumber(originalContractId: string): Promise<string> {
  const [ctr] = await db.select().from(contractsTable).where(eq(contractsTable.id, originalContractId));
  const base = ctr ? (ctr.title.match(/C-\d{4}-\d+/)?.[0] ?? `C-${originalContractId}`) : `C-${originalContractId}`;
  const existing = await db.select().from(contractAmendmentsTable)
    .where(eq(contractAmendmentsTable.originalContractId, originalContractId));
  return `${base}-A${existing.length + 1}`;
}

router.get('/contracts/:id/amendments', async (req, res) => {
  if (!validateInline(req, res, { params: Z.ListContractAmendmentsParams })) return;
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  const rows = await db.select().from(contractAmendmentsTable)
    .where(eq(contractAmendmentsTable.originalContractId, req.params.id))
    .orderBy(desc(contractAmendmentsTable.createdAt));
  res.json(rows.map(mapAmendment));
});

router.post('/contracts/:id/amendments', async (req, res) => {
  if (!validateInline(req, res, { params: Z.CreateContractAmendmentParams, body: Z.CreateContractAmendmentBody })) return;
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  if (!['signed', 'active', 'countersigned'].includes(c.status)) {
    res.status(400).json({ error: 'amendment only allowed on signed/active contracts' });
    return;
  }
  const b = req.body;
  if (!b?.type || !b?.title) { res.status(400).json({ error: 'type and title required' }); return; }
  const scope = getScope(req);
  const actor = scope.user?.name ?? null;
  const id = `am_${randomUUID().slice(0, 8)}`;
  const number = await nextAmendmentNumber(c.id);
  await db.insert(contractAmendmentsTable).values({
    id,
    originalContractId: c.id,
    number,
    type: b.type,
    title: b.title,
    description: b.description ?? null,
    status: 'drafting',
    effectiveFrom: b.effectiveFrom ?? null,
    createdBy: actor ?? null,
  });
  const changes = b.changes ?? [];
  for (const ch of changes) {
    await db.insert(amendmentClausesTable).values({
      id: `ac_${randomUUID().slice(0, 8)}`,
      amendmentId: id,
      operation: ch.operation,
      family: ch.family,
      familyId: ch.familyId ?? null,
      beforeVariantId: ch.beforeVariantId ?? null,
      afterVariantId: ch.afterVariantId ?? null,
      beforeSummary: ch.beforeSummary ?? null,
      afterSummary: ch.afterSummary ?? null,
      severity: ch.severity ?? null,
    });
  }
  await writeAuditFromReq(req, {    entityType: 'contract_amendment', entityId: id, action: 'create',
    summary: `Amendment ${number} (${b.type}) angelegt`,
    after: { number, type: b.type, title: b.title },
  });
  const [created] = await db.select().from(contractAmendmentsTable).where(eq(contractAmendmentsTable.id, id));
  const ch = await db.select().from(amendmentClausesTable).where(eq(amendmentClausesTable.amendmentId, id));
  res.status(201).json({ ...mapAmendment(created!), changes: ch.map(mapAmendmentChange) });
});

router.get('/amendments/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetContractAmendmentParams })) return;
  const [a] = await db.select().from(contractAmendmentsTable).where(eq(contractAmendmentsTable.id, req.params.id));
  if (!a) { res.status(404).json({ error: 'not found' }); return; }
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, a.originalContractId));
  if (!c || !(await gateDeal(req, res, c.dealId))) return;
  const changes = await db.select().from(amendmentClausesTable).where(eq(amendmentClausesTable.amendmentId, a.id));
  res.json({ ...mapAmendment(a), changes: changes.map(mapAmendmentChange) });
});

const AMENDMENT_TRANSITIONS: Record<string, string[]> = {
  drafting: ['proposed', 'rejected'],
  proposed: ['in_review', 'rejected'],
  in_review: ['approved', 'rejected'],
  approved: ['out_for_signature', 'rejected'],
  out_for_signature: ['signed', 'rejected'],
  signed: ['active'],
  active: [],
  executed: [],
  rejected: [],
};

router.patch('/amendments/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.PatchContractAmendmentParams, body: Z.PatchContractAmendmentBody })) return;
  const [a] = await db.select().from(contractAmendmentsTable).where(eq(contractAmendmentsTable.id, req.params.id));
  if (!a) { res.status(404).json({ error: 'not found' }); return; }
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, a.originalContractId));
  if (!c || !(await gateDeal(req, res, c.dealId))) return;
  const b = req.body;
  const patch: Partial<typeof contractAmendmentsTable.$inferInsert> = {};
  if (typeof b.status === 'string') {
    const allowed = AMENDMENT_TRANSITIONS[a.status] ?? [];
    if (!allowed.includes(b.status)) {
      res.status(400).json({
        error: `invalid status transition ${a.status} → ${b.status}`,
        allowedNext: allowed,
      });
      return;
    }
    patch.status = b.status;
  }
  if ('effectiveFrom' in b) patch.effectiveFrom = b.effectiveFrom ?? null;
  if ('description' in b) patch.description = b.description ?? null;
  if (typeof b.title === 'string') patch.title = b.title;
  if (Object.keys(patch).length > 0) {
    await db.update(contractAmendmentsTable).set(patch).where(eq(contractAmendmentsTable.id, a.id));
    await writeAuditFromReq(req, {      entityType: 'contract_amendment', entityId: a.id, action: 'update',
      summary: `Amendment ${a.number} aktualisiert`,
      before: { status: a.status }, after: patch,
    });
    // Lifecycle side effects on status transitions
    if (patch.status === 'in_review') {
      const existing = await db.select().from(approvalsTable).where(eq(approvalsTable.amendmentId, a.id));
      if (existing.length === 0) {
        const scope = getScope(req);
        const approvalId = `ap_${randomUUID().slice(0, 8)}`;
        const chainFields = await buildApprovalStageFields(scope.tenantId, 'amendment', {
          amendmentType: a.type,
        });
        await db.insert(approvalsTable).values({
          id: approvalId,
          dealId: c.dealId,
          amendmentId: a.id,
          type: 'amendment',
          reason: `Nachtrag ${a.number}: ${a.title}`,
          requestedBy: scope.user?.id ?? null,
          status: 'pending',
          priority: a.type === 'price-change' ? 'high' : 'medium',
          impactValue: '0',
          currency: 'EUR',
          chainTemplateId: chainFields.chainTemplateId,
          stages: chainFields.stages,
          currentStageIdx: chainFields.currentStageIdx,
        });
        await writeAuditFromReq(req, {          entityType: 'contract_amendment', entityId: a.id, action: 'approval_created',
          summary: `Approval angelegt für Nachtrag ${a.number}${chainFields.chainTemplateId ? ` — ${chainFields.stages.length}-Stage Chain` : ''}`,
          after: { approvalId, chainTemplateId: chainFields.chainTemplateId },
        });
      }
    }
    if (patch.status === 'out_for_signature') {
      const existing = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.amendmentId, a.id));
      if (existing.length === 0) {
        const pkgId = `sg_${randomUUID().slice(0, 8)}`;
        await db.insert(signaturePackagesTable).values({
          id: pkgId,
          dealId: c.dealId,
          amendmentId: a.id,
          title: `Nachtrag ${a.number}: ${a.title}`,
          status: 'in_progress',
          mode: 'sequential',
          reminderIntervalHours: 48,
          escalationAfterHours: 120,
          deadline: null,
        });
        await writeAuditFromReq(req, {          entityType: 'contract_amendment', entityId: a.id, action: 'signature_created',
          summary: `Signatur-Paket angelegt für Nachtrag ${a.number}`,
          after: { packageId: pkgId },
        });
      }
    }
  }
  const [updated] = await db.select().from(contractAmendmentsTable).where(eq(contractAmendmentsTable.id, a.id));
  const changes = await db.select().from(amendmentClausesTable).where(eq(amendmentClausesTable.amendmentId, a.id));
  res.json({ ...mapAmendment(updated!), changes: changes.map(mapAmendmentChange) });
});

router.get('/contracts/:id/effective-state', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetContractEffectiveStateParams })) return;
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  const rawClauses = await db.select().from(contractClausesTable).where(eq(contractClausesTable.contractId, c.id));
  const variantsAll = await db.select().from(clauseVariantsTable);
  const vById = new Map(variantsAll.map(v => [v.id, v]));
  // Apply oldest-first so newer amendments override older ones. Deterministic
  // ordering: (effectiveFrom ASC NULLS LAST, createdAt ASC, id ASC).
  const activeAmendments = await db.select().from(contractAmendmentsTable)
    .where(and(
      eq(contractAmendmentsTable.originalContractId, c.id),
      inArray(contractAmendmentsTable.status, ['active', 'executed', 'signed']),
    ))
    .orderBy(
      sql`${contractAmendmentsTable.effectiveFrom} ASC NULLS LAST`,
      contractAmendmentsTable.createdAt,
      contractAmendmentsTable.id,
    );
  const amendmentIds = activeAmendments.map(a => a.id);
  const allChanges = amendmentIds.length
    ? await db.select().from(amendmentClausesTable)
        .where(inArray(amendmentClausesTable.amendmentId, amendmentIds))
        .orderBy(amendmentClausesTable.id)
    : [];
  // Group changes by amendment so we apply in amendment order
  const changesByAmendment = new Map<string, typeof allChanges>();
  for (const ch of allChanges) {
    const arr = changesByAmendment.get(ch.amendmentId) ?? [];
    arr.push(ch);
    changesByAmendment.set(ch.amendmentId, arr);
  }
  const clausesByFamily = new Map<string, typeof rawClauses[number]>();
  for (const cl of rawClauses) clausesByFamily.set(cl.family, cl);
  for (const am of activeAmendments) {
    for (const ch of (changesByAmendment.get(am.id) ?? [])) {
      if (ch.operation === 'remove') {
        clausesByFamily.delete(ch.family);
        continue;
      }
      if ((ch.operation === 'modify' || ch.operation === 'add') && ch.afterVariantId) {
        const cur = clausesByFamily.get(ch.family);
        const v = vById.get(ch.afterVariantId);
        if (!v) continue;
        clausesByFamily.set(ch.family, {
          ...(cur ?? {
            id: `virt_${am.id}_${ch.family}`,
            contractId: c.id,
            family: ch.family,
            familyId: ch.familyId ?? null,
          } as typeof rawClauses[number]),
          activeVariantId: ch.afterVariantId,
          variant: v.name,
          severity: v.severity,
          summary: v.summary,
        });
      } else if (ch.operation === 'add' && ch.afterSummary) {
        // add without variantId: synthesize a clause entry from summary
        if (!clausesByFamily.has(ch.family)) {
          clausesByFamily.set(ch.family, {
            id: `virt_${am.id}_${ch.family}`,
            contractId: c.id,
            family: ch.family,
            familyId: ch.familyId ?? null,
            activeVariantId: null,
            variant: 'Amendment',
            severity: ch.severity ?? 'low',
            summary: ch.afterSummary,
          } as typeof rawClauses[number]);
        }
      }
    }
  }
  const effective = [...clausesByFamily.values()].map(cl => {
    const active = cl.activeVariantId ? vById.get(cl.activeVariantId) : undefined;
    return {
      id: cl.id, contractId: cl.contractId, family: cl.family, variant: cl.variant,
      severity: cl.severity, summary: cl.summary,
      familyId: cl.familyId ?? null, activeVariantId: cl.activeVariantId ?? null,
      severityScore: active?.severityScore ?? 3,
      tone: active?.tone ?? 'standard',
      body: active?.body ?? '',
    };
  });
  res.json({
    contractId: c.id,
    clauses: effective,
    appliedAmendments: activeAmendments.map(mapAmendment),
  });
});

router.get('/contracts/:id/pdf', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetContractPdfParams })) return;
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, c.dealId));
  const rawClauses = await db.select().from(contractClausesTable).where(eq(contractClausesTable.contractId, c.id));
  const variantsAll = await db.select().from(clauseVariantsTable);
  const vById = new Map(variantsAll.map(v => [v.id, v]));
  const language = normalizeLocale(c.language);
  const variantIds = rawClauses
    .map(cl => cl.activeVariantId)
    .filter((v): v is string => Boolean(v));
  const trMap = await loadVariantTranslations(variantIds);
  let brand: typeof brandsTable.$inferSelect | undefined;
  if (d?.brandId) {
    const [b] = await db.select().from(brandsTable).where(eq(brandsTable.id, d.brandId));
    brand = b;
  }
  const { renderContractPdf } = await import('../pdf/contract');
  const stream = await renderContractPdf({
    number: `${c.title} · v${c.version}`,
    status: c.status,
    dealName: d?.name ?? 'Unknown',
    signedAt: null,
    effectiveFrom: null,
    effectiveTo: c.validUntil ? (typeof c.validUntil === 'string' ? c.validUntil : null) : null,
    language,
    clauses: rawClauses.map(cl => {
      const active = cl.activeVariantId ? vById.get(cl.activeVariantId) : undefined;
      const tr = pickClauseTranslation(active, cl.activeVariantId ? trMap.get(cl.activeVariantId) : undefined, language);
      return {
        family: cl.family,
        variant: tr.name ?? cl.variant,
        severity: cl.severity,
        summary: tr.summary ?? cl.summary,
        body: tr.body ?? active?.body ?? '',
      };
    }),
    brand: brand ? {
      name: brand.name,
      logoUrl: await resolveLogoForPdf(brand.logoUrl),
      primaryColor: brand.primaryColor ?? brand.color,
      secondaryColor: brand.secondaryColor ?? null,
      legalEntityName: brand.legalEntityName ?? null,
      addressLine: brand.addressLine ?? null,
      tone: brand.tone ?? null,
    } : null,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="contract-${c.id}.pdf"`);
  stream.pipe(res);
});

// ─────────────────────────────────────────────────────────────────────────────
// Vertragswesen MVP Phase 1 — ContractTypes / Playbooks / Deviations / Obligations
// ─────────────────────────────────────────────────────────────────────────────

const CONTRACT_TYPE_CODE_RE = /^[A-Z][A-Z0-9_]{1,31}$/;

function mapContractType(t: typeof contractTypesTable.$inferSelect) {
  return {
    id: t.id,
    tenantId: t.tenantId,
    code: t.code,
    name: t.name,
    description: t.description ?? null,
    mandatoryClauseFamilyIds: t.mandatoryClauseFamilyIds ?? [],
    forbiddenClauseFamilyIds: t.forbiddenClauseFamilyIds ?? [],
    defaultPlaybookId: t.defaultPlaybookId ?? null,
    active: t.active,
    createdAt: iso(t.createdAt)!,
  };
}

function mapPlaybook(p: typeof contractPlaybooksTable.$inferSelect) {
  return {
    id: p.id,
    tenantId: p.tenantId,
    contractTypeId: p.contractTypeId,
    name: p.name,
    description: p.description ?? null,
    brandIds: p.brandIds ?? [],
    companyIds: p.companyIds ?? [],
    allowedClauseVariantIds: p.allowedClauseVariantIds ?? [],
    defaultClauseVariantIds: p.defaultClauseVariantIds ?? [],
    approvalRules: p.approvalRules ?? [],
    active: p.active,
    createdAt: iso(p.createdAt)!,
  };
}

router.get('/contract-types', async (req, res) => {
  const scope = getScope(req);
  const rows = await db.select().from(contractTypesTable)
    .where(eq(contractTypesTable.tenantId, scope.tenantId))
    .orderBy(asc(contractTypesTable.code));
  res.json(rows.map(mapContractType));
});

router.post('/contract-types', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const b = req.body as {
    code?: string; name?: string; description?: string;
    mandatoryClauseFamilyIds?: string[]; forbiddenClauseFamilyIds?: string[];
    defaultPlaybookId?: string; active?: boolean;
  } | undefined;
  if (!b || typeof b.code !== 'string' || typeof b.name !== 'string') {
    res.status(422).json({ error: 'code and name are required' }); return;
  }
  const code = b.code.trim().toUpperCase();
  const name = b.name.trim();
  if (!CONTRACT_TYPE_CODE_RE.test(code)) {
    res.status(422).json({ error: 'code must be UPPER_SNAKE 2-32 chars (z. B. NDA, MSA, ORDER_FORM)' }); return;
  }
  if (!name) { res.status(422).json({ error: 'name must not be empty' }); return; }
  const dup = await db.select().from(contractTypesTable)
    .where(and(eq(contractTypesTable.tenantId, scope.tenantId), eq(contractTypesTable.code, code)));
  if (dup.length) { res.status(409).json({ error: `contract type "${code}" already exists` }); return; }
  const newId = `ct_${randomBytes(6).toString('hex')}`;
  const row = {
    id: newId,
    tenantId: scope.tenantId,
    code,
    name,
    description: b.description?.trim() || null,
    mandatoryClauseFamilyIds: Array.isArray(b.mandatoryClauseFamilyIds) ? b.mandatoryClauseFamilyIds : [],
    forbiddenClauseFamilyIds: Array.isArray(b.forbiddenClauseFamilyIds) ? b.forbiddenClauseFamilyIds : [],
    defaultPlaybookId: b.defaultPlaybookId ?? null,
    active: b.active !== false,
  };
  await db.insert(contractTypesTable).values(row);
  const [saved] = await db.select().from(contractTypesTable).where(eq(contractTypesTable.id, newId));
  await writeAuditFromReq(req, {
    entityType: 'contract_type', entityId: newId, action: 'create',
    summary: `Vertragsart "${code}" angelegt`, after: saved,
  });
  res.status(201).json(mapContractType(saved!));
});

router.patch('/contract-types/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(contractTypesTable).where(eq(contractTypesTable.id, req.params.id));
  if (!existing || existing.tenantId !== scope.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  const b = (req.body ?? {}) as Partial<typeof existing>;
  const patch: Partial<typeof contractTypesTable.$inferInsert> = {};
  if (typeof b.name === 'string') {
    const v = b.name.trim();
    if (!v) { res.status(422).json({ error: 'name must not be empty' }); return; }
    patch.name = v;
  }
  if (b.description !== undefined) patch.description = b.description == null ? null : String(b.description);
  if (Array.isArray(b.mandatoryClauseFamilyIds)) patch.mandatoryClauseFamilyIds = b.mandatoryClauseFamilyIds as string[];
  if (Array.isArray(b.forbiddenClauseFamilyIds)) patch.forbiddenClauseFamilyIds = b.forbiddenClauseFamilyIds as string[];
  if (b.defaultPlaybookId !== undefined) patch.defaultPlaybookId = b.defaultPlaybookId == null ? null : String(b.defaultPlaybookId);
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (Object.keys(patch).length) {
    await db.update(contractTypesTable).set(patch).where(eq(contractTypesTable.id, existing.id));
  }
  const [updated] = await db.select().from(contractTypesTable).where(eq(contractTypesTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'contract_type', entityId: existing.id, action: 'update',
    summary: `Vertragsart "${existing.code}" aktualisiert`, before: existing, after: updated,
  });
  res.json(mapContractType(updated!));
});

router.delete('/contract-types/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(contractTypesTable).where(eq(contractTypesTable.id, req.params.id));
  if (!existing || existing.tenantId !== scope.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  const [{ c: usedByContract } = { c: 0 }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(contractsTable).where(eq(contractsTable.contractTypeId, existing.id));
  const [{ c: usedByPlaybook } = { c: 0 }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(contractPlaybooksTable).where(eq(contractPlaybooksTable.contractTypeId, existing.id));
  if (usedByContract + usedByPlaybook > 0) {
    res.status(409).json({ error: `contract type is in use by ${usedByContract} contract(s) and ${usedByPlaybook} playbook(s)` }); return;
  }
  await db.delete(contractTypesTable).where(eq(contractTypesTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'contract_type', entityId: existing.id, action: 'delete',
    summary: `Vertragsart "${existing.code}" gelöscht`, before: existing,
  });
  res.status(204).end();
});

router.get('/contract-playbooks', async (req, res) => {
  const scope = getScope(req);
  const filters = [eq(contractPlaybooksTable.tenantId, scope.tenantId)];
  if (typeof req.query.contractTypeId === 'string') {
    filters.push(eq(contractPlaybooksTable.contractTypeId, req.query.contractTypeId));
  }
  const rows = await db.select().from(contractPlaybooksTable).where(and(...filters)).orderBy(asc(contractPlaybooksTable.name));
  res.json(rows.map(mapPlaybook));
});

router.post('/contract-playbooks', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const b = req.body as {
    contractTypeId?: string; name?: string; description?: string;
    brandIds?: string[]; companyIds?: string[];
    allowedClauseVariantIds?: string[]; defaultClauseVariantIds?: string[];
    approvalRules?: Array<{ trigger: string; threshold?: number; approverRole: string }>;
  } | undefined;
  if (!b || typeof b.contractTypeId !== 'string' || typeof b.name !== 'string') {
    res.status(422).json({ error: 'contractTypeId and name are required' }); return;
  }
  const [ctype] = await db.select().from(contractTypesTable)
    .where(and(eq(contractTypesTable.id, b.contractTypeId), eq(contractTypesTable.tenantId, scope.tenantId)));
  if (!ctype) { res.status(422).json({ error: 'contractTypeId not found' }); return; }
  const newId = `pb_${randomBytes(6).toString('hex')}`;
  const row = {
    id: newId,
    tenantId: scope.tenantId,
    contractTypeId: ctype.id,
    name: b.name.trim(),
    description: b.description?.trim() || null,
    brandIds: Array.isArray(b.brandIds) ? b.brandIds : [],
    companyIds: Array.isArray(b.companyIds) ? b.companyIds : [],
    allowedClauseVariantIds: Array.isArray(b.allowedClauseVariantIds) ? b.allowedClauseVariantIds : [],
    defaultClauseVariantIds: Array.isArray(b.defaultClauseVariantIds) ? b.defaultClauseVariantIds : [],
    approvalRules: Array.isArray(b.approvalRules) ? b.approvalRules : [],
    active: true,
  };
  await db.insert(contractPlaybooksTable).values(row);
  const [saved] = await db.select().from(contractPlaybooksTable).where(eq(contractPlaybooksTable.id, newId));
  await writeAuditFromReq(req, {
    entityType: 'contract_playbook', entityId: newId, action: 'create',
    summary: `Playbook "${row.name}" angelegt`, after: saved,
  });
  res.status(201).json(mapPlaybook(saved!));
});

router.patch('/contract-playbooks/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(contractPlaybooksTable).where(eq(contractPlaybooksTable.id, req.params.id));
  if (!existing || existing.tenantId !== scope.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  const b = (req.body ?? {}) as Partial<typeof existing> & { active?: boolean };
  const patch: Partial<typeof contractPlaybooksTable.$inferInsert> = {};
  if (typeof b.name === 'string') {
    const v = b.name.trim();
    if (!v) { res.status(422).json({ error: 'name must not be empty' }); return; }
    patch.name = v;
  }
  if (b.description !== undefined) patch.description = b.description == null ? null : String(b.description);
  if (Array.isArray(b.brandIds)) patch.brandIds = b.brandIds as string[];
  if (Array.isArray(b.companyIds)) patch.companyIds = b.companyIds as string[];
  if (Array.isArray(b.allowedClauseVariantIds)) patch.allowedClauseVariantIds = b.allowedClauseVariantIds as string[];
  if (Array.isArray(b.defaultClauseVariantIds)) patch.defaultClauseVariantIds = b.defaultClauseVariantIds as string[];
  if (Array.isArray(b.approvalRules)) patch.approvalRules = b.approvalRules as Array<{ trigger: string; threshold?: number; approverRole: string }>;
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (Object.keys(patch).length) {
    await db.update(contractPlaybooksTable).set(patch).where(eq(contractPlaybooksTable.id, existing.id));
  }
  const [updated] = await db.select().from(contractPlaybooksTable).where(eq(contractPlaybooksTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'contract_playbook', entityId: existing.id, action: 'update',
    summary: `Playbook "${existing.name}" aktualisiert`, before: existing, after: updated,
  });
  res.json(mapPlaybook(updated!));
});

router.delete('/contract-playbooks/:id', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(contractPlaybooksTable).where(eq(contractPlaybooksTable.id, req.params.id));
  if (!existing || existing.tenantId !== scope.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  const [{ c: used } = { c: 0 }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(contractsTable).where(eq(contractsTable.playbookId, existing.id));
  if (used > 0) { res.status(409).json({ error: `playbook is referenced by ${used} contract(s)` }); return; }
  await db.delete(contractPlaybooksTable).where(eq(contractPlaybooksTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'contract_playbook', entityId: existing.id, action: 'delete',
    summary: `Playbook "${existing.name}" gelöscht`, before: existing,
  });
  res.status(204).end();
});

// ── Engines ──────────────────────────────────────────────────────────────
async function evaluateDeviations(contractId: string, tenantId: string): Promise<void> {
  const [contract] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId));
  if (!contract) return;
  const playbookId = contract.playbookId;
  const contractTypeId = contract.contractTypeId;
  const clauses = await db.select().from(contractClausesTable).where(eq(contractClausesTable.contractId, contractId));
  const familyIdsPresent = new Set(clauses.map(c => c.familyId).filter((x): x is string => !!x));

  // Pflichtklauseln aus contract_type
  const required: string[] = [];
  if (contractTypeId) {
    const [ct] = await db.select().from(contractTypesTable).where(eq(contractTypesTable.id, contractTypeId));
    if (ct) {
      for (const fid of ct.mandatoryClauseFamilyIds ?? []) {
        if (!familyIdsPresent.has(fid)) required.push(fid);
      }
    }
  }
  // Erlaubte Varianten aus playbook
  let allowedVariantIds: Set<string> | null = null;
  if (playbookId) {
    const [pb] = await db.select().from(contractPlaybooksTable).where(eq(contractPlaybooksTable.id, playbookId));
    if (pb) allowedVariantIds = new Set(pb.allowedClauseVariantIds ?? []);
  }

  // Vorhandene Deviations holen, um Idempotenz zu wahren (per evidence-Heuristik)
  const existing = await db.select().from(clauseDeviationsTable).where(eq(clauseDeviationsTable.contractId, contractId));
  const existingKeys = new Set(existing.map(e => `${e.deviationType}:${e.clauseId}:${e.familyId}`));

  const inserts: Array<typeof clauseDeviationsTable.$inferInsert> = [];

  for (const fid of required) {
    const key = `missing_required:_:${fid}`;
    if (existingKeys.has(key)) continue;
    inserts.push({
      id: `dv_${randomBytes(6).toString('hex')}`,
      tenantId, contractId, clauseId: clauses[0]?.id ?? '_',
      familyId: fid,
      deviationType: 'missing_required',
      severity: 'high',
      description: `Pflicht-Klauselfamilie ${fid} fehlt im Vertrag.`,
      evidence: { mandatoryFamilyId: fid },
      policyId: contractTypeId,
      requiresApproval: true,
    });
    existingKeys.add(`missing_required:${clauses[0]?.id ?? '_'}:${fid}`);
  }

  if (allowedVariantIds) {
    for (const cl of clauses) {
      if (!cl.activeVariantId || !cl.familyId) continue;
      if (allowedVariantIds.has(cl.activeVariantId)) continue;
      const key = `variant_change:${cl.id}:${cl.familyId}`;
      if (existingKeys.has(key)) continue;
      inserts.push({
        id: `dv_${randomBytes(6).toString('hex')}`,
        tenantId, contractId, clauseId: cl.id,
        familyId: cl.familyId,
        deviationType: 'variant_change',
        severity: cl.severity === 'high' ? 'high' : 'medium',
        description: `Klausel-Variante ${cl.activeVariantId} liegt außerhalb des Playbooks.`,
        evidence: { playbookId, actualVariantId: cl.activeVariantId },
        policyId: playbookId,
        requiresApproval: true,
      });
    }
  }

  if (inserts.length) {
    await db.insert(clauseDeviationsTable).values(inserts);
  }

  // Counter aktualisieren (nur offene)
  const [{ c: openCount } = { c: 0 }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(clauseDeviationsTable)
    .where(and(eq(clauseDeviationsTable.contractId, contractId), sql`${clauseDeviationsTable.resolvedAt} IS NULL`));
  await db.update(contractsTable).set({ openDeviationsCount: openCount }).where(eq(contractsTable.id, contractId));
}

async function deriveObligations(contractId: string, tenantId: string): Promise<{ created: number; total: number }> {
  const [contract] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId));
  if (!contract) return { created: 0, total: 0 };
  const clauses = await db.select().from(contractClausesTable).where(eq(contractClausesTable.contractId, contractId));
  if (clauses.length === 0) return { created: 0, total: 0 };
  const variantIds = clauses.map(c => c.activeVariantId).filter((x): x is string => !!x);
  if (variantIds.length === 0) return { created: 0, total: 0 };
  const variants = await db.select().from(clauseVariantsTable).where(inArray(clauseVariantsTable.id, variantIds));
  const variantById = new Map(variants.map(v => [v.id, v]));

  const existing = await db.select().from(obligationsTable)
    .where(and(eq(obligationsTable.contractId, contractId), eq(obligationsTable.source, 'derived')));
  const existingKeys = new Set(existing.map(o => `${o.clauseId}:${o.type}:${o.description}`));

  const inserts: Array<typeof obligationsTable.$inferInsert> = [];
  const baseDate = contract.signedAt ?? contract.effectiveFrom ? new Date(contract.signedAt ?? `${contract.effectiveFrom}T00:00:00Z`) : new Date();

  for (const cl of clauses) {
    if (!cl.activeVariantId) continue;
    const v = variantById.get(cl.activeVariantId);
    if (!v?.obligationTemplates) continue;
    for (const tpl of v.obligationTemplates) {
      const key = `${cl.id}:${tpl.type}:${tpl.description}`;
      if (existingKeys.has(key)) continue;
      const dueAt = tpl.dueOffsetDays != null
        ? new Date(baseDate.getTime() + tpl.dueOffsetDays * 86400000)
        : null;
      inserts.push({
        id: `ob_${randomBytes(6).toString('hex')}`,
        tenantId,
        contractId,
        brandId: contract.brandId ?? null,
        accountId: contract.accountId ?? null,
        clauseId: cl.id,
        type: tpl.type,
        description: tpl.description,
        dueAt,
        recurrence: tpl.recurrence ?? 'none',
        ownerRole: tpl.ownerRole ?? null,
        status: 'pending',
        source: 'derived',
        escalationDays: 7,
      });
    }
  }

  if (inserts.length) {
    await db.insert(obligationsTable).values(inserts);
  }
  const [{ c: total } = { c: 0 }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(obligationsTable).where(eq(obligationsTable.contractId, contractId));
  await db.update(contractsTable).set({ obligationsCount: total }).where(eq(contractsTable.id, contractId));
  return { created: inserts.length, total };
}

function mapDeviation(d: typeof clauseDeviationsTable.$inferSelect, familyName: string | null) {
  return {
    id: d.id,
    tenantId: d.tenantId,
    contractId: d.contractId,
    clauseId: d.clauseId,
    familyId: d.familyId,
    familyName,
    deviationType: d.deviationType,
    severity: d.severity,
    description: d.description,
    evidence: d.evidence ?? null,
    policyId: d.policyId ?? null,
    requiresApproval: d.requiresApproval,
    approvalCaseId: d.approvalCaseId ?? null,
    resolvedAt: iso(d.resolvedAt),
    resolvedBy: d.resolvedBy ?? null,
    resolutionNote: d.resolutionNote ?? null,
    createdAt: iso(d.createdAt)!,
  };
}

router.get('/contracts/:id/deviations', async (req, res) => {
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  const rows = await db.select().from(clauseDeviationsTable)
    .where(eq(clauseDeviationsTable.contractId, c.id))
    .orderBy(desc(clauseDeviationsTable.createdAt));
  const families = await db.select().from(clauseFamiliesTable);
  const famName = new Map(families.map(f => [f.id, f.name]));
  res.json(rows.map(d => mapDeviation(d, famName.get(d.familyId) ?? null)));
});

router.post('/contracts/:id/deviations', async (req, res) => {
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  const tenantId = c.tenantId ?? getScope(req).tenantId;
  await evaluateDeviations(c.id, tenantId);
  const rows = await db.select().from(clauseDeviationsTable)
    .where(eq(clauseDeviationsTable.contractId, c.id))
    .orderBy(desc(clauseDeviationsTable.createdAt));
  const families = await db.select().from(clauseFamiliesTable);
  const famName = new Map(families.map(f => [f.id, f.name]));
  const list = rows.map(d => mapDeviation(d, famName.get(d.familyId) ?? null));
  const open = list.filter(d => !d.resolvedAt);
  const requiresApproval = open.filter(d => d.requiresApproval).length;
  const bySeverity: Record<string, number> = {};
  for (const d of open) bySeverity[d.severity] = (bySeverity[d.severity] ?? 0) + 1;
  await writeAuditFromReq(req, {
    entityType: 'contract', entityId: c.id, action: 'evaluate_deviations',
    summary: `Deviation-Engine: ${open.length} offen, ${requiresApproval} approval-pflichtig`,
  });
  res.json({ contractId: c.id, deviations: list, summary: { total: list.length, open: open.length, requiresApproval, bySeverity } });
});

router.patch('/clause-deviations/:id', async (req, res) => {
  const [d] = await db.select().from(clauseDeviationsTable).where(eq(clauseDeviationsTable.id, req.params.id));
  if (!d) { res.status(404).json({ error: 'not found' }); return; }
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, d.contractId));
  if (!c || !(await gateDeal(req, res, c.dealId))) {
    if (!res.headersSent) res.status(404).json({ error: 'not found' });
    return;
  }
  const b = req.body as { resolutionNote?: string } | undefined;
  if (!b || typeof b.resolutionNote !== 'string' || !b.resolutionNote.trim()) {
    res.status(422).json({ error: 'resolutionNote is required' }); return;
  }
  const scope = getScope(req);
  await db.update(clauseDeviationsTable).set({
    resolvedAt: new Date(),
    resolvedBy: scope.user.name,
    resolutionNote: b.resolutionNote.trim(),
  }).where(eq(clauseDeviationsTable.id, d.id));
  const [updated] = await db.select().from(clauseDeviationsTable).where(eq(clauseDeviationsTable.id, d.id));
  // Counter aktualisieren
  const [{ c: openCount } = { c: 0 }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(clauseDeviationsTable)
    .where(and(eq(clauseDeviationsTable.contractId, c.id), sql`${clauseDeviationsTable.resolvedAt} IS NULL`));
  await db.update(contractsTable).set({ openDeviationsCount: openCount }).where(eq(contractsTable.id, c.id));
  await writeAuditFromReq(req, {
    entityType: 'clause_deviation', entityId: d.id, action: 'resolve',
    summary: `Deviation aufgelöst: ${b.resolutionNote.trim().slice(0, 80)}`,
    before: d, after: updated,
  });
  const families = await db.select().from(clauseFamiliesTable);
  const famName = new Map(families.map(f => [f.id, f.name]));
  res.json(mapDeviation(updated!, famName.get(updated!.familyId) ?? null));
});

// ── Obligations ─────────────────────────────────────────────────────────
async function userMapForTenant(tenantId: string): Promise<Map<string, { name: string; role: string }>> {
  const users = await db.select().from(usersTable).where(eq(usersTable.tenantId, tenantId));
  return new Map(users.map(u => [u.id, { name: u.name, role: u.role }]));
}

function mapObligation(o: typeof obligationsTable.$inferSelect, ctx: {
  contractTitle: string | null;
  accountName: string | null;
  ownerName: string | null;
}) {
  return {
    id: o.id,
    tenantId: o.tenantId,
    contractId: o.contractId,
    contractTitle: ctx.contractTitle,
    brandId: o.brandId ?? null,
    accountId: o.accountId ?? null,
    accountName: ctx.accountName,
    clauseId: o.clauseId ?? null,
    type: o.type,
    description: o.description,
    dueAt: iso(o.dueAt),
    recurrence: o.recurrence,
    ownerId: o.ownerId ?? null,
    ownerName: ctx.ownerName,
    ownerRole: o.ownerRole ?? null,
    status: o.status,
    source: o.source,
    escalationDays: o.escalationDays ?? null,
    completedAt: iso(o.completedAt),
    completedBy: o.completedBy ?? null,
    createdAt: iso(o.createdAt)!,
  };
}

router.get('/obligations', async (req, res) => {
  const scope = getScope(req);
  const filters = [eq(obligationsTable.tenantId, scope.tenantId)];
  if (typeof req.query.contractId === 'string') filters.push(eq(obligationsTable.contractId, req.query.contractId));
  if (typeof req.query.status === 'string') filters.push(eq(obligationsTable.status, req.query.status));
  if (typeof req.query.ownerId === 'string') filters.push(eq(obligationsTable.ownerId, req.query.ownerId));
  if (typeof req.query.dueBefore === 'string') {
    const d = new Date(req.query.dueBefore);
    if (!Number.isNaN(d.getTime())) filters.push(sql`${obligationsTable.dueAt} <= ${d.toISOString()}`);
  }
  if (req.query.overdueOnly === 'true') {
    filters.push(sql`${obligationsTable.dueAt} < now()`);
    filters.push(sql`${obligationsTable.status} NOT IN ('done','waived')`);
  }
  const rows = await db.select().from(obligationsTable).where(and(...filters)).orderBy(asc(obligationsTable.dueAt));
  // Scope-Filter über Vertrag→Deal (für non-tenantWide)
  const dealIds = await allowedDealIds(req);
  const contractIds = [...new Set(rows.map(r => r.contractId))];
  const contracts = contractIds.length
    ? await db.select().from(contractsTable).where(inArray(contractsTable.id, contractIds))
    : [];
  const contractById = new Map(contracts.map(c => [c.id, c]));
  const visibleRows = scope.tenantWide && !hasActiveScopeFilter(scope)
    ? rows
    : rows.filter(r => {
        const c = contractById.get(r.contractId);
        return c && dealIds.has(c.dealId);
      });
  const accountIds = [...new Set(visibleRows.map(r => r.accountId).filter((x): x is string => !!x))];
  const accounts = accountIds.length
    ? await db.select().from(accountsTable).where(inArray(accountsTable.id, accountIds))
    : [];
  const accountById = new Map(accounts.map(a => [a.id, a.name]));
  const userMap = await userMapForTenant(scope.tenantId);
  res.json(visibleRows.map(o => mapObligation(o, {
    contractTitle: contractById.get(o.contractId)?.title ?? null,
    accountName: o.accountId ? accountById.get(o.accountId) ?? null : null,
    ownerName: o.ownerId ? userMap.get(o.ownerId)?.name ?? null : null,
  })));
});

router.post('/obligations', async (req, res) => {
  const b = req.body as {
    contractId?: string; clauseId?: string; type?: string; description?: string;
    dueAt?: string; recurrence?: string; ownerId?: string; ownerRole?: string;
    escalationDays?: number;
  } | undefined;
  if (!b || typeof b.contractId !== 'string' || typeof b.type !== 'string' || typeof b.description !== 'string' || !b.description.trim()) {
    res.status(422).json({ error: 'contractId, type, description are required' }); return;
  }
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, b.contractId));
  if (!c) { res.status(404).json({ error: 'contract not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  const allowedTypes = new Set(['delivery', 'reporting', 'sla', 'payment', 'notice', 'audit']);
  if (!allowedTypes.has(b.type)) { res.status(422).json({ error: `type must be one of ${[...allowedTypes].join(',')}` }); return; }
  const allowedRecurrences = new Set(['none', 'monthly', 'quarterly', 'annual']);
  const recurrence = b.recurrence ?? 'none';
  if (!allowedRecurrences.has(recurrence)) { res.status(422).json({ error: 'invalid recurrence' }); return; }
  const newId = `ob_${randomBytes(6).toString('hex')}`;
  const tenantId = c.tenantId ?? getScope(req).tenantId;
  const dueAt = b.dueAt ? new Date(b.dueAt) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) { res.status(422).json({ error: 'dueAt invalid ISO date' }); return; }
  await db.insert(obligationsTable).values({
    id: newId,
    tenantId,
    contractId: c.id,
    brandId: c.brandId ?? null,
    accountId: c.accountId ?? null,
    clauseId: b.clauseId ?? null,
    type: b.type,
    description: b.description.trim(),
    dueAt,
    recurrence,
    ownerId: b.ownerId ?? null,
    ownerRole: b.ownerRole ?? null,
    status: 'pending',
    source: 'manual',
    escalationDays: b.escalationDays ?? null,
  });
  const [{ c: total } = { c: 0 }] = await db.select({ c: sql<number>`count(*)::int` })
    .from(obligationsTable).where(eq(obligationsTable.contractId, c.id));
  await db.update(contractsTable).set({ obligationsCount: total }).where(eq(contractsTable.id, c.id));
  await writeAuditFromReq(req, {
    entityType: 'obligation', entityId: newId, action: 'create',
    summary: `Pflicht angelegt: ${b.description.trim().slice(0, 80)}`,
  });
  const [saved] = await db.select().from(obligationsTable).where(eq(obligationsTable.id, newId));
  const userMap = await userMapForTenant(tenantId);
  res.status(201).json(mapObligation(saved!, {
    contractTitle: c.title,
    accountName: null,
    ownerName: saved!.ownerId ? userMap.get(saved!.ownerId)?.name ?? null : null,
  }));
});

router.patch('/obligations/:id', async (req, res) => {
  const [o] = await db.select().from(obligationsTable).where(eq(obligationsTable.id, req.params.id));
  if (!o) { res.status(404).json({ error: 'not found' }); return; }
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, o.contractId));
  if (!c || !(await gateDeal(req, res, c.dealId))) {
    if (!res.headersSent) res.status(404).json({ error: 'not found' });
    return;
  }
  const b = req.body as {
    description?: string; dueAt?: string | null; ownerId?: string | null;
    ownerRole?: string | null; status?: string; escalationDays?: number | null;
  } | undefined;
  const patch: Partial<typeof obligationsTable.$inferInsert> = {};
  if (b?.description !== undefined) {
    const v = String(b.description).trim();
    if (!v) { res.status(422).json({ error: 'description must not be empty' }); return; }
    patch.description = v;
  }
  if (b?.dueAt !== undefined) {
    if (b.dueAt === null) patch.dueAt = null;
    else {
      const d = new Date(b.dueAt);
      if (Number.isNaN(d.getTime())) { res.status(422).json({ error: 'dueAt invalid' }); return; }
      patch.dueAt = d;
    }
  }
  if (b?.ownerId !== undefined) patch.ownerId = b.ownerId;
  if (b?.ownerRole !== undefined) patch.ownerRole = b.ownerRole;
  if (b?.escalationDays !== undefined) patch.escalationDays = b.escalationDays;
  if (b?.status !== undefined) {
    const allowed = new Set(['pending', 'in_progress', 'done', 'missed', 'waived']);
    if (!allowed.has(b.status)) { res.status(422).json({ error: 'invalid status' }); return; }
    patch.status = b.status;
    if (b.status === 'done') {
      patch.completedAt = new Date();
      patch.completedBy = getScope(req).user.name;
    }
  }
  if (Object.keys(patch).length) {
    await db.update(obligationsTable).set(patch).where(eq(obligationsTable.id, o.id));
  }
  const [updated] = await db.select().from(obligationsTable).where(eq(obligationsTable.id, o.id));
  await writeAuditFromReq(req, {
    entityType: 'obligation', entityId: o.id, action: 'update',
    summary: `Pflicht aktualisiert${patch.status ? ` → ${patch.status}` : ''}`,
    before: o, after: updated,
  });
  const userMap = await userMapForTenant(updated!.tenantId);
  res.json(mapObligation(updated!, {
    contractTitle: c.title,
    accountName: null,
    ownerName: updated!.ownerId ? userMap.get(updated!.ownerId)?.name ?? null : null,
  }));
});

router.post('/contracts/:id/obligations/derive', async (req, res) => {
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  const tenantId = c.tenantId ?? getScope(req).tenantId;
  const result = await deriveObligations(c.id, tenantId);
  await writeAuditFromReq(req, {
    entityType: 'contract', entityId: c.id, action: 'derive_obligations',
    summary: `Obligation-Engine: ${result.created} neu, ${result.total} gesamt`,
  });
  res.json({ contractId: c.id, ...result });
});

// ── Quotes/current — aktuell akzeptiertes Angebot je Account ────────────
// (Moved to before /quotes/:id to avoid path-param shadowing.)

router.get('/clause-families', async (_req, res) => {
  const families = await db.select().from(clauseFamiliesTable);
  const variants = await db.select().from(clauseVariantsTable);
  const trMap = await loadVariantTranslations(variants.map(v => v.id));
  res.json(families.map(f => ({
    ...f,
    variants: variants
      .filter(v => v.familyId === f.id)
      .sort((a, b) => a.severityScore - b.severityScore)
      .map(v => {
        const trs = trMap.get(v.id);
        return {
          id: v.id, name: v.name, severity: v.severity,
          severityScore: v.severityScore, summary: v.summary, body: v.body, tone: v.tone,
          translations: trs
            ? Array.from(trs.values()).map(t => ({
                id: t.id, variantId: t.variantId, locale: t.locale,
                name: t.name, summary: t.summary, body: t.body,
                source: t.source ?? null, license: t.license ?? null,
                sourceUrl: t.sourceUrl ?? null,
                createdAt: iso(t.createdAt)!, updatedAt: iso(t.updatedAt)!,
              }))
            : [],
        };
      }),
  })));
});

// ── CLAUSE-VARIANT TRANSLATIONS ──
router.get('/clause-variants/:variantId/translations', async (req, res) => {
  const variantId = req.params.variantId;
  const [v] = await db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, variantId));
  if (!v) { res.status(404).json({ error: 'variant not found' }); return; }
  const rows = await db.select().from(clauseVariantTranslationsTable)
    .where(eq(clauseVariantTranslationsTable.variantId, variantId));
  res.json(rows.map(t => ({
    id: t.id, variantId: t.variantId, locale: t.locale,
    name: t.name, summary: t.summary, body: t.body,
    source: t.source ?? null, license: t.license ?? null, sourceUrl: t.sourceUrl ?? null,
    createdAt: iso(t.createdAt)!, updatedAt: iso(t.updatedAt)!,
  })));
});

router.put('/clause-variants/:variantId/translations/:locale', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const variantId = req.params.variantId;
  const locale = req.params.locale;
  if (!SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    res.status(400).json({ error: 'locale must be one of de|en' }); return;
  }
  const [v] = await db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, variantId));
  if (!v) { res.status(404).json({ error: 'variant not found' }); return; }
  const body = (req.body ?? {}) as {
    name?: unknown; summary?: unknown; body?: unknown;
    source?: unknown; license?: unknown; sourceUrl?: unknown;
  };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
  const text = typeof body.body === 'string' ? body.body : '';
  if (!name || name.length > 200) { res.status(400).json({ error: 'name required (1..200 chars)' }); return; }
  if (!summary || summary.length > 1000) { res.status(400).json({ error: 'summary required (1..1000 chars)' }); return; }
  if (text.length > 8000) { res.status(400).json({ error: 'body too long (>8000 chars)' }); return; }
  const source = typeof body.source === 'string' ? body.source.slice(0, 200) : null;
  const license = typeof body.license === 'string' ? body.license.slice(0, 200) : null;
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl.slice(0, 1000) : null;
  const [existing] = await db.select().from(clauseVariantTranslationsTable).where(and(
    eq(clauseVariantTranslationsTable.variantId, variantId),
    eq(clauseVariantTranslationsTable.locale, locale),
  ));
  const now = new Date();
  if (existing) {
    await db.update(clauseVariantTranslationsTable).set({
      name, summary, body: text, source, license, sourceUrl, updatedAt: now,
    }).where(eq(clauseVariantTranslationsTable.id, existing.id));
  } else {
    await db.insert(clauseVariantTranslationsTable).values({
      id: `cvt_${randomUUID().slice(0, 8)}`,
      variantId, locale, name, summary, body: text,
      source, license, sourceUrl,
    });
  }
  const [after] = await db.select().from(clauseVariantTranslationsTable).where(and(
    eq(clauseVariantTranslationsTable.variantId, variantId),
    eq(clauseVariantTranslationsTable.locale, locale),
  ));
  await writeAuditFromReq(req, {
    entityType: 'clause_variant', entityId: variantId, action: 'translation_upserted',
    summary: `Übersetzung [${locale}] für Variante ${v.name} ${existing ? 'aktualisiert' : 'angelegt'}`,
    after: { locale, name },
  });
  res.json({
    id: after!.id, variantId: after!.variantId, locale: after!.locale,
    name: after!.name, summary: after!.summary, body: after!.body,
    source: after!.source ?? null, license: after!.license ?? null, sourceUrl: after!.sourceUrl ?? null,
    createdAt: iso(after!.createdAt)!, updatedAt: iso(after!.updatedAt)!,
  });
});

router.delete('/clause-variants/:variantId/translations/:locale', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const variantId = req.params.variantId;
  const locale = req.params.locale;
  if (!SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    res.status(400).json({ error: 'locale must be one of de|en' }); return;
  }
  const [v] = await db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, variantId));
  if (!v) { res.status(404).json({ error: 'variant not found' }); return; }
  const [existing] = await db.select().from(clauseVariantTranslationsTable).where(and(
    eq(clauseVariantTranslationsTable.variantId, variantId),
    eq(clauseVariantTranslationsTable.locale, locale),
  ));
  if (!existing) { res.status(204).end(); return; }
  await db.delete(clauseVariantTranslationsTable).where(eq(clauseVariantTranslationsTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'clause_variant', entityId: variantId, action: 'translation_deleted',
    summary: `Übersetzung [${locale}] für Variante ${v.name} entfernt`,
    before: { locale, name: existing.name },
  });
  res.status(204).end();
});

router.get('/contracts/:id/clauses', async (req, res) => {
  if (!validateInline(req, res, { params: Z.ListContractClausesParams })) return;
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  const clauses = await db.select().from(contractClausesTable)
    .where(eq(contractClausesTable.contractId, c.id));
  const variants = await db.select().from(clauseVariantsTable);
  const variantById = new Map(variants.map(v => [v.id, v]));
  const language = normalizeLocale(c.language);
  const variantIds = clauses.map(cl => cl.activeVariantId).filter((v): v is string => Boolean(v));
  const trMap = await loadVariantTranslations(variantIds);
  res.json(clauses.map(cl => {
    const active = cl.activeVariantId ? variantById.get(cl.activeVariantId) : undefined;
    const tr = pickClauseTranslation(active, cl.activeVariantId ? trMap.get(cl.activeVariantId) : undefined, language);
    return {
      id: cl.id, contractId: cl.contractId, family: cl.family,
      variant: tr.name ?? cl.variant,
      severity: cl.severity,
      summary: tr.summary ?? cl.summary,
      familyId: cl.familyId ?? null, activeVariantId: cl.activeVariantId ?? null,
      severityScore: active?.severityScore ?? 3,
      tone: active?.tone ?? 'standard',
      body: tr.body ?? active?.body ?? '',
      translationLocale: tr.usedLocale,
      translationMissing: tr.missing,
    };
  }));
});

router.patch('/contract-clauses/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.PatchContractClauseParams, body: Z.PatchContractClauseBody })) return;
  const body: { variantId?: string } = req.body ?? {};
  const { variantId } = body;
  if (!variantId) { res.status(400).json({ error: 'variantId required' }); return; }
  const actor = getScope(req).user;
  const [cl] = await db.select().from(contractClausesTable).where(eq(contractClausesTable.id, req.params.id));
  if (!cl) { res.status(404).json({ error: 'not found' }); return; }
  const [ctr] = await db.select().from(contractsTable).where(eq(contractsTable.id, cl.contractId));
  if (!ctr) { res.status(404).json({ error: 'contract not found' }); return; }
  if (!(await gateDeal(req, res, ctr.dealId))) return;
  const [nextVar] = await db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, variantId));
  if (!nextVar) { res.status(400).json({ error: 'variant not found' }); return; }
  if (cl.familyId && nextVar.familyId !== cl.familyId) {
    res.status(400).json({ error: 'variant belongs to different family' }); return;
  }
  const [prevVar] = cl.activeVariantId
    ? await db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, cl.activeVariantId))
    : [undefined];
  const prevScore = prevVar?.severityScore ?? 3;
  const nextScore = nextVar.severityScore;
  const deltaScore = nextScore - prevScore; // negativ = weicher
  const softer = deltaScore < 0;
  const softenBy2 = deltaScore <= -2;
  const dealMap = await getDealMap();
  const dealName = dealMap.get(ctr.dealId)?.name ?? 'Unknown';
  const sevLabel = (s: number) => (s <= 2 ? 'high' : s === 3 ? 'medium' : 'low');
  let snapName = nextVar.name;
  let snapSeverity = sevLabel(nextScore);
  let snapSummary = nextVar.summary;
  const [dealRowForBrand] = await db.select().from(dealsTable).where(eq(dealsTable.id, ctr.dealId));
  let appliedOverride = false;
  if (dealRowForBrand?.brandId) {
    const ov = await loadBrandOverride(dealRowForBrand.brandId, nextVar.id, getScope(req).tenantId);
    if (ov) {
      snapName = ov.name ?? nextVar.name;
      snapSummary = ov.summary ?? nextVar.summary;
      snapSeverity = ov.severity ?? (ov.severityScore != null ? sevLabel(ov.severityScore) : sevLabel(nextScore));
      appliedOverride = true;
    }
  }
  // Wenn kein Brand-Override greift, nutze die Übersetzung in der Vertragssprache.
  if (!appliedOverride) {
    const language = normalizeLocale(ctr.language);
    const trMap = await loadVariantTranslations([nextVar.id]);
    const tr = pickClauseTranslation(nextVar, trMap.get(nextVar.id), language);
    if (tr.name) snapName = tr.name;
    if (tr.summary) snapSummary = tr.summary;
  }
  await db.update(contractClausesTable).set({
    activeVariantId: nextVar.id,
    variant: snapName,
    severity: snapSeverity,
    summary: snapSummary,
  }).where(eq(contractClausesTable.id, cl.id));
  await writeAuditFromReq(req, {    entityType: 'contract', entityId: ctr.id, action: 'clause_variant_changed',
    summary: `${cl.family}: ${prevVar?.name ?? '—'} → ${nextVar.name} (Δ severityScore ${deltaScore >= 0 ? '+' : ''}${deltaScore})`,
    before: { variantId: cl.activeVariantId, name: prevVar?.name, severityScore: prevScore },
    after: { variantId: nextVar.id, name: nextVar.name, severityScore: nextScore },
  });
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'contract',
    title: `Klausel geändert: ${cl.family}`,
    description: `${prevVar?.name ?? '—'} → ${nextVar.name}`,
    actor: actor.name, dealId: ctr.dealId,
  });
  let approvalId: string | null = null;
  if (softenBy2 || (softer && nextScore <= 2)) {
    approvalId = `ap_${randomUUID().slice(0, 8)}`;
    const tenantIdForChain = getScope(req).tenantId;
    const chainFields = await buildApprovalStageFields(tenantIdForChain, 'clause_change', {
      deltaScore,
      newScore: nextScore,
      familyId: cl.familyId ?? undefined,
    });
    await db.insert(approvalsTable).values({
      id: approvalId, dealId: ctr.dealId, type: 'clause_change',
      reason: `Non-standard clause: ${cl.family} von ${prevVar?.name ?? '—'} auf ${nextVar.name} (severityScore ${prevScore}→${nextScore})`,
      requestedBy: actor.id, status: 'pending',
      priority: nextScore <= 1 ? 'high' : 'medium',
      impactValue: '0', currency: 'EUR',
      chainTemplateId: chainFields.chainTemplateId,
      stages: chainFields.stages,
      currentStageIdx: chainFields.currentStageIdx,
    });
    await writeAuditFromReq(req, {      entityType: 'contract', entityId: ctr.id, action: 'approval_created',
      summary: `Approval angelegt für ${cl.family} (weichere Variante, Δ ${deltaScore})${chainFields.chainTemplateId ? ` — ${chainFields.stages.length}-Stage Chain` : ''}`,
      after: { approvalId, dealId: ctr.dealId, chainTemplateId: chainFields.chainTemplateId, stageCount: chainFields.stages.length },
    });
  }
  // Recompute risk
  const allClauses = await db.select().from(contractClausesTable)
    .where(eq(contractClausesTable.contractId, ctr.id));
  const variants = await db.select().from(clauseVariantsTable);
  const variantById = new Map(variants.map(v => [v.id, v]));
  const sevWeight: Record<string, number> = { high: 25, medium: 10, low: 3 };
  const riskScore = Math.min(100, allClauses.reduce((s, c) => s + (sevWeight[c.severity] ?? 0), 0));
  const avgScore = allClauses.length
    ? allClauses.reduce((s, c) => s + (c.activeVariantId ? variantById.get(c.activeVariantId)?.severityScore ?? 3 : 3), 0) / allClauses.length
    : 3;
  const newRiskLevel = avgScore <= 2 ? 'high' : avgScore <= 3.5 ? 'medium' : 'low';
  if (newRiskLevel !== ctr.riskLevel) {
    await db.update(contractsTable).set({ riskLevel: newRiskLevel }).where(eq(contractsTable.id, ctr.id));
  }
  const [updatedCl] = await db.select().from(contractClausesTable).where(eq(contractClausesTable.id, cl.id));
  res.json({
    clause: {
      id: updatedCl!.id, contractId: updatedCl!.contractId,
      family: updatedCl!.family, variant: updatedCl!.variant,
      severity: updatedCl!.severity, summary: updatedCl!.summary,
      familyId: updatedCl!.familyId ?? null, activeVariantId: updatedCl!.activeVariantId ?? null,
      severityScore: nextScore, tone: nextVar.tone, body: nextVar.body,
    },
    contractRiskLevel: newRiskLevel,
    contractRiskScore: riskScore,
    dealName,
    deltaScore, softer,
    approvalId,
    approvalReason: approvalId ? 'non-standard clause weakened' : null,
  });
});

router.get('/clauses/:fromId/diff/:toId', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetClauseDiffParams })) return;
  const [fromV, toV] = await Promise.all([
    db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, req.params.fromId)).then(r => r[0]),
    db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, req.params.toId)).then(r => r[0]),
  ]);
  if (!fromV || !toV) { res.status(404).json({ error: 'variant not found' }); return; }
  const deltaScore = toV.severityScore - fromV.severityScore;
  res.json({
    from: {
      id: fromV.id, name: fromV.name, severity: fromV.severity,
      severityScore: fromV.severityScore, tone: fromV.tone, summary: fromV.summary, body: fromV.body,
    },
    to: {
      id: toV.id, name: toV.name, severity: toV.severity,
      severityScore: toV.severityScore, tone: toV.tone, summary: toV.summary, body: toV.body,
    },
    deltaScore,
    softer: deltaScore < 0,
    approvalRequired: deltaScore <= -2 || (deltaScore < 0 && toV.severityScore <= 2),
  });
});

// ── NEGOTIATIONS ──
function mapNegotiation(n: typeof negotiationsTable.$inferSelect, dealName: string) {
  return {
    id: n.id, dealId: n.dealId, dealName, status: n.status, round: n.round,
    lastReactionType: n.lastReactionType, riskLevel: n.riskLevel,
    updatedAt: iso(n.updatedAt)!,
  };
}

router.get('/negotiations', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListNegotiationsQueryParams })) return;
  const dealIds = await scopedDealIds(req);
  if (dealIds.length === 0) { res.json([]); return; }
  const filters = [inArray(negotiationsTable.dealId, dealIds)];
  if (req.query.dealId) filters.push(eq(negotiationsTable.dealId, String(req.query.dealId)));
  if (req.query.status) filters.push(eq(negotiationsTable.status, String(req.query.status)));
  const rows = await db.select().from(negotiationsTable)
    .where(and(...filters))
    .orderBy(desc(negotiationsTable.updatedAt));
  const dealMap = await getDealMap();
  res.json(rows.map(n => mapNegotiation(n, dealMap.get(n.dealId)?.name ?? 'Unknown')));
});

function mapReaction(r: typeof customerReactionsTable.$inferSelect) {
  return {
    id: r.id, negotiationId: r.negotiationId, type: r.type, topic: r.topic,
    summary: r.summary, source: r.source, priority: r.priority,
    impactPct: numOrNull(r.impactPct),
    priceDeltaPct: numOrNull(r.priceDeltaPct),
    termMonthsDelta: r.termMonthsDelta ?? null,
    paymentTermsDeltaDays: r.paymentTermsDeltaDays ?? null,
    requestedClauseVariantId: r.requestedClauseVariantId ?? null,
    linkedQuoteVersionId: r.linkedQuoteVersionId ?? null,
    linkedApprovalId: r.linkedApprovalId ?? null,
    createdAt: iso(r.createdAt)!,
  };
}

// Discount approval threshold (percentage above which approval is required)
const DISCOUNT_APPROVAL_THRESHOLD_PCT = 10;

async function loadLatestQuoteVersion(dealId: string) {
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.dealId, dealId));
  if (!q) return null;
  const [v] = await db.select().from(quoteVersionsTable)
    .where(eq(quoteVersionsTable.quoteId, q.id))
    .orderBy(desc(quoteVersionsTable.version));
  return v ? { quote: q, version: v } : null;
}

function computeImpactForReaction(
  r: typeof customerReactionsTable.$inferSelect,
  baseline: { totalAmount: number; discountPct: number; marginPct: number } | null,
) {
  const priceDelta = r.priceDeltaPct != null ? Number(r.priceDeltaPct) : null;
  let newDiscountPct: number | null = null;
  let newTotalAmount: number | null = null;
  let newMarginPct: number | null = null;
  const followUps: string[] = [];
  const approvalsTriggered: Array<{ type: string; reason: string }> = [];

  if (priceDelta != null && baseline) {
    newDiscountPct = Math.max(0, baseline.discountPct - priceDelta);
    newTotalAmount = Math.round(baseline.totalAmount * (1 + priceDelta / 100) * 100) / 100;
    // Naive margin model: margin absorbs price change 1:1 in percentage points.
    newMarginPct = Math.round((baseline.marginPct + priceDelta) * 100) / 100;
    followUps.push('new_quote_version');
    if (newDiscountPct > DISCOUNT_APPROVAL_THRESHOLD_PCT && !r.linkedApprovalId) {
      approvalsTriggered.push({
        type: 'discount',
        reason: `Discount ${newDiscountPct.toFixed(1)}% exceeds ${DISCOUNT_APPROVAL_THRESHOLD_PCT}% threshold`,
      });
      followUps.push('discount_approval');
    }
  }
  if (r.termMonthsDelta != null && r.termMonthsDelta !== 0) {
    followUps.push('contract_amendment');
  }
  if (r.paymentTermsDeltaDays != null && r.paymentTermsDeltaDays !== 0) {
    followUps.push('contract_amendment');
    if (r.paymentTermsDeltaDays > 14) {
      approvalsTriggered.push({
        type: 'payment_terms',
        reason: `Payment terms extended by ${r.paymentTermsDeltaDays} days`,
      });
    }
  }
  if (r.requestedClauseVariantId) {
    followUps.push('clause_change');
  }

  let riskTrend: 'up' | 'down' | 'flat' = 'flat';
  if (r.type === 'acceptance') riskTrend = 'down';
  else if (r.priority === 'high' || (priceDelta != null && priceDelta <= -5)) riskTrend = 'up';

  return {
    reactionId: r.id,
    priceDeltaPct: priceDelta,
    newTotalAmount,
    newDiscountPct: newDiscountPct != null ? Math.round(newDiscountPct * 100) / 100 : null,
    newMarginPct,
    marginDeltaPct: newMarginPct != null && baseline ? Math.round((newMarginPct - baseline.marginPct) * 100) / 100 : null,
    termMonthsDelta: r.termMonthsDelta ?? null,
    paymentTermsDeltaDays: r.paymentTermsDeltaDays ?? null,
    requestedClauseVariantId: r.requestedClauseVariantId ?? null,
    followUps: Array.from(new Set(followUps)),
    approvalsTriggered,
    riskTrend,
    linkedQuoteVersionId: r.linkedQuoteVersionId ?? null,
    linkedApprovalId: r.linkedApprovalId ?? null,
  };
}

router.get('/negotiations/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetNegotiationParams })) return;
  const [n] = await db.select().from(negotiationsTable).where(eq(negotiationsTable.id, req.params.id));
  if (!n) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, n.dealId))) return;
  const dealMap = await getDealMap();
  const reactions = await db.select().from(customerReactionsTable)
    .where(eq(customerReactionsTable.negotiationId, n.id))
    .orderBy(desc(customerReactionsTable.createdAt));
  const tlRows = await db.select().from(timelineEventsTable)
    .where(eq(timelineEventsTable.dealId, n.dealId))
    .orderBy(desc(timelineEventsTable.at));
  const latest = await loadLatestQuoteVersion(n.dealId);
  const baseline = latest ? {
    totalAmount: num(latest.version.totalAmount),
    discountPct: num(latest.version.discountPct),
    marginPct: num(latest.version.marginPct),
  } : null;
  res.json({
    ...mapNegotiation(n, dealMap.get(n.dealId)?.name ?? 'Unknown'),
    baseline,
    reactions: reactions.map(mapReaction),
    impacts: reactions.map(r => computeImpactForReaction(r, baseline)),
    timeline: tlRows.map(t => ({
      id: t.id, type: t.type, title: t.title, description: t.description,
      actor: t.actor, dealId: t.dealId,
      dealName: t.dealId ? (dealMap.get(t.dealId)?.name ?? null) : null,
      at: iso(t.at)!,
    })),
  });
});

router.get('/negotiations/:id/impact', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetNegotiationImpactParams })) return;
  const [n] = await db.select().from(negotiationsTable).where(eq(negotiationsTable.id, req.params.id));
  if (!n) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, n.dealId))) return;
  const reactions = await db.select().from(customerReactionsTable)
    .where(eq(customerReactionsTable.negotiationId, n.id))
    .orderBy(desc(customerReactionsTable.createdAt));
  const latest = await loadLatestQuoteVersion(n.dealId);
  const baseline = latest ? {
    totalAmount: num(latest.version.totalAmount),
    discountPct: num(latest.version.discountPct),
    marginPct: num(latest.version.marginPct),
  } : null;
  res.json({
    negotiationId: n.id,
    baseline,
    approvalThresholdPct: DISCOUNT_APPROVAL_THRESHOLD_PCT,
    impacts: reactions.map(r => computeImpactForReaction(r, baseline)),
  });
});

router.post('/negotiations/:id/reactions', async (req, res) => {
  if (!validateInline(req, res, { params: Z.AddCustomerReactionParams, body: Z.AddCustomerReactionBody })) return;
  const [n0] = await db.select().from(negotiationsTable).where(eq(negotiationsTable.id, req.params.id));
  if (!n0) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, n0.dealId))) return;
  const b = req.body;
  const id = `cr_${randomUUID().slice(0, 8)}`;
  await db.insert(customerReactionsTable).values({
    id, negotiationId: req.params.id, type: b.type, topic: b.topic,
    summary: b.summary, source: b.source, priority: b.priority,
    impactPct: b.impactPct != null ? String(b.impactPct) : null,
    priceDeltaPct: b.priceDeltaPct != null ? String(b.priceDeltaPct) : null,
    termMonthsDelta: b.termMonthsDelta ?? null,
    paymentTermsDeltaDays: b.paymentTermsDeltaDays ?? null,
    requestedClauseVariantId: b.requestedClauseVariantId ?? null,
  });
  await db.update(negotiationsTable).set({
    lastReactionType: b.type, updatedAt: new Date(),
    round: sql`${negotiationsTable.round} + 1`,
  }).where(eq(negotiationsTable.id, req.params.id));
  const [r] = await db.select().from(customerReactionsTable).where(eq(customerReactionsTable.id, id));
  await generatePriceRejectionForReaction(id);
  res.status(201).json(mapReaction(r!));
});

router.post('/negotiations/:id/counterproposal', async (req, res) => {
  if (!validateInline(req, res, { params: Z.CreateCounterproposalParams, body: Z.CreateCounterproposalBody })) return;
  const [n0] = await db.select().from(negotiationsTable).where(eq(negotiationsTable.id, req.params.id));
  if (!n0) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, n0.dealId))) return;
  const b = req.body;
  const id = `cr_${randomUUID().slice(0, 8)}`;

  // Optionally create new quote version if createNewVersion=true and price delta given
  let linkedQuoteVersionId: string | null = null;
  if (b.createNewVersion && b.priceDeltaPct != null) {
    const latest = await loadLatestQuoteVersion(n0.dealId);
    if (latest) {
      const newTotal = num(latest.version.totalAmount) * (1 + b.priceDeltaPct / 100);
      const newDiscount = Math.max(0, num(latest.version.discountPct) - b.priceDeltaPct);
      const newMargin = num(latest.version.marginPct) + b.priceDeltaPct;
      const vId = `qv_${randomUUID().slice(0, 8)}`;
      await db.insert(quoteVersionsTable).values({
        id: vId,
        quoteId: latest.quote.id,
        version: latest.version.version + 1,
        totalAmount: String(Math.round(newTotal * 100) / 100),
        discountPct: String(Math.round(newDiscount * 100) / 100),
        marginPct: String(Math.round(newMargin * 100) / 100),
        status: 'draft',
        notes: `Counterproposal: ${b.topic}`,
      });
      await db.update(quotesTable).set({ currentVersion: latest.version.version + 1 })
        .where(eq(quotesTable.id, latest.quote.id));
      linkedQuoteVersionId = vId;
    }
  }

  await db.insert(customerReactionsTable).values({
    id,
    negotiationId: req.params.id,
    type: 'counterproposal',
    topic: b.topic,
    summary: b.summary,
    source: b.source,
    priority: b.priority ?? 'medium',
    priceDeltaPct: b.priceDeltaPct != null ? String(b.priceDeltaPct) : null,
    termMonthsDelta: b.termMonthsDelta ?? null,
    paymentTermsDeltaDays: b.paymentTermsDeltaDays ?? null,
    requestedClauseVariantId: b.requestedClauseVariantId ?? null,
    linkedQuoteVersionId,
  });
  await db.update(negotiationsTable).set({
    lastReactionType: 'counterproposal', updatedAt: new Date(),
    round: sql`${negotiationsTable.round} + 1`,
  }).where(eq(negotiationsTable.id, req.params.id));
  const [r] = await db.select().from(customerReactionsTable).where(eq(customerReactionsTable.id, id));
  res.status(201).json(mapReaction(r!));
});

router.post('/negotiations/:id/reactions/:reactionId/create-version', async (req, res) => {
  if (!validateInline(req, res, { params: Z.CreateVersionFromReactionParams })) return;
  const [n0] = await db.select().from(negotiationsTable).where(eq(negotiationsTable.id, req.params.id));
  if (!n0) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, n0.dealId))) return;
  const [r] = await db.select().from(customerReactionsTable)
    .where(and(eq(customerReactionsTable.id, req.params.reactionId),
               eq(customerReactionsTable.negotiationId, req.params.id)));
  if (!r) { res.status(404).json({ error: 'reaction not found' }); return; }
  if (r.linkedQuoteVersionId) {
    res.status(409).json({ error: 'already linked to quote version', linkedQuoteVersionId: r.linkedQuoteVersionId });
    return;
  }
  const priceDelta = r.priceDeltaPct != null ? Number(r.priceDeltaPct) : 0;
  const latest = await loadLatestQuoteVersion(n0.dealId);
  if (!latest) { res.status(400).json({ error: 'no existing quote to version from' }); return; }
  const newTotal = num(latest.version.totalAmount) * (1 + priceDelta / 100);
  const newDiscount = Math.max(0, num(latest.version.discountPct) - priceDelta);
  const newMargin = num(latest.version.marginPct) + priceDelta;
  const vId = `qv_${randomUUID().slice(0, 8)}`;
  await db.insert(quoteVersionsTable).values({
    id: vId, quoteId: latest.quote.id, version: latest.version.version + 1,
    totalAmount: String(Math.round(newTotal * 100) / 100),
    discountPct: String(Math.round(newDiscount * 100) / 100),
    marginPct: String(Math.round(newMargin * 100) / 100),
    status: 'draft',
    notes: `From reaction ${r.id}: ${r.topic}`,
  });
  await db.update(quotesTable).set({ currentVersion: latest.version.version + 1 })
    .where(eq(quotesTable.id, latest.quote.id));
  await db.update(customerReactionsTable).set({ linkedQuoteVersionId: vId })
    .where(eq(customerReactionsTable.id, r.id));
  res.status(201).json({ reactionId: r.id, quoteVersionId: vId, version: latest.version.version + 1 });
});

router.post('/negotiations/:id/reactions/:reactionId/request-approval', async (req, res) => {
  if (!validateInline(req, res, { params: Z.RequestApprovalFromReactionParams, body: Z.RequestApprovalFromReactionBody })) return;
  const [n0] = await db.select().from(negotiationsTable).where(eq(negotiationsTable.id, req.params.id));
  if (!n0) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, n0.dealId))) return;
  const [r] = await db.select().from(customerReactionsTable)
    .where(and(eq(customerReactionsTable.id, req.params.reactionId),
               eq(customerReactionsTable.negotiationId, req.params.id)));
  if (!r) { res.status(404).json({ error: 'reaction not found' }); return; }
  if (r.linkedApprovalId) {
    res.status(409).json({ error: 'already linked to approval', linkedApprovalId: r.linkedApprovalId });
    return;
  }
  const scope = getScope(req);
  const latest = await loadLatestQuoteVersion(n0.dealId);
  const priceDelta = r.priceDeltaPct != null ? Number(r.priceDeltaPct) : 0;
  const baselineDiscount = latest ? num(latest.version.discountPct) : 0;
  const newDiscount = Math.max(0, baselineDiscount - priceDelta);
  const b = req.body;
  const type = b?.type ?? 'discount';
  const reason = b?.reason ?? (priceDelta !== 0
    ? `Discount ${newDiscount.toFixed(1)}% requested via negotiation (topic: ${r.topic})`
    : `Approval requested for reaction: ${r.topic}`);
  const aId = `ap_${randomUUID().slice(0, 8)}`;
  await db.insert(approvalsTable).values({
    id: aId,
    dealId: n0.dealId,
    type,
    reason,
    requestedBy: scope?.user.id ?? 'system',
    status: 'pending',
    priority: b?.priority ?? (r.priority === 'high' ? 'high' : 'medium'),
    impactValue: String(latest ? num(latest.version.totalAmount) * (priceDelta / 100) : 0),
    currency: 'EUR',
  });
  await db.update(customerReactionsTable).set({ linkedApprovalId: aId })
    .where(eq(customerReactionsTable.id, r.id));
  await generateHighDiscountForApproval(aId);
  res.status(201).json({ reactionId: r.id, approvalId: aId });
});

// ── SIGNATURES ──
type SignerRow = typeof signersTable.$inferSelect;
type PackageRow = typeof signaturePackagesTable.$inferSelect;

function mapSignaturePackageSummary(
  s: PackageRow, dealName: string, signedCount = 0, totalSigners = 0,
) {
  return {
    id: s.id, dealId: s.dealId, dealName, title: s.title, status: s.status,
    mode: s.mode, signedCount, totalSigners,
    createdAt: iso(s.createdAt)!,
    deadline: iso(s.deadline),
    amendmentId: s.amendmentId,
  };
}

function pickWaitingSigner(pkg: PackageRow, signers: SignerRow[]): SignerRow | null {
  const active = signers
    .filter(x => x.status !== 'signed' && x.status !== 'declined')
    .sort((a, b) => a.order - b.order);
  if (active.length === 0) return null;
  if (pkg.mode === 'parallel') return active[0] ?? null;
  return active[0] ?? null;
}

function hoursSince(d: Date | null | undefined): number | null {
  if (!d) return null;
  const ms = Date.now() - new Date(d).getTime();
  return Math.max(0, ms / 36e5);
}

function mapSigner(sg: SignerRow) {
  return {
    id: sg.id, packageId: sg.packageId, name: sg.name, email: sg.email,
    role: sg.role, order: sg.order, status: sg.status,
    sentAt: iso(sg.sentAt), viewedAt: iso(sg.viewedAt),
    signedAt: iso(sg.signedAt), declinedAt: iso(sg.declinedAt),
    declineReason: sg.declineReason, lastReminderAt: iso(sg.lastReminderAt),
    isFallback: sg.isFallback,
  };
}

async function buildSignatureDetail(s: PackageRow) {
  const dealMap = await getDealMap();
  const signers = await db.select().from(signersTable).where(eq(signersTable.packageId, s.id));
  const sorted = signers.sort((a, b) => a.order - b.order);
  const waiting = pickWaitingSigner(s, sorted);
  const waitingSince = waiting?.sentAt ?? s.createdAt;
  const waitingSinceHours = hoursSince(waitingSince);
  const lastReminder = waiting?.lastReminderAt ?? s.lastReminderAt;
  const nextReminderAt = lastReminder
    ? new Date(new Date(lastReminder).getTime() + s.reminderIntervalHours * 36e5).toISOString()
    : null;
  const escalationAt = waitingSince
    ? new Date(new Date(waitingSince).getTime() + s.escalationAfterHours * 36e5).toISOString()
    : null;
  return {
    ...mapSignaturePackageSummary(s, dealMap.get(s.dealId)?.name ?? 'Unknown',
      sorted.filter(x => x.status === 'signed').length, sorted.length),
    mode: s.mode,
    reminderIntervalHours: s.reminderIntervalHours,
    escalationAfterHours: s.escalationAfterHours,
    lastReminderAt: iso(s.lastReminderAt),
    orderConfirmationId: s.orderConfirmationId,
    waitingOnSignerId: waiting?.id ?? null,
    waitingOnSignerName: waiting?.name ?? null,
    waitingSinceHours: waitingSinceHours == null ? null : Math.round(waitingSinceHours),
    nextReminderAt,
    escalationAt,
    signers: sorted.map(mapSigner),
  };
}

async function maybeCompletePackageAndCreateOC(req: Request, pkg: PackageRow, signers: SignerRow[]) {
  const active = signers.filter(sg => sg.status !== 'declined');
  const allSigned = active.length > 0 && active.every(sg => sg.status === 'signed');
  if (!allSigned || signers.length === 0) return;
  if (pkg.status === 'completed' && pkg.orderConfirmationId) return;
  const dealMap = await getDealMap();
  const deal = dealMap.get(pkg.dealId);
  const year = new Date().getFullYear();
  const ocId = `oc_${randomUUID().slice(0, 8)}`;
  const existingCount = await db.select({ c: sql<number>`count(*)::int` }).from(orderConfirmationsTable);
  const seq = String((existingCount[0]?.c ?? 0) + 1).padStart(3, '0');
  await db.insert(orderConfirmationsTable).values({
    id: ocId, dealId: pkg.dealId, contractId: null,
    number: `OC-${year}-${seq}`, status: 'checks_pending', readinessScore: 20,
    totalAmount: String(num(deal?.value ?? 0)), currency: deal?.currency ?? 'EUR',
    expectedDelivery: null, handoverAt: null,
    salesOwnerId: deal?.ownerId ?? null,
  });
  await db.insert(orderConfirmationChecksTable).values({
    id: `ocx_${randomUUID().slice(0, 8)}`,
    orderConfirmationId: ocId,
    label: 'Erstprüfung aus Signatur-Abschluss',
    status: 'pending',
    detail: `Automatisch aus Signature-Package ${pkg.id} erzeugt.`,
  });
  await db.update(signaturePackagesTable).set({
    status: 'completed', orderConfirmationId: ocId,
  }).where(eq(signaturePackagesTable.id, pkg.id));
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'signature',
    title: 'Alle Unterschriften vollständig',
    description: `${pkg.title} abgeschlossen; Auftragsbestätigung ${ocId} erstellt.`,
    actor: 'System', dealId: pkg.dealId,
  });
  await writeAuditFromReq(req, {    entityType: 'signature_package', entityId: pkg.id,
    action: 'completed',
    summary: `Signature-Package ${pkg.title} vollständig; OC ${ocId} erzeugt.`,
  });
  // Fire webhook — contract.signed (tenant-scoped via deal→company).
  const [deal2] = await db.select().from(dealsTable).where(eq(dealsTable.id, pkg.dealId));
  if (deal2) {
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, deal2.companyId));
    if (co) void emitEvent(co.tenantId, 'contract.signed', { signaturePackageId: pkg.id, dealId: pkg.dealId, orderConfirmationId: ocId });
    // MVP Phase 1: Bei Signatur Vertragsstatus auf signed setzen + Obligations
    // automatisch ableiten und Deviations re-evaluieren.
    // WICHTIG: Nur Verträge signieren, die tatsächlich zu diesem Paket gehören.
    // - Amendment-Pakete: Vertrag = amendment.originalContractId
    // - Initial-Pakete (kein amendmentId): Fallback auf den einzigen Vertrag des Deals
    //   (mehrdeutige Fälle werden bewusst übersprungen, um Fehl-Signaturen zu vermeiden).
    let targetContractIds: string[] = [];
    if (pkg.amendmentId) {
      const [amend] = await db.select().from(contractAmendmentsTable)
        .where(eq(contractAmendmentsTable.id, pkg.amendmentId));
      if (amend?.originalContractId) targetContractIds = [amend.originalContractId];
    } else {
      const dealContracts = await db.select().from(contractsTable).where(eq(contractsTable.dealId, pkg.dealId));
      if (dealContracts.length === 1) targetContractIds = [dealContracts[0]!.id];
    }
    const targetContracts = targetContractIds.length
      ? await db.select().from(contractsTable).where(inArray(contractsTable.id, targetContractIds))
      : [];
    for (const ctr of targetContracts) {
      if (ctr.status === 'signed') continue;
      const tenantIdForCtr = ctr.tenantId ?? co?.tenantId ?? getScope(req).tenantId;
      await db.update(contractsTable).set({
        status: 'signed',
        signedAt: new Date(),
        tenantId: tenantIdForCtr,
      }).where(eq(contractsTable.id, ctr.id));
      try {
        await deriveObligations(ctr.id, tenantIdForCtr);
        await evaluateDeviations(ctr.id, tenantIdForCtr);
        await db.insert(timelineEventsTable).values({
          id: `tl_${randomUUID().slice(0, 8)}`,
          tenantId: tenantIdForCtr,
          type: 'contract',
          title: 'Vertrag signiert',
          description: `${ctr.title}: Obligations automatisch abgeleitet, Deviations evaluiert.`,
          actor: 'System',
          dealId: pkg.dealId,
        });
      } catch (err) {
        // Engines sollen den Signatur-Abschluss nicht blockieren.
        // Fehler werden ignoriert — Audit-Log enthält den eigentlichen Abschluss.
        void err;
      }
    }
  }
}

router.get('/signatures', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListSignaturePackagesQueryParams })) return;
  const dealIds = await scopedDealIds(req);
  if (dealIds.length === 0) { res.json([]); return; }
  const filters = [inArray(signaturePackagesTable.dealId, dealIds)];
  if (req.query.status) filters.push(eq(signaturePackagesTable.status, String(req.query.status)));
  if (req.query.amendmentId) filters.push(eq(signaturePackagesTable.amendmentId, String(req.query.amendmentId)));
  const rows = await db.select().from(signaturePackagesTable).where(and(...filters)).orderBy(desc(signaturePackagesTable.createdAt));
  const dealMap = await getDealMap();
  const allSigners = await db.select().from(signersTable);
  res.json(rows.map(s => {
    const sg = allSigners.filter(x => x.packageId === s.id);
    return mapSignaturePackageSummary(s, dealMap.get(s.dealId)?.name ?? 'Unknown',
      sg.filter(x => x.status === 'signed').length, sg.length);
  }));
});

router.get('/signatures/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetSignaturePackageParams })) return;
  const [s] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, req.params.id));
  if (!s) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, s.dealId))) return;
  res.json(await buildSignatureDetail(s));
});

router.post('/signatures/:id/send-reminder', async (req, res) => {
  if (!validateInline(req, res, { params: Z.SendSignatureReminderParams })) return;
  const [s] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, req.params.id));
  if (!s) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, s.dealId))) return;
  if (s.status === 'completed' || s.status === 'blocked') {
    res.status(409).json({ error: `cannot remind in status ${s.status}` }); return;
  }
  const signers = await db.select().from(signersTable).where(eq(signersTable.packageId, s.id));
  const waiting = pickWaitingSigner(s, signers);
  if (!waiting) { res.status(409).json({ error: 'no active signer' }); return; }
  const now = new Date();
  await db.update(signaturePackagesTable).set({ lastReminderAt: now })
    .where(eq(signaturePackagesTable.id, s.id));
  await db.update(signersTable).set({ lastReminderAt: now })
    .where(eq(signersTable.id, waiting.id));
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'signature',
    title: 'Reminder gesendet',
    description: `Reminder an ${waiting.name} für ${s.title}.`,
    actor: 'Priya Raman', dealId: s.dealId,
  });
  await writeAuditFromReq(req, {    entityType: 'signature_package', entityId: s.id, action: 'reminder_sent',
    summary: `Reminder an ${waiting.name} (${waiting.email}) gesendet.`,
  });
  const [fresh] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, s.id));
  res.json(await buildSignatureDetail(fresh!));
});

router.patch('/signers/:id/decline', async (req, res) => {
  if (!validateInline(req, res, { params: Z.DeclineSignerParams, body: Z.DeclineSignerBody })) return;
  const [sg] = await db.select().from(signersTable).where(eq(signersTable.id, req.params.id));
  if (!sg) { res.status(404).json({ error: 'not found' }); return; }
  const [pkg] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, sg.packageId));
  if (!pkg) { res.status(404).json({ error: 'package not found' }); return; }
  if (!(await gateDeal(req, res, pkg.dealId))) return;
  if (sg.status === 'signed' || sg.status === 'declined') {
    res.status(409).json({ error: `signer already ${sg.status}` }); return;
  }
  const reason = typeof req.body?.reason === 'string' && req.body.reason.trim()
    ? String(req.body.reason).slice(0, 500) : 'Kein Grund angegeben';
  const now = new Date();
  await db.update(signersTable).set({
    status: 'declined', declinedAt: now, declineReason: reason,
  }).where(eq(signersTable.id, sg.id));
  await db.update(signaturePackagesTable).set({ status: 'blocked' })
    .where(eq(signaturePackagesTable.id, pkg.id));
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'signature',
    title: 'Signatur abgelehnt',
    description: `${sg.name} hat abgelehnt: ${reason}`,
    actor: 'System', dealId: pkg.dealId,
  });
  await writeAuditFromReq(req, {    entityType: 'signature_package', entityId: pkg.id, action: 'declined',
    summary: `${sg.name} hat ${pkg.title} abgelehnt (${reason}).`,
    before: { signerStatus: sg.status }, after: { signerStatus: 'declined' },
  });
  const [fresh] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, pkg.id));
  res.json(await buildSignatureDetail(fresh!));
});

router.post('/signatures/:id/escalate', async (req, res) => {
  if (!validateInline(req, res, { params: Z.EscalateSignaturePackageParams, body: Z.EscalateSignaturePackageBody })) return;
  const [s] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, req.params.id));
  if (!s) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, s.dealId))) return;
  const body: {
    fallbackName?: unknown; fallbackEmail?: unknown; fallbackRole?: unknown;
    replacesSignerId?: unknown;
  } = req.body ?? {};
  const name = typeof body.fallbackName === 'string' ? body.fallbackName.trim() : '';
  const email = typeof body.fallbackEmail === 'string' ? body.fallbackEmail.trim() : '';
  const role = typeof body.fallbackRole === 'string' ? body.fallbackRole.trim() : 'Fallback Signer';
  if (!name || !email) {
    res.status(400).json({ error: 'fallbackName and fallbackEmail required' }); return;
  }
  const signers = await db.select().from(signersTable).where(eq(signersTable.packageId, s.id));
  const replaced = typeof body.replacesSignerId === 'string'
    ? signers.find(sg => sg.id === body.replacesSignerId && sg.status === 'declined')
    : signers.find(sg => sg.status === 'declined');
  if (!replaced) { res.status(409).json({ error: 'no declined signer to escalate' }); return; }
  const alreadyEscalated = signers.some(sg => sg.isFallback && sg.order === replaced.order);
  if (alreadyEscalated) {
    res.status(409).json({ error: 'fallback already active for this signer' }); return;
  }
  const newId = `sn_${randomUUID().slice(0, 8)}`;
  await db.insert(signersTable).values({
    id: newId, packageId: s.id, name, email, role,
    order: replaced.order, status: 'pending', isFallback: true, sentAt: new Date(),
  });
  await db.update(signaturePackagesTable).set({ status: 'in_progress' })
    .where(eq(signaturePackagesTable.id, s.id));
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'signature',
    title: 'Eskalation: Fallback-Signer aktiviert',
    description: `${name} übernimmt für ${replaced.name} bei ${s.title}.`,
    actor: 'Priya Raman', dealId: s.dealId,
  });
  await writeAuditFromReq(req, {    entityType: 'signature_package', entityId: s.id, action: 'escalated',
    summary: `Fallback ${name} aktiviert statt ${replaced.name}.`,
    after: { fallbackSignerId: newId, replacesSignerId: replaced.id },
  });
  const [fresh] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, s.id));
  res.json(await buildSignatureDetail(fresh!));
});

router.post('/signers/:id/sign', async (req, res) => {
  if (!validateInline(req, res, { params: Z.SignSignerParams })) return;
  const [sg] = await db.select().from(signersTable).where(eq(signersTable.id, req.params.id));
  if (!sg) { res.status(404).json({ error: 'not found' }); return; }
  const [pkg] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, sg.packageId));
  if (!pkg) { res.status(404).json({ error: 'package not found' }); return; }
  if (!(await gateDeal(req, res, pkg.dealId))) return;
  if (pkg.status !== 'in_progress' && pkg.status !== 'draft') {
    res.status(409).json({ error: `package is ${pkg.status}; escalation required to unblock` }); return;
  }
  if (sg.status === 'signed' || sg.status === 'declined') {
    res.status(409).json({ error: `signer already ${sg.status}` }); return;
  }
  if (pkg.mode === 'sequential') {
    const others = await db.select().from(signersTable).where(eq(signersTable.packageId, pkg.id));
    const earlier = others.filter(o => o.order < sg.order && o.status !== 'signed' && o.status !== 'declined');
    if (earlier.length > 0) {
      res.status(409).json({ error: 'earlier signers still pending (sequential mode)' }); return;
    }
  }
  const now = new Date();
  await db.update(signersTable).set({ status: 'signed', signedAt: now })
    .where(eq(signersTable.id, sg.id));
  if (pkg.status === 'draft') {
    await db.update(signaturePackagesTable).set({ status: 'in_progress' })
      .where(eq(signaturePackagesTable.id, pkg.id));
  }
  const all = await db.select().from(signersTable).where(eq(signersTable.packageId, pkg.id));
  const [fresh] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, pkg.id));
  await maybeCompletePackageAndCreateOC(req, fresh!, all);
  const [after] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, pkg.id));
  res.json(await buildSignatureDetail(after!));
});

// ── PRICE INCREASES ──
function mapCampaign(c: typeof priceIncreaseCampaignsTable.$inferSelect, letters: typeof priceIncreaseLettersTable.$inferSelect[]) {
  const accepted = letters.filter(l => l.status === 'accepted');
  const pending = letters.filter(l => l.status === 'pending' || l.status === 'negotiating');
  const rejected = letters.filter(l => l.status === 'rejected');
  return {
    id: c.id, name: c.name, status: c.status,
    effectiveDate: typeof c.effectiveDate === 'string' ? c.effectiveDate : iso(c.effectiveDate)!.slice(0, 10),
    accountsCount: letters.length,
    totalUplift: letters.reduce((s, l) => s + num(l.upliftPct), 0),
    currency: c.currency, createdAt: iso(c.createdAt)!,
    acceptedCount: accepted.length, pendingCount: pending.length, rejectedCount: rejected.length,
    averageUpliftPct: num(c.averageUpliftPct),
  };
}

router.get('/price-increases', async (req, res) => {
  const accIds = await allowedAccountIds(req);
  const rows = await db.select().from(priceIncreaseCampaignsTable);
  const letters = await db.select().from(priceIncreaseLettersTable);
  const visibleLetter = (l: typeof letters[number]) => isAccountAllowed(accIds, l.accountId);
  // Hide campaigns where the user has zero visible letters to prevent metadata leak.
  const visible = rows.filter(c => letters.some(l => l.campaignId === c.id && visibleLetter(l)));
  res.json(visible.map(c => mapCampaign(c, letters.filter(l => l.campaignId === c.id && visibleLetter(l)))));
});

router.get('/price-increases/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetPriceIncreaseParams })) return;
  const [c] = await db.select().from(priceIncreaseCampaignsTable).where(eq(priceIncreaseCampaignsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  const accIds = await allowedAccountIds(req);
  const lettersRaw = await db.select().from(priceIncreaseLettersTable).where(eq(priceIncreaseLettersTable.campaignId, c.id));
  const letters = lettersRaw.filter(l => isAccountAllowed(accIds, l.accountId));
  // Mask campaigns with no visible letters as not-found.
  if (letters.length === 0) { res.status(404).json({ error: 'not found' }); return; }
  const accs = await getAccountMap();
  res.json({
    ...mapCampaign(c, letters),
    letters: letters.map(l => ({
      id: l.id, campaignId: l.campaignId, accountId: l.accountId,
      accountName: accs.get(l.accountId)?.name ?? 'Unknown',
      status: l.status, upliftPct: num(l.upliftPct),
      sentAt: iso(l.sentAt), respondedAt: iso(l.respondedAt),
    })),
  });
});

// ── REPORTS ──
router.get('/reports/dashboard', async (req, res) => {
  const deals = await db.select().from(dealsTable).where(dealsWhereSql(getScope(req)));
  const open = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  const won = deals.filter(d => d.stage === 'won').length;
  const lost = deals.filter(d => d.stage === 'lost').length;
  const stages = ['qualified', 'discovery', 'proposal', 'negotiation', 'closing'];
  const stageBreakdown = stages.map(s => {
    const ds = open.filter(d => d.stage === s);
    return { stage: s, label: stageLabels[s] ?? s, count: ds.length, value: ds.reduce((sum, d) => sum + num(d.value), 0) };
  });
  const dealIdSet = await allowedDealIds(req);
  const dealIds = [...dealIdSet];
  const inScopeDealFilter = dealIds.length ? inArray : null;
  const [quotesAwait, openApprovals, sigsPending] = dealIds.length === 0
    ? [0, 0, 0]
    : await Promise.all([
        db.select({ c: sql<number>`count(*)::int` }).from(quotesTable)
          .where(and(eq(quotesTable.status, 'sent'), inScopeDealFilter!(quotesTable.dealId, dealIds))).then(r => r[0]?.c ?? 0),
        db.select({ c: sql<number>`count(*)::int` }).from(approvalsTable)
          .where(and(eq(approvalsTable.status, 'pending'), inScopeDealFilter!(approvalsTable.dealId, dealIds))).then(r => r[0]?.c ?? 0),
        db.select({ c: sql<number>`count(*)::int` }).from(signaturePackagesTable)
          .where(and(eq(signaturePackagesTable.status, 'in_progress'), inScopeDealFilter!(signaturePackagesTable.dealId, dealIds))).then(r => r[0]?.c ?? 0),
      ]);
  const scope = getScope(req);
  // Hard SQL filter: tenant_id pins recent events to the caller's tenant.
  // Restricted (non tenant-wide) users additionally lose any deals they can't
  // see; we keep tenant-global events (NULL dealId) since those belong to
  // the tenant, not to a specific deal/brand/company.
  const tlAll = await db.select().from(timelineEventsTable)
    .where(eq(timelineEventsTable.tenantId, scope.tenantId))
    .orderBy(desc(timelineEventsTable.at))
    .limit(60);
  const tl = (scope.tenantWide && !hasActiveScopeFilter(scope)
    ? tlAll
    : tlAll.filter(t => t.dealId === null || dealIdSet.has(t.dealId))
  ).slice(0, 8);
  const dealMap = await getDealMap();
  // MVP Phase 1 — Vertragswesen-KPIs
  const tenantContracts = await db.select().from(contractsTable)
    .where(eq(contractsTable.tenantId, scope.tenantId));
  const visibleContracts = (scope.tenantWide && !hasActiveScopeFilter(scope))
    ? tenantContracts
    : tenantContracts.filter(c => dealIdSet.has(c.dealId));
  const visibleContractIds = visibleContracts.map(c => c.id);
  const openDeviationsCount = visibleContractIds.length === 0 ? 0 :
    (await db.select({ c: sql<number>`count(*)::int` }).from(clauseDeviationsTable)
      .where(and(
        inArray(clauseDeviationsTable.contractId, visibleContractIds),
        sql`${clauseDeviationsTable.resolvedAt} IS NULL`,
      ))).at(0)?.c ?? 0;
  const overdueObligationsCount = visibleContractIds.length === 0 ? 0 :
    (await db.select({ c: sql<number>`count(*)::int` }).from(obligationsTable)
      .where(and(
        inArray(obligationsTable.contractId, visibleContractIds),
        sql`${obligationsTable.dueAt} < now()`,
        sql`${obligationsTable.status} NOT IN ('done','waived')`,
      ))).at(0)?.c ?? 0;
  // Time-to-Signature: Tage zwischen contract.createdAt und signedAt (ø der letzten 90 Tage)
  const __nowDash = new Date();
  const recentSigned = visibleContracts.filter(c => c.signedAt && c.createdAt
    && (__nowDash.getTime() - new Date(c.signedAt).getTime()) < 90 * 86400000);
  const ttsValues = recentSigned
    .map(c => (new Date(c.signedAt!).getTime() - new Date(c.createdAt!).getTime()) / 86400000)
    .filter(d => d > 0 && d < 365);
  const avgTimeToSignatureDays = ttsValues.length
    ? Math.round((ttsValues.reduce((s, d) => s + d, 0) / ttsValues.length) * 10) / 10
    : null;
  // Approval-Duration ø über entschiedene Approvals
  const decided = await db.select().from(approvalsTable)
    .where(and(
      inArray(approvalsTable.status, ['approved', 'rejected']),
      ...(dealIds.length ? [inArray(approvalsTable.dealId, dealIds)] : []),
    ));
  const apprDurations = decided
    .filter(a => a.decidedAt && a.createdAt)
    .map(a => (new Date(a.decidedAt!).getTime() - new Date(a.createdAt!).getTime()) / 36e5)
    .filter(h => h >= 0 && h < 24 * 30);
  const avgApprovalDurationHours = apprDurations.length
    ? Math.round((apprDurations.reduce((s, h) => s + h, 0) / apprDurations.length) * 10) / 10
    : null;

  res.json({
    openDealsCount: open.length,
    openDealsValue: open.reduce((s, d) => s + num(d.value), 0),
    currency: 'EUR',
    winRatePct: Math.round((won / Math.max(1, won + lost)) * 1000) / 10,
    avgCycleDays: 47,
    quotesAwaitingResponse: quotesAwait,
    openApprovals,
    signaturesPending: sigsPending,
    atRiskDeals: open.filter(d => d.riskLevel === 'high').length,
    openDeviationsCount,
    overdueObligationsCount,
    avgTimeToSignatureDays,
    avgApprovalDurationHours,
    stageBreakdown,
    recentEvents: tl.map(t => ({
      id: t.id, type: t.type, title: t.title, description: t.description,
      actor: t.actor, dealId: t.dealId,
      dealName: t.dealId ? (dealMap.get(t.dealId)?.name ?? null) : null,
      at: iso(t.at)!,
    })),
  });
});

router.get('/reports/performance', async (req, res) => {
  const deals = await db.select().from(dealsTable).where(dealsWhereSql(getScope(req)));
  const won = deals.filter(d => d.stage === 'won');
  const lost = deals.filter(d => d.stage === 'lost');
  const users = await getUserMap(getScope(req).tenantId);
  const monthly = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'].map((m, i) => ({
    month: m,
    won: 3 + ((i * 2) % 5),
    lost: 1 + (i % 3),
    value: 380000 + i * 90000 + (i % 2) * 50000,
  }));
  const ownerAgg = new Map<string, { deals: number; value: number; won: number; lost: number }>();
  for (const d of deals) {
    const cur = ownerAgg.get(d.ownerId) ?? { deals: 0, value: 0, won: 0, lost: 0 };
    cur.deals += 1;
    cur.value += num(d.value);
    if (d.stage === 'won') cur.won += 1;
    if (d.stage === 'lost') cur.lost += 1;
    ownerAgg.set(d.ownerId, cur);
  }
  res.json({
    winRatePct: Math.round((won.length / Math.max(1, won.length + lost.length)) * 1000) / 10,
    avgDiscountPct: 7.4,
    avgCycleDays: 47,
    marginDisciplinePct: 86.2,
    monthly,
    byOwner: Array.from(ownerAgg.entries()).map(([id, agg]) => ({
      ownerId: id, ownerName: users.get(id)?.name ?? 'Unknown',
      deals: agg.deals, value: agg.value,
      winRatePct: Math.round((agg.won / Math.max(1, agg.won + agg.lost)) * 1000) / 10,
    })),
  });
});

router.get('/reports/forecast', async (_req, res) => {
  const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'].map((m, i) => ({
    month: m,
    committed: 480000 + i * 60000,
    bestCase:  720000 + i * 90000,
    pipeline:  1100000 + i * 180000,
  }));
  res.json({ currency: 'EUR', months });
});

// ── COPILOT / ACTIVITY ──
function mapInsight(
  c: typeof copilotInsightsTable.$inferSelect,
  dealMap: Map<string, typeof dealsTable.$inferSelect>,
) {
  return {
    id: c.id, kind: c.kind, title: c.title, summary: c.summary, severity: c.severity,
    dealId: c.dealId, dealName: dealMap.get(c.dealId)?.name ?? 'Unknown',
    suggestedAction: c.suggestedAction, createdAt: iso(c.createdAt)!,
    triggerType: c.triggerType, triggerEntityRef: c.triggerEntityRef,
    status: c.status, actionType: c.actionType,
    actionPayload: c.actionPayload ?? null,
    acknowledgedAt: iso(c.acknowledgedAt), resolvedAt: iso(c.resolvedAt),
    dismissedAt: iso(c.dismissedAt),
  };
}

router.get('/copilot/insights', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListCopilotInsightsQueryParams })) return;
  const scope = getScope(req);
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : null;

  // Tenant + scope contract for copilot insights
  // ─────────────────────────────────────────────
  // 1) Hard SQL tenant filter: copilot_insights carries tenantId since
  //    task #55, so a second tenant can never see this tenant's insights.
  // 2) Restricted (non-tenantWide) users AND tenantWide users with an
  //    active scope filter additionally get a dealId-scope post-filter so
  //    they only see in-tenant insights for deals in their company/brand
  //    scope.
  // 3) Insights are intrinsically deal-bound (every row has a dealId), so
  //    there is no notion of a "tenant-global" insight that would be safe
  //    to surface independent of the deal scope. We deliberately do NOT
  //    bypass scope for empty-scope users — that would leak deal names of
  //    deals they cannot otherwise see (insights carry the deal title).
  // 4) Instead, when the post-filter empties the result for a restricted
  //    user we surface a `scopeRestricted` flag and an `emptyReason`
  //    string in the response envelope. The frontend uses these to render
  //    an explicit empty-state ("your scope is empty — ask an admin"
  //    vs. "your active scope filter excludes every deal") rather than
  //    the generic "no data" placeholder, which was confusing for
  //    restricted users in the same tenant as a tenantWide user who sees
  //    a long list of insights for the same data.
  const conds = [eq(copilotInsightsTable.tenantId, scope.tenantId)];
  if (status) conds.push(eq(copilotInsightsTable.status, status));
  const rows = await db.select().from(copilotInsightsTable)
    .where(and(...conds))
    .orderBy(desc(copilotInsightsTable.createdAt));

  const restricted = !scope.tenantWide || hasActiveScopeFilter(scope);
  let filtered = rows;
  let emptyReason: 'scope_empty' | 'scope_filter_excludes_all' | null = null;
  if (restricted) {
    const dealIds = await allowedDealIds(req);
    filtered = rows.filter(c => dealIds.has(c.dealId));
    if (filtered.length === 0 && rows.length > 0) {
      // There ARE in-tenant insights, but none are visible to this user.
      // Classify *why* so the UI can render the right hint:
      //   scope_empty               — restricted user with zero permissions
      //                               (admin needs to grant company/brand)
      //   scope_filter_excludes_all — user has permissions but their active
      //                               scope filter excludes every visible deal
      //   null                      — user has permissions and no active
      //                               filter; their permitted scope simply
      //                               doesn't intersect any insight-deal.
      //                               We leave this as generic "no data" to
      //                               avoid implying an active filter that
      //                               isn't there.
      if (hasActiveScopeFilter(scope)) {
        emptyReason = 'scope_filter_excludes_all';
      } else if (
        !scope.tenantWide &&
        scope.companyIds.length === 0 &&
        scope.brandIds.length === 0
      ) {
        emptyReason = 'scope_empty';
      }
    }
  }

  const dealMap = await getDealMap();
  res.json({
    items: filtered.map(c => mapInsight(c, dealMap)),
    scopeRestricted: restricted,
    emptyReason,
  });
});

router.patch('/copilot/insights/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.PatchCopilotInsightParams, body: Z.PatchCopilotInsightBody })) return;
  const scope = getScope(req);
  const [c] = await db.select().from(copilotInsightsTable).where(eq(copilotInsightsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  const b = req.body;
  const next = b?.status;
  if (!next || !['open','acknowledged','resolved','dismissed'].includes(next)) {
    res.status(400).json({ error: 'invalid status' }); return;
  }
  const patch: Record<string, unknown> = { status: next };
  if (next === 'acknowledged') patch['acknowledgedAt'] = new Date();
  if (next === 'resolved') patch['resolvedAt'] = new Date();
  if (next === 'dismissed') patch['dismissedAt'] = new Date();
  await db.update(copilotInsightsTable).set(patch).where(eq(copilotInsightsTable.id, c.id));
  await writeAuditFromReq(req, {    entityType: 'copilot_insight', entityId: c.id, action: `status_${next}`,
    summary: `Insight "${c.title}" → ${next}`,
    before: { status: c.status }, after: { status: next },
    actor: scope?.user.id ?? 'system',
  });
  const [updated] = await db.select().from(copilotInsightsTable).where(eq(copilotInsightsTable.id, c.id));
  const dealMap = await getDealMap();
  res.json(mapInsight(updated!, dealMap));
});

router.post('/copilot/insights/:id/execute', async (req, res) => {
  if (!validateInline(req, res, { params: Z.ExecuteCopilotInsightParams })) return;
  const scope = getScope(req);
  const [c] = await db.select().from(copilotInsightsTable).where(eq(copilotInsightsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;
  if (c.status === 'resolved' || c.status === 'dismissed') {
    res.status(409).json({ error: 'insight already closed' }); return;
  }

  const actor = scope?.user.id ?? 'system';
  const payload = (c.actionPayload ?? {}) as Record<string, unknown>;
  const result: Record<string, unknown> = { actionType: c.actionType };

  try {
    if (c.actionType === 'create_quote_version') {
      const negotiationId = typeof payload['negotiationId'] === 'string' ? payload['negotiationId'] : null;
      if (!negotiationId) throw new Error('missing negotiationId');
      const [n] = await db.select().from(negotiationsTable).where(eq(negotiationsTable.id, negotiationId));
      if (!n) throw new Error('negotiation not found');
      if (n.dealId !== c.dealId) throw new Error('negotiation/deal mismatch');
      const [qs] = await db.select().from(quotesTable).where(eq(quotesTable.dealId, n.dealId));
      if (!qs) throw new Error('no quote for deal');
      const existing = await db.select().from(quoteVersionsTable).where(eq(quoteVersionsTable.quoteId, qs.id));
      const latest = existing.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
      const delta = typeof payload['priceDeltaPct'] === 'number' ? payload['priceDeltaPct'] : -5;
      const total = latest ? num(latest.totalAmount) * (1 + delta / 100) : 0;
      const priorDiscount = latest ? num(latest.discountPct) : 0;
      const newDiscount = Math.max(0, priorDiscount + Math.abs(delta));
      const margin = latest ? Math.max(0, num(latest.marginPct) - Math.abs(delta)) : 0;
      const nextVersion = (latest?.version ?? 0) + 1;
      const vid = `qv_${randomUUID().slice(0, 8)}`;
      await db.insert(quoteVersionsTable).values({
        id: vid, quoteId: qs.id, version: nextVersion,
        status: 'draft',
        totalAmount: String(total),
        discountPct: String(newDiscount),
        marginPct: String(margin),
        notes: `Auto-generated from insight ${c.id} (${actor})`,
      });
      result['quoteVersionId'] = vid;
      result['version'] = nextVersion;
    } else if (c.actionType === 'escalate_approval') {
      const approvalId = typeof payload['approvalId'] === 'string' ? payload['approvalId'] : c.triggerEntityRef;
      if (!approvalId) throw new Error('missing approvalId');
      const [ap] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, approvalId));
      if (!ap) throw new Error('approval not found');
      if (ap.dealId !== c.dealId) throw new Error('approval/deal mismatch');
      await db.update(approvalsTable).set({ priority: 'high' })
        .where(eq(approvalsTable.id, approvalId));
      await db.insert(timelineEventsTable).values({
        id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'approval',
        title: 'Approval eskaliert',
        description: `Approval ${approvalId} eskaliert durch Copilot-Insight.`,
        actor, dealId: c.dealId,
      });
      result['approvalId'] = approvalId;
    } else if (c.actionType === 'send_letter_reminder') {
      const letterId = typeof payload['letterId'] === 'string' ? payload['letterId'] : c.triggerEntityRef;
      if (!letterId) throw new Error('missing letterId');
      const [l] = await db.select().from(priceIncreaseLettersTable).where(eq(priceIncreaseLettersTable.id, letterId));
      if (!l) throw new Error('letter not found');
      const accIds = await allowedAccountIds(req);
      if (!isAccountAllowed(accIds, l.accountId)) throw new Error('letter/account forbidden');
      await db.insert(timelineEventsTable).values({
        id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'reminder',
        title: 'Reminder gesendet',
        description: `Erinnerung an Preiserhöhung (Letter ${l.id}) an Kunde gesendet.`,
        actor, dealId: null,
      });
      result['letterId'] = letterId;
    } else if (c.actionType === 'escalate_margin') {
      const quoteVersionId = typeof payload['quoteVersionId'] === 'string' ? payload['quoteVersionId'] : c.triggerEntityRef;
      if (!quoteVersionId) throw new Error('missing quoteVersionId');
      const aId = `ap_${randomUUID().slice(0, 8)}`;
      await db.insert(approvalsTable).values({
        id: aId, dealId: c.dealId, type: 'margin',
        reason: `Margin-Floor unterschritten (Quote-Version ${quoteVersionId})`,
        requestedBy: actor, status: 'pending', priority: 'high',
        impactValue: '0', currency: 'EUR',
      });
      result['approvalId'] = aId;
    } else {
      throw new Error(`unknown actionType: ${c.actionType}`);
    }

    await db.update(copilotInsightsTable).set({
      status: 'resolved', resolvedAt: new Date(),
    }).where(eq(copilotInsightsTable.id, c.id));
    await writeAuditFromReq(req, {      entityType: 'copilot_insight', entityId: c.id, action: `execute_${c.actionType}`,
      summary: `Insight "${c.title}" ausgeführt (${c.actionType})`,
      after: result, actor,
    });
    res.json({ ok: true, insightId: c.id, result });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/copilot/threads', async (req, res) => {
  // Hard SQL tenant filter: copilot_threads now carries tenantId. "global"
  // and "" scopes are tenant-scoped here — a second tenant cannot see this
  // tenant's "global" threads. The per-row visibility check below still
  // runs to honour deal/account scope for non-tenantWide users within the
  // tenant.
  const scope = getScope(req);
  const rows = await db.select().from(copilotThreadsTable)
    .where(eq(copilotThreadsTable.tenantId, scope.tenantId))
    .orderBy(desc(copilotThreadsTable.updatedAt));
  const visibility = await Promise.all(rows.map(t => copilotThreadVisible(req, t.scope ?? '')));
  const visible = rows.filter((_, i) => visibility[i]);
  res.json(visible.map(t => ({
    id: t.id, title: t.title, scope: t.scope, lastMessage: t.lastMessage,
    messageCount: t.messageCount, updatedAt: iso(t.updatedAt)!,
  })));
});

async function gateThread(req: Request, res: Response, threadId: string) {
  const [t] = await db.select().from(copilotThreadsTable).where(eq(copilotThreadsTable.id, threadId));
  if (!t) { res.status(404).json({ error: 'not found' }); return null; }
  // Cross-tenant access by ID is reported as 404 (not 403) so this endpoint
  // does not double as an existence-oracle for foreign tenants.
  if (t.tenantId !== getScope(req).tenantId) {
    res.status(404).json({ error: 'not found' }); return null;
  }
  if (!(await copilotThreadVisible(req, t.scope ?? ''))) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return t;
}

router.get('/activity', async (req, res) => {
  const scope = getScope(req);
  // Hard SQL tenant filter — rows with NULL dealId (e.g. global "price index
  // uplift" events) are now safely tenant-scoped via the column on the row.
  // For non-tenantWide users we additionally restrict to their visible deals
  // so they don't see events from companies/brands outside their scope.
  const dealIds = await allowedDealIds(req);
  const tenantFilter = eq(timelineEventsTable.tenantId, scope.tenantId);
  let rows: typeof timelineEventsTable.$inferSelect[];
  if (scope.tenantWide && !hasActiveScopeFilter(scope)) {
    rows = await db.select().from(timelineEventsTable)
      .where(tenantFilter)
      .orderBy(desc(timelineEventsTable.at))
      .limit(40);
  } else {
    // Restricted user: include events with NULL dealId (tenant-global events
    // they may legitimately see) plus events for deals in their scope.
    rows = await db.select().from(timelineEventsTable)
      .where(tenantFilter)
      .orderBy(desc(timelineEventsTable.at))
      .limit(200);
    rows = rows.filter(t => t.dealId === null || dealIds.has(t.dealId)).slice(0, 40);
  }
  const dealMap = await getDealMap();
  res.json(rows.map(t => ({
    id: t.id, type: t.type, title: t.title, description: t.description,
    actor: t.actor, dealId: t.dealId,
    dealName: t.dealId ? (dealMap.get(t.dealId)?.name ?? null) : null,
    at: iso(t.at)!,
  })));
});

// ── AUDIT LOG ──
//
// tenantId is REQUIRED on every audit_log row. The schema enforces NOT NULL,
// and writeAudit makes the parameter mandatory so a forgotten call site
// fails at compile-time instead of silently using a default.
async function writeAudit(args: {
  tenantId: string;
  entityType: string; entityId: string; action: string;
  summary: string; before?: unknown; after?: unknown; actor?: string;
  /**
   * Snapshot des aktiven Scopes zum Zeitpunkt der Mutation. Wenn nicht
   * angegeben, wird `null` gespeichert (kein Filter aktiv / nicht relevant).
   */
  activeScope?: { tenantWide: boolean; companyIds: string[] | null; brandIds: string[] | null } | null;
}) {
  await db.insert(auditLogTable).values({
    id: `au_${randomUUID().slice(0, 10)}`,
    tenantId: args.tenantId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    actor: args.actor ?? 'Priya Raman',
    beforeJson: args.before === undefined ? null : JSON.stringify(args.before),
    afterJson: args.after === undefined ? null : JSON.stringify(args.after),
    summary: args.summary,
    activeScopeJson: args.activeScope ? JSON.stringify(args.activeScope) : null,
  });
}

/**
 * Wrapper: writeAudit aus Request-Kontext mit automatischem activeScope
 * Snapshot UND tenantId aus dem authentifizierten Scope. Bevorzugt nutzen
 * für mutating endpoints — diese Variante stellt strukturell sicher, dass
 * keine Aktion in einem fremden Tenant landet.
 */
async function writeAuditFromReq(
  req: Request,
  args: Omit<Parameters<typeof writeAudit>[0], 'activeScope' | 'tenantId'>,
) {
  const scope = getScope(req);
  const snapshot = activeScopeSnapshot(scope);
  await writeAudit({ ...args, tenantId: scope.tenantId, activeScope: snapshot });
}

router.get('/audit', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListAuditEntriesQueryParams })) return;
  const scope = getScope(req);
  // Two-layer authorization:
  //   1. Hard SQL filter on tenantId. Cross-tenant leakage is structurally
  //      impossible — even an INSERT with a bogus entityType cannot leak,
  //      because the row carries a tenantId column.
  //   2. For restricted users (not tenant-wide, OR tenant-wide with an
  //      active company/brand filter), additionally enforce per-entity
  //      visibility via entityInScope. Otherwise an audit row for
  //      `deal:dl_in_co_uk` would still be visible to a co_helix-only user
  //      just because both deals share `tn_root`.
  const filters = [eq(auditLogTable.tenantId, scope.tenantId)];
  if (req.query.entityType) filters.push(eq(auditLogTable.entityType, String(req.query.entityType)));
  if (req.query.entityId)   filters.push(eq(auditLogTable.entityId, String(req.query.entityId)));
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const restricted = !scope.tenantWide || hasActiveScopeFilter(scope);
  // When restricted, fetch a wider window so the post-filter still has
  // enough rows to return up to `limit` after filtering.
  const fetchLimit = restricted ? Math.max(limit * 5, 200) : limit;
  const raw = await db.select().from(auditLogTable)
    .where(and(...filters))
    .orderBy(desc(auditLogTable.at))
    .limit(fetchLimit);
  let rows = raw;
  if (restricted) {
    const allowed = await Promise.all(
      raw.map(a => entityInScope(req, a.entityType, a.entityId)),
    );
    rows = raw.filter((_, i) => allowed[i]).slice(0, limit);
  }
  res.json(rows.map(a => ({
    id: a.id, entityType: a.entityType, entityId: a.entityId,
    action: a.action, actor: a.actor, summary: a.summary,
    beforeJson: a.beforeJson, afterJson: a.afterJson, at: iso(a.at)!,
    activeScopeJson: a.activeScopeJson,
  })));
});

// ── ENTITY VERSIONS ──
router.get('/versions/:entityType/:entityId', async (req, res) => {
  if (!validateInline(req, res, { params: Z.ListEntityVersionsParams })) return;
  const st = await entityScopeStatus(req, req.params.entityType, req.params.entityId);
  if (st !== 'ok') { res.status(st === 'missing' ? 404 : 403).json({ error: st === 'missing' ? 'not found' : 'forbidden' }); return; }
  const rows = await db.select().from(entityVersionsTable)
    .where(and(
      eq(entityVersionsTable.entityType, req.params.entityType),
      eq(entityVersionsTable.entityId, req.params.entityId),
    ))
    .orderBy(desc(entityVersionsTable.version));
  res.json(rows.map(v => ({
    id: v.id, entityType: v.entityType, entityId: v.entityId,
    version: v.version, label: v.label, snapshot: v.snapshot,
    actor: v.actor, comment: v.comment, createdAt: iso(v.createdAt)!,
  })));
});

async function snapshotContract(contractId: string): Promise<string> {
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, contractId));
  const cls = await db.select().from(contractClausesTable).where(eq(contractClausesTable.contractId, contractId));
  return JSON.stringify({ contract: c, clauses: cls });
}

router.post('/contracts/:id/versions', async (req, res) => {
  if (!validateInline(req, res, { params: Z.CreateContractVersionParams, body: Z.CreateContractVersionBody })) return;
  const b = req.body;
  const stC = await entityScopeStatus(req, 'contract', req.params.id);
  if (stC !== 'ok') { res.status(stC === 'missing' ? 404 : 403).json({ error: stC === 'missing' ? 'not found' : 'forbidden' }); return; }
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  const existing = await db.select().from(entityVersionsTable)
    .where(and(eq(entityVersionsTable.entityType, 'contract'), eq(entityVersionsTable.entityId, c.id)));
  const newVersion = (existing.reduce((m, v) => Math.max(m, v.version), c.version)) + 1;
  const id = `ev_${randomUUID().slice(0, 10)}`;
  await db.insert(entityVersionsTable).values({
    id, entityType: 'contract', entityId: c.id, version: newVersion,
    label: b.label, snapshot: b.snapshot ?? await snapshotContract(c.id),
    actor: 'Priya Raman', comment: b.comment ?? null,
  });
  await db.update(contractsTable).set({ version: newVersion }).where(eq(contractsTable.id, c.id));
  await writeAuditFromReq(req, {    entityType: 'contract', entityId: c.id, action: 'version_created',
    summary: `Vertragsversion ${newVersion} angelegt: ${b.label}`,
  });
  const [v] = await db.select().from(entityVersionsTable).where(eq(entityVersionsTable.id, id));
  res.status(201).json({
    id: v!.id, entityType: v!.entityType, entityId: v!.entityId,
    version: v!.version, label: v!.label, snapshot: v!.snapshot,
    actor: v!.actor, comment: v!.comment, createdAt: iso(v!.createdAt)!,
  });
});

router.post('/price-positions/:id/versions', async (req, res) => {
  if (!validateInline(req, res, { params: Z.CreatePricePositionVersionParams, body: Z.CreatePricePositionVersionBody })) return;
  const b = req.body;
  const stP = await entityScopeStatus(req, 'price_position', req.params.id);
  if (stP !== 'ok') { res.status(stP === 'missing' ? 404 : 403).json({ error: stP === 'missing' ? 'not found' : 'forbidden' }); return; }
  const [p] = await db.select().from(pricePositionsTable).where(eq(pricePositionsTable.id, req.params.id));
  if (!p) { res.status(404).json({ error: 'not found' }); return; }
  const existing = await db.select().from(entityVersionsTable)
    .where(and(eq(entityVersionsTable.entityType, 'price_position'), eq(entityVersionsTable.entityId, p.id)));
  const newVersion = (existing.reduce((m, v) => Math.max(m, v.version), p.version)) + 1;
  const id = `ev_${randomUUID().slice(0, 10)}`;
  await db.insert(entityVersionsTable).values({
    id, entityType: 'price_position', entityId: p.id, version: newVersion,
    label: b.label, snapshot: b.snapshot ?? JSON.stringify(p),
    actor: 'Priya Raman', comment: b.comment ?? null,
  });
  await db.update(pricePositionsTable).set({ version: newVersion }).where(eq(pricePositionsTable.id, p.id));
  await writeAuditFromReq(req, {    entityType: 'price_position', entityId: p.id, action: 'version_created',
    summary: `Preis ${p.sku} neue Version ${newVersion}`,
  });
  const [v] = await db.select().from(entityVersionsTable).where(eq(entityVersionsTable.id, id));
  res.status(201).json({
    id: v!.id, entityType: v!.entityType, entityId: v!.entityId,
    version: v!.version, label: v!.label, snapshot: v!.snapshot,
    actor: v!.actor, comment: v!.comment, createdAt: iso(v!.createdAt)!,
  });
});

// ── PRICING RESOLVE (hierarchical) ──
router.get('/pricing/resolve', async (req, res) => {
  // Capture asOf before validation strips unknown query params.
  if (isInvalidAsOf(req.query.asOf)) { res.status(422).json({ error: 'invalid asOf' }); return; }
  const asOf = parseAsOf(req.query.asOf);
  if (!validateInline(req, res, { query: Z.ResolvePriceQueryParams })) return;
  const sku = String(req.query.sku ?? '');
  const brandId = req.query.brandId ? String(req.query.brandId) : null;
  const companyId = req.query.companyId ? String(req.query.companyId) : null;
  if (!sku) { res.status(400).json({ error: 'sku required' }); return; }

  const scope = getScope(req);
  const allowedBrands = new Set(await allowedBrandIds(req));
  const allowedCompanies = new Set(await allowedCompanyIds(req));
  // Tenant-bound: join companies and filter by tenantId.
  const tenantPositions = (await db
    .select({ p: pricePositionsTable })
    .from(pricePositionsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, pricePositionsTable.companyId))
    .where(eq(companiesTable.tenantId, scope.tenantId))
  ).map(r => r.p);
  const positions = tenantPositions
    .filter(p => p.sku === sku && p.status === 'active')
    .filter(p => (scope.tenantWide && !hasActiveScopeFilter(scope)) || allowedBrands.has(p.brandId) || allowedCompanies.has(p.companyId));
  const brands = await getBrandMap();
  const companies = await getCompanyMap();

  // For asOf: compute historical candidates from snapshots or the pre-change
  // live row, then apply precedence on those historical records. Positions
  // whose first existence is after asOf are excluded.
  if (asOf) {
    type HistCand = {
      id: string; brandId: string; companyId: string; sku: string;
      status: string; listPrice: number; currency: string;
      validFrom: string | null; validTo: string | null;
      version: number | null; source: 'live' | 'version';
    };
    // Use tenantPositions (unfiltered by sku/status) because historical status
    // may differ from current; then filter on historical snapshot data.
    const allCandidates: HistCand[] = [];
    for (const p of tenantPositions) {
      const snap = await resolveSnapshot<Record<string, unknown>>('price_position', p.id, asOf);
      if (snap) {
        const d = snap.data;
        allCandidates.push({
          id: p.id,
          brandId: String(d.brandId ?? p.brandId),
          companyId: String(d.companyId ?? p.companyId),
          sku: String(d.sku ?? p.sku),
          status: String(d.status ?? p.status),
          listPrice: num(d.listPrice),
          currency: String(d.currency ?? p.currency),
          validFrom: snap.validFrom,
          validTo: snap.validTo,
          version: snap.version ?? null,
          source: 'version',
        });
      } else {
        // No snapshot: only include if position existed at asOf (validFrom <=).
        const vfDate = p.validFrom ? new Date(String(p.validFrom)).getTime() : 0;
        if (vfDate > asOf.getTime()) continue;
        allCandidates.push({
          id: p.id, brandId: p.brandId, companyId: p.companyId, sku: p.sku,
          status: p.status, listPrice: num(p.listPrice), currency: p.currency,
          validFrom: p.validFrom ? String(p.validFrom) : null,
          validTo: null, version: p.version ?? null, source: 'live',
        });
      }
    }
    const inScope = allCandidates.filter(c =>
      c.sku === sku && c.status === 'active' &&
      ((scope.tenantWide && !hasActiveScopeFilter(scope)) || allowedBrands.has(c.brandId) || allowedCompanies.has(c.companyId))
    );
    const bHitH = brandId ? inScope.find(c => c.brandId === brandId) : undefined;
    const cHitH = companyId ? inScope.find(c => c.companyId === companyId && c.brandId !== brandId) : undefined;
    const tHitH = inScope.find(c => !bHitH || (c.brandId !== bHitH.brandId && c.companyId !== bHitH.companyId));
    const winnerH = bHitH ?? cHitH ?? tHitH ?? inScope[0];
    if (!winnerH) { res.status(404).json({ error: 'no price for sku at asOf' }); return; }
    const chainH = [
      { level: 'brand', label: brandId ? (brands.get(brandId)?.name ?? 'Brand') : 'Brand',
        listPrice: bHitH ? bHitH.listPrice : null, applied: !!bHitH, positionId: bHitH?.id ?? null },
      { level: 'company', label: companyId ? (companies.get(companyId)?.name ?? 'Company') : 'Company',
        listPrice: cHitH ? cHitH.listPrice : null, applied: !bHitH && !!cHitH, positionId: cHitH?.id ?? null },
      { level: 'tenant', label: 'Mandanten-Standard',
        listPrice: tHitH ? tHitH.listPrice : null, applied: !bHitH && !cHitH, positionId: tHitH?.id ?? null },
    ];
    res.setHeader('X-Meta-Source', 'version');
    if (winnerH.validFrom) res.setHeader('X-Meta-Valid-From', winnerH.validFrom);
    if (winnerH.validTo) res.setHeader('X-Meta-Valid-To', winnerH.validTo);
    if (winnerH.version != null) res.setHeader('X-Meta-Version', String(winnerH.version));
    res.setHeader('X-Meta-Generated-At', new Date().toISOString());
    res.json({
      sku,
      listPrice: winnerH.listPrice,
      currency: winnerH.currency,
      source: bHitH ? 'brand' : cHitH ? 'company' : 'tenant',
      positionId: winnerH.id,
      chain: chainH,
      meta: {
        source: 'version',
        validFrom: winnerH.validFrom,
        validTo: winnerH.validTo,
        generatedAt: new Date().toISOString(),
        version: winnerH.version,
        asOf: asOf.toISOString(),
      },
    });
    return;
  }

  const brandHit = brandId ? positions.find(p => p.brandId === brandId) : undefined;
  const companyHit = companyId
    ? positions.find(p => p.companyId === companyId && p.brandId !== brandId)
    : undefined;
  const tenantHit = positions.find(p => !brandHit || (p.brandId !== brandHit.brandId && p.companyId !== brandHit.companyId));

  const winner = brandHit ?? companyHit ?? tenantHit ?? positions[0];
  if (!winner) { res.status(404).json({ error: 'no price for sku' }); return; }

  const chain = [
    {
      level: 'brand',
      label: brandId ? (brands.get(brandId)?.name ?? 'Brand') : 'Brand',
      listPrice: brandHit ? num(brandHit.listPrice) : null,
      applied: !!brandHit,
      positionId: brandHit?.id ?? null,
    },
    {
      level: 'company',
      label: companyId ? (companies.get(companyId)?.name ?? 'Company') : 'Company',
      listPrice: companyHit ? num(companyHit.listPrice) : null,
      applied: !brandHit && !!companyHit,
      positionId: companyHit?.id ?? null,
    },
    {
      level: 'tenant',
      label: 'Mandanten-Standard',
      listPrice: tenantHit ? num(tenantHit.listPrice) : null,
      applied: !brandHit && !companyHit,
      positionId: tenantHit?.id ?? null,
    },
  ];

  const vf = typeof winner.validFrom === 'string' ? winner.validFrom : (winner.validFrom ? new Date(winner.validFrom).toISOString() : null);
  const vt = winner.validUntil ? (typeof winner.validUntil === 'string' ? winner.validUntil : new Date(winner.validUntil).toISOString()) : null;

  // If asOf requested, resolve historical price_position snapshot for the winning position.
  let metaSource: 'live' | 'version' = 'live';
  let metaValidFrom: string | null = vf;
  let metaValidTo: string | null = vt;
  let metaVersion: number | null = winner.version ?? null;
  let listPriceOut = num(winner.listPrice);
  let currencyOut = winner.currency;

  if (asOf) {
    const snap = await resolveSnapshot<{ listPrice: string | number; currency: string; version?: number }>(
      'price_position', winner.id, asOf,
    );
    if (!snap) { res.status(404).json({ error: 'no snapshot for asOf' }); return; }
    metaSource = 'version';
    metaValidFrom = snap.validFrom;
    metaValidTo = snap.validTo;
    metaVersion = snap.version ?? null;
    listPriceOut = num(snap.data.listPrice);
    currencyOut = snap.data.currency ?? currencyOut;
  }

  // Legacy header exposure (backward compatibility).
  res.setHeader('X-Meta-Source', metaSource);
  if (metaValidFrom) res.setHeader('X-Meta-Valid-From', metaValidFrom);
  if (metaValidTo) res.setHeader('X-Meta-Valid-To', metaValidTo);
  if (metaVersion != null) res.setHeader('X-Meta-Version', String(metaVersion));
  res.setHeader('X-Meta-Generated-At', new Date().toISOString());

  res.json({
    sku,
    listPrice: listPriceOut,
    currency: currencyOut,
    source: brandHit ? 'brand' : companyHit ? 'company' : 'tenant',
    positionId: winner.id,
    chain,
    meta: {
      source: metaSource,
      validFrom: metaValidFrom,
      validTo: metaValidTo,
      generatedAt: new Date().toISOString(),
      version: metaVersion,
    },
  });
});

// ── PRICE INCREASE LETTER WORKFLOW ──
router.post('/price-increases/:id/letters/:letterId/respond', async (req, res) => {
  if (!validateInline(req, res, { params: Z.RespondToPriceIncreaseLetterParams, body: Z.RespondToPriceIncreaseLetterBody })) return;
  const [pre] = await db.select().from(priceIncreaseLettersTable).where(eq(priceIncreaseLettersTable.id, req.params.letterId));
  if (!pre) { res.status(404).json({ error: 'letter not found' }); return; }
  if (!(await gateAccount(req, res, pre.accountId))) return;
  const b = req.body;
  const newStatus = b.decision === 'accept' ? 'accepted'
    : b.decision === 'reject' ? 'rejected'
    : b.decision === 'negotiate' ? 'negotiating'
    : b.decision;
  await db.update(priceIncreaseLettersTable).set({
    status: newStatus, respondedAt: new Date(),
  }).where(eq(priceIncreaseLettersTable.id, req.params.letterId));
  const [l] = await db.select().from(priceIncreaseLettersTable).where(eq(priceIncreaseLettersTable.id, req.params.letterId));
  if (!l) { res.status(404).json({ error: 'letter not found' }); return; }
  const accs = await getAccountMap();
  const accName = accs.get(l.accountId)?.name ?? 'Unknown';

  if (newStatus === 'accepted') {
    await db.insert(timelineEventsTable).values({
      id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'price_increase',
      title: 'Preiserhöhung angenommen',
      description: `${accName} akzeptierte +${num(l.upliftPct)}%. Vertragsanpassung wird angestoßen.`,
      actor: 'System', dealId: null,
    });
    // Only consider contracts tied to deals the caller can access.
    const scopedDealIds = await allowedDealIds(req);
    const activeContracts = await db.select().from(contractsTable)
      .where(inArray(contractsTable.status, ['signed', 'active', 'countersigned']));
    const deals = await getDealMap();
    const target = activeContracts.find(ctr => {
      if (!scopedDealIds.has(ctr.dealId)) return false;
      return deals.get(ctr.dealId)?.accountId === l.accountId;
    });
    if (target) {
      const aid = `am_${randomUUID().slice(0, 8)}`;
      const number = await nextAmendmentNumber(target.id);
      await db.insert(contractAmendmentsTable).values({
        id: aid,
        originalContractId: target.id,
        number,
        type: 'price-change',
        title: `Preisanpassung +${num(l.upliftPct)}%`,
        description: `Automatisch erzeugt aus akzeptierter Preiserhöhung für ${accName}.`,
        status: 'proposed',
        effectiveFrom: null,
        createdBy: 'System',
      });
      await writeAuditFromReq(req, {        entityType: 'contract_amendment', entityId: aid, action: 'create',
        summary: `Amendment ${number} automatisch aus Preiserhöhung erzeugt`,
        after: { from: 'price_increase_letter', letterId: l.id, upliftPct: num(l.upliftPct) },
      });
    }
  }
  await writeAuditFromReq(req, {    entityType: 'price_increase_letter', entityId: l.id,
    action: `respond_${b.decision}`,
    summary: `${accName}: ${b.decision} (+${num(l.upliftPct)}%)`,
    after: { status: newStatus },
  });
  await resolveInsightsFor('stale_letter', l.id);

  void emitEvent(getScope(req).tenantId, 'price_increase.responded', {
    letterId: l.id, campaignId: l.campaignId, accountId: l.accountId, decision: newStatus,
  });
  res.json({
    id: l.id, campaignId: l.campaignId, accountId: l.accountId,
    accountName: accName, status: l.status, upliftPct: num(l.upliftPct),
    sentAt: iso(l.sentAt), respondedAt: iso(l.respondedAt),
  });
});

// ── ORDER CONFIRMATIONS ──
function mapOC(
  o: typeof orderConfirmationsTable.$inferSelect,
  dealName: string,
  users?: Map<string, typeof usersTable.$inferSelect>,
) {
  return {
    id: o.id, dealId: o.dealId, dealName, contractId: o.contractId,
    number: o.number, status: o.status, readinessScore: o.readinessScore,
    totalAmount: num(o.totalAmount), currency: o.currency,
    expectedDelivery: o.expectedDelivery
      ? (typeof o.expectedDelivery === 'string' ? o.expectedDelivery : iso(o.expectedDelivery)!.slice(0, 10))
      : null,
    handoverAt: iso(o.handoverAt),
    salesOwnerId: o.salesOwnerId ?? null,
    salesOwnerName: o.salesOwnerId ? (users?.get(o.salesOwnerId)?.name ?? null) : null,
    onboardingOwnerId: o.onboardingOwnerId ?? null,
    onboardingOwnerName: o.onboardingOwnerId ? (users?.get(o.onboardingOwnerId)?.name ?? null) : null,
    handoverStartedAt: iso(o.handoverStartedAt),
    slaDays: o.slaDays ?? 7,
    activeOwner: (o.status === 'in_onboarding' || o.status === 'completed') ? 'onboarding' : 'sales',
    createdAt: iso(o.createdAt)!,
  };
}

function buildOcDetail(o: typeof orderConfirmationsTable.$inferSelect, dealName: string, users: Map<string, typeof usersTable.$inferSelect>, checks: Array<typeof orderConfirmationChecksTable.$inferSelect>) {
  const requiredChecks = checks.filter(c => c.required);
  const handoverReady = requiredChecks.length > 0 && requiredChecks.every(c => c.status === 'ok');
  const escalations = checks
    .filter(c => c.required && c.status === 'blocked')
    .map(c => ({ checkId: c.id, label: c.label, reason: c.detail ?? 'Pflicht-Check blockiert Handover' }));
  let daysSinceHandover: number | null = null;
  let slaDeadline: string | null = null;
  let slaBreached = false;
  if (o.handoverStartedAt) {
    const started = new Date(o.handoverStartedAt).getTime();
    const now = Date.now();
    daysSinceHandover = Math.floor((now - started) / 86400000);
    const deadline = new Date(started + (o.slaDays ?? 7) * 86400000);
    slaDeadline = deadline.toISOString();
    slaBreached = o.status !== 'completed' && now > deadline.getTime();
  }
  return {
    ...mapOC(o, dealName, users),
    handoverNote: o.handoverNote ?? null,
    handoverContact: o.handoverContact ?? null,
    handoverContactEmail: o.handoverContactEmail ?? null,
    handoverDeliveryDate: o.handoverDeliveryDate
      ? (typeof o.handoverDeliveryDate === 'string' ? o.handoverDeliveryDate : iso(o.handoverDeliveryDate)!.slice(0, 10))
      : null,
    handoverCriticalNotes: o.handoverCriticalNotes ?? null,
    handoverReady,
    daysSinceHandover,
    slaDeadline,
    slaBreached,
    escalations,
    checks: checks.map(c => ({ id: c.id, label: c.label, status: c.status, detail: c.detail, required: c.required })),
  };
}

router.get('/order-confirmations', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListOrderConfirmationsQueryParams })) return;
  const dealIds = await scopedDealIds(req);
  if (dealIds.length === 0) { res.json([]); return; }
  const filters = [inArray(orderConfirmationsTable.dealId, dealIds)];
  if (req.query.status) filters.push(eq(orderConfirmationsTable.status, String(req.query.status)));
  const rows = await db.select().from(orderConfirmationsTable).where(and(...filters)).orderBy(desc(orderConfirmationsTable.createdAt));
  const dealMap = await getDealMap();
  const userMap = await getUserMap(getScope(req).tenantId);
  const reconciled = await Promise.all(rows.map(async (o) => {
    if (o.status === 'in_onboarding' || o.status === 'completed') return o;
    const checks = await db.select().from(orderConfirmationChecksTable)
      .where(eq(orderConfirmationChecksTable.orderConfirmationId, o.id));
    return reconcileOcState(req, o, checks);
  }));
  res.json(reconciled.map(o => mapOC(o, dealMap.get(o.dealId)?.name ?? 'Unknown', userMap)));
});

async function reconcileOcState(
  req: Request,
  o: typeof orderConfirmationsTable.$inferSelect,
  checks: Array<typeof orderConfirmationChecksTable.$inferSelect>,
): Promise<typeof orderConfirmationsTable.$inferSelect> {
  if (o.status === 'in_onboarding' || o.status === 'completed') return o;
  const requiredChecks = checks.filter(c => c.required);
  const allOk = requiredChecks.length > 0 && requiredChecks.every(c => c.status === 'ok');
  const anyBlocked = requiredChecks.some(c => c.status === 'blocked');
  let target = o.status;
  if (allOk) target = 'ready_for_handover';
  else if (requiredChecks.length > 0) target = 'checks_pending';
  if (target !== o.status) {
    await db.update(orderConfirmationsTable).set({ status: target })
      .where(eq(orderConfirmationsTable.id, o.id));
    await writeAuditFromReq(req, {
      entityType: 'order_confirmation', entityId: o.id, action: 'status_auto_transition',
      summary: `${o.number}: Status automatisch von ${o.status} auf ${target} gesetzt`,
      before: { status: o.status }, after: { status: target },
    });
    o = { ...o, status: target };
  }
  if (anyBlocked) {
    const existing = await db.select().from(auditLogTable)
      .where(and(
        eq(auditLogTable.entityType, 'order_confirmation'),
        eq(auditLogTable.entityId, o.id),
        eq(auditLogTable.action, 'escalation_raised'),
      ));
    if (existing.length === 0) {
      const blocked = requiredChecks.filter(c => c.status === 'blocked');
      await writeAuditFromReq(req, {
        entityType: 'order_confirmation', entityId: o.id, action: 'escalation_raised',
        summary: `${o.number}: ${blocked.length} Pflicht-Check blockiert — Eskalation an Sales-Owner`,
        after: { blockedChecks: blocked.map(b => ({ id: b.id, label: b.label, reason: b.detail })), salesOwnerId: o.salesOwnerId },
      });
      await db.insert(timelineEventsTable).values({
        id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'handover',
        title: 'Eskalation: Pflicht-Check blockiert',
        description: `${o.number}: ${blocked.map(b => b.label).join(', ')}`,
        actor: 'System', dealId: o.dealId,
      });
    }
  }
  return o;
}

router.get('/order-confirmations/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetOrderConfirmationParams })) return;
  const [raw] = await db.select().from(orderConfirmationsTable).where(eq(orderConfirmationsTable.id, req.params.id));
  if (!raw) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, raw.dealId))) return;
  const dealMap = await getDealMap();
  const userMap = await getUserMap(getScope(req).tenantId);
  const checks = await db.select().from(orderConfirmationChecksTable)
    .where(eq(orderConfirmationChecksTable.orderConfirmationId, raw.id));
  const o = await reconcileOcState(req, raw, checks);
  res.json(buildOcDetail(o, dealMap.get(o.dealId)?.name ?? 'Unknown', userMap, checks));
});

async function respondOcDetail(req: Request, res: Response, ocId: string) {
  const [u] = await db.select().from(orderConfirmationsTable).where(eq(orderConfirmationsTable.id, ocId));
  const checks = await db.select().from(orderConfirmationChecksTable)
    .where(eq(orderConfirmationChecksTable.orderConfirmationId, ocId));
  const dealMap = await getDealMap();
  const userMap = await getUserMap(getScope(req).tenantId);
  res.json(buildOcDetail(u!, dealMap.get(u!.dealId)?.name ?? 'Unknown', userMap, checks));
}

router.post('/order-confirmations/:id/handover', async (req, res) => {
  if (!validateInline(req, res, { params: Z.HandoverOrderConfirmationParams, body: Z.HandoverOrderConfirmationBody })) return;
  const [o] = await db.select().from(orderConfirmationsTable).where(eq(orderConfirmationsTable.id, req.params.id));
  if (!o) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, o.dealId))) return;
  if (o.status !== 'ready_for_handover' && o.status !== 'checks_pending') {
    res.status(409).json({ error: `handover not allowed in status ${o.status}` }); return;
  }
  const { onboardingOwnerId, contactName, contactEmail, deliveryDate, note, criticalNotes } = req.body ?? {};
  if (!onboardingOwnerId || !contactName || !contactEmail || !deliveryDate) {
    res.status(400).json({ error: 'missing required fields' }); return;
  }
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, String(onboardingOwnerId)));
  if (!owner) { res.status(400).json({ error: 'onboarding owner not found' }); return; }
  const checks = await db.select().from(orderConfirmationChecksTable)
    .where(eq(orderConfirmationChecksTable.orderConfirmationId, o.id));
  const required = checks.filter(c => c.required);
  const ready = required.length > 0 && required.every(c => c.status === 'ok');
  if (!ready) {
    res.status(400).json({ error: 'required checks not ok', readinessScore: o.readinessScore }); return;
  }
  const now = new Date();
  await db.update(orderConfirmationsTable).set({
    status: 'in_onboarding',
    handoverAt: now,
    handoverStartedAt: now,
    onboardingOwnerId: owner.id,
    handoverNote: note ?? null,
    handoverContact: contactName,
    handoverContactEmail: contactEmail,
    handoverDeliveryDate: String(deliveryDate),
    handoverCriticalNotes: criticalNotes ?? null,
  }).where(eq(orderConfirmationsTable.id, o.id));
  await writeAuditFromReq(req, {    entityType: 'order_confirmation', entityId: o.id, action: 'handover_completed',
    summary: `Auftragsbestätigung ${o.number} an ${owner.name} (Onboarding) übergeben`,
    after: { onboardingOwnerId: owner.id, contactName, contactEmail, deliveryDate, slaDays: o.slaDays },
  });
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'handover',
    title: 'Übergabe an Onboarding',
    description: `Auftragsbestätigung ${o.number} an ${owner.name} übergeben. SLA ${o.slaDays} Tage läuft.`,
    actor: 'Priya Raman', dealId: o.dealId,
  });
  await respondOcDetail(req, res, o.id);
});

router.post('/order-confirmations/:id/complete', async (req, res) => {
  if (!validateInline(req, res, { params: Z.CompleteOrderConfirmationParams })) return;
  const [o] = await db.select().from(orderConfirmationsTable).where(eq(orderConfirmationsTable.id, req.params.id));
  if (!o) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, o.dealId))) return;
  if (o.status !== 'in_onboarding') {
    res.status(409).json({ error: `complete not allowed in status ${o.status}` }); return;
  }
  await db.update(orderConfirmationsTable).set({
    status: 'completed', completedAt: new Date(),
  }).where(eq(orderConfirmationsTable.id, o.id));
  await writeAuditFromReq(req, {    entityType: 'order_confirmation', entityId: o.id, action: 'completed',
    summary: `Onboarding für ${o.number} abgeschlossen`,
  });
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, tenantId: getScope(req).tenantId, type: 'handover',
    title: 'Onboarding abgeschlossen',
    description: `Auftragsbestätigung ${o.number} ist produktiv übergeben.`,
    actor: 'Priya Raman', dealId: o.dealId,
  });
  await respondOcDetail(req, res, o.id);
});

// ── COPILOT CHAT ──
router.get('/copilot/threads/:id/messages', async (req, res) => {
  if (!validateInline(req, res, { params: Z.ListCopilotMessagesParams })) return;
  if (!(await gateThread(req, res, req.params.id))) return;
  // Defense-in-depth: gateThread already proved the thread belongs to the
  // caller's tenant, so under the current data model every message in the
  // thread shares that tenant. The extra `tenantId` predicate is a hard
  // SQL safety net — if a future bug ever inserts a message into a foreign
  // tenant's thread (or migrates threads across tenants), this query will
  // simply omit the bad rows instead of returning them.
  const rows = await db.select().from(copilotMessagesTable)
    .where(and(
      eq(copilotMessagesTable.threadId, req.params.id),
      eq(copilotMessagesTable.tenantId, getScope(req).tenantId),
    ))
    .orderBy(copilotMessagesTable.createdAt);
  res.json(rows.map(m => ({
    id: m.id, threadId: m.threadId, role: m.role, content: m.content, createdAt: iso(m.createdAt)!,
  })));
});

function craftAssistantReply(userText: string): string {
  const t = userText.toLowerCase();
  if (t.includes('rabatt') || t.includes('discount')) {
    return 'Bei Rabatten >8% greift die Margenkontrolle automatisch und legt eine Freigabe in der Approval-Pipeline an. Vorschlag: gegenüber dem Kunden mit Multi-Year-Bindung kontern, dann sinkt der nötige Rabatt im Schnitt um 3 Prozentpunkte.';
  }
  if (t.includes('preiserhöhung') || t.includes('uplift') || t.includes('price increase')) {
    return 'Die Preiserhöhungs-Kampagne läuft mit einem Ø Uplift von 6,8%. Top-Account-Risiko liegt bei Vorwerk und BlueRiver — dort empfehle ich ein persönliches Briefing vor Versand.';
  }
  if (t.includes('vertrag') || t.includes('contract') || t.includes('klausel')) {
    return 'Im Standard-Master sind alle Klauseln auf grün. Erhöhtes Risiko entsteht erst, sobald Liability-Caps oder Auto-Renewal entfernt werden — beides erzeugt automatisch einen Approval-Eintrag.';
  }
  if (t.includes('forecast') || t.includes('prognose')) {
    return 'Committed Forecast für das laufende Quartal liegt bei EUR 1,8 Mio, Best Case bei EUR 3,1 Mio. Hauptrisiken: Vorwerk-Add-On (9 Tage offen) und Castell-Renewal (Champion gewechselt).';
  }
  if (t.includes('hilfe') || t.includes('help') || t.includes('wie')) {
    return 'Ich bin dein Commercial-Copilot. Ich kann Deals priorisieren, Verhandlungstaktiken vorschlagen, Vertragsklauseln einordnen und Reports erklären. Welcher Bereich interessiert dich gerade?';
  }
  return 'Verstanden. Ich analysiere die aktuellen Deals und Verhandlungen und melde mich gleich mit einer konkreten Empfehlung.';
}

router.post('/copilot/threads/:id/messages', async (req, res) => {
  if (!validateInline(req, res, { params: Z.PostCopilotMessageParams, body: Z.PostCopilotMessageBody })) return;
  if (!(await gateThread(req, res, req.params.id))) return;
  const b = req.body;
  const tenantId = getScope(req).tenantId;
  const userId = `cm_${randomUUID().slice(0, 10)}`;
  await db.insert(copilotMessagesTable).values({
    id: userId, tenantId, threadId: req.params.id, role: 'user', content: b.content,
  });
  const reply = craftAssistantReply(b.content);
  const asstId = `cm_${randomUUID().slice(0, 10)}`;
  await db.insert(copilotMessagesTable).values({
    id: asstId, tenantId, threadId: req.params.id, role: 'assistant', content: reply,
  });
  await db.update(copilotThreadsTable).set({
    lastMessage: reply.slice(0, 140),
    messageCount: sql`${copilotThreadsTable.messageCount} + 2`,
    updatedAt: new Date(),
  }).where(eq(copilotThreadsTable.id, req.params.id));
  const [um] = await db.select().from(copilotMessagesTable).where(eq(copilotMessagesTable.id, userId));
  const [am] = await db.select().from(copilotMessagesTable).where(eq(copilotMessagesTable.id, asstId));
  res.status(201).json({
    userMessage: { id: um!.id, threadId: um!.threadId, role: um!.role, content: um!.content, createdAt: iso(um!.createdAt)! },
    assistantMessage: { id: am!.id, threadId: am!.threadId, role: am!.role, content: am!.content, createdAt: iso(am!.createdAt)! },
  });
});

router.post('/copilot/threads', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateCopilotThreadBody })) return;
  const b = req.body;
  const id = `ct_${randomUUID().slice(0, 10)}`;
  await db.insert(copilotThreadsTable).values({
    id, tenantId: getScope(req).tenantId,
    title: b.title, scope: b.scope ?? 'global',
    lastMessage: 'Neuer Chat gestartet.', messageCount: 0,
  });
  const [t] = await db.select().from(copilotThreadsTable).where(eq(copilotThreadsTable.id, id));
  res.status(201).json({
    id: t!.id, title: t!.title, scope: t!.scope, lastMessage: t!.lastMessage,
    messageCount: t!.messageCount, updatedAt: iso(t!.updatedAt)!,
  });
});

// ── AI DIAGNOSTICS ──
// Health-Probe für die AI-Provider-Anbindung (Phase 1 / Schritt 1). Nur für
// Tenant-Admins (tenantWide). Ruft den Provider via runStructured auf und
// schreibt einen Eintrag in ai_invocations — somit gleichzeitig Smoke-Test
// für Provider, Orchestrator, Structured-Output und Audit-Log.
router.get('/copilot/diagnostics/ai-health', async (req, res) => {
  const scope = getScope(req);
  if (!scope.tenantWide) {
    res.status(403).json({ error: 'forbidden', reason: 'tenant_admin_only' });
    return;
  }
  if (!isAIConfigured()) {
    res.status(503).json({
      ok: false,
      provider: 'anthropic',
      configured: false,
      error: 'AI provider not configured',
    });
    return;
  }
  try {
    const result = await runStructured<
      { echo: string },
      { ok: boolean; echoed: string; note: string }
    >({
      promptKey: 'diagnostic.ping',
      input: { echo: 'dealflow-ai-health' },
      scope,
    });
    res.json({
      ok: result.output.ok === true,
      provider: 'anthropic',
      configured: true,
      model: result.model,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      invocationId: result.invocationId,
      sample: { echoed: result.output.echoed, note: result.output.note },
    });
  } catch (err) {
    const e = err as AIOrchestrationError;
    const code = e.code ?? 'unknown';
    // 503 = vorübergehend nicht verfügbar (kein Provider, kein Audit-Sink).
    // 502 = Provider hat geantwortet, aber falsch (validation/no_tool_call).
    const status =
      code === 'config_error' || code === 'audit_unavailable' ? 503 : 502;
    // Stabile, gehärtete Fehlermeldung — niemals interne Fehler-Messages
    // (DB-Treiber, Stack-Hints) an den Client durchreichen. Detail nur ins
    // Server-Log.
    const safeMessage =
      code === 'config_error'
        ? 'AI provider not configured'
        : code === 'audit_unavailable'
        ? 'AI audit subsystem unavailable'
        : code === 'validation_error' || code === 'no_tool_call'
        ? 'AI returned invalid structured output'
        : 'AI provider call failed';
    console.error('[copilot/ai-health]', code, e.message);
    res.status(status).json({
      ok: false,
      provider: 'anthropic',
      configured: true,
      error: safeMessage,
      code,
    });
  }
});

// ── COPILOT MODES (Phase 1 / Schritt 3) ──
//
// Vier produktive Endpoints für die ersten Modi der 10er-Spec:
//   POST /copilot/deal-summary/:dealId
//   POST /copilot/pricing-review/:quoteId
//   POST /copilot/approval-readiness/:approvalId
//   POST /copilot/contract-risk/:contractId
//
// Jede Route:
//   1. baut den scope-validierten Domain-Context (NotInScopeError → 404/403)
//   2. ruft runStructured() — der Orchestrator persistiert den Audit-Eintrag
//      in ai_invocations und erzwingt das zod-Output-Schema
//   3. spiegelt das Ergebnis als copilot_insight (kind='ai_<mode>') in die
//      bestehende Inbox — re-runs werden via unique-index ersetzt
//
// Re-Run-Semantik: triggerType='ai_<mode>' + triggerEntityRef=entityId. Der
// existierende uniqueIndex `copilot_insights_trigger_uniq` macht aus einem
// erneuten Aufruf eine Aktualisierung statt eines Duplikats.

interface CopilotInsightPayload {
  kind: string;
  title: string;
  summary: string;
  severity: string;
  dealId: string;
  triggerType: string;
  triggerEntityRef: string;
  actionType: string | null;
  actionPayload: unknown;
}

async function persistAiInsight(
  tenantId: string,
  payload: CopilotInsightPayload,
): Promise<string> {
  const id = `ci_${randomUUID().slice(0, 8)}`;
  const inserted = await db.insert(copilotInsightsTable)
    .values({
      id,
      tenantId,
      kind: payload.kind,
      title: payload.title,
      summary: payload.summary,
      severity: payload.severity,
      dealId: payload.dealId,
      suggestedAction: null,
      triggerType: payload.triggerType,
      triggerEntityRef: payload.triggerEntityRef,
      status: 'open',
      actionType: payload.actionType,
      actionPayload: (payload.actionPayload ?? null) as never,
    })
    .onConflictDoUpdate({
      target: [
        copilotInsightsTable.tenantId,
        copilotInsightsTable.triggerType,
        copilotInsightsTable.triggerEntityRef,
      ],
      set: {
        kind: payload.kind,
        title: payload.title,
        summary: payload.summary,
        severity: payload.severity,
        actionType: payload.actionType,
        actionPayload: (payload.actionPayload ?? null) as never,
        status: 'open',
        // Re-Run blendet eine vorher als acknowledged/resolved markierte
        // Einsicht wieder als "open" ein und löscht die alten Timestamps,
        // weil die AI-Aussage jetzt aktualisiert ist.
        acknowledgedAt: null,
        resolvedAt: null,
        dismissedAt: null,
      },
    })
    .returning({ id: copilotInsightsTable.id });
  return inserted[0]?.id ?? id;
}

function severityToInsight(s: string): string {
  // Mappt prompt-Risikoebenen auf die Copilot-Insight-Severity-Skala
  // (info/low/medium/high/critical wird genauso übernommen, low|medium|high
  // ebenfalls — alles andere fällt auf 'info' zurück).
  if (['info', 'low', 'medium', 'high', 'critical'].includes(s)) return s;
  return 'info';
}

function mapAiOrchestrationErrorToHttp(
  err: AIOrchestrationError,
  res: Response,
  context: string,
): void {
  const code = err.code ?? 'unknown';
  const status =
    code === 'config_error' || code === 'audit_unavailable' ? 503 : 502;
  const safeMessage =
    code === 'config_error'
      ? 'AI provider not configured'
      : code === 'audit_unavailable'
        ? 'AI audit subsystem unavailable'
        : code === 'validation_error' || code === 'no_tool_call'
          ? 'AI returned invalid structured output'
          : 'AI provider call failed';
  console.error(`[copilot/${context}]`, code, err.message);
  res.status(status).json({ ok: false, error: safeMessage, code });
}

function handleScopeError(err: unknown, res: Response): boolean {
  if (err instanceof NotInScopeError) {
    res.status(err.status === 'missing' ? 404 : 403).json({
      ok: false,
      error: err.status === 'missing' ? 'not_found' : 'forbidden',
    });
    return true;
  }
  return false;
}

// ── 1. Deal Summary ──
router.post('/copilot/deal-summary/:dealId', async (req, res) => {
  const scope = getScope(req);
  if (!isAIConfigured()) {
    res.status(503).json({ ok: false, error: 'AI provider not configured', code: 'config_error' });
    return;
  }
  const dealId = req.params['dealId'] ?? '';
  let ctx: DealContext;
  try {
    ctx = await buildDealContext(req, dealId);
  } catch (e) {
    if (handleScopeError(e, res)) return;
    throw e;
  }
  try {
    const result = await runStructured<DealContext, {
      headline: string; status: string; health: string;
      keyFacts: string[]; blockers: string[]; nextSteps: string[];
      recommendedAction: string;
    }>({
      promptKey: 'deal.summary',
      input: ctx,
      scope,
      entityRef: { entityType: 'deal', entityId: dealId },
    });
    const insightId = await persistAiInsight(scope.tenantId, {
      kind: 'ai_deal_summary',
      title: result.output.headline,
      summary: `${result.output.status} — ${result.output.keyFacts.slice(0, 2).join(' · ')}`,
      severity: severityToInsight(result.output.health),
      dealId,
      triggerType: 'ai_deal_summary',
      triggerEntityRef: dealId,
      actionType: result.output.recommendedAction === 'none' ? null : result.output.recommendedAction,
      actionPayload: { dealId },
    });
    // Konfidenz-Heuristik: gruene Health -> 0.85, gelb -> 0.6, rot -> 0.4.
    // Echte Modell-Logprobs sind in der aktuellen AI-Layer noch nicht verfuegbar.
    const conf = result.output.health === 'green' ? 0.85
      : result.output.health === 'yellow' ? 0.6 : 0.4;
    const recommendationId = await recordRecommendation({
      tenantId: scope.tenantId,
      promptKey: 'deal.summary',
      suggestion: result.output,
      confidence: conf,
      entityType: 'deal',
      entityId: dealId,
      aiInvocationId: result.invocationId,
    });
    res.json({
      ok: true,
      result: result.output,
      invocationId: result.invocationId,
      insightId,
      recommendationId,
      confidence: conf,
      model: result.model,
      latencyMs: result.latencyMs,
      status: 'open',
    });
  } catch (err) {
    if (err instanceof AIOrchestrationError) {
      mapAiOrchestrationErrorToHttp(err, res, 'deal-summary');
      return;
    }
    throw err;
  }
});

// ── 2. Pricing Review ──
router.post('/copilot/pricing-review/:quoteId', async (req, res) => {
  const scope = getScope(req);
  if (!isAIConfigured()) {
    res.status(503).json({ ok: false, error: 'AI provider not configured', code: 'config_error' });
    return;
  }
  const quoteId = req.params['quoteId'] ?? '';
  let ctx: QuoteContext;
  try {
    ctx = await buildQuoteContext(req, quoteId);
  } catch (e) {
    if (handleScopeError(e, res)) return;
    throw e;
  }
  try {
    const result = await runStructured<QuoteContext, {
      summary: string; marginAssessment: string; discountAssessment: string;
      policyFlags: Array<{ topic: string; severity: string; explanation: string }>;
      approvalRelevance: string; recommendedAction: string;
    }>({
      promptKey: 'pricing.review',
      input: ctx,
      scope,
      entityRef: { entityType: 'quote', entityId: quoteId },
    });
    // Schwerste Severity bestimmt die Insight-Severity (visuelles Routing
    // im Approval-Hub).
    const sevRank: Record<string, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
    const flagRank = result.output.policyFlags
      .map((f) => sevRank[f.severity] ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    const marginRank = sevRank[result.output.marginAssessment] ?? 0;
    const finalSev =
      Object.entries(sevRank).find(([, v]) => v === Math.max(flagRank, marginRank))?.[0] ?? 'info';

    const insightId = await persistAiInsight(scope.tenantId, {
      kind: 'ai_pricing_review',
      title: `Pricing-Review für ${ctx.quote.number}`,
      summary: result.output.summary,
      severity: severityToInsight(finalSev),
      dealId: ctx.deal.id,
      triggerType: 'ai_pricing_review',
      triggerEntityRef: quoteId,
      actionType: result.output.recommendedAction === 'none' ? null : result.output.recommendedAction,
      actionPayload: { quoteId, approvalRelevance: result.output.approvalRelevance },
    });
    res.json({
      ok: true,
      result: result.output,
      invocationId: result.invocationId,
      insightId,
      model: result.model,
      latencyMs: result.latencyMs,
      status: 'open',
    });
  } catch (err) {
    if (err instanceof AIOrchestrationError) {
      mapAiOrchestrationErrorToHttp(err, res, 'pricing-review');
      return;
    }
    throw err;
  }
});

// ── 3. Approval Readiness ──
router.post('/copilot/approval-readiness/:approvalId', async (req, res) => {
  const scope = getScope(req);
  if (!isAIConfigured()) {
    res.status(503).json({ ok: false, error: 'AI provider not configured', code: 'config_error' });
    return;
  }
  const approvalId = req.params['approvalId'] ?? '';
  let ctx: ApprovalContext;
  try {
    ctx = await buildApprovalContext(req, approvalId);
  } catch (e) {
    if (handleScopeError(e, res)) return;
    throw e;
  }
  try {
    const result = await runStructured<ApprovalContext, {
      decisionReady: boolean; recommendation: string; rationale: string;
      missingInformation: string[];
      keyDeviations: Array<{ topic: string; severity: string; note: string }>;
      recommendedAction: string;
    }>({
      promptKey: 'approval.readiness',
      input: ctx,
      scope,
      entityRef: { entityType: 'approval', entityId: approvalId },
    });
    // Deterministische Ergänzung: Fehlende Klausel-Übersetzungen werden in
    // missingInformation aufgenommen — unabhängig davon, ob das Modell sie
    // erwähnt. Wenn so etwas vorliegt, gilt der Fall nicht als
    // entscheidungsreif (Auslieferung in nicht freigegebener Sprache wäre
    // riskant).
    if (ctx.missingTranslations.length > 0) {
      const locale = ctx.contract?.language ?? 'en';
      const families = Array.from(new Set(ctx.missingTranslations.map((m) => m.family))).sort();
      const existing = new Set(result.output.missingInformation.map((s) => s.toLowerCase()));
      for (const fam of families) {
        const line = `Übersetzung [${locale}] fehlt: ${fam}`;
        if (!existing.has(line.toLowerCase()) && result.output.missingInformation.length < 8) {
          result.output.missingInformation.push(line);
        }
      }
      result.output.decisionReady = false;
    }
    const insightId = await persistAiInsight(scope.tenantId, {
      kind: 'ai_approval_readiness',
      title: `Approval-Empfehlung: ${result.output.recommendation}`,
      summary: result.output.rationale,
      severity: severityToInsight(result.output.decisionReady ? 'info' : 'medium'),
      dealId: ctx.deal.id,
      triggerType: 'ai_approval_readiness',
      triggerEntityRef: approvalId,
      actionType: result.output.recommendedAction === 'none' ? null : result.output.recommendedAction,
      actionPayload: { approvalId, recommendation: result.output.recommendation },
    });
    res.json({
      ok: true,
      result: result.output,
      invocationId: result.invocationId,
      insightId,
      model: result.model,
      latencyMs: result.latencyMs,
      status: 'open',
    });
  } catch (err) {
    if (err instanceof AIOrchestrationError) {
      mapAiOrchestrationErrorToHttp(err, res, 'approval-readiness');
      return;
    }
    throw err;
  }
});

// ── 4. Contract Risk Review ──
router.post('/copilot/contract-risk/:contractId', async (req, res) => {
  const scope = getScope(req);
  if (!isAIConfigured()) {
    res.status(503).json({ ok: false, error: 'AI provider not configured', code: 'config_error' });
    return;
  }
  const contractId = req.params['contractId'] ?? '';
  let ctx: ContractContext;
  try {
    ctx = await buildContractContext(req, contractId);
  } catch (e) {
    if (handleScopeError(e, res)) return;
    throw e;
  }
  try {
    const result = await runStructured<ContractContext, {
      overallRisk: string; overallScore: number; summary: string;
      riskSignals: Array<{ clause: string; severity: string; finding: string; recommendation: string }>;
      approvalRelevant: boolean; recommendedAction: string;
    }>({
      promptKey: 'contract.risk',
      input: ctx,
      scope,
      entityRef: { entityType: 'contract', entityId: contractId },
    });
    const insightId = await persistAiInsight(scope.tenantId, {
      kind: 'ai_contract_risk',
      title: `Vertragsrisiko: ${ctx.contract.title}`,
      summary: result.output.summary,
      severity: severityToInsight(result.output.overallRisk),
      dealId: ctx.deal.id,
      triggerType: 'ai_contract_risk',
      triggerEntityRef: contractId,
      actionType: result.output.recommendedAction === 'none' ? null : result.output.recommendedAction,
      actionPayload: {
        contractId,
        overallScore: result.output.overallScore,
        approvalRelevant: result.output.approvalRelevant,
      },
    });
    res.json({
      ok: true,
      result: result.output,
      invocationId: result.invocationId,
      insightId,
      model: result.model,
      latencyMs: result.latencyMs,
      status: 'open',
    });
  } catch (err) {
    if (err instanceof AIOrchestrationError) {
      mapAiOrchestrationErrorToHttp(err, res, 'contract-risk');
      return;
    }
    throw err;
  }
});

// ── HELP BOT (stateless, context-aware) ──
const helpRules: Array<{ match: RegExp; reply: string; suggestions: { label: string; path: string }[] }> = [
  {
    match: /(deal|opportunity|pipeline)/i,
    reply: "Im Bereich Deals findest du die gesamte Pipeline pro Stage. Klick auf einen Deal, um Angebote, Verträge, Verhandlungen und Approvals dazu zu sehen. Über Neuer Deal legst du eine Opportunity an.",
    suggestions: [{ label: 'Zur Deal-Pipeline', path: '/deals' }, { label: 'Reports öffnen', path: '/reports' }],
  },
  {
    match: /(angebot|quote)/i,
    reply: "Angebote sind versioniert. Auf jeder Quote-Seite siehst du links die Versions-Historie — über Neue Version entsteht eine neue Variante mit eigenem Rabatt und eigener Marge.",
    suggestions: [{ label: 'Alle Angebote', path: '/quotes' }],
  },
  {
    match: /(rabatt|approval|freigabe)/i,
    reply: 'Sobald ein Rabatt über der Schwelle liegt, landet automatisch ein Eintrag im Approval Hub. Dort kannst du Freigeben oder Ablehnen (mit Kommentar). Jede Entscheidung wird im Audit-Log protokolliert.',
    suggestions: [{ label: 'Approval Hub', path: '/approvals' }, { label: 'Audit-Log', path: '/audit' }],
  },
  {
    match: /(vertrag|klausel|contract)/i,
    reply: "Verträge nutzen Klauselfamilien. Jede Variante hat eine Severity (grün/gelb/rot). Den Risiko-Score gesamthaft siehst du oben rechts auf der Vertragsseite. Über Neue Vertragsversion entsteht eine vollständige Snapshot-Version.",
    suggestions: [{ label: 'Verträge', path: '/contracts' }],
  },
  {
    match: /(verhandlung|negotiation|reaktion)/i,
    reply: 'Verhandlungen werden als strukturierte Kundenreaktionen erfasst (Frage, Einwand, Gegenvorschlag, Zustimmung). So baut sich Round für Round eine echte Historie auf — ideal für AI-Vorschläge.',
    suggestions: [{ label: 'Verhandlungen', path: '/negotiations' }],
  },
  {
    match: /(unterschrift|signatur|signature)/i,
    reply: "Unterschriftspakete laufen sequenziell durch alle Signer. Beim Status Läuft kannst du jederzeit auf Erinnern klicken — das wird auch im Audit-Log dokumentiert.",
    suggestions: [{ label: 'Unterschriften', path: '/signatures' }],
  },
  {
    match: /(preiserhöhung|uplift|kampagne)/i,
    reply: 'Die Preiserhöhungs-Kampagnen zeigen die Annahme-Quote pro Account. Bei Annahme erzeugt das System automatisch einen Vertragsanpassungs-Hinweis im Audit-Log.',
    suggestions: [{ label: 'Preiserhöhungen', path: '/price-increases' }],
  },
  {
    match: /(report|auswertung|forecast)/i,
    reply: 'Reports zeigen Win-Rate, Margendisziplin, Ø Cycle Time und einen 6-Monats-Forecast (Committed/Best Case/Pipeline). Über die Filter oben kannst du nach Brand und Zeitraum eingrenzen.',
    suggestions: [{ label: 'Reports', path: '/reports' }],
  },
  {
    match: /(audit|historie|protokoll)/i,
    reply: 'Im Audit-Log siehst du jede wichtige Änderung — wer hat wann was getan. Du kannst nach Entitäts-Typ und ID filtern.',
    suggestions: [{ label: 'Audit-Log', path: '/audit' }],
  },
  {
    match: /(handover|order confirmation|auftragsbestätigung)/i,
    reply: 'Sobald alle Handover-Checks grün sind, wird die Auftragsbestätigung formal an die Lieferung übergeben. Der Readiness-Score zeigt dir auf einen Blick, was noch fehlt.',
    suggestions: [{ label: 'Auftragsbestätigungen', path: '/order-confirmations' }],
  },
  {
    match: /(sprache|language)/i,
    reply: 'Oben rechts findest du den Sprachumschalter (DE / EN). Die Wahl wird im Browser gespeichert.',
    suggestions: [],
  },
];

// Statisches Routen-Inventar — wird dem KI-Assistenten als Kontext gegeben,
// damit er Navigation und Hilfetexte sinnvoll vorschlagen kann.
const HELP_ROUTES: Array<{ path: string; title: string; purpose: string }> = [
  { path: '/', title: 'Startseite', purpose: 'Tagesüberblick, Pipeline-Snapshot, Aufgaben' },
  { path: '/accounts', title: 'Kunden', purpose: 'Alle Accounts mit Health-Score, Deals und Kontakten' },
  { path: '/contacts', title: 'Kontakte', purpose: 'Personen pro Kunde mit Rollen' },
  { path: '/deals', title: 'Deals', purpose: 'Pipeline-Ansicht aller Verkaufschancen' },
  { path: '/quotes', title: 'Angebote', purpose: 'Versionsbasierte Angebote, Rabatt + Marge' },
  { path: '/pricing', title: 'Pricing', purpose: 'Preislisten und Pricing-Workspace' },
  { path: '/approvals', title: 'Approvals', purpose: 'Freigaben für Rabatte oder Sonderkonditionen' },
  { path: '/contracts', title: 'Verträge', purpose: 'Verträge mit Klauseln und Risiko-Score' },
  { path: '/negotiations', title: 'Verhandlungen', purpose: 'Strukturierte Kundenreaktionen, Counterproposals' },
  { path: '/signatures', title: 'Unterschriften', purpose: 'Sequenzielle Signature-Pakete' },
  { path: '/order-confirmations', title: 'Auftragsbestätigungen', purpose: 'Handover-Checks und Übergabe' },
  { path: '/price-increases', title: 'Preiserhöhungen', purpose: 'Kampagnen mit Annahme-Quote' },
  { path: '/reports', title: 'Reports', purpose: 'Win-Rate, Margendisziplin, Forecast' },
  { path: '/audit', title: 'Audit-Log', purpose: 'Wer hat wann was geändert' },
  { path: '/copilot', title: 'AI Copilot', purpose: 'Geführte AI-Modi für Zusammenfassungen, Pricing, Approvals' },
  { path: '/admin', title: 'Tenant Admin', purpose: 'User-, Rollen- und Scope-Verwaltung' },
];

// Fallback ohne KI: navigiert nur, legt nichts mehr an. Anlegen ist im
// Agent-Pfad echt umgesetzt — wenn der Agent fehlt, sollen wir den Nutzer
// nicht mit "ich öffne den Dialog" anlügen, sondern in den richtigen
// Bereich lotsen, wo er den Dialog selbst aufrufen kann.
const HelpFallbackResponses: Array<{ test: RegExp; reply: string; action?: { kind: string; path?: string } }> = [
  { test: /(kunde|account).*(anlegen|erstellen|neu)/i, reply: 'Lege Kunden hier an: rechts oben "Kunde anlegen". Ich kann das im KI-Modus auch direkt für dich tun, sobald der Assistent wieder erreichbar ist.', action: { kind: 'navigate', path: '/accounts' } },
  { test: /(deal|opportunity).*(anlegen|erstellen|neu)/i, reply: 'Deals legst du hier an: rechts oben "Deal anlegen".', action: { kind: 'navigate', path: '/deals' } },
  { test: /(zeig.*pipeline|wo.*pipeline|alle deals)/i, reply: 'Hier geht\'s zur Pipeline.', action: { kind: 'navigate', path: '/deals' } },
];

function helpFallback(question: string) {
  const hit = HelpFallbackResponses.find(r => r.test.test(question));
  if (hit) {
    return {
      reply: hit.reply,
      suggestions: [] as Array<{ label: string; path: string }>,
      action: hit.action ?? { kind: 'none' as const },
      meta: { source: 'fallback' as const, model: null, latencyMs: null },
    };
  }
  // Letzter Fallback: kein KI-Provider verfügbar.
  return {
    reply: 'Der KI-Assistent ist gerade nicht erreichbar. Ich kann dich aber zu den passenden Bereichen lotsen — wonach suchst du?',
    suggestions: [
      { label: 'Kunden', path: '/accounts' },
      { label: 'Deals', path: '/deals' },
      { label: 'Reports', path: '/reports' },
    ],
    action: { kind: 'none' as const },
    meta: { source: 'fallback' as const, model: null, latencyMs: null },
  };
}

// System-Prompt für den agentischen Help-Bot. Beschreibt Sprache, Tonfall und
// die verfügbaren Tools knapp, damit das Modell weiß, wann es welches aufruft.
const HELP_BOT_AGENT_SYSTEM = (ctx: {
  currentPath: string;
  user: { name: string; role: string; tenantWide: boolean };
  routes: Array<{ path: string; title: string; purpose: string }>;
}) =>
  `Du bist der Hilfe-Assistent von DealFlow.One — einer B2B Commercial Execution ` +
  `Platform. Antworte kurz, sachlich, auf Deutsch (max. 4 Sätze pro Antwort, ` +
  `keine Marketingsprache, keine Emojis).\n\n` +
  `Aktueller Nutzer: ${ctx.user.name} (${ctx.user.role}${ctx.user.tenantWide ? ', tenant-weit' : ', eingeschränkter Scope'}). ` +
  `Aktuelle Seite: ${ctx.currentPath}.\n\n` +
  `Du hast Werkzeuge, um Daten zu lesen UND zu schreiben:\n` +
  `- search_accounts / search_deals / pipeline_stats / recent_activity → Daten nachschlagen.\n` +
  `- create_account / create_contact / create_deal → echte Datensätze anlegen.\n\n` +
  `Verhalten:\n` +
  `1. Bei Fragen zu Zahlen oder Datensätzen RUFE ein Lese-Tool auf, statt zu raten.\n` +
  `2. Bei Anlege-Wünschen: prüfe Pflichtfelder. Wenn alle Angaben da sind, lege es ` +
  `direkt an und bestätige. Fehlt etwas, frage präzise nach EINEM Feld.\n` +
  `3. Bei reinen Navigationsfragen erkläre kurz und nenne den passenden Bereich. ` +
  `Verfügbare Routen: ${ctx.routes.map(r => `${r.path} (${r.title})`).join(', ')}.\n` +
  `4. Schließe Antworten auf erledigte Anlegungen z.B. mit "Habe Kunde 'X' (id) angelegt." ab.\n` +
  `5. Wenn du etwas nicht sicher weißt, sage das ehrlich.`;

router.post('/copilot/help', async (req, res) => {
  if (!validateInline(req, res, { body: Z.AskHelpBotBody })) return;
  const b = req.body;
  const question = (b.question ?? '').trim();
  if (!question) {
    res.json({
      reply: 'Stell mir gerne eine Frage — z.B. "Wie lege ich einen neuen Deal an?" oder "Was sind meine 3 größten offenen Deals?"',
      suggestions: [],
      action: { kind: 'none' },
      traces: [],
      meta: { source: 'fallback', model: null, latencyMs: null, steps: 0 },
    });
    return;
  }

  const scope = getScope(req);
  const history = (b.history ?? []).filter((h: { role: string; content: string }) => h.role === 'user' || h.role === 'assistant') as Array<{ role: 'user' | 'assistant'; content: string }>;
  const currentPath = (b.currentPath as string | null | undefined) ?? '/';

  if (!isAIConfigured()) {
    res.json({ ...helpFallback(question), traces: [] });
    return;
  }

  try {
    const result = await runAgent({
      promptKey: 'assistant.help',
      model: 'claude-haiku-4-5',
      system: HELP_BOT_AGENT_SYSTEM({
        currentPath,
        user: { name: scope.user.name, role: scope.user.role, tenantWide: scope.tenantWide },
        routes: HELP_ROUTES,
      }),
      userMessage: question,
      history: history.slice(-6),
      tools: [...HELP_BOT_TOOLS_AS_AGENT_TOOLS],
      scope,
      req,
      maxSteps: 6,
    });

    // Ableiten von suggestions/action aus den traces:
    //  - wenn create_* erfolgreich lief → action='navigate' zur Übersicht
    //  - sonst: bekannte Routen, die der Bot in seiner Antwort erwähnt
    const validRoutes = new Set(HELP_ROUTES.map((r) => r.path));
    let action: { kind: string; path?: string | null; accountId?: string | null } = { kind: 'none' };
    const lastCreate = [...result.traces].reverse().find(
      (t) => t.kind === 'tool_call' && (t.tool === 'create_account' || t.tool === 'create_deal' || t.tool === 'create_contact'),
    );
    if (lastCreate?.tool === 'create_account') {
      action = { kind: 'navigate', path: '/accounts' };
    } else if (lastCreate?.tool === 'create_deal') {
      action = { kind: 'navigate', path: '/deals' };
    } else if (lastCreate?.tool === 'create_contact') {
      action = { kind: 'navigate', path: '/accounts' };
    } else {
      // Heuristik: bekannte Routen, die im Reply per Pfad erwähnt wurden,
      // werden als suggestions vorgeschlagen.
    }

    const mentioned = HELP_ROUTES.filter((r) => result.reply.includes(r.path) || result.reply.toLowerCase().includes(r.title.toLowerCase()));
    const suggestions = mentioned.slice(0, 3).map((r) => ({ label: r.title, path: r.path })).filter((s) => validRoutes.has(s.path));

    // Frontend-freundliche Trace-Ansicht: kürzen auf max 8 Einträge, Inhalt
    // jeder trace ist bereits durch agent.ts JSON-friendly.
    const trimmedTraces: AgentTrace[] = result.traces.slice(-8);

    res.json({
      reply: result.reply,
      suggestions,
      action,
      traces: trimmedTraces,
      meta: { source: 'ai', model: result.model, latencyMs: result.latencyMs, steps: result.steps },
    });
  } catch (err) {
    if (err instanceof AIOrchestrationError) {
      // Fail soft — der Hilfe-Assistent darf nie 5xx erzeugen.
      req.log?.warn({ code: err.code, msg: err.message }, 'help-bot AI error, using fallback');
      res.json({ ...helpFallback(question), traces: [] });
      return;
    }
    throw err;
  }
});

// Kept for any future runStructured-based fallback; silences unused import.
void runStructured;
void ((): HelpAssistantInput | null => null);

// ── EXTEND APPROVAL & DEAL DECISIONS WITH AUDIT ──
// We hook into existing endpoints by re-using writeAudit at point-of-call would
// require refactoring. Instead expose a lightweight wrapper for new clients:
const ManualAuditBody = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  action: z.string().min(1),
  summary: z.string().min(1),
  actor: z.string().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});

router.post('/audit/manual', async (req, res) => {
  if (!validateInline(req, res, { body: ManualAuditBody })) return;
  const b = req.body;
  await writeAuditFromReq(req, b);
  res.status(201).json({ ok: true });
});

// ── Admin helpers ──
function requireAdmin(req: Request, res: Response): boolean {
  const scope = getScope(req);
  if (!scope.tenantWide) {
    res.status(403).json({ error: 'admin rights required' });
    return false;
  }
  return true;
}

// Stricter gate for user/role management: explicit Tenant Admin role.
function requireTenantAdmin(req: Request, res: Response): boolean {
  const scope = getScope(req);
  if (!scope.tenantWide || scope.user.role !== 'Tenant Admin') {
    res.status(403).json({ error: 'tenant admin role required' });
    return false;
  }
  return true;
}

async function validateTenantRole(tenantId: string, roleName: string): Promise<boolean> {
  const [row] = await db.select().from(rolesTable)
    .where(and(eq(rolesTable.tenantId, tenantId), eq(rolesTable.name, roleName)));
  return !!row;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

function parseJsonList(s: string | null | undefined): string[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; }
  catch { return []; }
}

function scopeSummary(u: typeof usersTable.$inferSelect, companiesById: Map<string, string>, brandsById: Map<string, string>): string {
  if (u.tenantWide) return 'Tenant-weit';
  const companies = parseJsonList(u.scopeCompanyIds).map(id => companiesById.get(id) ?? id);
  const brands = parseJsonList(u.scopeBrandIds).map(id => brandsById.get(id) ?? id);
  const parts: string[] = [];
  if (companies.length) parts.push(`${companies.length} Company${companies.length === 1 ? '' : 's'}: ${companies.join(', ')}`);
  if (brands.length) parts.push(`${brands.length} Brand${brands.length === 1 ? '' : 's'}: ${brands.join(', ')}`);
  if (!parts.length) return 'Kein Scope';
  return parts.join(' · ');
}

async function mapAdminUser(u: typeof usersTable.$inferSelect) {
  const companies = await db.select().from(companiesTable).where(eq(companiesTable.tenantId, u.tenantId));
  const brandRows = companies.length
    ? await db.select().from(brandsTable).where(inArray(brandsTable.companyId, companies.map(c => c.id)))
    : [];
  const cMap = new Map(companies.map(c => [c.id, c.name] as const));
  const bMap = new Map(brandRows.map(b => [b.id, b.name] as const));
  return {
    id: u.id, name: u.name, email: u.email, role: u.role, initials: u.initials,
    avatarColor: u.avatarColor, isActive: u.isActive, tenantWide: u.tenantWide,
    scopeCompanyIds: parseJsonList(u.scopeCompanyIds),
    scopeBrandIds: parseJsonList(u.scopeBrandIds),
    scopeSummary: scopeSummary(u, cMap, bMap),
  };
}

// ── Admin: Users ──
router.get('/admin/users', async (req, res) => {
  if (!requireTenantAdmin(req, res)) return;
  const scope = getScope(req);
  const rows = await db.select().from(usersTable).where(eq(usersTable.tenantId, scope.tenantId));
  const mapped = await Promise.all(rows.map(mapAdminUser));
  res.json(mapped);
});

router.post('/admin/users', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateAdminUserBody })) return;
  if (!requireTenantAdmin(req, res)) return;
  const scope = getScope(req);
  const b = req.body;
  if (!b.name || !b.email || !b.role || !b.password) {
    res.status(400).json({ error: 'name, email, role, password required' });
    return;
  }
  if (b.password.length < 8) {
    res.status(400).json({ error: 'password must be at least 8 characters' });
    return;
  }
  if (!(await validateTenantRole(scope.tenantId, b.role))) {
    res.status(400).json({ error: 'unknown role for this tenant' });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, b.email));
  if (existing) { res.status(409).json({ error: 'email already registered' }); return; }
  const tenantCompanies = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.tenantId, scope.tenantId));
  const tenantCompanyIds = new Set(tenantCompanies.map(c => c.id));
  const tenantBrands = tenantCompanies.length
    ? await db.select({ id: brandsTable.id }).from(brandsTable).where(inArray(brandsTable.companyId, [...tenantCompanyIds]))
    : [];
  const tenantBrandIds = new Set(tenantBrands.map(x => x.id));
  const validCompanies = ((b.scopeCompanyIds ?? []) as string[]).filter((id: string) => tenantCompanyIds.has(id));
  const validBrands = ((b.scopeBrandIds ?? []) as string[]).filter((id: string) => tenantBrandIds.has(id));
  const { hashPassword } = await import('../lib/auth');
  const id = `u_${randomUUID().slice(0, 8)}`;
  const [ins] = await db.insert(usersTable).values({
    id,
    name: b.name.trim(),
    email: b.email.trim().toLowerCase(),
    role: b.role,
    scope: b.tenantWide ? 'Tenant-weit' : (validCompanies.length || validBrands.length ? 'Scoped' : 'Kein Scope'),
    initials: initials(b.name),
    avatarColor: null,
    passwordHash: hashPassword(b.password),
    isActive: true,
    tenantId: scope.tenantId,
    tenantWide: !!b.tenantWide,
    scopeCompanyIds: JSON.stringify(validCompanies),
    scopeBrandIds: JSON.stringify(validBrands),
  }).returning();
  await writeAuditFromReq(req, {    entityType: 'user', entityId: id, action: 'create',
    summary: `Benutzer angelegt: ${b.name} (${b.role})`,
    after: { email: b.email, role: b.role, tenantWide: !!b.tenantWide },
    actor: scope.user.name,
  });
  res.status(201).json(await mapAdminUser(ins!));
});

router.patch('/admin/users/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdateAdminUserParams, body: Z.UpdateAdminUserBody })) return;
  if (!requireTenantAdmin(req, res)) return;
  const scope = getScope(req);
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!u) { res.status(404).json({ error: 'not found' }); return; }
  if (u.tenantId !== scope.tenantId) { res.status(403).json({ error: 'forbidden' }); return; }
  const b = req.body;
  const patch: Partial<typeof usersTable.$inferInsert> = {};
  if (typeof b.name === 'string' && b.name.trim()) {
    patch.name = b.name.trim();
    patch.initials = initials(b.name);
  }
  if (typeof b.role === 'string' && b.role.trim()) {
    if (!(await validateTenantRole(scope.tenantId, b.role))) {
      res.status(400).json({ error: 'unknown role for this tenant' });
      return;
    }
    patch.role = b.role;
  }
  if (typeof b.isActive === 'boolean') {
    if (!b.isActive && u.id === scope.user.id) {
      res.status(400).json({ error: 'cannot deactivate your own account' });
      return;
    }
    patch.isActive = b.isActive;
  }
  if (typeof b.tenantWide === 'boolean') patch.tenantWide = b.tenantWide;
  if (Array.isArray(b.scopeCompanyIds) || Array.isArray(b.scopeBrandIds)) {
    const tenantCompanies = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.tenantId, scope.tenantId));
    const tenantCompanyIds = new Set(tenantCompanies.map(c => c.id));
    const tenantBrands = tenantCompanies.length
      ? await db.select({ id: brandsTable.id }).from(brandsTable).where(inArray(brandsTable.companyId, [...tenantCompanyIds]))
      : [];
    const tenantBrandIds = new Set(tenantBrands.map(x => x.id));
    if (Array.isArray(b.scopeCompanyIds)) {
      const arr: unknown[] = b.scopeCompanyIds;
      patch.scopeCompanyIds = JSON.stringify(arr.filter((id): id is string => typeof id === 'string' && tenantCompanyIds.has(id)));
    }
    if (Array.isArray(b.scopeBrandIds)) {
      const arr: unknown[] = b.scopeBrandIds;
      patch.scopeBrandIds = JSON.stringify(arr.filter((id): id is string => typeof id === 'string' && tenantBrandIds.has(id)));
    }
  }
  if (typeof b.password === 'string' && b.password.length > 0) {
    if (b.password.length < 8) { res.status(400).json({ error: 'password must be at least 8 characters' }); return; }
    const { hashPassword } = await import('../lib/auth');
    patch.passwordHash = hashPassword(b.password);
  }
  if (Object.keys(patch).length > 0) {
    await db.update(usersTable).set(patch).where(eq(usersTable.id, u.id));
    const redacted = { ...patch };
    if ('passwordHash' in redacted) redacted.passwordHash = '[redacted]';
    await writeAuditFromReq(req, {      entityType: 'user', entityId: u.id, action: 'update',
      summary: `Benutzer aktualisiert: ${u.name}`,
      before: { role: u.role, isActive: u.isActive, tenantWide: u.tenantWide },
      after: redacted,
      actor: scope.user.name,
    });
  }
  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, u.id));
  res.json(await mapAdminUser(updated!));
});

// Katalog aller Permission-Keys, die Custom-Rollen zugewiesen werden können.
// System-Rollen haben implizit alle (oder eine kuratierte Untermenge); siehe
// `SYSTEM_ROLE_PERMISSIONS` weiter unten.
const PERMISSION_CATALOG: ReadonlyArray<{ key: string; label: string; group: string; description?: string }> = [
  { key: 'deal:read',         label: 'Deals einsehen',                 group: 'Deals' },
  { key: 'deal:write',        label: 'Deals anlegen & bearbeiten',     group: 'Deals' },
  { key: 'deal:delete',       label: 'Deals löschen',                  group: 'Deals' },
  { key: 'account:read',      label: 'Kunden einsehen',                group: 'Stammdaten' },
  { key: 'account:write',     label: 'Kunden anlegen & bearbeiten',    group: 'Stammdaten' },
  { key: 'quote:read',        label: 'Angebote einsehen',              group: 'Angebote' },
  { key: 'quote:write',       label: 'Angebote anlegen & bearbeiten',  group: 'Angebote' },
  { key: 'quote:approve',     label: 'Angebote freigeben',             group: 'Angebote' },
  { key: 'contract:read',     label: 'Verträge einsehen',              group: 'Verträge' },
  { key: 'contract:write',    label: 'Verträge anlegen & bearbeiten',  group: 'Verträge' },
  { key: 'approval:approve',  label: 'Freigaben erteilen',             group: 'Approvals',  description: 'Stage-Approvals in Approval-Chains.' },
  { key: 'admin:tenant',      label: 'Tenant-Administration',          group: 'Admin',      description: 'Vollzugriff auf Admin-Bereich.' },
  { key: 'admin:users',       label: 'Nutzer & Rollen verwalten',      group: 'Admin' },
  { key: 'admin:branding',    label: 'Marken & Klauseln pflegen',      group: 'Admin' },
  { key: 'admin:pricing',     label: 'Preise & Bundles pflegen',       group: 'Admin' },
  { key: 'reports:read',      label: 'Reports & Dashboards',           group: 'Analytics' },
];

router.get('/admin/permissions/catalog', async (req, res) => {
  if (!requireTenantAdmin(req, res)) return;
  res.json(PERMISSION_CATALOG.map(p => ({ ...p })));
});

const VALID_PERMISSION_KEYS = new Set(PERMISSION_CATALOG.map(p => p.key));

function normalizePermissions(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const k of input) {
    if (typeof k !== 'string') return null;
    if (!VALID_PERMISSION_KEYS.has(k)) return null;
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

router.get('/admin/roles', async (req, res) => {
  if (!requireTenantAdmin(req, res)) return;
  const scope = getScope(req);
  const rows = await db.select().from(rolesTable).where(eq(rolesTable.tenantId, scope.tenantId));
  res.json(rows.map(r => ({
    id: r.id, name: r.name, description: r.description, isSystem: r.isSystem,
    permissions: Array.isArray(r.permissions) ? r.permissions : [],
  })));
});

router.post('/admin/roles', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateRoleBody })) return;
  if (!requireTenantAdmin(req, res)) return;
  const scope = getScope(req);
  const b = req.body;
  if (!b.name?.trim() || !b.description?.trim()) {
    res.status(400).json({ error: 'name and description required' });
    return;
  }
  let permissions: string[] = [];
  if (b.permissions !== undefined) {
    const norm = normalizePermissions(b.permissions);
    if (norm === null) { res.status(422).json({ error: 'invalid permissions' }); return; }
    permissions = norm;
  }
  const [dup] = await db.select().from(rolesTable)
    .where(and(eq(rolesTable.tenantId, scope.tenantId), eq(rolesTable.name, b.name.trim())));
  if (dup) { res.status(409).json({ error: 'role name already exists' }); return; }
  const id = `ro_${randomUUID().slice(0, 8)}`;
  const [ins] = await db.insert(rolesTable).values({
    id, name: b.name.trim(), description: b.description.trim(),
    isSystem: false, tenantId: scope.tenantId, permissions,
  }).returning();
  await writeAuditFromReq(req, {    entityType: 'role', entityId: id, action: 'create',
    summary: `Rolle angelegt: ${b.name}`,
    after: { name: b.name, description: b.description, permissions },
    actor: scope.user.name,
  });
  res.status(201).json({ id: ins!.id, name: ins!.name, description: ins!.description, isSystem: ins!.isSystem, permissions: ins!.permissions ?? [] });
});

router.patch('/admin/roles/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.UpdateRoleParams, body: Z.UpdateRoleBody })) return;
  if (!requireTenantAdmin(req, res)) return;
  const scope = getScope(req);
  const [r] = await db.select().from(rolesTable).where(eq(rolesTable.id, req.params.id));
  if (!r || r.tenantId !== scope.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  if (r.isSystem) { res.status(400).json({ error: 'cannot modify system role' }); return; }
  const b = req.body;
  const patch: Partial<typeof rolesTable.$inferInsert> = {};
  if (typeof b.name === 'string' && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.description === 'string' && b.description.trim()) patch.description = b.description.trim();
  if (b.permissions !== undefined) {
    const norm = normalizePermissions(b.permissions);
    if (norm === null) { res.status(422).json({ error: 'invalid permissions' }); return; }
    patch.permissions = norm;
  }
  if (Object.keys(patch).length > 0) {
    if (patch.name && patch.name !== r.name) {
      const [dup] = await db.select().from(rolesTable)
        .where(and(eq(rolesTable.tenantId, scope.tenantId), eq(rolesTable.name, patch.name)));
      if (dup && dup.id !== r.id) { res.status(409).json({ error: 'role name already exists' }); return; }
      await db.update(usersTable).set({ role: patch.name })
        .where(and(eq(usersTable.tenantId, scope.tenantId), eq(usersTable.role, r.name)));
    }
    await db.update(rolesTable).set(patch).where(eq(rolesTable.id, r.id));
    await writeAuditFromReq(req, {      entityType: 'role', entityId: r.id, action: 'update',
      summary: `Rolle aktualisiert: ${r.name}`,
      before: { name: r.name, description: r.description, permissions: r.permissions ?? [] },
      after: patch,
      actor: scope.user.name,
    });
  }
  const [updated] = await db.select().from(rolesTable).where(eq(rolesTable.id, r.id));
  res.json({ id: updated!.id, name: updated!.name, description: updated!.description, isSystem: updated!.isSystem, permissions: updated!.permissions ?? [] });
});

router.delete('/admin/roles/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.DeleteRoleParams })) return;
  if (!requireTenantAdmin(req, res)) return;
  const scope = getScope(req);
  const [r] = await db.select().from(rolesTable).where(eq(rolesTable.id, req.params.id));
  if (!r || r.tenantId !== scope.tenantId) { res.status(404).json({ error: 'not found' }); return; }
  if (r.isSystem) { res.status(400).json({ error: 'cannot delete system role' }); return; }
  const [userWithRole] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.tenantId, scope.tenantId), eq(usersTable.role, r.name)));
  if (userWithRole) { res.status(400).json({ error: 'role is in use by users' }); return; }
  await db.delete(rolesTable).where(eq(rolesTable.id, r.id));
  await writeAuditFromReq(req, {    entityType: 'role', entityId: r.id, action: 'delete',
    summary: `Rolle gelöscht: ${r.name}`,
    before: { name: r.name, description: r.description },
    actor: scope.user.name,
  });
  res.status(204).end();
});

router.get('/admin/scope-tree', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const companies = await db.select().from(companiesTable).where(eq(companiesTable.tenantId, scope.tenantId));
  const brandRows = companies.length
    ? await db.select().from(brandsTable).where(inArray(brandsTable.companyId, companies.map(c => c.id)))
    : [];
  res.json({
    companies: companies.map(c => ({
      id: c.id,
      name: c.name,
      brands: brandRows.filter(b => b.companyId === c.id).map(b => ({ id: b.id, name: b.name })),
    })),
  });
});

// ── Admin: Webhook Subscriptions ──
const WebhookCreateBody = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS as [string, ...string[]])).min(1),
  description: z.string().optional(),
  active: z.boolean().optional(),
});
const WebhookPatchBody = z.object({
  url: z.string().url().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS as [string, ...string[]])).min(1).optional(),
  description: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

function mapWebhook(w: typeof webhooksTable.$inferSelect) {
  return {
    id: w.id,
    url: w.url,
    events: w.events,
    active: w.active,
    description: w.description,
    createdAt: w.createdAt.toISOString(),
    // Secret returned only on create (see POST handler).
  };
}

router.get('/admin/webhooks', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const rows = await db.select().from(webhooksTable).where(eq(webhooksTable.tenantId, scope.tenantId));
  res.json(rows.map(mapWebhook));
});

router.post('/admin/webhooks', async (req, res) => {
  if (!validateInline(req, res, { body: WebhookCreateBody })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const b = req.body as z.infer<typeof WebhookCreateBody>;
  try { assertSafeWebhookUrl(b.url); } catch (e) {
    res.status(422).json({ error: (e as Error).message }); return;
  }
  // Resolve DNS once at admin time so the admin sees a clear error if the
  // hostname maps to an internal address. The dispatcher re-checks on every
  // delivery to defeat DNS-rebinding between create and dispatch.
  try { await assertSafeResolvedUrl(b.url); } catch (e) {
    res.status(422).json({ error: (e as Error).message }); return;
  }
  const secret = `whs_${randomUUID().replace(/-/g, '')}`;
  const id = `wh_${randomUUID().slice(0, 8)}`;
  await db.insert(webhooksTable).values({
    id,
    tenantId: scope.tenantId,
    url: b.url,
    events: b.events,
    secret,
    active: b.active ?? true,
    description: b.description ?? null,
  });
  const [row] = await db.select().from(webhooksTable).where(eq(webhooksTable.id, id));
  // Secret is only ever revealed here — clients must persist it.
  res.status(201).json({ ...mapWebhook(row!), secret });
});

router.patch('/admin/webhooks/:id', async (req, res) => {
  if (!validateInline(req, res, { body: WebhookPatchBody, params: z.object({ id: z.string() }) })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(webhooksTable).where(eq(webhooksTable.id, req.params.id));
  if (!existing || existing.tenantId !== scope.tenantId) {
    res.status(404).json({ error: 'not found' }); return;
  }
  const b = req.body as z.infer<typeof WebhookPatchBody>;
  if (b.url !== undefined) {
    try { assertSafeWebhookUrl(b.url); } catch (e) {
      res.status(422).json({ error: (e as Error).message }); return;
    }
    try { await assertSafeResolvedUrl(b.url); } catch (e) {
      res.status(422).json({ error: (e as Error).message }); return;
    }
  }
  const patch: Partial<typeof webhooksTable.$inferInsert> = {};
  if (b.url !== undefined) patch.url = b.url;
  if (b.events !== undefined) patch.events = b.events;
  if (b.active !== undefined) patch.active = b.active;
  if (b.description !== undefined) patch.description = b.description;
  await db.update(webhooksTable).set(patch).where(eq(webhooksTable.id, existing.id));
  const [row] = await db.select().from(webhooksTable).where(eq(webhooksTable.id, existing.id));
  res.json(mapWebhook(row!));
});

router.delete('/admin/webhooks/:id', async (req, res) => {
  if (!validateInline(req, res, { params: z.object({ id: z.string() }) })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [existing] = await db.select().from(webhooksTable).where(eq(webhooksTable.id, req.params.id));
  if (!existing || existing.tenantId !== scope.tenantId) {
    res.status(404).json({ error: 'not found' }); return;
  }
  await db.delete(webhooksTable).where(eq(webhooksTable.id, existing.id));
  res.status(204).end();
});

router.get('/admin/webhook-deliveries', async (req, res) => {
  if (!validateInline(req, res, { query: z.object({ webhookId: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional() }) })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const webhookId = typeof req.query.webhookId === 'string' ? req.query.webhookId : null;
  const conds = [eq(webhookDeliveriesTable.tenantId, scope.tenantId)];
  if (webhookId) conds.push(eq(webhookDeliveriesTable.webhookId, webhookId));
  const rows = await db
    .select()
    .from(webhookDeliveriesTable)
    .where(conds.length === 1 ? conds[0] : and(...conds))
    .orderBy(desc(webhookDeliveriesTable.createdAt))
    .limit(limit);
  res.json(rows.map(d => ({
    id: d.id,
    webhookId: d.webhookId,
    event: d.event,
    status: d.status,
    attempt: d.attempt,
    statusCode: d.statusCode,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
    deliveredAt: d.deliveredAt?.toISOString() ?? null,
    nextAttemptAt: d.nextAttemptAt?.toISOString() ?? null,
  })));
});

// ── DSGVO / GDPR ──

// Search subjects (contacts) within tenant — name/email prefix search.
router.get('/gdpr/subjects', async (req, res) => {
  if (!validateInline(req, res, { query: Z.SearchGdprSubjectsQueryParams })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const q = String(req.query.query ?? '').toLowerCase().trim();
  const type = String(req.query.subjectType ?? 'contact');
  if (type !== 'contact') {
    res.status(400).json({ error: 'unsupported subjectType' });
    return;
  }
  const accIds = await allowedAccountIds(req);
  if (accIds.size === 0) {
    res.json({ tenantId: scope.tenantId, subjectType: type, results: [] });
    return;
  }
  // Tenant + scope-bound at SQL level via accountId IN (...). The tenant's
  // own contact list is fetched by ID set; cross-tenant rows never appear.
  const list = await db.select().from(contactsTable)
    .where(inArray(contactsTable.accountId, [...accIds]));
  const filtered = list.filter(c =>
    q.length === 0 || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  ).slice(0, 50);
  res.json({
    tenantId: scope.tenantId,
    subjectType: type,
    results: filtered.map(c => ({
      id: c.id,
      accountId: c.accountId,
      name: c.name,
      email: c.email,
      deletedAt: iso(c.deletedAt),
      pseudonymizedAt: iso(c.pseudonymizedAt),
    })),
  });
});

router.get('/gdpr/export', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ExportGdprSubjectQueryParams })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const subjectType = String(req.query.subjectType ?? 'contact');
  const subjectId = String(req.query.subjectId ?? '');
  if (subjectType !== 'contact' || !subjectId) {
    res.status(400).json({ error: 'subjectType=contact and subjectId are required' });
    return;
  }
  // Scope check: contact must belong to an allowed account in tenant.
  const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, subjectId));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  const accIds = await allowedAccountIds(req);
  if (!accIds.has(c.accountId)) { res.status(403).json({ error: 'forbidden' }); return; }
  const ok = await exportSubjectZip(res, scope.tenantId, 'contact', subjectId);
  if (!ok && !res.headersSent) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  await writeAuditFromReq(req, {    entityType: 'contact',
    entityId: subjectId,
    action: 'gdpr_export',
    summary: `DSGVO Export erstellt durch ${scope.user.name}`,
  }).catch(() => undefined);
});

router.post('/gdpr/forget', async (req, res) => {
  if (!validateInline(req, res, { body: Z.ForgetGdprSubjectBody })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const body: { subjectType?: string; subjectId?: string; reason?: string } = req.body ?? {};
  const { subjectType, subjectId, reason } = body;
  if (subjectType !== 'contact' || !subjectId) {
    res.status(400).json({ error: 'subjectType=contact and subjectId are required' });
    return;
  }
  const [c] = await db.select().from(contactsTable).where(eq(contactsTable.id, subjectId));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  const accIds = await allowedAccountIds(req);
  if (!accIds.has(c.accountId)) { res.status(403).json({ error: 'forbidden' }); return; }
  const result = await forgetSubject(scope.tenantId, 'contact', subjectId, scope.user.name, reason);
  res.json(result);
});

router.get('/gdpr/access-log', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListGdprAccessLogQueryParams })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const entityType = req.query.entityType ? String(req.query.entityType) : null;
  const entityId = req.query.entityId ? String(req.query.entityId) : null;
  const filters = [eq(accessLogTable.tenantId, scope.tenantId)];
  if (entityType) filters.push(eq(accessLogTable.entityType, entityType));
  if (entityId) filters.push(sql`${accessLogTable.entityId} ILIKE ${'%' + entityId + '%'}`);
  const rows = await db.select().from(accessLogTable)
    .where(filters.length === 1 ? filters[0] : and(...filters))
    .orderBy(desc(accessLogTable.at))
    .limit(200);
  const userMap = await getUserMap(getScope(req).tenantId);
  res.json(rows.map(r => ({
    id: r.id,
    at: iso(r.at),
    actorUserId: r.actorUserId,
    actorName: userMap.get(r.actorUserId)?.name ?? r.actorUserId,
    entityType: r.entityType,
    entityId: r.entityId,
    field: r.field,
    action: r.action,
  })));
});

router.get('/gdpr/deletion-log', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const rows = await db.select().from(subjectsDeletionLogTable)
    .where(eq(subjectsDeletionLogTable.tenantId, scope.tenantId))
    .orderBy(desc(subjectsDeletionLogTable.requestedAt))
    .limit(200);
  res.json(rows.map(r => ({
    id: r.id,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    requestedBy: r.requestedBy,
    reason: r.reason,
    status: r.status,
    requestedAt: iso(r.requestedAt),
    completedAt: iso(r.completedAt),
  })));
});

router.post('/gdpr/retention/run', async (req, res) => {
  if (!validateInline(req, res, { body: z.object({}).passthrough() })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const result = await runRetentionSweepForTenant(scope.tenantId);
  await writeAuditFromReq(req, {    entityType: 'gdpr',
    entityId: scope.tenantId,
    action: 'retention.run',
    actor: scope.user.name,
    summary: 'GDPR Retention-Lauf manuell ausgeführt',
    after: result.applied,
  });
  res.json(result);
});

// Sinnvolle DSGVO-Aufbewahrungs-Defaults. Werden im UI als Vorschlagswert
// angezeigt, bis der Tenant explizit eigene Werte setzt — und vom Sweep auch
// dann verwendet, wenn der Tenant nichts pflegt.
//   contactInactiveDays: Kontakte, die seit X Tagen weder aktualisiert noch
//     in einem Deal aktiv waren, werden pseudonymisiert (Art. 5(1)(e) DSGVO).
//   letterRespondedDays: Preisänderungsschreiben/Kommunikation, auf die der
//     Empfänger seit X Tagen reagiert hat, werden archiviert.
//   auditLogDays / accessLogDays: technische Logs werden nach X Tagen geleert.
const DEFAULT_RETENTION_POLICY: Record<string, number> = {
  contactInactiveDays: 1095,    // 3 Jahre (Verjährung HGB/BGB)
  letterRespondedDays: 730,     // 2 Jahre nach Reaktion
  auditLogDays: 2555,           // 7 Jahre (steuerliche Aufbewahrung)
  accessLogDays: 365,           // 1 Jahr für Zugriffs-Logs
};

router.get('/gdpr/retention-policy', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, scope.tenantId));
  // Effektive Policy = persistierte Werte über Defaults gemerget, damit das UI
  // jederzeit eine vollständige, aktivierte Policy zeigt.
  const stored: Record<string, number> = (t?.retentionPolicy ?? {}) as Record<string, number>;
  const effective = { ...DEFAULT_RETENTION_POLICY, ...stored };
  res.json({
    tenantId: scope.tenantId,
    policy: effective,
    defaults: DEFAULT_RETENTION_POLICY,
    overrides: stored,
  });
});

router.patch('/gdpr/retention-policy', async (req, res) => {
  if (!validateInline(req, res, { body: Z.UpdateGdprRetentionPolicyBody })) return;
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const body: Record<string, unknown> = req.body ?? {};
  const [tRow] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, scope.tenantId));
  const current: Record<string, number> = { ...(tRow?.retentionPolicy ?? {}) };
  const allowed = ['contactInactiveDays', 'letterRespondedDays', 'auditLogDays', 'accessLogDays'] as const;
  // Merge semantics: only update keys that appear in the body.
  //   - number > 0  => set
  //   - null / 0    => remove (explicit clear)
  //   - missing     => keep existing
  for (const k of allowed) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === null || v === 0) {
      delete current[k];
    } else if (typeof v === 'number' && v > 0) {
      current[k] = v;
    }
  }
  await db.update(tenantsTable).set({ retentionPolicy: current }).where(eq(tenantsTable.id, scope.tenantId));
  await writeAuditFromReq(req, {    entityType: 'gdpr',
    entityId: scope.tenantId,
    action: 'retention.policy.update',
    actor: scope.user.name,
    summary: 'GDPR Retention-Policy aktualisiert',
    before: tRow?.retentionPolicy ?? {},
    after: current,
  });
  res.json({ tenantId: scope.tenantId, policy: current });
});

// ───────────── SAVED VIEWS ─────────────
const savedViewInputSchema = z.object({
  entityType: z.enum(['account', 'deal']),
  name: z.string().min(1).max(80),
  filters: z.record(z.string(), z.unknown()).optional().default({}),
  columns: z.array(z.string()).optional().default([]),
  sortBy: z.string().nullable().optional(),
  sortDir: z.enum(['asc', 'desc']).nullable().optional(),
  position: z.number().int().optional(),
  isDefault: z.boolean().optional(),
  isShared: z.boolean().optional(),
});
const savedViewPatchSchema = savedViewInputSchema.partial().omit({ entityType: true });

router.get('/saved-views', async (req, res) => {
  const scope = getScope(req);
  const entityType = typeof req.query.entityType === 'string' ? req.query.entityType : null;
  if (entityType && entityType !== 'account' && entityType !== 'deal') {
    res.status(422).json({ error: 'invalid entityType' });
    return;
  }
  const filters = [
    eq(savedViewsTable.tenantId, scope.tenantId),
    sql`(${savedViewsTable.userId} = ${scope.user.id} OR ${savedViewsTable.isShared} = true)`,
  ];
  if (entityType) filters.push(eq(savedViewsTable.entityType, entityType));
  const rows = await db.select().from(savedViewsTable)
    .where(and(...filters))
    .orderBy(asc(savedViewsTable.position), asc(savedViewsTable.createdAt));
  res.json(rows);
});

router.post('/saved-views', async (req, res) => {
  const scope = getScope(req);
  const parsed = savedViewInputSchema.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const id = `sv_${randomUUID().slice(0, 10)}`;
  await db.insert(savedViewsTable).values({
    id,
    userId: scope.user.id,
    tenantId: scope.tenantId,
    entityType: parsed.data.entityType,
    name: parsed.data.name,
    filters: parsed.data.filters ?? {},
    columns: parsed.data.columns ?? [],
    sortBy: parsed.data.sortBy ?? null,
    sortDir: parsed.data.sortDir ?? null,
    position: parsed.data.position ?? 0,
    isDefault: parsed.data.isDefault ?? false,
    isShared: parsed.data.isShared ?? false,
  });
  const [row] = await db.select().from(savedViewsTable).where(eq(savedViewsTable.id, id));
  res.status(201).json(row);
});

router.patch('/saved-views/:id', async (req, res) => {
  const scope = getScope(req);
  const parsed = savedViewPatchSchema.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const [existing] = await db.select().from(savedViewsTable).where(eq(savedViewsTable.id, req.params.id));
  if (!existing || existing.tenantId !== scope.tenantId || (existing.userId !== scope.user.id && !existing.isShared)) {
    res.status(404).json({ error: 'not found' }); return;
  }
  // Only the owner may rename / delete; shared views can be read by all but mutated only by owner.
  if (existing.userId !== scope.user.id) {
    res.status(403).json({ error: 'forbidden' }); return;
  }
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.filters !== undefined) update.filters = parsed.data.filters;
  if (parsed.data.columns !== undefined) update.columns = parsed.data.columns;
  if (parsed.data.sortBy !== undefined) update.sortBy = parsed.data.sortBy;
  if (parsed.data.sortDir !== undefined) update.sortDir = parsed.data.sortDir;
  if (parsed.data.position !== undefined) update.position = parsed.data.position;
  if (parsed.data.isDefault !== undefined) update.isDefault = parsed.data.isDefault;
  if (parsed.data.isShared !== undefined) update.isShared = parsed.data.isShared;
  await db.update(savedViewsTable).set(update).where(eq(savedViewsTable.id, req.params.id));
  const [row] = await db.select().from(savedViewsTable).where(eq(savedViewsTable.id, req.params.id));
  res.json(row);
});

router.delete('/saved-views/:id', async (req, res) => {
  const scope = getScope(req);
  const [existing] = await db.select().from(savedViewsTable).where(eq(savedViewsTable.id, req.params.id));
  if (!existing || existing.tenantId !== scope.tenantId || existing.userId !== scope.user.id) {
    res.status(404).json({ error: 'not found' }); return;
  }
  await db.delete(savedViewsTable).where(eq(savedViewsTable.id, req.params.id));
  res.status(204).end();
});

// ───────────── BULK ACTIONS ─────────────
const bulkOwnerSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  ownerId: z.union([z.string().min(1), z.null()]),
});
const bulkOwnerStrictSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  ownerId: z.string().min(1),
});
const bulkStageSchema = z.object({ ids: z.array(z.string()).min(1).max(500), stage: z.string().min(1) });
const bulkDeleteSchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
  cascade: z.boolean().optional(),
});

// ─── Account: Best-effort Web-Anreicherung ──────────────────────────────────
// Strategie:
//  1) Startseite laden, dort Impressum-Links (a[href*=impressum|imprint|legal|notice])
//     UND offizielle Impressum-Pfade (/impressum, /imprint, /legal-notice, ...) sammeln.
//  2) Für jede Kandidaten-URL HTML laden (max 3 Seiten, parallel) und scannen:
//      - JSON-LD (Organization / LocalBusiness / PostalAddress) — höchste Priorität
//      - <address>-Tag im HTML
//      - Heuristische Regex-Extraktion (USt-ID toleriert Leerzeichen,
//        Adresse mehrzeilig, Telefon mit "Fon/Tel/T:/Phone"-Markern)
//  3) Felder mergen: erste nicht-leere Quelle gewinnt (JSON-LD > address > Heuristik).
//  4) Land via Nominatim (OSM) reverse-geocoden, sonst TLD-Heuristik.
// Bewusst defensiv: 8s Timeout, 512 KB Body-Limit, harmlose User-Agents,
// niemals 5xx zurückgeben — leere Felder sind ein gültiges Ergebnis.
// SSRF-Schutz: vor JEDEM Fetch (auch Redirect-Hops) wird Hostname statisch
// geprüft UND DNS-aufgelöst gegen privaten/internen IP-Bereich (assertSafeResolvedUrl).
// Redirects werden manuell verfolgt (max 4 Hops), damit die SSRF-Prüfung pro Hop
// greifen kann statt nur am ersten Request.
async function fetchWithLimit(url: string, ms = 8000, maxBytes = 512 * 1024): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    try {
      await assertSafeResolvedUrl(current);
    } catch {
      return null; // SSRF-Schutz schlägt zu — wie bei jedem anderen Fehler still abbrechen.
    }
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), ms);
      const r = await fetch(current, {
        signal: ac.signal,
        redirect: 'manual',
        headers: { 'user-agent': 'DealFlow.One Enrichment/1.0 (+https://dealflow.one)', 'accept': 'text/html,application/xhtml+xml' },
      }).finally(() => clearTimeout(timer));
      // Redirect-Hop folgen, mit erneuter SSRF-Prüfung in der nächsten Iteration.
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location');
        if (!loc) return null;
        try { current = new URL(loc, current).toString(); }
        catch { return null; }
        continue;
      }
      if (!r.ok) return null;
      const ct = r.headers.get('content-type') ?? '';
      if (!/text\/html|xml/i.test(ct)) return null;
      const buf = await r.arrayBuffer();
      if (buf.byteLength > maxBytes) return new TextDecoder().decode(buf.slice(0, maxBytes));
      return new TextDecoder().decode(buf);
    } catch {
      return null;
    }
  }
  return null; // Zu viele Redirects.
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function stripTags(html: string): string {
  return decodeEntities(html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|address)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (!m) return null;
  return decodeEntities(m[1]!).replace(/[|–—\-]\s*(Impressum|Imprint|Home|Startseite|Kontakt|Contact).*$/i, '').trim() || null;
}

// Sammelt absolute URLs zu möglichen Impressum-/Legal-Seiten aus Startseiten-HTML.
function findLegalLinks(html: string, base: URL): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1]!;
    const label = stripTags(m[2]!).toLowerCase();
    const hrefL = href.toLowerCase();
    const isLegal = /impressum|imprint|legal[-_]?notice|legal[-_]?info|disclaimer|mentions[-_]?legales|aviso[-_]?legal/.test(hrefL)
      || /\b(impressum|imprint|legal notice|mentions légales|aviso legal)\b/.test(label);
    if (!isLegal) continue;
    try {
      const abs = new URL(href, base);
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
      if (abs.hostname.toLowerCase() !== base.hostname.toLowerCase()) continue; // gleicher Host
      out.add(abs.toString().split('#')[0]!);
      if (out.size >= 5) break;
    } catch { /* ignore */ }
  }
  return [...out];
}

type EnrichSlot = { name: string | null; country: string | null; billingAddress: string | null;
  phone: string | null; vatId: string | null; legalEntityName: string | null };

// Extrahiert strukturierte Daten aus JSON-LD <script type="application/ld+json">.
function parseJsonLd(html: string): Partial<EnrichSlot> {
  const out: Partial<EnrichSlot> = {};
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const entities: any[] = [];
  while ((m = re.exec(html)) !== null) {
    try {
      const raw = decodeEntities(m[1]!.trim());
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      for (const e of arr) {
        if (e && typeof e === 'object') entities.push(e);
        if (e && typeof e === 'object' && Array.isArray((e as any)['@graph'])) {
          for (const g of (e as any)['@graph']) entities.push(g);
        }
      }
    } catch { /* malformed JSON-LD ist häufig — ignorieren */ }
  }
  const wantedTypes = /^(Organization|Corporation|LocalBusiness|Store|GovernmentOrganization|EducationalOrganization|NGO)$/i;
  const isOrg = (e: any) => {
    const t = e?.['@type'];
    if (!t) return false;
    if (Array.isArray(t)) return t.some(x => typeof x === 'string' && wantedTypes.test(x));
    return typeof t === 'string' && wantedTypes.test(t);
  };
  const formatAddress = (a: any): string | null => {
    if (!a || typeof a !== 'object') return null;
    const street = String(a.streetAddress ?? '').trim();
    const zip = String(a.postalCode ?? '').trim();
    const city = String(a.addressLocality ?? '').trim();
    if (!street && !zip && !city) return null;
    const line2 = [zip, city].filter(Boolean).join(' ').trim();
    return [street, line2].filter(Boolean).join('\n') || null;
  };
  const countryCode = (a: any): string | null => {
    if (!a) return null;
    const c = a.addressCountry;
    if (typeof c === 'string' && c.length === 2) return c.toUpperCase();
    if (c && typeof c === 'object' && typeof c.name === 'string' && c.name.length === 2) return c.name.toUpperCase();
    return null;
  };
  for (const e of entities) {
    if (!isOrg(e)) continue;
    if (!out.legalEntityName && typeof e.legalName === 'string') out.legalEntityName = e.legalName.trim();
    if (!out.name && typeof e.name === 'string') out.name = e.name.trim();
    if (!out.phone && typeof e.telephone === 'string') out.phone = e.telephone.trim();
    if (!out.vatId && typeof e.vatID === 'string') out.vatId = e.vatID.replace(/\s+/g, '').toUpperCase();
    const addr = e.address;
    const addrObj = Array.isArray(addr) ? addr[0] : addr;
    if (!out.billingAddress) {
      const formatted = formatAddress(addrObj);
      if (formatted) out.billingAddress = formatted;
    }
    if (!out.country) {
      const cc = countryCode(addrObj);
      if (cc) out.country = cc;
    }
  }
  return out;
}

// Liest <address>...</address> und konvertiert zu mehrzeiligem Text.
function parseAddressTag(html: string): string | null {
  const m = html.match(/<address\b[^>]*>([\s\S]*?)<\/address>/i);
  if (!m) return null;
  const text = stripTags(m[1]!).trim();
  return text.length > 5 ? text : null;
}

// Heuristische Regex-Extraktion auf Plaintext.
function parseHeuristics(html: string): Partial<EnrichSlot> {
  const out: Partial<EnrichSlot> = {};
  const text = stripTags(html);

  // USt-ID: Leerzeichen/Punkte zwischen Ziffern erlaubt; danach normalisieren.
  // DE: 9 Ziffern; AT: ATU + 8; CH: CHE + 9; generisch: zwei Buchstaben + 8-12 Ziffern.
  const vatPatterns = [
    /\b(DE)[ ]*((?:\d[ .]?){8}\d)\b/i,
    /\b(ATU)[ ]*((?:\d[ .]?){7}\d)\b/i,
    /\b(CHE)[-\s]*((?:\d[ .]?){8}\d)(?:\s?(MWST|TVA|IVA))?\b/i,
    /\b([A-Z]{2})[ ]*((?:\d[ .]?){7,11}\d)\b/,
  ];
  for (const pat of vatPatterns) {
    const v = text.match(pat);
    if (v) {
      const digits = v[2]!.replace(/[ .]/g, '');
      const suffix = v[3] ? ` ${v[3].toUpperCase()}` : '';
      out.vatId = `${v[1]!.toUpperCase()}${digits.startsWith('-') ? '' : ''}${digits}${suffix}`;
      break;
    }
  }

  // Telefon: Marker (Tel/Telefon/Fon/T:/Phone/Tel.) UND nackte +49…-Zahlen mit Plausibilität.
  const phonePatterns = [
    /(?:Tel(?:efon)?\.?|Fon|Phone|T)[:\s]*((?:\+|00)\d[\d\s().\/\-]{6,}\d)/i,
    /\b((?:\+|00)\d{1,3}[\s().\/\-]?\d[\d\s().\/\-]{5,}\d)\b/,
  ];
  for (const pat of phonePatterns) {
    const t = text.match(pat);
    if (t) {
      const cleaned = t[1]!.replace(/[\s().\/\-]+/g, ' ').replace(/\s+/g, ' ').trim();
      // Plausibilität: mindestens 6 Ziffern, max 18.
      const digitCount = cleaned.replace(/\D/g, '').length;
      if (digitCount >= 7 && digitCount <= 18) { out.phone = cleaned; break; }
    }
  }

  // Adresse: anker an PLZ-Block. Wichtig: kein Newline-Sprung in den Captures
  // (sonst frisst der Greedy-Match die Firmenzeile davor mit). Stadt nur 1-2 Wörter.
  // Pattern: "<Anker>Strasse Nr<Sep>(D-)?PLZ Stadt".
  // Sep = Komma oder Newline (keine Ziffern dazwischen).
  const addrRe = /(?:^|\n)\s*([A-ZÄÖÜ][^\n,]{2,60}?\s+\d+[a-zA-Z]?(?:[-–\s]\d+[a-zA-Z]?)?)\s*[,\n]\s*(?:D[-\s]?)?(\d{4,5})\s+([A-ZÄÖÜ][^\n,]{1,40}?)(?:\s*$|\n|,)/m;
  const a = text.match(addrRe);
  if (a) {
    const street = a[1]!.trim().replace(/\s+/g, ' ');
    const zip = a[2]!;
    const city = a[3]!.trim().replace(/\s+/g, ' ');
    out.billingAddress = `${street}\n${zip} ${city}`;
  }

  // Legal Entity: typische Markers "Firma:", "Anbieter:", "Inhaber:" oder Erstvorkommen GmbH/AG.
  const le = text.match(/(?:Firma|Anbieter|Verantwortlich|Inhaber|Betreiber)[:\s]+([A-ZÄÖÜ][\w\säöüß.&,\-]+?(?:GmbH(?:\s*&\s*Co\.?\s*KG)?|AG|UG\s*\(haftungsbeschränkt\)|UG|KG|OHG|e\.K\.|GbR|Ltd|LLC|Inc))/);
  if (le) out.legalEntityName = le[1]!.trim();

  return out;
}

function mergeSlot(target: EnrichSlot, src: Partial<EnrichSlot>): void {
  for (const k of Object.keys(src) as (keyof EnrichSlot)[]) {
    if (!target[k] && src[k]) target[k] = src[k]!;
  }
}

router.post('/accounts/enrich-from-website', async (req, res) => {
  const raw = (req.body as { website?: unknown })?.website;
  if (typeof raw !== 'string' || !raw.trim()) {
    res.status(422).json({ error: 'website required' }); return;
  }
  let url: URL;
  try {
    const trimmed = raw.trim();
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withProto);
    if (!/^https?:$/i.test(url.protocol)) throw new Error('bad proto');
  } catch {
    res.status(422).json({ error: 'invalid website url' }); return;
  }
  // Block internal/loopback Hosts (SSRF-Schutz).
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.local') ||
      /^(127|10|192\.168|169\.254|172\.(1[6-9]|2\d|3[01]))\./.test(host)) {
    res.status(422).json({ error: 'host not allowed' }); return;
  }

  // 1) Startseite laden, dort echte Impressum-Links extrahieren.
  const homeUrl = url.origin + (url.pathname === '/' ? '' : url.pathname);
  const homeHtml = await fetchWithLimit(homeUrl);
  const linkCandidates = homeHtml ? findLegalLinks(homeHtml, url) : [];

  // 2) Konventionelle Pfade als Backup (falls keine Links gefunden wurden).
  const conventionalPaths = ['/impressum', '/imprint', '/legal-notice', '/legal', '/about/impressum', '/de/impressum', '/en/imprint'];
  const fallbackUrls = conventionalPaths.map(p => `${url.origin}${p}`);

  // Reihenfolge: gefundene Links zuerst, dann Konventionen, dedupliziert. Max 4 Pages.
  const pageList = [...new Set([...linkCandidates, ...fallbackUrls])].slice(0, 4);

  // 3) Parallel laden (mit Concurrency-Limit von 4 ohne separate Lib).
  const pages: Array<{ url: string; html: string }> = [];
  if (homeHtml) pages.push({ url: homeUrl, html: homeHtml });
  const fetched = await Promise.all(pageList.map(async u => {
    const h = await fetchWithLimit(u);
    return h && h.length > 200 ? { url: u, html: h } : null;
  }));
  for (const f of fetched) if (f) pages.push(f);

  const slot: EnrichSlot = { name: null, country: null, billingAddress: null, phone: null, vatId: null, legalEntityName: null };
  let sourceUrl: string | null = null;

  // 4) Impressum-Pages bevorzugen (haben häufig die strukturierten Daten).
  const orderedPages = pages.slice().sort((a, b) => {
    const score = (s: string) => /impressum|imprint|legal/i.test(s) ? 0 : 1;
    return score(a.url) - score(b.url);
  });

  for (const page of orderedPages) {
    const before = JSON.stringify(slot);
    mergeSlot(slot, parseJsonLd(page.html));
    const addrTag = parseAddressTag(page.html);
    if (addrTag && !slot.billingAddress) slot.billingAddress = addrTag;
    mergeSlot(slot, parseHeuristics(page.html));
    if (!slot.name) slot.name = extractTitle(page.html);
    if (JSON.stringify(slot) !== before && !sourceUrl) sourceUrl = page.url;
    // Wenn alle wichtigen Felder gefüllt sind, abbrechen.
    if (slot.billingAddress && slot.phone && slot.vatId && slot.legalEntityName) break;
  }

  const out = {
    name: slot.name,
    country: slot.country,
    billingAddress: slot.billingAddress,
    phone: slot.phone,
    vatId: slot.vatId,
    legalEntityName: slot.legalEntityName,
    sourceUrl,
  };

  // 5) Land via Nominatim — basierend auf gefundener Adresse, sonst Domain-TLD-Heuristik.
  if (!out.country && out.billingAddress) {
    const q = encodeURIComponent(out.billingAddress.replace(/\n/g, ', '));
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 6000);
      const nm = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&q=${q}`, {
        signal: ac.signal,
        headers: { 'user-agent': 'DealFlow.One Enrichment/1.0 (+contact@dealflow.one)' },
      }).finally(() => clearTimeout(timer));
      if (nm.ok) {
        const j = await nm.json() as Array<{ address?: { country_code?: string } }>;
        const cc = j[0]?.address?.country_code;
        if (cc && cc.length === 2) out.country = cc.toUpperCase();
      }
    } catch { /* ignore */ }
  }
  if (!out.country) {
    // TLD-Heuristik als Fallback.
    const tld = host.split('.').pop();
    const tldMap: Record<string, string> = { de: 'DE', at: 'AT', ch: 'CH', fr: 'FR', it: 'IT', es: 'ES', uk: 'GB', us: 'US' };
    if (tld && tldMap[tld]) out.country = tldMap[tld];
  }

  res.json(out);
});

router.post('/accounts/bulk/owner', async (req, res) => {
  const parsed = bulkOwnerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const ownerCheck = await resolveOwnerId(req, res, parsed.data.ownerId);
  if (!ownerCheck.ok) return;
  const allowed = await allowedAccountIds(req);
  const targetIds = parsed.data.ids.filter(id => allowed.has(id));
  const skipped = parsed.data.ids.filter(id => !allowed.has(id));
  if (targetIds.length === 0) { res.json({ updated: 0, skipped: skipped.length, skippedIds: skipped }); return; }
  await db.update(accountsTable)
    .set({ ownerId: ownerCheck.value })
    .where(inArray(accountsTable.id, targetIds));
  const summary = ownerCheck.value === null ? 'Owner entfernt' : `Owner gesetzt auf ${ownerCheck.value}`;
  for (const id of targetIds) {
    await writeAuditFromReq(req, { entityType: 'account', entityId: id, action: 'bulk_owner', summary });
  }
  res.json({ updated: targetIds.length, skipped: skipped.length, skippedIds: skipped });
});

// Hilfsfunktion: Zählt verknüpfte Datensätze pro Account in den relevanten Tabellen.
// Wird sowohl beim Block (warum übersprungen?) als auch im Cascade-Pfad verwendet.
type AccountRefCounts = {
  deals: number; contacts: number; contracts: number; letters: number;
  renewals: number; obligations: number; externalContracts: number;
};
async function accountReferenceCounts(accountIds: string[]): Promise<Record<string, AccountRefCounts>> {
  const out: Record<string, AccountRefCounts> = {};
  for (const id of accountIds) {
    out[id] = { deals: 0, contacts: 0, contracts: 0, letters: 0, renewals: 0, obligations: 0, externalContracts: 0 };
  }
  if (accountIds.length === 0) return out;
  const [dealRows, contactRows, contractRows, letterRows, renewalRows, obligationRows, externalRows] = await Promise.all([
    db.select({ accountId: dealsTable.accountId }).from(dealsTable).where(inArray(dealsTable.accountId, accountIds)),
    db.select({ accountId: contactsTable.accountId }).from(contactsTable).where(inArray(contactsTable.accountId, accountIds)),
    db.select({ accountId: contractsTable.accountId }).from(contractsTable).where(inArray(contractsTable.accountId, accountIds)),
    db.select({ accountId: priceIncreaseLettersTable.accountId }).from(priceIncreaseLettersTable).where(inArray(priceIncreaseLettersTable.accountId, accountIds)),
    db.select({ accountId: renewalOpportunitiesTable.accountId }).from(renewalOpportunitiesTable).where(inArray(renewalOpportunitiesTable.accountId, accountIds)),
    db.select({ accountId: obligationsTable.accountId }).from(obligationsTable).where(inArray(obligationsTable.accountId, accountIds)),
    db.select({ accountId: externalContractsTable.accountId }).from(externalContractsTable).where(inArray(externalContractsTable.accountId, accountIds)),
  ]);
  for (const r of dealRows) if (r.accountId && out[r.accountId]) out[r.accountId].deals++;
  for (const r of contactRows) if (r.accountId && out[r.accountId]) out[r.accountId].contacts++;
  for (const r of contractRows) if (r.accountId && out[r.accountId]) out[r.accountId].contracts++;
  for (const r of letterRows) if (r.accountId && out[r.accountId]) out[r.accountId].letters++;
  for (const r of renewalRows) if (r.accountId && out[r.accountId]) out[r.accountId].renewals++;
  for (const r of obligationRows) if (r.accountId && out[r.accountId]) out[r.accountId].obligations++;
  for (const r of externalRows) if (r.accountId && out[r.accountId]) out[r.accountId].externalContracts++;
  return out as Record<string, { deals: number; contacts: number; contracts: number; letters: number; renewals: number; obligations: number; externalContracts: number }>;
}

// Cascade-Löschung: entfernt einen Account inkl. aller direkt + transitiv abhängigen
// Datensätze. Reihenfolge ist wichtig — wir haben keine FK-Cascades im Schema, also
// müssen Kinder vor ihren Eltern weg. Die Funktion erwartet, dass `accountIds` bereits
// per `allowedAccountIds(req)` tenant-gefiltert wurde, scoped zusätzlich aber jede
// destruktive Query defensiv mit `tenantId = scope.tenantId` (defense-in-depth).
async function cascadeDeleteAccounts(req: Request, accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;
  const scope = getScope(req);
  const tenantId = scope.tenantId;
  // Wenn aus irgendeinem Grund kein Tenant-Scope gesetzt ist, brechen wir ab —
  // ein Cascade ohne Tenant-Bound ist zu gefährlich.
  if (!tenantId) throw new Error('cascadeDeleteAccounts: missing tenant scope');

  // 1) Deals + alle Deal-Kinder + Enkel einsammeln. Hinweis zur Tenant-Sicherheit:
  // accountIds wurden bereits per allowedAccountIds(req) tenant-gefiltert. Tabellen
  // ohne eigene tenantId-Spalte (deals, quotes, negotiations, signature_packages,
  // order_confirmations, approvals, price_increase_letters) erben den Scope
  // transitiv über accountId bzw. dealId. Wo eine tenantId-Spalte existiert,
  // ANDen wir sie zusätzlich als Defense-in-Depth.
  const dealRows = await db.select({ id: dealsTable.id }).from(dealsTable)
    .where(inArray(dealsTable.accountId, accountIds));
  const dealIds = dealRows.map(d => d.id);

  if (dealIds.length > 0) {
    // 1a) Quote-Hierarchie: line_items + quote_attachments → quote_versions → quotes.
    const quoteRows = await db.select({ id: quotesTable.id }).from(quotesTable)
      .where(inArray(quotesTable.dealId, dealIds));
    const quoteIds = quoteRows.map(q => q.id);
    if (quoteIds.length > 0) {
      const versionRows = await db.select({ id: quoteVersionsTable.id }).from(quoteVersionsTable)
        .where(inArray(quoteVersionsTable.quoteId, quoteIds));
      const versionIds = versionRows.map(v => v.id);
      if (versionIds.length > 0) {
        await Promise.all([
          db.delete(lineItemsTable).where(inArray(lineItemsTable.quoteVersionId, versionIds)),
          db.delete(quoteAttachmentsTable).where(inArray(quoteAttachmentsTable.quoteVersionId, versionIds)),
        ]);
        await db.delete(quoteVersionsTable).where(inArray(quoteVersionsTable.id, versionIds));
      }
      await db.delete(quotesTable).where(inArray(quotesTable.id, quoteIds));
    }

    // 1b) Negotiations + customer_reactions.
    const negRows = await db.select({ id: negotiationsTable.id }).from(negotiationsTable)
      .where(inArray(negotiationsTable.dealId, dealIds));
    const negIds = negRows.map(n => n.id);
    if (negIds.length > 0) {
      await db.delete(customerReactionsTable).where(inArray(customerReactionsTable.negotiationId, negIds));
      await db.delete(negotiationsTable).where(inArray(negotiationsTable.id, negIds));
    }

    // 1c) Signature-Packages + signers.
    const sigRows = await db.select({ id: signaturePackagesTable.id }).from(signaturePackagesTable)
      .where(inArray(signaturePackagesTable.dealId, dealIds));
    const sigIds = sigRows.map(s => s.id);
    if (sigIds.length > 0) {
      await db.delete(signersTable).where(inArray(signersTable.packageId, sigIds));
      await db.delete(signaturePackagesTable).where(inArray(signaturePackagesTable.id, sigIds));
    }

    // 1d) Order-Confirmations + Checks.
    const ocRows = await db.select({ id: orderConfirmationsTable.id }).from(orderConfirmationsTable)
      .where(inArray(orderConfirmationsTable.dealId, dealIds));
    const ocIds = ocRows.map(o => o.id);
    if (ocIds.length > 0) {
      await db.delete(orderConfirmationChecksTable).where(inArray(orderConfirmationChecksTable.orderConfirmationId, ocIds));
      await db.delete(orderConfirmationsTable).where(inArray(orderConfirmationsTable.id, ocIds));
    }

    // 1e) Übrige direkte Deal-Kinder ohne eigene Kinder. timeline_events und
    // copilot_insights tragen tenantId — defensiv mit-AND-en.
    await Promise.all([
      db.delete(approvalsTable).where(inArray(approvalsTable.dealId, dealIds)),
      db.delete(timelineEventsTable).where(and(inArray(timelineEventsTable.dealId, dealIds), eq(timelineEventsTable.tenantId, tenantId))),
      db.delete(copilotInsightsTable).where(and(inArray(copilotInsightsTable.dealId, dealIds), eq(copilotInsightsTable.tenantId, tenantId))),
    ]);

    // 1f) Deals selbst. Hinweis: Verträge (contracts.dealId notNull) bleiben mit
    // dangling dealId stehen — das ist gewollt für Audit-/Rechtsspur. Die UI
    // filtert sie heraus, das Datum bleibt aber recoverbar.
    await db.delete(dealsTable).where(inArray(dealsTable.id, dealIds));
  }

  // 2) Externe Verträge: Object-Storage-Files best-effort wegräumen, dann DB-Rows.
  // Hat tenantId — defensiv mitfiltern.
  const extRows = await db.select({ id: externalContractsTable.id, objectPath: externalContractsTable.objectPath })
    .from(externalContractsTable)
    .where(and(inArray(externalContractsTable.accountId, accountIds), eq(externalContractsTable.tenantId, tenantId)));
  if (extRows.length > 0) {
    const svc = new ObjectStorageService();
    for (const r of extRows) {
      try {
        const file = await svc.getObjectEntityFile(r.objectPath);
        await file.delete({ ignoreNotFound: true });
      } catch (err) {
        req.log.warn({ err, objectPath: r.objectPath }, 'cascade: external-contract object delete failed');
      }
    }
    await db.delete(externalContractsTable)
      .where(and(inArray(externalContractsTable.accountId, accountIds), eq(externalContractsTable.tenantId, tenantId)));
  }

  // 3) Übrige Tabellen mit notNull(accountId) hart löschen. contacts und
  // priceIncreaseLetters haben keine eigene tenantId-Spalte — Scope kommt
  // transitiv über accountIds. renewal_opportunities trägt tenantId.
  await Promise.all([
    db.delete(contactsTable).where(inArray(contactsTable.accountId, accountIds)),
    db.delete(priceIncreaseLettersTable).where(inArray(priceIncreaseLettersTable.accountId, accountIds)),
    db.delete(renewalOpportunitiesTable).where(and(inArray(renewalOpportunitiesTable.accountId, accountIds), eq(renewalOpportunitiesTable.tenantId, tenantId))),
  ]);

  // 4) Verträge / Obligations: Account-Bezug leeren (Datensätze überleben für Audit).
  await Promise.all([
    db.update(contractsTable).set({ accountId: null })
      .where(and(inArray(contractsTable.accountId, accountIds), eq(contractsTable.tenantId, tenantId))),
    db.update(obligationsTable).set({ accountId: null })
      .where(and(inArray(obligationsTable.accountId, accountIds), eq(obligationsTable.tenantId, tenantId))),
  ]);

  for (const id of accountIds) {
    await writeAuditFromReq(req, { entityType: 'account', entityId: id, action: 'cascade_delete', summary: 'Kunde inkl. abhängiger Daten gelöscht' });
  }
}

router.post('/accounts/bulk/delete', async (req, res) => {
  // Soft-Delete als Default: "Löschen" archiviert nur (setzt archivedAt=now).
  // Datensätze, Verknüpfungen, Audit-Trail und Verträge bleiben unangetastet —
  // der Account verschwindet aus den Standardlisten und kann jederzeit über
  // /accounts/bulk/restore wiederhergestellt werden.
  // Mit cascade:true wird hart gelöscht (alle Verknüpfungen weg) — das ist
  // die explizite Eskalation und sollte im Frontend deutlich markiert sein.
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const cascade = parsed.data.cascade === true;
  const allowed = await allowedAccountIds(req);
  const targetIds = parsed.data.ids.filter(id => allowed.has(id));
  const skipped = parsed.data.ids.filter(id => !allowed.has(id));
  const skippedReasons: Record<string, string> = {};
  for (const id of skipped) skippedReasons[id] = 'no_permission';

  if (cascade) {
    // Cascade: alle Verknüpfungen werden mit-gelöscht oder genullt.
    if (targetIds.length > 0) {
      await cascadeDeleteAccounts(req, targetIds);
      await db.delete(accountsTable).where(inArray(accountsTable.id, targetIds));
      for (const id of targetIds) {
        await writeAuditFromReq(req, { entityType: 'account', entityId: id, action: 'bulk_purge', summary: 'Kunde endgültig gelöscht (mit allen Daten)' });
      }
    }
    res.json({
      updated: targetIds.length,
      archived: 0,
      mode: 'purged',
      skipped: skipped.length,
      skippedIds: skipped,
      skippedReasons,
      references: {},
    });
    return;
  }

  // Default: archivieren. Funktioniert auch mit verknüpften Daten — das ist
  // ja gerade der Sinn. Bereits archivierte Accounts werden idempotent erneut
  // gestempelt (der Zeitpunkt aktualisiert sich), das ist harmlos.
  if (targetIds.length > 0) {
    await db.update(accountsTable)
      .set({ archivedAt: new Date() })
      .where(inArray(accountsTable.id, targetIds));
    for (const id of targetIds) {
      await writeAuditFromReq(req, { entityType: 'account', entityId: id, action: 'bulk_archive', summary: 'Kunde archiviert' });
    }
  }
  res.json({
    updated: targetIds.length,
    archived: targetIds.length,
    mode: 'archived',
    skipped: skipped.length,
    skippedIds: skipped,
    skippedReasons,
    references: {},
  });
});

router.post('/accounts/bulk/restore', async (req, res) => {
  // Wiederherstellen: setzt archivedAt = NULL für die übergebenen IDs.
  // Permission-gated wie bulk/delete — ein User kann nur wiederherstellen,
  // was in seinem Scope liegt.
  const parsed = z.object({ ids: z.array(z.string()).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const allowed = await allowedAccountIds(req);
  const targetIds = parsed.data.ids.filter(id => allowed.has(id));
  const skipped = parsed.data.ids.filter(id => !allowed.has(id));
  if (targetIds.length > 0) {
    await db.update(accountsTable)
      .set({ archivedAt: null })
      .where(inArray(accountsTable.id, targetIds));
    for (const id of targetIds) {
      await writeAuditFromReq(req, { entityType: 'account', entityId: id, action: 'bulk_restore', summary: 'Kunde wiederhergestellt' });
    }
  }
  res.json({
    updated: targetIds.length,
    skipped: skipped.length,
    skippedIds: skipped,
  });
});

router.post('/deals/bulk/owner', async (req, res) => {
  // Deals require a non-null owner (DB column is NOT NULL).
  const parsed = bulkOwnerStrictSchema.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const ownerCheck = await resolveOwnerId(req, res, parsed.data.ownerId);
  if (!ownerCheck.ok) return;
  if (ownerCheck.value === null) { res.status(422).json({ error: 'ownerId required for deals' }); return; }
  const allowed = await allowedDealIds(req);
  const targetIds = parsed.data.ids.filter(id => allowed.has(id));
  const skipped = parsed.data.ids.filter(id => !allowed.has(id));
  if (targetIds.length === 0) { res.json({ updated: 0, skipped: skipped.length, skippedIds: skipped }); return; }
  await db.update(dealsTable)
    .set({ ownerId: ownerCheck.value, updatedAt: new Date() })
    .where(inArray(dealsTable.id, targetIds));
  for (const id of targetIds) {
    await writeAuditFromReq(req, { entityType: 'deal', entityId: id, action: 'bulk_owner', summary: `Owner gesetzt auf ${ownerCheck.value}` });
  }
  res.json({ updated: targetIds.length, skipped: skipped.length, skippedIds: skipped });
});

router.post('/deals/bulk/stage', async (req, res) => {
  const parsed = bulkStageSchema.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const allowed = await allowedDealIds(req);
  const targetIds = parsed.data.ids.filter(id => allowed.has(id));
  const skipped = parsed.data.ids.filter(id => !allowed.has(id));
  if (targetIds.length === 0) { res.json({ updated: 0, skipped: skipped.length, skippedIds: skipped }); return; }
  await db.update(dealsTable)
    .set({ stage: parsed.data.stage, updatedAt: new Date() })
    .where(inArray(dealsTable.id, targetIds));
  for (const id of targetIds) {
    await writeAuditFromReq(req, { entityType: 'deal', entityId: id, action: 'bulk_stage', summary: `Stage geändert auf ${parsed.data.stage}` });
  }
  res.json({ updated: targetIds.length, skipped: skipped.length, skippedIds: skipped });
});

// ── PLATFORM ADMIN — Tenant Provisioning ──
// Plattformweite Routen für Super-Admins. Diese Routen sind die EINZIGEN,
// die tenant-übergreifend wirken. Jede andere Route bleibt strikt
// tenant-isoliert.
async function requirePlatformAdmin(req: Request, res: Response): Promise<boolean> {
  const scope = getScope(req);
  if (!scope.user.isPlatformAdmin) {
    res.status(403).json({ error: 'platform admin required' });
    return false;
  }
  return true;
}

const PlatformTenantCreateBody = z.object({
  name: z.string().trim().min(2).max(120),
  plan: z.enum(['Starter', 'Growth', 'Business', 'Enterprise']),
  region: z.enum(['EU', 'US', 'UK', 'APAC']),
  retentionPolicy: z.object({
    contactInactiveDays: z.number().int().positive().optional(),
    letterRespondedDays: z.number().int().positive().optional(),
    auditLogDays: z.number().int().positive().optional(),
    accessLogDays: z.number().int().positive().optional(),
  }).optional(),
  admin: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(8).max(200),
  }),
});

router.get('/platform/tenants', async (req, res) => {
  if (!(await requirePlatformAdmin(req, res))) return;
  const tenants = await db.select().from(tenantsTable).orderBy(asc(tenantsTable.name));
  if (tenants.length === 0) { res.json([]); return; }
  const tenantIds = tenants.map(t => t.id);
  // User-Counts per Tenant
  const userRows = await db.select({ tenantId: usersTable.tenantId, c: sql<number>`count(*)::int` })
    .from(usersTable)
    .where(inArray(usersTable.tenantId, tenantIds))
    .groupBy(usersTable.tenantId);
  const userMap = new Map(userRows.map(r => [r.tenantId, r.c]));
  // Account-Counts per Tenant via companies → accounts is N/A; accounts have no tenantId.
  // Stattdessen: companies-Count als Größenindikator.
  const compRows = await db.select({ tenantId: companiesTable.tenantId, c: sql<number>`count(*)::int` })
    .from(companiesTable)
    .where(inArray(companiesTable.tenantId, tenantIds))
    .groupBy(companiesTable.tenantId);
  const compMap = new Map(compRows.map(r => [r.tenantId, r.c]));
  res.json(tenants.map(t => ({
    id: t.id,
    name: t.name,
    plan: t.plan,
    region: t.region,
    retentionPolicy: t.retentionPolicy,
    userCount: userMap.get(t.id) ?? 0,
    companyCount: compMap.get(t.id) ?? 0,
    createdAt: iso(t.createdAt)!,
  })));
});

router.post('/platform/tenants', async (req, res) => {
  if (!(await requirePlatformAdmin(req, res))) return;
  const parsed = PlatformTenantCreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const b = parsed.data;
  // Email-Eindeutigkeit gilt PLATTFORMWEIT (Login-Identifikator).
  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, b.admin.email));
  if (existing) { res.status(409).json({ error: 'email already registered' }); return; }
  const tenantId = `tn_${randomUUID().slice(0, 8)}`;
  const adminUserId = `u_${randomUUID().slice(0, 8)}`;
  const { hashPassword } = await import('../lib/auth');
  // Atomar: Tenant + Admin-User + System-Rollen entweder vollständig oder gar nicht.
  try {
    await db.transaction(async (tx) => {
      await tx.insert(tenantsTable).values({
        id: tenantId,
        name: b.name.trim(),
        plan: b.plan,
        region: b.region,
        retentionPolicy: b.retentionPolicy ?? {},
      });
      await tx.insert(usersTable).values({
        id: adminUserId,
        name: b.admin.name.trim(),
        email: b.admin.email,
        role: 'Tenant Admin',
        scope: tenantId,
        initials: initials(b.admin.name),
        avatarColor: null,
        passwordHash: hashPassword(b.admin.password),
        isActive: true,
        tenantId,
        tenantWide: true,
        scopeCompanyIds: '[]',
        scopeBrandIds: '[]',
        isPlatformAdmin: false,
      });
      await tx.insert(rolesTable).values([
        { id: `ro_tenant_admin_${tenantId.slice(3)}`, name: 'Tenant Admin', description: 'Volle Rechte innerhalb des Mandanten.', isSystem: true, tenantId },
        { id: `ro_account_exec_${tenantId.slice(3)}`, name: 'Account Executive', description: 'Klassische Sales-Rolle für Deal-Ownership.', isSystem: true, tenantId },
        { id: `ro_deal_desk_${tenantId.slice(3)}`,    name: 'Deal Desk',         description: 'Pricing- und Deal-Support, tenant-weite Sicht.', isSystem: true, tenantId },
      ]);
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    // Race auf email-Unique zwischen Precheck und Insert → 409 statt 500.
    if (/duplicate key|unique/i.test(msg)) {
      res.status(409).json({ error: 'email already registered' });
      return;
    }
    throw e;
  }
  await writeAuditFromReq(req, {
    entityType: 'tenant', entityId: tenantId, action: 'platform_create',
    summary: `Mandant angelegt: ${b.name} (${b.plan}, ${b.region})`,
    after: { name: b.name, plan: b.plan, region: b.region, adminEmail: b.admin.email },
    actor: getScope(req).user.name,
  });
  res.status(201).json({
    id: tenantId,
    name: b.name.trim(),
    plan: b.plan,
    region: b.region,
    retentionPolicy: b.retentionPolicy ?? {},
    userCount: 1,
    companyCount: 0,
    createdAt: new Date().toISOString(),
    adminUserId,
  });
});

// ── QUOTE DUPLIZIEREN ──
// Kopiert Header + alle line_items + sectionsSnapshot der aktuellen Version
// in ein neues Quote (status=draft, version=1). Behält dealId.
router.post('/quotes/:id/duplicate', async (req, res) => {
  const sourceId = req.params.id;
  const [src] = await db.select().from(quotesTable).where(eq(quotesTable.id, sourceId));
  if (!src) { res.status(404).json({ error: 'quote not found' }); return; }
  if (!(await gateDeal(req, res, src.dealId))) return;
  // Aktuelle Version holen (höchste version)
  const versions = await db.select().from(quoteVersionsTable)
    .where(eq(quoteVersionsTable.quoteId, src.id))
    .orderBy(desc(quoteVersionsTable.version))
    .limit(1);
  const srcVer = versions[0];
  const newQuoteId = `qt_${randomUUID().slice(0, 8)}`;
  const newQvId = `qv_${randomUUID().slice(0, 8)}`;
  const newNumber = `${src.number}-COPY-${Math.floor(Math.random() * 9000) + 1000}`;
  // Atomar: Header + Version + alle Lines + Attachments. Bei Teil-Fehler Rollback.
  await db.transaction(async (tx) => {
    await tx.insert(quotesTable).values({
      id: newQuoteId,
      dealId: src.dealId,
      number: newNumber,
      status: 'draft',
      currentVersion: 1,
      currency: src.currency,
      validUntil: src.validUntil,
    });
    await tx.insert(quoteVersionsTable).values({
      id: newQvId,
      quoteId: newQuoteId,
      version: 1,
      totalAmount: srcVer?.totalAmount ?? '0',
      discountPct: srcVer?.discountPct ?? '0',
      marginPct: srcVer?.marginPct ?? '30',
      status: 'draft',
      notes: srcVer?.notes ? `Dupliziert aus ${src.number}: ${srcVer.notes}` : `Dupliziert aus ${src.number}`,
      templateId: srcVer?.templateId ?? null,
      sectionsSnapshot: srcVer?.sectionsSnapshot ?? [],
    });
    if (srcVer) {
      const srcLines = await tx.select().from(lineItemsTable)
        .where(eq(lineItemsTable.quoteVersionId, srcVer.id));
      if (srcLines.length) {
        await tx.insert(lineItemsTable).values(srcLines.map(l => ({
          id: `li_${randomUUID().slice(0, 8)}`,
          quoteVersionId: newQvId,
          name: l.name,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          listPrice: l.listPrice,
          discountPct: l.discountPct,
          total: l.total,
        })));
      }
      // Auch Anhänge mitkopieren (Library-Asset-Verweise bleiben erhalten)
      const srcAtts = await tx.select().from(quoteAttachmentsTable)
        .where(eq(quoteAttachmentsTable.quoteVersionId, srcVer.id));
      if (srcAtts.length) {
        await tx.insert(quoteAttachmentsTable).values(srcAtts.map(a => ({
          id: `qatt_${randomUUID().slice(0, 8)}`,
          quoteVersionId: newQvId,
          libraryAssetId: a.libraryAssetId,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          objectPath: a.objectPath,
          label: a.label,
          order: a.order,
        })));
      }
    }
  });
  await writeAuditFromReq(req, {
    entityType: 'quote', entityId: newQuoteId, action: 'duplicate',
    summary: `Angebot dupliziert aus ${src.number}`,
    actor: getScope(req).user.name,
  });
  res.status(201).json({ id: newQuoteId, number: newNumber, dealId: src.dealId });
});

// ── PREIS-BUNDLES ──
// Vorgefertigte Pakete von Preispositionen. Tenant-isoliert; optional
// brand/company-scoped (NULL = tenant-weit für alle). Werden im QuoteWizard
// per Klick als Gruppe in das Angebot übernommen.
type PriceBundleRow = typeof pricePositionBundlesTable.$inferSelect;
type PriceBundleItemRow = typeof pricePositionBundleItemsTable.$inferSelect;
type PricePositionRow = typeof pricePositionsTable.$inferSelect;

const PriceBundleItemInputSchema = z.object({
  pricePositionId: z.string().min(1),
  quantity: z.number().positive().max(99999),
  customDiscountPct: z.number().min(0).max(100).default(0),
  position: z.number().int().min(0).default(0),
});

const PriceBundleCreateBody = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(2000).optional().default(''),
  category: z.string().max(60).nullable().optional(),
  brandId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  items: z.array(PriceBundleItemInputSchema).default([]),
});

const PriceBundleUpdateBody = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  category: z.string().max(60).nullable().optional(),
  brandId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
});

const PriceBundleItemsReplaceBody = z.object({
  items: z.array(PriceBundleItemInputSchema),
});

function mapPriceBundle(b: PriceBundleRow, items: PriceBundleItemRow[], positions: PricePositionRow[]) {
  const posMap = new Map(positions.map(p => [p.id, p]));
  const sortedItems = items
    .filter(i => i.bundleId === b.id)
    .sort((a, c) => a.position - c.position);
  const hydrated = sortedItems.map(i => {
    const p = posMap.get(i.pricePositionId);
    return {
      id: i.id,
      pricePositionId: i.pricePositionId,
      quantity: num(i.quantity),
      customDiscountPct: num(i.customDiscountPct),
      position: i.position,
      sku: p?.sku ?? null,
      name: p?.name ?? null,
      listPrice: p ? num(p.listPrice) : null,
      currency: p?.currency ?? null,
      category: p?.category ?? null,
    };
  });
  const totalListPrice = hydrated.reduce((s, h) => s + (h.listPrice ?? 0) * h.quantity, 0);
  return {
    id: b.id,
    tenantId: b.tenantId,
    name: b.name,
    description: b.description,
    category: b.category,
    brandId: b.brandId,
    companyId: b.companyId,
    items: hydrated,
    itemCount: hydrated.length,
    totalListPrice,
    currency: hydrated.find(h => h.currency)?.currency ?? null,
    createdAt: iso(b.createdAt)!,
  };
}

async function loadVisibleBundle(req: Request, id: string): Promise<PriceBundleRow | null> {
  const [b] = await db.select().from(pricePositionBundlesTable).where(eq(pricePositionBundlesTable.id, id));
  if (!b) return null;
  if (!(await scopedRowVisibleAsync(req, b))) return null;
  return b;
}

// price_positions hat keine eigene tenantId-Spalte — sie wird über die zugehörige
// company (companies.tenantId) abgeleitet. Diese Helper-Funktion liefert für eine
// Liste Positionen die effektive tenantId pro Eintrag (oder null falls company fehlt).
async function positionTenantMap(positions: PricePositionRow[]): Promise<Map<string, string | null>> {
  const companyIds = [...new Set(positions.map(p => p.companyId).filter(Boolean) as string[])];
  if (companyIds.length === 0) return new Map(positions.map(p => [p.id, null]));
  const companies = await db.select({ id: companiesTable.id, tenantId: companiesTable.tenantId })
    .from(companiesTable).where(inArray(companiesTable.id, companyIds));
  const cMap = new Map(companies.map(c => [c.id, c.tenantId]));
  return new Map(positions.map(p => [p.id, p.companyId ? (cMap.get(p.companyId) ?? null) : null]));
}

async function validateBundleItems(req: Request, items: z.infer<typeof PriceBundleItemInputSchema>[]): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (items.length === 0) return { ok: true };
  const scope = getScope(req);
  const ids = [...new Set(items.map(i => i.pricePositionId))];
  const positions = await db.select().from(pricePositionsTable).where(inArray(pricePositionsTable.id, ids));
  if (positions.length !== ids.length) return { ok: false, status: 422, error: 'unknown price_position id' };
  // Tenant-Zugehörigkeit pro Position über company auflösen — verhindert
  // Cross-Tenant-Referenz, falls eine fremde price_position-id erraten wird.
  const tMap = await positionTenantMap(positions);
  for (const p of positions) {
    if (tMap.get(p.id) !== scope.tenantId) {
      return { ok: false, status: 422, error: 'unknown price_position id' };
    }
    // Brand/Company-Scope: Position muss im aktiven Brand/Company-Scope des Users liegen.
    const synthetic = { tenantId: scope.tenantId, brandId: p.brandId, companyId: p.companyId };
    if (!(await scopedRowVisibleAsync(req, synthetic))) {
      return { ok: false, status: 403, error: `price_position ${p.id} outside scope` };
    }
  }
  return { ok: true };
}

// Liefert NUR die Positionen, die der User tatsächlich sehen darf — verhindert
// dass Bundles als Hintertür auf Positionen außerhalb des Brand/Company-Scopes
// (oder gar Tenants) dienen.
async function loadVisiblePositions(req: Request, posIds: string[]): Promise<PricePositionRow[]> {
  if (posIds.length === 0) return [];
  const scope = getScope(req);
  const positions = await db.select().from(pricePositionsTable)
    .where(inArray(pricePositionsTable.id, posIds));
  const tMap = await positionTenantMap(positions);
  const sameTenant = positions.filter(p => tMap.get(p.id) === scope.tenantId);
  const flags = await Promise.all(sameTenant.map(p => {
    const synthetic = { tenantId: scope.tenantId, brandId: p.brandId, companyId: p.companyId };
    return scopedRowVisibleAsync(req, synthetic);
  }));
  return sameTenant.filter((_, i) => flags[i]);
}

router.get('/price-bundles', async (req, res) => {
  const scope = getScope(req);
  const bundles = await db.select().from(pricePositionBundlesTable)
    .where(eq(pricePositionBundlesTable.tenantId, scope.tenantId))
    .orderBy(asc(pricePositionBundlesTable.name));
  const visFlags = await Promise.all(bundles.map(b => scopedRowVisibleAsync(req, b)));
  const visible = bundles.filter((_, i) => visFlags[i]);
  if (visible.length === 0) { res.json([]); return; }
  const ids = visible.map(b => b.id);
  const items = await db.select().from(pricePositionBundleItemsTable)
    .where(inArray(pricePositionBundleItemsTable.bundleId, ids));
  const posIds = [...new Set(items.map(i => i.pricePositionId))];
  const positions = await loadVisiblePositions(req, posIds);
  res.json(visible.map(b => mapPriceBundle(b, items, positions)));
});

router.get('/price-bundles/:id', async (req, res) => {
  const b = await loadVisibleBundle(req, req.params.id);
  if (!b) { res.status(404).json({ error: 'not found' }); return; }
  const items = await db.select().from(pricePositionBundleItemsTable)
    .where(eq(pricePositionBundleItemsTable.bundleId, b.id));
  const posIds = [...new Set(items.map(i => i.pricePositionId))];
  const positions = await loadVisiblePositions(req, posIds);
  res.json(mapPriceBundle(b, items, positions));
});

router.post('/price-bundles', async (req, res) => {
  const parsed = PriceBundleCreateBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const scope = getScope(req);
  const b = parsed.data;
  // Brand/Company müssen im Scope des Users sein
  if (b.brandId || b.companyId) {
    const synthetic = { tenantId: scope.tenantId, brandId: b.brandId ?? null, companyId: b.companyId ?? null };
    if (!(await scopedRowVisibleAsync(req, synthetic))) {
      res.status(403).json({ error: 'brand/company outside scope' });
      return;
    }
  }
  const itemsCheck = await validateBundleItems(req, b.items);
  if (!itemsCheck.ok) { res.status(itemsCheck.status).json({ error: itemsCheck.error }); return; }
  const bundleId = `ppb_${randomUUID().slice(0, 8)}`;
  await db.insert(pricePositionBundlesTable).values({
    id: bundleId,
    tenantId: scope.tenantId,
    name: b.name.trim(),
    description: b.description ?? '',
    category: b.category ?? null,
    brandId: b.brandId ?? null,
    companyId: b.companyId ?? null,
  });
  if (b.items.length) {
    await db.insert(pricePositionBundleItemsTable).values(b.items.map((it, idx) => ({
      id: `ppbi_${randomUUID().slice(0, 8)}`,
      bundleId,
      pricePositionId: it.pricePositionId,
      quantity: String(it.quantity),
      customDiscountPct: String(it.customDiscountPct),
      position: it.position ?? idx,
    })));
  }
  await writeAuditFromReq(req, {
    entityType: 'price_bundle', entityId: bundleId, action: 'create',
    summary: `Bundle angelegt: ${b.name} (${b.items.length} Positionen)`,
    actor: scope.user.name,
  });
  // Reload and respond hydrated
  const [row] = await db.select().from(pricePositionBundlesTable).where(eq(pricePositionBundlesTable.id, bundleId));
  const items = await db.select().from(pricePositionBundleItemsTable).where(eq(pricePositionBundleItemsTable.bundleId, bundleId));
  const posIds = [...new Set(items.map(i => i.pricePositionId))];
  const positions = posIds.length
    ? await db.select().from(pricePositionsTable).where(inArray(pricePositionsTable.id, posIds))
    : [];
  res.status(201).json(mapPriceBundle(row!, items, positions));
});

router.patch('/price-bundles/:id', async (req, res) => {
  const parsed = PriceBundleUpdateBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const existing = await loadVisibleBundle(req, req.params.id);
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  const scope = getScope(req);
  const b = parsed.data;
  if ('brandId' in b || 'companyId' in b) {
    const synthetic = {
      tenantId: scope.tenantId,
      brandId: b.brandId !== undefined ? b.brandId : existing.brandId,
      companyId: b.companyId !== undefined ? b.companyId : existing.companyId,
    };
    if (!(await scopedRowVisibleAsync(req, synthetic))) {
      res.status(403).json({ error: 'brand/company outside scope' });
      return;
    }
  }
  const patch: Partial<typeof pricePositionBundlesTable.$inferInsert> = {};
  if (b.name !== undefined) patch.name = b.name.trim();
  if (b.description !== undefined) patch.description = b.description;
  if (b.category !== undefined) patch.category = b.category;
  if (b.brandId !== undefined) patch.brandId = b.brandId;
  if (b.companyId !== undefined) patch.companyId = b.companyId;
  if (Object.keys(patch).length) {
    await db.update(pricePositionBundlesTable).set(patch).where(eq(pricePositionBundlesTable.id, existing.id));
  }
  await writeAuditFromReq(req, {
    entityType: 'price_bundle', entityId: existing.id, action: 'update',
    summary: `Bundle aktualisiert: ${b.name ?? existing.name}`,
    actor: scope.user.name,
  });
  const [row] = await db.select().from(pricePositionBundlesTable).where(eq(pricePositionBundlesTable.id, existing.id));
  const items = await db.select().from(pricePositionBundleItemsTable).where(eq(pricePositionBundleItemsTable.bundleId, existing.id));
  const posIds = [...new Set(items.map(i => i.pricePositionId))];
  const positions = posIds.length
    ? await db.select().from(pricePositionsTable).where(inArray(pricePositionsTable.id, posIds))
    : [];
  res.json(mapPriceBundle(row!, items, positions));
});

router.put('/price-bundles/:id/items', async (req, res) => {
  const parsed = PriceBundleItemsReplaceBody.safeParse(req.body);
  if (!parsed.success) { res.status(422).json({ error: 'validation', issues: parsed.error.issues }); return; }
  const existing = await loadVisibleBundle(req, req.params.id);
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  const itemsCheck = await validateBundleItems(req, parsed.data.items);
  if (!itemsCheck.ok) { res.status(itemsCheck.status).json({ error: itemsCheck.error }); return; }
  await db.delete(pricePositionBundleItemsTable).where(eq(pricePositionBundleItemsTable.bundleId, existing.id));
  if (parsed.data.items.length) {
    await db.insert(pricePositionBundleItemsTable).values(parsed.data.items.map((it, idx) => ({
      id: `ppbi_${randomUUID().slice(0, 8)}`,
      bundleId: existing.id,
      pricePositionId: it.pricePositionId,
      quantity: String(it.quantity),
      customDiscountPct: String(it.customDiscountPct),
      position: it.position ?? idx,
    })));
  }
  await writeAuditFromReq(req, {
    entityType: 'price_bundle', entityId: existing.id, action: 'items_replace',
    summary: `Bundle-Positionen ersetzt (${parsed.data.items.length})`,
    actor: getScope(req).user.name,
  });
  const items = await db.select().from(pricePositionBundleItemsTable).where(eq(pricePositionBundleItemsTable.bundleId, existing.id));
  const posIds = [...new Set(items.map(i => i.pricePositionId))];
  const positions = posIds.length
    ? await db.select().from(pricePositionsTable).where(inArray(pricePositionsTable.id, posIds))
    : [];
  res.json(mapPriceBundle(existing, items, positions));
});

router.delete('/price-bundles/:id', async (req, res) => {
  const existing = await loadVisibleBundle(req, req.params.id);
  if (!existing) { res.status(404).json({ error: 'not found' }); return; }
  await db.delete(pricePositionBundleItemsTable).where(eq(pricePositionBundleItemsTable.bundleId, existing.id));
  await db.delete(pricePositionBundlesTable).where(eq(pricePositionBundlesTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'price_bundle', entityId: existing.id, action: 'delete',
    summary: `Bundle gelöscht: ${existing.name}`,
    actor: getScope(req).user.name,
  });
  res.status(204).end();
});

// ── EXTERNAL CONTRACTS (Bestandsverträge mit KI-gestützter Erfassung) ──
//
// Externe Verträge sind Bestandsdokumente, die NICHT über DealFlow erzeugt
// wurden (Vorgänger-CLM, Kunde, Anwalt). Sie liegen als PDF/DOCX in
// Object-Storage und werden hier mit den von der KI extrahierten Kerndaten
// (Titel, Laufzeit, Kündigungsfrist, Wert, Parteien, identifizierte
// Klausel-Familien) registriert. Anders als contractsTable: kein Klausel-
// Workflow, keine Approvals — der Vertrag ist ja bereits unterschrieben.
//
// Renewal-Engine (kommt voll erst in #66) konsumiert effectiveTo +
// autoRenewal; hier liefern wir bereits den Marker `renewalRelevant`.
//
// Brand-Scope:
//   - tenantId hart gefiltert
//   - bei eingeschränktem Brand-Scope: nur Verträge passender brandIds
//     (oder ohne brandId, wenn Account erlaubt)
//
// Audit:
//   - upload-url: kein Audit (nur Vorbereitung)
//   - extract: kein Audit (nicht persistiert; AI-Provider hat eigenes Audit)
//   - create: action='create', summary=Titel+Datei
//   - patch: action='update', before/after snapshot, pro Request 1 Eintrag
//   - delete: action='delete', before-Snapshot
const ExternalPartySchema = z.object({
  role: z.enum(['customer', 'supplier', 'our_entity', 'third_party', 'unknown']),
  name: z.string().min(1).max(200),
});
const ExternalClauseFamilySchema = z.object({
  familyId: z.string().nullable().optional(),
  name: z.string().min(1).max(120),
  confidence: z.number().min(0).max(1),
});

const ExternalContractCreateBody = z.object({
  accountId: z.string().min(1),
  brandId: z.string().nullable().optional(),
  contractTypeCode: z.string().nullable().optional(),
  objectPath: z.string().min(1),
  fileName: z.string().min(1).max(240),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().min(1).max(200),
  title: z.string().min(1).max(240),
  parties: z.array(ExternalPartySchema).max(20),
  currency: z.string().min(3).max(8).nullable().optional(),
  valueAmount: z.union([z.number(), z.string()]).nullable().optional(),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
  autoRenewal: z.boolean(),
  renewalNoticeDays: z.number().int().min(0).max(3650).nullable().optional(),
  terminationNoticeDays: z.number().int().min(0).max(3650).nullable().optional(),
  governingLaw: z.string().nullable().optional(),
  jurisdiction: z.string().nullable().optional(),
  identifiedClauseFamilies: z.array(ExternalClauseFamilySchema).max(40).optional(),
  confidence: z.record(z.string(), z.number().min(0).max(1)).optional(),
  aiInvocationId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const ExternalContractPatchBody = z.object({
  brandId: z.string().nullable().optional(),
  contractTypeCode: z.string().nullable().optional(),
  title: z.string().min(1).max(240).optional(),
  parties: z.array(ExternalPartySchema).max(20).optional(),
  currency: z.string().min(3).max(8).nullable().optional(),
  valueAmount: z.union([z.number(), z.string()]).nullable().optional(),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
  autoRenewal: z.boolean().optional(),
  renewalNoticeDays: z.number().int().min(0).max(3650).nullable().optional(),
  terminationNoticeDays: z.number().int().min(0).max(3650).nullable().optional(),
  governingLaw: z.string().nullable().optional(),
  jurisdiction: z.string().nullable().optional(),
  identifiedClauseFamilies: z.array(ExternalClauseFamilySchema).max(40).optional(),
  notes: z.string().nullable().optional(),
});

const SUPPORTED_EXT_CONTRACT_MIME = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_EXT_CONTRACT_BYTES = 20 * 1024 * 1024;

function externalContractRenewalRelevant(
  row: typeof externalContractsTable.$inferSelect,
): boolean {
  return Boolean(row.autoRenewal && row.effectiveTo);
}

async function mapExternalContract(
  row: typeof externalContractsTable.$inferSelect,
  ctx?: {
    accs?: Map<string, typeof accountsTable.$inferSelect>;
    brands?: Map<string, typeof brandsTable.$inferSelect>;
    users?: Map<string, typeof usersTable.$inferSelect>;
  },
) {
  const accs = ctx?.accs ?? (await getAccountMap());
  const brands = ctx?.brands ?? (await getBrandMap());
  const users = ctx?.users ?? (await getUserMap(row.tenantId));
  return {
    id: row.id,
    tenantId: row.tenantId,
    accountId: row.accountId,
    accountName: accs.get(row.accountId)?.name ?? null,
    brandId: row.brandId,
    brandName: row.brandId ? (brands.get(row.brandId)?.name ?? null) : null,
    contractTypeCode: row.contractTypeCode,
    objectPath: row.objectPath,
    fileName: row.fileName,
    fileSize: row.fileSize,
    mimeType: row.mimeType,
    status: row.status,
    title: row.title,
    parties: row.parties ?? [],
    currency: row.currency,
    valueAmount: row.valueAmount == null ? null : Number(row.valueAmount),
    effectiveFrom: row.effectiveFrom ?? null,
    effectiveTo: row.effectiveTo ?? null,
    autoRenewal: row.autoRenewal,
    renewalNoticeDays: row.renewalNoticeDays,
    terminationNoticeDays: row.terminationNoticeDays,
    governingLaw: row.governingLaw,
    jurisdiction: row.jurisdiction,
    identifiedClauseFamilies: row.identifiedClauseFamilies ?? [],
    confidence: row.confidenceJson ?? {},
    aiInvocationId: row.aiInvocationId,
    notes: row.notes,
    uploadedBy: row.uploadedBy,
    uploadedByName: row.uploadedBy ? (users.get(row.uploadedBy)?.name ?? null) : null,
    renewalRelevant: externalContractRenewalRelevant(row),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

// Visibility: tenant + brand-scope. accountId muss in scope sein, weil
// jeder externe Vertrag an einen Account hängt.
async function loadVisibleExternalContract(
  req: Request,
  id: string,
): Promise<typeof externalContractsTable.$inferSelect | null> {
  const scope = getScope(req);
  const [row] = await db
    .select()
    .from(externalContractsTable)
    .where(and(
      eq(externalContractsTable.id, id),
      eq(externalContractsTable.tenantId, scope.tenantId),
    ));
  if (!row) return null;
  const accStatus = await entityScopeStatus(req, 'account', row.accountId);
  if (accStatus !== 'ok') return null;
  if (row.brandId) {
    const brands = await allowedBrandIds(req);
    if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
      if (!brands.includes(row.brandId)) return null;
    }
  }
  return row;
}

// 1) signed PUT URL — registriert Datei in uploadedObjectsTable, damit der
//    spätere POST /external-contracts den objectPath als "tenant-owned"
//    erkennt (analog AttachmentLibrary).
router.post('/external-contracts/upload-url', async (req, res) => {
  const scope = getScope(req);
  const Body = z.object({
    fileName: z.string().min(1).max(240),
    size: z.number().int().positive(),
    contentType: z.string().min(1).max(200),
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid request', details: parsed.error.issues });
    return;
  }
  const { size, contentType } = parsed.data;
  if (!SUPPORTED_EXT_CONTRACT_MIME.has(contentType)) {
    res.status(400).json({ error: 'contentType must be application/pdf or DOCX' });
    return;
  }
  if (size <= 0 || size > MAX_EXT_CONTRACT_BYTES) {
    res.status(400).json({ error: `size must be 1..${MAX_EXT_CONTRACT_BYTES} bytes` });
    return;
  }
  try {
    const svc = new ObjectStorageService();
    const uploadURL = await svc.getObjectEntityUploadURL();
    const objectPath = svc.normalizeObjectEntityPath(uploadURL);
    await db.insert(uploadedObjectsTable).values({
      objectPath,
      tenantId: scope.tenantId,
      userId: scope.user?.id ?? null,
      kind: 'document',
      contentType,
      size,
    }).onConflictDoNothing();
    res.json({ uploadURL, objectPath });
  } catch (err) {
    req.log.error({ err }, 'external-contract upload-url failed');
    res.status(500).json({ error: 'failed to generate upload url' });
  }
});

// 2) KI-Extraktion. Best-effort: Bei jedem Fehler liefern wir 200 mit
//    aiAvailable=false + leerer Suggestion, damit das Frontend nicht
//    abstürzt und der User manuell weitermachen kann.
router.post('/external-contracts/extract', async (req, res) => {
  const scope = getScope(req);
  const Body = z.object({
    objectPath: z.string().min(1),
    fileName: z.string().min(1).max(240),
    mimeType: z.string().min(1).max(200),
    accountId: z.string().min(1),
  });
  const parsed = Body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid request', details: parsed.error.issues });
    return;
  }
  const { objectPath, fileName, mimeType, accountId } = parsed.data;
  if (!await assertOwnedObjectPath(req, res, scope, objectPath)) return;
  const accStatus = await entityScopeStatus(req, 'account', accountId);
  if (accStatus !== 'ok') {
    res.status(accStatus === 'missing' ? 404 : 403)
      .json({ error: accStatus === 'missing' ? 'account not found' : 'forbidden' });
    return;
  }
  if (!SUPPORTED_EXT_CONTRACT_MIME.has(mimeType)) {
    res.status(400).json({ error: 'mimeType must be PDF or DOCX' });
    return;
  }

  const emptySuggestion = {
    title: null,
    contractTypeGuess: null,
    parties: [] as Array<{ role: string; name: string }>,
    currency: null,
    valueAmount: null,
    effectiveFrom: null,
    effectiveTo: null,
    autoRenewal: false,
    renewalNoticeDays: null,
    terminationNoticeDays: null,
    governingLaw: null,
    jurisdiction: null,
    identifiedClauseFamilies: [] as Array<{ name: string; confidence: number }>,
    confidence: {} as Record<string, number>,
    notes: [] as string[],
  };

  let buffer: Buffer;
  try {
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(objectPath);
    const [buf] = await file.download();
    buffer = buf;
  } catch (err) {
    req.log.warn({ err, objectPath }, 'external-contract extract: download failed');
    res.status(404).json({ error: 'object not found' });
    return;
  }

  let extractedText: string;
  let truncated = false;
  let charCount = 0;
  try {
    const out = await extractTextFromUpload(buffer, mimeType);
    extractedText = out.text;
    truncated = out.truncated;
    charCount = out.charCount;
  } catch (err) {
    req.log.warn({ err }, 'external-contract extract: text extraction failed');
    res.json({
      aiAvailable: false,
      invocationId: null,
      truncated: false,
      charCount: 0,
      errorCode: 'text_extraction_failed',
      suggestion: { ...emptySuggestion, notes: ['Aus dem Dokument konnte kein Text extrahiert werden (gescanntes PDF? OCR ist out-of-scope).'] },
    });
    return;
  }

  if (!isAIConfigured()) {
    res.json({
      aiAvailable: false,
      invocationId: null,
      truncated,
      charCount,
      errorCode: 'config_error',
      suggestion: { ...emptySuggestion, notes: ['KI-Provider ist nicht konfiguriert — bitte Felder manuell ausfüllen.'] },
    });
    return;
  }

  try {
    const result = await runStructured<
      { rawText: string; fileName: string },
      {
        title: string;
        contractTypeGuess: string;
        parties: Array<{ role: string; name: string }>;
        currency: string | null;
        valueAmount: string | null;
        effectiveFrom: string | null;
        effectiveTo: string | null;
        autoRenewal: boolean;
        renewalNoticeDays: number | null;
        terminationNoticeDays: number | null;
        governingLaw: string | null;
        jurisdiction: string | null;
        identifiedClauseFamilies: Array<{ name: string; confidence: number }>;
        confidence: Record<string, number>;
        notes: string[];
      }
    >({
      promptKey: 'external.contract.extract',
      input: { rawText: extractedText, fileName },
      scope,
      entityRef: { entityType: 'external_contract', entityId: objectPath },
    });
    res.json({
      aiAvailable: true,
      invocationId: result.invocationId,
      truncated,
      charCount,
      errorCode: null,
      suggestion: result.output,
    });
  } catch (err) {
    if (err instanceof AIOrchestrationError) {
      req.log.warn({ err: err.message, code: err.code }, 'external-contract extract: AI failed');
      res.json({
        aiAvailable: false,
        invocationId: null,
        truncated,
        charCount,
        errorCode: err.code,
        suggestion: { ...emptySuggestion, notes: ['KI-Extraktion fehlgeschlagen — bitte Felder manuell prüfen.'] },
      });
      return;
    }
    throw err;
  }
});

// 3) GET list — Brand-Scope-konform
router.get('/external-contracts', async (req, res) => {
  const scope = getScope(req);
  const filters = [eq(externalContractsTable.tenantId, scope.tenantId)];
  if (req.query.accountId) {
    filters.push(eq(externalContractsTable.accountId, String(req.query.accountId)));
  }
  if (req.query.brandId) {
    filters.push(eq(externalContractsTable.brandId, String(req.query.brandId)));
  }
  const rows = await db.select().from(externalContractsTable)
    .where(and(...filters))
    .orderBy(desc(externalContractsTable.createdAt));
  // Brand-Scope-Filter
  let visible = rows;
  if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
    const brands = await allowedBrandIds(req);
    const accStatuses = await Promise.all(
      rows.map(r => entityScopeStatus(req, 'account', r.accountId)),
    );
    visible = rows.filter((r, i) => {
      if (accStatuses[i] !== 'ok') return false;
      if (r.brandId && !brands.includes(r.brandId)) return false;
      return true;
    });
  }
  const ctx = {
    accs: await getAccountMap(),
    brands: await getBrandMap(),
    users: await getUserMap(scope.tenantId),
  };
  const mapped = await Promise.all(visible.map(r => mapExternalContract(r, ctx)));
  res.json(mapped);
});

// 4) POST — persistieren nach User-Bestätigung
router.post('/external-contracts', async (req, res) => {
  const scope = getScope(req);
  const parsed = ExternalContractCreateBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid request', details: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  if (!await assertOwnedObjectPath(req, res, scope, b.objectPath)) return;
  const accStatus = await entityScopeStatus(req, 'account', b.accountId);
  if (accStatus !== 'ok') {
    res.status(accStatus === 'missing' ? 404 : 403)
      .json({ error: accStatus === 'missing' ? 'account not found' : 'forbidden' });
    return;
  }
  if (!SUPPORTED_EXT_CONTRACT_MIME.has(b.mimeType)) {
    res.status(400).json({ error: 'mimeType must be PDF or DOCX' });
    return;
  }
  if (b.brandId) {
    // Tenant-Bindung erzwingen: brand → company.tenantId muss == scope.tenantId.
    const [brandRow] = await db.select({ companyTenantId: companiesTable.tenantId })
      .from(brandsTable)
      .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
      .where(eq(brandsTable.id, b.brandId));
    if (!brandRow || brandRow.companyTenantId !== scope.tenantId) {
      res.status(403).json({ error: 'brand not in tenant' });
      return;
    }
    const brands = await allowedBrandIds(req);
    if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
      if (!brands.includes(b.brandId)) {
        res.status(403).json({ error: 'brand not in scope' });
        return;
      }
    }
  }

  const id = `xct_${randomUUID().slice(0, 12)}`;
  await db.insert(externalContractsTable).values({
    id,
    tenantId: scope.tenantId,
    accountId: b.accountId,
    brandId: b.brandId ?? null,
    contractTypeCode: b.contractTypeCode ?? null,
    objectPath: b.objectPath,
    fileName: b.fileName,
    fileSize: b.fileSize,
    mimeType: b.mimeType,
    status: 'confirmed',
    title: b.title,
    parties: b.parties,
    currency: b.currency ?? null,
    valueAmount: b.valueAmount == null ? null : String(b.valueAmount),
    effectiveFrom: b.effectiveFrom ?? null,
    effectiveTo: b.effectiveTo ?? null,
    autoRenewal: b.autoRenewal,
    renewalNoticeDays: b.renewalNoticeDays ?? null,
    terminationNoticeDays: b.terminationNoticeDays ?? null,
    governingLaw: b.governingLaw ?? null,
    jurisdiction: b.jurisdiction ?? null,
    identifiedClauseFamilies: b.identifiedClauseFamilies ?? [],
    confidenceJson: b.confidence ?? {},
    aiInvocationId: b.aiInvocationId ?? null,
    notes: b.notes ?? null,
    uploadedBy: scope.user?.id ?? null,
  });
  const [row] = await db.select().from(externalContractsTable)
    .where(eq(externalContractsTable.id, id));
  await writeAuditFromReq(req, {
    entityType: 'external_contract',
    entityId: id,
    action: 'create',
    summary: `Bestandsvertrag „${b.title}" hochgeladen (${b.fileName})`,
    actor: scope.user?.name,
    after: row,
  });
  void emitEvent(scope.tenantId, 'external_contract.confirmed', {
    externalContractId: id,
    accountId: b.accountId,
    title: b.title,
  });
  const dto = await mapExternalContract(row);
  res.status(201).json(dto);
});

// 5) GET single + signed download URL
router.get('/external-contracts/:id', async (req, res) => {
  const row = await loadVisibleExternalContract(req, req.params.id);
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  // Signed download URL — TTL kurz halten
  let downloadUrl = '';
  try {
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(row.objectPath);
    const [signed] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60_000,
      version: 'v4',
    });
    downloadUrl = signed;
  } catch (err) {
    req.log.warn({ err }, 'external-contract: signed download url failed');
    downloadUrl = '';
  }
  const dto = await mapExternalContract(row);
  res.json({ ...dto, downloadUrl });
});

// 6) PATCH — pro Request 1 Audit-Eintrag mit before/after
router.patch('/external-contracts/:id', async (req, res) => {
  const scope = getScope(req);
  const existing = await loadVisibleExternalContract(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const parsed = ExternalContractPatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid request', details: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  if (b.brandId) {
    // Tenant-Bindung erzwingen analog POST.
    const [brandRow] = await db.select({ companyTenantId: companiesTable.tenantId })
      .from(brandsTable)
      .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
      .where(eq(brandsTable.id, b.brandId));
    if (!brandRow || brandRow.companyTenantId !== scope.tenantId) {
      res.status(403).json({ error: 'brand not in tenant' });
      return;
    }
    const brands = await allowedBrandIds(req);
    if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
      if (!brands.includes(b.brandId)) {
        res.status(403).json({ error: 'brand not in scope' });
        return;
      }
    }
  }
  const patch: Partial<typeof externalContractsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (b.brandId !== undefined) patch.brandId = b.brandId;
  if (b.contractTypeCode !== undefined) patch.contractTypeCode = b.contractTypeCode;
  if (b.title !== undefined) patch.title = b.title;
  if (b.parties !== undefined) patch.parties = b.parties;
  if (b.currency !== undefined) patch.currency = b.currency;
  if (b.valueAmount !== undefined) {
    patch.valueAmount = b.valueAmount == null ? null : String(b.valueAmount);
  }
  if (b.effectiveFrom !== undefined) patch.effectiveFrom = b.effectiveFrom;
  if (b.effectiveTo !== undefined) patch.effectiveTo = b.effectiveTo;
  if (b.autoRenewal !== undefined) patch.autoRenewal = b.autoRenewal;
  if (b.renewalNoticeDays !== undefined) patch.renewalNoticeDays = b.renewalNoticeDays;
  if (b.terminationNoticeDays !== undefined) patch.terminationNoticeDays = b.terminationNoticeDays;
  if (b.governingLaw !== undefined) patch.governingLaw = b.governingLaw;
  if (b.jurisdiction !== undefined) patch.jurisdiction = b.jurisdiction;
  if (b.identifiedClauseFamilies !== undefined) {
    patch.identifiedClauseFamilies = b.identifiedClauseFamilies;
  }
  if (b.notes !== undefined) patch.notes = b.notes;

  await db.update(externalContractsTable)
    .set(patch)
    .where(eq(externalContractsTable.id, existing.id));
  const [after] = await db.select().from(externalContractsTable)
    .where(eq(externalContractsTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'external_contract',
    entityId: existing.id,
    action: 'update',
    summary: `Bestandsvertrag „${after.title}" aktualisiert`,
    actor: scope.user?.name,
    before: existing,
    after,
  });
  res.json(await mapExternalContract(after));
});

// 7) DELETE — DB-Eintrag + Object-Storage-Datei
router.delete('/external-contracts/:id', async (req, res) => {
  const scope = getScope(req);
  const existing = await loadVisibleExternalContract(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  await db.delete(externalContractsTable)
    .where(eq(externalContractsTable.id, existing.id));
  // Object-Storage-Datei löschen — best-effort. DB ist Source-of-Truth, also
  // ist es OK wenn die Datei noch eine Weile dranbleibt.
  try {
    const svc = new ObjectStorageService();
    const file = await svc.getObjectEntityFile(existing.objectPath);
    await file.delete({ ignoreNotFound: true });
  } catch (err) {
    req.log.warn({ err, objectPath: existing.objectPath }, 'external-contract: object delete failed');
  }
  await writeAuditFromReq(req, {
    entityType: 'external_contract',
    entityId: existing.id,
    action: 'delete',
    summary: `Bestandsvertrag „${existing.title}" gelöscht`,
    actor: scope.user?.name,
    before: existing,
  });
  res.status(204).end();
});


// ────────────────────────────────────────────────────────────────────────────
// Renewal-Engine — Task #66
// Verträge mit autoRenewal=true werden zyklisch gescannt. Sobald die
// Notice-Frist in den nächsten 180 Tagen liegt, wird eine Opportunity
// materialisiert. Stabiler PK pro (contract, dueDate) macht den Job idempotent.
// ────────────────────────────────────────────────────────────────────────────

const RENEWAL_LOOKAHEAD_DAYS = 180;
const RENEWAL_DUE_SOON_DAYS = 30;

type RenewalRiskFactor = {
  key: string;
  label: string;
  points: number;
  detail?: string;
};

type RenewalRiskInput = {
  openObligationsCount: number;
  accountHealthScore: number | null;
  avgDiscountPct: number | null;
  daysSinceLastTouch: number | null;
};

function computeRenewalRiskScore(input: RenewalRiskInput): {
  score: number;
  factors: RenewalRiskFactor[];
} {
  const factors: RenewalRiskFactor[] = [];
  let score = 0;

  // Offene Pflichten: 5 Punkte je offener derived-obligation, max 25
  const obPts = Math.min(25, input.openObligationsCount * 5);
  if (obPts > 0) {
    score += obPts;
    factors.push({
      key: 'openObligations',
      label: `Offene Pflichten (${input.openObligationsCount})`,
      points: obPts,
    });
  }

  // Account-Health: niedriger Health → Risiko. (100-health)/2, max 25
  if (input.accountHealthScore != null) {
    const hpPts = Math.max(0, Math.min(25, Math.round((100 - input.accountHealthScore) / 2)));
    if (hpPts > 0) {
      score += hpPts;
      factors.push({
        key: 'accountHealth',
        label: `Niedrige Account-Health (${input.accountHealthScore})`,
        points: hpPts,
      });
    }
  }

  // Discount-Drift: hoher durchschn. Discount → Pricing fragil, max 25
  if (input.avgDiscountPct != null) {
    const dPts = Math.max(0, Math.min(25, Math.round(input.avgDiscountPct - 10)));
    if (dPts > 0) {
      score += dPts;
      factors.push({
        key: 'discountDrift',
        label: `Hoher Discount (Ø ${input.avgDiscountPct.toFixed(1)} %)`,
        points: dPts,
      });
    }
  }

  // Inaktivität: keine Aktivität ≥ 60 Tage → +25
  if (input.daysSinceLastTouch != null && input.daysSinceLastTouch >= 60) {
    score += 25;
    factors.push({
      key: 'inactivity',
      label: `Lange keine Aktivität (${input.daysSinceLastTouch} Tage)`,
      points: 25,
    });
  }

  // Cap 0..100
  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return { score, factors };
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function daysBetween(a: Date, b: Date): number {
  const ms = a.getTime() - b.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

function toDateOnly(d: Date | string | null): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d.length >= 10 ? d.slice(0, 10) : d;
  return d.toISOString().slice(0, 10);
}

async function gatherRenewalRiskInput(
  contractId: string,
  accountId: string,
): Promise<RenewalRiskInput> {
  const [openOb, acc, contractRow] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` })
      .from(obligationsTable)
      .where(and(
        eq(obligationsTable.contractId, contractId),
        sql`${obligationsTable.status} not in ('done','waived')`,
      )),
    db.select().from(accountsTable).where(eq(accountsTable.id, accountId)),
    db.select().from(contractsTable).where(eq(contractsTable.id, contractId)),
  ]);
  const openObligationsCount = openOb[0]?.c ?? 0;
  const accountHealthScore = acc[0]?.healthScore ?? null;

  // Discount: aus akzeptierter Quote-Version
  let avgDiscountPct: number | null = null;
  const c = contractRow[0];
  if (c?.acceptedQuoteVersionId) {
    const lines = await db.select({ d: lineItemsTable.discountPct })
      .from(lineItemsTable)
      .where(eq(lineItemsTable.quoteVersionId, c.acceptedQuoteVersionId));
    if (lines.length > 0) {
      const nums = lines.map(l => Number(l.d ?? 0)).filter(n => !Number.isNaN(n));
      if (nums.length > 0) {
        avgDiscountPct = nums.reduce((s, n) => s + n, 0) / nums.length;
      }
    }
  }

  // Inaktivität: jüngste Audit-Aktivität auf Vertrag
  let daysSinceLastTouch: number | null = null;
  const lastAudit = await db.select({ at: auditLogTable.at })
    .from(auditLogTable)
    .where(and(
      eq(auditLogTable.entityType, 'contract'),
      eq(auditLogTable.entityId, contractId),
    ))
    .orderBy(desc(auditLogTable.at))
    .limit(1);
  if (lastAudit[0]?.at) {
    daysSinceLastTouch = daysBetween(new Date(), new Date(lastAudit[0].at));
  }
  return { openObligationsCount, accountHealthScore, avgDiscountPct, daysSinceLastTouch };
}

interface RenewalRunResult {
  scanned: number;
  created: number;
  updated: number;
  dueSoon: number;
  skipped: number;
}

async function materializeRenewalsForTenant(tenantId: string): Promise<RenewalRunResult> {
  const today = new Date();
  const horizon = addDays(today, RENEWAL_LOOKAHEAD_DAYS);
  // Nur signierte/aktive Verträge mit autoRenewal=true und gesetztem effectiveTo
  const candidates = await db.select().from(contractsTable).where(and(
    eq(contractsTable.tenantId, tenantId),
    eq(contractsTable.autoRenewal, true),
    sql`${contractsTable.effectiveTo} is not null`,
    sql`${contractsTable.status} in ('signed','active','executed')`,
  ));
  const result: RenewalRunResult = { scanned: candidates.length, created: 0, updated: 0, dueSoon: 0, skipped: 0 };

  for (const c of candidates) {
    if (!c.effectiveTo || !c.accountId) { result.skipped++; continue; }
    const dueDate = new Date(`${c.effectiveTo}T00:00:00.000Z`);
    const noticeDays = c.renewalNoticeDays ?? 90;
    const noticeDeadline = addDays(dueDate, -noticeDays);

    // In den nächsten RENEWAL_LOOKAHEAD_DAYS? (entweder Notice ODER dueDate fällt rein)
    const inWindow =
      (noticeDeadline >= today && noticeDeadline <= horizon) ||
      (dueDate >= today && dueDate <= horizon);
    if (!inWindow) { result.skipped++; continue; }

    const dueDateStr = toDateOnly(dueDate)!;
    const noticeStr = toDateOnly(noticeDeadline)!;
    const riskIn = await gatherRenewalRiskInput(c.id, c.accountId);
    const { score, factors } = computeRenewalRiskScore(riskIn);

    // Existiert bereits eine Opportunity für (contract, dueDate)?
    const existing = await db.select().from(renewalOpportunitiesTable).where(and(
      eq(renewalOpportunitiesTable.contractId, c.id),
      eq(renewalOpportunitiesTable.dueDate, dueDateStr),
    ));
    if (existing.length === 0) {
      const id = `rn_${randomUUID().slice(0, 12)}`;
      const ins = await db.insert(renewalOpportunitiesTable).values({
        id,
        tenantId,
        contractId: c.id,
        accountId: c.accountId,
        brandId: c.brandId ?? null,
        dueDate: dueDateStr,
        noticeDeadline: noticeStr,
        riskScore: score,
        riskFactors: factors,
        status: 'open',
        valueAmount: c.valueAmount == null ? null : String(c.valueAmount),
        currency: c.valueCurrency ?? c.currency ?? null,
      }).onConflictDoNothing({
        target: [renewalOpportunitiesTable.contractId, renewalOpportunitiesTable.dueDate],
      }).returning({ id: renewalOpportunitiesTable.id });
      if (ins.length === 0) {
        result.skipped++;
        continue;
      }
      result.created++;
      void emitEvent(tenantId, 'renewal.created', {
        renewalId: id,
        contractId: c.id,
        accountId: c.accountId,
        dueDate: dueDateStr,
        noticeDeadline: noticeStr,
        riskScore: score,
      });
      const daysToNotice = daysBetween(noticeDeadline, today);
      if (daysToNotice <= RENEWAL_DUE_SOON_DAYS) {
        result.dueSoon++;
        void emitEvent(tenantId, 'renewal.due_soon', {
          renewalId: id,
          contractId: c.id,
          accountId: c.accountId,
          noticeDeadline: noticeStr,
          daysToNotice,
        });
      }
    } else {
      // Existing Opportunity → Risk-Score aktualisieren wenn offen.
      const cur = existing[0]!;
      if (cur.status === 'open' && cur.riskScore !== score) {
        await db.update(renewalOpportunitiesTable)
          .set({ riskScore: score, riskFactors: factors, updatedAt: new Date() })
          .where(eq(renewalOpportunitiesTable.id, cur.id));
        result.updated++;
      } else {
        result.skipped++;
      }
    }
  }
  return result;
}

async function mapRenewal(
  row: typeof renewalOpportunitiesTable.$inferSelect,
  ctx?: {
    accs?: Map<string, typeof accountsTable.$inferSelect>;
    brands?: Map<string, typeof brandsTable.$inferSelect>;
    contracts?: Map<string, typeof contractsTable.$inferSelect>;
  },
) {
  const accs = ctx?.accs ?? (await getAccountMap());
  const brands = ctx?.brands ?? (await getBrandMap());
  const contracts = ctx?.contracts ?? new Map<string, typeof contractsTable.$inferSelect>();
  const c = contracts.get(row.contractId) ?? null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    contractId: row.contractId,
    contractTitle: c?.title ?? null,
    accountId: row.accountId,
    accountName: accs.get(row.accountId)?.name ?? null,
    brandId: row.brandId,
    brandName: row.brandId ? (brands.get(row.brandId)?.name ?? null) : null,
    dueDate: row.dueDate,
    noticeDeadline: row.noticeDeadline,
    riskScore: row.riskScore,
    riskFactors: row.riskFactors ?? [],
    status: row.status,
    valueAmount: row.valueAmount == null ? null : Number(row.valueAmount),
    currency: row.currency,
    snoozedUntil: row.snoozedUntil ?? null,
    decidedAt: iso(row.decidedAt),
    decidedBy: row.decidedBy,
    notes: row.notes,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

async function loadVisibleRenewal(
  req: Request,
  id: string,
): Promise<typeof renewalOpportunitiesTable.$inferSelect | null> {
  const scope = getScope(req);
  const [row] = await db.select().from(renewalOpportunitiesTable).where(and(
    eq(renewalOpportunitiesTable.id, id),
    eq(renewalOpportunitiesTable.tenantId, scope.tenantId),
  ));
  if (!row) return null;
  const accStatus = await entityScopeStatus(req, 'account', row.accountId);
  if (accStatus !== 'ok') return null;
  if (row.brandId) {
    const allowB = await allowedBrandIds(req);
    if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
      if (!allowB.includes(row.brandId)) return null;
    }
  }
  return row;
}

// GET /renewals — gefiltert nach bucket / minRisk / status / brand / account
router.get('/renewals', async (req, res) => {
  const scope = getScope(req);
  const filters: SQL[] = [eq(renewalOpportunitiesTable.tenantId, scope.tenantId)];

  const status = typeof req.query.status === 'string' ? req.query.status : null;
  if (status && ['open','snoozed','won','lost','cancelled'].includes(status)) {
    filters.push(eq(renewalOpportunitiesTable.status, status));
  } else if (!status || status === 'open') {
    // Default-Listing zeigt offene Opportunities
    if (!status) filters.push(eq(renewalOpportunitiesTable.status, 'open'));
  }

  const minRisk = req.query.minRisk == null ? null : Number(req.query.minRisk);
  if (minRisk != null && !Number.isNaN(minRisk)) {
    filters.push(sql`${renewalOpportunitiesTable.riskScore} >= ${minRisk}`);
  }
  if (typeof req.query.accountId === 'string') {
    filters.push(eq(renewalOpportunitiesTable.accountId, req.query.accountId));
  }
  if (typeof req.query.brandId === 'string') {
    filters.push(eq(renewalOpportunitiesTable.brandId, req.query.brandId));
  }

  const today = toDateOnly(new Date())!;
  const bucket = typeof req.query.bucket === 'string' ? req.query.bucket : null;
  if (bucket === 'this_month') {
    const eom = new Date();
    eom.setUTCMonth(eom.getUTCMonth() + 1, 0);
    filters.push(sql`${renewalOpportunitiesTable.noticeDeadline} <= ${toDateOnly(eom)}`);
    filters.push(sql`${renewalOpportunitiesTable.noticeDeadline} >= ${today}`);
  } else if (bucket === 'next_90') {
    const horizon = addDays(new Date(), 90);
    filters.push(sql`${renewalOpportunitiesTable.noticeDeadline} <= ${toDateOnly(horizon)}`);
    filters.push(sql`${renewalOpportunitiesTable.noticeDeadline} >= ${today}`);
  } else if (bucket === 'risk') {
    filters.push(sql`${renewalOpportunitiesTable.riskScore} >= 70`);
  }

  // Brand-Scope
  if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
    const allowB = await allowedBrandIds(req);
    if (allowB.length > 0) {
      filters.push(sql`(${renewalOpportunitiesTable.brandId} is null or ${renewalOpportunitiesTable.brandId} = any(${allowB}))`);
    } else {
      filters.push(sql`${renewalOpportunitiesTable.brandId} is null`);
    }
  }

  const rows = await db.select().from(renewalOpportunitiesTable)
    .where(and(...filters))
    .orderBy(asc(renewalOpportunitiesTable.noticeDeadline));

  // Account-Scope filtern (verträge ohne sichtbaren Account ausblenden)
  const allAccIds = Array.from(new Set(rows.map(r => r.accountId)));
  const visAcc = new Set<string>();
  for (const aid of allAccIds) {
    const s = await entityScopeStatus(req, 'account', aid);
    if (s === 'ok') visAcc.add(aid);
  }
  const visible = rows.filter(r => visAcc.has(r.accountId));

  const [accs, brands, contractsRows] = await Promise.all([
    getAccountMap(),
    getBrandMap(),
    visible.length === 0 ? Promise.resolve([] as Array<typeof contractsTable.$inferSelect>)
      : db.select().from(contractsTable).where(inArray(contractsTable.id, visible.map(r => r.contractId))),
  ]);
  const contracts = new Map(contractsRows.map(c => [c.id, c]));

  const out = await Promise.all(visible.map(r => mapRenewal(r, { accs, brands, contracts })));
  res.json(out);
});

// GET /renewals/summary — KPI für Reports-Cockpit
router.get('/renewals/_summary', async (req, res) => {
  const scope = getScope(req);
  const filters: SQL[] = [
    eq(renewalOpportunitiesTable.tenantId, scope.tenantId),
    eq(renewalOpportunitiesTable.status, 'open'),
  ];
  if (!scope.tenantWide || hasActiveScopeFilter(scope)) {
    const allowB = await allowedBrandIds(req);
    if (allowB.length > 0) {
      filters.push(sql`(${renewalOpportunitiesTable.brandId} is null or ${renewalOpportunitiesTable.brandId} = any(${allowB}))`);
    } else {
      filters.push(sql`${renewalOpportunitiesTable.brandId} is null`);
    }
  }
  const rows = await db.select().from(renewalOpportunitiesTable).where(and(...filters));

  // Account-Scope filtern
  const allAccIds = Array.from(new Set(rows.map(r => r.accountId)));
  const visAcc = new Set<string>();
  for (const aid of allAccIds) {
    const s = await entityScopeStatus(req, 'account', aid);
    if (s === 'ok') visAcc.add(aid);
  }
  const visible = rows.filter(r => visAcc.has(r.accountId));

  const today = new Date();
  const eom = new Date();
  eom.setUTCMonth(eom.getUTCMonth() + 1, 0);
  const next90 = addDays(today, 90);

  const sumValue = (xs: typeof visible) =>
    xs.reduce((s, r) => s + (r.valueAmount == null ? 0 : Number(r.valueAmount)), 0);

  const inThisMonth = visible.filter(r => r.noticeDeadline <= toDateOnly(eom)! && r.noticeDeadline >= toDateOnly(today)!);
  const inNext90 = visible.filter(r => r.noticeDeadline <= toDateOnly(next90)! && r.noticeDeadline >= toDateOnly(today)!);
  const atRisk = visible.filter(r => r.riskScore >= 70);

  res.json({
    totalOpen: visible.length,
    pipelineValue: sumValue(visible),
    thisMonth: { count: inThisMonth.length, value: sumValue(inThisMonth) },
    next90: { count: inNext90.length, value: sumValue(inNext90) },
    atRisk: { count: atRisk.length, value: sumValue(atRisk) },
  });
});

// GET /renewals/:id
router.get('/renewals/:id', async (req, res) => {
  const row = await loadVisibleRenewal(req, req.params.id);
  if (!row) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json(await mapRenewal(row));
});

// POST /renewals/run — Tenant-Admin Trigger
router.post('/renewals/run', async (req, res) => {
  if (!isTenantAdmin(req)) {
    res.status(403).json({ error: 'tenant admin required' });
    return;
  }
  const scope = getScope(req);
  try {
    const result = await materializeRenewalsForTenant(scope.tenantId);
    await writeAuditFromReq(req, {
      entityType: 'tenant',
      entityId: scope.tenantId,
      action: 'renewal_run',
      summary: `Renewal-Engine ausgeführt: ${result.created} neu, ${result.updated} aktualisiert, ${result.dueSoon} fällig`,
      actor: scope.user?.name,
      after: result,
    });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, 'renewal materialization failed');
    res.status(500).json({ error: 'renewal run failed' });
  }
});

// PATCH /renewals/:id — snooze / status ändern
const RenewalPatchBody = z.object({
  status: z.enum(['open','snoozed','won','lost','cancelled']).optional(),
  snoozedUntil: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

router.patch('/renewals/:id', async (req, res) => {
  const scope = getScope(req);
  const existing = await loadVisibleRenewal(req, req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  const parsed = RenewalPatchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid request', details: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  const patch: Partial<typeof renewalOpportunitiesTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (b.status !== undefined) {
    patch.status = b.status;
    if (b.status !== 'open' && b.status !== 'snoozed') {
      patch.decidedAt = new Date();
      patch.decidedBy = scope.user?.id ?? null;
    }
  }
  if (b.snoozedUntil !== undefined) patch.snoozedUntil = b.snoozedUntil;
  if (b.notes !== undefined) patch.notes = b.notes;

  await db.update(renewalOpportunitiesTable)
    .set(patch)
    .where(eq(renewalOpportunitiesTable.id, existing.id));
  const [after] = await db.select().from(renewalOpportunitiesTable)
    .where(eq(renewalOpportunitiesTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'renewal_opportunity',
    entityId: existing.id,
    action: 'update',
    summary: `Renewal-Status: ${existing.status} → ${after.status}`,
    actor: scope.user?.name,
    before: existing,
    after,
  });
  res.json(await mapRenewal(after));
});

// =============================================================================
// Brand-spezifische Klausel-Varianten + Kompatibilitäts-Regeln (Task #68)
// =============================================================================

type ResolvedVariant = {
  id: string;
  familyId: string;
  name: string;
  summary: string;
  body: string;
  tone: string;
  severity: string;
  severityScore: number;
  isOverride: boolean;
  brandId: string | null;
};

async function loadBrandOverride(
  brandId: string,
  baseVariantId: string,
  tenantId: string,
): Promise<typeof brandClauseVariantOverridesTable.$inferSelect | undefined> {
  const [row] = await db.select().from(brandClauseVariantOverridesTable).where(and(
    eq(brandClauseVariantOverridesTable.tenantId, tenantId),
    eq(brandClauseVariantOverridesTable.brandId, brandId),
    eq(brandClauseVariantOverridesTable.baseVariantId, baseVariantId),
  ));
  return row;
}

function applyOverride(
  base: typeof clauseVariantsTable.$inferSelect,
  ov: typeof brandClauseVariantOverridesTable.$inferSelect | undefined,
  brandId: string | null,
): ResolvedVariant {
  return {
    id: base.id,
    familyId: base.familyId,
    name: ov?.name ?? base.name,
    summary: ov?.summary ?? base.summary,
    body: ov?.body ?? base.body,
    tone: ov?.tone ?? base.tone,
    severity: ov?.severity ?? base.severity,
    severityScore: ov?.severityScore ?? base.severityScore,
    isOverride: !!ov,
    brandId,
  };
}

async function resolveVariantForBrand(
  variantId: string,
  brandId: string | null,
  tenantId: string,
): Promise<ResolvedVariant | null> {
  const [base] = await db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, variantId));
  if (!base) return null;
  if (!brandId) return applyOverride(base, undefined, null);
  const ov = await loadBrandOverride(brandId, variantId, tenantId);
  return applyOverride(base, ov, brandId);
}

function severityLabelFromScore(score: number): string {
  return score <= 2 ? 'high' : score === 3 ? 'medium' : 'low';
}

function mapBrandClauseOverride(row: typeof brandClauseVariantOverridesTable.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    brandId: row.brandId,
    baseVariantId: row.baseVariantId,
    name: row.name ?? null,
    summary: row.summary ?? null,
    body: row.body ?? null,
    tone: row.tone ?? null,
    severity: row.severity ?? null,
    severityScore: row.severityScore ?? null,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as unknown as string)).toISOString(),
    updatedAt: (row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt as unknown as string)).toISOString(),
  };
}

function mapClauseCompatibilityRule(row: typeof clauseVariantCompatibilityTable.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    fromVariantId: row.fromVariantId,
    toVariantId: row.toVariantId,
    kind: row.kind as 'requires' | 'conflicts',
    note: row.note ?? null,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as unknown as string)).toISOString(),
  };
}

// --- GET /brands/:brandId/clause-overrides --------------------------------
router.get('/brands/:brandId/clause-overrides', async (req, res) => {
  const scope = getScope(req);
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, req.params.brandId));
  if (!brand) { res.status(404).json({ error: 'brand not found' }); return; }
  if (!(await brandVisible(req, brand))) { res.status(403).json({ error: 'forbidden' }); return; }
  const rows = await db.select().from(brandClauseVariantOverridesTable).where(and(
    eq(brandClauseVariantOverridesTable.tenantId, scope.tenantId),
    eq(brandClauseVariantOverridesTable.brandId, brand.id),
  ));
  res.json(rows.map(mapBrandClauseOverride));
});

// --- PUT /brands/:brandId/clause-overrides/:baseVariantId (upsert) --------
router.put('/brands/:brandId/clause-overrides/:baseVariantId', async (req, res) => {
  const scope = getScope(req);
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, req.params.brandId));
  if (!brand) { res.status(404).json({ error: 'brand not found' }); return; }
  if (!(await brandVisible(req, brand))) { res.status(403).json({ error: 'forbidden' }); return; }
  if (!isTenantAdmin(req)) { res.status(403).json({ error: 'tenant admin required' }); return; }
  const [base] = await db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, req.params.baseVariantId));
  if (!base) { res.status(400).json({ error: 'base variant not found' }); return; }
  const body = (req.body ?? {}) as {
    name?: string | null;
    summary?: string | null;
    body?: string | null;
    tone?: string | null;
    severity?: string | null;
    severityScore?: number | null;
  };
  let sevScore: number | null = null;
  if (body.severityScore != null) {
    const raw = Number(body.severityScore);
    if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1 || raw > 5) {
      res.status(400).json({ error: 'severityScore must be an integer 1..5' }); return;
    }
    sevScore = raw;
  }
  if (body.severity != null && body.severity !== '' && !['low', 'medium', 'high'].includes(body.severity)) {
    res.status(400).json({ error: "severity must be one of 'low' | 'medium' | 'high'" }); return;
  }
  const existing = await loadBrandOverride(brand.id, base.id, scope.tenantId);
  const now = new Date();
  if (existing) {
    // PATCH-Semantik: nur Felder, die explizit im Body stehen, werden geschrieben.
    const updates: Partial<typeof brandClauseVariantOverridesTable.$inferInsert> = { updatedAt: now };
    if ('name' in body) updates.name = body.name ?? null;
    if ('summary' in body) updates.summary = body.summary ?? null;
    if ('body' in body) updates.body = body.body ?? null;
    if ('tone' in body) updates.tone = body.tone ?? null;
    if ('severity' in body) updates.severity = body.severity ?? null;
    if ('severityScore' in body) updates.severityScore = sevScore;
    await db.update(brandClauseVariantOverridesTable).set(updates)
      .where(eq(brandClauseVariantOverridesTable.id, existing.id));
    await writeAuditFromReq(req, {
      entityType: 'brand', entityId: brand.id, action: 'clause_override_updated',
      summary: `Brand-Override aktualisiert: ${base.name}`,
      before: { name: existing.name, summary: existing.summary, body: existing.body, tone: existing.tone, severity: existing.severity, severityScore: existing.severityScore },
      after: { name: body.name ?? null, summary: body.summary ?? null, body: body.body ?? null, tone: body.tone ?? null, severity: body.severity ?? null, severityScore: sevScore },
    });
  } else {
    const id = `bco_${randomUUID().slice(0, 12)}`;
    await db.insert(brandClauseVariantOverridesTable).values({
      id,
      tenantId: scope.tenantId,
      brandId: brand.id,
      baseVariantId: base.id,
      name: body.name ?? null,
      summary: body.summary ?? null,
      body: body.body ?? null,
      tone: body.tone ?? null,
      severity: body.severity ?? null,
      severityScore: sevScore,
    });
    await writeAuditFromReq(req, {
      entityType: 'brand', entityId: brand.id, action: 'clause_override_created',
      summary: `Brand-Override angelegt: ${base.name}`,
      after: { id, baseVariantId: base.id, name: body.name ?? null },
    });
  }
  const after = await loadBrandOverride(brand.id, base.id, scope.tenantId);
  res.json(mapBrandClauseOverride(after!));
});

// --- DELETE /brands/:brandId/clause-overrides/:baseVariantId --------------
router.delete('/brands/:brandId/clause-overrides/:baseVariantId', async (req, res) => {
  const scope = getScope(req);
  const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, req.params.brandId));
  if (!brand) { res.status(404).json({ error: 'brand not found' }); return; }
  if (!(await brandVisible(req, brand))) { res.status(403).json({ error: 'forbidden' }); return; }
  if (!isTenantAdmin(req)) { res.status(403).json({ error: 'tenant admin required' }); return; }
  const existing = await loadBrandOverride(brand.id, req.params.baseVariantId, scope.tenantId);
  if (!existing) { res.status(404).json({ error: 'override not found' }); return; }
  await db.delete(brandClauseVariantOverridesTable).where(eq(brandClauseVariantOverridesTable.id, existing.id));
  await writeAuditFromReq(req, {
    entityType: 'brand', entityId: brand.id, action: 'clause_override_deleted',
    summary: `Brand-Override gelöscht: ${existing.baseVariantId}`,
    before: { id: existing.id, baseVariantId: existing.baseVariantId },
  });
  res.status(204).end();
});

// --- GET /clause-compatibility -------------------------------------------
router.get('/clause-compatibility', async (req, res) => {
  const scope = getScope(req);
  const rows = await db.select().from(clauseVariantCompatibilityTable)
    .where(eq(clauseVariantCompatibilityTable.tenantId, scope.tenantId));
  res.json(rows.map(mapClauseCompatibilityRule));
});

// --- POST /clause-compatibility ------------------------------------------
router.post('/clause-compatibility', async (req, res) => {
  if (!isTenantAdmin(req)) { res.status(403).json({ error: 'tenant admin required' }); return; }
  const scope = getScope(req);
  const body = (req.body ?? {}) as { fromVariantId?: string; toVariantId?: string; kind?: string; note?: string | null };
  const fromVariantId = typeof body.fromVariantId === 'string' ? body.fromVariantId : '';
  const toVariantId = typeof body.toVariantId === 'string' ? body.toVariantId : '';
  const kind = body.kind === 'requires' || body.kind === 'conflicts' ? body.kind : null;
  if (!fromVariantId || !toVariantId || !kind) {
    res.status(400).json({ error: 'fromVariantId, toVariantId and kind (requires|conflicts) are required' }); return;
  }
  if (fromVariantId === toVariantId) {
    res.status(400).json({ error: 'fromVariantId and toVariantId must differ' }); return;
  }
  const [fromV] = await db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, fromVariantId));
  const [toV] = await db.select().from(clauseVariantsTable).where(eq(clauseVariantsTable.id, toVariantId));
  if (!fromV || !toV) { res.status(400).json({ error: 'variant not found' }); return; }
  const id = `ccr_${randomUUID().slice(0, 12)}`;
  try {
    await db.insert(clauseVariantCompatibilityTable).values({
      id,
      tenantId: scope.tenantId,
      fromVariantId,
      toVariantId,
      kind,
      note: body.note ?? null,
    });
  } catch {
    res.status(409).json({ error: 'duplicate rule' }); return;
  }
  await writeAuditFromReq(req, {
    entityType: 'clause_compatibility', entityId: id, action: 'created',
    summary: `Kompatibilitäts-Regel: ${fromV.name} ${kind} ${toV.name}`,
    after: { id, fromVariantId, toVariantId, kind, note: body.note ?? null },
  });
  const [after] = await db.select().from(clauseVariantCompatibilityTable).where(eq(clauseVariantCompatibilityTable.id, id));
  res.status(201).json(mapClauseCompatibilityRule(after!));
});

// --- DELETE /clause-compatibility/:id ------------------------------------
router.delete('/clause-compatibility/:id', async (req, res) => {
  if (!isTenantAdmin(req)) { res.status(403).json({ error: 'tenant admin required' }); return; }
  const scope = getScope(req);
  const [row] = await db.select().from(clauseVariantCompatibilityTable).where(and(
    eq(clauseVariantCompatibilityTable.id, req.params.id),
    eq(clauseVariantCompatibilityTable.tenantId, scope.tenantId),
  ));
  if (!row) { res.status(404).json({ error: 'not found' }); return; }
  await db.delete(clauseVariantCompatibilityTable).where(eq(clauseVariantCompatibilityTable.id, row.id));
  await writeAuditFromReq(req, {
    entityType: 'clause_compatibility', entityId: row.id, action: 'deleted',
    summary: `Kompatibilitäts-Regel entfernt`,
    before: { id: row.id, fromVariantId: row.fromVariantId, toVariantId: row.toVariantId, kind: row.kind },
  });
  res.status(204).end();
});

// --- GET /contracts/:id/clauses/_compatibility ---------------------------
router.get('/contracts/:id/clauses/_compatibility', async (req, res) => {
  const scope = getScope(req);
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, c.dealId))) return;

  const clauses = await db.select().from(contractClausesTable).where(eq(contractClausesTable.contractId, c.id));
  const activeVariantIds = clauses.map(cl => cl.activeVariantId).filter((x): x is string => !!x);
  if (activeVariantIds.length === 0) {
    res.json({ contractId: c.id, items: [] });
    return;
  }
  const rules = await db.select().from(clauseVariantCompatibilityTable).where(and(
    eq(clauseVariantCompatibilityTable.tenantId, scope.tenantId),
    inArray(clauseVariantCompatibilityTable.fromVariantId, activeVariantIds),
  ));
  // Map active variant -> family
  const variants = await db.select().from(clauseVariantsTable);
  const variantById = new Map(variants.map(v => [v.id, v]));
  const familyById = new Map(
    (await db.select().from(clauseFamiliesTable)).map(f => [f.id, f]),
  );
  const activeVarIds = new Set(activeVariantIds);

  const items = clauses.map(cl => {
    const conflicts: Array<{ withVariantId: string; withVariantName: string; withFamilyId: string; withFamilyName: string; note: string | null }> = [];
    const requiresOpen: Array<{ requiredVariantId: string; requiredVariantName: string; requiredFamilyId: string; requiredFamilyName: string; note: string | null }> = [];
    const requiresOk: Array<{ requiredVariantId: string; requiredVariantName: string; note: string | null }> = [];

    if (cl.activeVariantId) {
      for (const r of rules) {
        if (r.fromVariantId !== cl.activeVariantId) continue;
        const targetV = variantById.get(r.toVariantId);
        if (!targetV) continue;
        const targetF = familyById.get(targetV.familyId);
        if (r.kind === 'conflicts') {
          if (activeVarIds.has(r.toVariantId)) {
            conflicts.push({
              withVariantId: r.toVariantId,
              withVariantName: targetV.name,
              withFamilyId: targetV.familyId,
              withFamilyName: targetF?.name ?? targetV.familyId,
              note: r.note ?? null,
            });
          }
        } else if (r.kind === 'requires') {
          if (activeVarIds.has(r.toVariantId)) {
            requiresOk.push({
              requiredVariantId: r.toVariantId,
              requiredVariantName: targetV.name,
              note: r.note ?? null,
            });
          } else {
            requiresOpen.push({
              requiredVariantId: r.toVariantId,
              requiredVariantName: targetV.name,
              requiredFamilyId: targetV.familyId,
              requiredFamilyName: targetF?.name ?? targetV.familyId,
              note: r.note ?? null,
            });
          }
        }
      }
    }
    const status: 'ok' | 'warning' | 'conflict' =
      conflicts.length > 0 ? 'conflict' : (requiresOpen.length > 0 ? 'warning' : 'ok');
    return {
      contractClauseId: cl.id,
      familyId: cl.familyId ?? null,
      familyName: cl.family,
      activeVariantId: cl.activeVariantId ?? null,
      activeVariantName: cl.variant,
      status,
      conflicts,
      requiresOpen,
      requiresOk,
    };
  });

  res.json({ contractId: c.id, items });
});

// =========================================================================
// Magic-Link-Zugang fuer externe Anwaelte / Berater (Task #70)
// =========================================================================

const COLLAB_CAPABILITIES = ['view', 'comment', 'sign_party'] as const;
type CollabCapability = typeof COLLAB_CAPABILITIES[number];

function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

function generateCollabToken(): string {
  // 32 zufaellige Bytes -> 64 hex chars. Kombiniert mit Hash-Lookup
  // (uniqueIndex auf token_hash) ist das Brute-Force-resistent.
  return randomBytes(32).toString('hex');
}

function isEmail(s: unknown): s is string {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normaliseCapabilities(input: unknown): CollabCapability[] | null {
  if (!Array.isArray(input)) return null;
  const set = new Set<CollabCapability>();
  for (const v of input) {
    if (typeof v !== 'string') return null;
    if (!(COLLAB_CAPABILITIES as readonly string[]).includes(v)) return null;
    set.add(v as CollabCapability);
  }
  if (set.size === 0) return null;
  // 'view' is implicit — always include.
  set.add('view');
  return Array.from(set);
}

function mapCollab(
  row: typeof externalCollaboratorsTable.$inferSelect,
  opts: { tokenPlaintext?: string } = {},
) {
  const now = Date.now();
  const expired = row.expiresAt.getTime() <= now;
  const revoked = row.revokedAt != null;
  const status = revoked ? 'revoked' : (expired ? 'expired' : 'active');
  return {
    id: row.id,
    contractId: row.contractId,
    email: row.email,
    name: row.name ?? null,
    organization: row.organization ?? null,
    capabilities: row.capabilities,
    status,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    revokedBy: row.revokedBy ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    // Plaintext only ever returned at create-time.
    tokenPlaintext: opts.tokenPlaintext ?? null,
  };
}

/**
 * Lade Vertrag, wenn der aktuelle Request-User berechtigt ist (Tenant + Scope).
 * Liefert null bei not-found ODER cross-tenant ODER ausserhalb des aktiven
 * Scope-Filters. Cross-tenant leakt absichtlich als 404 statt 403.
 */
async function loadContractForCollab(
  req: Request,
  contractId: string,
): Promise<typeof contractsTable.$inferSelect | null> {
  const [c] = await db.select().from(contractsTable)
    .where(eq(contractsTable.id, contractId));
  if (!c) return null;
  const dealAllowed = await allowedDealIds(req);
  if (!dealAllowed.has(c.dealId)) return null;
  return c;
}

async function recordCollabEvent(
  collab: typeof externalCollaboratorsTable.$inferSelect,
  action: string,
  payload: Record<string, unknown>,
  req?: Request,
): Promise<void> {
  await db.insert(externalCollaboratorEventsTable).values({
    id: `ece_${randomUUID().slice(0, 12)}`,
    tenantId: collab.tenantId,
    collaboratorId: collab.id,
    contractId: collab.contractId,
    action,
    payload,
    ipAddress: req?.ip ?? null,
    userAgent: typeof req?.headers?.['user-agent'] === 'string'
      ? (req.headers['user-agent'] as string).slice(0, 256)
      : null,
  });
}

async function loadCollabByToken(
  plaintext: string,
): Promise<typeof externalCollaboratorsTable.$inferSelect | null> {
  if (!plaintext || plaintext.length < 16 || plaintext.length > 256) return null;
  const hash = hashToken(plaintext);
  const [row] = await db.select().from(externalCollaboratorsTable)
    .where(eq(externalCollaboratorsTable.tokenHash, hash));
  return row ?? null;
}

// --- GET /contracts/:id/external-collaborators ---------------------------
router.get('/contracts/:id/external-collaborators', async (req, res) => {
  const scope = getScope(req);
  const c = await loadContractForCollab(req, req.params.id);
  if (!c) { res.status(404).json({ error: 'contract not found' }); return; }
  const rows = await db.select().from(externalCollaboratorsTable)
    .where(and(
      eq(externalCollaboratorsTable.tenantId, scope.tenantId),
      eq(externalCollaboratorsTable.contractId, c.id),
    ))
    .orderBy(desc(externalCollaboratorsTable.createdAt));
  res.json(rows.map((r) => mapCollab(r)));
});

// --- POST /contracts/:id/external-collaborators ---------------------------
router.post('/contracts/:id/external-collaborators', async (req, res) => {
  const scope = getScope(req);
  const c = await loadContractForCollab(req, req.params.id);
  if (!c) { res.status(404).json({ error: 'contract not found' }); return; }
  const body = (req.body ?? {}) as {
    email?: unknown;
    name?: unknown;
    organization?: unknown;
    capabilities?: unknown;
    expiresInDays?: unknown;
  };
  if (!isEmail(body.email)) {
    res.status(400).json({ error: 'email must be a valid e-mail address' }); return;
  }
  const caps = normaliseCapabilities(body.capabilities);
  if (!caps) {
    res.status(400).json({
      error: `capabilities must be a non-empty array of: ${COLLAB_CAPABILITIES.join(', ')}`,
    }); return;
  }
  const days = Number(body.expiresInDays ?? 14);
  if (!Number.isFinite(days) || !Number.isInteger(days) || days < 1 || days > 90) {
    res.status(400).json({ error: 'expiresInDays must be an integer between 1 and 90' }); return;
  }
  const email = String(body.email).trim().toLowerCase();
  const [existing] = await db.select().from(externalCollaboratorsTable)
    .where(and(
      eq(externalCollaboratorsTable.contractId, c.id),
      eq(externalCollaboratorsTable.email, email),
    ));
  if (existing && !existing.revokedAt) {
    res.status(409).json({ error: 'collaborator with this email already active for this contract' });
    return;
  }
  const tokenPlaintext = generateCollabToken();
  const tokenHash = hashToken(tokenPlaintext);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const id = `ec_${randomUUID().slice(0, 12)}`;
  await db.insert(externalCollaboratorsTable).values({
    id,
    tenantId: scope.tenantId,
    contractId: c.id,
    email,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 200) : null,
    organization: typeof body.organization === 'string' && body.organization.trim() ? body.organization.trim().slice(0, 200) : null,
    capabilities: caps,
    tokenHash,
    expiresAt,
    createdBy: scope.user.id,
  });
  const [row] = await db.select().from(externalCollaboratorsTable)
    .where(eq(externalCollaboratorsTable.id, id));
  await recordCollabEvent(row!, 'created', { email, capabilities: caps, expiresAt: expiresAt.toISOString() }, req);
  await writeAuditFromReq(req, {
    entityType: 'contract', entityId: c.id, action: 'external_collaborator_created',
    summary: `Magic-Link erstellt für ${email}`,
    after: { collaboratorId: id, capabilities: caps, expiresAt: expiresAt.toISOString() },
  });
  res.status(201).json(mapCollab(row!, { tokenPlaintext }));
});

// --- DELETE /external-collaborators/:id (revoke) -------------------------
router.delete('/external-collaborators/:id', async (req, res) => {
  const scope = getScope(req);
  const [collab] = await db.select().from(externalCollaboratorsTable)
    .where(and(
      eq(externalCollaboratorsTable.id, req.params.id),
      eq(externalCollaboratorsTable.tenantId, scope.tenantId),
    ));
  if (!collab) { res.status(404).json({ error: 'collaborator not found' }); return; }
  const c = await loadContractForCollab(req, collab.contractId);
  if (!c) { res.status(404).json({ error: 'contract not found' }); return; }
  if (collab.revokedAt) {
    res.json(mapCollab(collab)); return;
  }
  const now = new Date();
  await db.update(externalCollaboratorsTable)
    .set({ revokedAt: now, revokedBy: scope.user.id })
    .where(eq(externalCollaboratorsTable.id, collab.id));
  const [row] = await db.select().from(externalCollaboratorsTable)
    .where(eq(externalCollaboratorsTable.id, collab.id));
  await recordCollabEvent(row!, 'revoked', { revokedBy: scope.user.id }, req);
  await writeAuditFromReq(req, {
    entityType: 'contract', entityId: c.id, action: 'external_collaborator_revoked',
    summary: `Magic-Link widerrufen für ${collab.email}`,
    after: { collaboratorId: collab.id },
  });
  res.json(mapCollab(row!));
});

// --- GET /contracts/:id/comments -----------------------------------------
router.get('/contracts/:id/comments', async (req, res) => {
  const c = await loadContractForCollab(req, req.params.id);
  if (!c) { res.status(404).json({ error: 'contract not found' }); return; }
  const rows = await db.select().from(contractCommentsTable)
    .where(eq(contractCommentsTable.contractId, c.id))
    .orderBy(asc(contractCommentsTable.createdAt));
  res.json(rows.map((r) => ({
    id: r.id,
    contractId: r.contractId,
    contractClauseId: r.contractClauseId ?? null,
    authorType: r.authorType,
    authorName: r.authorName,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  })));
});

// --- POST /contracts/:id/comments (interner User) ------------------------
router.post('/contracts/:id/comments', async (req, res) => {
  const scope = getScope(req);
  const c = await loadContractForCollab(req, req.params.id);
  if (!c) { res.status(404).json({ error: 'contract not found' }); return; }
  const body = (req.body ?? {}) as { body?: unknown; contractClauseId?: unknown };
  if (typeof body.body !== 'string' || body.body.trim().length === 0 || body.body.length > 4000) {
    res.status(400).json({ error: 'body must be a non-empty string up to 4000 chars' }); return;
  }
  const id = `cmt_${randomUUID().slice(0, 12)}`;
  await db.insert(contractCommentsTable).values({
    id,
    tenantId: scope.tenantId,
    contractId: c.id,
    authorType: 'user',
    authorUserId: scope.user.id,
    authorName: scope.user.name,
    body: body.body.trim(),
    contractClauseId: typeof body.contractClauseId === 'string' ? body.contractClauseId : null,
  });
  const [row] = await db.select().from(contractCommentsTable).where(eq(contractCommentsTable.id, id));
  res.status(201).json({
    id: row!.id,
    contractId: row!.contractId,
    contractClauseId: row!.contractClauseId ?? null,
    authorType: row!.authorType,
    authorName: row!.authorName,
    body: row!.body,
    createdAt: row!.createdAt.toISOString(),
  });
});

// =========================================================================
// PUBLIC (No-Auth) ROUTES — bypassed via PUBLIC_PREFIXES in auth middleware.
// All authorization happens via token-hash lookup + revoked/expired checks.
// =========================================================================

// --- GET /external/:token (resolve magic-link) ---------------------------
router.get('/external/:token', async (req, res) => {
  const collab = await loadCollabByToken(req.params.token);
  if (!collab) { res.status(404).json({ error: 'invalid token' }); return; }
  const now = Date.now();
  if (collab.revokedAt) {
    await recordCollabEvent(collab, 'expired_attempt', { reason: 'revoked' }, req);
    res.status(401).json({ error: 'token revoked' }); return;
  }
  if (collab.expiresAt.getTime() <= now) {
    await recordCollabEvent(collab, 'expired_attempt', { reason: 'expired' }, req);
    res.status(401).json({ error: 'token expired' }); return;
  }
  const [c] = await db.select().from(contractsTable)
    .where(eq(contractsTable.id, collab.contractId));
  if (!c) { res.status(404).json({ error: 'contract not found' }); return; }
  // Defense-in-depth: Token bindet contractId, aber wenn ein Tenant-Drift
  // entstuende (z. B. durch Datenmigration), wuerden wir cross-tenant Daten
  // leaken. deals.companyId -> companies.tenantId scopen.
  const tenantRow = await db
    .select({ tenantId: companiesTable.tenantId })
    .from(dealsTable)
    .innerJoin(companiesTable, eq(dealsTable.companyId, companiesTable.id))
    .where(eq(dealsTable.id, c.dealId));
  if (!tenantRow[0] || tenantRow[0].tenantId !== collab.tenantId) {
    res.status(404).json({ error: 'contract not found' }); return;
  }
  // Brand fuer Branding (Logo/Tone). Optional — Vertraege ohne Brand sind ok.
  let brandSnapshot: { id: string; name: string; primaryColor: string | null; logoUrl: string | null } | null = null;
  if (c.brandId) {
    const [b] = await db.select().from(brandsTable).where(eq(brandsTable.id, c.brandId));
    if (b) {
      brandSnapshot = { id: b.id, name: b.name, primaryColor: b.primaryColor ?? null, logoUrl: b.logoUrl ?? null };
    }
  }
  const clauses = await db.select().from(contractClausesTable)
    .where(eq(contractClausesTable.contractId, c.id))
    .orderBy(asc(contractClausesTable.family));
  const comments = await db.select().from(contractCommentsTable)
    .where(eq(contractCommentsTable.contractId, c.id))
    .orderBy(asc(contractCommentsTable.createdAt));
  await db.update(externalCollaboratorsTable).set({ lastUsedAt: new Date() })
    .where(eq(externalCollaboratorsTable.id, collab.id));
  await recordCollabEvent(collab, 'viewed', {}, req);
  res.json({
    collaborator: {
      id: collab.id,
      email: collab.email,
      name: collab.name ?? null,
      organization: collab.organization ?? null,
      capabilities: collab.capabilities,
      expiresAt: collab.expiresAt.toISOString(),
    },
    contract: {
      id: c.id,
      title: c.title,
      status: c.status,
      template: c.template,
      currency: c.currency,
      effectiveFrom: c.effectiveFrom,
      effectiveTo: c.effectiveTo,
      governingLaw: c.governingLaw,
      jurisdiction: c.jurisdiction,
    },
    brand: brandSnapshot,
    clauses: clauses.map((cl) => ({
      id: cl.id,
      family: cl.family,
      variant: cl.variant,
      severity: cl.severity,
      summary: cl.summary,
    })),
    comments: comments.map((cm) => ({
      id: cm.id,
      authorType: cm.authorType,
      authorName: cm.authorName,
      body: cm.body,
      contractClauseId: cm.contractClauseId ?? null,
      createdAt: cm.createdAt.toISOString(),
    })),
  });
});

// --- POST /external/:token/comments (externer Kommentar) -----------------
router.post('/external/:token/comments', async (req, res) => {
  const collab = await loadCollabByToken(req.params.token);
  if (!collab) { res.status(404).json({ error: 'invalid token' }); return; }
  const now = Date.now();
  if (collab.revokedAt) { res.status(401).json({ error: 'token revoked' }); return; }
  if (collab.expiresAt.getTime() <= now) { res.status(401).json({ error: 'token expired' }); return; }
  if (!collab.capabilities.includes('comment')) {
    res.status(403).json({ error: 'comment capability missing' }); return;
  }
  const body = (req.body ?? {}) as { body?: unknown; contractClauseId?: unknown };
  if (typeof body.body !== 'string' || body.body.trim().length === 0 || body.body.length > 4000) {
    res.status(400).json({ error: 'body must be a non-empty string up to 4000 chars' }); return;
  }
  const id = `cmt_${randomUUID().slice(0, 12)}`;
  const authorName = collab.name?.trim() || collab.email;
  await db.insert(contractCommentsTable).values({
    id,
    tenantId: collab.tenantId,
    contractId: collab.contractId,
    authorType: 'external',
    externalCollaboratorId: collab.id,
    authorName,
    body: body.body.trim(),
    contractClauseId: typeof body.contractClauseId === 'string' ? body.contractClauseId : null,
  });
  await db.update(externalCollaboratorsTable).set({ lastUsedAt: new Date() })
    .where(eq(externalCollaboratorsTable.id, collab.id));
  await recordCollabEvent(collab, 'commented', { commentId: id, length: body.body.length }, req);
  const [row] = await db.select().from(contractCommentsTable).where(eq(contractCommentsTable.id, id));
  res.status(201).json({
    id: row!.id,
    contractId: row!.contractId,
    contractClauseId: row!.contractClauseId ?? null,
    authorType: row!.authorType,
    authorName: row!.authorName,
    body: row!.body,
    createdAt: row!.createdAt.toISOString(),
  });
});

// =============================================================================
// AI-Empfehlungen: Liste, Patch, Metrics (Task #69)
// =============================================================================

const AI_REC_STATUS = new Set(['pending', 'accepted', 'rejected', 'modified']);

function mapRecommendation(r: typeof aiRecommendationsTable.$inferSelect) {
  return {
    id: r.id,
    promptKey: r.promptKey,
    entityType: r.entityType,
    entityId: r.entityId,
    suggestion: r.suggestion,
    confidence: Number(r.confidence),
    status: r.status,
    modifiedSuggestion: r.modifiedSuggestion ?? null,
    feedbackText: r.feedbackText ?? null,
    decidedBy: r.decidedBy ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    aiInvocationId: r.aiInvocationId ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get('/ai-recommendations', async (req, res) => {
  const scope = getScope(req);
  const entityType = typeof req.query['entityType'] === 'string' ? req.query['entityType'] : undefined;
  const entityId = typeof req.query['entityId'] === 'string' ? req.query['entityId'] : undefined;
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : undefined;
  const promptKey = typeof req.query['promptKey'] === 'string' ? req.query['promptKey'] : undefined;
  if (status && !AI_REC_STATUS.has(status)) {
    res.status(400).json({ error: `status must be one of: ${[...AI_REC_STATUS].join(', ')}` });
    return;
  }
  const conds = [eq(aiRecommendationsTable.tenantId, scope.tenantId)];
  if (entityType) conds.push(eq(aiRecommendationsTable.entityType, entityType));
  if (entityId) conds.push(eq(aiRecommendationsTable.entityId, entityId));
  if (status) conds.push(eq(aiRecommendationsTable.status, status));
  if (promptKey) conds.push(eq(aiRecommendationsTable.promptKey, promptKey));
  const rows = await db.select().from(aiRecommendationsTable)
    .where(and(...conds))
    .orderBy(desc(aiRecommendationsTable.createdAt))
    .limit(200);
  res.json(rows.map(mapRecommendation));
});

router.patch('/ai-recommendations/:id', async (req, res) => {
  const scope = getScope(req);
  const [rec] = await db.select().from(aiRecommendationsTable)
    .where(and(
      eq(aiRecommendationsTable.id, req.params.id),
      eq(aiRecommendationsTable.tenantId, scope.tenantId),
    ));
  if (!rec) { res.status(404).json({ error: 'recommendation not found' }); return; }
  const body = (req.body ?? {}) as {
    status?: unknown;
    modifiedSuggestion?: unknown;
    feedback?: unknown;
  };
  if (typeof body.status !== 'string' || !AI_REC_STATUS.has(body.status)) {
    res.status(400).json({ error: `status must be one of: ${[...AI_REC_STATUS].join(', ')}` });
    return;
  }
  const newStatus = body.status as 'pending' | 'accepted' | 'rejected' | 'modified';
  if (newStatus === 'modified' && body.modifiedSuggestion === undefined) {
    res.status(400).json({ error: 'status=modified requires modifiedSuggestion' });
    return;
  }
  const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : null;
  if (feedback && feedback.length > 2000) {
    res.status(400).json({ error: 'feedback must be at most 2000 chars' });
    return;
  }
  await db.update(aiRecommendationsTable)
    .set({
      status: newStatus,
      modifiedSuggestion: newStatus === 'modified' ? (body.modifiedSuggestion as unknown) : null,
      feedbackText: feedback || null,
      decidedBy: scope.user.id,
      decidedAt: new Date(),
    })
    .where(eq(aiRecommendationsTable.id, rec.id));
  const [updated] = await db.select().from(aiRecommendationsTable)
    .where(eq(aiRecommendationsTable.id, rec.id));
  await writeAuditFromReq(req, {
    entityType: 'ai_recommendation', entityId: rec.id,
    action: `ai_recommendation_${newStatus}`,
    summary: `AI-Empfehlung ${newStatus} (${rec.promptKey})`,
    after: { status: newStatus, hasFeedback: Boolean(feedback) },
  });
  res.json(mapRecommendation(updated!));
});

/**
 * Metrics fuer das Admin-Dashboard "KI-Vertrauensgenauigkeit".
 * Liefert pro promptKey: count, acceptanceRate (accepted+modified/decided),
 * average confidence, sowie 4 Konfidenz-Buckets (0-25/25-50/50-75/75-100 %)
 * mit jeweiliger acceptance-rate. Ermoeglicht Kalibrierungs-Check
 * (Konfidenz korrekt = hohe Konfidenz korreliert mit hoher Acceptance).
 */
router.get('/ai-recommendations/_metrics', async (req, res) => {
  const scope = getScope(req);
  const promptKey = typeof req.query['promptKey'] === 'string' ? req.query['promptKey'] : undefined;
  const conds = [eq(aiRecommendationsTable.tenantId, scope.tenantId)];
  if (promptKey) conds.push(eq(aiRecommendationsTable.promptKey, promptKey));
  const rows = await db.select().from(aiRecommendationsTable).where(and(...conds));
  // Aggregation in JS — Datenmenge pro Tenant ist begrenzt (Index limitiert
  // typische Listen auf <10k). Bei Skalierung -> SQL-Aggregation umstellen.
  type Bucket = { range: string; total: number; accepted: number };
  const groups = new Map<string, {
    count: number;
    accepted: number;
    rejected: number;
    modified: number;
    pending: number;
    confSum: number;
    buckets: Bucket[];
  }>();
  const newGroup = () => ({
    count: 0, accepted: 0, rejected: 0, modified: 0, pending: 0, confSum: 0,
    buckets: [
      { range: '0-25', total: 0, accepted: 0 },
      { range: '25-50', total: 0, accepted: 0 },
      { range: '50-75', total: 0, accepted: 0 },
      { range: '75-100', total: 0, accepted: 0 },
    ] as Bucket[],
  });
  for (const r of rows) {
    const g = groups.get(r.promptKey) ?? newGroup();
    const conf = clampConfidence(Number(r.confidence));
    g.count += 1;
    g.confSum += conf;
    const isAccepted = r.status === 'accepted' || r.status === 'modified';
    if (r.status === 'accepted') g.accepted += 1;
    else if (r.status === 'rejected') g.rejected += 1;
    else if (r.status === 'modified') g.modified += 1;
    else g.pending += 1;
    const bIdx = conf >= 0.75 ? 3 : conf >= 0.5 ? 2 : conf >= 0.25 ? 1 : 0;
    const bucket = g.buckets[bIdx]!;
    bucket.total += 1;
    if (isAccepted) bucket.accepted += 1;
    groups.set(r.promptKey, g);
  }
  const result = [...groups.entries()].map(([key, g]) => {
    const decided = g.accepted + g.rejected + g.modified;
    return {
      promptKey: key,
      count: g.count,
      pending: g.pending,
      accepted: g.accepted,
      rejected: g.rejected,
      modified: g.modified,
      acceptanceRate: decided > 0 ? (g.accepted + g.modified) / decided : null,
      averageConfidence: g.count > 0 ? g.confSum / g.count : 0,
      calibration: g.buckets.map((b) => ({
        range: b.range,
        total: b.total,
        acceptanceRate: b.total > 0 ? b.accepted / b.total : null,
      })),
    };
  }).sort((a, b) => b.count - a.count);
  res.json(result);
});

export default router;

// Re-export helpers for type inference (no-op)
export type { Request, Response };

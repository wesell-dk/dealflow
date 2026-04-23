import { Router, type IRouter, type Request, type Response } from 'express';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ObjectStorageService } from '../lib/objectStorage';
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
  allowedDealIds,
  dealScopeSql,
  getScope,
  isAccountAllowed,
  entityInScope,
  entityScopeStatus,
  copilotThreadVisible,
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
  contractAmendmentsTable,
  amendmentClausesTable,
  rolesTable,
} from '@workspace/db';
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
import { emitEvent, WEBHOOK_EVENTS, assertSafeWebhookUrl } from '../lib/webhooks';
import { parseAsOf, resolveSnapshot } from '../lib/asOf';

const router: IRouter = Router();

const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const iso = (d: Date | string | null | undefined) =>
  d == null ? null : (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

// Helpers to map joined data
async function getUserMap() {
  const list = await db.select().from(usersTable);
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

async function dealCtx() {
  const [accs, users, brands, companies] = await Promise.all([
    getAccountMap(), getUserMap(), getBrandMap(), getCompanyMap(),
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
  const rows = await db.select().from(companiesTable).where(eq(companiesTable.tenantId, scope.tenantId));
  if (scope.tenantWide) { res.json(rows); return; }
  // Restrict: only companies in scope OR companies of explicit brand scope
  const allowedCompanyIds = new Set<string>(scope.companyIds);
  if (scope.brandIds.length) {
    const bs = await db.select().from(brandsTable).where(inArray(brandsTable.id, scope.brandIds));
    for (const b of bs) allowedCompanyIds.add(b.companyId);
  }
  res.json(rows.filter(c => allowedCompanyIds.has(c.id)));
});
router.get('/orgs/brands', async (req, res) => {
  const scope = getScope(req);
  // Tenant-bound: only brands whose company belongs to the user's tenant.
  const rows = await db
    .select({ brand: brandsTable })
    .from(brandsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
    .where(eq(companiesTable.tenantId, scope.tenantId));
  const brands = rows.map(r => r.brand);
  const visible = scope.tenantWide
    ? brands
    : brands.filter(b => scope.companyIds.includes(b.companyId) || scope.brandIds.includes(b.id));
  res.json(visible.map(mapBrand));
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
  res.json({
    id: u.id, name: u.name, email: u.email, role: u.role, scope: u.scope,
    initials: u.initials, avatarColor: u.avatarColor,
    tenantId: u.tenantId, tenantWide: scope.tenantWide,
    companyIds: scope.companyIds, brandIds: scope.brandIds,
  });
});

// ── ACCOUNTS ──
router.get('/accounts', async (req, res) => {
  const accs = await db.select().from(accountsTable);
  const allDeals = await db.select().from(dealsTable);
  const accIds = await allowedAccountIds(req);
  const visible = accs.filter(a => isAccountAllowed(accIds, a.id));
  res.json(visible.map(a => {
    const ds = allDeals.filter(d => d.accountId === a.id && d.stage !== 'won' && d.stage !== 'lost');
    return {
      ...a,
      openDeals: ds.length,
      totalValue: ds.reduce((s, d) => s + num(d.value), 0),
    };
  }));
});

router.post('/accounts', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreateAccountBody })) return;
  const body = req.body;
  const id = `acc_${randomUUID().slice(0, 8)}`;
  await db.insert(accountsTable).values({
    id, name: body.name, industry: body.industry, country: body.country,
    healthScore: 70, ownerId: getScope(req).user.id,
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
  const ds = await db.select().from(dealsTable).where(eq(dealsTable.accountId, a.id));
  const ctx = await dealCtx();
  const openDeals = ds.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  res.json({
    ...a,
    openDeals: openDeals.length,
    totalValue: openDeals.reduce((s, d) => s + num(d.value), 0),
    contacts,
    deals: await Promise.all(ds.map(d => buildDeal(d, ctx))),
  });
});

router.get('/contacts', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListContactsQueryParams })) return;
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : null;
  const accIds = await allowedAccountIds(req);
  const list = accountId
    ? await db.select().from(contactsTable).where(eq(contactsTable.accountId, accountId))
    : await db.select().from(contactsTable);
  const visible = list.filter(c => isAccountAllowed(accIds, c.accountId));
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

// ── DEALS ──
router.get('/deals', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListDealsQueryParams })) return;
  const scope = getScope(req);
  const filters = [];
  if (req.query.stage)     filters.push(eq(dealsTable.stage, String(req.query.stage)));
  if (req.query.ownerId)   filters.push(eq(dealsTable.ownerId, String(req.query.ownerId)));
  if (req.query.companyId) filters.push(eq(dealsTable.companyId, String(req.query.companyId)));
  if (req.query.brandId)   filters.push(eq(dealsTable.brandId, String(req.query.brandId)));
  const sf = dealScopeSql(scope);
  if (sf) filters.push(sf);
  const rows = await db.select().from(dealsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(dealsTable.updatedAt));
  const ctx = await dealCtx();
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
  if (!scope.tenantWide) {
    const okCompany = scope.companyIds.includes(b.companyId);
    const okBrand = scope.brandIds.includes(b.brandId);
    if (!okCompany && !okBrand) {
      res.status(403).json({ error: 'forbidden (out of scope)' }); return;
    }
  }
  const id = `dl_${randomUUID().slice(0, 8)}`;
  await db.insert(dealsTable).values({
    id, name: b.name, accountId: b.accountId, stage: b.stage, value: String(b.value),
    currency: company?.currency ?? 'EUR', probability: 30,
    expectedCloseDate: b.expectedCloseDate, ownerId: b.ownerId, brandId: b.brandId,
    companyId: b.companyId, riskLevel: 'low', nextStep: null,
  });
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
  const ctx = await dealCtx();
  res.status(201).json(await buildDeal(d!, ctx));
});

router.get('/deals/pipeline', async (req, res) => {
  const sf = dealScopeSql(getScope(req));
  const rows = await db.select().from(dealsTable).where(sf);
  const ctx = await dealCtx();
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
  const ctx = await dealCtx();
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
    approvals: approvals.map(a => mapApproval(a, base.name, ctx.users)),
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
  const ctx = await dealCtx();
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
  const b = req.body;
  if (!(await gateDeal(req, res, b.dealId))) return;
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, b.dealId));
  if (!d) { res.status(404).json({ error: 'deal not found' }); return; }
  const id = `qt_${randomUUID().slice(0, 8)}`;
  const number = `Q-2026-${Math.floor(Math.random() * 9000) + 1000}`;
  await db.insert(quotesTable).values({
    id, dealId: d.id, number, status: 'draft', currentVersion: 1,
    currency: d.currency,
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

router.get('/quotes/:id', async (req, res) => {
  if (!validateInline(req, res, { params: Z.GetQuoteParams })) return;
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, req.params.id));
  if (!q) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, q.dealId))) return;
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
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="quote-${q.number}.pdf"`);
  stream.pipe(res);
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
  void emitEvent(getScope(req).tenantId, 'quote.accepted', { quoteId: q.id, dealId: q.dealId });
  res.json(await enrichQuote(q, d?.name ?? 'Unknown'));
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
  const filtered = scope.tenantWide ? tenantRows : tenantRows.filter(p =>
    scope.companyIds.includes(p.companyId) || scope.brandIds.includes(p.brandId));
  res.json(filtered.map(p => mapPricePosition(p, brands.get(p.brandId)?.name ?? '', companies.get(p.companyId)?.name ?? '')));
});

router.post('/price-positions', async (req, res) => {
  if (!validateInline(req, res, { body: Z.CreatePricePositionBody })) return;
  const scope = getScope(req);
  const b = req.body;
  // Scope-check target brand/company unless user is tenantWide.
  if (!scope.tenantWide) {
    const brandAllowed = (await allowedBrandIds(req)).includes(b.brandId);
    const companyAllowed = scope.companyIds.includes(b.companyId);
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
  const rows = await db.select().from(priceRulesTable);
  const tenantRows = rows.filter(r =>
    r.scope === 'global' || tenantCos.has(r.scope) || tenantBrs.has(r.scope));
  if (scope.tenantWide) { res.json(tenantRows); return; }
  const allowedBrandsArr = await allowedBrandIds(req);
  const allowedScopes = new Set<string>(['global', ...scope.companyIds, ...allowedBrandsArr]);
  res.json(tenantRows.filter(r => allowedScopes.has(r.scope)));
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
  const allowedCompanies = new Set(scope.companyIds);
  const positions = scope.tenantWide
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
function mapApproval(
  a: typeof approvalsTable.$inferSelect, dealName: string,
  users: Map<string, typeof usersTable.$inferSelect>,
) {
  return {
    id: a.id, dealId: a.dealId, dealName, type: a.type, reason: a.reason,
    requestedBy: a.requestedBy, requestedByName: users.get(a.requestedBy)?.name ?? 'Unknown',
    status: a.status, priority: a.priority, createdAt: iso(a.createdAt)!,
    deadline: iso(a.deadline), impactValue: num(a.impactValue), currency: a.currency,
    decidedAt: iso(a.decidedAt), decidedBy: a.decidedBy, decisionComment: a.decisionComment,
    amendmentId: a.amendmentId,
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
  const users = await getUserMap();
  res.json(rows.map(a => mapApproval(a, dealMap.get(a.dealId)?.name ?? 'Unknown', users)));
});

router.post('/approvals/:id/decide', async (req, res) => {
  if (!validateInline(req, res, { params: Z.DecideApprovalParams, body: Z.DecideApprovalBody })) return;
  const b = req.body;
  const [pre] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, req.params.id));
  if (!pre) { res.status(404).json({ error: 'not found' }); return; }
  if (!(await gateDeal(req, res, pre.dealId))) return;
  await db.update(approvalsTable).set({
    status: b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : b.decision,
    decisionComment: b.comment ?? null, decidedAt: new Date(), decidedBy: getScope(req).user.id,
  }).where(eq(approvalsTable.id, req.params.id));
  const [a] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, req.params.id));
  if (!a) { res.status(404).json({ error: 'not found' }); return; }
  const dealMap = await getDealMap();
  const users = await getUserMap();
  void emitEvent(getScope(req).tenantId, 'approval.decided', { approvalId: a.id, dealId: a.dealId, decision: a.status });
  res.json(mapApproval(a, dealMap.get(a.dealId)?.name ?? 'Unknown', users));
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
  const b = req.body;
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
  const id = `ctr_${randomUUID().slice(0, 8)}`;
  await db.insert(contractsTable).values({
    id, dealId: b.dealId, title: b.title, status: 'drafting',
    version: 1, riskLevel: 'low', template: b.template,
    validUntil: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
  });
  // Seed clauses from brand defaults if provided
  if (brandForSeed) {
    const brand = brandForSeed;
    if (brand.defaultClauseVariants) {
      const families = await db.select().from(clauseFamiliesTable);
      const variants = await db.select().from(clauseVariantsTable);
      const vById = new Map(variants.map(v => [v.id, v]));
      const rows = families
        .map(f => {
          const vId = (brand.defaultClauseVariants as Record<string, string>)[f.id];
          const v = vId ? vById.get(vId) : undefined;
          if (!v) return null;
          const sev = v.severityScore <= 2 ? 'high' : v.severityScore === 3 ? 'medium' : 'low';
          return {
            id: `cc_${randomUUID().slice(0, 8)}`,
            contractId: id, familyId: f.id, activeVariantId: v.id,
            family: f.name, variant: v.name, severity: sev, summary: v.summary,
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
  };
}

async function brandVisible(req: Request, b: typeof brandsTable.$inferSelect): Promise<boolean> {
  const scope = getScope(req);
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, b.companyId));
  if (!company || company.tenantId !== scope.tenantId) return false;
  if (scope.tenantWide) return true;
  if (scope.companyIds.includes(b.companyId)) return true;
  if (scope.brandIds.includes(b.id)) return true;
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
  const visible = scope.tenantWide
    ? brands
    : brands.filter(b => scope.companyIds.includes(b.companyId) || scope.brandIds.includes(b.id));
  res.json(visible.map(mapBrand));
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
  const strFields = ['name', 'color', 'voice', 'logoUrl', 'primaryColor', 'secondaryColor', 'tone', 'legalEntityName', 'addressLine'] as const;
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  for (const k of strFields) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v !== null && typeof v !== 'string') continue;
    if (v !== null) {
      if (v.length > 512) { res.status(400).json({ error: `${k} too long` }); return; }
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
      }
    }
    (patch as Record<string, unknown>)[k] = v;
  }
  if (Object.keys(patch).length > 0) {
    await db.update(brandsTable).set(patch).where(eq(brandsTable.id, existing.id));
  }
  const [updated] = await db.select().from(brandsTable).where(eq(brandsTable.id, existing.id));
  await writeAudit({
    entityType: 'brand',
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
  await writeAudit({
    entityType: 'brand', entityId: req.params.id, action: 'default_clauses_updated',
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
    const mappedClauses = effectiveClauses.map(cl => {
      const active = cl.activeVariantId ? vByIdA.get(cl.activeVariantId) : undefined;
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
  const clauses = rawClauses.map(cl => {
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
  await writeAudit({
    entityType: 'contract_amendment', entityId: id, action: 'create',
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
    await writeAudit({
      entityType: 'contract_amendment', entityId: a.id, action: 'update',
      summary: `Amendment ${a.number} aktualisiert`,
      before: { status: a.status }, after: patch,
    });
    // Lifecycle side effects on status transitions
    if (patch.status === 'in_review') {
      const existing = await db.select().from(approvalsTable).where(eq(approvalsTable.amendmentId, a.id));
      if (existing.length === 0) {
        const scope = getScope(req);
        const approvalId = `ap_${randomUUID().slice(0, 8)}`;
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
        });
        await writeAudit({
          entityType: 'contract_amendment', entityId: a.id, action: 'approval_created',
          summary: `Approval angelegt für Nachtrag ${a.number}`,
          after: { approvalId },
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
        await writeAudit({
          entityType: 'contract_amendment', entityId: a.id, action: 'signature_created',
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
    clauses: rawClauses.map(cl => {
      const active = cl.activeVariantId ? vById.get(cl.activeVariantId) : undefined;
      return {
        family: cl.family,
        variant: cl.variant,
        severity: cl.severity,
        summary: cl.summary,
        body: active?.body ?? '',
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

router.get('/clause-families', async (_req, res) => {
  const families = await db.select().from(clauseFamiliesTable);
  const variants = await db.select().from(clauseVariantsTable);
  res.json(families.map(f => ({
    ...f,
    variants: variants
      .filter(v => v.familyId === f.id)
      .sort((a, b) => a.severityScore - b.severityScore)
      .map(v => ({
        id: v.id, name: v.name, severity: v.severity,
        severityScore: v.severityScore, summary: v.summary, body: v.body, tone: v.tone,
      })),
  })));
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
  res.json(clauses.map(cl => {
    const active = cl.activeVariantId ? variantById.get(cl.activeVariantId) : undefined;
    return {
      id: cl.id, contractId: cl.contractId, family: cl.family, variant: cl.variant,
      severity: cl.severity, summary: cl.summary,
      familyId: cl.familyId ?? null, activeVariantId: cl.activeVariantId ?? null,
      severityScore: active?.severityScore ?? 3,
      tone: active?.tone ?? 'standard',
      body: active?.body ?? '',
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
  await db.update(contractClausesTable).set({
    activeVariantId: nextVar.id,
    variant: nextVar.name,
    severity: sevLabel(nextScore),
    summary: nextVar.summary,
  }).where(eq(contractClausesTable.id, cl.id));
  await writeAudit({
    entityType: 'contract', entityId: ctr.id, action: 'clause_variant_changed',
    summary: `${cl.family}: ${prevVar?.name ?? '—'} → ${nextVar.name} (Δ severityScore ${deltaScore >= 0 ? '+' : ''}${deltaScore})`,
    before: { variantId: cl.activeVariantId, name: prevVar?.name, severityScore: prevScore },
    after: { variantId: nextVar.id, name: nextVar.name, severityScore: nextScore },
  });
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, type: 'contract',
    title: `Klausel geändert: ${cl.family}`,
    description: `${prevVar?.name ?? '—'} → ${nextVar.name}`,
    actor: actor.name, dealId: ctr.dealId,
  });
  let approvalId: string | null = null;
  if (softenBy2 || (softer && nextScore <= 2)) {
    approvalId = `ap_${randomUUID().slice(0, 8)}`;
    await db.insert(approvalsTable).values({
      id: approvalId, dealId: ctr.dealId, type: 'clause_change',
      reason: `Non-standard clause: ${cl.family} von ${prevVar?.name ?? '—'} auf ${nextVar.name} (severityScore ${prevScore}→${nextScore})`,
      requestedBy: actor.id, status: 'pending',
      priority: nextScore <= 1 ? 'high' : 'medium',
      impactValue: '0', currency: 'EUR',
    });
    await writeAudit({
      entityType: 'contract', entityId: ctr.id, action: 'approval_created',
      summary: `Approval angelegt für ${cl.family} (weichere Variante, Δ ${deltaScore})`,
      after: { approvalId, dealId: ctr.dealId },
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

async function maybeCompletePackageAndCreateOC(pkg: PackageRow, signers: SignerRow[]) {
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
    id: `tl_${randomUUID().slice(0, 8)}`, type: 'signature',
    title: 'Alle Unterschriften vollständig',
    description: `${pkg.title} abgeschlossen; Auftragsbestätigung ${ocId} erstellt.`,
    actor: 'System', dealId: pkg.dealId,
  });
  await writeAudit({
    entityType: 'signature_package', entityId: pkg.id,
    action: 'completed',
    summary: `Signature-Package ${pkg.title} vollständig; OC ${ocId} erzeugt.`,
  });
  // Fire webhook — contract.signed (tenant-scoped via deal→company).
  const [deal2] = await db.select().from(dealsTable).where(eq(dealsTable.id, pkg.dealId));
  if (deal2) {
    const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, deal2.companyId));
    if (co) void emitEvent(co.tenantId, 'contract.signed', { signaturePackageId: pkg.id, dealId: pkg.dealId, orderConfirmationId: ocId });
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
    id: `tl_${randomUUID().slice(0, 8)}`, type: 'signature',
    title: 'Reminder gesendet',
    description: `Reminder an ${waiting.name} für ${s.title}.`,
    actor: 'Priya Raman', dealId: s.dealId,
  });
  await writeAudit({
    entityType: 'signature_package', entityId: s.id, action: 'reminder_sent',
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
    id: `tl_${randomUUID().slice(0, 8)}`, type: 'signature',
    title: 'Signatur abgelehnt',
    description: `${sg.name} hat abgelehnt: ${reason}`,
    actor: 'System', dealId: pkg.dealId,
  });
  await writeAudit({
    entityType: 'signature_package', entityId: pkg.id, action: 'declined',
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
    id: `tl_${randomUUID().slice(0, 8)}`, type: 'signature',
    title: 'Eskalation: Fallback-Signer aktiviert',
    description: `${name} übernimmt für ${replaced.name} bei ${s.title}.`,
    actor: 'Priya Raman', dealId: s.dealId,
  });
  await writeAudit({
    entityType: 'signature_package', entityId: s.id, action: 'escalated',
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
  await maybeCompletePackageAndCreateOC(fresh!, all);
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
  const sf = dealScopeSql(getScope(req));
  const deals = await db.select().from(dealsTable).where(sf);
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
  const tlAll = await db.select().from(timelineEventsTable).orderBy(desc(timelineEventsTable.at)).limit(60);
  const tl = tlAll.filter(t => !t.dealId || dealIdSet.has(t.dealId)).slice(0, 8);
  const dealMap = await getDealMap();
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
  const sf = dealScopeSql(getScope(req));
  const deals = await db.select().from(dealsTable).where(sf);
  const won = deals.filter(d => d.stage === 'won');
  const lost = deals.filter(d => d.stage === 'lost');
  const users = await getUserMap();
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
  const dealIds = await allowedDealIds(req);
  const status = typeof req.query['status'] === 'string' ? req.query['status'] : null;
  const rows = await db.select().from(copilotInsightsTable).orderBy(desc(copilotInsightsTable.createdAt));
  const filtered = rows.filter(c =>
    (!c.dealId || dealIds.has(c.dealId)) &&
    (!status || c.status === status),
  );
  const dealMap = await getDealMap();
  res.json(filtered.map(c => mapInsight(c, dealMap)));
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
  await writeAudit({
    entityType: 'copilot_insight', entityId: c.id, action: `status_${next}`,
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
        id: `tl_${randomUUID().slice(0, 8)}`, type: 'approval',
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
        id: `tl_${randomUUID().slice(0, 8)}`, type: 'reminder',
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
    await writeAudit({
      entityType: 'copilot_insight', entityId: c.id, action: `execute_${c.actionType}`,
      summary: `Insight "${c.title}" ausgeführt (${c.actionType})`,
      after: result, actor,
    });
    res.json({ ok: true, insightId: c.id, result });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/copilot/threads', async (req, res) => {
  const rows = await db.select().from(copilotThreadsTable).orderBy(desc(copilotThreadsTable.updatedAt));
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
  if (!(await copilotThreadVisible(req, t.scope ?? ''))) {
    res.status(403).json({ error: 'forbidden' });
    return null;
  }
  return t;
}

router.get('/activity', async (req, res) => {
  const dealIds = await allowedDealIds(req);
  const rows = await db.select().from(timelineEventsTable).orderBy(desc(timelineEventsTable.at)).limit(200);
  const filtered = rows.filter(t => !t.dealId || dealIds.has(t.dealId)).slice(0, 40);
  const dealMap = await getDealMap();
  res.json(filtered.map(t => ({
    id: t.id, type: t.type, title: t.title, description: t.description,
    actor: t.actor, dealId: t.dealId,
    dealName: t.dealId ? (dealMap.get(t.dealId)?.name ?? null) : null,
    at: iso(t.at)!,
  })));
});

// ── AUDIT LOG ──
async function writeAudit(args: {
  entityType: string; entityId: string; action: string;
  summary: string; before?: unknown; after?: unknown; actor?: string;
}) {
  await db.insert(auditLogTable).values({
    id: `au_${randomUUID().slice(0, 10)}`,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    actor: args.actor ?? 'Priya Raman',
    beforeJson: args.before === undefined ? null : JSON.stringify(args.before),
    afterJson: args.after === undefined ? null : JSON.stringify(args.after),
    summary: args.summary,
  });
}

router.get('/audit', async (req, res) => {
  if (!validateInline(req, res, { query: Z.ListAuditEntriesQueryParams })) return;
  const filters = [];
  if (req.query.entityType) filters.push(eq(auditLogTable.entityType, String(req.query.entityType)));
  if (req.query.entityId)   filters.push(eq(auditLogTable.entityId, String(req.query.entityId)));
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  // Fetch a generous window from the DB; scope-filter post-fetch.
  const rows = await db.select().from(auditLogTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLogTable.at))
    .limit(Math.max(limit * 4, 200));
  const scope = getScope(req);
  const visible = scope.tenantWide
    ? rows
    : (await Promise.all(rows.map(async r => ({ r, ok: await entityInScope(req, r.entityType, r.entityId) }))))
        .filter(x => x.ok).map(x => x.r);
  res.json(visible.slice(0, limit).map(a => ({
    id: a.id, entityType: a.entityType, entityId: a.entityId,
    action: a.action, actor: a.actor, summary: a.summary,
    beforeJson: a.beforeJson, afterJson: a.afterJson, at: iso(a.at)!,
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
  await writeAudit({
    entityType: 'contract', entityId: c.id, action: 'version_created',
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
  await writeAudit({
    entityType: 'price_position', entityId: p.id, action: 'version_created',
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
  const asOf = parseAsOf(req.query.asOf);
  if (!validateInline(req, res, { query: Z.ResolvePriceQueryParams })) return;
  const sku = String(req.query.sku ?? '');
  const brandId = req.query.brandId ? String(req.query.brandId) : null;
  const companyId = req.query.companyId ? String(req.query.companyId) : null;
  if (!sku) { res.status(400).json({ error: 'sku required' }); return; }

  const scope = getScope(req);
  const allowedBrands = new Set(await allowedBrandIds(req));
  const allowedCompanies = new Set(scope.companyIds);
  // Tenant-bound: join companies and filter by tenantId.
  const tenantPositions = (await db
    .select({ p: pricePositionsTable })
    .from(pricePositionsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, pricePositionsTable.companyId))
    .where(eq(companiesTable.tenantId, scope.tenantId))
  ).map(r => r.p);
  const positions = tenantPositions
    .filter(p => p.sku === sku && p.status === 'active')
    .filter(p => scope.tenantWide || allowedBrands.has(p.brandId) || allowedCompanies.has(p.companyId));
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
      (scope.tenantWide || allowedBrands.has(c.brandId) || allowedCompanies.has(c.companyId))
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
      id: `tl_${randomUUID().slice(0, 8)}`, type: 'price_increase',
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
      await writeAudit({
        entityType: 'contract_amendment', entityId: aid, action: 'create',
        summary: `Amendment ${number} automatisch aus Preiserhöhung erzeugt`,
        after: { from: 'price_increase_letter', letterId: l.id, upliftPct: num(l.upliftPct) },
      });
    }
  }
  await writeAudit({
    entityType: 'price_increase_letter', entityId: l.id,
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
  const userMap = await getUserMap();
  const reconciled = await Promise.all(rows.map(async (o) => {
    if (o.status === 'in_onboarding' || o.status === 'completed') return o;
    const checks = await db.select().from(orderConfirmationChecksTable)
      .where(eq(orderConfirmationChecksTable.orderConfirmationId, o.id));
    return reconcileOcState(o, checks);
  }));
  res.json(reconciled.map(o => mapOC(o, dealMap.get(o.dealId)?.name ?? 'Unknown', userMap)));
});

async function reconcileOcState(
  o: typeof orderConfirmationsTable.$inferSelect,
  checks: Array<typeof orderConfirmationChecksTable.$inferSelect>,
): Promise<typeof orderConfirmationsTable.$inferSelect> {
  if (o.status === 'in_onboarding' || o.status === 'completed') return o;
  const req = checks.filter(c => c.required);
  const allOk = req.length > 0 && req.every(c => c.status === 'ok');
  const anyBlocked = req.some(c => c.status === 'blocked');
  let target = o.status;
  if (allOk) target = 'ready_for_handover';
  else if (req.length > 0) target = 'checks_pending';
  if (target !== o.status) {
    await db.update(orderConfirmationsTable).set({ status: target })
      .where(eq(orderConfirmationsTable.id, o.id));
    await writeAudit({
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
      const blocked = req.filter(c => c.status === 'blocked');
      await writeAudit({
        entityType: 'order_confirmation', entityId: o.id, action: 'escalation_raised',
        summary: `${o.number}: ${blocked.length} Pflicht-Check blockiert — Eskalation an Sales-Owner`,
        after: { blockedChecks: blocked.map(b => ({ id: b.id, label: b.label, reason: b.detail })), salesOwnerId: o.salesOwnerId },
      });
      await db.insert(timelineEventsTable).values({
        id: `tl_${randomUUID().slice(0, 8)}`, type: 'handover',
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
  const userMap = await getUserMap();
  const checks = await db.select().from(orderConfirmationChecksTable)
    .where(eq(orderConfirmationChecksTable.orderConfirmationId, raw.id));
  const o = await reconcileOcState(raw, checks);
  res.json(buildOcDetail(o, dealMap.get(o.dealId)?.name ?? 'Unknown', userMap, checks));
});

async function respondOcDetail(res: Response, ocId: string) {
  const [u] = await db.select().from(orderConfirmationsTable).where(eq(orderConfirmationsTable.id, ocId));
  const checks = await db.select().from(orderConfirmationChecksTable)
    .where(eq(orderConfirmationChecksTable.orderConfirmationId, ocId));
  const dealMap = await getDealMap();
  const userMap = await getUserMap();
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
  await writeAudit({
    entityType: 'order_confirmation', entityId: o.id, action: 'handover_completed',
    summary: `Auftragsbestätigung ${o.number} an ${owner.name} (Onboarding) übergeben`,
    after: { onboardingOwnerId: owner.id, contactName, contactEmail, deliveryDate, slaDays: o.slaDays },
  });
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, type: 'handover',
    title: 'Übergabe an Onboarding',
    description: `Auftragsbestätigung ${o.number} an ${owner.name} übergeben. SLA ${o.slaDays} Tage läuft.`,
    actor: 'Priya Raman', dealId: o.dealId,
  });
  await respondOcDetail(res, o.id);
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
  await writeAudit({
    entityType: 'order_confirmation', entityId: o.id, action: 'completed',
    summary: `Onboarding für ${o.number} abgeschlossen`,
  });
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, type: 'handover',
    title: 'Onboarding abgeschlossen',
    description: `Auftragsbestätigung ${o.number} ist produktiv übergeben.`,
    actor: 'Priya Raman', dealId: o.dealId,
  });
  await respondOcDetail(res, o.id);
});

// ── COPILOT CHAT ──
router.get('/copilot/threads/:id/messages', async (req, res) => {
  if (!validateInline(req, res, { params: Z.ListCopilotMessagesParams })) return;
  if (!(await gateThread(req, res, req.params.id))) return;
  const rows = await db.select().from(copilotMessagesTable)
    .where(eq(copilotMessagesTable.threadId, req.params.id))
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
  const userId = `cm_${randomUUID().slice(0, 10)}`;
  await db.insert(copilotMessagesTable).values({
    id: userId, threadId: req.params.id, role: 'user', content: b.content,
  });
  const reply = craftAssistantReply(b.content);
  const asstId = `cm_${randomUUID().slice(0, 10)}`;
  await db.insert(copilotMessagesTable).values({
    id: asstId, threadId: req.params.id, role: 'assistant', content: reply,
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
    id, title: b.title, scope: b.scope ?? 'global',
    lastMessage: 'Neuer Chat gestartet.', messageCount: 0,
  });
  const [t] = await db.select().from(copilotThreadsTable).where(eq(copilotThreadsTable.id, id));
  res.status(201).json({
    id: t!.id, title: t!.title, scope: t!.scope, lastMessage: t!.lastMessage,
    messageCount: t!.messageCount, updatedAt: iso(t!.updatedAt)!,
  });
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

router.post('/copilot/help', async (req, res) => {
  if (!validateInline(req, res, { body: Z.AskHelpBotBody })) return;
  const b = req.body;
  const q = b.question ?? '';
  const hit = helpRules.find(r => r.match.test(q));
  if (hit) {
    res.json({ reply: hit.reply, suggestions: hit.suggestions });
    return;
  }
  res.json({
    reply: 'Gute Frage — ich kann dich durch alle Bereiche der Plattform führen: Deals, Angebote, Verträge, Verhandlungen, Unterschriften, Preise, Preiserhöhungen, Reports und Audit. Sag mir einfach, womit du anfangen willst.',
    suggestions: [
      { label: 'Home', path: '/' },
      { label: 'Deals', path: '/deals' },
      { label: 'Reports', path: '/reports' },
    ],
  });
});

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
  await writeAudit(b);
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
  await writeAudit({
    entityType: 'user', entityId: id, action: 'create',
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
    await writeAudit({
      entityType: 'user', entityId: u.id, action: 'update',
      summary: `Benutzer aktualisiert: ${u.name}`,
      before: { role: u.role, isActive: u.isActive, tenantWide: u.tenantWide },
      after: redacted,
      actor: scope.user.name,
    });
  }
  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, u.id));
  res.json(await mapAdminUser(updated!));
});

router.get('/admin/roles', async (req, res) => {
  if (!requireTenantAdmin(req, res)) return;
  const scope = getScope(req);
  const rows = await db.select().from(rolesTable).where(eq(rolesTable.tenantId, scope.tenantId));
  res.json(rows.map(r => ({ id: r.id, name: r.name, description: r.description, isSystem: r.isSystem })));
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
  const [dup] = await db.select().from(rolesTable)
    .where(and(eq(rolesTable.tenantId, scope.tenantId), eq(rolesTable.name, b.name.trim())));
  if (dup) { res.status(409).json({ error: 'role name already exists' }); return; }
  const id = `ro_${randomUUID().slice(0, 8)}`;
  const [ins] = await db.insert(rolesTable).values({
    id, name: b.name.trim(), description: b.description.trim(),
    isSystem: false, tenantId: scope.tenantId,
  }).returning();
  await writeAudit({
    entityType: 'role', entityId: id, action: 'create',
    summary: `Rolle angelegt: ${b.name}`,
    after: { name: b.name, description: b.description },
    actor: scope.user.name,
  });
  res.status(201).json({ id: ins!.id, name: ins!.name, description: ins!.description, isSystem: ins!.isSystem });
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
  if (Object.keys(patch).length > 0) {
    if (patch.name && patch.name !== r.name) {
      const [dup] = await db.select().from(rolesTable)
        .where(and(eq(rolesTable.tenantId, scope.tenantId), eq(rolesTable.name, patch.name)));
      if (dup && dup.id !== r.id) { res.status(409).json({ error: 'role name already exists' }); return; }
      await db.update(usersTable).set({ role: patch.name })
        .where(and(eq(usersTable.tenantId, scope.tenantId), eq(usersTable.role, r.name)));
    }
    await db.update(rolesTable).set(patch).where(eq(rolesTable.id, r.id));
    await writeAudit({
      entityType: 'role', entityId: r.id, action: 'update',
      summary: `Rolle aktualisiert: ${r.name}`,
      before: { name: r.name, description: r.description },
      after: patch,
      actor: scope.user.name,
    });
  }
  const [updated] = await db.select().from(rolesTable).where(eq(rolesTable.id, r.id));
  res.json({ id: updated!.id, name: updated!.name, description: updated!.description, isSystem: updated!.isSystem });
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
  await writeAudit({
    entityType: 'role', entityId: r.id, action: 'delete',
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
  const list = await db.select().from(contactsTable);
  const filtered = list.filter(c =>
    accIds.has(c.accountId) &&
    (q.length === 0 || c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q))
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
  await writeAudit({
    entityType: 'contact',
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
  const userMap = await getUserMap();
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
  await writeAudit({
    entityType: 'gdpr',
    entityId: scope.tenantId,
    action: 'retention.run',
    actor: scope.user.name,
    summary: 'GDPR Retention-Lauf manuell ausgeführt',
    after: result.applied,
  });
  res.json(result);
});

router.get('/gdpr/retention-policy', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const scope = getScope(req);
  const [t] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, scope.tenantId));
  res.json({ tenantId: scope.tenantId, policy: t?.retentionPolicy ?? {} });
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
  await writeAudit({
    entityType: 'gdpr',
    entityId: scope.tenantId,
    action: 'retention.policy.update',
    actor: scope.user.name,
    summary: 'GDPR Retention-Policy aktualisiert',
    before: tRow?.retentionPolicy ?? {},
    after: current,
  });
  res.json({ tenantId: scope.tenantId, policy: current });
});

export default router;

// Re-export helpers for type inference (no-op)
export type { Request, Response };

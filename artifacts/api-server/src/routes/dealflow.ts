import { Router, type IRouter, type Request, type Response } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
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
} from '@workspace/db';

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

// ── ORG ──
router.get('/orgs/tenant', async (_req, res) => {
  const [t] = await db.select().from(tenantsTable).limit(1);
  if (!t) { res.status(404).json({ error: 'no tenant' }); return; }
  res.json({ ...t, createdAt: iso(t.createdAt) });
});

router.get('/orgs/companies', async (_req, res) => {
  res.json(await db.select().from(companiesTable));
});
router.get('/orgs/brands', async (_req, res) => {
  res.json(await db.select().from(brandsTable));
});
router.get('/orgs/users', async (_req, res) => {
  res.json(await db.select().from(usersTable));
});
router.get('/orgs/me', async (_req, res) => {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, 'u_priya'));
  if (!u) { res.status(404).json({ error: 'no user' }); return; }
  res.json(u);
});

// ── ACCOUNTS ──
router.get('/accounts', async (_req, res) => {
  const accs = await db.select().from(accountsTable);
  const allDeals = await db.select().from(dealsTable);
  res.json(accs.map(a => {
    const ds = allDeals.filter(d => d.accountId === a.id && d.stage !== 'won' && d.stage !== 'lost');
    return {
      ...a,
      openDeals: ds.length,
      totalValue: ds.reduce((s, d) => s + num(d.value), 0),
    };
  }));
});

router.post('/accounts', async (req, res) => {
  const body = req.body as { name: string; industry: string; country: string };
  const id = `acc_${randomUUID().slice(0, 8)}`;
  await db.insert(accountsTable).values({
    id, name: body.name, industry: body.industry, country: body.country,
    healthScore: 70, ownerId: 'u_priya',
  });
  const [a] = await db.select().from(accountsTable).where(eq(accountsTable.id, id));
  res.status(201).json({ ...a, openDeals: 0, totalValue: 0 });
});

router.get('/accounts/:id', async (req, res) => {
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
  const accountId = (req.query.accountId as string | undefined) ?? null;
  const list = accountId
    ? await db.select().from(contactsTable).where(eq(contactsTable.accountId, accountId))
    : await db.select().from(contactsTable);
  res.json(list);
});

// ── DEALS ──
router.get('/deals', async (req, res) => {
  const filters = [];
  if (req.query.stage)     filters.push(eq(dealsTable.stage, String(req.query.stage)));
  if (req.query.ownerId)   filters.push(eq(dealsTable.ownerId, String(req.query.ownerId)));
  if (req.query.companyId) filters.push(eq(dealsTable.companyId, String(req.query.companyId)));
  if (req.query.brandId)   filters.push(eq(dealsTable.brandId, String(req.query.brandId)));
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
  const b = req.body as {
    name: string; accountId: string; value: number; stage: string;
    brandId: string; companyId: string; ownerId: string; expectedCloseDate: string;
  };
  const id = `dl_${randomUUID().slice(0, 8)}`;
  const company = (await db.select().from(companiesTable).where(eq(companiesTable.id, b.companyId)))[0];
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

router.get('/deals/pipeline', async (_req, res) => {
  const rows = await db.select().from(dealsTable);
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
  const b = req.body as Record<string, unknown>;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of ['name', 'stage', 'probability', 'riskLevel', 'nextStep', 'expectedCloseDate']) {
    if (b[k] !== undefined) update[k] = b[k];
  }
  if (b.value !== undefined) update.value = String(b.value);
  await db.update(dealsTable).set(update).where(eq(dealsTable.id, req.params.id));
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, req.params.id));
  if (!d) { res.status(404).json({ error: 'not found' }); return; }
  const ctx = await dealCtx();
  res.json(await buildDeal(d, ctx));
});

router.get('/deals/:id/timeline', async (req, res) => {
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
  const filters = [];
  if (req.query.dealId) filters.push(eq(quotesTable.dealId, String(req.query.dealId)));
  if (req.query.status) filters.push(eq(quotesTable.status, String(req.query.status)));
  const rows = await db.select().from(quotesTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(quotesTable.createdAt));
  const dealMap = await getDealMap();
  const out = await Promise.all(rows.map(q => enrichQuote(q, dealMap.get(q.dealId)?.name ?? 'Unknown')));
  res.json(out);
});

router.post('/quotes', async (req, res) => {
  const b = req.body as { dealId: string; validUntil?: string };
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
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, req.params.id));
  if (!q) { res.status(404).json({ error: 'not found' }); return; }
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
  });
});

router.post('/quotes/:id/versions', async (req, res) => {
  const b = req.body as { discountPct: number; notes?: string };
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, req.params.id));
  if (!q) { res.status(404).json({ error: 'not found' }); return; }
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
  await db.update(quotesTable).set({ status: 'accepted' }).where(eq(quotesTable.id, req.params.id));
  const [q] = await db.select().from(quotesTable).where(eq(quotesTable.id, req.params.id));
  if (!q) { res.status(404).json({ error: 'not found' }); return; }
  const [d] = await db.select().from(dealsTable).where(eq(dealsTable.id, q.dealId));
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

router.get('/price-positions', async (_req, res) => {
  const rows = await db.select().from(pricePositionsTable);
  const brands = await getBrandMap();
  const companies = await getCompanyMap();
  res.json(rows.map(p => mapPricePosition(p, brands.get(p.brandId)?.name ?? '', companies.get(p.companyId)?.name ?? '')));
});

router.post('/price-positions', async (req, res) => {
  const b = req.body as {
    sku: string; name: string; category: string; listPrice: number;
    currency: string; brandId: string; companyId: string; validFrom: string;
  };
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

router.get('/price-rules', async (_req, res) => {
  res.json(await db.select().from(priceRulesTable));
});

router.get('/pricing/summary', async (_req, res) => {
  const positions = await db.select().from(pricePositionsTable);
  const pendingApprovals = await db.select({ c: sql<number>`count(*)::int` }).from(approvalsTable)
    .where(and(eq(approvalsTable.status, 'pending'), eq(approvalsTable.type, 'discount')));
  res.json({
    totalPositions: positions.length,
    activePositions: positions.filter(p => p.status === 'active').length,
    pendingApprovalCount: pendingApprovals[0]?.c ?? 0,
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
  };
}

router.get('/approvals', async (req, res) => {
  const filter = req.query.status ? eq(approvalsTable.status, String(req.query.status)) : undefined;
  const rows = await db.select().from(approvalsTable).where(filter).orderBy(desc(approvalsTable.createdAt));
  const dealMap = await getDealMap();
  const users = await getUserMap();
  res.json(rows.map(a => mapApproval(a, dealMap.get(a.dealId)?.name ?? 'Unknown', users)));
});

router.post('/approvals/:id/decide', async (req, res) => {
  const b = req.body as { decision: string; comment?: string };
  await db.update(approvalsTable).set({
    status: b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : b.decision,
    decisionComment: b.comment ?? null, decidedAt: new Date(), decidedBy: 'u_priya',
  }).where(eq(approvalsTable.id, req.params.id));
  const [a] = await db.select().from(approvalsTable).where(eq(approvalsTable.id, req.params.id));
  if (!a) { res.status(404).json({ error: 'not found' }); return; }
  const dealMap = await getDealMap();
  const users = await getUserMap();
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
  const filter = req.query.dealId ? eq(contractsTable.dealId, String(req.query.dealId)) : undefined;
  const rows = await db.select().from(contractsTable).where(filter).orderBy(desc(contractsTable.createdAt));
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
  const b = req.body as { dealId: string; title: string; template: string };
  const id = `ctr_${randomUUID().slice(0, 8)}`;
  await db.insert(contractsTable).values({
    id, dealId: b.dealId, title: b.title, status: 'drafting',
    version: 1, riskLevel: 'low', template: b.template,
    validUntil: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
  });
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, id));
  const dealMap = await getDealMap();
  res.status(201).json(mapContract(c!, dealMap.get(c!.dealId)?.name ?? 'Unknown'));
});

router.get('/contracts/:id', async (req, res) => {
  const [c] = await db.select().from(contractsTable).where(eq(contractsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  const dealMap = await getDealMap();
  const clauses = await db.select().from(contractClausesTable).where(eq(contractClausesTable.contractId, c.id));
  res.json({
    ...mapContract(c, dealMap.get(c.dealId)?.name ?? 'Unknown', clauses),
    clauses,
  });
});

router.get('/clause-families', async (_req, res) => {
  const families = await db.select().from(clauseFamiliesTable);
  const variants = await db.select().from(clauseVariantsTable);
  res.json(families.map(f => ({
    ...f,
    variants: variants.filter(v => v.familyId === f.id).map(v => ({
      id: v.id, name: v.name, severity: v.severity, summary: v.summary,
    })),
  })));
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
  const filters = [];
  if (req.query.dealId) filters.push(eq(negotiationsTable.dealId, String(req.query.dealId)));
  if (req.query.status) filters.push(eq(negotiationsTable.status, String(req.query.status)));
  const rows = await db.select().from(negotiationsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(negotiationsTable.updatedAt));
  const dealMap = await getDealMap();
  res.json(rows.map(n => mapNegotiation(n, dealMap.get(n.dealId)?.name ?? 'Unknown')));
});

router.get('/negotiations/:id', async (req, res) => {
  const [n] = await db.select().from(negotiationsTable).where(eq(negotiationsTable.id, req.params.id));
  if (!n) { res.status(404).json({ error: 'not found' }); return; }
  const dealMap = await getDealMap();
  const reactions = await db.select().from(customerReactionsTable)
    .where(eq(customerReactionsTable.negotiationId, n.id))
    .orderBy(desc(customerReactionsTable.createdAt));
  const tlRows = await db.select().from(timelineEventsTable)
    .where(eq(timelineEventsTable.dealId, n.dealId))
    .orderBy(desc(timelineEventsTable.at));
  res.json({
    ...mapNegotiation(n, dealMap.get(n.dealId)?.name ?? 'Unknown'),
    reactions: reactions.map(r => ({
      id: r.id, negotiationId: r.negotiationId, type: r.type, topic: r.topic,
      summary: r.summary, source: r.source, priority: r.priority,
      impactPct: numOrNull(r.impactPct), createdAt: iso(r.createdAt)!,
    })),
    timeline: tlRows.map(t => ({
      id: t.id, type: t.type, title: t.title, description: t.description,
      actor: t.actor, dealId: t.dealId,
      dealName: t.dealId ? (dealMap.get(t.dealId)?.name ?? null) : null,
      at: iso(t.at)!,
    })),
  });
});

router.post('/negotiations/:id/reactions', async (req, res) => {
  const b = req.body as {
    type: string; topic: string; summary: string; source: string; priority: string; impactPct?: number;
  };
  const id = `cr_${randomUUID().slice(0, 8)}`;
  await db.insert(customerReactionsTable).values({
    id, negotiationId: req.params.id, type: b.type, topic: b.topic,
    summary: b.summary, source: b.source, priority: b.priority,
    impactPct: b.impactPct != null ? String(b.impactPct) : null,
  });
  await db.update(negotiationsTable).set({
    lastReactionType: b.type, updatedAt: new Date(),
    round: sql`${negotiationsTable.round} + 1`,
  }).where(eq(negotiationsTable.id, req.params.id));
  const [r] = await db.select().from(customerReactionsTable).where(eq(customerReactionsTable.id, id));
  res.status(201).json({
    id: r!.id, negotiationId: r!.negotiationId, type: r!.type, topic: r!.topic,
    summary: r!.summary, source: r!.source, priority: r!.priority,
    impactPct: numOrNull(r!.impactPct), createdAt: iso(r!.createdAt)!,
  });
});

// ── SIGNATURES ──
function mapSignaturePackageSummary(
  s: typeof signaturePackagesTable.$inferSelect, dealName: string,
  signedCount = 0, totalSigners = 0,
) {
  return {
    id: s.id, dealId: s.dealId, dealName, title: s.title, status: s.status,
    signedCount, totalSigners,
    createdAt: iso(s.createdAt)!,
    deadline: iso(s.deadline),
  };
}

router.get('/signatures', async (req, res) => {
  const filter = req.query.status ? eq(signaturePackagesTable.status, String(req.query.status)) : undefined;
  const rows = await db.select().from(signaturePackagesTable).where(filter).orderBy(desc(signaturePackagesTable.createdAt));
  const dealMap = await getDealMap();
  const allSigners = await db.select().from(signersTable);
  res.json(rows.map(s => {
    const sg = allSigners.filter(x => x.packageId === s.id);
    return mapSignaturePackageSummary(s, dealMap.get(s.dealId)?.name ?? 'Unknown',
      sg.filter(x => x.status === 'signed').length, sg.length);
  }));
});

router.get('/signatures/:id', async (req, res) => {
  const [s] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, req.params.id));
  if (!s) { res.status(404).json({ error: 'not found' }); return; }
  const dealMap = await getDealMap();
  const signers = await db.select().from(signersTable).where(eq(signersTable.packageId, s.id));
  res.json({
    ...mapSignaturePackageSummary(s, dealMap.get(s.dealId)?.name ?? 'Unknown',
      signers.filter(x => x.status === 'signed').length, signers.length),
    signers: signers.sort((a, b) => a.order - b.order).map(sg => ({
      id: sg.id, packageId: sg.packageId, name: sg.name, email: sg.email,
      role: sg.role, order: sg.order, status: sg.status, signedAt: iso(sg.signedAt),
    })),
  });
});

router.post('/signatures/:id/remind', async (req, res) => {
  const [s] = await db.select().from(signaturePackagesTable).where(eq(signaturePackagesTable.id, req.params.id));
  if (!s) { res.status(404).json({ error: 'not found' }); return; }
  const dealMap = await getDealMap();
  const signers = await db.select().from(signersTable).where(eq(signersTable.packageId, s.id));
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, type: 'signature',
    title: 'Reminder sent', description: `Reminder sent for ${s.title}.`,
    actor: 'Priya Raman', dealId: s.dealId,
  });
  res.json(mapSignaturePackageSummary(s, dealMap.get(s.dealId)?.name ?? 'Unknown',
    signers.filter(x => x.status === 'signed').length, signers.length));
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

router.get('/price-increases', async (_req, res) => {
  const rows = await db.select().from(priceIncreaseCampaignsTable);
  const letters = await db.select().from(priceIncreaseLettersTable);
  res.json(rows.map(c => mapCampaign(c, letters.filter(l => l.campaignId === c.id))));
});

router.get('/price-increases/:id', async (req, res) => {
  const [c] = await db.select().from(priceIncreaseCampaignsTable).where(eq(priceIncreaseCampaignsTable.id, req.params.id));
  if (!c) { res.status(404).json({ error: 'not found' }); return; }
  const letters = await db.select().from(priceIncreaseLettersTable).where(eq(priceIncreaseLettersTable.campaignId, c.id));
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
router.get('/reports/dashboard', async (_req, res) => {
  const deals = await db.select().from(dealsTable);
  const open = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost');
  const won = deals.filter(d => d.stage === 'won').length;
  const lost = deals.filter(d => d.stage === 'lost').length;
  const stages = ['qualified', 'discovery', 'proposal', 'negotiation', 'closing'];
  const stageBreakdown = stages.map(s => {
    const ds = open.filter(d => d.stage === s);
    return { stage: s, label: stageLabels[s] ?? s, count: ds.length, value: ds.reduce((sum, d) => sum + num(d.value), 0) };
  });
  const quotesAwait = (await db.select({ c: sql<number>`count(*)::int` }).from(quotesTable).where(eq(quotesTable.status, 'sent')))[0]?.c ?? 0;
  const openApprovals = (await db.select({ c: sql<number>`count(*)::int` }).from(approvalsTable).where(eq(approvalsTable.status, 'pending')))[0]?.c ?? 0;
  const sigsPending = (await db.select({ c: sql<number>`count(*)::int` }).from(signaturePackagesTable).where(eq(signaturePackagesTable.status, 'in_progress')))[0]?.c ?? 0;
  const tl = await db.select().from(timelineEventsTable).orderBy(desc(timelineEventsTable.at)).limit(8);
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

router.get('/reports/performance', async (_req, res) => {
  const deals = await db.select().from(dealsTable);
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
router.get('/copilot/insights', async (_req, res) => {
  const rows = await db.select().from(copilotInsightsTable).orderBy(desc(copilotInsightsTable.createdAt));
  const dealMap = await getDealMap();
  res.json(rows.map(c => ({
    id: c.id, kind: c.kind, title: c.title, summary: c.summary, severity: c.severity,
    dealId: c.dealId, dealName: dealMap.get(c.dealId)?.name ?? 'Unknown',
    suggestedAction: c.suggestedAction, createdAt: iso(c.createdAt)!,
  })));
});

router.get('/copilot/threads', async (_req, res) => {
  const rows = await db.select().from(copilotThreadsTable).orderBy(desc(copilotThreadsTable.updatedAt));
  res.json(rows.map(t => ({
    id: t.id, title: t.title, scope: t.scope, lastMessage: t.lastMessage,
    messageCount: t.messageCount, updatedAt: iso(t.updatedAt)!,
  })));
});

router.get('/activity', async (_req, res) => {
  const rows = await db.select().from(timelineEventsTable).orderBy(desc(timelineEventsTable.at)).limit(40);
  const dealMap = await getDealMap();
  res.json(rows.map(t => ({
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
  const filters = [];
  if (req.query.entityType) filters.push(eq(auditLogTable.entityType, String(req.query.entityType)));
  if (req.query.entityId)   filters.push(eq(auditLogTable.entityId, String(req.query.entityId)));
  const limit = req.query.limit ? Number(req.query.limit) : 100;
  const rows = await db.select().from(auditLogTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(auditLogTable.at))
    .limit(limit);
  res.json(rows.map(a => ({
    id: a.id, entityType: a.entityType, entityId: a.entityId,
    action: a.action, actor: a.actor, summary: a.summary,
    beforeJson: a.beforeJson, afterJson: a.afterJson, at: iso(a.at)!,
  })));
});

// ── ENTITY VERSIONS ──
router.get('/versions/:entityType/:entityId', async (req, res) => {
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
  const b = req.body as { label: string; comment?: string; snapshot?: string };
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
  const b = req.body as { label: string; comment?: string; snapshot?: string };
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
  const sku = String(req.query.sku ?? '');
  const brandId = req.query.brandId ? String(req.query.brandId) : null;
  const companyId = req.query.companyId ? String(req.query.companyId) : null;
  if (!sku) { res.status(400).json({ error: 'sku required' }); return; }

  const positions = (await db.select().from(pricePositionsTable))
    .filter(p => p.sku === sku && p.status === 'active');
  const brands = await getBrandMap();
  const companies = await getCompanyMap();

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

  res.json({
    sku,
    listPrice: num(winner.listPrice),
    currency: winner.currency,
    source: brandHit ? 'brand' : companyHit ? 'company' : 'tenant',
    positionId: winner.id,
    chain,
  });
});

// ── PRICE INCREASE LETTER WORKFLOW ──
router.post('/price-increases/:id/letters/:letterId/respond', async (req, res) => {
  const b = req.body as { decision: string; comment?: string };
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
  }
  await writeAudit({
    entityType: 'price_increase_letter', entityId: l.id,
    action: `respond_${b.decision}`,
    summary: `${accName}: ${b.decision} (+${num(l.upliftPct)}%)`,
    after: { status: newStatus },
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
) {
  return {
    id: o.id, dealId: o.dealId, dealName, contractId: o.contractId,
    number: o.number, status: o.status, readinessScore: o.readinessScore,
    totalAmount: num(o.totalAmount), currency: o.currency,
    expectedDelivery: o.expectedDelivery
      ? (typeof o.expectedDelivery === 'string' ? o.expectedDelivery : iso(o.expectedDelivery)!.slice(0, 10))
      : null,
    handoverAt: iso(o.handoverAt),
    createdAt: iso(o.createdAt)!,
  };
}

router.get('/order-confirmations', async (req, res) => {
  const filter = req.query.status ? eq(orderConfirmationsTable.status, String(req.query.status)) : undefined;
  const rows = await db.select().from(orderConfirmationsTable).where(filter).orderBy(desc(orderConfirmationsTable.createdAt));
  const dealMap = await getDealMap();
  res.json(rows.map(o => mapOC(o, dealMap.get(o.dealId)?.name ?? 'Unknown')));
});

router.get('/order-confirmations/:id', async (req, res) => {
  const [o] = await db.select().from(orderConfirmationsTable).where(eq(orderConfirmationsTable.id, req.params.id));
  if (!o) { res.status(404).json({ error: 'not found' }); return; }
  const dealMap = await getDealMap();
  const checks = await db.select().from(orderConfirmationChecksTable)
    .where(eq(orderConfirmationChecksTable.orderConfirmationId, o.id));
  res.json({
    ...mapOC(o, dealMap.get(o.dealId)?.name ?? 'Unknown'),
    checks: checks.map(c => ({ id: c.id, label: c.label, status: c.status, detail: c.detail })),
  });
});

router.post('/order-confirmations/:id/handover', async (req, res) => {
  const [o] = await db.select().from(orderConfirmationsTable).where(eq(orderConfirmationsTable.id, req.params.id));
  if (!o) { res.status(404).json({ error: 'not found' }); return; }
  const checks = await db.select().from(orderConfirmationChecksTable)
    .where(eq(orderConfirmationChecksTable.orderConfirmationId, o.id));
  const ready = checks.every(c => c.status === 'ok');
  if (!ready) { res.status(400).json({ error: 'not all checks ok', readinessScore: o.readinessScore }); return; }
  await db.update(orderConfirmationsTable).set({
    status: 'handed_over', handoverAt: new Date(),
  }).where(eq(orderConfirmationsTable.id, o.id));
  await writeAudit({
    entityType: 'order_confirmation', entityId: o.id, action: 'handover',
    summary: `Auftragsbestätigung ${o.number} an Lieferung übergeben`,
  });
  await db.insert(timelineEventsTable).values({
    id: `tl_${randomUUID().slice(0, 8)}`, type: 'handover',
    title: 'Übergabe an Lieferung',
    description: `Auftragsbestätigung ${o.number} wurde an die Auftragsabwicklung übergeben.`,
    actor: 'Priya Raman', dealId: o.dealId,
  });
  const [u] = await db.select().from(orderConfirmationsTable).where(eq(orderConfirmationsTable.id, o.id));
  const dealMap = await getDealMap();
  res.json({
    ...mapOC(u!, dealMap.get(u!.dealId)?.name ?? 'Unknown'),
    checks: checks.map(c => ({ id: c.id, label: c.label, status: c.status, detail: c.detail })),
  });
});

// ── COPILOT CHAT ──
router.get('/copilot/threads/:id/messages', async (req, res) => {
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
  const b = req.body as { content: string };
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
  const b = req.body as { title: string; scope?: string };
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
  const b = req.body as { question: string; currentPath?: string | null };
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
router.post('/audit/manual', async (req, res) => {
  const b = req.body as { entityType: string; entityId: string; action: string; summary: string };
  await writeAudit(b);
  res.status(201).json({ ok: true });
});

export default router;

// Re-export helpers for type inference (no-op)
export type { Request, Response };

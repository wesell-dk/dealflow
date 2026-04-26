/**
 * DealFlow Help-Bot Agent Tools
 *
 * Werkzeuge, die der Help-Bot per Tool-Loop aufrufen kann. Jedes Tool ist
 * scope-bewusst — Lese-Tools nutzen allowedAccountIds/allowedDealIds, Mutating-
 * Tools validieren Ziel-IDs gegen den User-Scope und schreiben einen Audit-
 * Log-Eintrag.
 */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  db,
  accountsTable,
  contactsTable,
  dealsTable,
  quotesTable,
  contractsTable,
  approvalsTable,
  companiesTable,
  brandsTable,
  auditLogTable,
} from '@workspace/db';
import {
  allowedAccountIds,
  allowedDealIds,
  allowedCompanyIds,
  allowedBrandIds,
  hasActiveScopeFilter,
  activeScopeSnapshot,
} from '../../scope.js';
import type { AgentTool } from '../agent.js';

const num = (v: string | number | null | undefined): number =>
  v === null || v === undefined ? 0 : typeof v === 'number' ? v : Number(v);

// ─────────────────────────── Read-Tools ───────────────────────────

const SearchAccountsInput = z.object({
  query: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(20).optional(),
});
type SearchAccountsInputT = z.infer<typeof SearchAccountsInput>;

export const searchAccountsTool: AgentTool<
  SearchAccountsInputT,
  Array<{ id: string; name: string; industry: string; country: string; healthScore: number }>
> = {
  name: 'search_accounts',
  description:
    'Sucht Kunden (Accounts) im aktuellen Scope. query filtert per ILIKE auf den ' +
    'Namen. Liefert id, name, industry, country, healthScore. Nutze dieses Tool ' +
    'bevor du auf einen Kunden referenzierst.',
  inputSchema: SearchAccountsInput,
  async execute({ input, req }) {
    const accIds = await allowedAccountIds(req);
    if (accIds.size === 0) return [];
    const limit = input.limit ?? 10;
    const rows = await db
      .select({
        id: accountsTable.id,
        name: accountsTable.name,
        industry: accountsTable.industry,
        country: accountsTable.country,
        healthScore: accountsTable.healthScore,
      })
      .from(accountsTable)
      .where(inArray(accountsTable.id, [...accIds]));
    const filtered = input.query
      ? rows.filter((r) => r.name.toLowerCase().includes(input.query!.toLowerCase()))
      : rows;
    return filtered.slice(0, limit);
  },
};

const SearchDealsInput = z.object({
  query: z.string().max(120).optional(),
  stage: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  sortBy: z.enum(['updatedAt', 'value']).optional(),
});
type SearchDealsInputT = z.infer<typeof SearchDealsInput>;

export const searchDealsTool: AgentTool<
  SearchDealsInputT,
  Array<{
    id: string;
    name: string;
    stage: string;
    value: number;
    currency: string;
    accountId: string;
    accountName: string;
    expectedCloseDate: string;
  }>
> = {
  name: 'search_deals',
  description:
    'Sucht Deals (Verkaufschancen) im aktuellen Scope. Optional Filter ' +
    "stage (z.B. 'qualified', 'discovery', 'proposal', 'negotiation', " +
    "'closing', 'won', 'lost'). sortBy='value' liefert größte Deals zuerst. " +
    'Liefert id, name, stage, value, accountName, expectedCloseDate.',
  inputSchema: SearchDealsInput,
  async execute({ input, req }) {
    const dealIds = await allowedDealIds(req);
    if (dealIds.size === 0) return [];
    const filters = [inArray(dealsTable.id, [...dealIds])];
    if (input.stage) filters.push(eq(dealsTable.stage, input.stage));
    const order = input.sortBy === 'value' ? desc(dealsTable.value) : desc(dealsTable.updatedAt);
    const rows = await db
      .select({
        id: dealsTable.id,
        name: dealsTable.name,
        stage: dealsTable.stage,
        value: dealsTable.value,
        currency: dealsTable.currency,
        accountId: dealsTable.accountId,
        expectedCloseDate: dealsTable.expectedCloseDate,
        accountName: accountsTable.name,
      })
      .from(dealsTable)
      .leftJoin(accountsTable, eq(dealsTable.accountId, accountsTable.id))
      .where(and(...filters))
      .orderBy(order);
    const filtered = input.query
      ? rows.filter((d) =>
          d.name.toLowerCase().includes(input.query!.toLowerCase()) ||
          (d.accountName ?? '').toLowerCase().includes(input.query!.toLowerCase()),
        )
      : rows;
    const limit = input.limit ?? 10;
    return filtered.slice(0, limit).map((d) => ({
      id: d.id,
      name: d.name,
      stage: d.stage,
      value: num(d.value),
      currency: d.currency,
      accountId: d.accountId,
      accountName: d.accountName ?? '',
      expectedCloseDate: String(d.expectedCloseDate),
    }));
  },
};

const PipelineStatsInput = z.object({});
type PipelineStatsInputT = z.infer<typeof PipelineStatsInput>;

export const pipelineStatsTool: AgentTool<
  PipelineStatsInputT,
  {
    totals: { accounts: number; deals: number; quotes: number; contracts: number; approvals: number };
    byStage: Array<{ stage: string; count: number; valueSum: number }>;
    openValue: number;
    wonValue: number;
    pendingApprovals: number;
  }
> = {
  name: 'pipeline_stats',
  description:
    'Aggregierte Pipeline-Kennzahlen im aktuellen Scope: Anzahl Accounts/Deals/' +
    'Quotes/Contracts/Approvals, Deal-Verteilung nach Stage (count + valueSum), ' +
    'gesamter offener Pipeline-Wert, gewonnener Wert, ausstehende Approvals.',
  inputSchema: PipelineStatsInput,
  async execute({ req }) {
    const accIds = await allowedAccountIds(req);
    const dealIds = await allowedDealIds(req);
    const stats = {
      totals: {
        accounts: accIds.size,
        deals: dealIds.size,
        quotes: 0,
        contracts: 0,
        approvals: 0,
      },
      byStage: [] as Array<{ stage: string; count: number; valueSum: number }>,
      openValue: 0,
      wonValue: 0,
      pendingApprovals: 0,
    };
    if (dealIds.size === 0) return stats;
    const ds = await db
      .select({ stage: dealsTable.stage, value: dealsTable.value })
      .from(dealsTable)
      .where(inArray(dealsTable.id, [...dealIds]));
    const map = new Map<string, { count: number; valueSum: number }>();
    for (const d of ds) {
      const m = map.get(d.stage) ?? { count: 0, valueSum: 0 };
      m.count += 1;
      m.valueSum += num(d.value);
      map.set(d.stage, m);
      if (d.stage === 'won') stats.wonValue += num(d.value);
      else if (d.stage !== 'lost') stats.openValue += num(d.value);
    }
    stats.byStage = [...map.entries()].map(([stage, v]) => ({ stage, ...v }));
    const qs = await db.select({ id: quotesTable.id }).from(quotesTable).where(inArray(quotesTable.dealId, [...dealIds]));
    const cs = await db.select({ id: contractsTable.id }).from(contractsTable).where(inArray(contractsTable.dealId, [...dealIds]));
    const aps = await db.select({ id: approvalsTable.id, status: approvalsTable.status }).from(approvalsTable).where(inArray(approvalsTable.dealId, [...dealIds]));
    stats.totals.quotes = qs.length;
    stats.totals.contracts = cs.length;
    stats.totals.approvals = aps.length;
    stats.pendingApprovals = aps.filter((a) => a.status === 'pending').length;
    return stats;
  },
};

const RecentActivityInput = z.object({
  limit: z.number().int().min(1).max(20).optional(),
});
type RecentActivityInputT = z.infer<typeof RecentActivityInput>;

export const recentActivityTool: AgentTool<
  RecentActivityInputT,
  Array<{ at: string; entityType: string; entityId: string; action: string; summary: string; actor: string }>
> = {
  name: 'recent_activity',
  description:
    'Letzte Audit-Log-Einträge in deinem aktuellen Scope (max 20). Filtert ' +
    'auf Account/Deal/Contact-IDs, die im aktiven Scope sichtbar sind, sowie ' +
    'auf scope-unabhängige Tenant-Events (z.B. Approvals, Signaturen).',
  inputSchema: RecentActivityInput,
  async execute({ input, req, scope }) {
    const limit = input.limit ?? 8;
    // Pre-compute the visible ID sets so we can filter rows in JS — the audit
    // log is small (≤ a few thousand rows in the demo) and the user-facing
    // limit is tiny, so we over-fetch and post-filter rather than building a
    // massive SQL IN-list per entity type.
    const [allowedDeals, allowedAccs] = await Promise.all([
      allowedDealIds(req),
      allowedAccountIds(req),
    ]);
    const isTenantWide = scope.tenantWide === true;
    const rows = await db
      .select({
        at: auditLogTable.at,
        entityType: auditLogTable.entityType,
        entityId: auditLogTable.entityId,
        action: auditLogTable.action,
        summary: auditLogTable.summary,
        actor: auditLogTable.actor,
      })
      .from(auditLogTable)
      .where(eq(auditLogTable.tenantId, scope.tenantId))
      .orderBy(desc(auditLogTable.at))
      .limit(Math.max(limit * 6, 60));
    const filtered = rows.filter((r) => {
      if (isTenantWide) return true;
      // Entity types that map 1:1 to the scope guards we maintain.
      if (r.entityType === 'deal') return allowedDeals.has(r.entityId);
      if (r.entityType === 'account') return allowedAccs.has(r.entityId);
      // Other entity types (approval, signature_package, contract, quote …)
      // do not have a per-row scope index here yet; suppress them for
      // restricted users to avoid leaking out-of-scope IDs/summaries.
      return false;
    });
    return filtered.slice(0, limit).map((r) => ({
      at: r.at instanceof Date ? r.at.toISOString() : String(r.at),
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      summary: r.summary,
      actor: r.actor,
    }));
  },
};

// ─────────────────────────── Write-Tools ───────────────────────────

async function writeBotAudit(args: {
  tenantId: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  actor: string;
  scope: ReturnType<typeof activeScopeSnapshot>;
  after?: unknown;
}) {
  await db.insert(auditLogTable).values({
    id: `au_${randomUUID().slice(0, 10)}`,
    tenantId: args.tenantId,
    entityType: args.entityType,
    entityId: args.entityId,
    action: args.action,
    actor: args.actor,
    afterJson: args.after === undefined ? null : JSON.stringify(args.after),
    summary: args.summary,
    activeScopeJson: args.scope ? JSON.stringify(args.scope) : null,
  });
}

const CreateAccountInput = z.object({
  name: z.string().min(2).max(120),
  industry: z.string().min(2).max(80),
  country: z.string().min(2).max(80),
});
type CreateAccountInputT = z.infer<typeof CreateAccountInput>;

export const createAccountTool: AgentTool<
  CreateAccountInputT,
  { id: string; name: string; industry: string; country: string }
> = {
  name: 'create_account',
  description:
    'Creates a new customer (account). Required: name, industry, country (e.g. ' +
    "'Germany', 'Switzerland'). Returns the new id. Use this tool when the user " +
    'wants to create a new customer and all three fields are stated or obvious. ' +
    'Otherwise ask first.',
  inputSchema: CreateAccountInput,
  mutating: true,
  async execute({ input, req, scope }) {
    const id = `acc_${randomUUID().slice(0, 8)}`;
    await db.insert(accountsTable).values({
      id,
      name: input.name,
      industry: input.industry,
      country: input.country,
      healthScore: 70,
      ownerId: scope.user.id,
    });
    await writeBotAudit({
      tenantId: scope.tenantId,
      entityType: 'account',
      entityId: id,
      action: 'create',
      actor: `${scope.user.name} (HelpBot)`,
      summary: `Customer "${input.name}" created via Help Bot`,
      scope: activeScopeSnapshot(scope),
      after: { id, ...input },
    });
    return { id, name: input.name, industry: input.industry, country: input.country };
  },
};

const CreateContactInput = z.object({
  accountId: z.string().min(2).max(60),
  name: z.string().min(2).max(120),
  email: z.string().min(3).max(160),
  role: z.string().min(2).max(80),
});
type CreateContactInputT = z.infer<typeof CreateContactInput>;

export const createContactTool: AgentTool<
  CreateContactInputT,
  { id: string; accountId: string; name: string; email: string; role: string }
> = {
  name: 'create_contact',
  description:
    'Legt einen Kontakt (Person) für einen Account an. accountId muss eine ID ' +
    'aus search_accounts sein. Pflicht: accountId, name, email, role.',
  inputSchema: CreateContactInput,
  mutating: true,
  async execute({ input, req, scope }) {
    const accIds = await allowedAccountIds(req);
    if (!accIds.has(input.accountId)) {
      throw new Error('accountId is not in your scope or does not exist');
    }
    const id = `ct_${randomUUID().slice(0, 8)}`;
    await db.insert(contactsTable).values({
      id,
      accountId: input.accountId,
      name: input.name,
      email: input.email,
      role: input.role,
      isDecisionMaker: false,
    });
    await writeBotAudit({
      tenantId: scope.tenantId,
      entityType: 'contact',
      entityId: id,
      action: 'create',
      actor: `${scope.user.name} (HelpBot)`,
      summary: `Contact "${input.name}" created via Help Bot`,
      scope: activeScopeSnapshot(scope),
      after: { id, ...input },
    });
    return { id, accountId: input.accountId, name: input.name, email: input.email, role: input.role };
  },
};

const DEAL_STAGES = ['qualified', 'discovery', 'proposal', 'negotiation', 'closing', 'won', 'lost'] as const;

const CreateDealInput = z.object({
  name: z.string().min(2).max(160),
  accountId: z.string().min(2).max(60),
  value: z.number().min(0).max(1_000_000_000),
  stage: z.enum(DEAL_STAGES).optional(),
  expectedCloseDate: z.string().min(8).max(20).optional(),
  brandId: z.string().min(2).max(60).optional(),
});
type CreateDealInputT = z.infer<typeof CreateDealInput>;

export const createDealTool: AgentTool<
  CreateDealInputT,
  { id: string; name: string; accountId: string; stage: string; value: number; currency: string }
> = {
  name: 'create_deal',
  description:
    'Legt einen neuen Deal an. Pflicht: name, accountId (aus search_accounts), ' +
    'value (Zahl in Account-Währung). Optional: stage (default qualified), ' +
    'expectedCloseDate (ISO YYYY-MM-DD, default +90 Tage), brandId. ' +
    'Bei fehlendem brandId wird die erste Brand des Kunden-Tenants im aktuellen ' +
    'Scope verwendet.',
  inputSchema: CreateDealInput,
  mutating: true,
  async execute({ input, req, scope }) {
    const allowedAccs = await allowedAccountIds(req);
    if (!allowedAccs.has(input.accountId)) {
      throw new Error('accountId is not in your scope or does not exist');
    }
    // Companies sind über deals.account...nicht direkt verlinkt. Wähle die
    // erste sichtbare company/brand-Kombination im aktuellen Scope.
    const allowedCo = await allowedCompanyIds(req);
    const allowedBr = await allowedBrandIds(req);
    if (allowedCo.length === 0 || allowedBr.length === 0) {
      throw new Error('No company/brand visible in current scope to assign the deal to');
    }
    // Wenn der Nutzer mehrere Brands sehen kann und KEINE explizit gewählt
    // hat, ist es gefährlich, einfach die erste zu nehmen — das könnte den
    // Deal in der falschen Business-Unit landen lassen. Stattdessen den
    // Agent zwingen, brandId zu erfragen.
    if (!input.brandId && allowedBr.length > 1) {
      throw new Error(
        `Mehrere Brands im Scope (${allowedBr.length}) — gib brandId explizit an, sonst landet der Deal evtl. in der falschen Business-Unit.`,
      );
    }
    let brandId = input.brandId ?? allowedBr[0]!;
    if (!allowedBr.includes(brandId)) {
      throw new Error(`brandId "${brandId}" ist nicht in deinem Scope`);
    }
    const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.id, brandId));
    if (!brand) throw new Error('brand lookup failed');
    let companyId = brand.companyId;
    if (!allowedCo.includes(companyId)) companyId = allowedCo[0]!;
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!company || company.tenantId !== scope.tenantId) throw new Error('company out of tenant');
    const stage = input.stage ?? 'qualified';
    const expectedCloseDate =
      input.expectedCloseDate ??
      new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString().slice(0, 10);
    const id = `dl_${randomUUID().slice(0, 8)}`;
    await db.insert(dealsTable).values({
      id,
      name: input.name,
      accountId: input.accountId,
      stage,
      value: String(input.value),
      currency: company.currency,
      probability: 30,
      expectedCloseDate,
      ownerId: scope.user.id,
      brandId,
      companyId,
      riskLevel: 'low',
      nextStep: null,
    });
    await writeBotAudit({
      tenantId: scope.tenantId,
      entityType: 'deal',
      entityId: id,
      action: 'create',
      actor: `${scope.user.name} (HelpBot)`,
      summary: `Deal "${input.name}" created via Help Bot (${input.value} ${company.currency})`,
      scope: activeScopeSnapshot(scope),
      after: { id, name: input.name, accountId: input.accountId, value: input.value, stage, brandId, companyId },
    });
    return { id, name: input.name, accountId: input.accountId, stage, value: input.value, currency: company.currency };
  },
};

// ─────────────────────────── Bundle ───────────────────────────

export const HELP_BOT_TOOLS = [
  searchAccountsTool,
  searchDealsTool,
  pipelineStatsTool,
  recentActivityTool,
  createAccountTool,
  createContactTool,
  createDealTool,
] as const;

// `unknown` cast keeps the AnyAgentTool shape without coupling consumers to
// the tool-specific input/output generic params.
export const HELP_BOT_TOOLS_AS_AGENT_TOOLS = HELP_BOT_TOOLS as ReadonlyArray<
  AgentTool<unknown, unknown>
>;

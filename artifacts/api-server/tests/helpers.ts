import { randomBytes } from "node:crypto";
import { eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  tenantsTable,
  companiesTable,
  brandsTable,
  usersTable,
  accountsTable,
  dealsTable,
  approvalsTable,
  signaturePackagesTable,
  quotesTable,
  timelineEventsTable,
  auditLogTable,
  sessionsTable,
  contractsTable,
  negotiationsTable,
  orderConfirmationsTable,
  copilotInsightsTable,
  copilotThreadsTable,
  pricePositionsTable,
} from "@workspace/db";
import { hashPassword } from "../src/lib/auth";

const TEST_PREFIX = "tnt_iso";

export interface TestWorld {
  runId: string;
  tenantId: string;
  companyId: string;
  brandId: string;
  userId: string;
  userEmail: string;
  password: string;
  accountId: string;
  dealId: string;
  approvalId: string;
  signaturePackageId: string;
  quoteId: string;
  timelineEventId: string;
  /**
   * Timeline event with a NULL dealId — must never appear in /activity or
   * /reports/dashboard.recentEvents because it carries no tenant binding.
   */
  nullTimelineEventId: string;
  auditId: string;
  contractId: string;
  negotiationId: string;
  orderConfirmationId: string;
  copilotInsightId: string;
  copilotThreadId: string;
  pricePositionId: string;
}

/**
 * Build a fully self-contained tenant world: tenant + company + brand + user
 * (tenant-wide, with password) + account + deal + approval + signature pkg +
 * quote + timeline events (one bound to deal, one with NULL dealId) + audit
 * log entry. All IDs are prefixed with `<runId>` so two worlds never collide.
 */
export async function createTestWorld(label: string): Promise<TestWorld> {
  const runId = `${TEST_PREFIX}_${label}_${randomBytes(4).toString("hex")}`;
  const tenantId = `${runId}_tn`;
  const companyId = `${runId}_co`;
  const brandId = `${runId}_br`;
  const userId = `${runId}_us`;
  // Login normalises email via .trim().toLowerCase() — store lowercase too so
  // lookups match.
  const userEmail = `${runId}@example.test`.toLowerCase();
  const password = "test-pw-123!";
  const accountId = `${runId}_ac`;
  const dealId = `${runId}_dl`;
  const approvalId = `${runId}_ap`;
  const signaturePackageId = `${runId}_sg`;
  const quoteId = `${runId}_qt`;
  const timelineEventId = `${runId}_tl`;
  const nullTimelineEventId = `${runId}_tlnull`;
  const auditId = `${runId}_au`;
  const contractId = `${runId}_ctr`;
  const negotiationId = `${runId}_neg`;
  const orderConfirmationId = `${runId}_oc`;
  const copilotInsightId = `${runId}_ci`;
  const copilotThreadId = `${runId}_ct`;
  const pricePositionId = `${runId}_pp`;

  await db.insert(tenantsTable).values({
    id: tenantId,
    name: `Test Tenant ${label}`,
    plan: "Test",
    region: "EU",
  });

  await db.insert(companiesTable).values({
    id: companyId,
    tenantId,
    name: `Test Co ${label}`,
    legalName: `Test Co ${label} GmbH`,
    country: "DE",
    currency: "EUR",
  });

  await db.insert(brandsTable).values({
    id: brandId,
    companyId,
    name: `Test Brand ${label}`,
    color: "#000000",
    voice: "neutral",
  });

  await db.insert(usersTable).values({
    id: userId,
    name: `Test User ${label}`,
    email: userEmail,
    role: "Account Executive",
    scope: `tenant:${tenantId}`,
    initials: label.slice(0, 2).toUpperCase(),
    passwordHash: hashPassword(password),
    isActive: true,
    tenantId,
    tenantWide: true,
    scopeCompanyIds: "[]",
    scopeBrandIds: "[]",
  });

  await db.insert(accountsTable).values({
    id: accountId,
    name: `Test Account ${label}`,
    industry: "Test",
    country: "DE",
    healthScore: 80,
    ownerId: userId,
  });

  await db.insert(dealsTable).values({
    id: dealId,
    name: `Test Deal ${label}`,
    accountId,
    stage: "qualified",
    value: "100000",
    currency: "EUR",
    probability: 30,
    expectedCloseDate: new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10),
    ownerId: userId,
    brandId,
    companyId,
    riskLevel: "low",
    nextStep: null,
  });

  await db.insert(approvalsTable).values({
    id: approvalId,
    dealId,
    type: "discount",
    reason: `Test approval ${label}`,
    requestedBy: userId,
    status: "pending",
    priority: "medium",
    impactValue: "1000",
    currency: "EUR",
  });

  await db.insert(signaturePackagesTable).values({
    id: signaturePackageId,
    dealId,
    title: `Test Sig ${label}`,
    status: "in_progress",
  });

  await db.insert(quotesTable).values({
    id: quoteId,
    dealId,
    number: `Q-${label}`,
    status: "sent",
    currentVersion: 1,
    currency: "EUR",
    validUntil: new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10),
  });

  await db.insert(timelineEventsTable).values({
    id: timelineEventId,
    tenantId,
    type: "deal",
    title: `Deal updated (${label})`,
    description: `Activity in tenant ${label}`,
    actor: userId,
    dealId,
  });

  // A NULL-dealId timeline event. timeline_events now carries an explicit
  // tenant_id column (NOT NULL, no default), so these tenant-global events
  // are properly scoped to their own tenant — visible to that tenant's
  // /activity and /reports/dashboard, invisible to every other tenant.
  await db.insert(timelineEventsTable).values({
    id: nullTimelineEventId,
    tenantId,
    type: "system",
    title: `NULL-dealId event (${label})`,
    description: `Tenant-global note from ${label}`,
    actor: userId,
    dealId: null,
  });

  await db.insert(auditLogTable).values({
    id: auditId,
    tenantId,
    entityType: "deal",
    entityId: dealId,
    action: "created",
    actor: userId,
    summary: `Deal created in tenant ${label}`,
  });

  await db.insert(contractsTable).values({
    id: contractId,
    dealId,
    title: `Test Contract ${label}`,
    status: "drafting",
    version: 1,
    riskLevel: "low",
    template: "standard",
  });

  await db.insert(negotiationsTable).values({
    id: negotiationId,
    dealId,
    status: "open",
    round: 1,
    lastReactionType: "objection",
    riskLevel: "low",
  });

  await db.insert(orderConfirmationsTable).values({
    id: orderConfirmationId,
    dealId,
    number: `OC-${label}`,
    status: "in_preparation",
    readinessScore: 0,
    totalAmount: "100000",
    currency: "EUR",
    slaDays: 7,
  });

  // dealId-bound insight; trigger fields stay NULL so the unique index
  // (triggerType, triggerEntityRef) does not collide between worlds.
  await db.insert(copilotInsightsTable).values({
    id: copilotInsightId,
    kind: "risk",
    title: `Insight ${label}`,
    summary: `Tenant ${label} insight`,
    severity: "medium",
    dealId,
    status: "open",
  });

  // dealId-scoped thread — only users with access to the deal must see it.
  await db.insert(copilotThreadsTable).values({
    id: copilotThreadId,
    title: `Thread ${label}`,
    scope: `deal:${dealId}`,
    lastMessage: `Hello from ${label}`,
    messageCount: 1,
  });

  // price position — scoped through company.tenantId, NOT through dealId.
  await db.insert(pricePositionsTable).values({
    id: pricePositionId,
    sku: `SKU-${runId}`,
    name: `Test Price Position ${label}`,
    category: "test",
    listPrice: "1000",
    currency: "EUR",
    status: "active",
    validFrom: new Date().toISOString().slice(0, 10),
    brandId,
    companyId,
    version: 1,
    isStandard: true,
  });

  return {
    runId,
    tenantId,
    companyId,
    brandId,
    userId,
    userEmail,
    password,
    accountId,
    dealId,
    approvalId,
    signaturePackageId,
    quoteId,
    timelineEventId,
    nullTimelineEventId,
    auditId,
    contractId,
    negotiationId,
    orderConfirmationId,
    copilotInsightId,
    copilotThreadId,
    pricePositionId,
  };
}

/**
 * IDs of the extra dealflow rows created by `seedExtraDealflowItems` so the
 * caller can pass them to `cleanupExtraDealflowItems` in a `finally` block.
 */
export interface ExtraDealflowIds {
  approvalIds: string[];
  signaturePackageIds: string[];
  quoteIds: string[];
}

/**
 * Add `count` extra pending approvals + in_progress signature packages + sent
 * quotes against an existing deal. Used by the dashboard precision check to
 * verify that another tenant's dashboard counts are unaffected.
 */
export async function seedExtraDealflowItems(
  dealId: string,
  userId: string,
  count: number,
): Promise<ExtraDealflowIds> {
  const approvalIds: string[] = [];
  const signaturePackageIds: string[] = [];
  const quoteIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const suffix = randomBytes(4).toString("hex");
    const apId = `${TEST_PREFIX}_extra_ap_${suffix}`;
    const sgId = `${TEST_PREFIX}_extra_sg_${suffix}`;
    const qtId = `${TEST_PREFIX}_extra_qt_${suffix}`;
    await db.insert(approvalsTable).values({
      id: apId,
      dealId,
      type: "discount",
      reason: `Extra approval ${i}`,
      requestedBy: userId,
      status: "pending",
      priority: "low",
      impactValue: "100",
      currency: "EUR",
    });
    await db.insert(signaturePackagesTable).values({
      id: sgId,
      dealId,
      title: `Extra Sig ${i}`,
      status: "in_progress",
    });
    await db.insert(quotesTable).values({
      id: qtId,
      dealId,
      number: `Q-EXTRA-${suffix}`,
      status: "sent",
      currentVersion: 1,
      currency: "EUR",
      validUntil: new Date(Date.now() + 30 * 86400000)
        .toISOString()
        .slice(0, 10),
    });
    approvalIds.push(apId);
    signaturePackageIds.push(sgId);
    quoteIds.push(qtId);
  }
  return { approvalIds, signaturePackageIds, quoteIds };
}

/** Variants used to exercise the visibility logic in `copilotThreadVisible`. */
export interface ThreadScopeVariantIds {
  /** scope = "global" — visible to everyone (intentional). */
  global: string;
  /** scope = "deal:<own deal>" — visible only to the owning tenant. */
  deal: string;
  /** scope = "account:<own account>" — visible only to the owning tenant. */
  account: string;
  /** scope = "tenant:<own tenant>" — currently never visible. */
  tenant: string;
  /** scope = "" — empty string is treated as "global" today. */
  empty: string;
  /** scope = "garbage" — malformed; must not be visible. */
  malformed: string;
}

/**
 * Seed the full set of `copilot_threads.scope` variants for one tenant world.
 * Used by the matrix test that pins down what each variant should resolve to
 * when the requester belongs to a different tenant.
 */
export async function seedThreadScopeVariants(
  world: TestWorld,
): Promise<ThreadScopeVariantIds> {
  const mk = (suffix: string) => `${TEST_PREFIX}_var_${world.runId}_${suffix}`;
  const ids: ThreadScopeVariantIds = {
    global: mk("global"),
    deal: mk("deal"),
    account: mk("account"),
    tenant: mk("tenant"),
    empty: mk("empty"),
    malformed: mk("malformed"),
  };
  const rows = [
    { id: ids.global, scope: "global" },
    { id: ids.deal, scope: `deal:${world.dealId}` },
    { id: ids.account, scope: `account:${world.accountId}` },
    { id: ids.tenant, scope: `tenant:${world.tenantId}` },
    { id: ids.empty, scope: "" },
    { id: ids.malformed, scope: "garbage-no-colon" },
  ];
  for (const r of rows) {
    await db.insert(copilotThreadsTable).values({
      id: r.id,
      title: `Variant ${r.scope || "empty"} (${world.runId})`,
      scope: r.scope,
      lastMessage: "test",
      messageCount: 1,
    });
  }
  return ids;
}

export async function cleanupThreadScopeVariants(
  ...variants: ThreadScopeVariantIds[]
): Promise<void> {
  const all = variants.flatMap((v) => Object.values(v));
  if (all.length === 0) return;
  await db.delete(copilotThreadsTable).where(inArray(copilotThreadsTable.id, all));
}

export async function cleanupExtraDealflowItems(extras: ExtraDealflowIds): Promise<void> {
  if (extras.approvalIds.length) {
    await db.delete(approvalsTable).where(inArray(approvalsTable.id, extras.approvalIds));
  }
  if (extras.signaturePackageIds.length) {
    await db
      .delete(signaturePackagesTable)
      .where(inArray(signaturePackagesTable.id, extras.signaturePackageIds));
  }
  if (extras.quoteIds.length) {
    await db.delete(quotesTable).where(inArray(quotesTable.id, extras.quoteIds));
  }
}

/** Hard delete every row created by createTestWorld for the given tenants. */
export async function destroyTestWorlds(...worlds: TestWorld[]): Promise<void> {
  if (worlds.length === 0) return;
  const tenantIds = worlds.map((w) => w.tenantId);
  const userIds = worlds.map((w) => w.userId);
  const dealIds = worlds.map((w) => w.dealId);
  const accountIds = worlds.map((w) => w.accountId);
  const companyIds = worlds.map((w) => w.companyId);
  const brandIds = worlds.map((w) => w.brandId);
  const approvalIds = worlds.map((w) => w.approvalId);
  const sigIds = worlds.map((w) => w.signaturePackageId);
  const quoteIds = worlds.map((w) => w.quoteId);
  const timelineIds = worlds.flatMap((w) => [w.timelineEventId, w.nullTimelineEventId]);
  const auditIds = worlds.map((w) => w.auditId);
  const contractIds = worlds.map((w) => w.contractId);
  const negotiationIds = worlds.map((w) => w.negotiationId);
  const ocIds = worlds.map((w) => w.orderConfirmationId);
  const insightIds = worlds.map((w) => w.copilotInsightId);
  const threadIds = worlds.map((w) => w.copilotThreadId);
  const ppIds = worlds.map((w) => w.pricePositionId);

  await db.delete(sessionsTable).where(inArray(sessionsTable.userId, userIds));
  await db.delete(pricePositionsTable).where(inArray(pricePositionsTable.id, ppIds));
  await db.delete(timelineEventsTable).where(
    or(
      inArray(timelineEventsTable.id, timelineIds),
      inArray(timelineEventsTable.dealId, dealIds),
    )!,
  );
  await db.delete(auditLogTable).where(inArray(auditLogTable.id, auditIds));
  await db.delete(copilotThreadsTable).where(inArray(copilotThreadsTable.id, threadIds));
  await db.delete(copilotInsightsTable).where(inArray(copilotInsightsTable.id, insightIds));
  await db.delete(orderConfirmationsTable).where(inArray(orderConfirmationsTable.id, ocIds));
  await db.delete(negotiationsTable).where(inArray(negotiationsTable.id, negotiationIds));
  await db.delete(contractsTable).where(inArray(contractsTable.id, contractIds));
  await db.delete(approvalsTable).where(inArray(approvalsTable.id, approvalIds));
  await db.delete(signaturePackagesTable).where(inArray(signaturePackagesTable.id, sigIds));
  await db.delete(quotesTable).where(inArray(quotesTable.id, quoteIds));
  await db.delete(dealsTable).where(inArray(dealsTable.id, dealIds));
  await db.delete(accountsTable).where(inArray(accountsTable.id, accountIds));
  await db.delete(usersTable).where(inArray(usersTable.id, userIds));
  await db.delete(brandsTable).where(inArray(brandsTable.id, brandIds));
  await db.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
  await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
}

/**
 * Sweep any leftover rows from past failed test runs (prefix-based). Idempotent
 * and safe — only touches rows whose ID starts with TEST_PREFIX.
 */
export async function sweepStaleTestData(): Promise<void> {
  // Use ESCAPE so the literal underscores in TEST_PREFIX are not LIKE
  // wildcards. We escape the trailing-`_` separator and use `%` only as
  // suffix wildcard.
  const like = `${TEST_PREFIX}\\_%`;
  const ESC = sql.raw("ESCAPE '\\'");
  const tenants = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(sql`${tenantsTable.id} LIKE ${like} ${ESC}`);
  const companies = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(sql`${companiesTable.id} LIKE ${like} ${ESC}`);
  const users = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(sql`${usersTable.id} LIKE ${like} ${ESC}`);
  const deals = await db
    .select({ id: dealsTable.id })
    .from(dealsTable)
    .where(sql`${dealsTable.id} LIKE ${like} ${ESC}`);

  if (deals.length) {
    const dealIdList = deals.map((d) => d.id);
    await db.delete(timelineEventsTable).where(
      inArray(timelineEventsTable.dealId, dealIdList),
    );
    await db.delete(copilotThreadsTable).where(
      inArray(
        copilotThreadsTable.scope,
        dealIdList.map((id) => `deal:${id}`),
      ),
    );
    await db.delete(copilotInsightsTable).where(
      inArray(copilotInsightsTable.dealId, dealIdList),
    );
    await db.delete(orderConfirmationsTable).where(
      inArray(orderConfirmationsTable.dealId, dealIdList),
    );
    await db.delete(negotiationsTable).where(
      inArray(negotiationsTable.dealId, dealIdList),
    );
    await db.delete(contractsTable).where(
      inArray(contractsTable.dealId, dealIdList),
    );
    await db.delete(approvalsTable).where(
      inArray(approvalsTable.dealId, dealIdList),
    );
    await db.delete(signaturePackagesTable).where(
      inArray(signaturePackagesTable.dealId, dealIdList),
    );
    await db.delete(quotesTable).where(
      inArray(quotesTable.dealId, dealIdList),
    );
    await db.delete(dealsTable).where(inArray(dealsTable.id, dealIdList));
  }
  // Sweep extras inserted by seedExtraDealflowItems even if no test deal
  // remains (e.g. a previous test crashed between insert and cleanup).
  await db.delete(approvalsTable).where(sql`${approvalsTable.id} LIKE ${like} ${ESC}`);
  await db.delete(signaturePackagesTable).where(sql`${signaturePackagesTable.id} LIKE ${like} ${ESC}`);
  await db.delete(quotesTable).where(sql`${quotesTable.id} LIKE ${like} ${ESC}`);
  await db.delete(timelineEventsTable).where(sql`${timelineEventsTable.id} LIKE ${like} ${ESC}`);
  await db.delete(auditLogTable).where(sql`${auditLogTable.id} LIKE ${like} ${ESC}`);
  await db.delete(copilotThreadsTable).where(sql`${copilotThreadsTable.id} LIKE ${like} ${ESC}`);
  await db.delete(copilotInsightsTable).where(sql`${copilotInsightsTable.id} LIKE ${like} ${ESC}`);
  await db.delete(orderConfirmationsTable).where(sql`${orderConfirmationsTable.id} LIKE ${like} ${ESC}`);
  await db.delete(negotiationsTable).where(sql`${negotiationsTable.id} LIKE ${like} ${ESC}`);
  await db.delete(contractsTable).where(sql`${contractsTable.id} LIKE ${like} ${ESC}`);
  await db.delete(pricePositionsTable).where(sql`${pricePositionsTable.id} LIKE ${like} ${ESC}`);
  await db.delete(accountsTable).where(sql`${accountsTable.id} LIKE ${like} ${ESC}`);
  if (users.length) {
    await db.delete(sessionsTable).where(inArray(sessionsTable.userId, users.map((u) => u.id)));
    await db.delete(usersTable).where(inArray(usersTable.id, users.map((u) => u.id)));
  }
  await db.delete(brandsTable).where(sql`${brandsTable.id} LIKE ${like} ${ESC}`);
  if (companies.length) {
    await db.delete(companiesTable).where(inArray(companiesTable.id, companies.map((c) => c.id)));
  }
  if (tenants.length) {
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenants.map((t) => t.id)));
  }
}

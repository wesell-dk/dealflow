import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lt, desc } from 'drizzle-orm';
import {
  db,
  copilotInsightsTable,
  customerReactionsTable,
  negotiationsTable,
  approvalsTable,
  priceIncreaseLettersTable,
  quoteVersionsTable,
  quotesTable,
  dealsTable,
  companiesTable,
} from '@workspace/db';

/**
 * Resolve the tenantId an insight should belong to from its dealId. Insights
 * carry a NOT NULL tenantId column so that /copilot/insights can SQL-filter
 * by tenant — this lookup is the single source of truth used by every
 * insight writer below.
 */
async function tenantIdForDeal(dealId: string): Promise<string | null> {
  const rows = await db
    .select({ tenantId: companiesTable.tenantId })
    .from(dealsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, dealsTable.companyId))
    .where(eq(dealsTable.id, dealId))
    .limit(1);
  return rows[0]?.tenantId ?? null;
}

type InsightSeed = {
  kind: string;
  title: string;
  summary: string;
  severity: string;
  dealId: string;
  suggestedAction: string | null;
  triggerType: string;
  triggerEntityRef: string;
  actionType: string | null;
  actionPayload: Record<string, unknown> | null;
};

async function upsertInsight(seed: InsightSeed): Promise<void> {
  const existing = await db
    .select({ id: copilotInsightsTable.id })
    .from(copilotInsightsTable)
    .where(and(
      eq(copilotInsightsTable.triggerType, seed.triggerType),
      eq(copilotInsightsTable.triggerEntityRef, seed.triggerEntityRef),
    ));
  if (existing.length > 0) return;
  // tenantId is mandatory on copilot_insights so the list endpoint can
  // SQL-filter by tenant. We resolve it from the deal's company; if the
  // deal has been deleted we silently skip (the insight would be orphan).
  const tenantId = await tenantIdForDeal(seed.dealId);
  if (!tenantId) return;
  // onConflictDoNothing guards against concurrent inserts (unique index on
  // trigger_type+trigger_entity_ref, created lazily by ensureInsightsIndex).
  await db.insert(copilotInsightsTable).values({
    id: `ci_${randomUUID().slice(0, 8)}`,
    tenantId,
    kind: seed.kind,
    title: seed.title,
    summary: seed.summary,
    severity: seed.severity,
    dealId: seed.dealId,
    suggestedAction: seed.suggestedAction,
    triggerType: seed.triggerType,
    triggerEntityRef: seed.triggerEntityRef,
    status: 'open',
    actionType: seed.actionType,
    actionPayload: seed.actionPayload as never,
  }).onConflictDoNothing();
}

async function retireStaleInsights(
  triggerType: string,
  triggerEntityRef: string,
): Promise<void> {
  await db.update(copilotInsightsTable)
    .set({ status: 'resolved', resolvedAt: new Date() })
    .where(and(
      eq(copilotInsightsTable.triggerType, triggerType),
      eq(copilotInsightsTable.triggerEntityRef, triggerEntityRef),
      inArray(copilotInsightsTable.status, ['open', 'acknowledged']),
    ));
}

async function findDealForAccount(accountId: string): Promise<string | null> {
  const rows = await db.select().from(dealsTable)
    .where(eq(dealsTable.accountId, accountId))
    .orderBy(desc(dealsTable.updatedAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

// ── Generators ──────────────────────────────────────────────────────

export async function generatePriceRejectionForReaction(reactionId: string): Promise<void> {
  const [r] = await db.select().from(customerReactionsTable)
    .where(eq(customerReactionsTable.id, reactionId));
  if (!r) return;
  const [n] = await db.select().from(negotiationsTable)
    .where(eq(negotiationsTable.id, r.negotiationId));
  if (!n) return;
  const isPriceRejection =
    r.type === 'price_rejection' ||
    r.type === 'rejection' ||
    (r.topic?.toLowerCase().includes('preis') ?? false) ||
    (r.topic?.toLowerCase().includes('price') ?? false) ||
    (r.priceDeltaPct != null && Number(r.priceDeltaPct) < 0);
  if (!isPriceRejection) return;
  const delta = r.priceDeltaPct != null ? Number(r.priceDeltaPct) : -5;
  await upsertInsight({
    kind: 'risk',
    title: `Preis-Ablehnung auf ${r.topic}`,
    summary: `Kunde lehnte Angebot ab (${delta}% Delta angefragt). Neue Quote-Version empfohlen.`,
    severity: Math.abs(delta) >= 10 ? 'high' : 'medium',
    dealId: n.dealId,
    suggestedAction: 'Neue Quote-Version mit angepasstem Rabatt erzeugen.',
    triggerType: 'price_rejection',
    triggerEntityRef: r.id,
    actionType: 'create_quote_version',
    actionPayload: { reactionId: r.id, negotiationId: n.id, priceDeltaPct: delta },
  });
}

export async function generateHighDiscountForApproval(approvalId: string): Promise<void> {
  const [a] = await db.select().from(approvalsTable)
    .where(eq(approvalsTable.id, approvalId));
  if (!a) return;
  // Use impactValue as discount proxy (EUR discount volume) OR parse reason
  const impact = a.impactValue ? Number(a.impactValue) : 0;
  const reasonPctMatch = a.reason.match(/(\d+(?:[.,]\d+)?)\s*%/);
  const pct = reasonPctMatch ? Number(reasonPctMatch[1].replace(',', '.')) : 0;
  const isDiscountApproval = a.type === 'discount' || pct >= 10 || impact >= 50000;
  if (!isDiscountApproval) return;
  await upsertInsight({
    kind: 'risk',
    title: 'Discount-Discipline-Risk',
    summary: `Hoher Rabatt-Approval offen (${pct > 0 ? pct + '%' : `EUR ${impact}`}). Median gewonnener Deals liegt bei 7,8%.`,
    severity: pct >= 15 || impact >= 100000 ? 'high' : 'medium',
    dealId: a.dealId,
    suggestedAction: 'Approval eskalieren oder Gegenangebot mit niedrigerem Rabatt.',
    triggerType: 'high_discount',
    triggerEntityRef: a.id,
    actionType: 'escalate_approval',
    actionPayload: { approvalId: a.id },
  });
}

export async function generateStaleLetterForLetter(letterId: string, staleDays = 14): Promise<void> {
  const [l] = await db.select().from(priceIncreaseLettersTable)
    .where(eq(priceIncreaseLettersTable.id, letterId));
  if (!l) return;
  if (l.respondedAt) { await retireStaleInsights('stale_letter', l.id); return; }
  if (!l.sentAt) return;
  const ageMs = Date.now() - new Date(l.sentAt).getTime();
  const ageDays = Math.floor(ageMs / 86400000);
  if (ageDays < staleDays) return;
  // Letters are account-scoped; map to a real deal for scope-gating.
  const dealId = await findDealForAccount(l.accountId);
  if (!dealId) return;
  await upsertInsight({
    kind: 'next_action',
    title: 'Preiserhöhung ohne Antwort',
    summary: `Letter sendete vor ${ageDays} Tagen und ist ohne Kundenreaktion. Reminder senden.`,
    severity: ageDays >= 30 ? 'high' : 'medium',
    dealId,
    suggestedAction: 'Reminder-Mail an Kunden senden.',
    triggerType: 'stale_letter',
    triggerEntityRef: l.id,
    actionType: 'send_letter_reminder',
    actionPayload: { letterId: l.id, accountId: l.accountId },
  });
}

export async function generateStaleLettersForAll(staleDays = 14): Promise<void> {
  const cutoff = new Date(Date.now() - staleDays * 86400000);
  const rows = await db.select().from(priceIncreaseLettersTable)
    .where(and(
      lt(priceIncreaseLettersTable.sentAt, cutoff),
    ));
  for (const l of rows) {
    if (l.respondedAt) continue;
    await generateStaleLetterForLetter(l.id, staleDays);
  }
}

export async function generateLowMarginForQuoteVersion(quoteVersionId: string, floorPct = 25): Promise<void> {
  const [v] = await db.select().from(quoteVersionsTable)
    .where(eq(quoteVersionsTable.id, quoteVersionId));
  if (!v) return;
  const margin = v.marginPct != null ? Number(v.marginPct) : 100;
  if (margin >= floorPct) return;
  const [q] = await db.select().from(quotesTable)
    .where(eq(quotesTable.id, v.quoteId));
  if (!q) return;
  await upsertInsight({
    kind: 'risk',
    title: `Margin unter ${floorPct}%`,
    summary: `Quote v${v.version} liegt bei ${margin.toFixed(1)}% Marge — unterhalb ${floorPct}%-Floor.`,
    severity: margin < floorPct - 10 ? 'high' : 'medium',
    dealId: q.dealId,
    suggestedAction: 'Preis anheben oder Rabatt reduzieren; Deal-Desk einbinden.',
    triggerType: 'low_margin',
    triggerEntityRef: v.id,
    actionType: 'escalate_margin',
    actionPayload: { quoteId: q.id, quoteVersionId: v.id },
  });
}

export async function generateLowMarginForAll(floorPct = 25): Promise<void> {
  const rows = await db.select().from(quoteVersionsTable);
  for (const v of rows) {
    const margin = v.marginPct != null ? Number(v.marginPct) : 100;
    if (margin < floorPct) await generateLowMarginForQuoteVersion(v.id, floorPct);
  }
}

export async function generateHighDiscountForAll(): Promise<void> {
  const rows = await db.select().from(approvalsTable)
    .where(eq(approvalsTable.status, 'pending'));
  for (const a of rows) await generateHighDiscountForApproval(a.id);
}

export async function generatePriceRejectionForAll(): Promise<void> {
  const rows = await db.select().from(customerReactionsTable);
  for (const r of rows) await generatePriceRejectionForReaction(r.id);
}

// Full pass, run at boot after seeding and after bulk changes.
export async function runAllGenerators(): Promise<void> {
  await generatePriceRejectionForAll();
  await generateHighDiscountForAll();
  await generateStaleLettersForAll();
  await generateLowMarginForAll();
}

// Called when trigger entity changes in a way that voids the insight.
export async function resolveInsightsFor(
  triggerType: string,
  triggerEntityRef: string,
): Promise<void> {
  await retireStaleInsights(triggerType, triggerEntityRef);
}

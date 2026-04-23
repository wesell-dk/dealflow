import { and, eq, inArray, lt } from "drizzle-orm";
import archiver from "archiver";
import { PassThrough, Readable } from "node:stream";
import { randomUUID, createHash } from "node:crypto";
import type { Response } from "express";
import {
  db,
  contactsTable,
  accountsTable,
  dealsTable,
  quotesTable,
  quoteVersionsTable,
  negotiationsTable,
  customerReactionsTable,
  timelineEventsTable,
  approvalsTable,
  priceIncreaseLettersTable,
  signersTable,
  signaturePackagesTable,
  subjectsDeletionLogTable,
  accessLogTable,
  auditLogTable,
  tenantsTable,
  companiesTable,
} from "@workspace/db";

export type SubjectType = "contact";

export function pseudonymFor(id: string, field: string): string {
  const h = createHash("sha256").update(`${id}:${field}`).digest("hex").slice(0, 8);
  return `[GELÖSCHT-${h}]`;
}

async function collectForContact(
  tenantId: string,
  contactId: string,
): Promise<Record<string, unknown[]>> {
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, contactId));
  if (!contact) return {};
  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, contact.accountId));
  // Tenant-bound: only include deals whose company belongs to tenant
  const tenantCompanies = await db.select({ id: companiesTable.id })
    .from(companiesTable).where(eq(companiesTable.tenantId, tenantId));
  const companyIds = tenantCompanies.map((c) => c.id);

  const deals = companyIds.length
    ? await db.select().from(dealsTable)
        .where(and(eq(dealsTable.accountId, contact.accountId), inArray(dealsTable.companyId, companyIds)))
    : [];
  const dealIds = deals.map((d) => d.id);

  const quotes = dealIds.length
    ? await db.select().from(quotesTable).where(inArray(quotesTable.dealId, dealIds))
    : [];
  const quoteIds = quotes.map((q) => q.id);
  const versions = quoteIds.length
    ? await db.select().from(quoteVersionsTable).where(inArray(quoteVersionsTable.quoteId, quoteIds))
    : [];

  const negs = dealIds.length
    ? await db.select().from(negotiationsTable).where(inArray(negotiationsTable.dealId, dealIds))
    : [];
  const negIds = negs.map((n) => n.id);
  const reactions = negIds.length
    ? await db.select().from(customerReactionsTable).where(inArray(customerReactionsTable.negotiationId, negIds))
    : [];

  const events = dealIds.length
    ? await db.select().from(timelineEventsTable).where(inArray(timelineEventsTable.dealId, dealIds))
    : [];
  const approvals = dealIds.length
    ? await db.select().from(approvalsTable).where(inArray(approvalsTable.dealId, dealIds))
    : [];
  const letters = account
    ? await db.select().from(priceIncreaseLettersTable).where(eq(priceIncreaseLettersTable.accountId, account.id))
    : [];

  // Signers: tenant-scoped via signature_packages.deal_id → deals.company_id → tenant.
  // We only include signers on packages whose deal belongs to the tenant AND
  // (defensively) to this subject's account.
  let signerMatches: (typeof signersTable.$inferSelect)[] = [];
  let sigPackages: (typeof signaturePackagesTable.$inferSelect)[] = [];
  if (contact.email && dealIds.length > 0) {
    const tenantPackages = await db.select().from(signaturePackagesTable)
      .where(inArray(signaturePackagesTable.dealId, dealIds));
    const tenantPkgIds = tenantPackages.map((p) => p.id);
    if (tenantPkgIds.length > 0) {
      signerMatches = await db.select().from(signersTable)
        .where(and(
          inArray(signersTable.packageId, tenantPkgIds),
          eq(signersTable.email, contact.email),
        ));
    }
    sigPackages = tenantPackages.filter((p) => signerMatches.some((s) => s.packageId === p.id));
  }

  return {
    contact: [contact],
    account: account ? [account] : [],
    deals,
    quotes,
    quoteVersions: versions,
    negotiations: negs,
    customerReactions: reactions,
    timelineEvents: events,
    approvals,
    priceIncreaseLetters: letters,
    signers: signerMatches,
    signaturePackages: sigPackages,
  };
}

function toCsv(rows: unknown[]): string {
  if (rows.length === 0) return "";
  const headers = Array.from(
    new Set(rows.flatMap((r) => (r && typeof r === "object" ? Object.keys(r as object) : []))),
  );
  const esc = (v: unknown): string => {
    if (v == null) return "";
    if (v instanceof Date) return v.toISOString();
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    const obj = (row ?? {}) as Record<string, unknown>;
    lines.push(headers.map((h) => esc(obj[h])).join(","));
  }
  return lines.join("\n");
}

export async function exportSubjectZip(
  res: Response,
  tenantId: string,
  subjectType: SubjectType,
  subjectId: string,
): Promise<boolean> {
  if (subjectType !== "contact") return false;
  const data = await collectForContact(tenantId, subjectId);
  if (!data["contact"] || (data["contact"] as unknown[]).length === 0) return false;

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="gdpr-export-${subjectType}-${subjectId}.zip"`,
  );

  const pass = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => pass.destroy(err));
  archive.pipe(pass);

  const manifest = {
    subjectType,
    subjectId,
    tenantId,
    exportedAt: new Date().toISOString(),
    tables: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, (v as unknown[]).length]),
    ),
  };
  archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" });

  for (const [name, rows] of Object.entries(data)) {
    archive.append(JSON.stringify(rows, null, 2), { name: `${name}.json` });
    archive.append(toCsv(rows as unknown[]), { name: `${name}.csv` });
  }

  await archive.finalize();
  pass.pipe(res);
  // Wait for stream end so caller can await and attach audit entry afterwards.
  await new Promise<void>((resolve, reject) => {
    pass.on("end", () => resolve());
    pass.on("error", reject);
    res.on("close", () => resolve());
  });
  return true;
}
void Readable; // keep import tree consistent

export async function forgetSubject(
  tenantId: string,
  subjectType: SubjectType,
  subjectId: string,
  actor: string,
  reason?: string,
): Promise<{ ok: boolean; alreadyDeleted?: boolean }> {
  if (subjectType !== "contact") return { ok: false };
  const [contact] = await db.select().from(contactsTable).where(eq(contactsTable.id, subjectId));
  if (!contact) return { ok: false };
  if (contact.deletedAt) return { ok: true, alreadyDeleted: true };
  const before = {
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
  };
  const now = new Date();
  await db.update(contactsTable)
    .set({
      name: pseudonymFor(contact.id, "name"),
      email: pseudonymFor(contact.id, "email") + "@example.invalid",
      phone: null,
      deletedAt: now,
      pseudonymizedAt: now,
    })
    .where(eq(contactsTable.id, subjectId));

  await db.insert(subjectsDeletionLogTable).values({
    id: `sdl_${randomUUID().slice(0, 8)}`,
    tenantId,
    subjectType,
    subjectId,
    requestedBy: actor,
    reason: reason ?? null,
    status: "completed",
    pseudonymBefore: before,
    completedAt: now,
  });

  await db.insert(auditLogTable).values({
    id: `al_${randomUUID().slice(0, 8)}`,
    entityType: "contact",
    entityId: subjectId,
    action: "gdpr_forget",
    actor,
    beforeJson: JSON.stringify(before),
    afterJson: null,
    summary: `Kontakt pseudonymisiert (DSGVO Löschung) von ${actor}`,
  });

  return { ok: true };
}

export async function logPiiAccess(params: {
  tenantId: string;
  actorUserId: string;
  entityType: string;
  entityId: string;
  fields: string[];
}): Promise<void> {
  const { tenantId, actorUserId, entityType, entityId, fields } = params;
  if (!fields.length) return;
  const rows = fields.map((f) => ({
    id: `acl_${randomUUID().slice(0, 10)}`,
    tenantId,
    actorUserId,
    entityType,
    entityId,
    field: f,
    action: "read",
  }));
  await db.insert(accessLogTable).values(rows);
}

export async function runRetentionSweep(): Promise<{ applied: Record<string, number> }> {
  const applied: Record<string, number> = {
    contactsPseudonymized: 0,
    lettersForgotten: 0,
    accessLogPurged: 0,
  };
  const tenants = await db.select().from(tenantsTable);
  for (const tenant of tenants) {
    const policy = tenant.retentionPolicy ?? {};

    // Tenant-scoped account set: accounts that have any deal in a company of this tenant.
    const tenantCompanies = await db.select({ id: companiesTable.id })
      .from(companiesTable).where(eq(companiesTable.tenantId, tenant.id));
    const companyIds = tenantCompanies.map((c) => c.id);
    let tenantAccountIds: string[] = [];
    if (companyIds.length > 0) {
      const deals = await db.select({ accountId: dealsTable.accountId })
        .from(dealsTable).where(inArray(dealsTable.companyId, companyIds));
      tenantAccountIds = [...new Set(deals.map((d) => d.accountId))];
    }

    // 1. Contacts: pseudonymize contacts in the tenant whose account has no deal
    //    updated within `contactInactiveDays`. Skips already-pseudonymized rows.
    if (typeof policy.contactInactiveDays === "number" && policy.contactInactiveDays > 0 && companyIds.length > 0) {
      const cutoff = new Date(Date.now() - policy.contactInactiveDays * 86400000);
      const activeRows = await db.select({ accountId: dealsTable.accountId, updatedAt: dealsTable.updatedAt })
        .from(dealsTable)
        .where(inArray(dealsTable.companyId, companyIds));
      const recentSet = new Set(activeRows
        .filter((r) => r.updatedAt && new Date(r.updatedAt).getTime() >= cutoff.getTime())
        .map((r) => r.accountId));
      const inactiveAccountIds = tenantAccountIds.filter((a) => !recentSet.has(a));
      if (inactiveAccountIds.length > 0) {
        const cand = await db.select().from(contactsTable)
          .where(inArray(contactsTable.accountId, inactiveAccountIds));
        for (const c of cand) {
          if (c.pseudonymizedAt) continue;
          const now = new Date();
          await db.update(contactsTable)
            .set({
              name: pseudonymFor(c.id, "name"),
              email: pseudonymFor(c.id, "email") + "@example.invalid",
              phone: null,
              pseudonymizedAt: now,
            })
            .where(eq(contactsTable.id, c.id));
          applied["contactsPseudonymized"] = (applied["contactsPseudonymized"] ?? 0) + 1;
        }
      }
    }

    // 2. Letters: forget respondedAt — tenant-scoped via accountId ∈ tenantAccountIds.
    if (typeof policy.letterRespondedDays === "number" && policy.letterRespondedDays > 0 && tenantAccountIds.length > 0) {
      const cutoff = new Date(Date.now() - policy.letterRespondedDays * 86400000);
      const old = await db.select().from(priceIncreaseLettersTable)
        .where(and(
          inArray(priceIncreaseLettersTable.accountId, tenantAccountIds),
          lt(priceIncreaseLettersTable.respondedAt, cutoff),
        ));
      for (const l of old) {
        await db.update(priceIncreaseLettersTable)
          .set({ respondedAt: null })
          .where(eq(priceIncreaseLettersTable.id, l.id));
        applied["lettersForgotten"] = (applied["lettersForgotten"] ?? 0) + 1;
      }
    }

    // 3. Access log purge (tenant-scoped).
    if (typeof policy.accessLogDays === "number" && policy.accessLogDays > 0) {
      const cutoff = new Date(Date.now() - policy.accessLogDays * 86400000);
      const del = await db.delete(accessLogTable)
        .where(and(eq(accessLogTable.tenantId, tenant.id), lt(accessLogTable.at, cutoff)))
        .returning({ id: accessLogTable.id });
      applied["accessLogPurged"] = (applied["accessLogPurged"] ?? 0) + del.length;
    }
    // Note: auditLogDays is intentionally NOT applied per-tenant because the
    // audit_log table currently has no tenant column. Purging per-tenant would
    // leak across tenants. When audit_log gains tenantId, we can enable this.
  }
  return { applied };
}

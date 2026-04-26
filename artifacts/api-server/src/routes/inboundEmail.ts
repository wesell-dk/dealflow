// Inbound-E-Mail-Webhook (Task #198): externes Mail-Gateway (Mailgun /
// Postmark / SendGrid Inbound, n8n, IMAP-Brücke) postet E-Mails als JSON
// hier rein; jede Mail erzeugt entweder einen neuen Lead oder hängt sich
// als zusätzliche Aktivität an einen bestehenden Lead an.
//
// Bewusst AUSSERHALB des `requireAuth`-Stacks gemountet, weil ein externer
// Mail-Provider keine Login-Session besitzt. Auth + Tenant-Auflösung
// erfolgen in einem Schritt: der `X-Inbound-Email-Token`-Header (oder
// `?token=` Query-Param) wird mit `tenants.inbound_email_token` per
// Constant-Time-Vergleich gematcht. Findet sich kein passender Tenant →
// 401. Damit kann es kein Cross-Tenant-Leck geben — der Tenant wird
// niemals aus dem Body ermittelt.

import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import {
  db,
  tenantsTable,
  leadsTable,
  usersTable,
  auditLogTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Generic max body size for the inbound payload — Mail-Bodies können groß
// werden, wir kürzen auf vernünftige Größen, damit die Notiz im Lead lesbar
// bleibt und kein DB-Bloat entsteht.
const MAX_NOTE_LENGTH = 4_000;
const MAX_SUBJECT_LENGTH = 200;
const MAX_NAME_LENGTH = 200;

interface InboundFrom {
  email?: unknown;
  name?: unknown;
}

interface InboundPayload {
  from?: InboundFrom;
  to?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
  companyName?: unknown;
  phone?: unknown;
  receivedAt?: unknown;
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function clamp(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Sehr defensives HTML→Text-Stripping: Tags rauswerfen, Entities reduzieren.
// Wir wollen nicht das ganze html-to-text-Paket einschleppen, eine grobe
// Reduktion reicht für den Notiz-Vorschau-Use-Case.
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/?(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeRecipients(to: unknown): string[] {
  if (typeof to === "string") {
    return to
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  if (Array.isArray(to)) {
    return to
      .map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""))
      .filter(Boolean);
  }
  return [];
}

// Konstante-Zeit-Vergleich, damit das Token nicht über Antwortzeiten
// erratbar ist. Wir vergleichen Buffer fester Länge und werfen bei
// Längen-Mismatch einen no-match-Wert.
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function resolveTenantByToken(token: string) {
  if (!token) return null;
  // Wir lesen alle Tenants mit gesetztem Token und vergleichen in JS, damit
  // der Vergleich constant-time ist. Tenants sind die kleinste Tabelle im
  // System (ein paar Dutzend Einträge selbst in größeren Setups).
  const candidates = await db
    .select({
      id: tenantsTable.id,
      inboundEmailToken: tenantsTable.inboundEmailToken,
      defaultOwnerId: tenantsTable.inboundEmailDefaultOwnerId,
      addressMap: tenantsTable.inboundEmailAddressMap,
    })
    .from(tenantsTable);
  for (const t of candidates) {
    if (!t.inboundEmailToken) continue;
    if (constantTimeEquals(t.inboundEmailToken, token)) {
      return t;
    }
  }
  return null;
}

// E-Mail-Adresse für das Dedup-Lookup vereinheitlichen. Wir akzeptieren
// nur RFC-konforme Adressen (rudimentärer Check) und vergleichen
// case-insensitive — nahezu alle Mail-Provider behandeln den Local-Part
// case-insensitive, eine echte Normalisierung (lowercase) deckt 99 % ab.
function normalizeEmail(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  return t;
}

router.post("/webhooks/inbound-email", async (req: Request, res: Response) => {
  const tokenHeader = req.header("x-inbound-email-token") ?? "";
  const tokenQuery =
    typeof req.query.token === "string" ? req.query.token : "";
  const presented = (tokenHeader || tokenQuery).trim();
  if (!presented) {
    res.status(401).json({ error: "missing token" });
    return;
  }
  const tenant = await resolveTenantByToken(presented);
  if (!tenant) {
    res.status(401).json({ error: "invalid token" });
    return;
  }

  const body = (req.body ?? {}) as InboundPayload;
  const fromEmailRaw = asString(body.from?.email);
  if (!fromEmailRaw) {
    res.status(422).json({ error: "from.email required" });
    return;
  }
  const email = normalizeEmail(fromEmailRaw);
  if (!email) {
    res.status(422).json({ error: "from.email is not a valid address" });
    return;
  }
  const senderName = asString(body.from?.name);
  const subject = asString(body.subject);
  const text = asString(body.text);
  const html = asString(body.html);
  const companyName = asString(body.companyName);
  const phone = asString(body.phone);
  const receivedAtRaw = asString(body.receivedAt);
  const receivedAt = (() => {
    if (!receivedAtRaw) return new Date();
    const d = new Date(receivedAtRaw);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  })();

  // Owner-Auflösung: erste matchende Empfangsadresse aus dem Mapping
  // gewinnt; sonst Default; sonst null. Alle gemappten userIds müssen im
  // selben Tenant existieren — sonst behandeln wir den Eintrag als
  // ungültig und fallen auf null/Default zurück.
  const recipients = normalizeRecipients(body.to);
  const addressMap = (tenant.addressMap ?? {}) as Record<string, string>;
  let ownerCandidate: string | null = null;
  for (const r of recipients) {
    const mapped = addressMap[r];
    if (mapped) {
      ownerCandidate = mapped;
      break;
    }
  }
  if (!ownerCandidate && tenant.defaultOwnerId) {
    ownerCandidate = tenant.defaultOwnerId;
  }
  let ownerId: string | null = null;
  if (ownerCandidate) {
    // Tenant-Filter: gemappter/Default-Owner muss im selben Tenant sein.
    const [u] = await db
      .select({ id: usersTable.id, tenantId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.id, ownerCandidate));
    if (u && u.tenantId === tenant.id) {
      ownerId = u.id;
    } else {
      logger.warn(
        { tenantId: tenant.id, ownerId: ownerCandidate },
        "inbound-email: configured owner not in tenant — ignoring",
      );
    }
  }

  // Notiz-Snippet aus Subject + Body bauen. HTML bekommt ein simples
  // Stripping; bei beiden vorhandenen Varianten gewinnt text.
  const bodyExcerpt = (() => {
    if (text) return text;
    if (html) return stripHtml(html);
    return "";
  })();
  const noteSnippetParts: string[] = [];
  if (subject) noteSnippetParts.push(`Betreff: ${clamp(subject, MAX_SUBJECT_LENGTH)}`);
  if (bodyExcerpt) noteSnippetParts.push(clamp(bodyExcerpt, MAX_NOTE_LENGTH));
  const noteSnippet = noteSnippetParts.join("\n").trim();

  // Tenant-scoped lookup auf bestehenden Lead anhand E-Mail. Wir holen alle
  // Treffer im Tenant (in der Praxis 0-1) und ignorieren `converted` Leads
  // — die haben bereits einen Account, dort gehört die Aktivität in die
  // Account-Historie, nicht zurück in die Lead-Inbox.
  const candidates = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.tenantId, tenant.id));
  const matchByEmail = candidates.find(
    (l) => l.email && l.email.toLowerCase() === email && l.status !== "converted",
  );

  const now = new Date();
  if (matchByEmail) {
    // Bestehenden Lead aktualisieren: lastContactAt anheben, Notiz anhängen.
    const ts = receivedAt.toISOString();
    const appended = noteSnippet
      ? `\n\n— Inbound-Mail (${ts})\n${noteSnippet}`
      : `\n\n— Inbound-Mail (${ts}) (kein Inhalt)`;
    const newNotes = clamp(`${matchByEmail.notes ?? ""}${appended}`.trim(), MAX_NOTE_LENGTH * 4);
    await db
      .update(leadsTable)
      .set({
        notes: newNotes,
        lastContactAt: receivedAt,
        // Falls der bestehende Lead noch keinen Owner hat, vergeben wir den
        // jetzt aufgelösten — sonst Owner unverändert lassen, damit
        // manuelle Zuweisungen erhalten bleiben.
        ownerId: matchByEmail.ownerId ?? ownerId,
        updatedAt: now,
      })
      .where(eq(leadsTable.id, matchByEmail.id));
    const [after] = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.id, matchByEmail.id));
    await db.insert(auditLogTable).values({
      id: `au_${randomUUID().slice(0, 10)}`,
      tenantId: tenant.id,
      entityType: "lead",
      entityId: matchByEmail.id,
      action: "inbound_email",
      actor: "Inbound-E-Mail",
      summary: `Inbound-Mail von ${email} an bestehenden Lead "${matchByEmail.name}" angehängt`,
      beforeJson: JSON.stringify({
        notes: matchByEmail.notes,
        lastContactAt: matchByEmail.lastContactAt,
      }),
      afterJson: JSON.stringify({ notes: after.notes, lastContactAt: after.lastContactAt }),
      activeScopeJson: null,
    });
    res.status(200).json({ created: false, lead: serializeLead(after) });
    return;
  }

  // Neuen Lead anlegen.
  const id = `ld_${randomUUID().slice(0, 8)}`;
  const displayName = (() => {
    if (senderName) return clamp(senderName, MAX_NAME_LENGTH);
    // Local-Part der E-Mail als Fallback, damit die Inbox-Karte nicht leer
    // wirkt. Punkt/Underscore werden zu Leerzeichen, jedes Wort
    // großgeschrieben — pragmatisch, kein KI-Tooling.
    const local = email.split("@")[0] ?? email;
    return local
      .replace(/[._-]+/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((w) => w[0]!.toUpperCase() + w.slice(1))
      .join(" ") || email;
  })();
  await db.insert(leadsTable).values({
    id,
    tenantId: tenant.id,
    name: displayName,
    companyName,
    email,
    phone,
    source: "inbound_email",
    status: "new",
    ownerId,
    notes: noteSnippet || null,
    lastContactAt: receivedAt,
  });
  const [created] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, id));
  await db.insert(auditLogTable).values({
    id: `au_${randomUUID().slice(0, 10)}`,
    tenantId: tenant.id,
    entityType: "lead",
    entityId: id,
    action: "create",
    actor: "Inbound-E-Mail",
    summary: `Lead "${displayName}" aus Inbound-Mail von ${email} angelegt`,
    beforeJson: null,
    afterJson: JSON.stringify(created),
    activeScopeJson: null,
  });
  res.status(201).json({ created: true, lead: serializeLead(created) });
});

function serializeLead(l: typeof leadsTable.$inferSelect) {
  const iso = (d: Date | string | null | undefined) =>
    d == null
      ? null
      : d instanceof Date
        ? d.toISOString()
        : new Date(d).toISOString();
  return {
    id: l.id,
    name: l.name,
    companyName: l.companyName,
    email: l.email,
    phone: l.phone,
    source: l.source,
    status: l.status,
    ownerId: l.ownerId,
    ownerName: null,
    notes: l.notes,
    disqualifyReason: l.disqualifyReason,
    lastContactAt: iso(l.lastContactAt),
    convertedAccountId: l.convertedAccountId,
    convertedAccountName: null,
    convertedDealId: l.convertedDealId,
    convertedDealName: null,
    convertedAt: iso(l.convertedAt),
    createdAt: iso(l.createdAt)!,
    updatedAt: iso(l.updatedAt)!,
  };
}

// Token-Generator für die Konfigurations-Endpoints (siehe routes/dealflow.ts).
export function generateInboundEmailToken(): string {
  return `iet_${randomBytes(24).toString("hex")}`;
}

export default router;

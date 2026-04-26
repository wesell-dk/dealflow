/**
 * Brand-Lead-Widget (Task #262, Rate-Limit shared in Task #270)
 *
 * Library für das Public Lead-Widget pro Brand:
 *   - Public-Key + Cal.com-HMAC-Secret generieren
 *   - Constant-Time-Vergleich für Public-Key-Lookups
 *   - Atomarer geteilter Rate-Limit-Store in Postgres (siehe checkRateLimit)
 *   - Light-weight Domain-Enrichment (Favicon + <title>/<meta>)
 *   - Auto-Routing-Regel-Evaluation
 *
 * Architektur des Rate-Limits (Task #270):
 *   - `checkRateLimit` ist async und macht pro Submit *einen* atomaren
 *     Postgres-UPSERT. Das ist der einzige zuverlässige Weg, das Limit
 *     wirklich global pro Brand+IP durchzusetzen — sowohl über Restarts
 *     als auch über mehrere Replikas hinweg (Postgres serialisiert die
 *     UPDATE-Konflikte auf der Row).
 *   - Eine in-Process-Map oder ein lokal-puffender Cache wäre an genau
 *     dieser Stelle wieder die Lücke aus dem Issue: zwei Replikas könnten
 *     unabhängig hochzählen, der Angreifer hätte n*max Submits.
 *   - Signatur-Hinweis: gegenüber Task #262 (sync) ist der Rückgabetyp
 *     jetzt `Promise<RateLimitResult>`. Parameter und Funktionsname sind
 *     unverändert, der einzige Caller-Patch ist ein `await` (siehe
 *     routes/widget.ts). Eine echte Sync-Variante würde zwingend wieder
 *     pro-Prozess-State erfordern.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ipBlockReason } from "./webhooks";
import { logger } from "./logger";

// ─────────────────────────── Schlüssel-Erzeugung ───────────────────────────

/**
 * Generiert einen URL-safen Public-Key (~32 Zeichen Entropie). Wird als
 * Brand-Identifier in der Widget-URL verwendet, ist aber kein Geheimnis —
 * der Key allein erlaubt nur das Submitten von Leads (durch Rate-Limit
 * und Brand-spezifische Felder begrenzt).
 */
export function generateWidgetPublicKey(): string {
  // 24 Bytes → 32 Zeichen base64url ohne Padding.
  return `wk_${randomBytes(24).toString("base64url")}`;
}

/**
 * Cal.com Webhook Secret (HMAC-SHA256). Wird beim Aktivieren erzeugt und
 * im Cal.com Webhook hinterlegt (Setting auf Cal.com Seite). Wir
 * validieren signierte Webhooks beim Eingang.
 */
export function generateCalSecret(): string {
  return randomBytes(32).toString("base64url");
}

// ─────────────────────────── Constant-Time-Compare ───────────────────────────

export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ─────────────────────────── Rate Limit ───────────────────────────

/** Default: 10 Submits / 60 s pro Brand+IP. */
export const DEFAULT_RATE_LIMIT = { max: 10, windowMs: 60_000 };

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Atomarer Fixed-Window-Counter pro Brand+IP via Postgres-UPSERT.
 *
 * Genau eine SQL-Round-Trip pro Submit. Die `CASE`-Logik im UPDATE-Zweig
 * realisiert beide Pfade in einem Statement:
 *
 *   - Wenn die Row noch nicht existiert oder das alte Fenster abgelaufen
 *     ist: starte ein neues Fenster mit `count = 1` und
 *     `expires_at = now() + windowMs`.
 *   - Sonst: `count = count + 1` und `expires_at` bleibt unverändert
 *     (das Fenster läuft weiter, wir setzen es nicht zurück).
 *
 * Da Postgres UPDATEs auf derselben Row serialisiert, ist der zurück-
 * gegebene Counter über alle Replikas und über Restarts hinweg
 * autoritativ — genau das, was Task #270 verlangt.
 *
 * Wir lassen den Counter auch nach Erreichen des Limits weiter hoch-
 * zählen (kein Cap im UPDATE) — das hält die Logik einfach, der nächste
 * Fensterwechsel setzt ihn ohnehin auf 1 zurück.
 */
export async function checkRateLimit(
  brandId: string,
  ip: string,
  limit = DEFAULT_RATE_LIMIT,
): Promise<RateLimitResult> {
  const key = `${brandId}|${ip}`;
  const windowMs = limit.windowMs;

  let row: { count: number; expires_at: string | Date } | undefined;
  try {
    const result = await db.execute<{ count: number; expires_at: string | Date }>(sql`
      INSERT INTO widget_rate_limits ("key", "count", "expires_at")
      VALUES (${key}, 1, now() + (${windowMs} || ' milliseconds')::interval)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN widget_rate_limits."expires_at" <= now() THEN 1
          ELSE widget_rate_limits."count" + 1
        END,
        "expires_at" = CASE
          WHEN widget_rate_limits."expires_at" <= now()
            THEN now() + (${windowMs} || ' milliseconds')::interval
          ELSE widget_rate_limits."expires_at"
        END
      RETURNING "count", "expires_at"
    `);
    row = result.rows[0];
  } catch (err) {
    // Fail-closed: wenn der Store nicht erreichbar ist, halten wir
    // das Limit ein, statt den Schutz still zu deaktivieren. Beim
    // Submit antwortet der Caller dann mit 429 — kurzes Retry.
    logger.error({ err, brandId }, "widget rate-limit store unavailable");
    return { allowed: false, remaining: 0, retryAfterSeconds: 5 };
  }

  if (!row) {
    logger.error({ brandId }, "widget rate-limit upsert returned no row");
    return { allowed: false, remaining: 0, retryAfterSeconds: 5 };
  }

  const count = Number(row.count);
  const expiresAt = row.expires_at instanceof Date
    ? row.expires_at
    : new Date(row.expires_at);

  // Best-effort Housekeeping: dünn gestreute Aufräumläufe verhindern,
  // dass die Tabelle mit alten Brand+IP-Kombinationen vollläuft.
  // Async und nicht blockierend.
  if (Math.random() < 0.02) {
    void db
      .execute(sql`DELETE FROM widget_rate_limits WHERE "expires_at" < now() - interval '1 hour'`)
      .catch((err) => {
        logger.debug({ err }, "widget rate-limit prune failed");
      });
  }

  if (count > limit.max) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((expiresAt.getTime() - Date.now()) / 1000),
    );
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return {
    allowed: true,
    remaining: Math.max(0, limit.max - count),
    retryAfterSeconds: 0,
  };
}

/** Nur für Tests — den geteilten Store leeren. */
export async function _resetRateLimit(): Promise<void> {
  await db.execute(sql`DELETE FROM widget_rate_limits`);
}

/** Stabiler Hash der Client-IP für widgetMeta (kein PII-Speicher der Roh-IP). */
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}|${ip}`).digest("hex").slice(0, 16);
}

// ─────────────────────────── E-Mail / Domain ───────────────────────────

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.de",
  "hotmail.com", "hotmail.de", "outlook.com", "outlook.de",
  "live.com", "live.de", "icloud.com", "me.com", "mac.com",
  "gmx.de", "gmx.net", "gmx.com", "gmx.at", "gmx.ch",
  "web.de", "t-online.de", "freenet.de", "aol.com", "aol.de",
  "proton.me", "protonmail.com", "tutanota.com", "mail.com",
]);

export function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  return domain;
}

export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain);
}

/** Heuristischer Firmenname aus Domain (ohne TLD, Bindestriche → Leerzeichen). */
export function deriveCompanyNameFromDomain(domain: string): string {
  const parts = domain.split(".");
  // Multi-level TLDs wie co.uk werden nicht perfekt behandelt; das ist OK,
  // der Name dient nur als Vorschlag, der UI-User kann ihn überschreiben.
  const stem = parts.length > 2 ? parts.slice(0, -2).join(" ") : parts[0]!;
  return stem
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

// ─────────────────────────── Domain-Enrichment ───────────────────────────

const ENRICH_FETCH_TIMEOUT_MS = 4_000;
const ENRICH_MAX_BYTES = 256 * 1024;

export interface EnrichmentResult {
  domain: string;
  companyName: string | null;
  faviconUrl: string | null;
  websiteUrl: string | null;
  title: string | null;
  description: string | null;
  fetchedAt: string;
  error: string | null;
}

async function safeFetchHtml(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const host = u.hostname.toLowerCase();
    // Hostname blockierte Muster ausschließen (localhost, .local, IP-Literale
    // im privaten Bereich); volles DNS-Pinning übersteigen den Aufwand für
    // einen optionalen Title-Fetch — Worst-Case ist ein Timeout.
    if (
      host === "localhost"
      || host.endsWith(".local")
      || host.endsWith(".internal")
    ) {
      return null;
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
      const reason = ipBlockReason(host);
      if (reason) return null;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ENRICH_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "user-agent": "DealFlowOneWidgetBot/1.0 (+lead-enrichment)" },
      });
      if (!res.ok) return null;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.toLowerCase().includes("text/html")) return null;
      const buf = await res.arrayBuffer();
      const slice = buf.byteLength > ENRICH_MAX_BYTES
        ? buf.slice(0, ENRICH_MAX_BYTES)
        : buf;
      return new TextDecoder("utf-8", { fatal: false }).decode(slice);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.debug({ err }, "widget enrichment fetch failed");
    return null;
  }
}

function extractTag(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = html.match(re);
  return m ? decodeEntities(m[1]!.trim().replace(/\s+/g, " ")).slice(0, 200) : null;
}

function extractMeta(html: string, name: string): string | null {
  const re = new RegExp(
    `<meta[^>]*(?:name|property)=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const m = html.match(re);
  return m ? decodeEntities(m[1]!.trim()).slice(0, 300) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/**
 * Enrichment für eine E-Mail-Adresse: Domain extrahieren, Firmenname
 * heuristisch, Favicon-URL bauen (Google's S2 Service als Fallback bietet
 * sich nicht an, weil das Brand-Privacy-Implikationen hätte; wir nehmen
 * direkt /favicon.ico), und einmaligen Title/Description-Fetch.
 *
 * Free-Email-Domains werden NICHT angereichert (gmail.com hat keinen
 * sinnvollen Firmenkontext).
 */
export async function enrichFromEmail(email: string | null): Promise<EnrichmentResult | null> {
  const domain = extractDomain(email);
  if (!domain) return null;
  if (isFreeEmailDomain(domain)) {
    return {
      domain,
      companyName: null,
      faviconUrl: null,
      websiteUrl: null,
      title: null,
      description: null,
      fetchedAt: new Date().toISOString(),
      error: "free_email_domain",
    };
  }
  const websiteUrl = `https://${domain}`;
  const faviconUrl = `https://${domain}/favicon.ico`;
  const html = await safeFetchHtml(websiteUrl);
  let title: string | null = null;
  let description: string | null = null;
  if (html) {
    title = extractTag(html, "title");
    description = extractMeta(html, "description") || extractMeta(html, "og:description");
  }
  return {
    domain,
    companyName: deriveCompanyNameFromDomain(domain),
    faviconUrl,
    websiteUrl,
    title,
    description,
    fetchedAt: new Date().toISOString(),
    error: html ? null : "fetch_unavailable",
  };
}

// ─────────────────────────── Routing-Regeln ───────────────────────────

export interface RoutingRule {
  id: string;
  match: { field: string; op: "equals" | "contains" | "domain"; value: string };
  ownerId: string;
}

export interface RoutingInput {
  email: string | null;
  companyName: string | null;
  qualifier: Record<string, string>;
  enrichmentDomain: string | null;
}

/**
 * Prüft Regeln in Reihenfolge; erste Übereinstimmung gewinnt. Felder können
 * eine Top-Level-Property aus RoutingInput (`email`, `companyName`,
 * `domain`) sein oder mit Prefix `qualifier.<key>` auf einen Qualifier
 * verweisen. Vergleiche sind case-insensitive.
 */
export function evaluateRoutingRules(
  rules: RoutingRule[] | null | undefined,
  input: RoutingInput,
): { ownerId: string; ruleId: string } | null {
  if (!rules || rules.length === 0) return null;
  for (const rule of rules) {
    const haystack = readField(rule.match.field, input);
    if (haystack == null) continue;
    const hay = haystack.toLowerCase();
    const needle = rule.match.value.toLowerCase().trim();
    if (!needle) continue;
    if (rule.match.op === "equals" && hay === needle) {
      return { ownerId: rule.ownerId, ruleId: rule.id };
    }
    if (rule.match.op === "contains" && hay.includes(needle)) {
      return { ownerId: rule.ownerId, ruleId: rule.id };
    }
    if (rule.match.op === "domain") {
      // Bei "domain" nehmen wir den E-Mail-Domain-Teil (oder das Feld direkt,
      // falls jemand companyName mit Domain-Match nutzen will).
      const domain = extractDomain(haystack) ?? hay;
      if (domain === needle || domain.endsWith(`.${needle}`)) {
        return { ownerId: rule.ownerId, ruleId: rule.id };
      }
    }
  }
  return null;
}

function readField(field: string, input: RoutingInput): string | null {
  if (field === "email") return input.email;
  if (field === "companyName") return input.companyName;
  if (field === "domain") return input.enrichmentDomain ?? extractDomain(input.email);
  if (field.startsWith("qualifier.")) {
    const key = field.slice("qualifier.".length);
    return input.qualifier[key] ?? null;
  }
  return null;
}

// ─────────────────────────── Cal.com Webhook Signatur ───────────────────────────

/**
 * Cal.com schickt im Header `X-Cal-Signature-256` den HMAC-SHA256 des
 * Raw-Bodys (lowercase hex). Wir verifizieren Constant-Time.
 *
 * Hinweis: req.body ist bereits geparst. Wir reichen den Raw-Body als
 * String rein, der vom Caller im Route-Handler aus dem Pre-Parse-Hook
 * gehalten wird.
 */
export function verifyCalSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return constantTimeEquals(expected, signatureHeader.trim().toLowerCase());
}

// ─────────────────────────── Default-Widget-Config ───────────────────────────

export interface WidgetConfigShape {
  greeting?: string;
  thankYou?: string;
  submitLabel?: string;
  fields?: Array<{
    key: string;
    label: string;
    type: "text" | "textarea" | "select";
    required?: boolean;
    options?: string[];
  }>;
  calComUrl?: string | null;
  calComEnabled?: boolean;
  primaryColor?: string | null;
}

export const DEFAULT_WIDGET_CONFIG: WidgetConfigShape = {
  greeting: "Erzähle uns kurz, wie wir helfen können.",
  thankYou: "Danke für deine Nachricht — wir melden uns binnen 24 h.",
  submitLabel: "Anfrage senden",
  fields: [
    { key: "interest", label: "Worum geht es?", type: "select", required: true, options: ["Beratung", "Angebot", "Demo", "Sonstiges"] },
    { key: "company_size", label: "Unternehmensgröße", type: "select", required: false, options: ["1–10", "11–50", "51–200", "200+"] },
    { key: "message", label: "Deine Nachricht", type: "textarea", required: false },
  ],
  calComUrl: null,
  calComEnabled: false,
  primaryColor: null,
};

export function mergeWidgetConfig(stored: WidgetConfigShape | null | undefined): WidgetConfigShape {
  if (!stored) return DEFAULT_WIDGET_CONFIG;
  return {
    greeting: stored.greeting ?? DEFAULT_WIDGET_CONFIG.greeting,
    thankYou: stored.thankYou ?? DEFAULT_WIDGET_CONFIG.thankYou,
    submitLabel: stored.submitLabel ?? DEFAULT_WIDGET_CONFIG.submitLabel,
    fields: Array.isArray(stored.fields) && stored.fields.length > 0 ? stored.fields : DEFAULT_WIDGET_CONFIG.fields,
    calComUrl: stored.calComUrl ?? null,
    calComEnabled: !!stored.calComEnabled && !!stored.calComUrl,
    primaryColor: stored.primaryColor ?? null,
  };
}

/**
 * Brand-Lead-Widget (Task #262)
 *
 * Library für das Public Lead-Widget pro Brand:
 *   - Public-Key + Cal.com-HMAC-Secret generieren
 *   - Constant-Time-Vergleich für Public-Key-Lookups
 *   - In-Memory Rate-Limit (Brand + IP, fixed window 60 s)
 *   - Light-weight Domain-Enrichment (Favicon + <title>/<meta>)
 *   - Auto-Routing-Regel-Evaluation
 *
 * Bewusst KEIN externer Cache / Redis: das Widget ist niedrigvolumig,
 * der Single-Process-Limit-Mechanismus reicht; bei Mehr-Replikas
 * limitiert das nur "pro Replika" (ist im Tradeoff dokumentiert).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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

interface RateBucket {
  count: number;
  windowStart: number;
}

// Pro Brand+IP (fixed window) — Map säubert sich beim Lookup, wenn das Fenster
// vorbei ist; ein periodischer Sweep ist unnötig (Map bleibt klein).
const RATE_BUCKETS = new Map<string, RateBucket>();

/** Default: 10 Submits / 60 s pro Brand+IP. */
export const DEFAULT_RATE_LIMIT = { max: 10, windowMs: 60_000 };

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(
  brandId: string,
  ip: string,
  limit = DEFAULT_RATE_LIMIT,
): RateLimitResult {
  const key = `${brandId}|${ip}`;
  const now = Date.now();
  const bucket = RATE_BUCKETS.get(key);
  if (!bucket || now - bucket.windowStart >= limit.windowMs) {
    RATE_BUCKETS.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: limit.max - 1, retryAfterSeconds: 0 };
  }
  if (bucket.count >= limit.max) {
    const retryAfterSeconds = Math.ceil(
      (bucket.windowStart + limit.windowMs - now) / 1000,
    );
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limit.max - bucket.count, retryAfterSeconds: 0 };
}

/** Nur für Tests — Bucket-Map zurücksetzen. */
export function _resetRateLimit() {
  RATE_BUCKETS.clear();
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

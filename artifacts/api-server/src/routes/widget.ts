/**
 * Brand-Lead-Widget — Public Routes (Task #262)
 *
 * Mount-Punkt: /api/external/widget/* + /api/v1/external/widget/* (durch
 * PUBLIC_PREFIXES in middlewares/auth.ts vom Login-Stack ausgenommen).
 *
 * Auth-Strategie: Public-Key in der URL identifiziert die Brand. Brand
 * MUSS widgetEnabled=true haben, sonst 404. Cal.com-Webhook validiert
 * zusätzlich HMAC-SHA256 mit dem Brand-spezifischen widgetCalSecret.
 *
 * Rate-Limit: 10 Submits / 60 s pro Brand+IP (in-memory, single process).
 *
 * NICHT zentralisierte Audit-Wrapper aus dealflow.ts genutzt — diese Datei
 * hat keinen Scope; Audit-Einträge schreiben wir hier direkt mit
 * tenantId aus der Brand → Company.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  brandsTable,
  companiesTable,
  leadsTable,
  usersTable,
  auditLogTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  constantTimeEquals,
  checkRateLimit,
  hashIp,
  enrichFromEmail,
  evaluateRoutingRules,
  verifyCalSignature,
  mergeWidgetConfig,
  extractDomain,
  type RoutingRule,
} from "../lib/widget";
import { sendEmail } from "../lib/email";
import { isAIConfigured, runStructured, AIOrchestrationError } from "../lib/ai";
import type { LeadWidgetSummaryInput } from "../lib/ai/prompts/dealflow";
import type { Scope } from "../lib/scope";

const router: IRouter = Router();

const MAX_NAME_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_QUALIFIER_VALUE = 1000;

const IP_HASH_SALT = process.env.WIDGET_IP_HASH_SALT ?? "dealflow-widget-static-salt";

// ─────────────────────────── Helpers ───────────────────────────

function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0]!.trim();
  }
  return req.ip ?? req.socket.remoteAddress ?? "0.0.0.0";
}

function asString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function clamp(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

interface BrandRow {
  id: string;
  companyId: string;
  name: string;
  primaryColor: string | null;
  color: string;
  logoUrl: string | null;
  widgetEnabled: boolean;
  widgetPublicKey: string | null;
  widgetCalSecret: string | null;
  widgetConfig: typeof brandsTable.$inferSelect.widgetConfig;
  widgetRoutingRules: typeof brandsTable.$inferSelect.widgetRoutingRules;
}

async function resolveBrandByPublicKey(publicKey: string): Promise<{ brand: BrandRow; tenantId: string } | null> {
  if (!publicKey) return null;
  // Wir holen alle Brands mit gesetztem Key und vergleichen Constant-Time —
  // die Anzahl der widget-aktivierten Brands ist klein (eine Hand voll pro
  // Tenant), das skaliert problemlos.
  const candidates = await db
    .select({
      brand: brandsTable,
      tenantId: companiesTable.tenantId,
    })
    .from(brandsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, brandsTable.companyId))
    .where(eq(brandsTable.widgetEnabled, true));
  for (const c of candidates) {
    if (!c.brand.widgetPublicKey) continue;
    if (constantTimeEquals(c.brand.widgetPublicKey, publicKey)) {
      return { brand: c.brand as BrandRow, tenantId: c.tenantId };
    }
  }
  return null;
}

// ─────────────────────────── 1. embed.js ───────────────────────────

const EMBED_JS = `(function(){
  // DealFlow.One Lead-Widget Loader
  // <script src=".../external/widget/embed.js" data-public-key="wk_..." async></script>
  var script = document.currentScript;
  if(!script){
    var scripts = document.querySelectorAll('script[data-public-key]');
    script = scripts[scripts.length-1];
  }
  if(!script) return;
  var publicKey = script.getAttribute('data-public-key');
  if(!publicKey){ console.warn('[DealFlow Widget] missing data-public-key'); return; }
  var apiBase = script.src.replace(/\\/embed\\.js.*$/, '');
  var position = script.getAttribute('data-position') || 'bottom-right';

  function fetchJson(url, opts){
    return fetch(url, opts).then(function(r){
      if(!r.ok){ throw new Error('HTTP '+r.status); }
      return r.json();
    });
  }

  function el(tag, props, children){
    var n = document.createElement(tag);
    if(props){ for(var k in props){ if(k==='style'){ for(var s in props.style){ n.style[s]=props.style[s]; } } else if(k==='text'){ n.textContent=props.text; } else { n[k]=props[k]; } } }
    if(children){ for(var i=0;i<children.length;i++){ if(children[i]) n.appendChild(children[i]); } }
    return n;
  }

  fetchJson(apiBase + '/' + publicKey + '/config').then(function(cfg){
    if(!cfg.enabled){ return; }
    var primary = cfg.primaryColor || '#6366f1';
    var hostEl = el('div', { style: { position:'fixed', zIndex:'2147483600', bottom:'20px', right: position==='bottom-left'?'auto':'20px', left: position==='bottom-left'?'20px':'auto' } });
    document.body.appendChild(hostEl);
    var shadow = hostEl.attachShadow ? hostEl.attachShadow({mode:'open'}) : hostEl;

    var style = document.createElement('style');
    style.textContent = '*{box-sizing:border-box;font-family:system-ui,sans-serif} .btn{background:'+primary+';color:#fff;border:none;border-radius:9999px;padding:14px 22px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.18)} .panel{position:absolute;bottom:60px;right:0;width:360px;max-width:calc(100vw - 32px);background:#fff;color:#111;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.22);padding:20px;display:none} .panel.open{display:block} .panel h3{margin:0 0 4px;font-size:18px;color:'+primary+'} .panel p{margin:0 0 12px;font-size:13px;color:#555;line-height:1.4} label{display:block;font-size:12px;font-weight:500;margin:8px 0 4px;color:#333} input,textarea,select{width:100%;border:1px solid #ddd;border-radius:8px;padding:8px 10px;font-size:13px;font-family:inherit} textarea{min-height:72px;resize:vertical} .submit{width:100%;background:'+primary+';color:#fff;border:none;border-radius:10px;padding:11px;font-size:14px;font-weight:600;margin-top:12px;cursor:pointer} .submit[disabled]{opacity:.5;cursor:wait} .err{color:#c00;font-size:12px;margin-top:8px} .ok{color:#080;font-size:13px;margin:6px 0 0} .head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px} .close{background:transparent;border:none;font-size:20px;cursor:pointer;color:#666;line-height:1} .cal{margin-top:14px;padding:12px;border:1px dashed #d1d5db;border-radius:10px;background:#f9fafb} .cal a{color:'+primary+';font-weight:600;text-decoration:none}';
    shadow.appendChild(style);

    var btn = el('button', { className:'btn', text:'Anfrage senden', type:'button' });
    var panel = el('div', { className:'panel' });
    var head = el('div', { className:'head' });
    var title = el('h3'); title.textContent = cfg.brandName;
    var close = el('button', { className:'close', innerHTML:'×' });
    head.appendChild(title); head.appendChild(close);
    panel.appendChild(head);
    var greeting = el('p'); greeting.textContent = cfg.greeting; panel.appendChild(greeting);

    var form = document.createElement('form');
    function addRow(labelText, input){ var l = el('label'); l.textContent = labelText; form.appendChild(l); form.appendChild(input); }

    var nameIn = el('input', { type:'text', name:'name', required:true });
    addRow('Name *', nameIn);
    var emailIn = el('input', { type:'email', name:'email', required:true });
    addRow('E-Mail *', emailIn);
    var phoneIn = el('input', { type:'tel', name:'phone' });
    addRow('Telefon (optional)', phoneIn);
    var companyIn = el('input', { type:'text', name:'companyName' });
    addRow('Unternehmen', companyIn);

    var qualifierInputs = {};
    if(cfg.fields){
      for(var i=0;i<cfg.fields.length;i++){
        var f = cfg.fields[i];
        var input;
        if(f.type==='textarea'){
          input = el('textarea', { name:'q_'+f.key });
        } else if(f.type==='select' && f.options){
          input = el('select', { name:'q_'+f.key });
          var blank = document.createElement('option'); blank.value=''; blank.textContent='— bitte wählen —'; input.appendChild(blank);
          for(var j=0;j<f.options.length;j++){
            var opt = document.createElement('option'); opt.value=f.options[j]; opt.textContent=f.options[j]; input.appendChild(opt);
          }
        } else {
          input = el('input', { type:'text', name:'q_'+f.key });
        }
        if(f.required){ input.required = true; }
        qualifierInputs[f.key] = input;
        addRow(f.label + (f.required?' *':''), input);
      }
    }

    var errBox = el('div', { className:'err' });
    var submit = el('button', { className:'submit', type:'submit', text: cfg.submitLabel || 'Senden' });
    form.appendChild(errBox);
    form.appendChild(submit);
    panel.appendChild(form);

    var thanks = el('div'); thanks.style.display='none';
    panel.appendChild(thanks);

    shadow.appendChild(btn); shadow.appendChild(panel);

    btn.addEventListener('click', function(){ panel.classList.toggle('open'); });
    close.addEventListener('click', function(){ panel.classList.remove('open'); });

    form.addEventListener('submit', function(ev){
      ev.preventDefault();
      errBox.textContent='';
      submit.disabled = true;
      var qualifier = {};
      for(var k in qualifierInputs){ if(qualifierInputs[k].value){ qualifier[k] = qualifierInputs[k].value; } }
      var payload = {
        name: nameIn.value.trim(),
        email: emailIn.value.trim(),
        phone: phoneIn.value.trim() || null,
        companyName: companyIn.value.trim() || null,
        qualifier: qualifier,
        referrer: document.referrer || null,
      };
      fetchJson(apiBase + '/' + publicKey + '/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(function(resp){
        form.style.display = 'none';
        thanks.style.display = 'block';
        var thx = el('p'); thx.textContent = cfg.thankYou; thanks.appendChild(thx);
        if(cfg.calComEnabled && cfg.calComUrl){
          var calBox = el('div', { className:'cal' });
          var lbl = el('p'); lbl.textContent = 'Direkt einen Termin buchen:'; lbl.style.margin='0 0 6px'; lbl.style.fontWeight='600';
          calBox.appendChild(lbl);
          var sep = '?';
          if(cfg.calComUrl.indexOf('?')>=0) sep = '&';
          var calUrl = cfg.calComUrl + sep + 'name=' + encodeURIComponent(payload.name) + '&email=' + encodeURIComponent(payload.email) + '&metadata[leadId]=' + encodeURIComponent(resp.leadId);
          var a = document.createElement('a'); a.href = calUrl; a.target='_blank'; a.rel='noopener'; a.textContent='Termin im Cal.com Kalender wählen →';
          calBox.appendChild(a);
          thanks.appendChild(calBox);
        }
      }).catch(function(err){
        errBox.textContent = 'Senden fehlgeschlagen — bitte später erneut versuchen.';
        submit.disabled = false;
        console.error('[DealFlow Widget]', err);
      });
    });
  }).catch(function(err){
    console.warn('[DealFlow Widget] cannot load config', err);
  });
})();`;

router.get("/external/widget/embed.js", (_req: Request, res: Response) => {
  res.setHeader("content-type", "application/javascript; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=300");
  res.setHeader("access-control-allow-origin", "*");
  res.send(EMBED_JS);
});

// ─────────────────────────── 2. Demo-HTML ───────────────────────────

router.get("/external/widget/demo", (_req: Request, res: Response) => {
  // Wir suchen einen aktiven Public-Key, damit der Demo-Aufruf "out of the
  // box" funktioniert. Wenn keine Brand das Widget aktiviert hat, zeigen
  // wir Anweisungen.
  void (async () => {
    const [active] = await db
      .select({ key: brandsTable.widgetPublicKey, name: brandsTable.name })
      .from(brandsTable)
      .where(eq(brandsTable.widgetEnabled, true))
      .limit(1);
    const html = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>DealFlow.One Lead-Widget Demo</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 20px;color:#222;line-height:1.6}h1{color:#4f46e5}code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}pre{background:#0f172a;color:#e2e8f0;padding:16px;border-radius:8px;overflow-x:auto;font-size:12px}</style>
</head><body>
<h1>DealFlow.One Lead-Widget — Live-Demo</h1>
<p>Diese Seite zeigt das eingebettete Widget unten rechts. Der Snippet sieht so aus:</p>
<pre>&lt;script src="https://&lt;your-host&gt;/api/external/widget/embed.js"
  data-public-key="${active?.key ?? "wk_..."}"
  async&gt;&lt;/script&gt;</pre>
${active
  ? `<p>Aktive Brand: <strong>${active.name}</strong> — klicke unten rechts auf <em>Anfrage senden</em>.</p>`
  : `<p style="color:#c00"><strong>Keine Brand hat das Widget aktiviert.</strong> Lege im Admin → Marken einen Public-Key an, dann lädt diese Seite das Widget automatisch.</p>`}
<h2>Was passiert beim Submit?</h2>
<ul>
  <li>POST <code>/api/external/widget/&lt;key&gt;/leads</code> erstellt einen Lead in DealFlow.One.</li>
  <li>Owner wird via Routing-Regeln zugewiesen (oder Default-Owner / unzugewiesen).</li>
  <li>E-Mail-Domain wird angereichert (Firmenname, Favicon, Title/Description).</li>
  <li>KI-Zusammenfassung landet auf dem Lead, der Owner bekommt Mail + Audit-Eintrag.</li>
  <li>Optional folgt Cal.com-Buchung — die Termin-Webhook-URL hängt sie an die Lead-Timeline.</li>
</ul>
${active ? `<script src="/api/external/widget/embed.js" data-public-key="${active.key}" async></script>` : ""}
</body></html>`;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.send(html);
  })().catch((err) => {
    logger.error({ err }, "widget demo render failed");
    res.status(500).send("demo unavailable");
  });
});

// ─────────────────────────── 3. GET config (public) ───────────────────────────

router.get("/external/widget/:publicKey/config", async (req: Request, res: Response) => {
  const resolved = await resolveBrandByPublicKey(String(req.params.publicKey));
  if (!resolved) {
    res.setHeader("access-control-allow-origin", "*");
    res.status(404).json({ enabled: false });
    return;
  }
  const cfg = mergeWidgetConfig(resolved.brand.widgetConfig ?? null);
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("cache-control", "public, max-age=60");
  res.json({
    enabled: true,
    brandName: resolved.brand.name,
    primaryColor: cfg.primaryColor ?? resolved.brand.primaryColor ?? resolved.brand.color,
    logoUrl: resolved.brand.logoUrl,
    greeting: cfg.greeting,
    thankYou: cfg.thankYou,
    submitLabel: cfg.submitLabel,
    fields: cfg.fields,
    calComEnabled: cfg.calComEnabled,
    calComUrl: cfg.calComEnabled ? cfg.calComUrl : null,
  });
});

// CORS preflight
router.options("/external/widget/:publicKey/config", (_req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.status(204).end();
});
router.options("/external/widget/:publicKey/leads", (_req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.status(204).end();
});

// ─────────────────────────── 4. POST submit ───────────────────────────

router.post("/external/widget/:publicKey/leads", async (req: Request, res: Response) => {
  res.setHeader("access-control-allow-origin", "*");
  const resolved = await resolveBrandByPublicKey(String(req.params.publicKey));
  if (!resolved) {
    res.status(404).json({ error: "widget_not_found" });
    return;
  }
  const ip = clientIp(req);
  const limit = checkRateLimit(resolved.brand.id, ip);
  if (!limit.allowed) {
    res.setHeader("retry-after", String(limit.retryAfterSeconds));
    res.status(429).json({ error: "rate_limited", retryAfterSeconds: limit.retryAfterSeconds });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = asString(body.name);
  const email = asString(body.email);
  if (!name || name.length < 2) { res.status(422).json({ error: "name_required" }); return; }
  if (!email || !isEmail(email)) { res.status(422).json({ error: "valid_email_required" }); return; }
  const phone = asString(body.phone);
  const companyNameInput = asString(body.companyName);
  const referrer = asString(body.referrer);
  const userAgent = req.header("user-agent") ?? null;
  const qualifierRaw = (body.qualifier ?? {}) as Record<string, unknown>;
  const qualifier: Record<string, string> = {};
  for (const [k, v] of Object.entries(qualifierRaw)) {
    if (typeof k !== "string" || k.length === 0 || k.length > 64) continue;
    const val = asString(v);
    if (!val) continue;
    qualifier[k] = clamp(val, MAX_QUALIFIER_VALUE);
  }

  // Tenant + Brand validiert. Enrichment + Routing parallel berechnen.
  const enrichment = await enrichFromEmail(email);
  const finalCompanyName = companyNameInput
    ?? (enrichment && !enrichment.error ? enrichment.companyName : null);

  // Dedup: gibt es bereits einen Lead derselben Brand mit gleicher
  // E-Mail (case-insensitive) und Status ≠ converted? Wenn ja, Aktivität
  // anhängen statt neuen Lead anzulegen.
  const existing = (await db
    .select()
    .from(leadsTable)
    .where(and(eq(leadsTable.tenantId, resolved.tenantId), eq(leadsTable.brandId, resolved.brand.id)))
  ).find((l) => l.email && l.email.toLowerCase() === email.toLowerCase() && l.status !== "converted");

  // Routing-Regel anwenden — nur für neue Leads, bestehende behalten den
  // bereits gesetzten Owner.
  const rules = (resolved.brand.widgetRoutingRules ?? []) as RoutingRule[];
  const route = evaluateRoutingRules(rules, {
    email,
    companyName: finalCompanyName,
    qualifier,
    enrichmentDomain: enrichment?.domain ?? extractDomain(email),
  });
  let assignedOwnerId: string | null = route?.ownerId ?? null;
  if (assignedOwnerId) {
    const [u] = await db
      .select({ id: usersTable.id, tenantId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.id, assignedOwnerId));
    if (!u || u.tenantId !== resolved.tenantId) {
      logger.warn({ brandId: resolved.brand.id, owner: assignedOwnerId }, "widget routing: owner not in tenant");
      assignedOwnerId = null;
    }
  }

  const now = new Date();
  const ipHashed = hashIp(ip, IP_HASH_SALT);
  const widgetMeta = {
    ipHash: ipHashed,
    userAgent: userAgent ? clamp(userAgent, 300) : undefined,
    referrer: referrer ? clamp(referrer, 500) : undefined,
    qualifier,
    routedByRuleId: route?.ruleId ?? null,
    duplicateOfLeadId: existing?.id ?? null,
  } as const;

  let leadId: string;
  let isNew = false;
  if (existing) {
    leadId = existing.id;
    const note = `\n\n— Widget-Anfrage (${now.toISOString()})${
      Object.keys(qualifier).length ? `\n${Object.entries(qualifier).map(([k, v]) => `${k}: ${v}`).join("\n")}` : ""
    }`;
    const newNotes = clamp(`${existing.notes ?? ""}${note}`.trim(), MAX_MESSAGE_LENGTH * 4);
    await db.update(leadsTable)
      .set({
        notes: newNotes,
        lastContactAt: now,
        widgetMeta,
        updatedAt: now,
      })
      .where(eq(leadsTable.id, existing.id));
    await db.insert(auditLogTable).values({
      id: `au_${randomUUID().slice(0, 10)}`,
      tenantId: resolved.tenantId,
      entityType: "lead",
      entityId: existing.id,
      action: "inbound_widget",
      actor: `Brand-Widget (${resolved.brand.name})`,
      summary: `Wiederholte Widget-Anfrage von ${email} an Lead "${existing.name}"`,
      beforeJson: null,
      afterJson: JSON.stringify({ qualifier, referrer }),
      activeScopeJson: null,
    });
  } else {
    leadId = `ld_${randomUUID().slice(0, 8)}`;
    isNew = true;
    await db.insert(leadsTable).values({
      id: leadId,
      tenantId: resolved.tenantId,
      name: clamp(name, MAX_NAME_LENGTH),
      companyName: finalCompanyName ? clamp(finalCompanyName, MAX_NAME_LENGTH) : null,
      email,
      phone,
      source: "website_widget",
      status: "new",
      ownerId: assignedOwnerId,
      brandId: resolved.brand.id,
      enrichment: enrichment ?? undefined,
      widgetMeta,
      notes: qualifier.message ?? null,
      lastContactAt: now,
    });
    await db.insert(auditLogTable).values({
      id: `au_${randomUUID().slice(0, 10)}`,
      tenantId: resolved.tenantId,
      entityType: "lead",
      entityId: leadId,
      action: "create",
      actor: `Brand-Widget (${resolved.brand.name})`,
      summary: `Lead "${name}" via Widget der Brand "${resolved.brand.name}" angelegt`,
      beforeJson: null,
      afterJson: JSON.stringify({ source: "website_widget", brandId: resolved.brand.id, ownerId: assignedOwnerId, routedByRuleId: route?.ruleId ?? null }),
      activeScopeJson: null,
    });
  }

  // Antwort sofort senden — Notification + AI laufen async (das ist OK,
  // der Lead ist bereits persistiert).
  res.status(201).json({ ok: true, leadId, deduped: !isNew });

  // Async: AI-Summary erzeugen + Owner benachrichtigen.
  void (async () => {
    try {
      let aiSummary: string | null = null;
      if (isAIConfigured() && isNew) {
        const ctx: LeadWidgetSummaryInput = {
          brandName: resolved.brand.name,
          leadName: name,
          email,
          phone,
          companyName: finalCompanyName,
          message: qualifier.message ?? null,
          qualifierAnswers: qualifier,
          enrichment: enrichment ? {
            domain: enrichment.domain,
            title: enrichment.title,
            description: enrichment.description,
            websiteUrl: enrichment.websiteUrl,
          } : null,
          hasBookedMeeting: false,
        };
        // runStructured benötigt Scope — wir bauen einen System-Scope für
        // den Widget-Kontext (kein User logged in, aber tenantId ist klar).
        // Wir nutzen den ersten tenantWide-Admin als Pseudo-User für Audit.
        const [admin] = await db
          .select()
          .from(usersTable)
          .where(and(eq(usersTable.tenantId, resolved.tenantId), eq(usersTable.tenantWide, true)))
          .limit(1);
        if (admin) {
          const widgetScope: Scope = {
            user: admin,
            tenantId: resolved.tenantId,
            tenantWide: true,
            companyIds: [],
            brandIds: [],
            activeCompanyIds: null,
            activeBrandIds: null,
          };
          try {
            const ai = await runStructured<LeadWidgetSummaryInput, { headline: string; summary: string; intent: string; suggestedNextAction: string }>({
              promptKey: "lead.widgetSummary",
              input: ctx,
              scope: widgetScope,
              entityRef: { entityType: "lead", entityId: leadId },
            });
            aiSummary = `${ai.output.headline}\n\n${ai.output.summary}\n\nIntent: ${ai.output.intent} — Vorschlag: ${ai.output.suggestedNextAction}`;
            await db.update(leadsTable).set({ aiSummary }).where(eq(leadsTable.id, leadId));
          } catch (err) {
            const e = err as AIOrchestrationError;
            logger.warn({ leadId, err: e.message }, "widget AI summary failed (non-fatal)");
          }
        }
      }

      // E-Mail an Owner (oder, wenn kein Owner zugewiesen, an alle
      // tenantWide-User). Im "Log-Mode" landet das im Server-Log.
      let recipientEmails: string[] = [];
      if (assignedOwnerId) {
        const [owner] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, assignedOwnerId));
        if (owner?.email) recipientEmails = [owner.email];
      } else {
        const admins = await db.select({ email: usersTable.email }).from(usersTable)
          .where(and(eq(usersTable.tenantId, resolved.tenantId), eq(usersTable.tenantWide, true)));
        recipientEmails = admins.map((a) => a.email).filter(Boolean);
      }
      if (recipientEmails.length > 0) {
        const subject = isNew
          ? `Neuer Widget-Lead: ${name} (${resolved.brand.name})`
          : `Erneute Widget-Anfrage: ${name} (${resolved.brand.name})`;
        const lines = [
          `Brand: ${resolved.brand.name}`,
          `Name: ${name}`,
          `E-Mail: ${email}`,
          phone ? `Telefon: ${phone}` : null,
          finalCompanyName ? `Unternehmen: ${finalCompanyName}` : null,
          enrichment?.domain ? `Domain: ${enrichment.domain}` : null,
          enrichment?.title ? `Website-Titel: ${enrichment.title}` : null,
          Object.keys(qualifier).length ? `\nQualifier:\n${Object.entries(qualifier).map(([k, v]) => `  ${k}: ${v}`).join("\n")}` : null,
          aiSummary ? `\nKI-Zusammenfassung:\n${aiSummary}` : null,
          `\n→ Lead-Detail: /leads/${leadId}`,
        ].filter(Boolean).join("\n");
        const html = `<pre style="font-family:ui-monospace,Menlo,monospace;white-space:pre-wrap;">${lines
          .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
        for (const to of recipientEmails) {
          try {
            await sendEmail({
              to,
              from: { email: "no-reply@dealflow.local", name: "DealFlow One" },
              subject,
              text: lines,
              html,
              tags: { kind: "widget_lead" },
            });
          } catch (err) {
            logger.warn({ leadId, to, err }, "widget owner notification failed");
          }
        }
      }
    } catch (err) {
      logger.error({ leadId, err }, "widget post-submit pipeline failed");
    }
  })();
});

// ─────────────────────────── 5. Cal.com Webhook ───────────────────────────

router.post("/external/widget/:publicKey/cal-webhook", async (req: Request, res: Response) => {
  const resolved = await resolveBrandByPublicKey(String(req.params.publicKey));
  if (!resolved) { res.status(404).json({ error: "widget_not_found" }); return; }
  if (!resolved.brand.widgetCalSecret) {
    res.status(412).json({ error: "cal_secret_not_configured" });
    return;
  }
  const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? "";
  const sig = req.header("x-cal-signature-256") ?? req.header("x-cal-signature");
  const ok = verifyCalSignature(rawBody, sig, resolved.brand.widgetCalSecret);
  if (!ok) {
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const triggerEvent = asString(body.triggerEvent) ?? asString(body.event);
  const payload = (body.payload ?? {}) as Record<string, unknown>;

  // Cal.com: payload.metadata kann unsere Lead-ID enthalten (das setzt
  // unser embed.js bei der Buchung). Fallback: payload.attendees[0].email
  // → Lead-Lookup per E-Mail in der Brand.
  const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
  const leadIdFromMeta = asString(metadata.leadId);
  let leadId: string | null = leadIdFromMeta;
  let leadEmail: string | null = null;
  const attendees = Array.isArray(payload.attendees) ? payload.attendees as Array<Record<string, unknown>> : [];
  if (attendees[0]) leadEmail = asString(attendees[0].email);

  if (!leadId && leadEmail) {
    const candidates = await db.select().from(leadsTable)
      .where(and(eq(leadsTable.tenantId, resolved.tenantId), eq(leadsTable.brandId, resolved.brand.id)));
    const m = candidates.find((l) => l.email?.toLowerCase() === leadEmail!.toLowerCase());
    if (m) leadId = m.id;
  }

  if (!leadId) {
    res.status(202).json({ ok: true, matched: false, reason: "no_lead_match" });
    return;
  }

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
  if (!lead || lead.tenantId !== resolved.tenantId || lead.brandId !== resolved.brand.id) {
    res.status(403).json({ error: "lead_not_in_brand" });
    return;
  }

  const calBooking = {
    bookingId: asString(payload.uid) ?? asString(payload.bookingId) ?? undefined,
    eventTypeId: asString((payload.eventType as Record<string, unknown> | undefined)?.id) ?? undefined,
    startTime: asString(payload.startTime) ?? undefined,
    endTime: asString(payload.endTime) ?? undefined,
    attendeeEmail: leadEmail ?? undefined,
    meetingUrl: asString(payload.meetingUrl) ?? null,
    status: triggerEvent ?? "BOOKING_CREATED",
    receivedAt: new Date().toISOString(),
  };

  const newWidgetMeta = { ...(lead.widgetMeta ?? {}), calBooking };
  await db.update(leadsTable)
    .set({ widgetMeta: newWidgetMeta, updatedAt: new Date() })
    .where(eq(leadsTable.id, leadId));

  await db.insert(auditLogTable).values({
    id: `au_${randomUUID().slice(0, 10)}`,
    tenantId: resolved.tenantId,
    entityType: "lead",
    entityId: leadId,
    action: "cal_booking",
    actor: `Cal.com (${resolved.brand.name})`,
    summary: `Termin ${calBooking.status} via Cal.com${calBooking.startTime ? ` für ${calBooking.startTime}` : ""}`,
    beforeJson: null,
    afterJson: JSON.stringify(calBooking),
    activeScopeJson: null,
  });

  res.json({ ok: true, matched: true, leadId });
});

export default router;

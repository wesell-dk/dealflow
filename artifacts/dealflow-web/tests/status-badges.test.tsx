// Smoke test for the central status-badge tone system.
//
// This is the executable counterpart of `tests/status-badges.e2e.md`.
// Where the e2e plan exercises real pages in a browser, this test
// pins the tone-class output of every badge component so that any
// accidental drift (e.g. someone hard-codes `bg-amber-100` in a new
// component, or changes the tone of an existing status without
// updating the central palette) is caught at `pnpm run ci` time —
// no browser, DB, or auth required.
//
// Run via:  pnpm --filter @workspace/dealflow-web test
//
// One regression assertion per migrated page surface is included
// (Negotiation reactions, Price-Increase counters + status,
// Clause tones, Clause compatibility, Translation status, Override
// marker, Suggestion status, Insight kind tone) per the code-review
// requirements for task #185.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TONE_CLASSES,
  TONE_TEXT_CLASSES,
  TONE_ICON_CLASSES,
  TONE_DOT_CLASSES,
  TONE_TINT_BG_CLASSES,
  ToneBadge,
  RiskBadge,
  PriceIncreaseStatusBadge,
  NegotiationReactionBadge,
  PriceIncreaseCounterBadge,
  ClauseToneBadge,
  SuggestionStatusBadge,
  ClauseCompatibilityBadge,
  TranslationStatusBadge,
  OverrideMarkerBadge,
  getInsightKindTone,
  getSeverityTone,
} from "../src/components/patterns/status-badges.tsx";

// ─── 1. Tone palettes are well-formed ─────────────────────────────
test("TONE_CLASSES covers every tone with bg/border/text", () => {
  for (const tone of ["neutral", "info", "success", "warning", "danger", "muted"] as const) {
    const c = TONE_CLASSES[tone];
    assert.ok(c, `TONE_CLASSES[${tone}] should be defined`);
    // every tone must include border + text + bg utilities
    assert.match(c, /\bborder-/, `${tone} must declare a border color`);
    assert.match(c, /\btext-/, `${tone} must declare a text color`);
    assert.match(c, /\bbg-/, `${tone} must declare a background color`);
  }
});

test("TONE_TEXT_CLASSES uses dark-mode aware *-700 / *-300 pairs", () => {
  assert.match(TONE_TEXT_CLASSES.success, /text-emerald-700/);
  assert.match(TONE_TEXT_CLASSES.success, /dark:text-emerald-300/);
  assert.match(TONE_TEXT_CLASSES.warning, /text-amber-700/);
  assert.match(TONE_TEXT_CLASSES.warning, /dark:text-amber-300/);
  assert.match(TONE_TEXT_CLASSES.danger,  /text-rose-700/);
  assert.match(TONE_TEXT_CLASSES.danger,  /dark:text-rose-300/);
  assert.match(TONE_TEXT_CLASSES.info,    /text-sky-700/);
  assert.match(TONE_TEXT_CLASSES.info,    /dark:text-sky-300/);
});

test("TONE_ICON_CLASSES uses *-600 / *-400 pairs (one shade brighter)", () => {
  assert.match(TONE_ICON_CLASSES.success, /text-emerald-600/);
  assert.match(TONE_ICON_CLASSES.warning, /text-amber-600/);
  assert.match(TONE_ICON_CLASSES.danger,  /text-rose-600/);
  assert.match(TONE_ICON_CLASSES.info,    /text-sky-600/);
});

test("TONE_DOT_CLASSES emits solid background fills", () => {
  assert.equal(TONE_DOT_CLASSES.success, "bg-emerald-500");
  assert.equal(TONE_DOT_CLASSES.warning, "bg-amber-500");
  assert.equal(TONE_DOT_CLASSES.danger,  "bg-destructive");
  assert.equal(TONE_DOT_CLASSES.info,    "bg-sky-500");
});

test("TONE_TINT_BG_CLASSES emits 10%-opacity tone backdrops", () => {
  assert.equal(TONE_TINT_BG_CLASSES.success, "bg-emerald-500/10");
  assert.equal(TONE_TINT_BG_CLASSES.warning, "bg-amber-500/10");
  assert.equal(TONE_TINT_BG_CLASSES.danger,  "bg-rose-500/10");
  assert.equal(TONE_TINT_BG_CLASSES.info,    "bg-sky-500/10");
});

// ─── 2. ToneBadge wraps Badge with the right tone classes ─────────
test("ToneBadge renders with the success tone palette", () => {
  const html = renderToStaticMarkup(
    createElement(ToneBadge, { tone: "success" }, "Akzeptiert"),
  );
  assert.match(html, /bg-emerald-50/);
  assert.match(html, /text-emerald-800/);
  assert.match(html, /border-emerald-200/);
  assert.match(html, /Akzeptiert/);
});

test("ToneBadge renders with the danger tone palette", () => {
  const html = renderToStaticMarkup(
    createElement(ToneBadge, { tone: "danger" }, "Abgelehnt"),
  );
  assert.match(html, /bg-rose-50/);
  assert.match(html, /text-rose-800/);
});

// ─── 3. Risk + PriceIncreaseStatus regressions ────────────────────
test("RiskBadge maps high → danger palette", () => {
  const html = renderToStaticMarkup(createElement(RiskBadge, { risk: "high" }));
  assert.match(html, /bg-rose-50/);
  assert.match(html, /Hoch/);
});

test("RiskBadge maps low → success palette", () => {
  const html = renderToStaticMarkup(createElement(RiskBadge, { risk: "low" }));
  assert.match(html, /bg-emerald-50/);
  assert.match(html, /Niedrig/);
});

test("PriceIncreaseStatusBadge renders 'completed' as success", () => {
  const html = renderToStaticMarkup(
    createElement(PriceIncreaseStatusBadge, { status: "completed" }),
  );
  assert.match(html, /bg-emerald-50/);
  assert.match(html, /Abgeschlossen/);
});

test("PriceIncreaseStatusBadge renders 'draft' as muted", () => {
  const html = renderToStaticMarkup(
    createElement(PriceIncreaseStatusBadge, { status: "draft" }),
  );
  assert.doesNotMatch(html, /bg-emerald-50/);
  assert.doesNotMatch(html, /bg-rose-50/);
  assert.match(html, /Entwurf/);
});

// ─── 4. NegotiationReactionBadge ─ migrated page #1 ───────────────
test("NegotiationReactionBadge: acceptance → success", () => {
  const html = renderToStaticMarkup(
    createElement(NegotiationReactionBadge, { type: "acceptance" }),
  );
  assert.match(html, /bg-emerald-50/);
  assert.match(html, /Akzeptiert/);
});

test("NegotiationReactionBadge: price_rejected → danger", () => {
  const html = renderToStaticMarkup(
    createElement(NegotiationReactionBadge, { type: "price_rejected" }),
  );
  assert.match(html, /bg-rose-50/);
  assert.match(html, /Preis abgelehnt/);
});

test("NegotiationReactionBadge: objection → warning", () => {
  const html = renderToStaticMarkup(
    createElement(NegotiationReactionBadge, { type: "objection" }),
  );
  assert.match(html, /bg-amber-50/);
  assert.match(html, /Einwand/);
});

test("NegotiationReactionBadge: question → info", () => {
  const html = renderToStaticMarkup(
    createElement(NegotiationReactionBadge, { type: "question" }),
  );
  assert.match(html, /bg-sky-50/);
});

test("NegotiationReactionBadge: unknown type falls back to neutral", () => {
  const html = renderToStaticMarkup(
    createElement(NegotiationReactionBadge, { type: "totally_made_up" }),
  );
  assert.match(html, /bg-muted/);
  assert.match(html, /totally_made_up/);
});

// ─── 5. PriceIncreaseCounterBadge ─ migrated page #2/#3 ───────────
test("PriceIncreaseCounterBadge accepted → success palette + count + label", () => {
  const html = renderToStaticMarkup(
    createElement(PriceIncreaseCounterBadge, {
      kind: "accepted",
      count: 7,
      label: "akzeptiert",
    }),
  );
  assert.match(html, /bg-emerald-50/);
  assert.match(html, /7 akzeptiert/);
});

test("PriceIncreaseCounterBadge pending → warning, rejected → danger", () => {
  const pending = renderToStaticMarkup(
    createElement(PriceIncreaseCounterBadge, {
      kind: "pending", count: 3, label: "offen",
    }),
  );
  assert.match(pending, /bg-amber-50/);

  const rejected = renderToStaticMarkup(
    createElement(PriceIncreaseCounterBadge, {
      kind: "rejected", count: 2, label: "abgelehnt",
    }),
  );
  assert.match(rejected, /bg-rose-50/);
});

// ─── 6. ClauseToneBadge ─ migrated page #4 ───────────────────────
test("ClauseToneBadge: zart → danger, streng → success, hart → neutral", () => {
  const zart = renderToStaticMarkup(
    createElement(ClauseToneBadge, { tone: "zart" }),
  );
  assert.match(zart, /bg-rose-50/);

  const streng = renderToStaticMarkup(
    createElement(ClauseToneBadge, { tone: "streng" }),
  );
  assert.match(streng, /bg-emerald-50/);

  const hart = renderToStaticMarkup(
    createElement(ClauseToneBadge, { tone: "hart" }),
  );
  assert.match(hart, /bg-muted/);
});

test("ClauseToneBadge: moderat → warning, standard → info", () => {
  const moderat = renderToStaticMarkup(
    createElement(ClauseToneBadge, { tone: "moderat" }),
  );
  assert.match(moderat, /bg-amber-50/);

  const standard = renderToStaticMarkup(
    createElement(ClauseToneBadge, { tone: "standard" }),
  );
  assert.match(standard, /bg-sky-50/);
});

// ─── 7. SuggestionStatusBadge ─ migrated page #5 ──────────────────
test("SuggestionStatusBadge: open → warning, accepted → success, rejected → danger", () => {
  assert.match(
    renderToStaticMarkup(createElement(SuggestionStatusBadge, { status: "open" })),
    /bg-amber-50/,
  );
  assert.match(
    renderToStaticMarkup(createElement(SuggestionStatusBadge, { status: "accepted" })),
    /bg-emerald-50/,
  );
  assert.match(
    renderToStaticMarkup(createElement(SuggestionStatusBadge, { status: "rejected" })),
    /bg-rose-50/,
  );
});

// ─── 8. ClauseCompatibilityBadge ─ migrated page #4 ──────────────
test("ClauseCompatibilityBadge: conflicts → danger, requires → warning", () => {
  const conflicts = renderToStaticMarkup(
    createElement(ClauseCompatibilityBadge, { kind: "conflicts", label: "schließt aus" }),
  );
  assert.match(conflicts, /bg-rose-50/);
  assert.match(conflicts, /schließt aus/);

  const requires = renderToStaticMarkup(
    createElement(ClauseCompatibilityBadge, { kind: "requires", label: "benötigt" }),
  );
  assert.match(requires, /bg-amber-50/);
  assert.match(requires, /benötigt/);
});

// ─── 9. TranslationStatusBadge ─ migrated page #4 ────────────────
test("TranslationStatusBadge: present DE → success, missing EN → warning", () => {
  const dePresent = renderToStaticMarkup(
    createElement(TranslationStatusBadge, { present: true, locale: "de", label: "vorhanden" }),
  );
  assert.match(dePresent, /bg-emerald-50/);
  assert.match(dePresent, /DE · vorhanden/);

  const enMissing = renderToStaticMarkup(
    createElement(TranslationStatusBadge, { present: false, locale: "en", label: "fehlt" }),
  );
  assert.match(enMissing, /bg-amber-50/);
  assert.match(enMissing, /EN · fehlt/);
});

test("TranslationStatusBadge: present EN → info (not success, to differentiate from DE)", () => {
  const enPresent = renderToStaticMarkup(
    createElement(TranslationStatusBadge, { present: true, locale: "en", label: "present" }),
  );
  assert.match(enPresent, /bg-sky-50/);
});

// ─── 10. OverrideMarkerBadge ─ migrated page #4 ──────────────────
test("OverrideMarkerBadge always renders warning palette", () => {
  const html = renderToStaticMarkup(
    createElement(OverrideMarkerBadge, { label: "Override aktiv" }),
  );
  assert.match(html, /bg-amber-50/);
  assert.match(html, /Override aktiv/);
});

// ─── 11. getInsightKindTone ─ migrated page #6 ───────────────────
test("getInsightKindTone maps Risk/NextAction/Opportunity to the right tone", () => {
  assert.equal(getInsightKindTone("Risk"), "danger");
  assert.equal(getInsightKindTone("NextAction"), "warning");
  assert.equal(getInsightKindTone("Opportunity"), "success");
  assert.equal(getInsightKindTone("UnknownKind"), "neutral");
  assert.equal(getInsightKindTone(null), "neutral");
  assert.equal(getInsightKindTone(undefined), "neutral");
});

// ─── 12. getSeverityTone (used by clauses severityDot) ───────────
test("getSeverityTone covers low/medium/high/critical and unknown", () => {
  assert.equal(getSeverityTone("low"),      "success");
  assert.equal(getSeverityTone("medium"),   "warning");
  assert.equal(getSeverityTone("high"),     "danger");
  assert.equal(getSeverityTone("critical"), "danger");
  assert.equal(getSeverityTone("unknown"),  "neutral");
  assert.equal(getSeverityTone(null),       "neutral");
});

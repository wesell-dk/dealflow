// Pure unit tests for the Renewal-Engine risk-score formula (Task #66).
// Importiert die Funktion direkt aus dem dedizierten Lib-Modul, damit der
// Test ohne DB, ohne Express und ohne Drizzle laufen kann (sub-Sekunden-CI).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRenewalRiskScore } from "../src/lib/renewalRisk";

describe("computeRenewalRiskScore — formula", () => {
  it("returns 0 with no risky inputs and emits no factors", () => {
    const r = computeRenewalRiskScore({
      openObligationsCount: 0,
      accountHealthScore: 100,
      avgDiscountPct: 0,
      daysSinceLastTouch: 5,
    });
    assert.equal(r.score, 0);
    assert.deepEqual(r.factors, []);
  });

  it("scores 5 points per open obligation, capped at 25", () => {
    const r1 = computeRenewalRiskScore({
      openObligationsCount: 3,
      accountHealthScore: 100,
      avgDiscountPct: null,
      daysSinceLastTouch: null,
    });
    assert.equal(r1.score, 15);
    const f1 = r1.factors.find((f) => f.key === "openObligations");
    assert.ok(f1, "expected openObligations factor");
    assert.equal(f1!.points, 15);

    const r2 = computeRenewalRiskScore({
      openObligationsCount: 12,
      accountHealthScore: 100,
      avgDiscountPct: null,
      daysSinceLastTouch: null,
    });
    assert.equal(r2.score, 25, "12 obligations × 5 = 60 must be capped at 25");
  });

  it("scores account-health drop as (100 - health)/2, capped at 25", () => {
    const r = computeRenewalRiskScore({
      openObligationsCount: 0,
      accountHealthScore: 60,
      avgDiscountPct: null,
      daysSinceLastTouch: null,
    });
    // (100 - 60) / 2 = 20
    assert.equal(r.score, 20);
    assert.equal(r.factors.find((f) => f.key === "accountHealth")?.points, 20);

    const rExtreme = computeRenewalRiskScore({
      openObligationsCount: 0,
      accountHealthScore: 0,
      avgDiscountPct: null,
      daysSinceLastTouch: null,
    });
    // (100 - 0) / 2 = 50, capped at 25
    assert.equal(rExtreme.score, 25);
  });

  it("ignores account-health when null", () => {
    const r = computeRenewalRiskScore({
      openObligationsCount: 0,
      accountHealthScore: null,
      avgDiscountPct: null,
      daysSinceLastTouch: null,
    });
    assert.equal(r.score, 0);
    assert.equal(r.factors.find((f) => f.key === "accountHealth"), undefined);
  });

  it("scores discount-drift only above 10 % threshold (1 pt per percent over 10, cap 25)", () => {
    // 10 % → 0 Punkte (Schwelle, nicht über)
    const at = computeRenewalRiskScore({
      openObligationsCount: 0,
      accountHealthScore: 100,
      avgDiscountPct: 10,
      daysSinceLastTouch: null,
    });
    assert.equal(at.score, 0);
    assert.equal(at.factors.find((f) => f.key === "discountDrift"), undefined);

    // 25 % → 15 Punkte
    const mid = computeRenewalRiskScore({
      openObligationsCount: 0,
      accountHealthScore: 100,
      avgDiscountPct: 25,
      daysSinceLastTouch: null,
    });
    assert.equal(mid.score, 15);

    // 80 % → cap auf 25
    const hi = computeRenewalRiskScore({
      openObligationsCount: 0,
      accountHealthScore: 100,
      avgDiscountPct: 80,
      daysSinceLastTouch: null,
    });
    assert.equal(hi.score, 25);
  });

  it("treats inactivity as all-or-nothing at 60 days (+25)", () => {
    const fresh = computeRenewalRiskScore({
      openObligationsCount: 0,
      accountHealthScore: 100,
      avgDiscountPct: null,
      daysSinceLastTouch: 59,
    });
    assert.equal(fresh.score, 0);
    assert.equal(fresh.factors.find((f) => f.key === "inactivity"), undefined);

    const stale = computeRenewalRiskScore({
      openObligationsCount: 0,
      accountHealthScore: 100,
      avgDiscountPct: null,
      daysSinceLastTouch: 60,
    });
    assert.equal(stale.score, 25);
    assert.equal(stale.factors.find((f) => f.key === "inactivity")?.points, 25);
  });

  it("sums factors and clamps total to 100", () => {
    // Worst case: alle vier Faktoren auf cap (25 + 25 + 25 + 25) = 100
    const worst = computeRenewalRiskScore({
      openObligationsCount: 50,
      accountHealthScore: 0,
      avgDiscountPct: 100,
      daysSinceLastTouch: 365,
    });
    assert.equal(worst.score, 100);
    assert.equal(worst.factors.length, 4, "all four factors must be reported");
    const total = worst.factors.reduce((s, f) => s + f.points, 0);
    assert.equal(total, 100);
  });

  it("does not emit baseline / phantom factors", () => {
    const r = computeRenewalRiskScore({
      openObligationsCount: 1,
      accountHealthScore: 100,
      avgDiscountPct: 0,
      daysSinceLastTouch: 0,
    });
    // 1 × 5 = 5; alle anderen unter Schwelle → genau ein Faktor
    assert.equal(r.score, 5);
    assert.equal(r.factors.length, 1);
    assert.equal(r.factors[0]!.key, "openObligations");
  });

  it("never produces negative inputs (defensive: clamps neg counts to 0)", () => {
    const r = computeRenewalRiskScore({
      openObligationsCount: -3,
      accountHealthScore: 100,
      avgDiscountPct: null,
      daysSinceLastTouch: null,
    });
    assert.equal(r.score, 0);
    assert.equal(r.factors.length, 0);
  });

  it("crosses risk-threshold (≥ 70) only when multiple factors stack", () => {
    // 3 Pflichten (15) + Health 70 (15) + 20 % Discount (10) = 40 → noch nicht „rot"
    const moderate = computeRenewalRiskScore({
      openObligationsCount: 3,
      accountHealthScore: 70,
      avgDiscountPct: 20,
      daysSinceLastTouch: 30,
    });
    assert.ok(moderate.score < 70, `expected < 70, got ${moderate.score}`);

    // Plus Inaktivität (+25) → 65; plus mehr Pflichten → über 70
    const risky = computeRenewalRiskScore({
      openObligationsCount: 5,
      accountHealthScore: 50,
      avgDiscountPct: 25,
      daysSinceLastTouch: 90,
    });
    // 25 + 25 + 15 + 25 = 90
    assert.ok(risky.score >= 70, `expected ≥ 70, got ${risky.score}`);
  });
});

// Reine, datenbankfreie Risk-Score-Berechnung für die Renewal-Engine (Task #66).
// Gehalten als eigenes Modul, damit ein schneller Unit-Test die Formel
// gegen festgelegte Eingaben prüfen kann, ohne den ganzen Express-Stack
// oder Drizzle/PG zu booten.
//
// Punkte-Caps pro Faktor sind absichtlich klein (≤ 25), damit kein einzelner
// Faktor den Score auf 100 drückt und mehrere Faktoren sich addieren müssen,
// um „rotes" Risiko (≥ 70) zu erzeugen. Summe wird abschließend auf [0..100]
// geklammert.

export type RenewalRiskFactor = {
  key: string;
  label: string;
  points: number;
  detail?: string;
};

export type RenewalRiskInput = {
  openObligationsCount: number;
  accountHealthScore: number | null;
  avgDiscountPct: number | null;
  daysSinceLastTouch: number | null;
};

export interface RenewalRiskResult {
  score: number;
  factors: RenewalRiskFactor[];
}

export function computeRenewalRiskScore(input: RenewalRiskInput): RenewalRiskResult {
  const factors: RenewalRiskFactor[] = [];
  let score = 0;

  // Offene Pflichten: 5 Punkte je offener Obligation, max 25.
  const obPts = Math.min(25, Math.max(0, input.openObligationsCount) * 5);
  if (obPts > 0) {
    score += obPts;
    factors.push({
      key: "openObligations",
      label: `Offene Pflichten (${input.openObligationsCount})`,
      points: obPts,
    });
  }

  // Account-Health: niedriger Health → höheres Risiko. (100-health)/2, max 25.
  if (input.accountHealthScore != null) {
    const hpPts = Math.max(0, Math.min(25, Math.round((100 - input.accountHealthScore) / 2)));
    if (hpPts > 0) {
      score += hpPts;
      factors.push({
        key: "accountHealth",
        label: `Niedrige Account-Health (${input.accountHealthScore})`,
        points: hpPts,
      });
    }
  }

  // Discount-Drift: hoher durchschn. Discount → Pricing fragil. Erst ab 10 %
  // wird gewertet (1 Pkt je weiterer %), max 25.
  if (input.avgDiscountPct != null) {
    const dPts = Math.max(0, Math.min(25, Math.round(input.avgDiscountPct - 10)));
    if (dPts > 0) {
      score += dPts;
      factors.push({
        key: "discountDrift",
        label: `Hoher Discount (Ø ${input.avgDiscountPct.toFixed(1)} %)`,
        points: dPts,
      });
    }
  }

  // Inaktivität: keine Aktivität ≥ 60 Tage → +25 (alles-oder-nichts, weil
  // 60 Tage Funkstille vor Renewal ein klarer Alarm ist).
  if (input.daysSinceLastTouch != null && input.daysSinceLastTouch >= 60) {
    score += 25;
    factors.push({
      key: "inactivity",
      label: `No activity for a long time (${input.daysSinceLastTouch} days)`,
      points: 25,
    });
  }

  if (score > 100) score = 100;
  if (score < 0) score = 0;
  return { score, factors };
}

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  clauseImportSegment,
  coerceClauseImportSegmentInput,
} from "../src/lib/ai/prompts/dealflow";

// Eine valide Mindest-Antwort: ein einziges, valides segment + leere notes.
// Wir setzen `notes` in den Tests danach pro Fall um.
function baseToolInput(): Record<string, unknown> {
  return {
    segments: [
      {
        suggestedName: "Vertraulichkeit",
        suggestedSummary: "Beide Seiten halten Informationen geheim.",
        extractedText:
          "Die Parteien verpflichten sich, alle vertraulichen Informationen vertraulich zu behandeln.",
        pageHint: 1,
        suggestedTone: "standard",
        suggestedSeverity: "medium",
        suggestedFamilyId: null,
        alternativeMatches: [],
        matchedVariantId: null,
        similarityScore: null,
      },
    ],
    notes: [],
  };
}

describe("Task #105 — clause-import notes sanitizer", () => {
  it("is wired into the clauseImportSegment prompt definition", () => {
    assert.equal(
      clauseImportSegment.coerceInput,
      coerceClauseImportSegmentInput,
      "coerceInput hook must point at the exported sanitizer",
    );
  });

  it("truncates an over-long note to exactly the schema cap (240 chars)", () => {
    const longNote = "A".repeat(395); // mirrors the Task #96 production case
    const raw = baseToolInput();
    raw.notes = ["short ok", longNote];
    const out = coerceClauseImportSegmentInput(raw) as { notes: string[] };
    assert.equal(out.notes.length, 2);
    assert.equal(out.notes[0], "short ok");
    assert.equal(out.notes[1]!.length, 240);
    assert.ok(
      out.notes[1]!.endsWith("…"),
      "truncated note should end with ellipsis",
    );
    // Schema must accept the sanitized version.
    const parsed = clauseImportSegment.outputSchema.safeParse(out);
    assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.message);
  });

  it("drops too-short, empty and non-string notes instead of failing", () => {
    const raw = baseToolInput();
    raw.notes = ["", " ", "x", "Sinnvolle Beobachtung", 42, null, "  another one  "];
    const out = coerceClauseImportSegmentInput(raw) as { notes: string[] };
    assert.deepEqual(out.notes, ["Sinnvolle Beobachtung", "another one"]);
    const parsed = clauseImportSegment.outputSchema.safeParse(out);
    assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.message);
  });

  it("caps an oversized notes array at 8 entries", () => {
    const raw = baseToolInput();
    raw.notes = Array.from({ length: 20 }, (_, i) => `Hinweis Nummer ${i + 1}`);
    const out = coerceClauseImportSegmentInput(raw) as { notes: string[] };
    assert.equal(out.notes.length, 8);
    assert.equal(out.notes[0], "Hinweis Nummer 1");
    assert.equal(out.notes[7], "Hinweis Nummer 8");
    const parsed = clauseImportSegment.outputSchema.safeParse(out);
    assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.message);
  });

  it("normalises a missing or wrong-typed notes field to []", () => {
    const cases: unknown[] = [
      { ...baseToolInput(), notes: undefined },
      { ...baseToolInput(), notes: null },
      { ...baseToolInput(), notes: "not an array" },
      { ...baseToolInput(), notes: { 0: "foo" } },
    ];
    for (const raw of cases) {
      const out = coerceClauseImportSegmentInput(raw) as { notes: string[] };
      assert.deepEqual(out.notes, []);
      const parsed = clauseImportSegment.outputSchema.safeParse(out);
      assert.equal(parsed.success, true, parsed.success ? "" : parsed.error.message);
    }
  });

  it("leaves segments and unrelated fields untouched", () => {
    const raw = baseToolInput() as Record<string, unknown> & {
      segments: unknown[];
    };
    const segmentsBefore = JSON.parse(JSON.stringify(raw.segments));
    const out = coerceClauseImportSegmentInput(raw) as Record<string, unknown>;
    assert.deepEqual(out.segments, segmentsBefore);
  });

  it("returns the input unchanged when it is not an object", () => {
    assert.equal(coerceClauseImportSegmentInput(null), null);
    assert.equal(coerceClauseImportSegmentInput(undefined), undefined);
    assert.equal(coerceClauseImportSegmentInput("nope"), "nope");
    assert.equal(coerceClauseImportSegmentInput(42), 42);
  });

  it("end-to-end: an over-long note no longer trips zod validation", () => {
    // Simuliert exakt den Production-Fall: Sonnet liefert eine extrem lange
    // Note. Vorher: schema.safeParse → fail → ganzer Job stirbt mit
    // validation_error. Jetzt: Sanitizer kürzt, schema akzeptiert.
    const raw = baseToolInput();
    raw.notes = [
      "Erste, kurze Note.",
      "Zweite, sehr ausfuehrliche Note die deutlich ueber das Limit hinaus geht: " +
        "B".repeat(500),
    ];

    // Ohne Sanitizer wuerde der Schema-Parse hier fehlschlagen.
    const naive = clauseImportSegment.outputSchema.safeParse(raw);
    assert.equal(
      naive.success,
      false,
      "Sanity check: the unsanitized payload should violate the schema",
    );
    if (!naive.success) {
      const issues = naive.error.issues.map((i: z.ZodIssue) => i.path.join("."));
      assert.ok(
        issues.some((p: string) => p.startsWith("notes")),
        "Unsanitized failure must be on notes",
      );
    }

    const sanitized = coerceClauseImportSegmentInput(raw);
    const ok = clauseImportSegment.outputSchema.safeParse(sanitized);
    assert.equal(ok.success, true, ok.success ? "" : ok.error.message);
    if (ok.success) {
      assert.equal(ok.data.notes.length, 2);
      assert.equal(ok.data.notes[1]!.length, 240);
      assert.ok(ok.data.segments.length >= 1);
    }
  });
});

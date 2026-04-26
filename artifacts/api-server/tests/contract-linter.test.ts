import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runContractLint, type ContractLintInput } from "../src/lib/contractLinter/index.js";

function baseInput(overrides: Partial<ContractLintInput> = {}): ContractLintInput {
  return {
    contract: { id: "c1", title: "Test", body: null },
    clauses: [
      { id: "cl1", ordinal: 1, family: "Vertraulichkeit", familyId: "fam_nda", body: "Kündigungsfrist: 30 Tage.", summary: "" },
      { id: "cl2", ordinal: 2, family: "Haftung", familyId: "fam_liab", body: "Siehe § 1 für Vertraulichkeit.", summary: "" },
    ],
    contractType: {
      id: "ct1",
      code: "NDA",
      mandatoryClauseFamilyIds: ["fam_nda"],
      forbiddenClauseFamilyIds: [],
    },
    attachmentCount: 0,
    familyNameById: new Map([["fam_nda", "NDA"], ["fam_liab", "Haftung"], ["fam_dpa", "Datenschutz"]]),
    ...overrides,
  };
}

describe("runContractLint — mandatory clauses", () => {
  it("flags missing mandatory family as error with fix payload", () => {
    const r = runContractLint(baseInput({
      clauses: [{ id: "cl1", ordinal: 1, family: "Haftung", familyId: "fam_liab", body: "x", summary: "" }],
      contractType: { id: "ct1", code: "NDA", mandatoryClauseFamilyIds: ["fam_nda", "fam_dpa"], forbiddenClauseFamilyIds: [] },
    }));
    const f = r.findings.filter(x => x.category === "mandatory_clauses");
    assert.equal(f.length, 2);
    assert.ok(f.every(x => x.severity === "error"));
    assert.ok(f.some(x => x.fix?.kind === "add_mandatory_family"));
    assert.equal(r.counts.error, 2);
  });

  it("does not flag mandatory family when present", () => {
    const r = runContractLint(baseInput());
    const f = r.findings.filter(x => x.category === "mandatory_clauses");
    assert.equal(f.length, 0);
  });
});

describe("runContractLint — forbidden clauses", () => {
  it("flags forbidden family present as error with clauseId", () => {
    const r = runContractLint(baseInput({
      contractType: { id: "ct1", code: "NDA", mandatoryClauseFamilyIds: [], forbiddenClauseFamilyIds: ["fam_liab"] },
    }));
    const f = r.findings.filter(x => x.category === "forbidden_clauses");
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, "error");
    assert.equal(f[0].contractClauseId, "cl2");
  });
});

describe("runContractLint — cross references", () => {
  it("flags § reference to non-existent clause as warn", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Siehe § 99.", summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.category === "cross_reference");
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, "warn");
    assert.match(f[0].message, /§ 99/);
  });

  it("does not flag § reference to existing clause", () => {
    const r = runContractLint(baseInput());
    const f = r.findings.filter(x => x.category === "cross_reference");
    assert.equal(f.length, 0);
  });

  it("handles Ziffer/Section references", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Siehe Ziffer 5.2.", summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.category === "cross_reference");
    assert.equal(f.length, 1);
  });
});

describe("runContractLint — attachments", () => {
  it("flags Anlage reference exceeding attachment count as warn", () => {
    const r = runContractLint(baseInput({
      clauses: [{ id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Siehe Anlage 3.", summary: "" }],
      attachmentCount: 1,
    }));
    const f = r.findings.filter(x => x.category === "attachments");
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, "warn");
  });

  it("flags lettered Anlage when no attachments", () => {
    const r = runContractLint(baseInput({
      clauses: [{ id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Siehe Annex B.", summary: "" }],
      attachmentCount: 0,
    }));
    const f = r.findings.filter(x => x.category === "attachments");
    assert.equal(f.length, 1);
  });

  it("does not flag Anlage reference within attachment count", () => {
    const r = runContractLint(baseInput({
      clauses: [{ id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Siehe Anlage 1.", summary: "" }],
      attachmentCount: 2,
    }));
    const f = r.findings.filter(x => x.category === "attachments");
    assert.equal(f.length, 0);
  });

  it("attachmentCount=null suppresses missing-attachment warnings (no inventory available)", () => {
    // Wenn keine Anlagen-Inventarisierung vorliegt, dürfen wir keine
    // false-positive Warnungen zu „Anlage X existiert nicht" emittieren.
    // Stattdessen erwarten wir genau einen info-Befund mit der Liste der
    // referenzierten Anlagen (für die manuelle Sichtkontrolle).
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Siehe Anlage 3 sowie Annex B.", summary: "" },
      ],
      attachmentCount: null,
    }));
    const warns = r.findings.filter(x => x.category === "attachments" && x.severity === "warn");
    assert.equal(warns.length, 0, "no warnings when attachmentCount is null");
    const infos = r.findings.filter(x => x.category === "attachments" && x.severity === "info");
    assert.equal(infos.length, 1);
    assert.match(infos[0].message, /Anlage 3/);
    // Lettered Annex-Referenzen werden auf „Anlage <Letter>" normalisiert.
    assert.match(infos[0].message, /Anlage B/);
  });

  it("attachmentCount=null with no Anlage references emits no findings at all", () => {
    const r = runContractLint(baseInput({
      clauses: [{ id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Keine Anlagen-Referenz.", summary: "" }],
      attachmentCount: null,
    }));
    assert.equal(r.findings.filter(x => x.category === "attachments").length, 0);
  });
});

describe("runContractLint — undefined party terms", () => {
  it("flags 'Auftragnehmer' used without nearby definition marker", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Der Auftragnehmer haftet für Schäden.", summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.code === "undefined_party_term");
    assert.equal(f.length, 1);
    assert.equal(f[0].category, "definitions");
    assert.equal(f[0].severity, "warn");
    assert.match(f[0].message, /Auftragnehmer/);
  });

  it("does not flag party term when 'bedeutet' definition marker is present", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: '„Auftragnehmer" bedeutet die ABC GmbH. Der Auftragnehmer haftet.', summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.code === "undefined_party_term");
    assert.equal(f.length, 0);
  });

  it("does not flag party term when 'im Folgenden' marker is present", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: 'Die ABC GmbH (im Folgenden „Lizenznehmer"). Der Lizenznehmer ist verpflichtet.', summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.code === "undefined_party_term");
    assert.equal(f.length, 0);
  });
});

describe("runContractLint — definitions", () => {
  it("flags defined-but-unused term as info", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: 'Die "Vertraulichkeit" wird hiermit eingeführt.', summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.category === "definitions");
    assert.ok(f.length >= 1);
    assert.equal(f[0].severity, "info");
  });

  it("does not flag defined term that is reused", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: 'Die "Vertraulichkeit" gilt. Vertraulichkeit ist wichtig.', summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.category === "definitions");
    assert.equal(f.length, 0);
  });

  it("recognizes typographic German quotes „…\u201D (Word-Standard)", () => {
    // U+201E + U+201D ist die Word-Autokorrektur-Variante. Davor war der
    // Closing-Class-Regex auf ASCII " beschränkt → Definitionen wurden NICHT
    // erkannt und alle Folge-Verwendungen lösten unsinnige Findings aus.
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Die \u201EVertraulichkeit\u201D gilt. Vertraulichkeit ist wichtig.", summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.category === "definitions");
    assert.equal(f.length, 0);
  });

  it("recognizes typographic German quotes „…\u201C (Druckstil)", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Die \u201EVertraulichkeit\u201C gilt. Vertraulichkeit ist wichtig.", summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.category === "definitions");
    assert.equal(f.length, 0);
  });

  it("recognizes English typographic quotes \u201C…\u201D", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "The \u201CConfidentiality\u201D applies. Confidentiality is binding.", summary: "" },
      ],
    }));
    // Englischer Term hat keine Umlaute → der Regex matcht das normal.
    // Wir erwarten keinen "defined-but-unused"-Befund, weil der Begriff
    // wiederverwendet wird.
    const defs = r.findings.filter(x => x.category === "definitions" && x.code === "definition_unused");
    assert.equal(defs.length, 0);
  });

  it("recognizes typographic quotes in undefined_party_term suppression", () => {
    // Regression: bevor der Quote-Fix einging, wurde „Auftragnehmer\u201D
    // nicht als Definition erkannt → undefined_party_term wurde fälschlich
    // emittiert obwohl die Definition mit „bedeutet" daneben stand.
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "\u201EAuftragnehmer\u201D bedeutet die ABC GmbH. Der Auftragnehmer haftet.", summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.code === "undefined_party_term");
    assert.equal(f.length, 0);
  });
});

describe("runContractLint — numeric consistency", () => {
  it("flags conflicting deadline mentions for the same subject", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Kündigungsfrist beträgt 30 Tage.", summary: "" },
        { id: "cl2", ordinal: 2, family: "B", familyId: "fam_liab", body: "Die Kündigungsfrist beträgt 60 Tage.", summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.category === "numeric_consistency");
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, "warn");
  });

  it("does not flag non-deadline numbers", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "A", familyId: "fam_nda", body: "Preis ist 5 EUR.", summary: "" },
      ],
    }));
    const f = r.findings.filter(x => x.category === "numeric_consistency");
    assert.equal(f.length, 0);
  });
});

describe("runContractLint — counts and ordering", () => {
  it("returns errors before warns before info, stable", () => {
    const r = runContractLint(baseInput({
      clauses: [
        { id: "cl1", ordinal: 1, family: "X", familyId: "fam_x", body: 'Die "Frist" gilt. Siehe § 99.', summary: "" },
      ],
      contractType: { id: "ct1", code: "NDA", mandatoryClauseFamilyIds: ["fam_nda"], forbiddenClauseFamilyIds: [] },
    }));
    assert.ok(r.counts.error >= 1);
    const sevs = r.findings.map(f => f.severity);
    const errIdx = sevs.lastIndexOf("error");
    const warnIdx = sevs.lastIndexOf("warn");
    const infoIdx = sevs.indexOf("info");
    assert.ok(errIdx < (warnIdx === -1 ? Infinity : warnIdx));
    if (warnIdx >= 0 && infoIdx >= 0) assert.ok(warnIdx < infoIdx);
  });
});

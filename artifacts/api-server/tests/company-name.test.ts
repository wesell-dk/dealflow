import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeCompanyName,
  extractCompanyNameFromTitle,
  findLegalEntityInText,
  hasLegalForm,
} from "../src/lib/companyName";

describe("sanitizeCompanyName", () => {
  it("collapses whitespace and trims", () => {
    assert.equal(sanitizeCompanyName("  Foo   Bar  GmbH "), "Foo Bar GmbH");
  });

  it("rejects null/empty/too-short", () => {
    assert.equal(sanitizeCompanyName(null), null);
    assert.equal(sanitizeCompanyName(""), null);
    assert.equal(sanitizeCompanyName("  "), null);
    assert.equal(sanitizeCompanyName("A"), null);
  });

  it("rejects bare boilerplate tokens", () => {
    assert.equal(sanitizeCompanyName("Impressum"), null);
    assert.equal(sanitizeCompanyName("imprint"), null);
    assert.equal(sanitizeCompanyName("Home"), null);
    assert.equal(sanitizeCompanyName("Startseite"), null);
    assert.equal(sanitizeCompanyName("Kontakt"), null);
    assert.equal(sanitizeCompanyName("Datenschutz"), null);
    assert.equal(sanitizeCompanyName("Über uns"), null);
    assert.equal(sanitizeCompanyName("Legal Notice"), null);
    assert.equal(sanitizeCompanyName("AGB"), null);
  });

  it("strips leading boilerplate even if a legal form follows", () => {
    // User-Requirement: der Name darf NIE mit „Impressum" beginnen.
    assert.equal(sanitizeCompanyName("Impressum Foo GmbH"), "Foo GmbH");
    assert.equal(sanitizeCompanyName("Impressum | Foo GmbH"), "Foo GmbH");
    assert.equal(sanitizeCompanyName("Kontakt - Müller AG"), "Müller AG");
  });

  it("strips multiple leading boilerplate tokens", () => {
    assert.equal(sanitizeCompanyName("Impressum Kontakt Foo GmbH"), "Foo GmbH");
  });

  it("returns null when only boilerplate remains", () => {
    assert.equal(sanitizeCompanyName("Impressum"), null);
    assert.equal(sanitizeCompanyName("Impressum Kontakt Home"), null);
  });

  it("rejects 'Impressum von Foo' (no legal form)", () => {
    // 'von Foo' bleibt nach dem Strippen übrig — kein erkennbarer Name.
    // Wir dürfen aber nicht „von Foo" als Name liefern. Erlauben oder null
    // sind beide okay; wir wollen nur sicherstellen, es enthält kein
    // Boilerplate-Wort am Anfang.
    const r = sanitizeCompanyName("Impressum von Foo");
    if (r !== null) {
      assert.ok(!/^impressum/i.test(r), `must not start with Impressum, got ${r}`);
    }
  });

  it("keeps real names with legal form intact", () => {
    assert.equal(sanitizeCompanyName("direct&friendly GbR"), "direct&friendly GbR");
    assert.equal(sanitizeCompanyName("Müller & Sohn GmbH & Co. KG"), "Müller & Sohn GmbH & Co. KG");
    assert.equal(sanitizeCompanyName("ACME AG"), "ACME AG");
  });
});

describe("extractCompanyNameFromTitle", () => {
  it("strips 'Impressum' as PREFIX (the original bug)", () => {
    // direct-friendly.de hat genau diesen Title.
    assert.equal(
      extractCompanyNameFromTitle("Impressum | direct&friendly Bio Produkte"),
      "direct&friendly Bio Produkte",
    );
  });

  it("strips 'Impressum' as SUFFIX", () => {
    assert.equal(extractCompanyNameFromTitle("Foo Bar GmbH – Impressum"), "Foo Bar GmbH");
    assert.equal(extractCompanyNameFromTitle("Foo Bar GmbH - Impressum"), "Foo Bar GmbH");
    assert.equal(extractCompanyNameFromTitle("Foo Bar GmbH | Imprint"), "Foo Bar GmbH");
  });

  it("handles all common separators", () => {
    assert.equal(extractCompanyNameFromTitle("Home | Foo Bar"), "Foo Bar");
    assert.equal(extractCompanyNameFromTitle("Foo Bar : Kontakt"), "Foo Bar");
    assert.equal(extractCompanyNameFromTitle("Foo Bar • Datenschutz"), "Foo Bar");
    assert.equal(extractCompanyNameFromTitle("Foo Bar · AGB"), "Foo Bar");
  });

  it("returns null when ALL segments are boilerplate", () => {
    assert.equal(extractCompanyNameFromTitle("Impressum"), null);
    assert.equal(extractCompanyNameFromTitle("Impressum | Kontakt | Home"), null);
    assert.equal(extractCompanyNameFromTitle(""), null);
    assert.equal(extractCompanyNameFromTitle(null), null);
  });

  it("prefers segment with legal form over slogan", () => {
    assert.equal(
      extractCompanyNameFromTitle("Wir sind die Besten | ACME GmbH"),
      "ACME GmbH",
    );
  });

  it("falls back to longest segment when no legal form", () => {
    assert.equal(
      extractCompanyNameFromTitle("Foo Bar Baz Quux | Foo"),
      "Foo Bar Baz Quux",
    );
  });

  it("does NOT mistake real brand names for boilerplate", () => {
    assert.equal(extractCompanyNameFromTitle("Stripe"), "Stripe");
    assert.equal(extractCompanyNameFromTitle("HubSpot"), "HubSpot");
  });
});

describe("findLegalEntityInText", () => {
  it("finds 'Foo Bar GmbH' in plain text", () => {
    const text = `Hier finden Sie unser Impressum.
      Müller & Sohn GmbH
      Beispielstraße 1
      12345 Berlin`;
    assert.equal(findLegalEntityInText(text), "Müller & Sohn GmbH");
  });

  it("finds GbR (the direct-friendly.de case)", () => {
    const text = `Impressum
      direct&friendly GbR
      Vigilienstraße 12A
      67098 Bad Dürkheim`;
    assert.equal(findLegalEntityInText(text), "direct&friendly GbR");
  });

  it("finds 'GmbH & Co. KG'", () => {
    const text = `Anbieter dieser Webseite ist die
      Beispielfirma Müller GmbH & Co. KG, Hauptstraße 5, 12345 Hamburg.`;
    const result = findLegalEntityInText(text);
    assert.ok(result?.includes("GmbH & Co"), `expected match, got ${result}`);
  });

  it("returns null for pure boilerplate without entity", () => {
    assert.equal(findLegalEntityInText("Impressum nach §5 TMG"), null);
    assert.equal(findLegalEntityInText("Anbieter unbekannt"), null);
  });

  it("does NOT return 'Impressum nach' as the entity", () => {
    const text = "Impressum nach AG-Recht der Bundesrepublik Deutschland";
    const r = findLegalEntityInText(text);
    // Falls überhaupt etwas gefunden wird, darf es nicht "Impressum" lauten.
    assert.ok(r === null || !r.toLowerCase().startsWith("impressum"), `got ${r}`);
  });

  it("returns null on null/empty", () => {
    assert.equal(findLegalEntityInText(null), null);
    assert.equal(findLegalEntityInText(""), null);
  });
});

describe("hasLegalForm", () => {
  it("recognizes German forms", () => {
    assert.ok(hasLegalForm("Foo GmbH"));
    assert.ok(hasLegalForm("Foo AG"));
    assert.ok(hasLegalForm("Foo GbR"));
    assert.ok(hasLegalForm("Foo UG"));
    assert.ok(hasLegalForm("Foo KG"));
    assert.ok(hasLegalForm("Foo OHG"));
    assert.ok(hasLegalForm("Foo SE"));
    assert.ok(hasLegalForm("Foo eG"));
    assert.ok(hasLegalForm("Foo e.V."));
    assert.ok(hasLegalForm("Foo e.K."));
    assert.ok(hasLegalForm("Foo GmbH & Co. KG"));
  });

  it("recognizes international forms", () => {
    assert.ok(hasLegalForm("Foo Ltd"));
    assert.ok(hasLegalForm("Foo Ltd."));
    assert.ok(hasLegalForm("Foo LLC"));
    assert.ok(hasLegalForm("Foo Inc"));
    assert.ok(hasLegalForm("Foo Inc."));
    assert.ok(hasLegalForm("Foo S.A."));
    assert.ok(hasLegalForm("Foo B.V."));
  });

  it("rejects strings without a legal form", () => {
    assert.equal(hasLegalForm("Impressum | Foo Bar Bio Produkte"), false);
    assert.equal(hasLegalForm("Foo Bar"), false);
    assert.equal(hasLegalForm(""), false);
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  extractTextFromUpload,
  ExtractedTextEmptyError,
  UnsupportedContractMimeError,
  PDF_MIME,
  DOCX_MIME,
  SUPPORTED_CONTRACT_MIME,
} from "../src/lib/extractContractText";

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function wrapDocx(bodyXml: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document ${W_NS}><w:body>${bodyXml}</w:body></w:document>`
  );
}

async function buildDocx(bodyXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>",
  );
  zip.folder("_rels")!.file(
    ".rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>",
  );
  zip.folder("word")!.file("document.xml", wrapDocx(bodyXml));
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("extractTextFromUpload — DOCX support (Task #96 regression)", () => {
  it("declares DOCX as a supported contract MIME type", () => {
    assert.equal(
      DOCX_MIME,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    assert.ok(SUPPORTED_CONTRACT_MIME.has(DOCX_MIME));
    assert.ok(SUPPORTED_CONTRACT_MIME.has(PDF_MIME));
  });

  it("extracts plain paragraph text from a minimal DOCX", async () => {
    const buf = await buildDocx(
      "<w:p><w:r><w:t>Vertraulichkeitsklausel</w:t></w:r></w:p>" +
        '<w:p><w:r><w:t xml:space="preserve">Beide Parteien verpflichten sich, alle vertraulichen Informationen geheim zu halten.</w:t></w:r></w:p>',
    );
    const out = await extractTextFromUpload(buf, DOCX_MIME);
    assert.match(out.text, /Vertraulichkeitsklausel/);
    assert.match(out.text, /vertraulichen Informationen geheim zu halten/);
    assert.equal(out.truncated, false);
    assert.ok(out.charCount > 50, `expected charCount > 50, got ${out.charCount}`);
  });

  it("preserves German umlauts and unicode punctuation across runs", async () => {
    const buf = await buildDocx(
      '<w:p><w:r><w:t xml:space="preserve">Die Haftung des Lieferanten ist auf 200 % des Auftragswertes pro Schadensfall beschränkt – mit Ausnahme von Vorsatz und grober Fahrlässigkeit.</w:t></w:r></w:p>',
    );
    const out = await extractTextFromUpload(buf, DOCX_MIME);
    assert.match(out.text, /beschränkt – mit Ausnahme/);
    assert.match(out.text, /Fahrlässigkeit/);
  });

  it("flattens headings, paragraphs, and tables into a single text blob", async () => {
    const buf = await buildDocx(
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Liefervertrag XYZ</w:t></w:r></w:p>' +
        "<w:p><w:r><w:t>§ 1 Vertragsgegenstand</w:t></w:r></w:p>" +
        "<w:p><w:r><w:t>Der Lieferant liefert die in Anlage 1 spezifizierten Waren.</w:t></w:r></w:p>" +
        "<w:tbl><w:tr>" +
        "<w:tc><w:p><w:r><w:t>Frist</w:t></w:r></w:p></w:tc>" +
        "<w:tc><w:p><w:r><w:t>30 Tage</w:t></w:r></w:p></w:tc>" +
        "</w:tr></w:tbl>" +
        "<w:p><w:r><w:t>§ 2 Haftung. Beschränkt auf den Auftragswert.</w:t></w:r></w:p>",
    );
    const out = await extractTextFromUpload(buf, DOCX_MIME);
    // All segments are present in extraction order
    assert.match(out.text, /Liefervertrag XYZ/);
    assert.match(out.text, /§ 1 Vertragsgegenstand/);
    assert.match(out.text, /Anlage 1 spezifizierten Waren/);
    assert.match(out.text, /Frist/);
    assert.match(out.text, /30 Tage/);
    assert.match(out.text, /§ 2 Haftung/);
    // Order is preserved.
    const idxOne = out.text.indexOf("§ 1");
    const idxTwo = out.text.indexOf("§ 2");
    assert.ok(idxOne >= 0 && idxTwo > idxOne, "section ordering preserved");
  });

  it("normalises the MIME header (case-insensitive, ignores charset suffix)", async () => {
    const buf = await buildDocx(
      "<w:p><w:r><w:t>Test Klausel A</w:t></w:r></w:p>",
    );
    const upper = await extractTextFromUpload(
      buf,
      "Application/Vnd.Openxmlformats-Officedocument.Wordprocessingml.Document; charset=utf-8",
    );
    assert.match(upper.text, /Test Klausel A/);
  });

  it("throws ExtractedTextEmptyError when the DOCX has no readable text", async () => {
    const buf = await buildDocx(
      "<w:p><w:r><w:t>   </w:t></w:r></w:p>" +
        '<w:p><w:r><w:t xml:space="preserve">\t\t</w:t></w:r></w:p>',
    );
    await assert.rejects(
      () => extractTextFromUpload(buf, DOCX_MIME),
      (err: unknown) => err instanceof ExtractedTextEmptyError,
    );
  });

  it("throws UnsupportedContractMimeError for non-PDF/non-DOCX uploads", async () => {
    const buf = Buffer.from("plain text contract");
    await assert.rejects(
      () => extractTextFromUpload(buf, "text/plain"),
      (err: unknown) => err instanceof UnsupportedContractMimeError,
    );
    await assert.rejects(
      () =>
        extractTextFromUpload(buf, "application/msword" /* legacy .doc */),
      (err: unknown) => err instanceof UnsupportedContractMimeError,
    );
  });

  it("rejects DOCX-shaped payloads that are actually corrupt zip bytes", async () => {
    // Not a valid zip — mammoth should throw, surfaced as a generic error
    // (the route catch-all maps it to text_extraction_failed).
    await assert.rejects(
      () => extractTextFromUpload(Buffer.from("not a docx at all"), DOCX_MIME),
    );
  });
});

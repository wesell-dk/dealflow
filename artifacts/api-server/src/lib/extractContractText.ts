import { createRequire } from "node:module";

import mammoth from "mammoth";

const require = createRequire(import.meta.url);

export const PDF_MIME = "application/pdf";
export const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const SUPPORTED_CONTRACT_MIME: ReadonlySet<string> = new Set([
  PDF_MIME,
  DOCX_MIME,
]);

export const MAX_CONTRACT_BYTES = 20 * 1024 * 1024;

const MAX_TEXT_CHARS = 60_000;

export class UnsupportedContractMimeError extends Error {
  constructor(public readonly mime: string) {
    super(`Unsupported contract MIME type: ${mime}`);
    this.name = "UnsupportedContractMimeError";
  }
}

export class ExtractedTextEmptyError extends Error {
  constructor() {
    super("No text could be extracted (scanned PDF without text layer?)");
    this.name = "ExtractedTextEmptyError";
  }
}

export interface ExtractedText {
  text: string;
  truncated: boolean;
  charCount: number;
}

export async function extractTextFromUpload(
  buffer: Buffer,
  mime: string,
): Promise<ExtractedText> {
  const normalized = mime.toLowerCase().split(";")[0]?.trim() ?? "";

  let raw = "";
  if (normalized === PDF_MIME) {
    const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
      buf: Buffer,
    ) => Promise<{ text: string }>;
    const result = await pdfParse(buffer);
    raw = result.text ?? "";
  } else if (normalized === DOCX_MIME) {
    const result = await mammoth.extractRawText({ buffer });
    raw = result.value ?? "";
  } else {
    throw new UnsupportedContractMimeError(mime);
  }

  const cleaned = raw
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length === 0) {
    throw new ExtractedTextEmptyError();
  }

  const truncated = cleaned.length > MAX_TEXT_CHARS;
  return {
    text: truncated ? cleaned.slice(0, MAX_TEXT_CHARS) : cleaned,
    truncated,
    charCount: cleaned.length,
  };
}

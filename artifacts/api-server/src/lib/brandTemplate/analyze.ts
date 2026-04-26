/**
 * Brand-Vorlagen-Analyse-Pipeline
 *
 * Liest ein hochgeladenes Referenz-PDF aus dem Object-Storage, extrahiert den
 * Text-Layer (best effort, kann bei reinen Scans leer sein) und uebergibt
 * beides an den Anthropic-Vision-Prompt `brand.documentLayout.extract`. Das
 * Ergebnis ist ein zod-validiertes `DocumentLayoutProfile`, das im Renderer
 * Zeile-fuer-Zeile auf neu erzeugte Dokumente angewendet wird.
 *
 * Wird sowohl beim ersten Upload als auch beim "neu analysieren" aufgerufen.
 * Caller speichert das Ergebnis in `brand_document_templates`.
 */

import { createHash } from 'node:crypto';
import { ObjectStorageService } from '../objectStorage.js';
import { extractTextFromUpload, PDF_MIME, ExtractedTextEmptyError } from '../extractContractText.js';
import { runStructured, AIOrchestrationError } from '../ai/index.js';
import {
  DocumentLayoutProfileSchema,
  type DocumentLayoutProfile,
  type DocumentTemplateType,
} from '../../pdf/profile.js';
import type { Scope } from '../scope.js';

export interface AnalyzeBrandTemplateArgs {
  brandId: string;
  documentType: DocumentTemplateType;
  objectPath: string;
  scope: Scope;
  brandHint: { name: string; legalName: string | null; addressLine: string | null };
}

export interface AnalyzeBrandTemplateResult {
  profile: DocumentLayoutProfile;
  invocationId: string;
  fileHash: string;
  fileSize: number;
}

const MAX_PDF_BYTES = 25 * 1024 * 1024;

/**
 * Laedt das PDF aus dem Object-Storage und liefert Buffer + sha256-Hash.
 * Wirft, wenn das Objekt nicht existiert oder zu gross ist (Schutzgrenze
 * gegen versehentlich riesige Uploads in den AI-Provider).
 */
async function fetchPdfBuffer(objectPath: string): Promise<{ buffer: Buffer; hash: string; size: number }> {
  const svc = new ObjectStorageService();
  const file = await svc.getObjectEntityFile(objectPath);
  const [meta] = await file.getMetadata();
  const size = Number(meta.size ?? 0);
  if (size > MAX_PDF_BYTES) {
    throw new Error(`uploaded reference PDF is ${(size / 1024 / 1024).toFixed(1)} MB — limit is ${MAX_PDF_BYTES / 1024 / 1024} MB`);
  }
  const [buf] = await file.download();
  const hash = createHash('sha256').update(buf).digest('hex');
  return { buffer: buf, hash, size: buf.length };
}

/**
 * Best-effort PDF-Text-Extraction. Bei reinen Scan-PDFs liefert pdf-parse
 * keinen Text — das ist KEIN Fehler, dann verlassen wir uns auf die
 * Vision-Pipeline des Modells.
 */
async function extractPdfTextSafe(buffer: Buffer): Promise<string | null> {
  try {
    const { text } = await extractTextFromUpload(buffer, PDF_MIME);
    return text;
  } catch (e) {
    if (e instanceof ExtractedTextEmptyError) return null;
    // Andere Fehler (corrupt PDF etc.) propagieren — der Caller entscheidet,
    // ob das ein 422 fuer den Admin ist.
    throw e;
  }
}

export async function analyzeBrandTemplate(
  args: AnalyzeBrandTemplateArgs,
): Promise<AnalyzeBrandTemplateResult> {
  const { buffer, hash, size } = await fetchPdfBuffer(args.objectPath);
  const text = await extractPdfTextSafe(buffer);

  const result = await runStructured<
    {
      documentType: DocumentTemplateType;
      pdfBase64: string;
      extractedText: string | null;
      brandHint: { name: string; legalName: string | null; addressLine: string | null };
    },
    DocumentLayoutProfile
  >({
    promptKey: 'brand.documentLayout.extract',
    input: {
      documentType: args.documentType,
      pdfBase64: buffer.toString('base64'),
      extractedText: text,
      brandHint: args.brandHint,
    },
    scope: args.scope,
    entityRef: { entityType: 'brand_document_template', entityId: `${args.brandId}:${args.documentType}` },
  });

  // Defensive Doppelvalidierung: runStructured validiert bereits, aber wir
  // wollen keine Annahme an Code-Pfade weiter unten verschicken, ohne dass
  // schemaVersion === 1 garantiert ist.
  const validated = DocumentLayoutProfileSchema.parse(result.output);

  return {
    profile: validated,
    invocationId: result.invocationId,
    fileHash: hash,
    fileSize: size,
  };
}

export { AIOrchestrationError };

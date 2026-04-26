/**
 * Prompt: brand.documentLayout.extract
 *
 * Liest ein Referenz-PDF (Angebot / Auftragsbestaetigung / Rechnung / Vertrag)
 * einer Brand und liefert strukturiert das Layout-Profil zurueck, das der
 * PDF-Renderer (siehe pdf/profile.ts + invoice.tsx / quote.tsx / contract.tsx)
 * auf neu erzeugte Dokumente anwendet.
 *
 * Vision-Eingabe: das PDF wird als Anthropic-`document`-Content-Block direkt
 * an Claude geschickt — Claude analysiert visuell + textuell und antwortet
 * via tool_use mit dem Profil. Zusaetzlich uebergeben wir den extrahierten
 * Text als Anker (defensive Doppelbelegung — falls die PDF-Analyse beim
 * Provider mal toggle-bar wird).
 */

import { z } from 'zod';
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages';
import type { PromptDefinition } from '../promptRegistry.js';
import { DocumentLayoutProfileSchema } from '../../../pdf/profile.js';
import type { DocumentTemplateType } from '../../../pdf/profile.js';

export interface BrandLayoutExtractInput {
  documentType: DocumentTemplateType;
  // Datei (PDF). Wird base64-codiert als document content block uebergeben.
  pdfBase64: string;
  // Vorab extrahierter Text-Layer (oft hilfreich, falls die PDF-Vision-Pipe
  // einmal Text uebersieht). Optional — bei reinen Scans bleibt er leer.
  extractedText: string | null;
  // Brand-Hint, damit Claude bei Mehrdeutigkeit die richtige Marke waehlt
  // (z. B. "ReturnSuite" statt "Abundance" beim Footer).
  brandHint: { name: string; legalName: string | null; addressLine: string | null };
}

const TYPE_HINT: Record<DocumentTemplateType, string> = {
  quote: 'Quote — usually with "valid until" date, line items, total amount, optionally without VAT.',
  order_confirmation:
    'Order Confirmation — confirms an order, often with delivery date and terms.',
  invoice:
    'Invoice — invoice number, invoice date, service period, line items, VAT, total amount, payment due date.',
  contract:
    'Contract — longer legal document, clauses, signature field; NO line items table, but a clause block.',
};

export const brandDocumentLayoutExtract: PromptDefinition<
  BrandLayoutExtractInput,
  z.infer<typeof DocumentLayoutProfileSchema>
> = {
  key: 'brand.documentLayout.extract',
  // Sonnet — wir brauchen vision + strukturierte Klassifikation. Haiku wuerde
  // bei layoutspezifischen Details (Spaltenbreiten, Akzentfarben) zu
  // ungenau werden; Opus ist Overkill fuer einen einmaligen Onboarding-Step.
  model: 'claude-sonnet-4-6',
  system:
    'You are a layout analyst for DealFlow.One. Task: from an uploaded ' +
    'reference PDF of a brand, derive the layout profile that our PDF renderer ' +
    'will use to make NEWLY generated documents of the same kind (quote/order ' +
    'confirmation/invoice/contract) visually match the template. Respond EXCLUSIVELY ' +
    'via the `report_document_layout` tool. No explanations, no free text.\n\n' +
    'Rules:\n' +
    '- The profile language follows the template (de if German, en if English).\n' +
    '- Accent colors: take the dominant line/header color of the template. If ' +
    'the template is neutral black/gray, return #1f2937 as primary.\n' +
    '- itemsTable.columns: return the columns EXACTLY in the order and with ' +
    'the labels of the template. For contracts without a positions table, ' +
    'return a minimal one-column table ("Klausel"/"Clause").\n' +
    '- footer.addressLine/legalLine/bankLine: return the lines of the template 1:1, ' +
    'but shortened (each max ~250 characters). If a block is missing, return an ' +
    'empty string. NO hallucination — if you cannot read an IBAN with certainty, ' +
    'return bankLine = "".\n' +
    '- pageNumberFormat: take the template format (e.g. "Seite {n}/{total}", ' +
    '"Seite {n}", "{n}/{total}"). If unclear: "Seite {n}/{total}" (de) ' +
    'or "Page {n}/{total}" (en).\n' +
    '- schemaVersion: ALWAYS 1.\n' +
    '- If you are truly unsure about a value, use a business-suitable ' +
    'default — profiles are strictly validated before saving (zod), but the ' +
    'renderer falls back to built-in defaults.',
  buildUser: () =>
    'see document content block + brand context in messages override.',
  // Override: gibt einen messages-Array zurueck mit dem PDF als document
  // content block. Der Orchestrator nutzt buildMessages bevorzugt vor
  // buildUser, wenn vorhanden.
  buildMessages: (input) => buildBrandLayoutMessages(input),
  outputSchema: DocumentLayoutProfileSchema,
  toolDescription:
    'Liefert das strukturierte Layout-Profil der Vorlage: Sprache, Akzentfarben, ' +
    'Schriftgroessen, Header-Konfiguration (Logo-Position, Empfaengerblock, ' +
    'Dokument-Titel), Meta-Felder, Positions-Tabelle, Summen-Block, ' +
    'Zahlungs-Terms, Closing-Note, Footer (Adresse/Recht/Bank/Seitenformat), ' +
    'Logo-Position. schemaVersion = 1.',
  toolName: 'report_document_layout',
};

/**
 * Build the messages array including the PDF as document content block.
 * Wird vom Orchestrator ueber den optionalen `buildMessages`-Hook aufgerufen.
 */
export function buildBrandLayoutMessages(
  input: BrandLayoutExtractInput,
): MessageParam[] {
  const intro =
    `Brand: ${input.brandHint.name}` +
    (input.brandHint.legalName ? ` (${input.brandHint.legalName})` : '') +
    `\nKnown address line: ${input.brandHint.addressLine ?? '—'}` +
    `\nDocument type: ${input.documentType} — ${TYPE_HINT[input.documentType]}` +
    (input.extractedText
      ? `\n\nExtracted text layer (for assistance — TEMPLATE in PDF is the source of truth):\n` +
        '------\n' +
        input.extractedText.slice(0, 12000) +
        (input.extractedText.length > 12000 ? '\n…(truncated)' : '') +
        '\n------'
      : '');

  return [
    {
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: input.pdfBase64,
          },
        },
        { type: 'text', text: intro },
        {
          type: 'text',
          text:
            'Analysiere das beigefuegte Referenz-PDF und liefere das Layout-' +
            'Profil ueber das Tool `report_document_layout`.',
        },
      ],
    },
  ];
}

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
  quote: 'Angebot (Quote) — meist mit "Gueltig bis"-Datum, Positionen, Gesamtbetrag, optional ohne USt.',
  order_confirmation:
    'Auftragsbestaetigung (Order Confirmation) — bestaetigt einen Auftrag, oft mit Lieferdatum und Konditionen.',
  invoice:
    'Rechnung (Invoice) — Rechnungsnummer, Rechnungsdatum, Leistungszeitraum, Positionen, USt, Gesamtbetrag, Zahlungsfrist.',
  contract:
    'Vertrag (Contract) — laengeres juristisches Dokument, Klauseln, Unterschriftenfeld; KEINE Positions-Tabelle, sondern Klausel-Block.',
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
    'Du bist Layout-Analyst fuer DealFlow.One. Aufgabe: aus einem hochgeladenen ' +
    'Referenz-PDF einer Brand das Layout-Profil ableiten, mit dem unser PDF-' +
    'Renderer NEU erzeugte Dokumente derselben Sorte (Angebot/Auftragsbestaetigung/' +
    'Rechnung/Vertrag) visuell der Vorlage angleicht. Du antwortest AUSSCHLIESSLICH ' +
    'ueber das Tool `report_document_layout`. Keine Erklaerungen, kein Freitext.\n\n' +
    'Regeln:\n' +
    '- Sprache des Profils ist die der Vorlage (de wenn deutsch, en wenn englisch).\n' +
    '- Akzentfarben: nimm die dominante Linien-/Header-Farbe der Vorlage. Wenn ' +
    'die Vorlage neutral schwarz/grau ist, gib #1f2937 als primary an.\n' +
    '- itemsTable.columns: liefere die Spalten EXAKT in der Reihenfolge und mit ' +
    'den Labels der Vorlage. Bei Vertraegen ohne Positions-Tabelle gib eine ' +
    'minimale ein-Spalten-Tabelle ("Klausel"/"Clause") an.\n' +
    '- footer.addressLine/legalLine/bankLine: liefere die Zeilen der Vorlage 1:1, ' +
    'aber gekuerzt (jeweils max ~250 Zeichen). Wenn ein Block fehlt, gib einen ' +
    'leeren String. KEINE Halluzination — wenn du eine IBAN nicht sicher liest, ' +
    'gib bankLine = "" zurueck.\n' +
    '- pageNumberFormat: nimm das Format der Vorlage (z. B. "Seite {n}/{total}", ' +
    '"Seite {n}", "{n}/{total}"). Wenn nicht erkennbar: "Seite {n}/{total}" (de) ' +
    'bzw. "Page {n}/{total}" (en).\n' +
    '- schemaVersion: IMMER 1.\n' +
    '- Falls du dir bei einem Wert wirklich unsicher bist, nutze einen geschaeftlich ' +
    'tauglichen Default — die Profile werden vor dem Speichern strikt validiert ' +
    '(zod), aber der Renderer faellt auf eingebaute Defaults zurueck.',
  buildUser: () =>
    'siehe document content block + Brand-Kontext im messages-Override.',
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
    `\nBekannte Adresszeile: ${input.brandHint.addressLine ?? '—'}` +
    `\nDokumenttyp: ${input.documentType} — ${TYPE_HINT[input.documentType]}` +
    (input.extractedText
      ? `\n\nExtrahierter Text-Layer (zur Hilfe — VORLAGE im PDF ist Quelle der Wahrheit):\n` +
        '------\n' +
        input.extractedText.slice(0, 12000) +
        (input.extractedText.length > 12000 ? '\n…(gekuerzt)' : '') +
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

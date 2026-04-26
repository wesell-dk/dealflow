/**
 * Brand Document Layout Profile
 *
 * Strukturierte Beschreibung des Layouts eines Referenz-PDFs (Angebot,
 * Auftragsbestaetigung, Rechnung, Vertrag). Wird von der KI aus dem
 * hochgeladenen Referenz-PDF extrahiert (siehe `lib/brandTemplate/analyze.ts`)
 * und vom Renderer zur Anwendung auf neu erzeugte Dokumente verwendet.
 *
 * Versionierung ueber `schemaVersion` — Renderer akzeptieren ALTE Versionen
 * defensiv (fall-back auf eingebaute Defaults), erzeugen aber NEUE Profile
 * stets in der hoechsten bekannten Version.
 */

import { z } from 'zod';

export const PROFILE_SCHEMA_VERSION = 1;

export const HEX_COLOR = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be #RRGGBB hex');

export const DocumentLayoutProfileSchema = z.object({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
  // ISO-639-1 Sprachcode der Vorlage (de, en, …). Wird genutzt, um beim
  // Rendering die Labels (z. B. "Angebot" vs "Quote") in der gleichen
  // Sprache zu halten — sofern der Caller nicht explizit eine Sprache
  // ueberschreibt.
  language: z.union([z.literal('de'), z.literal('en')]),
  pageSize: z.union([z.literal('A4'), z.literal('Letter')]),
  accentColors: z.object({
    primary: HEX_COLOR,
    secondary: HEX_COLOR.nullable().optional(),
  }),
  fontHierarchy: z.object({
    docTitlePt: z.number().min(8).max(48),
    sectionHeadingPt: z.number().min(7).max(28),
    bodyPt: z.number().min(6).max(16),
    smallPt: z.number().min(5).max(12),
  }),
  header: z.object({
    // Wo erscheint das Logo? "top-left" ist bei DACH-Vorlagen Standard.
    logoPosition: z.union([
      z.literal('top-left'),
      z.literal('top-right'),
      z.literal('top-center'),
    ]),
    // Tiny line above the recipient block, e.g. "Abundance GmbH · Siegmund-Hiepe-Str. 28-32 · 35578 Wetzlar".
    senderAddressLine: z.string().nullable(),
    // Wo der Empfaengerblock sitzt (links bei DIN-A4 Standard).
    recipientBlockPosition: z.union([z.literal('left'), z.literal('right')]),
    // "Rechnung", "Angebot", "Auftragsbestaetigung", "Vertrag", …
    documentTitle: z.string().min(1).max(60),
    // Optionaler Anschreibe-Satz unter dem Titel (z. B. "vielen Dank fuer Ihren Auftrag.").
    introText: z.string().nullable(),
  }),
  // Meta-Felder im Kopf (rechts oder unter dem Titel).
  // key wird vom Renderer nicht gerendert — er dient als stabiler Slot fuer
  // den Daten-Map-Lookup ("invoiceNumber", "customerNumber", "date", …).
  metaFields: z.array(
    z.object({
      key: z.string().min(1).max(40),
      label: z.string().min(1).max(40),
    }),
  ).max(12),
  itemsTable: z.object({
    columns: z.array(
      z.object({
        key: z.string().min(1).max(40),
        label: z.string().min(1).max(40),
        align: z.union([z.literal('left'), z.literal('right'), z.literal('center')]),
        widthPct: z.number().min(3).max(80),
      }),
    ).min(1).max(8),
    showSubtotal: z.boolean(),
    // ReturnSuite-Vorlage zeigt "Uebertrag" am Seitenwechsel.
    showCarryOver: z.boolean(),
  }),
  totals: z.object({
    subtotalLabel: z.string().min(1).max(40),
    // null wenn keine USt ausgewiesen wird (z. B. innergemeinschaftliche Lieferung).
    taxLabel: z.string().min(1).max(60).nullable(),
    grandTotalLabel: z.string().min(1).max(40),
  }),
  paymentTerms: z.string().max(280).nullable(),
  closingNote: z.string().max(280).nullable(),
  footer: z.object({
    addressLine: z.string().max(280),
    legalLine: z.string().max(280),
    bankLine: z.string().max(280),
    // Format-String mit Platzhaltern {n} und {total}, z. B. "Seite {n}/{total}".
    pageNumberFormat: z.string().max(40),
  }),
  logo: z.object({
    position: z.union([
      z.literal('top-left'),
      z.literal('top-right'),
      z.literal('top-center'),
    ]),
    relativeWidthPct: z.number().min(5).max(60),
  }).nullable(),
});

export type DocumentLayoutProfile = z.infer<typeof DocumentLayoutProfileSchema>;

export type DocumentTemplateType =
  | 'quote'
  | 'order_confirmation'
  | 'invoice'
  | 'contract';

export const DOCUMENT_TEMPLATE_TYPES: readonly DocumentTemplateType[] = [
  'quote',
  'order_confirmation',
  'invoice',
  'contract',
] as const;

export function isDocumentTemplateType(v: string): v is DocumentTemplateType {
  return (DOCUMENT_TEMPLATE_TYPES as readonly string[]).includes(v);
}

/**
 * Defensive Coercion: nimmt einen unbekannten Wert (z. B. aus jsonb in der
 * DB) und liefert ein gueltiges Profil, oder null wenn es nicht parsbar ist.
 * Renderer rufen das auf — sie kollabieren NIE wegen eines kaputten Profils,
 * sondern fallen auf ihre eingebauten Defaults zurueck.
 */
export function safeParseProfile(raw: unknown): DocumentLayoutProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = DocumentLayoutProfileSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Default-Labels (in der Sprache des Profils) — wird ge-spread, sodass die
 * vom Profil gelieferten Werte gewinnen.
 */
export const PROFILE_DEFAULTS = {
  de: {
    quote: {
      documentTitle: 'Angebot',
      grandTotalLabel: 'Gesamtbetrag',
      subtotalLabel: 'Zwischensumme',
      taxLabel: 'Umsatzsteuer 19 %',
    },
    order_confirmation: {
      documentTitle: 'Auftragsbestaetigung',
      grandTotalLabel: 'Gesamtbetrag',
      subtotalLabel: 'Zwischensumme',
      taxLabel: 'Umsatzsteuer 19 %',
    },
    invoice: {
      documentTitle: 'Rechnung',
      grandTotalLabel: 'Rechnungsbetrag',
      subtotalLabel: 'Zwischensumme',
      taxLabel: 'Umsatzsteuer 19 %',
    },
    contract: {
      documentTitle: 'Vertrag',
      grandTotalLabel: 'Vertragswert',
      subtotalLabel: 'Zwischensumme',
      taxLabel: null,
    },
  },
  en: {
    quote: {
      documentTitle: 'Quote',
      grandTotalLabel: 'Grand total',
      subtotalLabel: 'Subtotal',
      taxLabel: 'VAT 19 %',
    },
    order_confirmation: {
      documentTitle: 'Order confirmation',
      grandTotalLabel: 'Grand total',
      subtotalLabel: 'Subtotal',
      taxLabel: 'VAT 19 %',
    },
    invoice: {
      documentTitle: 'Invoice',
      grandTotalLabel: 'Invoice total',
      subtotalLabel: 'Subtotal',
      taxLabel: 'VAT 19 %',
    },
    contract: {
      documentTitle: 'Contract',
      grandTotalLabel: 'Contract value',
      subtotalLabel: 'Subtotal',
      taxLabel: null,
    },
  },
} as const;

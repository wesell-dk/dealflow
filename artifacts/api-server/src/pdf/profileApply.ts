/**
 * profileApply.ts — kleine Helfer, die ein gespeichertes
 * `DocumentLayoutProfile` defensiv an die bestehenden React-PDF-Renderer
 * (quote / contract / invoice) anlegen.
 *
 * Renderer rufen `profileLabels(...)`/`applyProfileHeader(...)` mit
 * Fallbacks auf — wenn das Profil null ist (Brand hat keine Vorlage
 * hochgeladen), bleiben die alten Renderer-Defaults aktiv. So koennen wir
 * den Profil-Pfad inkrementell ausrollen, ohne bestehende PDFs visuell
 * zu brechen.
 */

import {
  PROFILE_DEFAULTS,
  type DocumentLayoutProfile,
  type DocumentTemplateType,
} from './profile.js';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function safeHex(v: string | null | undefined, fallback: string): string {
  if (typeof v === 'string' && HEX_RE.test(v)) return v;
  return fallback;
}

export interface ProfileApplied {
  primary: string;
  secondary: string;
  documentTitle: string;
  subtotalLabel: string;
  /** null bedeutet: keine USt-Zeile rendern. */
  taxLabel: string | null;
  grandTotalLabel: string;
  pageNumberFormat: string;
}

export interface ProfileLabelsFallbacks {
  primaryFallback: string;
  secondaryFallback: string;
  docTitleFallback: string;
  subtotalLabelFallback: string;
  /** Wenn das Profil keinen taxLabel liefert UND Fallback null ist, wird keine USt-Zeile gerendert. */
  taxLabelFallback: string | null;
  grandTotalLabelFallback: string;
  pageNumberFmtFallback: string;
}

/**
 * Liefert die effektiven Strings/Farben fuer den Renderer. Profil-Werte
 * gewinnen — fehlt etwas, wird der Fallback der Sprach-Defaults und am
 * Ende die Hardcode-Defaults der Renderer genutzt.
 */
export function profileLabels(
  profile: DocumentLayoutProfile | null | undefined,
  documentType: DocumentTemplateType,
  language: 'de' | 'en',
  fallbacks: ProfileLabelsFallbacks,
): ProfileApplied {
  const langDefaults = PROFILE_DEFAULTS[language][documentType];
  const primary = safeHex(profile?.accentColors.primary, fallbacks.primaryFallback);
  const secondary = safeHex(profile?.accentColors.secondary ?? null, fallbacks.secondaryFallback);

  const documentTitle =
    profile?.header.documentTitle?.trim() || langDefaults.documentTitle || fallbacks.docTitleFallback;
  const subtotalLabel =
    profile?.totals.subtotalLabel?.trim() || langDefaults.subtotalLabel || fallbacks.subtotalLabelFallback;
  const grandTotalLabel =
    profile?.totals.grandTotalLabel?.trim() ||
    langDefaults.grandTotalLabel ||
    fallbacks.grandTotalLabelFallback;
  const pageNumberFormat =
    profile?.footer.pageNumberFormat?.trim() || fallbacks.pageNumberFmtFallback;

  // taxLabel ist nullable im Profil und im Default. Reihenfolge:
  //   1. explicit Profil-Wert (auch null bedeutet "keine USt-Zeile")
  //   2. Sprach-Default (z. B. "Vertragswert" hat null)
  //   3. Renderer-Fallback
  let taxLabel: string | null;
  if (profile && Object.prototype.hasOwnProperty.call(profile.totals, 'taxLabel')) {
    taxLabel = profile.totals.taxLabel ?? null;
  } else {
    taxLabel = langDefaults.taxLabel ?? fallbacks.taxLabelFallback;
  }

  return {
    primary,
    secondary,
    documentTitle,
    subtotalLabel,
    taxLabel,
    grandTotalLabel,
    pageNumberFormat,
  };
}

export interface AppliedHeader {
  logoPosition: 'top-left' | 'top-right' | 'top-center';
  recipientBlockPosition: 'left' | 'right';
  introText: string | null;
}

export function applyProfileHeader(
  profile: DocumentLayoutProfile | null | undefined,
  fallbacks: { logoFallback: 'top-left' | 'top-right' | 'top-center' },
): AppliedHeader {
  return {
    logoPosition: profile?.header.logoPosition ?? fallbacks.logoFallback,
    recipientBlockPosition: profile?.header.recipientBlockPosition ?? 'left',
    introText: profile?.header.introText ?? null,
  };
}

export interface AppliedFooter {
  addressLine: string;
  legalLine: string;
  bankLine: string;
}

export function applyProfileFooter(
  profile: DocumentLayoutProfile | null | undefined,
  fallbacks: { addressFallback: string; legalFallback: string; bankFallback: string },
): AppliedFooter {
  return {
    addressLine: profile?.footer.addressLine?.trim() || fallbacks.addressFallback || '',
    legalLine: profile?.footer.legalLine?.trim() || fallbacks.legalFallback || '',
    bankLine: profile?.footer.bankLine?.trim() || fallbacks.bankFallback || '',
  };
}

/**
 * Page-number Format-String mit Platzhaltern {n} und {total}. Wir
 * unterstuetzen die zwei Anker robust — alles andere bleibt unveraendert.
 */
export function formatPageNumber(format: string, n: number, total: number): string {
  return format.replace(/\{n\}/g, String(n)).replace(/\{total\}/g, String(total));
}

/**
 * Spaltenstruktur fuer den Positionsblock. Wenn das Profil eine
 * itemsTable.columns-Liste enthaelt, uebernehmen wir Reihenfolge,
 * Beschriftung, Ausrichtung und Breitenverhaeltnis 1:1; andernfalls
 * liefern wir einen sprachneutralen Fallback. Renderer rendern dann
 * generisch ueber die Liste — dadurch werden 4-spaltige Vorlagen
 * (Bez/Menge/Preis/Sum) genauso gerendert wie 6-spaltige
 * (Pos/Bez/Menge/Einzelpreis/Rabatt/Sum).
 */
export interface AppliedColumn {
  key: string;
  /** Normalisierter Schluessel (siehe COLUMN_KEY_ALIASES). Renderer waehlt
   *  darueber den Wert-Resolver. */
  semantic: ColumnSemantic;
  label: string;
  align: 'left' | 'right' | 'center';
  widthPct: number;
}

export type ColumnSemantic =
  | 'index'
  | 'name'
  | 'description'
  | 'qty'
  | 'unit'
  | 'unitPrice'
  | 'listPrice'
  | 'discount'
  | 'tax'
  | 'total'
  | 'unknown';

const COLUMN_KEY_ALIASES: Record<string, ColumnSemantic> = {
  pos: 'index', position: 'index', nr: 'index', '#': 'index', no: 'index',
  name: 'name', item: 'name', bezeichnung: 'name', leistung: 'name', produkt: 'name',
  description: 'description', beschreibung: 'description',
  qty: 'qty', quantity: 'qty', menge: 'qty', anzahl: 'qty', stk: 'qty', stueck: 'qty',
  unit: 'unit', einheit: 'unit',
  unitprice: 'unitPrice', einzelpreis: 'unitPrice', preis: 'unitPrice', price: 'unitPrice',
  listprice: 'listPrice', listenpreis: 'listPrice',
  discount: 'discount', rabatt: 'discount', discountpct: 'discount',
  tax: 'tax', vat: 'tax', ust: 'tax', mwst: 'tax', steuer: 'tax',
  sum: 'total', total: 'total', summe: 'total', gesamt: 'total', betrag: 'total', netto: 'total',
};

function normalizeKey(raw: string): ColumnSemantic {
  const k = raw.toLowerCase().trim().replace(/[^a-z#]/g, '');
  return COLUMN_KEY_ALIASES[k] ?? 'unknown';
}

/**
 * Liefert die effektive Spalten-Konfiguration. Falls das Profil leer ist,
 * wird `fallback` 1:1 zurueckgegeben. Widthpcts werden auf Summe 100 normiert,
 * damit die Layout-Engine immer eine konsistente Tabelle bekommt.
 */
export function applyProfileColumns(
  profile: DocumentLayoutProfile | null | undefined,
  fallback: ReadonlyArray<{ key: string; label: string; align: 'left' | 'right' | 'center'; widthPct: number }>,
): AppliedColumn[] {
  const source = profile?.itemsTable?.columns?.length
    ? profile.itemsTable.columns.map(c => ({
        key: c.key, label: c.label, align: c.align, widthPct: c.widthPct,
      }))
    : fallback.map(c => ({ ...c }));
  const total = source.reduce((s, c) => s + (c.widthPct > 0 ? c.widthPct : 0), 0) || 1;
  return source.map(c => ({
    key: c.key,
    semantic: normalizeKey(c.key) === 'unknown' ? normalizeKey(c.label) : normalizeKey(c.key),
    label: c.label,
    align: c.align,
    widthPct: Math.max(3, Math.round((c.widthPct / total) * 1000) / 10),
  }));
}

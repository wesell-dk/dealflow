import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
  renderToStream,
} from '@react-pdf/renderer';
import {
  applyProfileColumns,
  applyProfileFooter,
  formatPageNumber,
  profileLabels,
  type AppliedColumn,
} from './profileApply.js';
import type { DocumentLayoutProfile, DocumentTemplateType } from './profile.js';

export interface QuotePdfBrand {
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  legalEntityName?: string | null;
  addressLine?: string | null;
  tone?: string | null;
}

export interface QuotePdfLine {
  kind?: 'item' | 'heading';
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  listPrice: number;
  discountPct: number;
  total: number;
  // Effektiver USt-Satz dieser Position in Prozent (Server hat Brand/Tenant
  // Default bereits aufgelöst). Pflicht im PDF, da die Tax-Spalte gerendert
  // wird.
  taxRatePct: number;
}

export interface QuotePdfTaxBreakdownEntry {
  ratePct: number;
  net: number;
  tax: number;
}

export interface QuotePdfTaxSummary {
  net: number;
  tax: number;
  gross: number;
  breakdown: QuotePdfTaxBreakdownEntry[];
}

export interface QuotePdfSection {
  kind: string;
  title: string;
  body: string;
  order: number;
}

export interface QuotePdfAttachment {
  name: string;
  label?: string | null;
  mimeType: string;
  size: number;
}

export interface QuotePdfData {
  number: string;
  currency: string;
  status: string;
  validUntil: string;
  dealName: string;
  version: number;
  totalAmount: number;
  discountPct: number;
  marginPct: number;
  notes: string | null;
  lines: QuotePdfLine[];
  // Vom Server berechnete Aggregate (Netto / USt pro Satz / Brutto). Optional,
  // damit ältere Aufrufer ohne Tax-Kontext nicht brechen — fehlt es, wird
  // aus `lines` ein Fallback-Summary berechnet (ohne USt-Zeilen).
  taxSummary?: QuotePdfTaxSummary;
  brand: QuotePdfBrand | null;
  sections?: QuotePdfSection[];
  attachments?: QuotePdfAttachment[];
  language?: 'de' | 'en';
  /** Optional: AI-extrahiertes Layout-Profil aus brand_document_templates. */
  profile?: DocumentLayoutProfile | null;
  /**
   * Welcher Dokumenttyp gerendert wird. Standard ist `quote`. Wird auf
   * `order_confirmation` gesetzt, damit Sprach-Defaults (Titel, Totals)
   * korrekt aufgeloest werden, wenn der Quote-Renderer fuer
   * Auftragsbestaetigungen wiederverwendet wird.
   */
  documentType?: Extract<DocumentTemplateType, 'quote' | 'order_confirmation'>;
}

const QUOTE_LABELS = {
  de: {
    docTitle: 'Angebot',
    coverEyebrow: 'Kommerzielles Angebot',
    coverFor: 'Für:',
    version: 'Version',
    validUntil: 'Gültig bis',
    grandTotal: 'Gesamtsumme',
    toc: 'Inhaltsverzeichnis',
    page: 'Seite',
    quoteAndPositions: 'Angebot & Positionen',
    introDefault: 'Einleitung',
    scopeDefault: 'Leistungsumfang',
    termsDefault: 'Konditionen',
    appendixDefault: 'Anhang',
    attachments: 'Anlagen',
    quoteNumber: 'Angebotsnummer',
    deal: 'Deal',
    status: 'Status',
    margin: 'Marge',
    positions: 'Positionen',
    name: 'Bezeichnung',
    qty: 'Menge',
    listPrice: 'Listenpreis',
    discount: 'Rabatt',
    sum: 'Summe',
    subtotal: 'Zwischensumme',
    total: 'Gesamt',
    notes: 'Hinweise',
    tax: 'USt.',
    net: 'Netto',
    vatAt: (rate: string) => `USt. ${rate} %`,
    vatExempt: 'USt.-frei',
    gross: 'Brutto',
  },
  en: {
    docTitle: 'Quote',
    coverEyebrow: 'Commercial Quote',
    coverFor: 'For:',
    version: 'Version',
    validUntil: 'Valid until',
    grandTotal: 'Grand total',
    toc: 'Table of contents',
    page: 'Page',
    quoteAndPositions: 'Quote & line items',
    introDefault: 'Introduction',
    scopeDefault: 'Scope of work',
    termsDefault: 'Terms',
    appendixDefault: 'Appendix',
    attachments: 'Attachments',
    quoteNumber: 'Quote number',
    deal: 'Deal',
    status: 'Status',
    margin: 'Margin',
    positions: 'Line items',
    name: 'Item',
    qty: 'Qty',
    listPrice: 'List price',
    discount: 'Discount',
    sum: 'Total',
    subtotal: 'Subtotal',
    total: 'Total',
    notes: 'Notes',
    tax: 'VAT',
    net: 'Net',
    vatAt: (rate: string) => `VAT ${rate}%`,
    vatExempt: 'VAT exempt',
    gross: 'Gross',
  },
} as const;

const fmt = (n: number, cur: string, locale: 'de' | 'en' = 'de') =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: cur }).format(n);

// USt-Sätze sollen als ganze oder halbe Prozentwerte ohne Müll-Nachkommastellen
// erscheinen (19, 7, 0 oder 5,5). Bei mehr als 2 Nachkommastellen dezent runden.
const formatTaxRate = (n: number): string => {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
};

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

function renderQuoteCell(
  semantic: AppliedColumn['semantic'],
  l: QuotePdfLine,
  index: number,
  currency: string,
  lang: 'de' | 'en',
): string {
  switch (semantic) {
    case 'index': return String(index + 1);
    case 'description': return l.description ?? '';
    case 'qty': return String(l.quantity);
    case 'unit': return '';
    case 'unitPrice': return fmt(l.unitPrice, currency, lang);
    case 'listPrice': return fmt(l.listPrice, currency, lang);
    case 'discount': return `${l.discountPct.toFixed(1)}%`;
    case 'tax': return `${formatTaxRate(l.taxRatePct)} %`;
    case 'total': return fmt(l.total, currency, lang);
    case 'name': return l.name; // fallback path; primary 'name' branch handles description block
    default: return '';
  }
}

export function QuoteDocument({ data }: { data: QuotePdfData }) {
  const profileLang: 'de' | 'en' | undefined =
    data.profile?.language === 'de' || data.profile?.language === 'en' ? data.profile.language : undefined;
  const lang: 'de' | 'en' =
    data.language === 'en' ? 'en' : data.language === 'de' ? 'de' : (profileLang ?? 'de');
  const L = QUOTE_LABELS[lang];
  const docType = data.documentType ?? 'quote';
  // Sprach-Default-Titel fuer Auftragsbestaetigung (Quote-Renderer wird
  // wiederverwendet — QUOTE_LABELS kennt nur Angebot/Quote).
  const docTitleFallback =
    docType === 'order_confirmation'
      ? (lang === 'en' ? 'Order Confirmation' : 'Auftragsbestaetigung')
      : L.docTitle;
  const applied = profileLabels(data.profile, docType, lang, {
    primaryFallback: data.brand?.primaryColor || '#0b5fff',
    secondaryFallback: data.brand?.secondaryColor || '#1f2937',
    docTitleFallback,
    subtotalLabelFallback: L.subtotal,
    taxLabelFallback: null,
    grandTotalLabelFallback: L.grandTotal,
    pageNumberFmtFallback: lang === 'en' ? 'Page {n}/{total}' : 'Seite {n}/{total}',
  });
  // Tabellen-Spalten 1:1 aus dem Profil uebernehmen, oder den klassischen
  // 6-spaltigen Quote-Layout-Fallback nutzen, wenn keine Vorlage existiert.
  // Die Steuer-Spalte ist Teil des Standard-Layouts, weil DACH-Angebote die
  // USt typischerweise pro Position ausweisen.
  const columns = applyProfileColumns(data.profile, [
    { key: 'name', label: L.name, align: 'left', widthPct: 32 },
    { key: 'qty', label: L.qty, align: 'right', widthPct: 8 },
    { key: 'listPrice', label: L.listPrice, align: 'right', widthPct: 17 },
    { key: 'discount', label: L.discount, align: 'right', widthPct: 12 },
    { key: 'tax', label: L.tax, align: 'right', widthPct: 11 },
    { key: 'total', label: L.sum, align: 'right', widthPct: 20 },
  ]);
  const footerCfg = applyProfileFooter(data.profile, {
    addressFallback: data.brand?.addressLine ?? '',
    legalFallback: data.brand?.legalEntityName ?? 'DealFlow One',
    bankFallback: '',
  });
  const primary = applied.primary;
  const secondary = applied.secondary;

  const styles = StyleSheet.create({
    page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#111827' },
    coverPage: { padding: 36, fontFamily: 'Helvetica', color: '#111827' },
    coverTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      borderBottomColor: primary,
      borderBottomWidth: 4,
      paddingBottom: 12,
    },
    coverLogo: { width: 160, height: 48, objectFit: 'contain' },
    coverHeroBlock: {
      marginTop: 80,
      paddingVertical: 32,
      paddingHorizontal: 28,
      backgroundColor: primary,
      color: '#ffffff',
    },
    coverEyebrow: { fontSize: 11, opacity: 0.85, marginBottom: 6 },
    coverTitle: { fontSize: 30, fontWeight: 'bold', marginBottom: 14 },
    coverFor: { fontSize: 13 },
    coverBlocks: {
      flexDirection: 'row',
      marginTop: 36,
      gap: 12,
    },
    coverBlock: {
      flex: 1,
      backgroundColor: '#f3f4f6',
      padding: 14,
    },
    coverBlockLabel: { color: '#6b7280', fontSize: 9, marginBottom: 2 },
    coverBlockValue: { fontSize: 13, fontWeight: 'bold' },
    coverFooter: {
      position: 'absolute',
      bottom: 36,
      left: 36,
      right: 36,
      borderTopColor: primary,
      borderTopWidth: 1,
      paddingTop: 8,
      fontSize: 9,
      color: '#6b7280',
    },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomColor: primary,
      borderBottomWidth: 3,
      paddingBottom: 10,
      marginBottom: 16,
    },
    logo: { width: 110, height: 36, objectFit: 'contain' },
    brandName: { fontSize: 14, fontWeight: 'bold', color: primary },
    h1: { fontSize: 22, fontWeight: 'bold', color: secondary, marginBottom: 4 },
    h2: { fontSize: 13, fontWeight: 'bold', color: primary, marginTop: 14, marginBottom: 6 },
    sectionBody: { fontSize: 10, color: '#374151', lineHeight: 1.5, marginBottom: 8 },
    meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    metaCol: { flexDirection: 'column' },
    metaLabel: { color: '#6b7280', fontSize: 9 },
    metaValue: { fontSize: 11, marginBottom: 4 },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: primary,
      color: '#ffffff',
      padding: 6,
      fontSize: 9,
      fontWeight: 'bold',
    },
    tr: {
      flexDirection: 'row',
      borderBottomColor: '#e5e7eb',
      borderBottomWidth: 1,
      padding: 6,
    },
    headingRow: {
      flexDirection: 'row',
      backgroundColor: '#f3f4f6',
      borderBottomColor: primary,
      borderBottomWidth: 1,
      paddingHorizontal: 6,
      paddingVertical: 5,
      marginTop: 4,
    },
    headingText: {
      fontSize: 11,
      fontWeight: 'bold',
      color: secondary,
    },
    totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
    totalsBox: { width: 220, padding: 8, backgroundColor: '#f3f4f6' },
    totalsLine: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
    grandTotal: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 4,
      paddingTop: 4,
      borderTopColor: primary,
      borderTopWidth: 2,
      fontWeight: 'bold',
      fontSize: 12,
      color: primary,
    },
    notes: { marginTop: 16, padding: 8, backgroundColor: '#f9fafb', fontSize: 9, color: '#374151' },
    attachmentRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 6,
      borderBottomColor: '#e5e7eb',
      borderBottomWidth: 1,
    },
    attachmentName: { fontSize: 10 },
    attachmentMeta: { fontSize: 9, color: '#6b7280' },
    footer: {
      position: 'absolute',
      bottom: 24,
      left: 36,
      right: 36,
      borderTopColor: primary,
      borderTopWidth: 1,
      paddingTop: 6,
      fontSize: 8,
      color: '#6b7280',
      textAlign: 'center',
    },
  });

  const subtotal = data.lines.reduce(
    (s, l) => (l.kind === 'heading' ? s : s + l.listPrice * l.quantity),
    0,
  );
  const discount = subtotal - data.totalAmount;
  // Falls der Server kein TaxSummary liefert (defensive Fallback), aus den
  // Lines selbst aggregieren — totalAmount wird als Netto interpretiert.
  const taxSummary: QuotePdfTaxSummary = data.taxSummary ?? (() => {
    const byRate = new Map<number, { net: number; tax: number }>();
    let net = 0;
    let tax = 0;
    for (const l of data.lines) {
      const t = Math.round(l.total * (l.taxRatePct / 100));
      net += l.total;
      tax += t;
      const cur = byRate.get(l.taxRatePct) ?? { net: 0, tax: 0 };
      cur.net += l.total;
      cur.tax += t;
      byRate.set(l.taxRatePct, cur);
    }
    const breakdown = [...byRate.entries()]
      .sort(([a], [b]) => a - b)
      .map(([ratePct, v]) => ({ ratePct, net: v.net, tax: v.tax }));
    return { net, tax, gross: net + tax, breakdown };
  })();
  const sections = (data.sections ?? []).slice().sort((a, b) => a.order - b.order);
  const cover = sections.find(s => s.kind === 'cover');
  const intro = sections.find(s => s.kind === 'intro');
  const scopeSection = sections.find(s => s.kind === 'scope');
  const termsSection = sections.find(s => s.kind === 'terms');
  const appendixSection = sections.find(s => s.kind === 'appendix');
  const customSections = sections.filter(s => !['cover', 'intro', 'scope', 'terms', 'appendix'].includes(s.kind));
  const attachments = data.attachments ?? [];

  // Build a TOC of section labels. Page numbers depend on actual layout
  // and are not statically computable here (sections may wrap), so we
  // omit page labels and just list the entries.
  const toc: { title: string }[] = [];
  toc.push({ title: L.quoteAndPositions });
  if (intro) toc.push({ title: intro.title || L.introDefault });
  if (scopeSection) toc.push({ title: scopeSection.title || L.scopeDefault });
  if (termsSection) toc.push({ title: termsSection.title || L.termsDefault });
  for (const s of customSections) toc.push({ title: s.title });
  if (appendixSection) toc.push({ title: appendixSection.title || L.appendixDefault });
  if (attachments.length > 0) toc.push({ title: `${L.attachments} (${attachments.length})` });

  return (
    <Document title={`${applied.documentTitle} ${data.number}`}>
      {cover ? (
        <Page size="A4" style={styles.coverPage}>
          <View style={styles.coverTop}>
            {data.brand?.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={data.brand.logoUrl} style={styles.coverLogo} />
            ) : (
              <Text style={styles.brandName}>{data.brand?.name ?? 'DealFlow One'}</Text>
            )}
            <View>
              <Text style={{ fontSize: 11, fontWeight: 'bold', color: secondary }}>
                {data.brand?.legalEntityName ?? 'DealFlow One'}
              </Text>
              <Text style={{ fontSize: 9, color: '#6b7280' }}>{data.brand?.addressLine ?? ''}</Text>
            </View>
          </View>

          <View style={styles.coverHeroBlock}>
            <Text style={styles.coverEyebrow}>{cover.title || L.coverEyebrow}</Text>
            <Text style={styles.coverTitle}>{applied.documentTitle} {data.number}</Text>
            <Text style={styles.coverFor}>{L.coverFor} {data.dealName}</Text>
          </View>

          {cover.body ? (
            <Text style={{ marginTop: 24, fontSize: 11, lineHeight: 1.5, color: '#374151' }}>
              {cover.body}
            </Text>
          ) : null}

          <View style={styles.coverBlocks}>
            <View style={styles.coverBlock}>
              <Text style={styles.coverBlockLabel}>{L.version}</Text>
              <Text style={styles.coverBlockValue}>v{data.version}</Text>
            </View>
            <View style={styles.coverBlock}>
              <Text style={styles.coverBlockLabel}>{L.validUntil}</Text>
              <Text style={styles.coverBlockValue}>{data.validUntil}</Text>
            </View>
            <View style={styles.coverBlock}>
              <Text style={styles.coverBlockLabel}>{applied.grandTotalLabel}</Text>
              <Text style={styles.coverBlockValue}>{fmt(data.totalAmount, data.currency, lang)}</Text>
            </View>
          </View>

          <Text style={styles.coverFooter} fixed>
            {footerCfg.legalLine}{footerCfg.addressLine ? ` · ${footerCfg.addressLine}` : ''}
          </Text>
        </Page>
      ) : null}

      {toc.length > 1 ? (
        <Page size="A4" style={styles.page}>
          <View style={styles.headerBar}>
            <View>
              {data.brand?.logoUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text
                <Image src={data.brand.logoUrl} style={styles.logo} />
              ) : (
                <Text style={styles.brandName}>{data.brand?.name ?? 'DealFlow One'}</Text>
              )}
            </View>
            <View>
              <Text style={styles.brandName}>{data.brand?.legalEntityName ?? 'DealFlow One'}</Text>
              <Text style={{ fontSize: 8, color: '#6b7280' }}>{data.brand?.addressLine ?? ''}</Text>
            </View>
          </View>
          <Text style={styles.h1}>{L.toc}</Text>
          <View style={{ marginTop: 12 }}>
            {toc.map((t, i) => (
              <View
                key={`toc-${i}`}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 4,
                  borderBottomColor: '#e5e7eb',
                  borderBottomWidth: 1,
                }}
              >
                <Text style={{ fontSize: 11, color: '#111827' }}>{t.title}</Text>
                <Text
                  style={{ fontSize: 10, color: '#6b7280' }}
                  render={({ pageNumber }) => `${L.page} ${pageNumber + 1}`}
                  fixed
                />
              </View>
            ))}
          </View>
          <Text style={styles.footer} fixed>
            {footerCfg.legalLine} · {applied.documentTitle} {data.number} · v{data.version}
          </Text>
        </Page>
      ) : null}

      <Page size="A4" style={styles.page}>
        <View style={styles.headerBar}>
          <View>
            {data.brand?.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={data.brand.logoUrl} style={styles.logo} />
            ) : (
              <Text style={styles.brandName}>{data.brand?.name ?? 'DealFlow One'}</Text>
            )}
          </View>
          <View>
            <Text style={styles.brandName}>{data.brand?.legalEntityName ?? 'DealFlow One'}</Text>
            <Text style={{ fontSize: 8, color: '#6b7280' }}>
              {data.brand?.addressLine ?? ''}
            </Text>
          </View>
        </View>

        <Text style={styles.h1}>{applied.documentTitle}</Text>
        <View style={styles.meta}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{L.quoteNumber}</Text>
            <Text style={styles.metaValue}>{data.number}</Text>
            <Text style={styles.metaLabel}>{L.deal}</Text>
            <Text style={styles.metaValue}>{data.dealName}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{L.version}</Text>
            <Text style={styles.metaValue}>v{data.version}</Text>
            <Text style={styles.metaLabel}>{L.validUntil}</Text>
            <Text style={styles.metaValue}>{data.validUntil}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{L.status}</Text>
            <Text style={styles.metaValue}>{data.status}</Text>
            <Text style={styles.metaLabel}>{L.margin}</Text>
            <Text style={styles.metaValue}>{data.marginPct.toFixed(1)}%</Text>
          </View>
        </View>

        {intro ? (
          <View wrap={false}>
            <Text style={styles.h2}>{intro.title || L.introDefault}</Text>
            <Text style={styles.sectionBody}>{intro.body}</Text>
          </View>
        ) : null}

        {scopeSection ? (
          <View wrap={false}>
            <Text style={styles.h2}>{scopeSection.title || L.scopeDefault}</Text>
            <Text style={styles.sectionBody}>{scopeSection.body}</Text>
          </View>
        ) : null}

        <Text style={styles.h2}>{L.positions}</Text>
        <View style={styles.tableHeader}>
          {columns.map((c, i) => (
            <Text key={`h-${i}`} style={{ width: `${c.widthPct}%`, textAlign: c.align }}>
              {c.label || L.name}
            </Text>
          ))}
        </View>
        {data.lines.map((l, lineIdx) => (
          l.kind === 'heading' ? (
            <View key={lineIdx} style={styles.headingRow} wrap={false}>
              <Text style={styles.headingText}>{l.name}</Text>
            </View>
          ) : (
            <View key={lineIdx} style={styles.tr} wrap={false}>
              {columns.map((c, colIdx) => {
                const colStyle = { width: `${c.widthPct}%`, textAlign: c.align } as const;
                if (c.semantic === 'name') {
                  return (
                    <View key={colIdx} style={colStyle}>
                      <Text>{l.name}</Text>
                      {l.description ? (
                        <Text style={{ fontSize: 8, color: '#6b7280' }}>{l.description}</Text>
                      ) : null}
                    </View>
                  );
                }
                return (
                  <Text key={colIdx} style={colStyle}>{renderQuoteCell(c.semantic, l, lineIdx, data.currency, lang)}</Text>
                );
              })}
            </View>
          )
        ))}

        <View style={styles.totalsRow}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsLine}>
              <Text>{applied.subtotalLabel}</Text>
              <Text>{fmt(subtotal, data.currency, lang)}</Text>
            </View>
            <View style={styles.totalsLine}>
              <Text>{L.discount} ({data.discountPct.toFixed(1)}%)</Text>
              <Text>-{fmt(Math.max(0, discount), data.currency, lang)}</Text>
            </View>
            <View style={styles.totalsLine}>
              <Text>{L.net}</Text>
              <Text>{fmt(taxSummary.net, data.currency, lang)}</Text>
            </View>
            {taxSummary.breakdown.map((b, i) => (
              <View key={`vat-${i}`} style={styles.totalsLine}>
                <Text>{b.ratePct === 0 ? L.vatExempt : L.vatAt(formatTaxRate(b.ratePct))}</Text>
                <Text>{fmt(b.tax, data.currency, lang)}</Text>
              </View>
            ))}
            <View style={styles.totalsLine}>
              <Text>{L.gross}</Text>
              <Text>{fmt(taxSummary.gross, data.currency, lang)}</Text>
            </View>
            <View style={styles.grandTotal}>
              <Text>{applied.grandTotalLabel}</Text>
              <Text>{fmt(taxSummary.gross, data.currency, lang)}</Text>
            </View>
          </View>
        </View>

        {termsSection ? (
          <View wrap={false}>
            <Text style={styles.h2}>{termsSection.title || L.termsDefault}</Text>
            <Text style={styles.sectionBody}>{termsSection.body}</Text>
          </View>
        ) : null}

        {customSections.map((s, i) => (
          <View key={`custom-${i}`} wrap={false}>
            <Text style={styles.h2}>{s.title}</Text>
            <Text style={styles.sectionBody}>{s.body}</Text>
          </View>
        ))}

        {appendixSection ? (
          <View wrap={false}>
            <Text style={styles.h2}>{appendixSection.title || L.appendixDefault}</Text>
            <Text style={styles.sectionBody}>{appendixSection.body}</Text>
          </View>
        ) : null}

        {attachments.length > 0 ? (
          <View wrap={false}>
            <Text style={styles.h2}>{L.attachments}</Text>
            {attachments.map((a, i) => (
              <View key={`att-${i}`} style={styles.attachmentRow}>
                <View>
                  <Text style={styles.attachmentName}>{a.name}</Text>
                  {a.label ? (
                    <Text style={styles.attachmentMeta}>{a.label}</Text>
                  ) : null}
                </View>
                <Text style={styles.attachmentMeta}>
                  {a.mimeType} · {formatBytes(a.size)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {data.notes ? (
          <View style={styles.notes} wrap={false}>
            <Text style={{ fontWeight: 'bold', marginBottom: 2 }}>{L.notes}</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {footerCfg.legalLine}{footerCfg.addressLine ? ` · ${footerCfg.addressLine}` : ''}
          {'  '}· {applied.documentTitle} {data.number} · v{data.version}
        </Text>
        <Text
          style={{ position: 'absolute', bottom: 12, right: 36, fontSize: 8, color: '#9ca3af' }}
          render={({ pageNumber, totalPages }) => formatPageNumber(applied.pageNumberFormat, pageNumber, totalPages)}
          fixed
        />
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(data: QuotePdfData): Promise<NodeJS.ReadableStream> {
  return renderToStream(<QuoteDocument data={data} />);
}

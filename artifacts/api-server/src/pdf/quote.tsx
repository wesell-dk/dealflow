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
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  listPrice: number;
  discountPct: number;
  total: number;
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
  brand: QuotePdfBrand | null;
  sections?: QuotePdfSection[];
  attachments?: QuotePdfAttachment[];
  language?: 'de' | 'en';
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
  },
} as const;

const fmt = (n: number, cur: string, locale: 'de' | 'en' = 'de') =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: cur }).format(n);

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export function QuoteDocument({ data }: { data: QuotePdfData }) {
  const primary = data.brand?.primaryColor || '#0b5fff';
  const secondary = data.brand?.secondaryColor || '#1f2937';
  const lang: 'de' | 'en' = data.language === 'en' ? 'en' : 'de';
  const L = QUOTE_LABELS[lang];

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
    colName: { width: '40%' },
    colQty: { width: '10%', textAlign: 'right' },
    colPrice: { width: '17%', textAlign: 'right' },
    colDisc: { width: '13%', textAlign: 'right' },
    colTotal: { width: '20%', textAlign: 'right' },
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

  const subtotal = data.lines.reduce((s, l) => s + l.listPrice * l.quantity, 0);
  const discount = subtotal - data.totalAmount;
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
    <Document title={`${L.docTitle} ${data.number}`}>
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
            <Text style={styles.coverTitle}>{L.docTitle} {data.number}</Text>
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
              <Text style={styles.coverBlockLabel}>{L.grandTotal}</Text>
              <Text style={styles.coverBlockValue}>{fmt(data.totalAmount, data.currency, lang)}</Text>
            </View>
          </View>

          <Text style={styles.coverFooter} fixed>
            {data.brand?.legalEntityName ?? 'DealFlow One'} · {data.brand?.addressLine ?? ''}
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
            {data.brand?.legalEntityName ?? 'DealFlow One'} · {L.docTitle} {data.number} · v{data.version}
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

        <Text style={styles.h1}>{L.docTitle}</Text>
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
          <Text style={styles.colName}>{L.name}</Text>
          <Text style={styles.colQty}>{L.qty}</Text>
          <Text style={styles.colPrice}>{L.listPrice}</Text>
          <Text style={styles.colDisc}>{L.discount}</Text>
          <Text style={styles.colTotal}>{L.sum}</Text>
        </View>
        {data.lines.map((l, i) => (
          <View key={i} style={styles.tr} wrap={false}>
            <View style={styles.colName}>
              <Text>{l.name}</Text>
              {l.description ? (
                <Text style={{ fontSize: 8, color: '#6b7280' }}>{l.description}</Text>
              ) : null}
            </View>
            <Text style={styles.colQty}>{l.quantity}</Text>
            <Text style={styles.colPrice}>{fmt(l.listPrice, data.currency, lang)}</Text>
            <Text style={styles.colDisc}>{l.discountPct.toFixed(1)}%</Text>
            <Text style={styles.colTotal}>{fmt(l.total, data.currency, lang)}</Text>
          </View>
        ))}

        <View style={styles.totalsRow}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsLine}>
              <Text>{L.subtotal}</Text>
              <Text>{fmt(subtotal, data.currency, lang)}</Text>
            </View>
            <View style={styles.totalsLine}>
              <Text>{L.discount} ({data.discountPct.toFixed(1)}%)</Text>
              <Text>-{fmt(Math.max(0, discount), data.currency, lang)}</Text>
            </View>
            <View style={styles.grandTotal}>
              <Text>{L.total}</Text>
              <Text>{fmt(data.totalAmount, data.currency, lang)}</Text>
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
          {data.brand?.legalEntityName ?? 'DealFlow One'} · {data.brand?.addressLine ?? ''}
          {'  '}· {L.docTitle} {data.number} · v{data.version}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(data: QuotePdfData): Promise<NodeJS.ReadableStream> {
  return renderToStream(<QuoteDocument data={data} />);
}

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
import { applyProfileColumns, applyProfileFooter, applyProfileHeader, formatPageNumber, profileLabels, type AppliedColumn, type ProfileApplied } from './profileApply.js';
import type { DocumentLayoutProfile } from './profile.js';

export interface InvoicePdfBrand {
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  legalEntityName?: string | null;
  addressLine?: string | null;
  tone?: string | null;
}

export interface InvoicePdfLine {
  name: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface InvoicePdfData {
  number: string;
  currency: string;
  issuedAt: string;
  dueAt: string | null;
  servicePeriod: string | null;
  customerName: string;
  customerAddress: string | null;
  notes: string | null;
  taxPct: number;
  lines: InvoicePdfLine[];
  brand: InvoicePdfBrand | null;
  language?: 'de' | 'en';
  /** Optional: AI-extrahiertes Layout-Profil aus brand_document_templates. */
  profile?: DocumentLayoutProfile | null;
}

const INVOICE_LABELS = {
  de: {
    docTitle: 'Rechnung',
    invoiceNumber: 'Rechnungsnummer',
    issuedAt: 'Rechnungsdatum',
    dueAt: 'Faellig am',
    servicePeriod: 'Leistungszeitraum',
    positions: 'Positionen',
    name: 'Bezeichnung',
    qty: 'Menge',
    unitPrice: 'Einzelpreis',
    sum: 'Summe',
    subtotal: 'Zwischensumme',
    tax: 'Umsatzsteuer 19 %',
    total: 'Rechnungsbetrag',
    notes: 'Hinweise',
    pageFmt: 'Seite {n}/{total}',
  },
  en: {
    docTitle: 'Invoice',
    invoiceNumber: 'Invoice number',
    issuedAt: 'Invoice date',
    dueAt: 'Due date',
    servicePeriod: 'Service period',
    positions: 'Line items',
    name: 'Item',
    qty: 'Qty',
    unitPrice: 'Unit price',
    sum: 'Total',
    subtotal: 'Subtotal',
    tax: 'VAT 19 %',
    total: 'Invoice total',
    notes: 'Notes',
    pageFmt: 'Page {n}/{total}',
  },
} as const;

const fmt = (n: number, cur: string, locale: 'de' | 'en' = 'de') =>
  new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'de-DE', { style: 'currency', currency: cur }).format(n);

function renderInvoiceCell(
  semantic: AppliedColumn['semantic'],
  l: InvoicePdfLine,
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
    case 'listPrice': return fmt(l.unitPrice, currency, lang);
    case 'discount': return '';
    case 'tax': return '';
    case 'total': return fmt(l.total, currency, lang);
    case 'name': return l.name;
    default: return '';
  }
}

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  const langFromProfile: 'de' | 'en' | undefined =
    data.profile?.language === 'de' || data.profile?.language === 'en' ? data.profile.language : undefined;
  const lang: 'de' | 'en' = data.language === 'en' ? 'en' : data.language === 'de' ? 'de' : (langFromProfile ?? 'de');
  const Lbase = INVOICE_LABELS[lang];
  const applied: ProfileApplied = profileLabels(data.profile, 'invoice', lang, {
    primaryFallback: data.brand?.primaryColor || '#0b5fff',
    secondaryFallback: data.brand?.secondaryColor || '#1f2937',
    docTitleFallback: Lbase.docTitle,
    subtotalLabelFallback: Lbase.subtotal,
    taxLabelFallback: Lbase.tax,
    grandTotalLabelFallback: Lbase.total,
    pageNumberFmtFallback: Lbase.pageFmt,
  });
  const primary = applied.primary;
  const secondary = applied.secondary;
  const headerCfg = applyProfileHeader(data.profile, { logoFallback: 'top-left' });
  const footerCfg = applyProfileFooter(data.profile, {
    addressFallback: data.brand?.addressLine ?? '',
    legalFallback: data.brand?.legalEntityName ?? 'DealFlow One',
    bankFallback: '',
  });
  // Spaltenstruktur fuer den Positionsblock — uebernimmt die vom Profil
  // erkannten Spalten (Reihenfolge, Beschriftung, Ausrichtung, Breite),
  // sonst klassischer 4-spaltiger Rechnungs-Fallback.
  const columns = applyProfileColumns(data.profile, [
    { key: 'name', label: Lbase.name, align: 'left', widthPct: 52 },
    { key: 'qty', label: Lbase.qty, align: 'right', widthPct: 10 },
    { key: 'unitPrice', label: Lbase.unitPrice, align: 'right', widthPct: 18 },
    { key: 'total', label: Lbase.sum, align: 'right', widthPct: 20 },
  ]);

  const styles = StyleSheet.create({
    page: { padding: 36, fontSize: 10, fontFamily: 'Helvetica', color: '#111827' },
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
    senderTinyLine: { fontSize: 7, color: '#6b7280', marginBottom: 4 },
    recipientBlock: { marginBottom: 16, paddingTop: 4 },
    recipientName: { fontSize: 11, fontWeight: 'bold' },
    recipientAddress: { fontSize: 10, color: '#374151' },
    h1: { fontSize: 22, fontWeight: 'bold', color: secondary, marginBottom: 4 },
    meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    metaCol: { flexDirection: 'column' },
    metaLabel: { color: '#6b7280', fontSize: 9 },
    metaValue: { fontSize: 11, marginBottom: 4 },
    h2: { fontSize: 13, fontWeight: 'bold', color: primary, marginTop: 14, marginBottom: 6 },
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
    totalsRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
    totalsBox: { width: 240, padding: 8, backgroundColor: '#f3f4f6' },
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
    paymentTerms: { marginTop: 12, fontSize: 9, color: '#374151' },
    closingNote: { marginTop: 8, fontSize: 9, color: '#6b7280' },
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
    },
    footerRow: { flexDirection: 'row', justifyContent: 'space-between' },
    pageNo: { fontSize: 8, color: '#6b7280', textAlign: 'right' },
  });

  const subtotal = data.lines.reduce((s, l) => s + l.total, 0);
  const taxPct = Math.max(0, Math.min(100, data.taxPct ?? 19));
  const tax = subtotal * (taxPct / 100);
  const grandTotal = subtotal + tax;
  // Sender-Adress-Tiny-Line oberhalb des Empfaengerblocks (DACH-Standard).
  const senderTiny =
    data.profile?.header.senderAddressLine ??
    [data.brand?.legalEntityName, data.brand?.addressLine].filter(Boolean).join(' · ');

  return (
    <Document title={`${applied.documentTitle} ${data.number}`}>
      <Page size={data.profile?.pageSize === 'Letter' ? 'LETTER' : 'A4'} style={styles.page}>
        <View style={styles.headerBar}>
          <View>
            {data.brand?.logoUrl && headerCfg.logoPosition !== 'top-right' ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={data.brand.logoUrl} style={styles.logo} />
            ) : (
              <Text style={styles.brandName}>{data.brand?.name ?? 'DealFlow One'}</Text>
            )}
          </View>
          <View>
            {headerCfg.logoPosition === 'top-right' && data.brand?.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={data.brand.logoUrl} style={styles.logo} />
            ) : (
              <>
                <Text style={styles.brandName}>{data.brand?.legalEntityName ?? 'DealFlow One'}</Text>
                <Text style={{ fontSize: 8, color: '#6b7280' }}>{data.brand?.addressLine ?? ''}</Text>
              </>
            )}
          </View>
        </View>

        {senderTiny ? <Text style={styles.senderTinyLine}>{senderTiny}</Text> : null}

        <View style={styles.recipientBlock}>
          <Text style={styles.recipientName}>{data.customerName}</Text>
          {data.customerAddress ? (
            <Text style={styles.recipientAddress}>{data.customerAddress}</Text>
          ) : null}
        </View>

        <Text style={styles.h1}>{applied.documentTitle}</Text>
        <View style={styles.meta}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{Lbase.invoiceNumber}</Text>
            <Text style={styles.metaValue}>{data.number}</Text>
            <Text style={styles.metaLabel}>{Lbase.issuedAt}</Text>
            <Text style={styles.metaValue}>{data.issuedAt}</Text>
          </View>
          <View style={styles.metaCol}>
            {data.servicePeriod ? (
              <>
                <Text style={styles.metaLabel}>{Lbase.servicePeriod}</Text>
                <Text style={styles.metaValue}>{data.servicePeriod}</Text>
              </>
            ) : null}
            {data.dueAt ? (
              <>
                <Text style={styles.metaLabel}>{Lbase.dueAt}</Text>
                <Text style={styles.metaValue}>{data.dueAt}</Text>
              </>
            ) : null}
          </View>
        </View>

        <Text style={styles.h2}>{Lbase.positions}</Text>
        <View style={styles.tableHeader}>
          {columns.map((c, i) => (
            <Text key={`h-${i}`} style={{ width: `${c.widthPct}%`, textAlign: c.align }}>
              {c.label || Lbase.name}
            </Text>
          ))}
        </View>
        {data.lines.map((l, lineIdx) => (
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
                <Text key={colIdx} style={colStyle}>{renderInvoiceCell(c.semantic, l, lineIdx, data.currency, lang)}</Text>
              );
            })}
          </View>
        ))}

        <View style={styles.totalsRow}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsLine}>
              <Text>{applied.subtotalLabel}</Text>
              <Text>{fmt(subtotal, data.currency, lang)}</Text>
            </View>
            {applied.taxLabel ? (
              <View style={styles.totalsLine}>
                <Text>{applied.taxLabel}</Text>
                <Text>{fmt(tax, data.currency, lang)}</Text>
              </View>
            ) : null}
            <View style={styles.grandTotal}>
              <Text>{applied.grandTotalLabel}</Text>
              <Text>{fmt(applied.taxLabel ? grandTotal : subtotal, data.currency, lang)}</Text>
            </View>
          </View>
        </View>

        {data.profile?.paymentTerms ? (
          <Text style={styles.paymentTerms}>{data.profile.paymentTerms}</Text>
        ) : null}

        {data.notes ? (
          <View style={styles.notes} wrap={false}>
            <Text style={{ fontWeight: 'bold', marginBottom: 2 }}>{Lbase.notes}</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        {data.profile?.closingNote ? (
          <Text style={styles.closingNote}>{data.profile.closingNote}</Text>
        ) : null}

        <View style={styles.footer} fixed>
          <View style={styles.footerRow}>
            <Text>{footerCfg.addressLine}</Text>
            <Text
              style={styles.pageNo}
              render={({ pageNumber, totalPages }) => formatPageNumber(applied.pageNumberFormat, pageNumber, totalPages)}
            />
          </View>
          {footerCfg.legalLine ? <Text>{footerCfg.legalLine}</Text> : null}
          {footerCfg.bankLine ? <Text>{footerCfg.bankLine}</Text> : null}
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<NodeJS.ReadableStream> {
  return renderToStream(<InvoiceDocument data={data} />);
}

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
}

const fmt = (n: number, cur: string) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(n);

export function QuoteDocument({ data }: { data: QuotePdfData }) {
  const primary = data.brand?.primaryColor || '#0b5fff';
  const secondary = data.brand?.secondaryColor || '#1f2937';

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
    h1: { fontSize: 22, fontWeight: 'bold', color: secondary, marginBottom: 4 },
    h2: { fontSize: 13, fontWeight: 'bold', color: primary, marginTop: 14, marginBottom: 6 },
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

  return (
    <Document title={`Angebot ${data.number}`}>
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

        <Text style={styles.h1}>Angebot</Text>
        <View style={styles.meta}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Angebotsnummer</Text>
            <Text style={styles.metaValue}>{data.number}</Text>
            <Text style={styles.metaLabel}>Deal</Text>
            <Text style={styles.metaValue}>{data.dealName}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Version</Text>
            <Text style={styles.metaValue}>v{data.version}</Text>
            <Text style={styles.metaLabel}>Gültig bis</Text>
            <Text style={styles.metaValue}>{data.validUntil}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={styles.metaValue}>{data.status}</Text>
            <Text style={styles.metaLabel}>Marge</Text>
            <Text style={styles.metaValue}>{data.marginPct.toFixed(1)}%</Text>
          </View>
        </View>

        <Text style={styles.h2}>Positionen</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.colName}>Bezeichnung</Text>
          <Text style={styles.colQty}>Menge</Text>
          <Text style={styles.colPrice}>Listenpreis</Text>
          <Text style={styles.colDisc}>Rabatt</Text>
          <Text style={styles.colTotal}>Summe</Text>
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
            <Text style={styles.colPrice}>{fmt(l.listPrice, data.currency)}</Text>
            <Text style={styles.colDisc}>{l.discountPct.toFixed(1)}%</Text>
            <Text style={styles.colTotal}>{fmt(l.total, data.currency)}</Text>
          </View>
        ))}

        <View style={styles.totalsRow}>
          <View style={styles.totalsBox}>
            <View style={styles.totalsLine}>
              <Text>Zwischensumme</Text>
              <Text>{fmt(subtotal, data.currency)}</Text>
            </View>
            <View style={styles.totalsLine}>
              <Text>Rabatt ({data.discountPct.toFixed(1)}%)</Text>
              <Text>-{fmt(Math.max(0, discount), data.currency)}</Text>
            </View>
            <View style={styles.grandTotal}>
              <Text>Gesamt</Text>
              <Text>{fmt(data.totalAmount, data.currency)}</Text>
            </View>
          </View>
        </View>

        {data.notes ? (
          <View style={styles.notes} wrap={false}>
            <Text style={{ fontWeight: 'bold', marginBottom: 2 }}>Hinweise</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {data.brand?.legalEntityName ?? 'DealFlow One'} · {data.brand?.addressLine ?? ''}
          {'  '}· Angebot {data.number} · v{data.version}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderQuotePdf(data: QuotePdfData): Promise<NodeJS.ReadableStream> {
  return renderToStream(<QuoteDocument data={data} />);
}

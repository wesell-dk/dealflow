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

export interface ContractPdfBrand {
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  legalEntityName?: string | null;
  addressLine?: string | null;
  tone?: string | null;
}

export interface ContractPdfClause {
  family: string;
  variant: string;
  severity: string;
  summary: string;
  body: string;
}

export interface ContractPdfData {
  number: string;
  status: string;
  dealName: string;
  signedAt: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  clauses: ContractPdfClause[];
  brand: ContractPdfBrand | null;
}

export function ContractDocument({ data }: { data: ContractPdfData }) {
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
    meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    metaCol: { flexDirection: 'column' },
    metaLabel: { color: '#6b7280', fontSize: 9 },
    metaValue: { fontSize: 11, marginBottom: 4 },
    h2: { fontSize: 13, fontWeight: 'bold', color: primary, marginTop: 14, marginBottom: 6 },
    clause: {
      marginBottom: 10,
      padding: 8,
      borderLeftColor: primary,
      borderLeftWidth: 3,
      backgroundColor: '#f9fafb',
    },
    clauseTitle: { fontSize: 11, fontWeight: 'bold', color: secondary },
    clauseMeta: { fontSize: 9, color: '#6b7280', marginBottom: 4 },
    clauseBody: { fontSize: 10, lineHeight: 1.4 },
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

  return (
    <Document title={`Vertrag ${data.number}`}>
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

        <Text style={styles.h1}>Vertrag</Text>
        <View style={styles.meta}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Vertragsnummer</Text>
            <Text style={styles.metaValue}>{data.number}</Text>
            <Text style={styles.metaLabel}>Deal</Text>
            <Text style={styles.metaValue}>{data.dealName}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={styles.metaValue}>{data.status}</Text>
            <Text style={styles.metaLabel}>Unterzeichnet am</Text>
            <Text style={styles.metaValue}>{data.signedAt ?? '—'}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>Laufzeit von</Text>
            <Text style={styles.metaValue}>{data.effectiveFrom ?? '—'}</Text>
            <Text style={styles.metaLabel}>Laufzeit bis</Text>
            <Text style={styles.metaValue}>{data.effectiveTo ?? '—'}</Text>
          </View>
        </View>

        <Text style={styles.h2}>Vertragsklauseln</Text>
        {data.clauses.map((c, i) => (
          <View key={i} style={styles.clause} wrap={false}>
            <Text style={styles.clauseTitle}>
              {i + 1}. {c.family} — {c.variant}
            </Text>
            <Text style={styles.clauseMeta}>Schweregrad: {c.severity}</Text>
            {c.summary ? (
              <Text style={{ fontSize: 9, color: '#374151', marginBottom: 3 }}>{c.summary}</Text>
            ) : null}
            <Text style={styles.clauseBody}>{c.body || '(kein Klauseltext hinterlegt)'}</Text>
          </View>
        ))}

        <Text style={styles.footer} fixed>
          {data.brand?.legalEntityName ?? 'DealFlow One'} · {data.brand?.addressLine ?? ''}
          {'  '}· Vertrag {data.number}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderContractPdf(
  data: ContractPdfData,
): Promise<NodeJS.ReadableStream> {
  return renderToStream(<ContractDocument data={data} />);
}

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
  applyProfileFooter,
  formatPageNumber,
  profileLabels,
} from './profileApply.js';
import type { DocumentLayoutProfile } from './profile.js';

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
  language?: 'de' | 'en';
  /** Optional: AI-extrahiertes Layout-Profil aus brand_document_templates. */
  profile?: DocumentLayoutProfile | null;
}

const CONTRACT_LABELS = {
  de: {
    docTitle: 'Vertrag',
    contractNumber: 'Vertragsnummer',
    deal: 'Deal',
    status: 'Status',
    signedAt: 'Unterzeichnet am',
    termFrom: 'Laufzeit von',
    termTo: 'Laufzeit bis',
    clausesHeading: 'Vertragsklauseln',
    severity: 'Schweregrad',
    emptyClause: '(kein Klauseltext hinterlegt)',
  },
  en: {
    docTitle: 'Contract',
    contractNumber: 'Contract number',
    deal: 'Deal',
    status: 'Status',
    signedAt: 'Signed on',
    termFrom: 'Term from',
    termTo: 'Term to',
    clausesHeading: 'Contract clauses',
    severity: 'Severity',
    emptyClause: '(no clause text provided)',
  },
} as const;

export function ContractDocument({ data }: { data: ContractPdfData }) {
  const profileLang: 'de' | 'en' | undefined =
    data.profile?.language === 'de' || data.profile?.language === 'en' ? data.profile.language : undefined;
  const lang: 'de' | 'en' =
    data.language === 'en' ? 'en' : data.language === 'de' ? 'de' : (profileLang ?? 'de');
  const L = CONTRACT_LABELS[lang];
  const applied = profileLabels(data.profile, 'contract', lang, {
    primaryFallback: data.brand?.primaryColor || '#0b5fff',
    secondaryFallback: data.brand?.secondaryColor || '#1f2937',
    docTitleFallback: L.docTitle,
    subtotalLabelFallback: '',
    taxLabelFallback: null,
    grandTotalLabelFallback: '',
    pageNumberFmtFallback: lang === 'en' ? 'Page {n}/{total}' : 'Seite {n}/{total}',
  });
  const footerCfg = applyProfileFooter(data.profile, {
    addressFallback: data.brand?.addressLine ?? '',
    legalFallback: data.brand?.legalEntityName ?? 'DealFlow One',
    bankFallback: '',
  });
  const primary = applied.primary;
  const secondary = applied.secondary;

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
    <Document title={`${applied.documentTitle} ${data.number}`}>
      <Page size={data.profile?.pageSize === 'Letter' ? 'LETTER' : 'A4'} style={styles.page}>
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
            <Text style={styles.metaLabel}>{L.contractNumber}</Text>
            <Text style={styles.metaValue}>{data.number}</Text>
            <Text style={styles.metaLabel}>{L.deal}</Text>
            <Text style={styles.metaValue}>{data.dealName}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{L.status}</Text>
            <Text style={styles.metaValue}>{data.status}</Text>
            <Text style={styles.metaLabel}>{L.signedAt}</Text>
            <Text style={styles.metaValue}>{data.signedAt ?? '—'}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{L.termFrom}</Text>
            <Text style={styles.metaValue}>{data.effectiveFrom ?? '—'}</Text>
            <Text style={styles.metaLabel}>{L.termTo}</Text>
            <Text style={styles.metaValue}>{data.effectiveTo ?? '—'}</Text>
          </View>
        </View>

        <Text style={styles.h2}>{L.clausesHeading}</Text>
        {data.clauses.map((c, i) => (
          <View key={i} style={styles.clause} wrap={false}>
            <Text style={styles.clauseTitle}>
              {i + 1}. {c.family} — {c.variant}
            </Text>
            <Text style={styles.clauseMeta}>{L.severity}: {c.severity}</Text>
            {c.summary ? (
              <Text style={{ fontSize: 9, color: '#374151', marginBottom: 3 }}>{c.summary}</Text>
            ) : null}
            <Text style={styles.clauseBody}>{c.body || L.emptyClause}</Text>
          </View>
        ))}

        <Text style={styles.footer} fixed>
          {footerCfg.legalLine}{footerCfg.addressLine ? ` · ${footerCfg.addressLine}` : ''}
          {'  '}· {applied.documentTitle} {data.number}
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

export async function renderContractPdf(
  data: ContractPdfData,
): Promise<NodeJS.ReadableStream> {
  return renderToStream(<ContractDocument data={data} />);
}

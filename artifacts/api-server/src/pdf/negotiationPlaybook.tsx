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

export interface NegotiationPlaybookBrand {
  name: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  legalEntityName?: string | null;
  addressLine?: string | null;
}

export interface NegotiationPlaybookClause {
  ordinal: number;
  family: string;
  currentBody: string;
  currentPosition: string;
  idealPosition: string;
  targetPosition: string;
  walkAwayPosition: string;
  economicRationale: string;
  legalRationale: string;
  counterTextDe: string;
  counterTextEn: string;
  proArguments: string[];
  contraArguments: string[];
  perClauseConfidence: 'low' | 'medium' | 'high';
  perClauseConfidenceReason: string;
  relatedSources: Array<{ kind: 'norm' | 'precedent'; ref: string; note?: string | undefined }>;
}

export interface NegotiationPlaybookData {
  contractTitle: string;
  contractNumber: string;
  dealName: string;
  generatedAt: string;
  language: 'de' | 'en';
  overallSummary: string;
  overallConfidence: 'low' | 'medium' | 'high';
  overallConfidenceReason: string;
  clauses: NegotiationPlaybookClause[];
  brand: NegotiationPlaybookBrand | null;
  profile?: DocumentLayoutProfile | null;
}

const LABELS = {
  de: {
    docTitle: 'Verhandlungs-Playbook',
    contract: 'Vertrag',
    deal: 'Deal',
    generatedAt: 'Erstellt am',
    overallSummary: 'Gesamteinschätzung',
    overallConfidence: 'AI-Konfidenz',
    clauseHeading: 'Klausel-Strategien',
    currentText: 'Aktueller Klauseltext',
    currentPosition: 'Aktuelle Position',
    idealPosition: 'Ideal-Position',
    targetPosition: 'Ziel-Position',
    walkAway: 'Walk-Away',
    economic: 'Ökonomische Begründung',
    legal: 'Juristische Begründung',
    counterDe: 'Gegenvorschlag (DE)',
    counterEn: 'Counterproposal (EN)',
    pro: 'Pro-Argumente',
    contra: 'Contra / Gegenargumente',
    confidence: 'AI-Konfidenz für diese Klausel',
    sources: 'Belege aus der Wissensbasis',
    manualReviewWarning:
      'AI-Konfidenz niedrig — bitte vor Versand juristisch prüfen.',
  },
  en: {
    docTitle: 'Negotiation Playbook',
    contract: 'Contract',
    deal: 'Deal',
    generatedAt: 'Generated on',
    overallSummary: 'Overall assessment',
    overallConfidence: 'AI confidence',
    clauseHeading: 'Clause strategies',
    currentText: 'Current clause text',
    currentPosition: 'Current position',
    idealPosition: 'Ideal position',
    targetPosition: 'Target position',
    walkAway: 'Walk-away',
    economic: 'Economic rationale',
    legal: 'Legal rationale',
    counterDe: 'Counterproposal (DE)',
    counterEn: 'Counterproposal (EN)',
    pro: 'Pro arguments',
    contra: 'Contra arguments',
    confidence: 'AI confidence for this clause',
    sources: 'Sources from the knowledge base',
    manualReviewWarning:
      'AI confidence is low — please have a lawyer review before sending.',
  },
} as const;

function confidenceColor(c: 'low' | 'medium' | 'high'): string {
  if (c === 'high') return '#059669';
  if (c === 'medium') return '#d97706';
  return '#dc2626';
}

export function NegotiationPlaybookDocument({ data }: { data: NegotiationPlaybookData }) {
  const lang: 'de' | 'en' = data.language === 'en' ? 'en' : 'de';
  const L = LABELS[lang];
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
    meta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
    metaCol: { flexDirection: 'column' },
    metaLabel: { color: '#6b7280', fontSize: 9 },
    metaValue: { fontSize: 11, marginBottom: 4 },
    h2: { fontSize: 13, fontWeight: 'bold', color: primary, marginTop: 14, marginBottom: 6 },
    overall: {
      padding: 10,
      backgroundColor: '#f3f4f6',
      borderLeftColor: primary,
      borderLeftWidth: 3,
      marginBottom: 14,
    },
    confidenceBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 3,
      color: '#ffffff',
      fontSize: 9,
      marginRight: 6,
    },
    clause: {
      marginBottom: 14,
      padding: 10,
      borderLeftColor: primary,
      borderLeftWidth: 3,
      backgroundColor: '#f9fafb',
    },
    clauseTitle: { fontSize: 12, fontWeight: 'bold', color: secondary, marginBottom: 4 },
    sectionLabel: { fontSize: 9, fontWeight: 'bold', color: primary, marginTop: 6 },
    sectionBody: { fontSize: 9.5, lineHeight: 1.4, color: '#1f2937' },
    counter: {
      marginTop: 4,
      padding: 6,
      backgroundColor: '#ffffff',
      borderColor: '#e5e7eb',
      borderWidth: 0.5,
      borderRadius: 2,
    },
    bullet: { fontSize: 9.5, color: '#1f2937', marginLeft: 8 },
    warningBox: {
      marginTop: 6,
      padding: 6,
      backgroundColor: '#fef3c7',
      borderColor: '#f59e0b',
      borderWidth: 0.5,
      borderRadius: 2,
      fontSize: 9,
      color: '#92400e',
    },
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
    <Document title={`${applied.documentTitle} ${data.contractNumber}`}>
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
            <Text style={{ fontSize: 8, color: '#6b7280' }}>{data.brand?.addressLine ?? ''}</Text>
          </View>
        </View>

        <Text style={styles.h1}>{applied.documentTitle}</Text>
        <View style={styles.meta}>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{L.contract}</Text>
            <Text style={styles.metaValue}>{data.contractTitle}</Text>
            <Text style={styles.metaLabel}>{L.deal}</Text>
            <Text style={styles.metaValue}>{data.dealName}</Text>
          </View>
          <View style={styles.metaCol}>
            <Text style={styles.metaLabel}>{L.generatedAt}</Text>
            <Text style={styles.metaValue}>{data.generatedAt}</Text>
            <Text style={styles.metaLabel}>{L.overallConfidence}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text
                style={[styles.confidenceBadge, { backgroundColor: confidenceColor(data.overallConfidence) }]}
              >
                {data.overallConfidence.toUpperCase()}
              </Text>
              <Text style={{ fontSize: 9, color: '#6b7280' }}>{data.overallConfidenceReason}</Text>
            </View>
          </View>
        </View>

        <View style={styles.overall}>
          <Text style={[styles.sectionLabel, { marginTop: 0 }]}>{L.overallSummary}</Text>
          <Text style={styles.sectionBody}>{data.overallSummary}</Text>
        </View>

        <Text style={styles.h2}>{L.clauseHeading}</Text>
        {data.clauses.map((c, i) => (
          <View key={i} style={styles.clause} wrap={false}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.clauseTitle}>
                {c.ordinal}. {c.family}
              </Text>
              <Text
                style={[styles.confidenceBadge, { backgroundColor: confidenceColor(c.perClauseConfidence) }]}
              >
                {c.perClauseConfidence.toUpperCase()}
              </Text>
            </View>

            {c.perClauseConfidence === 'low' && (
              <View style={styles.warningBox}>
                <Text>⚠ {L.manualReviewWarning}</Text>
              </View>
            )}

            <Text style={styles.sectionLabel}>{L.currentText}</Text>
            <Text style={styles.sectionBody}>{c.currentBody.slice(0, 800) || '—'}</Text>

            <Text style={styles.sectionLabel}>{L.currentPosition}</Text>
            <Text style={styles.sectionBody}>{c.currentPosition}</Text>

            <Text style={styles.sectionLabel}>{L.idealPosition}</Text>
            <Text style={styles.sectionBody}>{c.idealPosition}</Text>

            <Text style={styles.sectionLabel}>{L.targetPosition}</Text>
            <Text style={styles.sectionBody}>{c.targetPosition}</Text>

            <Text style={styles.sectionLabel}>{L.walkAway}</Text>
            <Text style={styles.sectionBody}>{c.walkAwayPosition}</Text>

            <Text style={styles.sectionLabel}>{L.economic}</Text>
            <Text style={styles.sectionBody}>{c.economicRationale}</Text>

            <Text style={styles.sectionLabel}>{L.legal}</Text>
            <Text style={styles.sectionBody}>{c.legalRationale}</Text>

            <Text style={styles.sectionLabel}>{L.counterDe}</Text>
            <View style={styles.counter}>
              <Text style={styles.sectionBody}>{c.counterTextDe}</Text>
            </View>

            <Text style={styles.sectionLabel}>{L.counterEn}</Text>
            <View style={styles.counter}>
              <Text style={styles.sectionBody}>{c.counterTextEn}</Text>
            </View>

            {c.proArguments.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>{L.pro}</Text>
                {c.proArguments.map((a, k) => (
                  <Text key={k} style={styles.bullet}>• {a}</Text>
                ))}
              </>
            )}

            {c.contraArguments.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>{L.contra}</Text>
                {c.contraArguments.map((a, k) => (
                  <Text key={k} style={styles.bullet}>• {a}</Text>
                ))}
              </>
            )}

            {c.relatedSources.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>{L.sources}</Text>
                {c.relatedSources.map((s, k) => (
                  <Text key={k} style={styles.bullet}>
                    • [{s.kind}] {s.ref}{s.note ? ` — ${s.note}` : ''}
                  </Text>
                ))}
              </>
            )}

            <Text style={[styles.sectionLabel, { color: '#6b7280' }]}>{L.confidence}</Text>
            <Text style={{ fontSize: 9, color: '#6b7280', fontStyle: 'italic' }}>
              {c.perClauseConfidenceReason}
            </Text>
          </View>
        ))}

        <Text style={styles.footer} fixed>
          {footerCfg.legalLine}{footerCfg.addressLine ? ` · ${footerCfg.addressLine}` : ''}
          {'  '}· {applied.documentTitle} · {data.contractNumber}
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

export async function renderNegotiationPlaybookPdf(
  data: NegotiationPlaybookData,
): Promise<NodeJS.ReadableStream> {
  return renderToStream(<NegotiationPlaybookDocument data={data} />);
}

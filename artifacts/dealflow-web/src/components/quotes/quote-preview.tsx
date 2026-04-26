import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useGetDeal,
  useListBrands,
  getGetDealQueryKey,
  getListBrandsQueryKey,
  type Brand,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";

export interface QuotePreviewLine {
  id?: string;
  kind: "item" | "heading";
  name: string;
  description?: string | null;
  quantity: number;
  listPrice: number;
  unitPrice?: number;
  discountPct: number;
  total?: number;
  taxRatePct?: number | null;
}

export interface QuotePreviewTaxBreakdownEntry {
  ratePct: number;
  net: number;
  tax: number;
}

export interface QuotePreviewTaxSummary {
  net: number;
  tax: number;
  gross: number;
  breakdown: QuotePreviewTaxBreakdownEntry[];
}

export interface QuotePreviewProps {
  quoteNumber: string;
  currency: string;
  validUntil: string;
  language?: "de" | "en" | string;
  dealId?: string | null;
  dealName?: string | null;
  lines: QuotePreviewLine[];
  taxSummary?: QuotePreviewTaxSummary | null;
  notes?: string | null;
  /**
   * Optional: explicit brand override (when caller already has it). Otherwise
   * resolved via the dealId → deal.brandId → useListBrands chain.
   */
  brand?: Brand | null;
  testId?: string;
  className?: string;
}

const formatTaxRate = (n: number, locale: string): string => {
  if (Number.isInteger(n)) return n.toLocaleString(locale);
  return (Math.round(n * 100) / 100).toLocaleString(locale);
};

function lineTotal(l: QuotePreviewLine): number {
  if (l.kind === "heading") return 0;
  if (typeof l.total === "number" && Number.isFinite(l.total)) return l.total;
  const eff = (l.unitPrice ?? l.listPrice * (1 - (l.discountPct || 0) / 100));
  return Math.round(eff * (l.quantity || 0) * 100) / 100;
}

function deriveTaxSummary(
  lines: QuotePreviewLine[],
  fallbackRate: number,
): QuotePreviewTaxSummary {
  const buckets = new Map<number, { net: number; tax: number }>();
  let net = 0;
  for (const l of lines) {
    if (l.kind !== "item") continue;
    const t = lineTotal(l);
    const rate = l.taxRatePct ?? fallbackRate;
    net += t;
    const b = buckets.get(rate) ?? { net: 0, tax: 0 };
    b.net += t;
    b.tax += Math.round(t * (rate / 100) * 100) / 100;
    buckets.set(rate, b);
  }
  let tax = 0;
  const breakdown: QuotePreviewTaxBreakdownEntry[] = [];
  for (const [ratePct, v] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    tax += v.tax;
    breakdown.push({ ratePct, net: v.net, tax: v.tax });
  }
  return {
    net: Math.round(net * 100) / 100,
    tax: Math.round(tax * 100) / 100,
    gross: Math.round((net + tax) * 100) / 100,
    breakdown,
  };
}

export function QuotePreview({
  quoteNumber,
  currency,
  validUntil,
  language,
  dealId,
  dealName,
  lines,
  taxSummary,
  notes,
  brand: explicitBrand,
  testId = "quote-html-preview",
  className,
}: QuotePreviewProps) {
  const { t } = useTranslation();
  const lang = language === "en" ? "en" : "de";
  const locale = lang === "en" ? "en-US" : "de-DE";

  const dealEnabled = !!dealId && !explicitBrand;
  const { data: deal } = useGetDeal(dealId ?? "", {
    query: {
      enabled: dealEnabled,
      queryKey: getGetDealQueryKey(dealId ?? ""),
    },
  });
  const brandsEnabled = !explicitBrand && !!deal?.brandId;
  const { data: brands, isLoading: brandsLoading } = useListBrands(
    {},
    {
      query: {
        enabled: brandsEnabled,
        queryKey: getListBrandsQueryKey({}),
      },
    },
  );
  const brand: Brand | null = useMemo(() => {
    if (explicitBrand) return explicitBrand;
    if (!brands || !deal?.brandId) return null;
    return brands.find((b) => b.id === deal.brandId) ?? null;
  }, [explicitBrand, brands, deal?.brandId]);

  const accountName = deal?.accountName ?? null;
  const brandName = brand?.name ?? deal?.brandName ?? "";
  const legalEntity = brand?.legalEntityName ?? brandName;
  const addressLine = brand?.addressLine ?? "";
  const logoUrl = brand?.logoUrl ?? null;
  const primaryColor = brand?.primaryColor ?? "#0F172A";
  const secondaryColor = brand?.secondaryColor ?? "#64748B";

  const summary = useMemo(() => {
    if (taxSummary) return taxSummary;
    return deriveTaxSummary(lines, 19);
  }, [taxSummary, lines]);

  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(n);

  const validUntilDisplay = useMemo(() => {
    try {
      return new Date(validUntil).toLocaleDateString(locale);
    } catch {
      return validUntil;
    }
  }, [validUntil, locale]);

  // Render groups: a "heading" line starts a new group; items below it are
  // members. Items before the first heading sit in an implicit group with no
  // title.
  type Group = { title: string | null; items: QuotePreviewLine[] };
  const groups: Group[] = useMemo(() => {
    const out: Group[] = [];
    let current: Group = { title: null, items: [] };
    for (const l of lines) {
      if (l.kind === "heading") {
        if (current.items.length || current.title !== null) out.push(current);
        current = { title: l.name || "", items: [] };
      } else {
        current.items.push(l);
      }
    }
    if (current.items.length || current.title !== null) out.push(current);
    return out;
  }, [lines]);

  const docTitle = lang === "en" ? "Quote" : "Angebot";

  return (
    <div
      className={
        "rounded-md border bg-white text-slate-900 shadow-sm overflow-hidden " +
        (className ?? "")
      }
      data-testid={testId}
    >
      {/* Brand header bar */}
      <div
        className="h-2 w-full"
        style={{ backgroundColor: primaryColor }}
        aria-hidden
      />

      <div className="px-6 sm:px-10 pt-8 pb-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="min-w-0">
            {brandsLoading && !brand ? (
              <Skeleton className="h-8 w-40" />
            ) : logoUrl ? (
              <img
                src={logoUrl}
                alt={brandName}
                className="max-h-12 w-auto object-contain"
              />
            ) : (
              <div
                className="text-xl font-semibold tracking-tight"
                style={{ color: primaryColor }}
              >
                {brandName || "—"}
              </div>
            )}
            {addressLine && (
              <div className="mt-2 text-xs text-slate-500 whitespace-pre-line">
                {addressLine}
              </div>
            )}
          </div>
          <div className="text-right">
            <div
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: secondaryColor }}
            >
              {docTitle}
            </div>
            <div className="mt-0.5 text-2xl font-bold tabular-nums">
              {quoteNumber}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {lang === "en" ? "Valid until" : "Gültig bis"}: {validUntilDisplay}
            </div>
          </div>
        </div>

        {(accountName || dealName) && (
          <div className="mt-6 rounded-md bg-slate-50 px-4 py-3">
            <div
              className="text-[10px] font-semibold uppercase tracking-wider"
              style={{ color: secondaryColor }}
            >
              {lang === "en" ? "For" : "Für"}
            </div>
            <div className="mt-0.5 text-sm font-medium text-slate-900">
              {accountName ?? dealName}
            </div>
            {accountName && dealName && (
              <div className="text-xs text-slate-500">{dealName}</div>
            )}
          </div>
        )}
      </div>

      <div className="px-6 sm:px-10 pb-8">
        {/* Line item table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr
                className="text-left text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: secondaryColor }}
              >
                <th className="py-2 pr-2 w-8 border-b border-slate-200">#</th>
                <th className="py-2 px-2 border-b border-slate-200">
                  {lang === "en" ? "Item" : "Bezeichnung"}
                </th>
                <th className="py-2 px-2 text-right border-b border-slate-200 w-16">
                  {lang === "en" ? "Qty" : "Menge"}
                </th>
                <th className="py-2 px-2 text-right border-b border-slate-200 w-28">
                  {lang === "en" ? "List price" : "Listenpreis"}
                </th>
                <th className="py-2 px-2 text-right border-b border-slate-200 w-20">
                  {lang === "en" ? "Disc." : "Rabatt"}
                </th>
                <th className="py-2 px-2 text-right border-b border-slate-200 w-16">
                  {lang === "en" ? "VAT" : "USt."}
                </th>
                <th className="py-2 pl-2 text-right border-b border-slate-200 w-32">
                  {lang === "en" ? "Total" : "Summe"}
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 ||
              (groups.length === 1 &&
                groups[0].items.length === 0 &&
                groups[0].title === null) ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 text-center text-sm text-slate-400"
                  >
                    {lang === "en"
                      ? "No items yet — add an item to see it here."
                      : "Noch keine Positionen — füge eine hinzu, sie erscheint hier."}
                  </td>
                </tr>
              ) : (
                groups.map((group, gi) => {
                  let counter = 0;
                  // Compute starting index across earlier groups so that
                  // numbering runs continuously across sections.
                  for (let p = 0; p < gi; p++) counter += groups[p].items.length;
                  return (
                    <Fragment key={`group-${gi}`}>
                      {group.title !== null && (
                        <tr key={`g-${gi}`}>
                          <td
                            colSpan={7}
                            className="pt-5 pb-1 text-sm font-semibold"
                            style={{ color: primaryColor }}
                          >
                            {group.title || (
                              <span className="italic text-slate-400">
                                {lang === "en"
                                  ? "Untitled section"
                                  : "Unbenannter Abschnitt"}
                              </span>
                            )}
                            <div
                              className="mt-1 h-px"
                              style={{ backgroundColor: primaryColor, opacity: 0.25 }}
                            />
                          </td>
                        </tr>
                      )}
                      {group.items.map((l, li) => {
                        counter += 1;
                        const idx = counter;
                        const total = lineTotal(l);
                        const rate = l.taxRatePct ?? null;
                        return (
                          <tr
                            key={l.id ?? `${gi}-${li}`}
                            className="align-top"
                            data-testid={`preview-line-${l.id ?? `${gi}-${li}`}`}
                          >
                            <td className="py-2 pr-2 text-xs text-slate-400 tabular-nums border-b border-slate-100">
                              {idx}
                            </td>
                            <td className="py-2 px-2 border-b border-slate-100">
                              <div className="font-medium text-slate-900">
                                {l.name || (
                                  <span className="italic text-slate-400">
                                    {lang === "en"
                                      ? "(untitled)"
                                      : "(unbenannt)"}
                                  </span>
                                )}
                              </div>
                              {l.description && (
                                <div className="text-xs text-slate-500 whitespace-pre-line">
                                  {l.description}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums border-b border-slate-100">
                              {l.quantity.toLocaleString(locale)}
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums border-b border-slate-100">
                              {fmt(l.listPrice)}
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums border-b border-slate-100">
                              {l.discountPct
                                ? `${l.discountPct.toLocaleString(locale)} %`
                                : "–"}
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums border-b border-slate-100 text-xs text-slate-500">
                              {rate == null
                                ? "–"
                                : `${formatTaxRate(rate, locale)} %`}
                            </td>
                            <td className="py-2 pl-2 text-right tabular-nums font-semibold border-b border-slate-100">
                              {fmt(total)}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Totals box */}
        <div className="mt-6 flex justify-end">
          <div
            className="w-full sm:w-80 rounded-md border bg-slate-50 p-4 space-y-1.5 text-sm"
            data-testid="preview-totals"
          >
            <div className="flex justify-between">
              <span className="text-slate-500">
                {lang === "en" ? "Net" : "Netto"}
              </span>
              <span className="tabular-nums">{fmt(summary.net)}</span>
            </div>
            {summary.breakdown.map((b) => (
              <div
                key={b.ratePct}
                className="flex justify-between text-xs text-slate-500"
                data-testid={`preview-tax-row-${b.ratePct}`}
              >
                <span>
                  {b.ratePct === 0
                    ? t("pages.quote.vatExempt")
                    : t("pages.quote.vatAt", {
                        pct: formatTaxRate(b.ratePct, locale),
                      })}
                </span>
                <span className="tabular-nums">{fmt(b.tax)}</span>
              </div>
            ))}
            <div
              className="mt-2 flex justify-between border-t pt-2 text-base font-semibold"
              style={{ color: primaryColor }}
            >
              <span>{lang === "en" ? "Gross" : "Brutto"}</span>
              <span className="tabular-nums">{fmt(summary.gross)}</span>
            </div>
          </div>
        </div>

        {notes && notes.trim() && (
          <div className="mt-6">
            <div
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: secondaryColor }}
            >
              {lang === "en" ? "Notes" : "Hinweise"}
            </div>
            <div className="mt-1 text-sm whitespace-pre-line text-slate-700">
              {notes}
            </div>
          </div>
        )}

        {legalEntity && (
          <div
            className="mt-8 border-t pt-3 text-[11px] text-slate-400"
            style={{ borderColor: "#E2E8F0" }}
          >
            {legalEntity}
          </div>
        )}
      </div>
    </div>
  );
}

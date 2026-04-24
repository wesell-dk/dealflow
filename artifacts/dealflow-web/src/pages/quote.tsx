import { useParams } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useGetQuote,
  useListQuoteAttachments,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Download, Paperclip } from "lucide-react";

export default function Quote() {
  const params = useParams();
  const { t } = useTranslation();
  const id = params.id as string;
  const { data: quote, isLoading } = useGetQuote(id);
  const versionId = quote?.versions?.[0]?.id ?? "";
  const { data: attachments } = useListQuoteAttachments(versionId, {
    query: { enabled: !!versionId, queryKey: ["quoteAttachments", versionId] },
  });

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!quote) return <div className="p-8">Quote not found</div>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("common.quote")} {quote.number}</h1>
          <p className="text-muted-foreground mt-1">{quote.dealName}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.open(`/api/quotes/${id}/pdf`, '_blank')}>
            <FileText className="h-4 w-4 mr-2" /> {t("pages.quote.openPdf")}
          </Button>
          <Badge variant="outline">{quote.status}</Badge>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>{t("pages.quote.lineItems")}</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-4">
                {quote.lineItems.map(item => (
                  <div key={item.id} className="flex justify-between items-center border-b pb-2">
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">{t("quoteWizard.qty")}: {item.quantity} &times; {item.unitPrice}</div>
                    </div>
                    <div className="font-bold">{item.total.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                {t("pages.quote.attachments")}
                {attachments && attachments.length > 0 && (
                  <Badge variant="secondary">{attachments.length}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!attachments || attachments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("pages.quote.noAttachments")}</p>
              ) : (
                <div className="space-y-2">
                  {attachments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between rounded-md border p-3" data-testid={`quote-attachment-${a.id}`}>
                      <div className="flex-1">
                        <div className="font-medium text-sm">{a.name}</div>
                        {a.label && <div className="text-xs text-muted-foreground">{a.label}</div>}
                        <div className="mt-1 text-xs text-muted-foreground">
                          {a.mimeType} · {(a.size / 1024).toFixed(0)} KB
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const path = a.objectPath.startsWith("/objects/")
                            ? `/api/storage${a.objectPath}`
                            : a.objectPath;
                          window.open(path, "_blank");
                        }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader><CardTitle>{t("pages.quote.summary")}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between"><span>{t("common.total")}:</span> <strong>{quote.totalAmount.toLocaleString()} {quote.currency}</strong></div>
              <div className="flex justify-between"><span>{t("common.discount")}:</span> <strong>{quote.discountPct}%</strong></div>
              <div className="flex justify-between"><span>{t("pages.quote.margin")}:</span> <strong>{quote.marginPct}%</strong></div>
              <div className="flex justify-between"><span>{t("common.validUntil")}:</span> <strong>{new Date(quote.validUntil).toLocaleDateString()}</strong></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

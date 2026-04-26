import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useListDeals, useCreateQuote } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Breadcrumbs } from "@/components/patterns/breadcrumbs";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function QuoteNew() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: deals } = useListDeals();
  const create = useCreateQuote();

  const [dealId, setDealId] = useState<string>("");
  const [language, setLanguage] = useState<"de" | "en">("de");

  async function submit() {
    if (!dealId) return;
    try {
      const created = await create.mutateAsync({ data: { dealId, language } });
      navigate(`/quotes/${created.id}`);
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: t("nav.quotes"), href: "/quotes" },
          { label: t("pages.quotesNew.title") },
        ]}
      />
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("pages.quotesNew.title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("pages.quotesNew.subtitle")}</p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{t("pages.quotesNew.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="quote-new-deal">{t("pages.quotesNew.selectDeal")}</Label>
            <Select value={dealId} onValueChange={setDealId}>
              <SelectTrigger id="quote-new-deal" data-testid="quote-new-deal-select">
                <SelectValue placeholder={t("pages.quotesNew.selectDeal")} />
              </SelectTrigger>
              <SelectContent>
                {(deals ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id} data-testid={`deal-option-${d.id}`}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="quote-new-language">{t("pages.quotesNew.language")}</Label>
            <Select value={language} onValueChange={(v) => setLanguage(v as "de" | "en")}>
              <SelectTrigger id="quote-new-language" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="de">DE</SelectItem>
                <SelectItem value="en">EN</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={submit}
              disabled={!dealId || create.isPending}
              data-testid="quote-new-create-btn"
            >
              {create.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("pages.quotesNew.creating")}
                </>
              ) : (
                t("pages.quotesNew.create")
              )}
            </Button>
            <Button variant="ghost" onClick={() => navigate("/quotes")}>
              {t("common.cancel")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

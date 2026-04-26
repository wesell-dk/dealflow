import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useListQuoteTemplates,
  useDeleteQuoteTemplate,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CardGridSkeleton } from "@/components/patterns/skeletons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileStack, Search, Trash2, Eye, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { TemplateFormDialog } from "@/components/templates/template-form-dialog";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";

const INDUSTRIES = ["all", "saas", "consulting", "manufacturing", "services", "other"];

export default function Templates() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: templates, isLoading, refetch } = useListQuoteTemplates();
  const [filter, setFilter] = useState("");
  const [industry, setIndustry] = useState("all");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const deleteMut = useDeleteQuoteTemplate();

  const filtered = useMemo(() => {
    if (!templates) return [];
    return templates.filter((tpl) => {
      const matchesIndustry = industry === "all" || tpl.industry === industry;
      const matchesQuery =
        !filter ||
        tpl.name.toLowerCase().includes(filter.toLowerCase()) ||
        tpl.description.toLowerCase().includes(filter.toLowerCase());
      return matchesIndustry && matchesQuery;
    });
  }, [templates, filter, industry]);

  const previewTpl = templates?.find((t) => t.id === previewId);

  const handleDelete = async (id: string) => {
    try {
      await deleteMut.mutateAsync({ id });
      toast({ title: t("pages.templates.deleted") });
      refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({ variant: "destructive", title: t("common.error"), description: msg });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={FileStack}
        title={t("pages.templates.title")}
        subtitle={t("pages.templates.subtitle")}
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="templates-new-button">
            <Plus className="h-4 w-4 mr-1" />
            {t("pages.templates.create")}
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("pages.templates.searchPlaceholder")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={industry} onValueChange={setIndustry}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRIES.map((i) => (
              <SelectItem key={i} value={i}>
                {i === "all"
                  ? t("common.all")
                  : t(`quoteWizard.industries.${i}`, { defaultValue: i })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <CardGridSkeleton items={6} />}

      {!isLoading && filtered.length === 0 && (
        <EmptyStateCard
          icon={FileStack}
          title={t("pages.templates.emptyTitle")}
          body={templates && templates.length > 0
            ? t("pages.templates.empty")
            : t("pages.templates.emptyBody")}
          primaryAction={templates && templates.length === 0 ? {
            label: t("pages.templates.create"),
            onClick: () => setCreateOpen(true),
            testId: "templates-empty-create",
          } : undefined}
        />
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filtered.map((tpl) => (
          <Card key={tpl.id} data-testid={`template-card-${tpl.id}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileStack className="h-4 w-4 text-primary" />
                  {tpl.name}
                </CardTitle>
                {tpl.isSystem && (
                  <Badge variant="outline" className="text-xs">
                    {t("quoteWizard.system")}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground line-clamp-3">
                {tpl.description}
              </p>
              <div className="flex flex-wrap gap-1">
                <Badge variant="secondary" className="text-xs">
                  {tpl.industry}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {tpl.defaultLineItems.length} {t("quoteWizard.positions")}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {t("quoteWizard.validityDays", {
                    days: tpl.defaultValidityDays,
                  })}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {tpl.sections.length} {t("pages.templates.sections")}
                </Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreviewId(tpl.id)}
                  className="flex-1"
                >
                  <Eye className="h-4 w-4 mr-1" />
                  {t("common.view")}
                </Button>
                {!tpl.isSystem && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(tpl.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <TemplateFormDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => refetch()} />

      <Dialog open={!!previewId} onOpenChange={(o) => !o && setPreviewId(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewTpl?.name}</DialogTitle>
          </DialogHeader>
          {previewTpl && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">{previewTpl.description}</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    {t("quoteWizard.defaultDiscount")}
                  </div>
                  <div className="font-bold">
                    {previewTpl.defaultDiscountPct}%
                  </div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    {t("quoteWizard.defaultMargin")}
                  </div>
                  <div className="font-bold">{previewTpl.defaultMarginPct}%</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    {t("common.validUntil")}
                  </div>
                  <div className="font-bold">
                    {previewTpl.defaultValidityDays} {t("pages.home.days")}
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">
                  {t("pages.templates.sectionsTitle")}
                </h3>
                <div className="space-y-2">
                  {previewTpl.sections.map((s) => (
                    <div key={s.id} className="rounded-md border p-3">
                      <div className="font-medium">
                        {s.title}{" "}
                        <Badge variant="outline" className="text-xs">
                          {s.kind}
                        </Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">
                        {s.body}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">
                  {t("pages.templates.lineItemsTitle")}
                </h3>
                <div className="space-y-1">
                  {previewTpl.defaultLineItems.map((li, i) => (
                    <div
                      key={i}
                      className="flex justify-between border-b py-2 last:border-0"
                    >
                      <div>
                        <div className="font-medium">{li.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {li.quantity} × {li.unitPrice}
                        </div>
                      </div>
                      <div className="text-sm font-semibold">
                        {(li.quantity * li.unitPrice).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

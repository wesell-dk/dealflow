import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPricingCategories,
  useCreatePricingCategory,
  useUpdatePricingCategory,
  useArchivePricingCategory,
  useCreatePricingSubcategory,
  useUpdatePricingSubcategory,
  useArchivePricingSubcategory,
  getListPricingCategoriesQueryKey,
  type PricingCategory,
  type PricingSubcategory,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Archive, ChevronRight, ChevronDown, Layers } from "lucide-react";

type CatDialogState =
  | { mode: "create-category" }
  | { mode: "edit-category"; category: PricingCategory }
  | { mode: "create-sub"; category: PricingCategory }
  | { mode: "edit-sub"; category: PricingCategory; sub: PricingSubcategory }
  | null;

export function PricingCategoriesPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [showArchived, setShowArchived] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<CatDialogState>(null);
  const [confirmCat, setConfirmCat] = useState<PricingCategory | null>(null);
  const [confirmSub, setConfirmSub] = useState<{ category: PricingCategory; sub: PricingSubcategory } | null>(null);

  const { data: categories, isLoading } = useListPricingCategories({ includeArchived: showArchived });

  const archiveCat = useArchivePricingCategory();
  const archiveSub = useArchivePricingSubcategory();

  const invalidate = () => qc.invalidateQueries({ queryKey: getListPricingCategoriesQueryKey() });

  const onArchiveCategory = async () => {
    if (!confirmCat) return;
    try {
      await archiveCat.mutateAsync({ id: confirmCat.id });
      const inUse = (confirmCat.positionCount ?? 0) > 0;
      toast({
        title: inUse ? t("pages.pricing.categories.archivedToast") : t("pages.pricing.categories.deleted"),
        description: confirmCat.name,
      });
      await invalidate();
      setConfirmCat(null);
    } catch (e: unknown) {
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: t("pages.pricing.categories.saveFailed"),
        description: body?.error ?? (e instanceof Error ? e.message : "Unbekannt"),
        variant: "destructive",
      });
    }
  };

  const onArchiveSubcategory = async () => {
    if (!confirmSub) return;
    try {
      await archiveSub.mutateAsync({ id: confirmSub.sub.id });
      const inUse = (confirmSub.sub.positionCount ?? 0) > 0;
      toast({
        title: inUse ? t("pages.pricing.categories.subArchivedToast") : t("pages.pricing.categories.subDeleted"),
        description: confirmSub.sub.name,
      });
      await invalidate();
      setConfirmSub(null);
    } catch (e: unknown) {
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: t("pages.pricing.categories.saveFailed"),
        description: body?.error ?? (e instanceof Error ? e.message : "Unbekannt"),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4" data-testid="categories-panel">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4" />
                {t("pages.pricing.categories.title")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("pages.pricing.categories.subtitle")}
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <Switch
                  checked={showArchived}
                  onCheckedChange={setShowArchived}
                  data-testid="switch-show-archived-categories"
                />
                {t("pages.pricing.categories.showArchived")}
              </label>
              <Button size="sm" onClick={() => setDialog({ mode: "create-category" })} data-testid="button-new-category">
                <Plus className="h-4 w-4 mr-1" />
                {t("pages.pricing.categories.addCategory")}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[0,1,2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !categories || categories.length === 0 ? (
            <div className="rounded-md border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
              {t("pages.pricing.categories.empty")}
            </div>
          ) : (
            <div className="rounded-md border divide-y">
              {categories.map(cat => {
                const isOpen = expanded[cat.id] ?? true;
                return (
                  <div key={cat.id} data-testid={`category-row-${cat.id}`}>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/20">
                      <button
                        type="button"
                        onClick={() => setExpanded(s => ({ ...s, [cat.id]: !isOpen }))}
                        className="p-0.5 hover:bg-muted rounded"
                        aria-label={isOpen ? "Einklappen" : "Ausklappen"}
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                      <Badge variant="outline" className="font-mono text-[11px]">{cat.code}</Badge>
                      <span className="font-medium">{cat.name}</span>
                      {cat.status === "archived" && (
                        <Badge variant="secondary" className="text-[10px]">{t("pages.pricing.categories.archived")}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-2">
                        {t("pages.pricing.categories.positions")}: {cat.positionCount ?? 0}
                      </span>
                      <div className="ml-auto flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDialog({ mode: "create-sub", category: cat })}
                          data-testid={`button-add-sub-${cat.id}`}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" /> {t("pages.pricing.categories.addSubcategory")}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDialog({ mode: "edit-category", category: cat })}
                          aria-label={t("common.edit")}
                          data-testid={`button-edit-cat-${cat.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {cat.status === "active" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setConfirmCat(cat)}
                            aria-label={t("pages.pricing.categories.archive")}
                            data-testid={`button-archive-cat-${cat.id}`}
                          >
                            <Archive className="h-4 w-4 text-amber-600" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {isOpen && (
                      <div className="bg-background">
                        {cat.subcategories.length === 0 ? (
                          <div className="px-12 py-3 text-xs text-muted-foreground italic">
                            {t("pages.pricing.categories.noSubcategories")}
                          </div>
                        ) : (
                          <ul className="divide-y">
                            {cat.subcategories.map(sub => (
                              <li
                                key={sub.id}
                                className="flex items-center gap-2 px-12 py-2"
                                data-testid={`sub-row-${sub.id}`}
                              >
                                <Badge variant="outline" className="font-mono text-[11px]">{sub.code}</Badge>
                                <span>{sub.name}</span>
                                {sub.status === "archived" && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    {t("pages.pricing.categories.archived")}
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground ml-2">
                                  {t("pages.pricing.categories.positions")}: {sub.positionCount ?? 0}
                                </span>
                                <div className="ml-auto flex gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setDialog({ mode: "edit-sub", category: cat, sub })}
                                    aria-label={t("common.edit")}
                                    data-testid={`button-edit-sub-${sub.id}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  {sub.status === "active" && (
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => setConfirmSub({ category: cat, sub })}
                                      aria-label={t("pages.pricing.categories.archive")}
                                      data-testid={`button-archive-sub-${sub.id}`}
                                    >
                                      <Archive className="h-4 w-4 text-amber-600" />
                                    </Button>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {dialog && (
        <CategoryFormDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onSaved={invalidate}
        />
      )}

      <AlertDialog open={!!confirmCat} onOpenChange={(v) => { if (!v) setConfirmCat(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {(confirmCat?.positionCount ?? 0) > 0
                ? t("pages.pricing.categories.archive")
                : t("pages.pricing.categories.delete")} — {confirmCat?.name}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(confirmCat?.positionCount ?? 0) > 0
                ? t("pages.pricing.categories.archivedToast")
                : t("pages.pricing.categories.deleted")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); onArchiveCategory(); }} data-testid="confirm-archive-category">
              {(confirmCat?.positionCount ?? 0) > 0
                ? t("pages.pricing.categories.archive")
                : t("pages.pricing.categories.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmSub} onOpenChange={(v) => { if (!v) setConfirmSub(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {(confirmSub?.sub.positionCount ?? 0) > 0
                ? t("pages.pricing.categories.archive")
                : t("pages.pricing.categories.delete")} — {confirmSub?.sub.name}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(confirmSub?.sub.positionCount ?? 0) > 0
                ? t("pages.pricing.categories.subArchivedToast")
                : t("pages.pricing.categories.subDeleted")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); onArchiveSubcategory(); }} data-testid="confirm-archive-sub">
              {(confirmSub?.sub.positionCount ?? 0) > 0
                ? t("pages.pricing.categories.archive")
                : t("pages.pricing.categories.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CategoryFormDialog({
  state,
  onClose,
  onSaved,
}: {
  state: NonNullable<CatDialogState>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const createCat = useCreatePricingCategory();
  const updateCat = useUpdatePricingCategory();
  const createSub = useCreatePricingSubcategory();
  const updateSub = useUpdatePricingSubcategory();

  const initial = useMemo(() => {
    if (state.mode === "edit-category") return { code: state.category.code, name: state.category.name, sortOrder: state.category.sortOrder };
    if (state.mode === "edit-sub") return { code: state.sub.code, name: state.sub.name, sortOrder: state.sub.sortOrder };
    return { code: "", name: "", sortOrder: 0 };
  }, [state]);

  const [code, setCode] = useState(initial.code);
  const [name, setName] = useState(initial.name);
  const [sortOrder, setSortOrder] = useState<string>(String(initial.sortOrder));

  const isCategory = state.mode === "create-category" || state.mode === "edit-category";
  const isEdit = state.mode === "edit-category" || state.mode === "edit-sub";

  const title = isCategory
    ? (isEdit ? t("common.edit") + " — " + t("pages.pricing.category") : t("pages.pricing.categories.newCategoryTitle"))
    : (isEdit ? t("common.edit") + " — " + t("pages.pricing.subcategory") : t("pages.pricing.categories.newSubcategoryTitle"));

  const submit = async () => {
    const codeUp = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,8}$/.test(codeUp)) {
      toast({ title: t("pages.pricing.categories.saveFailed"), description: t("pages.pricing.categories.codeHint"), variant: "destructive" });
      return;
    }
    if (!name.trim()) {
      toast({ title: t("pages.pricing.categories.saveFailed"), description: t("common.name"), variant: "destructive" });
      return;
    }
    const sortNum = Number(sortOrder);
    const payload = {
      code: codeUp,
      name: name.trim(),
      sortOrder: Number.isFinite(sortNum) ? sortNum : 0,
    };
    try {
      if (state.mode === "create-category") {
        await createCat.mutateAsync({ data: payload });
      } else if (state.mode === "edit-category") {
        await updateCat.mutateAsync({ id: state.category.id, data: payload });
      } else if (state.mode === "create-sub") {
        await createSub.mutateAsync({ id: state.category.id, data: payload });
      } else {
        await updateSub.mutateAsync({ id: state.sub.id, data: payload });
      }
      toast({ title: t("common.save"), description: payload.name });
      onSaved();
      onClose();
    } catch (e: unknown) {
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: t("pages.pricing.categories.saveFailed"),
        description: body?.error ?? (e instanceof Error ? e.message : "Unbekannt"),
        variant: "destructive",
      });
    }
  };

  const busy = createCat.isPending || updateCat.isPending || createSub.isPending || updateSub.isPending;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="category-form-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("pages.pricing.categories.codeHint")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>{t("pages.pricing.categories.code")} *</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={8}
              placeholder="SW"
              className="font-mono uppercase"
              data-testid="input-cat-code"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("common.name")} *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Software"
              data-testid="input-cat-name"
            />
          </div>
          <div className="grid gap-1.5">
            <Label>{t("pages.pricing.categories.sortOrder")}</Label>
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              data-testid="input-cat-sort"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={busy} data-testid="button-cat-submit">{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

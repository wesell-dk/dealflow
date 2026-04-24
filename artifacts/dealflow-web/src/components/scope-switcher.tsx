import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Building2, ChevronRight, RotateCcw, Check, Filter, Lock, Search } from "lucide-react";
import { listCompanies, listBrands } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { apiUpdateActiveScope } from "@/lib/auth";

/**
 * Tree-Picker im Header zum Umschalten der aktiven Sicht (Tenant › Companies ›
 * Brands). Persistiert pro User in DB + Cookie. Restricted User dürfen nur
 * Teilmengen ihrer Permissions wählen — wenn sie nur eine Company/Brand sehen,
 * ist der Picker disabled.
 */
export function ScopeSwitcher() {
  const { t } = useTranslation();
  const { user, bootActiveScope, refresh } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allowedCompanyIds = useMemo(
    () => new Set(user?.allowedScope.companyIds ?? []),
    [user?.allowedScope.companyIds],
  );
  const allowedBrandIds = useMemo(
    () => new Set(user?.allowedScope.brandIds ?? []),
    [user?.allowedScope.brandIds],
  );

  const { data: companies = [] } = useQuery({
    queryKey: ["scope-switcher", "companies"],
    queryFn: async ({ signal }) => listCompanies({ permitted: true }, { signal }),
    enabled: !!user,
  });
  const { data: brands = [] } = useQuery({
    queryKey: ["scope-switcher", "brands"],
    queryFn: async ({ signal }) => listBrands({ permitted: true }, { signal }),
    enabled: !!user,
  });

  // Permitted, sortiert
  const permittedCompanies = useMemo(
    () => companies
      .filter((c) => allowedCompanyIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [companies, allowedCompanyIds],
  );
  const brandsByCompany = useMemo(() => {
    const map = new Map<string, typeof brands>();
    for (const b of brands) {
      if (!allowedBrandIds.has(b.id)) continue;
      const list = map.get(b.companyId) ?? [];
      list.push(b);
      map.set(b.companyId, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return map;
  }, [brands, allowedBrandIds]);

  const totalPermittedItems = permittedCompanies.length + Array.from(brandsByCompany.values()).reduce((acc, l) => acc + l.length, 0);
  // Disabled-Logik:
  //  - !tenantWide  → Admin hat den User auf eine feste Permission-Menge
  //                   restringiert; Switcher wird mit Tooltip blockiert.
  //  - 1 Item       → Es gibt nichts zu wählen.
  const isAdminLocked = !!user && !user.tenantWide;
  const isSingleItemLocked = !!user && user.tenantWide && totalPermittedItems <= 1;
  const isLocked = isAdminLocked || isSingleItemLocked;

  // Aktive Auswahl. NULL = "alle" → wir setzen NICHT in selectedCompanies.
  // Fallback auf bootActiveScope (Cookie) verhindert "tenantWide-Flash" wenn
  // /auth/me noch nicht geantwortet hat.
  const effectiveActiveScope =
    user?.activeScope ?? (bootActiveScope ? bootActiveScope : null);
  const activeCompanyIds = useMemo(
    () => new Set(effectiveActiveScope?.companyIds ?? []),
    [effectiveActiveScope?.companyIds],
  );
  const activeBrandIds = useMemo(
    () => new Set(effectiveActiveScope?.brandIds ?? []),
    [effectiveActiveScope?.brandIds],
  );
  const filtered = !!effectiveActiveScope?.filtered;

  // Lokaler Draft-State für Multi-Select
  const [draftCompanies, setDraftCompanies] = useState<Set<string>>(activeCompanyIds);
  const [draftBrands, setDraftBrands] = useState<Set<string>>(activeBrandIds);

  // Beim Öffnen: vom Server-State synchronisieren
  function handleOpenChange(o: boolean) {
    if (o) {
      setDraftCompanies(new Set(user?.activeScope.companyIds ?? []));
      setDraftBrands(new Set(user?.activeScope.brandIds ?? []));
      setSearch("");
    }
    setOpen(o);
  }

  function toggleCompany(id: string) {
    setDraftCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleBrand(id: string) {
    setDraftBrands((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const updateScope = useMutation({
    mutationFn: async (input: { companyIds: string[] | null; brandIds: string[] | null }) =>
      apiUpdateActiveScope(input),
    onSuccess: async () => {
      await refresh();
      // Alle Daten-Queries invalidieren — kein partielles Stale.
      await qc.invalidateQueries();
      toast({
        title: t("scopeSwitcher.toastUpdated"),
        description: t("scopeSwitcher.toastUpdatedDesc"),
      });
      setOpen(false);
    },
    onError: (err: Error) => {
      toast({
        title: t("scopeSwitcher.toastError"),
        description: err.message,
        variant: "destructive",
      });
    },
  });

  function applyDraft() {
    const cArr = Array.from(draftCompanies);
    const bArr = Array.from(draftBrands);
    // Wenn Draft alle erlaubten enthält → null (Reset für Dimension)
    const cIds = cArr.length === 0 ? null : cArr.length === permittedCompanies.length ? null : cArr;
    const bIds = bArr.length === 0 ? null : cArr.length === 0 && draftBrands.size === Array.from(brandsByCompany.values()).reduce((a, l) => a + l.length, 0) ? null : bArr;
    // Vereinfachung: explizit nichts gewählt = null (kein Filter)
    updateScope.mutate({
      companyIds: cArr.length === 0 ? null : cIds,
      brandIds: bArr.length === 0 ? null : bIds,
    });
  }

  function resetScope() {
    setDraftCompanies(new Set());
    setDraftBrands(new Set());
    updateScope.mutate({ companyIds: null, brandIds: null });
  }

  // Trigger-Label
  const triggerLabel = useMemo(() => {
    if (!filtered) return t("scopeSwitcher.allScope");
    const cCount = activeCompanyIds.size;
    const bCount = activeBrandIds.size;
    if (cCount > 0 && bCount === 0) return t("scopeSwitcher.companiesCount", { count: cCount });
    if (bCount > 0 && cCount === 0) return t("scopeSwitcher.brandsCount", { count: bCount });
    return t("scopeSwitcher.companiesAndBrandsCount", { c: cCount, b: bCount });
  }, [filtered, activeCompanyIds.size, activeBrandIds.size, t]);

  // Suche
  const searchLower = search.trim().toLowerCase();
  const visibleCompanies = useMemo(() => {
    if (!searchLower) return permittedCompanies;
    return permittedCompanies.filter((c) => {
      if (c.name.toLowerCase().includes(searchLower)) return true;
      const bs = brandsByCompany.get(c.id) ?? [];
      return bs.some((b) => b.name.toLowerCase().includes(searchLower));
    });
  }, [permittedCompanies, brandsByCompany, searchLower]);

  if (!user) return null;

  // Disabled-Render. Zwei Gründe:
  //  - !tenantWide: Admin hat User auf feste Permission-Menge restringiert
  //                 → Tooltip "Vom Administrator festgelegt".
  //  - 1 Item:      Es gibt nichts zu wählen → generisches "Locked".
  if (isLocked) {
    const tooltipText = isAdminLocked
      ? t("scopeSwitcher.lockedAdminTooltip")
      : t("scopeSwitcher.lockedSingleTooltip");
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {/* span weil disabled buttons keine pointer events bekommen */}
          <span tabIndex={0} className="inline-flex">
            <Button
              variant="outline"
              size="sm"
              className="hidden md:inline-flex h-8 gap-1.5 cursor-not-allowed opacity-70"
              disabled
              data-testid="button-scope-switcher"
              aria-label={tooltipText}
            >
              <Lock className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{t("scopeSwitcher.lockedLabel")}</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" data-testid="tooltip-scope-locked">
          {tooltipText}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant={filtered ? "default" : "outline"}
            size="sm"
            className="hidden md:inline-flex h-8 gap-1.5 max-w-[260px]"
            data-testid="button-scope-switcher"
          >
            {filtered ? <Filter className="h-3.5 w-3.5" /> : <Building2 className="h-3.5 w-3.5" />}
            <span className="text-xs font-medium truncate">{triggerLabel}</span>
            <ChevronRight className="h-3 w-3 opacity-60 rotate-90" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[360px] p-0" data-testid="popover-scope-switcher">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">{t("scopeSwitcher.title")}</span>
            </div>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={resetScope}
                disabled={updateScope.isPending}
                data-testid="button-scope-reset"
              >
                <RotateCcw className="h-3 w-3" />
                {t("scopeSwitcher.reset")}
              </Button>
            )}
          </div>
          <div className="px-3 py-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder={t("scopeSwitcher.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
                data-testid="input-scope-search"
              />
            </div>
          </div>
          <ScrollArea className="max-h-[320px]">
            <div className="p-2 space-y-1">
              {visibleCompanies.length === 0 && (
                <div className="text-center text-xs text-muted-foreground py-6">
                  {t("scopeSwitcher.empty")}
                </div>
              )}
              {visibleCompanies.map((c) => {
                const cBrands = brandsByCompany.get(c.id) ?? [];
                const cChecked = draftCompanies.has(c.id);
                return (
                  <div key={c.id} className="space-y-0.5">
                    <button
                      type="button"
                      className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover-elevate ${
                        cChecked ? "bg-primary/10 text-primary font-medium" : ""
                      }`}
                      onClick={() => toggleCompany(c.id)}
                      data-testid={`row-scope-company-${c.id}`}
                    >
                      <Building2 className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1 truncate">{c.name}</span>
                      {cChecked && <Check className="h-3.5 w-3.5" />}
                    </button>
                    {cBrands.length > 0 && (
                      <div className="ml-5 border-l border-border pl-2 space-y-0.5">
                        {cBrands
                          .filter((b) => !searchLower || b.name.toLowerCase().includes(searchLower) || c.name.toLowerCase().includes(searchLower))
                          .map((b) => {
                            const bChecked = draftBrands.has(b.id);
                            return (
                              <button
                                key={b.id}
                                type="button"
                                className={`w-full flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover-elevate ${
                                  bChecked ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground"
                                }`}
                                onClick={() => toggleBrand(b.id)}
                                data-testid={`row-scope-brand-${b.id}`}
                              >
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={{ background: b.color || "hsl(var(--muted))" }}
                                />
                                <span className="flex-1 truncate">{b.name}</span>
                                {bChecked && <Check className="h-3 w-3" />}
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <Separator />
          <div className="flex items-center justify-between px-3 py-2 gap-2">
            <span className="text-xs text-muted-foreground">
              {t("scopeSwitcher.draftCount", {
                c: draftCompanies.size,
                b: draftBrands.size,
              })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => setOpen(false)}
                data-testid="button-scope-cancel"
              >
                {t("scopeSwitcher.cancel")}
              </Button>
              <Button
                size="sm"
                className="h-8"
                onClick={applyDraft}
                disabled={updateScope.isPending}
                data-testid="button-scope-apply"
              >
                {t("scopeSwitcher.apply")}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {filtered && (
        <Badge
          variant="secondary"
          className="hidden md:inline-flex h-6 gap-1 text-xs"
          data-testid="badge-scope-filtered"
        >
          <Filter className="h-3 w-3" />
          {t("scopeSwitcher.filteredBadge")}
        </Badge>
      )}
    </>
  );
}

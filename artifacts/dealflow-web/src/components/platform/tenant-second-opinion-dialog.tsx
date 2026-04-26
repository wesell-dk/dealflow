import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTenantAiSecondOpinionConfig,
  useUpdateTenantAiSecondOpinionConfig,
  getGetTenantAiSecondOpinionConfigQueryKey,
  type AiSecondOpinionPromptConfig,
  type PlatformTenant,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenant: PlatformTenant | null;
}

type Mode = "off" | "optional" | "always";
type ConfigMap = Record<string, AiSecondOpinionPromptConfig>;

const MODE_AUTO = "__auto__";

/**
 * Per-Tenant-Editor fuer die KI-Zweitmeinung (Task #232).
 *
 * Liest die Liste der unterstuetzten Workflow-Keys plus die erlaubten
 * Anthropic-Modelle vom Backend. Pro Workflow waehlt der Platform-Admin
 * Modus (off/optional/always) und optional ein konkretes Zweitmodell;
 * leerer Modell-Slot uebergibt sich der serverseitigen Heuristik.
 */
export function TenantSecondOpinionDialog({ open, onOpenChange, tenant }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const tenantId = tenant?.id ?? "";

  const { data, isLoading } = useGetTenantAiSecondOpinionConfig(tenantId, {
    query: {
      enabled: open && !!tenantId,
      queryKey: getGetTenantAiSecondOpinionConfigQueryKey(tenantId),
    },
  });
  const updateMut = useUpdateTenantAiSecondOpinionConfig();

  const [draft, setDraft] = useState<ConfigMap>({});

  // Each time the dialog re-opens with fresh server data, snapshot it into
  // the local edit buffer so cancel-and-reopen always sees the saved state.
  useEffect(() => {
    if (!open || !data) return;
    const next: ConfigMap = {};
    for (const key of data.promptKeys) {
      const existing = data.config?.[key];
      next[key] = {
        mode: (existing?.mode as Mode | undefined) ?? "off",
        model: existing?.model ?? null,
        systemSuffix: existing?.systemSuffix ?? null,
      };
    }
    setDraft(next);
  }, [open, data]);

  const promptKeys = data?.promptKeys ?? [];
  const allowedModels = data?.allowedModels ?? [];

  const dirty = useMemo(() => {
    if (!data) return false;
    for (const key of promptKeys) {
      const a = draft[key];
      const b = data.config?.[key] ?? { mode: "off", model: null, systemSuffix: null };
      if ((a?.mode ?? "off") !== (b.mode ?? "off")) return true;
      if ((a?.model ?? null) !== (b.model ?? null)) return true;
    }
    return false;
  }, [draft, data, promptKeys]);

  function setMode(key: string, mode: Mode) {
    setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? { mode: "off" }), mode } }));
  }
  function setModel(key: string, model: string | null) {
    setDraft((d) => ({ ...d, [key]: { ...(d[key] ?? { mode: "off" }), model } }));
  }

  async function save() {
    if (!tenantId) return;
    try {
      await updateMut.mutateAsync({ id: tenantId, data: { config: draft } });
      toast({ title: t("pages.platformAdmin.secondOpinionSaved") });
      await qc.invalidateQueries({ queryKey: getGetTenantAiSecondOpinionConfigQueryKey(tenantId) });
      onOpenChange(false);
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } };
      toast({
        title: t("pages.platformAdmin.secondOpinionSaveFailed"),
        description: e?.response?.data?.error ?? (err instanceof Error ? err.message : String(err)),
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="tenant-second-opinion-dialog">
        <DialogHeader>
          <DialogTitle>
            {t("pages.platformAdmin.secondOpinionDialogTitle", { name: tenant?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {t("pages.platformAdmin.secondOpinionDialogDesc")}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-[1fr_140px_220px] gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide pb-1 border-b">
              <span>{t("pages.platformAdmin.secondOpinionWorkflow")}</span>
              <span>{t("pages.platformAdmin.secondOpinionMode")}</span>
              <span>{t("pages.platformAdmin.secondOpinionModel")}</span>
            </div>
            {promptKeys.map((key) => {
              const cfg = draft[key] ?? { mode: "off" as Mode, model: null };
              const friendly = t(`pages.platformAdmin.secondOpinionPromptKey.${key}`, { defaultValue: key });
              return (
                <div
                  key={key}
                  className="grid grid-cols-[1fr_140px_220px] gap-2 items-center"
                  data-testid={`second-opinion-row-${key.replace(/\./g, "-")}`}
                >
                  <div>
                    <Label className="text-sm font-medium">{friendly}</Label>
                    <div className="text-[10px] text-muted-foreground font-mono">{key}</div>
                  </div>
                  <Select
                    value={cfg.mode ?? "off"}
                    onValueChange={(v) => setMode(key, v as Mode)}
                  >
                    <SelectTrigger
                      className="h-8 text-xs"
                      data-testid={`second-opinion-mode-${key.replace(/\./g, "-")}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">{t("pages.platformAdmin.secondOpinionModeOff")}</SelectItem>
                      <SelectItem value="optional">{t("pages.platformAdmin.secondOpinionModeOptional")}</SelectItem>
                      <SelectItem value="always">{t("pages.platformAdmin.secondOpinionModeAlways")}</SelectItem>
                    </SelectContent>
                  </Select>
                  {allowedModels.length > 0 ? (
                    <Select
                      value={cfg.model ?? MODE_AUTO}
                      onValueChange={(v) => setModel(key, v === MODE_AUTO ? null : v)}
                      disabled={cfg.mode === "off"}
                    >
                      <SelectTrigger
                        className="h-8 text-xs"
                        data-testid={`second-opinion-model-${key.replace(/\./g, "-")}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={MODE_AUTO}>
                          {t("pages.platformAdmin.secondOpinionModelAuto")}
                        </SelectItem>
                        {allowedModels.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={cfg.model ?? ""}
                      onChange={(e) => setModel(key, e.target.value || null)}
                      placeholder={t("pages.platformAdmin.secondOpinionModelAuto")}
                      className="h-8 text-xs"
                      disabled={cfg.mode === "off"}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={save}
            disabled={!dirty || updateMut.isPending}
            data-testid="tenant-second-opinion-save"
          >
            {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("pages.platformAdmin.saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

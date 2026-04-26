import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePlatformTenant,
  useUpdatePlatformTenant,
  getListPlatformTenantsQueryKey,
  type PlatformTenant,
  type PlatformTenantCreate,
  type PlatformTenantUpdate,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, AlertTriangle } from "lucide-react";
import { FieldHint } from "@/components/ui/field-hint";
import { TENANT_PLANS, TENANT_REGIONS } from "@/lib/glossary";

type Plan = "Starter" | "Growth" | "Business" | "Enterprise";
type Region = "EU" | "US" | "UK" | "APAC";

const PLAN_OPTIONS: Plan[] = ["Starter", "Growth", "Business", "Enterprise"];
const REGION_OPTIONS: Region[] = ["EU", "US", "UK", "APAC"];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode?: "create" | "edit";
  tenant?: PlatformTenant | null;
}

export function TenantFormDialog({ open, onOpenChange, mode = "create", tenant = null }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreatePlatformTenant();
  const updateMut = useUpdatePlatformTenant();
  const isEdit = mode === "edit";

  const [name, setName] = useState("");
  const [plan, setPlan] = useState<Plan>("Growth");
  const [region, setRegion] = useState<Region>("EU");
  const [notes, setNotes] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  // Re-seed form whenever the dialog opens, to make sure stale state from a
  // previously edited tenant doesn't bleed into a new edit/create.
  useEffect(() => {
    if (!open) return;
    if (isEdit && tenant) {
      setName(tenant.name ?? "");
      setPlan((tenant.plan as Plan) ?? "Growth");
      setRegion((tenant.region as Region) ?? "EU");
      setNotes(tenant.notes ?? "");
      setAdminName(""); setAdminEmail(""); setAdminPassword("");
    } else {
      setName(""); setPlan("Growth"); setRegion("EU"); setNotes("");
      setAdminName(""); setAdminEmail(""); setAdminPassword("");
    }
  }, [open, isEdit, tenant]);

  const submit = async () => {
    if (isEdit) {
      if (!tenant) return;
      if (!name.trim()) {
        toast({
          title: t("pages.platformAdmin.validationError"),
          description: t("pages.platformAdmin.validationName"),
          variant: "destructive",
        });
        return;
      }
      const body: PlatformTenantUpdate = {
        name: name.trim(),
        plan,
        region,
        notes: notes.trim() ? notes.trim() : null,
      };
      try {
        await updateMut.mutateAsync({ id: tenant.id, data: body });
        toast({ title: t("pages.platformAdmin.updated"), description: name.trim() });
        await qc.invalidateQueries({ queryKey: getListPlatformTenantsQueryKey() });
        onOpenChange(false);
      } catch (e: unknown) {
        const err = e as { response?: { data?: { error?: string } } };
        toast({
          title: t("pages.platformAdmin.updateFailed"),
          description: err?.response?.data?.error ?? String(e),
          variant: "destructive",
        });
      }
      return;
    }

    if (!name.trim() || !adminName.trim() || !adminEmail.trim() || adminPassword.length < 8) {
      toast({
        title: t("pages.platformAdmin.validationError"),
        description: t("pages.platformAdmin.validationErrorBody"),
        variant: "destructive",
      });
      return;
    }
    const body: PlatformTenantCreate = {
      name: name.trim(),
      plan,
      region,
      admin: {
        name: adminName.trim(),
        email: adminEmail.trim().toLowerCase(),
        password: adminPassword,
      },
    };
    try {
      await createMut.mutateAsync({ data: body });
      toast({ title: t("pages.platformAdmin.created"), description: name.trim() });
      await qc.invalidateQueries({ queryKey: getListPlatformTenantsQueryKey() });
      onOpenChange(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast({
        title: t("pages.platformAdmin.createFailed"),
        description: err?.response?.data?.error ?? String(e),
        variant: "destructive",
      });
    }
  };

  const pending = isEdit ? updateMut.isPending : createMut.isPending;
  const regionChanged = isEdit && tenant && region !== tenant.region;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="tenant-form-dialog">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? t("pages.platformAdmin.editTenant") : t("pages.platformAdmin.createTenant")}
          </DialogTitle>
          <DialogDescription>
            {isEdit ? t("pages.platformAdmin.editTenantDesc") : t("pages.platformAdmin.createTenantDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="tenant-name">{t("pages.platformAdmin.tenantName")}</Label>
            <Input
              id="tenant-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Industrial Group"
              data-testid="input-tenant-name"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="tenant-plan">{t("pages.platformAdmin.plan")}</Label>
                <FieldHint
                  title="Tarif"
                  text="Bestimmt Limits (User, Deals, Speicher) und freigeschaltete Funktionen. Wähle einen Eintrag, um die Beschreibung zu sehen."
                />
              </div>
              <Select value={plan} onValueChange={(v) => setPlan(v as Plan)}>
                <SelectTrigger id="tenant-plan" data-testid="select-tenant-plan">
                  <SelectValue>{TENANT_PLANS[plan]?.label ?? plan}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PLAN_OPTIONS.map(p => (
                    <SelectItem key={p} value={p} className="py-2" textValue={TENANT_PLANS[p].label}>
                      <div className="flex flex-col">
                        <span>{TENANT_PLANS[p].label}</span>
                        <span className="text-[11px] leading-snug text-muted-foreground">{TENANT_PLANS[p].short}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="tenant-region">{t("pages.platformAdmin.region")}</Label>
                <FieldHint
                  title="Datenresidenz"
                  text="Region, in der Daten dieses Mandanten physisch gespeichert werden. Änderungen nach Bereitstellung können Compliance-Auswirkungen haben."
                />
              </div>
              <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
                <SelectTrigger id="tenant-region" data-testid="select-tenant-region">
                  <SelectValue>{TENANT_REGIONS[region]?.label ?? region}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {REGION_OPTIONS.map(r => (
                    <SelectItem key={r} value={r} className="py-2" textValue={TENANT_REGIONS[r].label}>
                      <div className="flex flex-col">
                        <span>{TENANT_REGIONS[r].label}</span>
                        <span className="text-[11px] leading-snug text-muted-foreground">{TENANT_REGIONS[r].short}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {regionChanged && (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-900 dark:text-amber-200"
              data-testid="region-change-warning"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{t("pages.platformAdmin.regionChangeWarning")}</span>
            </div>
          )}
          {isEdit && (
            <div className="grid gap-2">
              <Label htmlFor="tenant-notes">{t("pages.platformAdmin.notes")}</Label>
              <Textarea
                id="tenant-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("pages.platformAdmin.notesPlaceholder")}
                rows={3}
                data-testid="input-tenant-notes"
              />
            </div>
          )}
          {!isEdit && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <div className="text-sm font-medium">{t("pages.platformAdmin.firstAdmin")}</div>
              <div className="grid gap-2">
                <Label htmlFor="admin-name">{t("pages.platformAdmin.adminName")}</Label>
                <Input
                  id="admin-name"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  placeholder="Anna Schmidt"
                  data-testid="input-admin-name"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="admin-email">{t("pages.platformAdmin.adminEmail")}</Label>
                <Input
                  id="admin-email"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="anna@acme.com"
                  data-testid="input-admin-email"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="admin-pw">{t("pages.platformAdmin.adminPassword")}</Label>
                <Input
                  id="admin-pw"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  placeholder="min. 8 Zeichen"
                  data-testid="input-admin-password"
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={pending} data-testid="submit-tenant">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? t("pages.platformAdmin.saveChanges") : t("pages.platformAdmin.createTenant")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

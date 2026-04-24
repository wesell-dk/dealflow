import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreatePlatformTenant,
  getListPlatformTenantsQueryKey,
  type PlatformTenantCreate,
} from "@workspace/api-client-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

type Plan = "Starter" | "Growth" | "Business" | "Enterprise";
type Region = "EU" | "US" | "UK" | "APAC";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function TenantFormDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const createMut = useCreatePlatformTenant();

  const [name, setName] = useState("");
  const [plan, setPlan] = useState<Plan>("Growth");
  const [region, setRegion] = useState<Region>("EU");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const reset = () => {
    setName(""); setPlan("Growth"); setRegion("EU");
    setAdminName(""); setAdminEmail(""); setAdminPassword("");
  };

  const submit = async () => {
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
      reset();
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

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg" data-testid="tenant-form-dialog">
        <DialogHeader>
          <DialogTitle>{t("pages.platformAdmin.createTenant")}</DialogTitle>
          <DialogDescription>{t("pages.platformAdmin.createTenantDesc")}</DialogDescription>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>{t("pages.platformAdmin.plan")}</Label>
              <Select value={plan} onValueChange={(v) => setPlan(v as Plan)}>
                <SelectTrigger data-testid="select-tenant-plan"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Starter">Starter</SelectItem>
                  <SelectItem value="Growth">Growth</SelectItem>
                  <SelectItem value="Business">Business</SelectItem>
                  <SelectItem value="Enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>{t("pages.platformAdmin.region")}</Label>
              <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
                <SelectTrigger data-testid="select-tenant-region"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EU">EU</SelectItem>
                  <SelectItem value="US">US</SelectItem>
                  <SelectItem value="UK">UK</SelectItem>
                  <SelectItem value="APAC">APAC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={createMut.isPending} data-testid="submit-tenant">
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("pages.platformAdmin.createTenant")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

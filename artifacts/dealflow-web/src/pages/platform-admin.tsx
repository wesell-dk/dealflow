import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPlatformTenants,
  useUpdatePlatformTenant,
  getListPlatformTenantsQueryKey,
  type PlatformTenant,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Building2, Users, Globe, Loader2, Pencil, Power, RotateCcw } from "lucide-react";
import { TenantFormDialog } from "@/components/platform/tenant-form-dialog";
import { useToast } from "@/hooks/use-toast";

export default function PlatformAdmin() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTenant, setEditTenant] = useState<PlatformTenant | null>(null);
  const [confirmTenant, setConfirmTenant] = useState<PlatformTenant | null>(null);
  const updateMut = useUpdatePlatformTenant();

  // Gate: only platform admins. Redirect after auth has loaded.
  useEffect(() => {
    if (!loading && user && !user.isPlatformAdmin) {
      navigate("/", { replace: true });
    }
  }, [loading, user, navigate]);

  const enabled = !!user?.isPlatformAdmin;
  const { data: tenants, isLoading } = useListPlatformTenants({
    query: { enabled, queryKey: getListPlatformTenantsQueryKey() },
  });

  const confirmAction = useMemo(() => {
    if (!confirmTenant) return null;
    return confirmTenant.status === "disabled" ? "reactivate" : "disable";
  }, [confirmTenant]);

  const runStatusChange = async () => {
    if (!confirmTenant || !confirmAction) return;
    const next = confirmAction === "disable" ? "disabled" : "active";
    try {
      await updateMut.mutateAsync({
        id: confirmTenant.id,
        data: { status: next },
      });
      toast({
        title: confirmAction === "disable"
          ? t("pages.platformAdmin.disabled")
          : t("pages.platformAdmin.reactivated"),
        description: confirmTenant.name,
      });
      await qc.invalidateQueries({ queryKey: getListPlatformTenantsQueryKey() });
      setConfirmTenant(null);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      toast({
        title: t("pages.platformAdmin.updateFailed"),
        description: err?.response?.data?.error ?? String(e),
        variant: "destructive",
      });
    }
  };

  if (loading || (user && !user.isPlatformAdmin)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="platform-admin-page">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Building2 className="h-7 w-7 text-primary" />
            {t("pages.platformAdmin.title")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("pages.platformAdmin.subtitle")}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="platform-admin-new-tenant">
          <Plus className="h-4 w-4 mr-1" />
          {t("pages.platformAdmin.createTenant")}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="platform-admin-tenants">
          {tenants?.map((tenant) => {
            const disabled = tenant.status === "disabled";
            return (
              <Card
                key={tenant.id}
                data-testid={`tenant-card-${tenant.id}`}
                className={disabled ? "opacity-70" : ""}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{tenant.name}</CardTitle>
                    <div className="flex items-center gap-1.5">
                      {disabled && (
                        <Badge variant="destructive" data-testid={`tenant-status-${tenant.id}`}>
                          {t("pages.platformAdmin.disabledBadge")}
                        </Badge>
                      )}
                      <Badge variant="secondary">{tenant.plan}</Badge>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground font-mono">{tenant.id}</p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Globe className="h-4 w-4" />
                      {t("pages.platformAdmin.region")}
                    </span>
                    <Badge variant="outline">{tenant.region}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Users className="h-4 w-4" />
                      {t("pages.platformAdmin.users")}
                    </span>
                    <span className="font-medium tabular-nums">{tenant.userCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Building2 className="h-4 w-4" />
                      {t("pages.platformAdmin.companies")}
                    </span>
                    <span className="font-medium tabular-nums">{tenant.companyCount}</span>
                  </div>
                  <div className="text-xs text-muted-foreground pt-1 border-t">
                    {t("pages.platformAdmin.createdAt")}: {new Date(tenant.createdAt).toLocaleDateString()}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setEditTenant(tenant)}
                      data-testid={`tenant-edit-${tenant.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      {t("pages.platformAdmin.edit")}
                    </Button>
                    {disabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => setConfirmTenant(tenant)}
                        data-testid={`tenant-reactivate-${tenant.id}`}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1" />
                        {t("pages.platformAdmin.reactivate")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-destructive hover:text-destructive"
                        onClick={() => setConfirmTenant(tenant)}
                        data-testid={`tenant-disable-${tenant.id}`}
                      >
                        <Power className="h-3.5 w-3.5 mr-1" />
                        {t("pages.platformAdmin.disable")}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {tenants && tenants.length === 0 && (
            <div className="col-span-full p-12 text-center border rounded-md text-muted-foreground bg-muted/10">
              {t("pages.platformAdmin.empty")}
            </div>
          )}
        </div>
      )}

      <TenantFormDialog open={createOpen} onOpenChange={setCreateOpen} mode="create" />
      <TenantFormDialog
        open={!!editTenant}
        onOpenChange={(v) => { if (!v) setEditTenant(null); }}
        mode="edit"
        tenant={editTenant}
      />

      <AlertDialog
        open={!!confirmTenant}
        onOpenChange={(v) => { if (!v) setConfirmTenant(null); }}
      >
        <AlertDialogContent data-testid="tenant-status-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "reactivate"
                ? t("pages.platformAdmin.reactivateConfirmTitle", { name: confirmTenant?.name ?? "" })
                : t("pages.platformAdmin.disableConfirmTitle", { name: confirmTenant?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "reactivate"
                ? t("pages.platformAdmin.reactivateConfirmBody")
                : t("pages.platformAdmin.disableConfirmBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={runStatusChange}
              disabled={updateMut.isPending}
              data-testid="tenant-status-confirm-button"
              className={confirmAction === "disable" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {updateMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {confirmAction === "reactivate"
                ? t("pages.platformAdmin.reactivateConfirm")
                : t("pages.platformAdmin.disableConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

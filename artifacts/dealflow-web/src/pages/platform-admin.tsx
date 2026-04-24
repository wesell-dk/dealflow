import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  useListPlatformTenants,
  getListPlatformTenantsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Building2, Users, Globe, Loader2 } from "lucide-react";
import { TenantFormDialog } from "@/components/platform/tenant-form-dialog";

export default function PlatformAdmin() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const [, navigate] = useLocation();
  const [createOpen, setCreateOpen] = useState(false);

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
          {tenants?.map((tenant) => (
            <Card key={tenant.id} data-testid={`tenant-card-${tenant.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base">{tenant.name}</CardTitle>
                  <Badge variant="secondary">{tenant.plan}</Badge>
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
              </CardContent>
            </Card>
          ))}
          {tenants && tenants.length === 0 && (
            <div className="col-span-full p-12 text-center border rounded-md text-muted-foreground bg-muted/10">
              {t("pages.platformAdmin.empty")}
            </div>
          )}
        </div>
      )}

      <TenantFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

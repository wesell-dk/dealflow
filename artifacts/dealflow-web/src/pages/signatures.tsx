import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Link } from "wouter";
import { useListSignaturePackages, useSendSignatureReminder } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { PenTool, Bell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyStateCard } from "@/components/patterns/empty-state-card";
import { SignatureStatusBadge } from "@/components/patterns/status-badges";

export default function Signatures() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string>("in_progress");
  const { data: packages, isLoading } = useListSignaturePackages(
    status === "all" ? {} : { status }
  );

  const remind = useSendSignatureReminder();
  const { toast } = useToast();

  const handleRemind = (id: string) => {
    remind.mutate({ id }, {
      onSuccess: () => {
        toast({ title: t("pages.signatures.reminderSent") });
      },
      onError: () => {
        toast({ title: t("pages.signatures.reminderFailed"), variant: "destructive" });
      }
    });
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        icon={PenTool}
        title={t("pages.signatures.title")}
        subtitle={t("pages.signatures.subtitle")}
      />

      <div className="flex gap-2 mb-4">
        <Button variant={status === "in_progress" ? "default" : "outline"} onClick={() => setStatus("in_progress")} size="sm">
          {t("pages.signatures.tabInProgress")}
        </Button>
        <Button variant={status === "completed" ? "default" : "outline"} onClick={() => setStatus("completed")} size="sm">
          {t("pages.signatures.tabCompleted")}
        </Button>
        <Button variant={status === "all" ? "default" : "outline"} onClick={() => setStatus("all")} size="sm">
          {t("pages.signatures.tabAll")}
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !packages || packages.length === 0 ? (
        <EmptyStateCard
          icon={PenTool}
          title={t("pages.signatures.emptyTitle")}
          body={t("pages.signatures.emptyBody")}
          hint={t("pages.signatures.emptyHint")}
        />
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.title")}</TableHead>
                <TableHead>{t("common.deal")}</TableHead>
                <TableHead>{t("common.status")}</TableHead>
                <TableHead className="w-[200px]">{t("common.progress")}</TableHead>
                <TableHead>{t("common.deadline")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {packages?.map((pkg) => (
                <TableRow key={pkg.id}>
                  <TableCell className="font-medium">
                    <Link href={`/signatures/${pkg.id}`} className="hover:underline">
                      {pkg.title}
                    </Link>
                  </TableCell>
                  <TableCell>{pkg.dealName}</TableCell>
                  <TableCell><SignatureStatusBadge status={pkg.status} /></TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{pkg.signedCount} / {pkg.totalSigners} {t("pages.signatures.signed")}</span>
                      </div>
                      <Progress value={(pkg.signedCount / pkg.totalSigners) * 100} className="h-2" />
                    </div>
                  </TableCell>
                  <TableCell>
                    {pkg.deadline ? new Date(pkg.deadline).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {pkg.status === "in_progress" && (
                      <Button variant="ghost" size="sm" onClick={() => handleRemind(pkg.id)} disabled={remind.isPending}>
                        <Bell className="h-4 w-4 mr-2" />
                        {t("pages.signatures.remind")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

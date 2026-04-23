import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Link } from "wouter";
import { useListSignaturePackages, useRemindSigner } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { PenTool, Bell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Signatures() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string>("in_progress");
  const { data: packages, isLoading } = useListSignaturePackages(
    status === "all" ? {} : { status }
  );
  
  const remind = useRemindSigner();
  const { toast } = useToast();

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;

  const handleRemind = (id: string) => {
    remind.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Reminder sent to pending signers" });
      },
      onError: () => {
        toast({ title: "Failed to send reminder", variant: "destructive" });
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.signatures.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.signatures.subtitle")}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant={status === "in_progress" ? "default" : "outline"} onClick={() => setStatus("in_progress")} size="sm">
          In Progress
        </Button>
        <Button variant={status === "completed" ? "default" : "outline"} onClick={() => setStatus("completed")} size="sm">
          Completed
        </Button>
        <Button variant={status === "all" ? "default" : "outline"} onClick={() => setStatus("all")} size="sm">
          All
        </Button>
      </div>

      {(!packages || packages.length === 0) ? (
        <Card className="p-12 text-center flex flex-col items-center justify-center text-muted-foreground">
          <PenTool className="h-12 w-12 mb-4 opacity-20" />
          <p>No signature packages found.</p>
        </Card>
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
                  <TableCell>
                    <Badge variant={pkg.status === "completed" ? "secondary" : "outline"}>
                      {pkg.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{pkg.signedCount} of {pkg.totalSigners} signed</span>
                      </div>
                      <Progress value={(pkg.signedCount / pkg.totalSigners) * 100} className="h-2" />
                    </div>
                  </TableCell>
                  <TableCell>
                    {pkg.deadline ? new Date(pkg.deadline).toLocaleDateString() : "None"}
                  </TableCell>
                  <TableCell className="text-right">
                    {pkg.status === "in_progress" && (
                      <Button variant="ghost" size="sm" onClick={() => handleRemind(pkg.id)} disabled={remind.isPending}>
                        <Bell className="h-4 w-4 mr-2" />
                        Remind
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

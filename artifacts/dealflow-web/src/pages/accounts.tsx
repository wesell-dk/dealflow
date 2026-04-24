import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useListAccounts } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Building, Plus } from "lucide-react";
import { AccountFormDialog } from "@/components/accounts/account-form-dialog";

export default function Accounts() {
  const { t } = useTranslation();
  const { data: accounts, isLoading } = useListAccounts();
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.accounts.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("pages.accounts.subtitle")}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="accounts-new-button">
          <Plus className="h-4 w-4 mr-1" />
          Kunde anlegen
        </Button>
      </div>

      {!accounts?.length ? (
        <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-muted/20">
          <Building className="h-10 w-10 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">Noch keine Kunden</h2>
          <p className="text-muted-foreground mb-4">{t("pages.accounts.empty")}</p>
          <Button onClick={() => setCreateOpen(true)} data-testid="accounts-empty-create">
            <Plus className="h-4 w-4 mr-1" />
            Ersten Kunden anlegen
          </Button>
        </div>
      ) : (
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.industry")}</TableHead>
                <TableHead>{t("common.country")}</TableHead>
                <TableHead>{t("pages.accounts.healthScore")}</TableHead>
                <TableHead>{t("pages.home.openDeals")}</TableHead>
                <TableHead>{t("pages.accounts.totalValue")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => {
                const healthColor = account.healthScore < 60 ? "bg-red-500" : account.healthScore <= 75 ? "bg-amber-400" : "bg-green-500";
                return (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">
                      <Link href={`/accounts/${account.id}`} className="hover:underline">
                        {account.name}
                      </Link>
                    </TableCell>
                    <TableCell>{account.industry}</TableCell>
                    <TableCell>{account.country}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="w-8 text-right text-xs font-medium">{account.healthScore}</span>
                        <div className="h-2 w-24 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${healthColor}`} style={{ width: `${account.healthScore}%` }} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{account.openDeals}</TableCell>
                    <TableCell>{account.totalValue.toLocaleString()}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AccountFormDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}

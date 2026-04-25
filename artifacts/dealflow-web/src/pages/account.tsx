import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAccount,
  useUpdateAccount,
  useListUsers,
  getGetAccountQueryKey,
  getListAccountsQueryKey,
  type AccountPatch,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Building, Phone, Mail, UserCircle2, Plus } from "lucide-react";
import { DealFormDialog } from "@/components/deals/deal-form-dialog";
import { InlineEditField } from "@/components/patterns/inline-edit-field";
import { ActivityTimeline } from "@/components/patterns/activity-timeline";
import { ExternalContractsCard } from "@/components/external-contracts/external-contracts-card";
import { useTrackRecent } from "@/hooks/use-recents";
import { useToast } from "@/hooks/use-toast";

export default function Account() {
  const [, params] = useRoute("/accounts/:id");
  const id = params?.id || "";
  const [dealOpen, setDealOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: account, isLoading } = useGetAccount(id);
  const { data: users = [] } = useListUsers();
  const updateAccount = useUpdateAccount();

  useTrackRecent(account ? { kind: "account", id: account.id, label: account.name, href: `/accounts/${account.id}` } : null);

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  }

  if (!account) {
    return <div className="p-8">Account nicht gefunden.</div>;
  }

  const ownerName = users.find((u) => u.id === account.ownerId)?.name;

  async function patch(p: AccountPatch) {
    try {
      await updateAccount.mutateAsync({ id, data: p });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetAccountQueryKey(id) }),
        qc.invalidateQueries({ queryKey: getListAccountsQueryKey() }),
      ]);
      toast({ title: "Gespeichert" });
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "", variant: "destructive" });
      throw e;
    }
  }

  const healthColor = account.healthScore < 60 ? "bg-red-500" : account.healthScore <= 75 ? "bg-amber-400" : "bg-green-500";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 border-b pb-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">
              <InlineEditField
                ariaLabel="Account-Name"
                value={account.name}
                onSubmit={(v) => patch({ name: v })}
                testId="account-name-edit"
                className="text-3xl font-bold"
              />
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Building className="h-3.5 w-3.5" />
                <InlineEditField ariaLabel="Branche" value={account.industry} onSubmit={(v) => patch({ industry: v })} testId="account-industry-edit" />
              </span>
              <span aria-hidden>•</span>
              <InlineEditField ariaLabel="Land" value={account.country} onSubmit={(v) => patch({ country: v })} testId="account-country-edit" />
              <span aria-hidden>•</span>
              <span>Owner: <InlineEditField
                ariaLabel="Owner"
                kind="select"
                options={users.map((u) => ({ value: u.id, label: u.name }))}
                value={account.ownerId ?? ""}
                display={<span className={ownerName ? "" : "text-muted-foreground italic"}>{ownerName ?? "Nicht zugewiesen"}</span>}
                onSubmit={(v) => patch({ ownerId: v || null })}
                testId="account-owner-edit"
              /></span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <Button size="sm" onClick={() => setDealOpen(true)} data-testid="account-new-deal-button">
              <Plus className="h-4 w-4 mr-1" /> Deal anlegen
            </Button>
            <div className="text-sm font-medium text-muted-foreground">Health Score</div>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold tabular-nums">{account.healthScore}</span>
              <div className="h-3 w-32 bg-muted rounded-full overflow-hidden">
                <div className={`h-full ${healthColor}`} style={{ width: `${account.healthScore}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-6 mt-2">
          <div>
            <div className="text-sm text-muted-foreground">Offene Deals</div>
            <div className="text-xl font-semibold tabular-nums">{account.openDeals}</div>
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Volumen</div>
            <div className="text-xl font-semibold tabular-nums">{account.totalValue.toLocaleString("de-DE")}</div>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Kontakte</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {account.contacts?.map((contact) => (
                  <div key={contact.id} className="flex flex-col gap-2 p-4 border rounded-lg">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <UserCircle2 className="h-8 w-8 text-muted-foreground" />
                        <div>
                          <div className="font-medium">{contact.name}</div>
                          <div className="text-sm text-muted-foreground">{contact.role}</div>
                        </div>
                      </div>
                      {contact.isDecisionMaker && <Badge variant="secondary">Entscheider</Badge>}
                    </div>
                    <div className="flex gap-4 text-sm text-muted-foreground mt-2">
                      <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {contact.email}</span>
                      {contact.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {contact.phone}</span>}
                    </div>
                  </div>
                ))}
                {!account.contacts?.length && (
                  <div className="text-center py-6 text-muted-foreground text-sm">Noch keine Kontakte hinterlegt.</div>
                )}
              </div>
            </CardContent>
          </Card>

          <ExternalContractsCard accountId={id} />

          <Card>
            <CardHeader><CardTitle>Deals</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3">
                {account.deals?.map((deal) => (
                  <div key={deal.id} className="flex flex-col gap-2 p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-start justify-between">
                      <Link href={`/deals/${deal.id}`} className="font-medium hover:underline text-primary">{deal.name}</Link>
                      <Badge variant="outline">{deal.stage}</Badge>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="font-semibold tabular-nums">{deal.value.toLocaleString("de-DE")} {deal.currency}</span>
                      <span className="text-muted-foreground tabular-nums">{deal.probability}% Wahrscheinlichkeit</span>
                    </div>
                  </div>
                ))}
                {!account.deals?.length && (
                  <div className="text-center py-6 text-muted-foreground text-sm">Noch keine Deals.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardHeader><CardTitle>Aktivität</CardTitle></CardHeader>
            <CardContent>
              <ActivityTimeline entityType="account" entityId={id} />
            </CardContent>
          </Card>
        </div>
      </div>

      <DealFormDialog open={dealOpen} onOpenChange={setDealOpen} defaultAccountId={account.id} />
    </div>
  );
}

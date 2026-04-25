import { useState } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDeal,
  useUpdateDeal,
  useGetDealPipeline,
  getGetDealQueryKey,
  getListDealsQueryKey,
  getGetDealPipelineQueryKey,
  type DealPatch,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { QuoteWizard } from "@/components/quote-wizard";
import { InlineEditField } from "@/components/patterns/inline-edit-field";
import { ActivityTimeline } from "@/components/patterns/activity-timeline";
import { useTrackRecent } from "@/hooks/use-recents";
import { useToast } from "@/hooks/use-toast";
import { AiPromptPanel } from "@/components/copilot/ai-prompt-panel";

export default function Deal() {
  const params = useParams();
  const id = params.id as string;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: deal, isLoading } = useGetDeal(id);
  const { data: pipeline } = useGetDealPipeline();
  const updateDeal = useUpdateDeal();
  const [wizardOpen, setWizardOpen] = useState(false);

  useTrackRecent(deal ? { kind: "deal", id: deal.id, label: deal.name, href: `/deals/${deal.id}` } : null);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!deal) return <div className="p-8">Deal nicht gefunden.</div>;

  const stages = (pipeline?.stages ?? []).map((s) => ({ value: s.stage, label: s.label }));
  const stageLabel = stages.find((s) => s.value === deal.stage)?.label ?? deal.stage;

  async function patch(p: DealPatch) {
    try {
      await updateDeal.mutateAsync({ id, data: p });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetDealQueryKey(id) }),
        qc.invalidateQueries({ queryKey: getListDealsQueryKey() }),
        qc.invalidateQueries({ queryKey: getGetDealPipelineQueryKey() }),
      ]);
      toast({ title: "Gespeichert" });
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "", variant: "destructive" });
      throw e;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 border-b pb-4">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight">
            <InlineEditField
              ariaLabel="Deal-Name"
              value={deal.name}
              onSubmit={(v) => patch({ name: v })}
              testId="deal-name-edit"
              className="text-3xl font-bold"
            />
          </h1>
          <div className="flex items-center gap-2">
            <Button onClick={() => setWizardOpen(true)} data-testid="deal-new-quote-button">
              <Plus className="h-4 w-4 mr-1" /> Neues Angebot
            </Button>
            <Badge variant={deal.riskLevel === "high" ? "destructive" : "secondary"}>
              Risiko: {deal.riskLevel}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{deal.accountName}</span>
          <span aria-hidden>•</span>
          <InlineEditField
            ariaLabel="Stage"
            kind="select"
            options={stages}
            value={deal.stage}
            display={<Badge variant="outline">{stageLabel}</Badge>}
            onSubmit={(v) => patch({ stage: v })}
            testId="deal-stage-edit"
          />
          <span aria-hidden>•</span>
          <InlineEditField
            ariaLabel="Wert"
            kind="currency"
            value={deal.value}
            display={`${deal.value.toLocaleString("de-DE")} ${deal.currency}`}
            onSubmit={(v) => patch({ value: Number(v) })}
            testId="deal-value-edit"
          />
          <span aria-hidden>•</span>
          <InlineEditField
            ariaLabel="Wahrscheinlichkeit"
            kind="number"
            value={deal.probability}
            display={`${deal.probability}% Wahrscheinlichkeit`}
            onSubmit={(v) => patch({ probability: Number(v) })}
            testId="deal-prob-edit"
          />
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <AiPromptPanel mode="deal.summary" entityId={id} />
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Übersicht</TabsTrigger>
              <TabsTrigger value="quotes">Angebote ({deal.quotes.length})</TabsTrigger>
              <TabsTrigger value="contracts">Verträge ({deal.contracts.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="mt-4">
              <Card>
                <CardHeader><CardTitle>Details</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid gap-3 text-sm">
                    <div>
                      <span className="font-medium mr-2">Owner:</span>
                      <span className="text-muted-foreground">{deal.ownerName}</span>
                    </div>
                    <div>
                      <span className="font-medium mr-2">Close-Datum:</span>
                      <InlineEditField
                        ariaLabel="Close-Datum"
                        kind="date"
                        value={deal.expectedCloseDate?.slice(0, 10) ?? ""}
                        display={new Date(deal.expectedCloseDate).toLocaleDateString("de-DE")}
                        onSubmit={(v) => patch({ expectedCloseDate: v })}
                        testId="deal-close-edit"
                      />
                    </div>
                    <div>
                      <span className="font-medium mr-2">Nächster Schritt:</span>
                      <InlineEditField
                        ariaLabel="Nächster Schritt"
                        value={deal.nextStep ?? ""}
                        emptyText="—"
                        onSubmit={(v) => patch({ nextStep: v })}
                        testId="deal-next-edit"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="quotes" className="mt-4">
              <Card>
                <CardHeader><CardTitle>Angebote</CardTitle></CardHeader>
                <CardContent>
                  {deal.quotes.length === 0 && <div className="text-center text-sm text-muted-foreground py-4">Noch keine Angebote.</div>}
                  {deal.quotes.map((q) => (
                    <div key={q.id} className="py-2 border-b last:border-0 flex justify-between text-sm">
                      <span>{q.number}</span>
                      <Badge variant="outline">{q.status}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="contracts" className="mt-4">
              <Card>
                <CardHeader><CardTitle>Verträge</CardTitle></CardHeader>
                <CardContent>
                  {deal.contracts.length === 0 && <div className="text-center text-sm text-muted-foreground py-4">Noch keine Verträge.</div>}
                  {deal.contracts.map((c) => (
                    <div key={c.id} className="py-2 border-b last:border-0 flex justify-between text-sm">
                      <span>{c.title}</span>
                      <Badge variant="outline">{c.status}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <div className="lg:col-span-1">
          <Card>
            <CardHeader><CardTitle>Aktivität</CardTitle></CardHeader>
            <CardContent>
              <ActivityTimeline entityType="deal" entityId={id} />
            </CardContent>
          </Card>
        </div>
      </div>

      <QuoteWizard open={wizardOpen} onOpenChange={setWizardOpen} initialDealId={id} />
    </div>
  );
}

import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetNegotiation,
  getGetNegotiationQueryKey,
  useCreateCounterproposal,
  useAddCustomerReaction,
  useCreateVersionFromReaction,
  useRequestApprovalFromReaction,
  type CustomerReaction,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  MessageSquare, AlertTriangle, RefreshCw, Check, Clock, User,
  TrendingDown, TrendingUp, Minus, FileSignature, ShieldAlert, FilePlus,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type ReactionTypeKey = "question" | "objection" | "counterproposal" | "acceptance" | "partial" | "price_rejected" | "clause_rejected" | "term_change" | "deferred";

const reactionBadgeVariant: Record<string, { label: string; className: string }> = {
  question:         { label: "Frage",             className: "bg-blue-100 text-blue-700 border-blue-200" },
  objection:        { label: "Einwand",           className: "bg-orange-100 text-orange-700 border-orange-200" },
  counterproposal:  { label: "Gegenvorschlag",    className: "bg-purple-100 text-purple-700 border-purple-200" },
  acceptance:       { label: "Akzeptiert",        className: "bg-green-100 text-green-700 border-green-200" },
  partial:          { label: "Teilweise",         className: "bg-yellow-100 text-yellow-700 border-yellow-200" },
  price_rejected:   { label: "Preis abgelehnt",   className: "bg-rose-100 text-rose-700 border-rose-200" },
  clause_rejected:  { label: "Klausel abgelehnt", className: "bg-red-100 text-red-700 border-red-200" },
  term_change:      { label: "Laufzeit-Änderung", className: "bg-indigo-100 text-indigo-700 border-indigo-200" },
  deferred:         { label: "Vertagt",           className: "bg-gray-100 text-gray-700 border-gray-200" },
};

const followUpLabel: Record<string, string> = {
  new_quote_version: "Neue Angebotsversion",
  discount_approval: "Discount-Approval",
  contract_amendment: "Vertragsänderung",
  clause_change: "Klausel-Wechsel",
};

function formatCurrency(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
}

function signed(n: number | null | undefined, suffix = "") {
  if (n == null) return "—";
  const s = n > 0 ? `+${n}` : `${n}`;
  return `${s}${suffix}`;
}

export default function NegotiationWorkspace() {
  const [, params] = useRoute("/negotiations/:id");
  const id = params?.id as string;
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: neg, isLoading } = useGetNegotiation(id ?? "");

  const addReaction = useAddCustomerReaction();
  const counterprop = useCreateCounterproposal();
  const createVersion = useCreateVersionFromReaction();
  const requestApproval = useRequestApprovalFromReaction();

  const [mode, setMode] = useState<"reaction" | "counterproposal">("counterproposal");

  // Reaction form state
  const [type, setType] = useState<ReactionTypeKey>("question");
  const [topic, setTopic] = useState("");
  const [summary, setSummary] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState<string>("medium");

  // Structured counterproposal state
  const [priceDeltaPct, setPriceDeltaPct] = useState("");
  const [termMonthsDelta, setTermMonthsDelta] = useState("");
  const [paymentTermsDeltaDays, setPaymentTermsDeltaDays] = useState("");
  const [requestedClauseVariantId, setRequestedClauseVariantId] = useState("");
  const [createNewVersion, setCreateNewVersion] = useState(false);

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!neg) return <div className="p-8">Verhandlung nicht gefunden</div>;

  const impactsByReaction = new Map(neg.impacts.map(i => [i.reactionId, i]));
  const baseline = neg.baseline ?? null;

  const resetForm = () => {
    setTopic(""); setSummary(""); setSource("");
    setPriceDeltaPct(""); setTermMonthsDelta(""); setPaymentTermsDeltaDays("");
    setRequestedClauseVariantId(""); setCreateNewVersion(false);
  };

  const invalidate = () => qc.invalidateQueries({ queryKey: getGetNegotiationQueryKey(id) });

  const handleSubmitReaction = (e: React.FormEvent) => {
    e.preventDefault();
    addReaction.mutate(
      { id, data: { type, topic, summary, source, priority,
        ...(priceDeltaPct ? { priceDeltaPct: Number(priceDeltaPct) } : {}),
        ...(termMonthsDelta ? { termMonthsDelta: Number(termMonthsDelta) } : {}),
        ...(paymentTermsDeltaDays ? { paymentTermsDeltaDays: Number(paymentTermsDeltaDays) } : {}),
        ...(requestedClauseVariantId ? { requestedClauseVariantId } : {}),
      } },
      {
        onSuccess: () => { toast({ title: "Reaktion erfasst" }); invalidate(); resetForm(); },
        onError: () => toast({ title: "Fehler beim Erfassen", variant: "destructive" }),
      },
    );
  };

  const handleSubmitCounterproposal = (e: React.FormEvent) => {
    e.preventDefault();
    counterprop.mutate(
      { id, data: {
        topic, summary, source, priority,
        ...(priceDeltaPct ? { priceDeltaPct: Number(priceDeltaPct) } : {}),
        ...(termMonthsDelta ? { termMonthsDelta: Number(termMonthsDelta) } : {}),
        ...(paymentTermsDeltaDays ? { paymentTermsDeltaDays: Number(paymentTermsDeltaDays) } : {}),
        ...(requestedClauseVariantId ? { requestedClauseVariantId } : {}),
        createNewVersion,
      } },
      {
        onSuccess: (r: CustomerReaction) => {
          toast({ title: r.linkedQuoteVersionId ? "Gegenvorschlag + neue Version erstellt" : "Gegenvorschlag erfasst" });
          invalidate(); resetForm();
          qc.invalidateQueries({ predicate: q => String(q.queryKey[0] ?? "").includes("Quote") });
        },
        onError: () => toast({ title: "Fehler beim Speichern", variant: "destructive" }),
      },
    );
  };

  const handleCreateVersion = (reactionId: string) => {
    createVersion.mutate({ id, reactionId }, {
      onSuccess: () => {
        toast({ title: "Neue Angebotsversion erstellt" });
        invalidate();
        qc.invalidateQueries({ predicate: q => String(q.queryKey[0] ?? "").includes("Quote") });
      },
      onError: () => toast({ title: "Version konnte nicht erstellt werden", variant: "destructive" }),
    });
  };

  const handleRequestApproval = (reactionId: string) => {
    requestApproval.mutate({ id, reactionId, data: {} }, {
      onSuccess: (result) => {
        toast({ title: "Approval angefordert", description: "Weiterleitung zur Approval-Hub..." });
        invalidate();
        qc.invalidateQueries({ predicate: q => String(q.queryKey[0] ?? "").includes("Approval") });
        setLocation(`/approvals?highlight=${encodeURIComponent(result.approvalId)}`);
      },
      onError: () => toast({ title: "Approval konnte nicht angefordert werden", variant: "destructive" }),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{neg.dealName}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
            <Badge variant={neg.status === "active" ? "default" : "secondary"}>{neg.status === "active" ? "Aktiv" : neg.status}</Badge>
            <Badge variant="outline">Runde {neg.round}</Badge>
            <Badge variant={neg.riskLevel === "high" ? "destructive" : "outline"}>Risiko: {neg.riskLevel}</Badge>
            {baseline && (
              <span className="text-xs">
                Basis: {formatCurrency(baseline.totalAmount)} · Rabatt {baseline.discountPct}% · Marge {baseline.marginPct}%
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        {/* LEFT: Timeline */}
        <div className="lg:col-span-3">
          <Card className="sticky top-6">
            <CardHeader><CardTitle className="text-base">Timeline</CardTitle></CardHeader>
            <CardContent>
              {(!neg.timeline || neg.timeline.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-4">Keine Events.</p>
              ) : (
                <div className="space-y-4 border-l-2 border-muted ml-2 pl-3">
                  {neg.timeline.map((event) => (
                    <div key={event.id} className="relative">
                      <div className="absolute w-2.5 h-2.5 bg-primary rounded-full -left-[17px] top-1.5" />
                      <div className="text-xs font-medium">{event.title}</div>
                      <div className="text-[11px] text-muted-foreground">{format(new Date(event.at), "dd.MM.yyyy HH:mm")}</div>
                      {event.description && <p className="text-xs text-muted-foreground mt-1">{event.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* CENTER: Reactions with impact */}
        <div className="lg:col-span-6">
          <Card>
            <CardHeader><CardTitle>Kundenreaktionen &amp; Impact</CardTitle></CardHeader>
            <CardContent>
              {(!neg.reactions || neg.reactions.length === 0) ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p>Noch keine Reaktionen erfasst.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {neg.reactions.map((r) => {
                    const impact = impactsByReaction.get(r.id);
                    const badge = reactionBadgeVariant[r.type] ?? { label: r.type, className: "" };
                    let Icon = MessageSquare;
                    if (r.type === "objection" || r.type === "clause_rejected") Icon = AlertTriangle;
                    else if (r.type === "counterproposal" || r.type === "partial" || r.type === "term_change") Icon = RefreshCw;
                    else if (r.type === "acceptance") Icon = Check;

                    const TrendIcon = impact?.riskTrend === "up" ? TrendingUp
                      : impact?.riskTrend === "down" ? TrendingDown : Minus;
                    const trendColor = impact?.riskTrend === "up" ? "text-red-600"
                      : impact?.riskTrend === "down" ? "text-green-600" : "text-muted-foreground";

                    return (
                      <div key={r.id} className="rounded-lg border p-4 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex gap-3">
                            <div className="mt-1 bg-muted p-2 rounded-full h-fit"><Icon className="h-4 w-4" /></div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                                <h4 className="font-semibold text-base">{r.topic}</h4>
                              </div>
                              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><User className="h-3 w-3"/> {r.source}</span>
                                <span>·</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3"/> {formatDistanceToNow(new Date(r.createdAt))}</span>
                              </div>
                            </div>
                          </div>
                          <Badge variant={r.priority === "high" ? "destructive" : "secondary"}>{r.priority}</Badge>
                        </div>

                        <p className="text-sm">{r.summary}</p>

                        {impact && (
                          (impact.priceDeltaPct != null || impact.termMonthsDelta != null ||
                           impact.paymentTermsDeltaDays != null || impact.requestedClauseVariantId ||
                           impact.followUps.length > 0) && (
                            <div className="rounded-md bg-muted/40 border p-3 space-y-2">
                              <div className="flex items-center gap-2 text-sm font-semibold">
                                <TrendIcon className={`h-4 w-4 ${trendColor}`} />
                                <span>Impact-Analyse</span>
                                <span className={`text-xs ${trendColor}`}>Risiko {impact.riskTrend === "up" ? "↑" : impact.riskTrend === "down" ? "↓" : "="}</span>
                              </div>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                {impact.priceDeltaPct != null && (
                                  <div>
                                    <div className="text-muted-foreground">Preis</div>
                                    <div className="font-semibold">{signed(impact.priceDeltaPct, "%")}</div>
                                    {impact.newTotalAmount != null && (
                                      <div className="text-muted-foreground">→ {formatCurrency(impact.newTotalAmount)}</div>
                                    )}
                                  </div>
                                )}
                                {impact.newDiscountPct != null && (
                                  <div>
                                    <div className="text-muted-foreground">Neuer Rabatt</div>
                                    <div className="font-semibold">{impact.newDiscountPct}%</div>
                                  </div>
                                )}
                                {impact.newMarginPct != null && (
                                  <div>
                                    <div className="text-muted-foreground">Marge</div>
                                    <div className="font-semibold">{impact.newMarginPct}%</div>
                                    {impact.marginDeltaPct != null && (
                                      <div className="text-muted-foreground">{signed(impact.marginDeltaPct, "pp")}</div>
                                    )}
                                  </div>
                                )}
                                {impact.termMonthsDelta != null && (
                                  <div>
                                    <div className="text-muted-foreground">Laufzeit</div>
                                    <div className="font-semibold">{signed(impact.termMonthsDelta, " Mon.")}</div>
                                  </div>
                                )}
                                {impact.paymentTermsDeltaDays != null && (
                                  <div>
                                    <div className="text-muted-foreground">Zahlungsziel</div>
                                    <div className="font-semibold">{signed(impact.paymentTermsDeltaDays, " Tage")}</div>
                                  </div>
                                )}
                                {impact.requestedClauseVariantId && (
                                  <div>
                                    <div className="text-muted-foreground">Klausel-Wechsel</div>
                                    <div className="font-semibold">{impact.requestedClauseVariantId}</div>
                                  </div>
                                )}
                              </div>

                              {impact.followUps.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 pt-1">
                                  {impact.followUps.map(f => (
                                    <Badge key={f} variant="secondary" className="text-[11px]">
                                      {followUpLabel[f] ?? f}
                                    </Badge>
                                  ))}
                                </div>
                              )}

                              {impact.approvalsTriggered.length > 0 && (
                                <div className="flex items-start gap-2 rounded bg-orange-50 border border-orange-200 p-2 text-xs text-orange-900">
                                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                                  <div>
                                    {impact.approvalsTriggered.map((a, i) => (
                                      <div key={i}><strong>{a.type}:</strong> {a.reason}</div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              <div className="flex flex-wrap gap-2 pt-1">
                                {impact.priceDeltaPct != null && !impact.linkedQuoteVersionId && (
                                  <Button size="sm" variant="outline" disabled={createVersion.isPending}
                                    onClick={() => handleCreateVersion(r.id)}>
                                    <FilePlus className="h-3.5 w-3.5 mr-1" /> Neue Angebotsversion
                                  </Button>
                                )}
                                {impact.linkedQuoteVersionId && (
                                  <Badge variant="outline" className="text-[11px]">
                                    <FileSignature className="h-3 w-3 mr-1" /> Version {impact.linkedQuoteVersionId}
                                  </Badge>
                                )}
                                {impact.approvalsTriggered.length > 0 && !impact.linkedApprovalId && (
                                  <Button size="sm" variant="outline" disabled={requestApproval.isPending}
                                    onClick={() => handleRequestApproval(r.id)}>
                                    <ShieldAlert className="h-3.5 w-3.5 mr-1" /> Approval anfordern
                                  </Button>
                                )}
                                {impact.linkedApprovalId && (
                                  <Badge variant="outline" className="text-[11px]">
                                    <ShieldAlert className="h-3 w-3 mr-1" /> Approval {impact.linkedApprovalId}
                                  </Badge>
                                )}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Action panel */}
        <div className="lg:col-span-3">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle className="text-base">Reaktion erfassen</CardTitle>
              <div className="flex gap-2 mt-2">
                <Button size="sm" variant={mode === "counterproposal" ? "default" : "outline"}
                  onClick={() => setMode("counterproposal")}>Gegenvorschlag</Button>
                <Button size="sm" variant={mode === "reaction" ? "default" : "outline"}
                  onClick={() => setMode("reaction")}>Andere Reaktion</Button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={mode === "counterproposal" ? handleSubmitCounterproposal : handleSubmitReaction} className="space-y-3">
                {mode === "reaction" && (
                  <div className="space-y-2">
                    <Label>Typ</Label>
                    <Select value={type} onValueChange={(v) => setType(v as ReactionTypeKey)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="question">Frage</SelectItem>
                        <SelectItem value="objection">Einwand</SelectItem>
                        <SelectItem value="partial">Teilweise</SelectItem>
                        <SelectItem value="clause_rejected">Klausel abgelehnt</SelectItem>
                        <SelectItem value="term_change">Laufzeit-Änderung</SelectItem>
                        <SelectItem value="acceptance">Akzeptiert</SelectItem>
                        <SelectItem value="deferred">Vertagt</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Thema</Label>
                  <Input value={topic} onChange={e => setTopic(e.target.value)} required placeholder="z. B. Haftungsobergrenze" />
                </div>
                <div className="space-y-2">
                  <Label>Zusammenfassung</Label>
                  <Textarea value={summary} onChange={e => setSummary(e.target.value)} required rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>Quelle</Label>
                  <Input value={source} onChange={e => setSource(e.target.value)} required placeholder="z. B. E-Mail CFO" />
                </div>
                <div className="space-y-2">
                  <Label>Priorität</Label>
                  <Select value={priority} onValueChange={setPriority}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Niedrig</SelectItem>
                      <SelectItem value="medium">Mittel</SelectItem>
                      <SelectItem value="high">Hoch</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="border-t pt-3 space-y-2">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Strukturierte Forderung</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Preis Δ %</Label>
                      <Input type="number" step="0.1" value={priceDeltaPct} onChange={e => setPriceDeltaPct(e.target.value)} placeholder="-7" />
                    </div>
                    <div>
                      <Label className="text-xs">Laufzeit Δ (Mon.)</Label>
                      <Input type="number" value={termMonthsDelta} onChange={e => setTermMonthsDelta(e.target.value)} placeholder="12" />
                    </div>
                    <div>
                      <Label className="text-xs">Zahlungsziel Δ (Tage)</Label>
                      <Input type="number" value={paymentTermsDeltaDays} onChange={e => setPaymentTermsDeltaDays(e.target.value)} placeholder="30" />
                    </div>
                    <div>
                      <Label className="text-xs">Klausel-Variante</Label>
                      <Input value={requestedClauseVariantId} onChange={e => setRequestedClauseVariantId(e.target.value)} placeholder="cv_xxx" />
                    </div>
                  </div>
                  {mode === "counterproposal" && (
                    <label className="flex items-center gap-2 text-xs mt-2">
                      <input type="checkbox" checked={createNewVersion} onChange={e => setCreateNewVersion(e.target.checked)} />
                      Neue Angebotsversion direkt erstellen
                    </label>
                  )}
                </div>

                <Button type="submit" className="w-full"
                  disabled={(mode === "counterproposal" ? counterprop.isPending : addReaction.isPending) || !topic || !summary || !source}>
                  {(mode === "counterproposal" ? counterprop.isPending : addReaction.isPending) ? "Speichern..." : "Speichern"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

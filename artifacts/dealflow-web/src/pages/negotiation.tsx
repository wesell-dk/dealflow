import { useState } from "react";
import { useRoute } from "wouter";
import { useGetNegotiation, getGetNegotiationQueryKey, useAddCustomerReaction } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { MessageSquare, AlertTriangle, RefreshCw, Check, Clock, User } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function NegotiationWorkspace() {
  const [, params] = useRoute("/negotiations/:id");
  const id = params?.id as string;
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: neg, isLoading } = useGetNegotiation(id ?? "");
  
  // Add customer reaction mutation
  const addReaction = useAddCustomerReaction();

  const [type, setType] = useState<string>("question");
  const [topic, setTopic] = useState("");
  const [summary, setSummary] = useState("");
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  const [impactPct, setImpactPct] = useState("");

  if (isLoading) return <div className="p-8"><Skeleton className="h-64 w-full" /></div>;
  if (!neg) return <div className="p-8">Negotiation not found</div>;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addReaction.mutate({
      id,
      data: {
        type,
        topic,
        summary,
        source,
        priority,
        ...(impactPct ? { impactPct: Number(impactPct) } : {})
      }
    }, {
      onSuccess: () => {
        toast({ title: "Reaction added successfully" });
        qc.invalidateQueries({ queryKey: getGetNegotiationQueryKey(id) });
        setTopic("");
        setSummary("");
        setSource("");
        setImpactPct("");
      },
      onError: () => {
        toast({ title: "Failed to add reaction", variant: "destructive" });
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{neg.dealName}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
            <Badge variant={neg.status === "active" ? "default" : "secondary"}>{neg.status}</Badge>
            <Badge variant="outline">Round {neg.round}</Badge>
            <Badge variant={neg.riskLevel === "high" ? "destructive" : "outline"}>Risk: {neg.riskLevel}</Badge>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer Reactions</CardTitle>
            </CardHeader>
            <CardContent>
              {(!neg.reactions || neg.reactions.length === 0) ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p>No reactions recorded yet.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {neg.reactions.map((r) => {
                    let Icon = MessageSquare;
                    let iconColor = "text-blue-500";
                    if (r.type === "objection") { Icon = AlertTriangle; iconColor = "text-orange-500"; }
                    else if (r.type === "counterproposal") { Icon = RefreshCw; iconColor = "text-purple-500"; }
                    else if (r.type === "acceptance") { Icon = Check; iconColor = "text-green-500"; }

                    return (
                      <div key={r.id} className="flex gap-4 border-b pb-4 last:border-0 last:pb-0">
                        <div className={`mt-1 bg-muted p-2 rounded-full h-fit`}>
                          <Icon className={`h-4 w-4 ${iconColor}`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <div>
                              <h4 className="font-semibold text-base">{r.topic}</h4>
                              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1"><User className="h-3 w-3"/> {r.source}</span>
                                <span>&bull;</span>
                                <span className="flex items-center gap-1"><Clock className="h-3 w-3"/> {formatDistanceToNow(new Date(r.createdAt))} ago</span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              {r.impactPct != null && <Badge variant="outline">{r.impactPct}% Impact</Badge>}
                              <Badge variant={r.priority === "high" ? "destructive" : "secondary"}>{r.priority}</Badge>
                            </div>
                          </div>
                          <p className="mt-3 text-sm">{r.summary}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              {(!neg.timeline || neg.timeline.length === 0) ? (
                <p className="text-sm text-muted-foreground text-center py-4">No timeline events.</p>
              ) : (
                <div className="space-y-4 border-l-2 border-muted ml-3 pl-4">
                  {neg.timeline.map((event) => (
                    <div key={event.id} className="relative">
                      <div className="absolute w-3 h-3 bg-primary rounded-full -left-[23px] top-1" />
                      <div className="text-sm">
                        <span className="font-medium">{event.title}</span>
                        <span className="text-muted-foreground ml-2 text-xs">{format(new Date(event.at), "MMM d, yyyy h:mm a")}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{event.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-4">
          <Card className="sticky top-6">
            <CardHeader>
              <CardTitle>Add Reaction</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="question">Question</SelectItem>
                      <SelectItem value="objection">Objection</SelectItem>
                      <SelectItem value="counterproposal">Counterproposal</SelectItem>
                      <SelectItem value="acceptance">Acceptance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Topic</Label>
                  <Input value={topic} onChange={e => setTopic(e.target.value)} required placeholder="e.g. Liability Cap" />
                </div>
                <div className="space-y-2">
                  <Label>Summary</Label>
                  <Textarea value={summary} onChange={e => setSummary(e.target.value)} required placeholder="Details of the reaction..." rows={4} />
                </div>
                <div className="space-y-2">
                  <Label>Source</Label>
                  <Input value={source} onChange={e => setSource(e.target.value)} required placeholder="e.g. Legal Counsel" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Priority</Label>
                    <Select value={priority} onValueChange={setPriority}>
                      <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Impact % (Optional)</Label>
                    <Input type="number" min="0" max="100" value={impactPct} onChange={e => setImpactPct(e.target.value)} placeholder="e.g. 5" />
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={addReaction.isPending || !topic || !summary || !source}>
                  {addReaction.isPending ? "Adding..." : "Add Reaction"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

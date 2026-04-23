import { Link } from "wouter";
import { useListCopilotInsights, useListCopilotThreads } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Sparkles, TrendingUp, MessageSquare } from "lucide-react";

export default function Copilot() {
  const { data: insights, isLoading: isLoadingInsights } = useListCopilotInsights?.() ?? { data: [], isLoading: false };
  const { data: threads, isLoading: isLoadingThreads } = useListCopilotThreads?.() ?? { data: [], isLoading: false };

  if (isLoadingInsights || isLoadingThreads) {
    return <div className="p-8 grid md:grid-cols-2 gap-6"><Skeleton className="h-[500px]" /><Skeleton className="h-[500px]" /></div>;
  }

  const getInsightIcon = (kind: string) => {
    switch(kind) {
      case 'Risk': return <AlertTriangle className="h-5 w-5 text-red-500" />;
      case 'NextAction': return <Sparkles className="h-5 w-5 text-amber-500" />;
      case 'Opportunity': return <TrendingUp className="h-5 w-5 text-green-500" />;
      default: return <Sparkles className="h-5 w-5 text-primary" />;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Copilot</h1>
          <p className="text-muted-foreground mt-1">Your intelligent assistant for commercial execution.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
          <h2 className="text-xl font-semibold px-1">Active Insights</h2>
          {!insights?.length ? (
            <Card className="bg-muted/30 border-dashed">
              <CardContent className="flex flex-col items-center text-center p-8">
                <Sparkles className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                <p className="text-muted-foreground">No active insights at the moment. You're all caught up!</p>
              </CardContent>
            </Card>
          ) : (
            insights.map((insight) => (
              <Card key={insight.id} className="overflow-hidden">
                <div className="flex flex-col">
                  <div className="p-4 pb-2 flex gap-3 items-start">
                    <div className="mt-1">{getInsightIcon(insight.kind)}</div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold leading-none tracking-tight">{insight.title}</h3>
                        <Badge variant={insight.severity === 'High' ? 'destructive' : insight.severity === 'Medium' ? 'secondary' : 'outline'}>
                          {insight.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-2">{insight.summary}</p>
                    </div>
                  </div>
                  
                  <div className="px-4 py-3 bg-muted/20 border-t flex flex-col gap-3 mt-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Related to:</span>
                      <Link href={`/deals/${insight.dealId}`}>
                        <Badge variant="outline" className="hover:bg-muted cursor-pointer transition-colors">
                          {insight.dealName}
                        </Badge>
                      </Link>
                    </div>
                    
                    {insight.suggestedAction && (
                      <div className="p-3 bg-primary/5 rounded-md border border-primary/10">
                        <div className="text-xs font-medium text-primary mb-1 uppercase tracking-wider">Suggested Action</div>
                        <div className="text-sm flex justify-between items-center">
                          <span>{insight.suggestedAction}</span>
                          <Button size="sm" variant="secondary">Apply</Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xl font-semibold">Recent Threads</h2>
            <Button variant="outline" size="sm">New Chat</Button>
          </div>
          
          {!threads?.length ? (
            <Card className="bg-muted/30 border-dashed">
              <CardContent className="flex flex-col items-center text-center p-8">
                <MessageSquare className="h-8 w-8 text-muted-foreground mb-3 opacity-50" />
                <p className="text-muted-foreground">Start a conversation to analyze deals or generate content.</p>
                <Button className="mt-4" variant="secondary">Start New Thread</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {threads.map((thread) => (
                <Card key={thread.id} className="hover:border-primary/50 transition-colors cursor-pointer group">
                  <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between space-y-0">
                    <div className="space-y-1.5">
                      <CardTitle className="text-base group-hover:text-primary transition-colors">{thread.title}</CardTitle>
                      <Badge variant="secondary" className="font-normal">{thread.scope}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(thread.updatedAt).toLocaleDateString()}
                    </div>
                  </CardHeader>
                  <CardContent className="p-4 pt-0 mt-2">
                    <CardDescription className="italic truncate border-l-2 pl-3">
                      "{thread.lastMessage}"
                    </CardDescription>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-3">
                      <MessageSquare className="h-3 w-3" />
                      <span>{thread.messageCount} messages</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

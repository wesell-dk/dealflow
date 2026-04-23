import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useListCopilotInsights,
  useListCopilotThreads,
  useListCopilotMessages,
  usePostCopilotMessage,
  useCreateCopilotThread,
  usePatchCopilotInsight,
  useExecuteCopilotInsight,
  getListCopilotMessagesQueryKey,
  getListCopilotThreadsQueryKey,
  getListCopilotInsightsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AlertTriangle, Sparkles, TrendingUp, MessageSquare, Send, Plus } from "lucide-react";

function ChatPanel({ threadId }: { threadId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: messages } = useListCopilotMessages(threadId);
  const post = usePostCopilotMessage();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const content = input.trim();
    if (!content || post.isPending) return;
    setInput("");
    await post.mutateAsync({ id: threadId, data: { content } });
    qc.invalidateQueries({ queryKey: getListCopilotMessagesQueryKey(threadId) });
    qc.invalidateQueries({ queryKey: getListCopilotThreadsQueryKey() });
  };

  return (
    <div className="flex flex-col h-[460px]">
      <ScrollArea className="flex-1 pr-3">
        <div ref={scrollRef} className="space-y-3">
          {(messages ?? []).map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}
          {(!messages || messages.length === 0) && (
            <p className="text-sm text-muted-foreground italic">{t("common.noData")}</p>
          )}
        </div>
      </ScrollArea>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 mt-3"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("pages.copilot.placeholder")}
        />
        <Button type="submit" size="icon" disabled={post.isPending || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

function NewThreadDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const create = useCreateCopilotThread();
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [open, setOpen] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    const r = await create.mutateAsync({ data: { title: title.trim(), scope: scope.trim() || undefined } });
    qc.invalidateQueries({ queryKey: getListCopilotThreadsQueryKey() });
    setTitle("");
    setScope("");
    setOpen(false);
    onCreated(r.id);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1" />
          {t("common.newThread")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.copilot.newThreadTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder={t("pages.copilot.newThreadTitle")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            placeholder={t("pages.copilot.newThreadTopic")}
            value={scope}
            onChange={(e) => setScope(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={submit} disabled={!title.trim() || create.isPending}>{t("common.create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const STATUSES = ["open", "acknowledged", "resolved", "dismissed"] as const;
type InsightStatus = (typeof STATUSES)[number];

export default function Copilot() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<InsightStatus>("open");
  const { data: insights } = useListCopilotInsights({ status: statusFilter });
  const { data: threads } = useListCopilotThreads();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const patchInsight = usePatchCopilotInsight();
  const executeInsight = useExecuteCopilotInsight();

  const invalidateInsights = () =>
    qc.invalidateQueries({ queryKey: getListCopilotInsightsQueryKey() });

  const onExecute = async (id: string) => {
    if (executeInsight.isPending) return;
    await executeInsight.mutateAsync({ id });
    invalidateInsights();
  };
  const onPatch = async (id: string, status: InsightStatus) => {
    if (patchInsight.isPending) return;
    await patchInsight.mutateAsync({ id, data: { status } });
    invalidateInsights();
  };

  useEffect(() => {
    if (!activeThreadId && threads && threads.length > 0) {
      setActiveThreadId(threads[0].id);
    }
  }, [threads, activeThreadId]);

  const insightIcon = (kind: string) => {
    if (kind === "Risk") return <AlertTriangle className="h-4 w-4 text-rose-500" />;
    if (kind === "NextAction") return <Sparkles className="h-4 w-4 text-amber-500" />;
    if (kind === "Opportunity") return <TrendingUp className="h-4 w-4 text-emerald-500" />;
    return <Sparkles className="h-4 w-4 text-primary" />;
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Sparkles className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{t("pages.copilot.title")}</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr_320px] gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{t("pages.copilot.threads")}</CardTitle>
            <NewThreadDialog onCreated={setActiveThreadId} />
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(threads ?? []).map((th) => (
              <button
                key={th.id}
                onClick={() => setActiveThreadId(th.id)}
                className={`w-full text-left rounded-md p-2 hover:bg-muted text-sm ${
                  activeThreadId === th.id ? "bg-muted" : ""
                }`}
              >
                <div className="font-medium truncate">{th.title}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                  <MessageSquare className="h-3 w-3" />
                  {th.messageCount}
                  <span>·</span>
                  <span>{new Date(th.updatedAt).toLocaleDateString(i18n.resolvedLanguage)}</span>
                </div>
              </button>
            ))}
            {(!threads || threads.length === 0) && (
              <p className="text-xs text-muted-foreground italic px-2 py-4">{t("common.noData")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {threads?.find((th) => th.id === activeThreadId)?.title ?? t("pages.copilot.title")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activeThreadId ? <ChatPanel threadId={activeThreadId} /> : (
              <p className="text-sm text-muted-foreground">{t("common.noData")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-2">
            <CardTitle className="text-base">{t("pages.copilot.insights")}</CardTitle>
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={statusFilter === s ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => setStatusFilter(s)}
                  data-testid={`insights-filter-${s}`}
                >
                  {t(`pages.copilot.status.${s}`)}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(insights ?? []).slice(0, 10).map((ins) => (
              <div key={ins.id} className="border-l-2 border-primary/40 pl-3 py-1" data-testid={`insight-${ins.id}`}>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {insightIcon(ins.kind)}
                  {ins.title}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{ins.summary}</p>
                {ins.suggestedAction && (
                  <p className="text-xs mt-1 text-foreground/80 italic">{ins.suggestedAction}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <Badge variant="outline" className="text-[10px]">{ins.severity}</Badge>
                  <Badge variant="secondary" className="text-[10px]">
                    {t(`pages.copilot.status.${ins.status}`)}
                  </Badge>
                  <Link href={`/deals/${ins.dealId}`} className="text-xs text-primary hover:underline">
                    {ins.dealName}
                  </Link>
                </div>
                {ins.status === "open" && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {ins.actionType && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => onExecute(ins.id)}
                        disabled={executeInsight.isPending}
                        data-testid={`insight-execute-${ins.id}`}
                      >
                        {t("pages.copilot.execute")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => onPatch(ins.id, "acknowledged")}
                      disabled={patchInsight.isPending}
                    >
                      {t("pages.copilot.acknowledge")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => onPatch(ins.id, "dismissed")}
                      disabled={patchInsight.isPending}
                    >
                      {t("pages.copilot.dismiss")}
                    </Button>
                  </div>
                )}
                {ins.status === "acknowledged" && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {ins.actionType && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        onClick={() => onExecute(ins.id)}
                        disabled={executeInsight.isPending}
                        data-testid={`insight-execute-${ins.id}`}
                      >
                        {t("pages.copilot.execute")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => onPatch(ins.id, "resolved")}
                      disabled={patchInsight.isPending}
                    >
                      {t("pages.copilot.markResolved")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {(!insights || insights.length === 0) && (
              <p className="text-sm text-muted-foreground italic">{t("common.noData")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

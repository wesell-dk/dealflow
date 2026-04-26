import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  MessageCircle, X, Send, Sparkles, Plus, Briefcase, Users, BarChart3,
  CheckCircle2, Search, Database, AlertCircle, Activity,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAskHelpBot } from "@workspace/api-client-react";
import { Link } from "wouter";

type Action =
  | { kind: "none" }
  | { kind: "navigate"; path: string };

type Suggestion = { label: string; path: string };

type Trace = {
  kind: "message" | "tool_call" | "tool_error";
  text?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  errorClass?: string;
  errorMessage?: string;
};

type Msg = {
  role: "user" | "assistant";
  content: string;
  suggestions?: Suggestion[];
  action?: Action;
  traces?: Trace[];
  meta?: { source?: "ai" | "fallback"; latencyMs?: number | null; steps?: number | null };
};

const QUICK_ACTIONS: Array<{ icon: typeof Plus; label: string; question: string }> = [
  { icon: BarChart3, label: "Pipeline stats", question: "Give me a quick pipeline overview — number of deals by stage and open value." },
  { icon: Briefcase, label: "Top 5 deals", question: "What are my 5 largest open deals?" },
  { icon: Users, label: "Recent customers", question: "Show me the 5 most recent customers in the system." },
  { icon: Activity, label: "Recent activity", question: "What happened in the last day?" },
];

function ToolIcon({ tool }: { tool?: string }) {
  if (!tool) return <Activity className="h-3.5 w-3.5" />;
  if (tool.startsWith("create_")) return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
  if (tool.startsWith("search_")) return <Search className="h-3.5 w-3.5 text-blue-600" />;
  if (tool === "pipeline_stats") return <BarChart3 className="h-3.5 w-3.5 text-purple-600" />;
  if (tool === "recent_activity") return <Activity className="h-3.5 w-3.5 text-amber-600" />;
  return <Database className="h-3.5 w-3.5" />;
}

const TOOL_LABELS: Record<string, string> = {
  search_accounts: "Searched customers",
  search_deals: "Searched deals",
  pipeline_stats: "Pipeline statistics",
  recent_activity: "Recent activity",
  create_account: "Customer created",
  create_deal: "Deal created",
  create_contact: "Contact created",
};

function compactSummary(tool: string, result: unknown): string {
  if (Array.isArray(result)) {
    if (result.length === 0) return "no results";
    return `${result.length} results`;
  }
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.id === "string") return String(r.id);
    if (r.totals && typeof r.totals === "object") {
      const t = r.totals as Record<string, number>;
      return `${t.accounts ?? 0} customers · ${t.deals ?? 0} deals · ${t.approvals ?? 0} approvals`;
    }
  }
  return TOOL_LABELS[tool] ?? tool;
}

function TraceCard({ trace }: { trace: Trace }) {
  if (trace.kind === "message") return null;
  if (trace.kind === "tool_error") {
    return (
      <div className="flex items-start gap-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs">
        <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="font-medium">{trace.tool ?? "Tool"} failed</div>
          <div className="text-muted-foreground truncate">{trace.errorMessage}</div>
        </div>
      </div>
    );
  }
  // tool_call
  const tool = trace.tool ?? "tool";
  const isList = Array.isArray(trace.result);
  return (
    <div className="rounded border bg-background/60 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <ToolIcon tool={tool} />
        <span className="font-medium">{TOOL_LABELS[tool] ?? tool}</span>
        <span className="ml-auto text-[10px] text-muted-foreground">{compactSummary(tool, trace.result)}</span>
      </div>
      {isList && (
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {(trace.result as Array<Record<string, unknown>>).slice(0, 5).map((row, i) => (
            <li key={i} className="truncate">
              · {String(row.name ?? row.summary ?? row.id ?? "—")}
              {row.value !== undefined && (
                <span className="ml-1 text-foreground/70">
                  {typeof row.value === "number"
                    ? new Intl.NumberFormat("de-DE", {
                        style: "currency",
                        currency: typeof row.currency === "string" ? row.currency : "EUR",
                        maximumFractionDigits: 0,
                      }).format(row.value)
                    : String(row.value)}
                </span>
              )}
              {row.stage !== undefined && (
                <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/80">
                  {String(row.stage)}
                </span>
              )}
            </li>
          ))}
          {(trace.result as Array<unknown>).length > 5 && (
            <li className="text-[10px] italic">… +{(trace.result as Array<unknown>).length - 5} more</li>
          )}
        </ul>
      )}
      {!isList && tool === "pipeline_stats" && typeof trace.result === "object" && trace.result !== null && (
        <PipelineStatsView data={trace.result as PipelineStats} />
      )}
      {!isList && tool.startsWith("create_") && typeof trace.result === "object" && trace.result !== null && (
        <div className="mt-1 text-muted-foreground">
          ID: <code className="font-mono">{String((trace.result as Record<string, unknown>).id ?? "")}</code>
        </div>
      )}
    </div>
  );
}

interface PipelineStats {
  totals?: { accounts?: number; deals?: number; quotes?: number; contracts?: number; approvals?: number };
  byStage?: Array<{ stage: string; count: number; valueSum: number }>;
  openValue?: number;
  wonValue?: number;
  pendingApprovals?: number;
}

function PipelineStatsView({ data }: { data: PipelineStats }) {
  const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
  return (
    <div className="mt-1 space-y-1 text-muted-foreground">
      {data.byStage && data.byStage.length > 0 && (
        <ul className="space-y-0.5">
          {data.byStage.map((s) => (
            <li key={s.stage} className="flex items-center justify-between gap-2">
              <span className="uppercase text-[10px] tracking-wide">{s.stage}</span>
              <span>
                {s.count}× · {eur(s.valueSum)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="pt-1 border-t border-border/50 text-[10px]">
        Open {eur(data.openValue ?? 0)} · Won {eur(data.wonValue ?? 0)} · Pending approvals {data.pendingApprovals ?? 0}
      </div>
    </div>
  );
}

export function HelpBot() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [location, navigate] = useLocation();
  const [messages, setMessages] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const askMutation = useAskHelpBot();

  useEffect(() => {
    if (open && messages.length === 0) {
      setMessages([{ role: "assistant", content: t("helpBot.greeting") }]);
    }
  }, [open, messages.length, t, i18n.resolvedLanguage]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendQuestion = async (q: string) => {
    if (!q || askMutation.isPending) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    try {
      const reply = await askMutation.mutateAsync({
        data: {
          question: q,
          currentPath: location,
          history: next.map(m => ({ role: m.role, content: m.content })),
        },
      });
      const action: Action = reply.action?.kind === "navigate" && reply.action.path
        ? { kind: "navigate", path: reply.action.path }
        : { kind: "none" };
      const meta = reply.meta
        ? {
            source: reply.meta.source as "ai" | "fallback" | undefined,
            latencyMs: reply.meta.latencyMs ?? null,
            steps: (reply.meta as { steps?: number | null }).steps ?? null,
          }
        : undefined;
      const rawTraces = (reply as { traces?: unknown }).traces;
      const traces: Trace[] = Array.isArray(rawTraces)
        ? (rawTraces as unknown[])
            .filter((t): t is Trace =>
              !!t &&
              typeof t === "object" &&
              "kind" in t &&
              (t as { kind: unknown }).kind !== "message" &&
              ((t as { kind: unknown }).kind === "tool_call" ||
                (t as { kind: unknown }).kind === "tool_error"),
            )
        : [];
      setMessages([
        ...next,
        {
          role: "assistant",
          content: reply.reply,
          suggestions: reply.suggestions,
          action,
          traces,
          meta,
        },
      ]);
    } catch {
      setMessages([
        ...next,
        { role: "assistant", content: "Hmm, something went wrong. Please try again in a moment." },
      ]);
    }
  };

  const send = async () => {
    const q = input.trim();
    if (q) await sendQuestion(q);
  };

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        size="lg"
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg p-0"
        aria-label={t("helpBot.open")}
        data-testid="help-bot-open"
      >
        <MessageCircle className="h-6 w-6" />
      </Button>
    );
  }

  return (
    <div
      className="fixed bottom-6 right-6 z-50 w-[420px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-3rem)] bg-card border rounded-xl shadow-2xl flex flex-col overflow-hidden"
      data-testid="help-bot-panel"
    >
      <div className="flex items-center justify-between border-b px-4 py-3 bg-primary/5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="font-semibold text-sm">{t("helpBot.title")}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="flex-1 p-4">
        <div ref={scrollRef} className="space-y-3">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
                data-testid={m.role === "assistant" ? "help-bot-message" : undefined}
              >
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.traces && m.traces.length > 0 && (
                  <div className="mt-2 space-y-1.5" data-testid="help-bot-traces">
                    {m.traces.map((tr, j) => <TraceCard key={j} trace={tr} />)}
                  </div>
                )}
                {m.action?.kind === "navigate" && (
                  <div className="mt-2">
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setOpen(false)}
                    >
                      <Link href={m.action.path}>Open now →</Link>
                    </Button>
                  </div>
                )}
                {m.suggestions && m.suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.suggestions.map((s, j) => (
                      <Link
                        key={j}
                        href={s.path}
                        onClick={() => setOpen(false)}
                        className="text-xs px-2 py-1 rounded-md bg-background border hover:bg-accent"
                      >
                        {s.label}
                      </Link>
                    ))}
                  </div>
                )}
                {m.role === "assistant" && m.meta?.source === "fallback" && (
                  <div className="mt-1 text-[10px] text-muted-foreground italic">Offline mode</div>
                )}
                {m.role === "assistant" && m.meta?.source === "ai" && m.meta.steps && m.meta.steps > 1 && (
                  <div className="mt-1 text-[10px] text-muted-foreground italic">
                    {m.meta.steps} steps · {m.meta.latencyMs ? `${(m.meta.latencyMs / 1000).toFixed(1)}s` : ""}
                  </div>
                )}
              </div>
            </div>
          ))}

          {messages.length <= 1 && !askMutation.isPending && (
            <div className="pt-2">
              <div className="text-xs text-muted-foreground mb-2">Quick actions:</div>
              <div className="grid grid-cols-2 gap-1.5">
                {QUICK_ACTIONS.map((qa) => {
                  const Icon = qa.icon;
                  return (
                    <button
                      key={qa.label}
                      onClick={() => void sendQuestion(qa.question)}
                      className="flex items-center gap-1.5 text-xs px-2 py-2 rounded-md border bg-background hover:bg-accent text-left"
                      data-testid={`help-bot-quick-${qa.label.replace(/\s+/g, "-").toLowerCase()}`}
                    >
                      <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="truncate">{qa.label}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground italic">
                Tip: You can also ask me "Create a customer 'Acme GmbH', industry Software, Germany" — I'll handle it directly.
              </div>
            </div>
          )}

          {askMutation.isPending && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground">
                <span className="inline-flex gap-1">
                  <span className="animate-bounce">·</span>
                  <span className="animate-bounce" style={{ animationDelay: "120ms" }}>·</span>
                  <span className="animate-bounce" style={{ animationDelay: "240ms" }}>·</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-center gap-2 border-t p-3"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("helpBot.placeholder")}
          className="flex-1"
          data-testid="help-bot-input"
        />
        <Button type="submit" size="icon" disabled={askMutation.isPending || !input.trim()} data-testid="help-bot-send">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

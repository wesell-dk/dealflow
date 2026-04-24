import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { MessageCircle, X, Send, Sparkles, Plus, Briefcase, Users, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAskHelpBot } from "@workspace/api-client-react";
import { Link } from "wouter";
import { AccountFormDialog } from "@/components/accounts/account-form-dialog";
import { DealFormDialog } from "@/components/deals/deal-form-dialog";

type Action =
  | { kind: "none" }
  | { kind: "navigate"; path: string }
  | { kind: "open_create_account" }
  | { kind: "open_create_deal"; accountId?: string };

type Suggestion = { label: string; path: string };
type Msg = {
  role: "user" | "assistant";
  content: string;
  suggestions?: Suggestion[];
  action?: Action;
  meta?: { source?: "ai" | "fallback"; latencyMs?: number | null };
};

const QUICK_ACTIONS: Array<{ icon: typeof Plus; label: string; question: string }> = [
  { icon: Plus, label: "Kunde anlegen", question: "Leg mir einen neuen Kunden an" },
  { icon: Briefcase, label: "Deal anlegen", question: "Leg mir einen neuen Deal an" },
  { icon: Users, label: "Wo sind meine Kunden?", question: "Wo finde ich alle meine Kunden?" },
  { icon: BarChart3, label: "Pipeline anzeigen", question: "Zeig mir die Deal-Pipeline" },
];

export function HelpBot() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [location, navigate] = useLocation();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [openAccountDialog, setOpenAccountDialog] = useState(false);
  const [openDealDialog, setOpenDealDialog] = useState(false);
  const [dealDefaultAccount, setDealDefaultAccount] = useState<string | undefined>();
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

  const executeAction = (action?: Action) => {
    if (!action || action.kind === "none") return;
    if (action.kind === "navigate") {
      navigate(action.path);
      setOpen(false);
      return;
    }
    if (action.kind === "open_create_account") {
      setOpenAccountDialog(true);
      return;
    }
    if (action.kind === "open_create_deal") {
      setDealDefaultAccount(action.accountId);
      setOpenDealDialog(true);
      return;
    }
  };

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
      const action: Action | undefined = reply.action
        ? reply.action.kind === "navigate"
          ? { kind: "navigate", path: reply.action.path ?? "/" }
          : reply.action.kind === "open_create_deal"
            ? { kind: "open_create_deal", accountId: reply.action.accountId ?? undefined }
            : reply.action.kind === "open_create_account"
              ? { kind: "open_create_account" }
              : { kind: "none" }
        : undefined;
      const meta = reply.meta
        ? { source: reply.meta.source as "ai" | "fallback" | undefined, latencyMs: reply.meta.latencyMs ?? null }
        : undefined;
      setMessages([
        ...next,
        { role: "assistant", content: reply.reply, suggestions: reply.suggestions, action, meta },
      ]);
      if (action) executeAction(action);
    } catch {
      setMessages([
        ...next,
        { role: "assistant", content: "Hmm, da ist etwas schiefgegangen. Versuch es bitte gleich nochmal." },
      ]);
    }
  };

  const send = async () => {
    const q = input.trim();
    if (q) await sendQuestion(q);
  };

  if (!open) {
    return (
      <>
        <Button
          onClick={() => setOpen(true)}
          size="lg"
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg p-0"
          aria-label={t("helpBot.open")}
          data-testid="help-bot-open"
        >
          <MessageCircle className="h-6 w-6" />
        </Button>
        <AccountFormDialog
          open={openAccountDialog}
          onOpenChange={setOpenAccountDialog}
          onSaved={(id) => navigate(`/accounts/${id}`)}
        />
        <DealFormDialog
          open={openDealDialog}
          onOpenChange={setOpenDealDialog}
          defaultAccountId={dealDefaultAccount}
          onSaved={(id) => navigate(`/deals/${id}`)}
        />
      </>
    );
  }

  return (
    <>
      <div
        className="fixed bottom-6 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] h-[560px] max-h-[calc(100vh-3rem)] bg-card border rounded-xl shadow-2xl flex flex-col overflow-hidden"
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
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>
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
                    <div className="mt-1 text-[10px] text-muted-foreground italic">Offline-Modus</div>
                  )}
                </div>
              </div>
            ))}

            {messages.length <= 1 && !askMutation.isPending && (
              <div className="pt-2">
                <div className="text-xs text-muted-foreground mb-2">Schnelle Aktionen:</div>
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
      <AccountFormDialog
        open={openAccountDialog}
        onOpenChange={setOpenAccountDialog}
        onSaved={(id) => navigate(`/accounts/${id}`)}
      />
      <DealFormDialog
        open={openDealDialog}
        onOpenChange={setOpenDealDialog}
        defaultAccountId={dealDefaultAccount}
        onSaved={(id) => navigate(`/deals/${id}`)}
      />
    </>
  );
}

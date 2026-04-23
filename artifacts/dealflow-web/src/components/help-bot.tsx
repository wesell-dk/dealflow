import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { MessageCircle, X, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAskHelpBot } from "@workspace/api-client-react";
import { Link } from "wouter";

type Msg = { role: "user" | "assistant"; content: string; suggestions?: { label: string; path: string }[] };

export function HelpBot() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [location] = useLocation();
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

  const send = async () => {
    const q = input.trim();
    if (!q || askMutation.isPending) return;
    setInput("");
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    try {
      const reply = await askMutation.mutateAsync({
        data: {
          question: q,
          currentPath: location,
          history: next.map(m => ({ role: m.role, content: m.content })),
        },
      });
      setMessages([
        ...next,
        { role: "assistant", content: reply.reply, suggestions: reply.suggestions },
      ]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: "Sorry — request failed." }]);
    }
  };

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        size="lg"
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full shadow-lg p-0"
        aria-label={t("helpBot.open")}
      >
        <MessageCircle className="h-6 w-6" />
      </Button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[360px] max-w-[calc(100vw-3rem)] h-[520px] max-h-[calc(100vh-3rem)] bg-card border rounded-xl shadow-2xl flex flex-col overflow-hidden">
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
              </div>
            </div>
          ))}
          {askMutation.isPending && (
            <div className="text-xs text-muted-foreground italic">…</div>
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
        />
        <Button type="submit" size="icon" disabled={askMutation.isPending || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

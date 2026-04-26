import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ConnectionRow {
  provider: "microsoft" | "google";
  email: string;
  displayName: string | null;
  expiresAt: string | null;
  channelId: string | null;
  updatedAt: string;
}

async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${import.meta.env.BASE_URL}api${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!resp.ok) throw new Error(`${resp.status} ${await resp.text().catch(() => "")}`);
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

const PROVIDER_LABEL: Record<ConnectionRow["provider"], string> = {
  microsoft: "Microsoft 365 / Outlook",
  google: "Google Workspace / Gmail",
};

export default function ProfilePage() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ConnectionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await apiFetch<{ connections: ConnectionRow[] }>(
        "/orgs/me/mailbox",
      );
      setRows(data.connections);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    // ── Show success/error feedback when redirected back from OAuth callback.
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const errParam = params.get("error");
    if (connected) {
      toast({
        title: "Postfach verbunden",
        description: PROVIDER_LABEL[connected as ConnectionRow["provider"]] ?? connected,
      });
      // Clean the query string so refreshes don't re-toast.
      window.history.replaceState({}, "", window.location.pathname);
    } else if (errParam) {
      toast({
        title: "Verbindung fehlgeschlagen",
        description: errParam,
        variant: "destructive",
      });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [reload, toast]);

  async function connect(provider: ConnectionRow["provider"]) {
    setBusy(provider);
    try {
      const { authorizeUrl } = await apiFetch<{ authorizeUrl: string }>(
        `/orgs/me/mailbox/connect/${provider}`,
        { method: "POST" },
      );
      window.location.href = authorizeUrl;
    } catch (e) {
      toast({
        title: "Verbindung konnte nicht gestartet werden",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setBusy(null);
    }
  }

  async function disconnect(provider: ConnectionRow["provider"]) {
    if (!confirm("Postfach-Verbindung wirklich trennen?")) return;
    setBusy(provider);
    try {
      await apiFetch(`/orgs/me/mailbox/${provider}`, { method: "DELETE" });
      await reload();
      toast({ title: "Verbindung getrennt" });
    } catch (e) {
      toast({
        title: "Trennen fehlgeschlagen",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  function rowFor(provider: ConnectionRow["provider"]): ConnectionRow | null {
    return rows?.find((r) => r.provider === provider) ?? null;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <h1 className="text-2xl font-bold">Profil</h1>

      <Card data-testid="card-mailbox-connections">
        <CardHeader className="flex flex-row items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <div>
            <CardTitle>Persönliches Postfach verbinden</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Verbinde Outlook oder Gmail, um Angebote und Kollaborations-Einladungen
              direkt aus Deinem eigenen Postfach zu versenden. Antworten landen
              automatisch in Deinem Postfach.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          {rows === null && !error && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" /> Lade Verbindungen…
            </div>
          )}
          {(["microsoft", "google"] as const).map((provider) => {
            const row = rowFor(provider);
            return (
              <div
                key={provider}
                className="flex items-center gap-3 rounded-md border p-3"
                data-testid={`mailbox-row-${provider}`}
              >
                <div className="flex-1">
                  <div className="font-medium">{PROVIDER_LABEL[provider]}</div>
                  {row ? (
                    <div className="text-xs text-muted-foreground">
                      {row.displayName ? `${row.displayName} · ` : ""}
                      {row.email}{" "}
                      <Badge variant="secondary" className="ml-2">
                        verbunden
                      </Badge>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Nicht verbunden
                    </div>
                  )}
                </div>
                {row ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => disconnect(provider)}
                    disabled={busy === provider}
                    data-testid={`mailbox-disconnect-${provider}`}
                  >
                    {busy === provider ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    <span className="ml-1.5">Trennen</span>
                  </Button>
                ) : (
                  <Button
                    onClick={() => connect(provider)}
                    disabled={busy === provider}
                    data-testid={`mailbox-connect-${provider}`}
                  >
                    {busy === provider && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Verbinden
                  </Button>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

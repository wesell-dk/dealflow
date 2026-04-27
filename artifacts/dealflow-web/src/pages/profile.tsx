import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Mail, Trash2, UserCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { apiUpdateProfilePreferences } from "@/lib/auth";
import { setLanguage } from "@/lib/i18n";

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

      <PreferencesCard />

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

// Eine Auswahl der häufigsten IANA-Zeitzonen (Task #282). Bewusst kein voller
// Browser-Picker — die Liste deckt Mitteleuropa, UK, USA, Indien und APAC ab,
// also das Spektrum aus dem das Tool typischerweise genutzt wird. Wer eine
// nicht aufgeführte Zone braucht, kann sie via Backend-API setzen.
const TIME_ZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "Europe/Berlin", label: "Europe/Berlin (CET/CEST)" },
  { value: "Europe/Vienna", label: "Europe/Vienna (CET/CEST)" },
  { value: "Europe/Zurich", label: "Europe/Zurich (CET/CEST)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET/CEST)" },
  { value: "Europe/Madrid", label: "Europe/Madrid (CET/CEST)" },
  { value: "Europe/Lisbon", label: "Europe/Lisbon (WET/WEST)" },
  { value: "America/New_York", label: "America/New_York (ET)" },
  { value: "America/Chicago", label: "America/Chicago (CT)" },
  { value: "America/Denver", label: "America/Denver (MT)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (IST)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (JST)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST/AEDT)" },
];

const BROWSER_TZ_VALUE = "__browser__";
const BROWSER_LANG_VALUE = "__browser__";

function PreferencesCard() {
  const { toast } = useToast();
  const { user, refresh } = useAuth();
  const [displayName, setDisplayName] = useState<string>("");
  const [language, setLanguageState] = useState<string>(BROWSER_LANG_VALUE);
  const [timeZone, setTimeZone] = useState<string>(BROWSER_TZ_VALUE);
  const [saving, setSaving] = useState(false);

  // Browser-Default-Zone als Hinweistext im "Browser-Default"-Eintrag.
  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
      return null;
    }
  }, []);

  // Wenn der User-Server-State (re-)lädt, lokale Form-Werte synchronisieren.
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName ?? "");
    setLanguageState(user.preferredLanguage ?? BROWSER_LANG_VALUE);
    setTimeZone(user.timeZone ?? BROWSER_TZ_VALUE);
  }, [user]);

  if (!user) return null;

  async function handleSave() {
    setSaving(true);
    try {
      const trimmed = displayName.trim();
      const nextLang = language === BROWSER_LANG_VALUE ? null : (language as "de" | "en");
      const nextTz = timeZone === BROWSER_TZ_VALUE ? null : timeZone;
      await apiUpdateProfilePreferences({
        displayName: trimmed.length === 0 ? null : trimmed,
        preferredLanguage: nextLang,
        timeZone: nextTz,
      });
      // i18n direkt umschalten, damit die Begrüßung sofort die richtige
      // Sprache zeigt (sonst greift die Sync erst beim nächsten App-Boot).
      // `persist: false`, weil wir die Wahl bereits oben über
      // apiUpdateProfilePreferences gespeichert haben.
      if (nextLang) setLanguage(nextLang, { persist: false });
      await refresh();
      toast({ title: "Einstellungen gespeichert" });
    } catch (e) {
      toast({
        title: "Speichern fehlgeschlagen",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="card-profile-preferences">
      <CardHeader className="flex flex-row items-center gap-2">
        <UserCircle className="h-5 w-5 text-primary" />
        <div>
          <CardTitle>Anzeige-Einstellungen</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Lege fest, wie wir dich auf der Startseite begrüßen, in welcher
            Sprache die Oberfläche erscheint und welche Zeitzone wir für
            zeit-abhängige Anzeigen (z. B. „Guten Morgen") verwenden.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="profile-display-name">
            Spitzname / Anzeigename (optional)
          </Label>
          <Input
            id="profile-display-name"
            data-testid="input-display-name"
            value={displayName}
            maxLength={40}
            placeholder={
              user.name?.trim().split(/\s+/)[0] ?? "z. B. Anna"
            }
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Wird in der Begrüßung statt deines Vornamens angezeigt. Leer
            lassen, um den ersten Teil deines Namens („{user.name?.trim().split(/\s+/)[0] ?? user.name}")
            zu verwenden.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-language">Bevorzugte Sprache</Label>
          <Select value={language} onValueChange={setLanguageState}>
            <SelectTrigger id="profile-language" data-testid="select-language" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BROWSER_LANG_VALUE}>Browser-Standard</SelectItem>
              <SelectItem value="de">Deutsch</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-time-zone">Zeitzone</Label>
          <Select value={timeZone} onValueChange={setTimeZone}>
            <SelectTrigger id="profile-time-zone" data-testid="select-time-zone" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={BROWSER_TZ_VALUE}>
                Browser-Standard{browserTz ? ` (${browserTz})` : ""}
              </SelectItem>
              {TIME_ZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Beeinflusst die Tageszeit-Begrüßung („Guten Morgen / Tag /
            Abend") und das Datum auf der Startseite.
          </p>
        </div>

        <div className="flex justify-end">
          <Button
            onClick={handleSave}
            disabled={saving}
            data-testid="button-save-preferences"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Speichern
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

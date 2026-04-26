import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Mail, Loader2, Trash2, FlaskConical, Pencil } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ChannelType = "system" | "smtp" | "microsoft_graph" | "gmail_api" | "webhook";

interface ChannelRow {
  id: string;
  type: ChannelType;
  name: string;
  isActive: boolean;
  brandId: string | null;
  userId: string | null;
  isDefaultTransactional: boolean;
  isDefaultPersonal: boolean;
  fromEmail: string;
  fromName: string | null;
  replyTo: string | null;
  config: Record<string, unknown>;
  lastTestStatus: string | null;
  lastTestAt: string | null;
  hasCredentials: boolean;
  updatedAt: string;
}

const TYPE_LABEL: Record<ChannelType, string> = {
  system: "System (Resend / Log)",
  smtp: "SMTP",
  microsoft_graph: "Microsoft Graph",
  gmail_api: "Gmail API",
  webhook: "Webhook",
};

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

interface FormState {
  type: ChannelType;
  name: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  isActive: boolean;
  isDefaultTransactional: boolean;
  isDefaultPersonal: boolean;
  // type-specific
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPassword: string;
  smtpSecure: boolean;
  webhookUrl: string;
  webhookSecret: string;
  // for tenant-wide MS-Graph (not per-user OAuth):
  graphTenantOauthId: string;
  graphMailbox: string;
  graphAccessToken: string;
}

const EMPTY_FORM: FormState = {
  type: "smtp",
  name: "",
  fromEmail: "",
  fromName: "",
  replyTo: "",
  isActive: true,
  isDefaultTransactional: false,
  isDefaultPersonal: false,
  smtpHost: "",
  smtpPort: "587",
  smtpUser: "",
  smtpPassword: "",
  smtpSecure: false,
  webhookUrl: "",
  webhookSecret: "",
  graphTenantOauthId: "",
  graphMailbox: "",
  graphAccessToken: "",
};

function buildPayload(f: FormState): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: f.type,
    name: f.name.trim(),
    fromEmail: f.fromEmail.trim(),
    fromName: f.fromName.trim() || null,
    replyTo: f.replyTo.trim() || null,
    isActive: f.isActive,
    isDefaultTransactional: f.isDefaultTransactional,
    isDefaultPersonal: f.isDefaultPersonal,
  };
  if (f.type === "smtp") {
    base.config = {
      host: f.smtpHost.trim(),
      port: Number(f.smtpPort) || 587,
      secure: f.smtpSecure,
      user: f.smtpUser.trim() || undefined,
    };
    if (f.smtpPassword) base.credentials = { password: f.smtpPassword };
  } else if (f.type === "webhook") {
    base.config = { url: f.webhookUrl.trim() };
    if (f.webhookSecret) base.credentials = { signingSecret: f.webhookSecret };
  } else if (f.type === "microsoft_graph") {
    base.config = {
      mailbox: f.graphMailbox.trim(),
      tenantOauthId: f.graphTenantOauthId.trim() || undefined,
    };
    if (f.graphAccessToken) base.credentials = { accessToken: f.graphAccessToken };
  }
  return base;
}

export function EmailChannelsCard() {
  const { toast } = useToast();
  const [rows, setRows] = useState<ChannelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [testRecipient, setTestRecipient] = useState("");
  const [testingId, setTestingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ channels: ChannelRow[] }>(
        "/orgs/tenant/email-channels",
      );
      setRows(data.channels);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setEditOpen(true);
  }

  function openEdit(row: ChannelRow) {
    setEditingId(row.id);
    setForm({
      ...EMPTY_FORM,
      type: row.type,
      name: row.name,
      fromEmail: row.fromEmail,
      fromName: row.fromName ?? "",
      replyTo: row.replyTo ?? "",
      isActive: row.isActive,
      isDefaultTransactional: row.isDefaultTransactional,
      isDefaultPersonal: row.isDefaultPersonal,
      smtpHost: String(row.config?.host ?? ""),
      smtpPort: String(row.config?.port ?? "587"),
      smtpUser: String(row.config?.user ?? ""),
      smtpSecure: Boolean(row.config?.secure),
      webhookUrl: String(row.config?.url ?? ""),
      graphMailbox: String(row.config?.mailbox ?? ""),
      graphTenantOauthId: String(row.config?.tenantOauthId ?? ""),
    });
    setEditOpen(true);
  }

  async function save() {
    setBusy(true);
    try {
      const payload = buildPayload(form);
      if (editingId) {
        await apiFetch(`/orgs/tenant/email-channels/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch("/orgs/tenant/email-channels", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      setEditOpen(false);
      await reload();
      toast({ title: editingId ? "Kanal aktualisiert" : "Kanal angelegt" });
    } catch (e) {
      toast({
        title: "Fehler beim Speichern",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Kanal wirklich löschen?")) return;
    try {
      await apiFetch(`/orgs/tenant/email-channels/${id}`, { method: "DELETE" });
      await reload();
    } catch (e) {
      toast({
        title: "Löschen fehlgeschlagen",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  async function runTest(id: string) {
    if (!testRecipient.trim()) {
      toast({
        title: "Empfänger fehlt",
        description: "Bitte E-Mail-Adresse für den Testversand eintragen.",
        variant: "destructive",
      });
      return;
    }
    setTestingId(id);
    try {
      const result = await apiFetch<{ ok: boolean; providerMessageId?: string; error?: string }>(
        `/orgs/tenant/email-channels/${id}/test`,
        { method: "POST", body: JSON.stringify({ to: testRecipient.trim() }) },
      );
      toast({
        title: result.ok ? "Testmail versendet" : "Testmail fehlgeschlagen",
        description: result.ok
          ? `Provider-ID: ${result.providerMessageId ?? "—"}`
          : result.error ?? "Unbekannter Fehler",
        variant: result.ok ? "default" : "destructive",
      });
      await reload();
    } catch (e) {
      toast({
        title: "Testmail fehlgeschlagen",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setTestingId(null);
    }
  }

  return (
    <Card data-testid="card-email-channels">
      <CardHeader className="flex flex-row items-center gap-2">
        <Mail className="h-5 w-5 text-primary" />
        <div className="flex-1">
          <CardTitle>E-Mail-Versand</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Tenant-weite Kanäle für transaktionale und persönliche E-Mails. Ohne
            Konfiguration läuft alles über den System-Versand (Resend bzw. Log).
          </p>
        </div>
        <Button onClick={openCreate} data-testid="email-channels-add">
          Kanal hinzufügen
        </Button>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive mb-3">
            {error}
          </div>
        )}
        {loading && !rows && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Lade Kanäle…
          </div>
        )}
        {rows && rows.length === 0 && (
          <div className="text-sm text-muted-foreground">
            Noch keine Kanäle konfiguriert. System-Versand ist aktiv.
          </div>
        )}
        {rows && rows.length > 0 && (
          <div className="space-y-2 mb-4">
            <Label htmlFor="ec-test-to" className="text-xs">
              Empfänger für Testversand
            </Label>
            <Input
              id="ec-test-to"
              value={testRecipient}
              onChange={(e) => setTestRecipient(e.target.value)}
              placeholder="dein.name@firma.de"
              data-testid="email-channels-test-to"
            />
          </div>
        )}
        <div className="space-y-2">
          {rows?.map((row) => (
            <div
              key={row.id}
              className="flex items-center gap-3 rounded-md border p-3"
              data-testid={`email-channel-row-${row.id}`}
            >
              <div className="flex-1">
                <div className="font-medium flex items-center gap-2">
                  {row.name}
                  <Badge variant="secondary">{TYPE_LABEL[row.type]}</Badge>
                  {!row.isActive && <Badge variant="outline">inaktiv</Badge>}
                  {row.isDefaultTransactional && (
                    <Badge variant="default">Default transaktional</Badge>
                  )}
                  {row.isDefaultPersonal && (
                    <Badge variant="default">Default persönlich</Badge>
                  )}
                  {row.userId && <Badge variant="outline">Per-User</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.fromName ? `${row.fromName} <${row.fromEmail}>` : row.fromEmail}
                  {row.lastTestStatus && (
                    <span className="ml-2">
                      · letzter Test: {row.lastTestStatus}
                      {row.lastTestAt
                        ? ` (${new Date(row.lastTestAt).toLocaleString("de-DE")})`
                        : ""}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => runTest(row.id)}
                disabled={testingId === row.id}
                data-testid={`email-channel-test-${row.id}`}
              >
                {testingId === row.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FlaskConical className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => openEdit(row)}
                disabled={!!row.userId}
                title={row.userId ? "Per-User-Kanäle werden unter Profil verwaltet" : ""}
                data-testid={`email-channel-edit-${row.id}`}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => remove(row.id)}
                disabled={!!row.userId}
                title={row.userId ? "Per-User-Kanäle werden unter Profil verwaltet" : ""}
                data-testid={`email-channel-delete-${row.id}`}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Kanal bearbeiten" : "Neuer Kanal"}</DialogTitle>
            <DialogDescription>
              Sensible Felder (Passwort, Secret, Token) werden verschlüsselt gespeichert
              und nie wieder angezeigt — leer lassen, um sie unverändert zu übernehmen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ec-type">Typ</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as ChannelType })}
                disabled={!!editingId}
              >
                <SelectTrigger id="ec-type" data-testid="ec-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABEL) as ChannelType[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {TYPE_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ec-name">Anzeigename</Label>
              <Input
                id="ec-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="ec-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ec-from-email">Absender E-Mail</Label>
                <Input
                  id="ec-from-email"
                  value={form.fromEmail}
                  onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
                  data-testid="ec-from-email"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ec-from-name">Absender Name</Label>
                <Input
                  id="ec-from-name"
                  value={form.fromName}
                  onChange={(e) => setForm({ ...form, fromName: e.target.value })}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ec-reply-to">Reply-To (optional)</Label>
              <Input
                id="ec-reply-to"
                value={form.replyTo}
                onChange={(e) => setForm({ ...form, replyTo: e.target.value })}
              />
            </div>

            {form.type === "smtp" && (
              <div className="grid gap-3 rounded-md border p-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 grid gap-1.5">
                    <Label htmlFor="ec-smtp-host">SMTP Host</Label>
                    <Input
                      id="ec-smtp-host"
                      value={form.smtpHost}
                      onChange={(e) => setForm({ ...form, smtpHost: e.target.value })}
                      placeholder="mail.example.com"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="ec-smtp-port">Port</Label>
                    <Input
                      id="ec-smtp-port"
                      value={form.smtpPort}
                      onChange={(e) => setForm({ ...form, smtpPort: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="ec-smtp-user">User</Label>
                    <Input
                      id="ec-smtp-user"
                      value={form.smtpUser}
                      onChange={(e) => setForm({ ...form, smtpUser: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="ec-smtp-pwd">Passwort</Label>
                    <Input
                      id="ec-smtp-pwd"
                      type="password"
                      value={form.smtpPassword}
                      placeholder={editingId ? "(unverändert)" : ""}
                      onChange={(e) => setForm({ ...form, smtpPassword: e.target.value })}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={form.smtpSecure}
                    onCheckedChange={(c) => setForm({ ...form, smtpSecure: c })}
                  />
                  TLS direkt (Port 465)
                </label>
              </div>
            )}

            {form.type === "webhook" && (
              <div className="grid gap-3 rounded-md border p-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ec-wh-url">Webhook-URL</Label>
                  <Input
                    id="ec-wh-url"
                    value={form.webhookUrl}
                    onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
                    placeholder="https://hooks.example.com/dealflow-mail"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ec-wh-secret">Signing Secret</Label>
                  <Input
                    id="ec-wh-secret"
                    type="password"
                    value={form.webhookSecret}
                    placeholder={editingId ? "(unverändert)" : ""}
                    onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
                  />
                </div>
              </div>
            )}

            {form.type === "microsoft_graph" && (
              <div className="grid gap-3 rounded-md border p-3">
                <p className="text-xs text-muted-foreground">
                  Tenant-weiter Versand über Microsoft Graph (App-only). Für persönliche
                  Postfächer bitte unter „Profil → Postfach verbinden“ den OAuth-Flow nutzen.
                </p>
                <div className="grid gap-1.5">
                  <Label htmlFor="ec-mg-mbx">Mailbox</Label>
                  <Input
                    id="ec-mg-mbx"
                    value={form.graphMailbox}
                    onChange={(e) => setForm({ ...form, graphMailbox: e.target.value })}
                    placeholder="noreply@firma.de"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ec-mg-tid">Microsoft Tenant-ID (optional)</Label>
                  <Input
                    id="ec-mg-tid"
                    value={form.graphTenantOauthId}
                    onChange={(e) =>
                      setForm({ ...form, graphTenantOauthId: e.target.value })
                    }
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ec-mg-tok">Access Token (App-only)</Label>
                  <Input
                    id="ec-mg-tok"
                    type="password"
                    value={form.graphAccessToken}
                    placeholder={editingId ? "(unverändert)" : ""}
                    onChange={(e) => setForm({ ...form, graphAccessToken: e.target.value })}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.isDefaultTransactional}
                  onCheckedChange={(c) =>
                    setForm({ ...form, isDefaultTransactional: c })
                  }
                />
                Default für transaktionale Mails
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={form.isDefaultPersonal}
                  onCheckedChange={(c) => setForm({ ...form, isDefaultPersonal: c })}
                />
                Default für persönliche Mails
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.isActive}
                onCheckedChange={(c) => setForm({ ...form, isActive: c })}
              />
              Aktiv
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={busy}>
              Abbrechen
            </Button>
            <Button onClick={save} disabled={busy} data-testid="ec-save">
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

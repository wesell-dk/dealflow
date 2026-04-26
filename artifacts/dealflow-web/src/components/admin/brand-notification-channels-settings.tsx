import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListBrandNotificationChannels,
  useCreateBrandNotificationChannel,
  useUpdateBrandNotificationChannel,
  useDeleteBrandNotificationChannel,
  useTestBrandNotificationChannel,
  getListBrandNotificationChannelsQueryKey,
  type NotificationChannel,
  type NotificationChannelCreate,
  type NotificationChannelUpdate,
  type NotificationChannelKind as NotificationKind,
  type NotificationLeadEvent,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, Send, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  brandId: string;
}

const ALL_EVENTS: { value: NotificationLeadEvent; label: string }[] = [
  { value: "lead.created", label: "Neuer Lead" },
  { value: "lead.appointment_booked", label: "Termin gebucht" },
];

/**
 * Slack/Teams Notification-Channels einer Brand (Task #263).
 *
 * UX-Hinweise:
 *  - Webhook-URL wird vom Server NIE im Klartext zurückgeliefert. Das
 *    Eingabefeld ist deshalb beim Edit eines bestehenden Channels leer:
 *    leer lassen = bestehenden URL behalten; ausfüllen = ersetzen.
 *  - Test-Button schickt eine synthetische Nachricht. Status landet
 *    sofort in der Liste (lastTestStatus / lastTestAt) — auch im Audit
 *    der Brand.
 *  - lastErrorMessage wird inline rot angezeigt, damit Admins fehlerhafte
 *    Channels sofort erkennen.
 */
export function BrandNotificationChannelsSettings({ brandId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: channels = [], isLoading, error } = useListBrandNotificationChannels(brandId);
  const createMut = useCreateBrandNotificationChannel();
  const updateMut = useUpdateBrandNotificationChannel();
  const deleteMut = useDeleteBrandNotificationChannel();
  const testMut = useTestBrandNotificationChannel();

  const queryKey = useMemo(() => getListBrandNotificationChannelsQueryKey(brandId), [brandId]);
  const invalidate = () => qc.invalidateQueries({ queryKey });

  const [draftKind, setDraftKind] = useState<NotificationKind>("slack");
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftMention, setDraftMention] = useState("");
  const [draftEvents, setDraftEvents] = useState<Record<NotificationLeadEvent, boolean>>({
    "lead.created": true,
    "lead.appointment_booked": true,
  });

  const resetDraft = () => {
    setDraftKind("slack");
    setDraftName("");
    setDraftUrl("");
    setDraftMention("");
    setDraftEvents({ "lead.created": true, "lead.appointment_booked": true });
  };

  const onCreate = async () => {
    if (!draftName.trim() || !draftUrl.trim()) {
      toast({ title: "Name und Webhook-URL sind Pflicht", variant: "destructive" });
      return;
    }
    const events = ALL_EVENTS.map(e => e.value).filter(v => draftEvents[v]);
    if (events.length === 0) {
      toast({ title: "Mindestens ein Event aktivieren", variant: "destructive" });
      return;
    }
    const body: NotificationChannelCreate = {
      kind: draftKind,
      name: draftName.trim(),
      webhookUrl: draftUrl.trim(),
      isActive: true,
      eventsEnabled: events,
      config: draftKind === "slack" && draftMention.trim()
        ? { mention: draftMention.trim() }
        : {},
    };
    try {
      await createMut.mutateAsync({ id: brandId, data: body });
      toast({ title: "Notification-Channel angelegt" });
      resetDraft();
      invalidate();
    } catch (err) {
      toast({
        title: "Anlegen fehlgeschlagen",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4" data-testid="notif-channels-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> Notification-Channels werden geladen…
      </div>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-destructive py-2" data-testid="notif-channels-error">
        Fehler beim Laden der Notification-Channels.
      </p>
    );
  }

  return (
    <div className="space-y-4" data-testid="brand-notification-channels">
      {channels.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="notif-channels-empty">
          Noch keine Slack- oder Teams-Channels für diese Brand konfiguriert.
        </p>
      ) : (
        <ul className="space-y-3">
          {channels.map(c => (
            <ChannelRow
              key={c.id}
              brandId={brandId}
              channel={c}
              onUpdate={async (patch) => {
                try {
                  await updateMut.mutateAsync({ id: brandId, channelId: c.id, data: patch });
                  invalidate();
                } catch (err) {
                  toast({
                    title: "Aktualisieren fehlgeschlagen",
                    description: err instanceof Error ? err.message : String(err),
                    variant: "destructive",
                  });
                }
              }}
              onDelete={async () => {
                try {
                  await deleteMut.mutateAsync({ id: brandId, channelId: c.id });
                  toast({ title: "Channel gelöscht" });
                  invalidate();
                } catch (err) {
                  toast({
                    title: "Löschen fehlgeschlagen",
                    description: err instanceof Error ? err.message : String(err),
                    variant: "destructive",
                  });
                }
              }}
              onTest={async () => {
                try {
                  const r = await testMut.mutateAsync({ id: brandId, channelId: c.id });
                  if (r.ok) {
                    toast({ title: `Test gesendet (HTTP ${r.status ?? "ok"})` });
                  } else {
                    toast({
                      title: "Test fehlgeschlagen",
                      description: r.error ?? undefined,
                      variant: "destructive",
                    });
                  }
                  invalidate();
                } catch (err) {
                  toast({
                    title: "Test fehlgeschlagen",
                    description: err instanceof Error ? err.message : String(err),
                    variant: "destructive",
                  });
                  invalidate();
                }
              }}
            />
          ))}
        </ul>
      )}

      <div className="rounded-md border p-3 space-y-2 bg-muted/30" data-testid="notif-channel-create">
        <p className="text-sm font-medium">Neuen Channel anlegen</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Typ</Label>
            <Select value={draftKind} onValueChange={(v) => setDraftKind(v as NotificationKind)}>
              <SelectTrigger data-testid="notif-channel-kind"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="slack">Slack</SelectItem>
                <SelectItem value="teams">Microsoft Teams</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Anzeigename</Label>
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="z. B. #leads-vertrieb"
              data-testid="notif-channel-name"
            />
          </div>
        </div>
        <div>
          <Label className="text-xs">Incoming-Webhook-URL</Label>
          <Input
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            placeholder={
              draftKind === "slack"
                ? "https://hooks.slack.com/services/T.../B.../..."
                : "https://outlook.office.com/webhook/..."
            }
            data-testid="notif-channel-url"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Wird verschlüsselt abgelegt; nach dem Speichern nicht mehr im Klartext sichtbar.
          </p>
        </div>
        {draftKind === "slack" && (
          <div>
            <Label className="text-xs">Mention (optional)</Label>
            <Input
              value={draftMention}
              onChange={(e) => setDraftMention(e.target.value)}
              placeholder="z. B. <!channel> oder <@U12345>"
              data-testid="notif-channel-mention"
            />
          </div>
        )}
        <div>
          <Label className="text-xs">Events</Label>
          <div className="flex flex-wrap gap-3 pt-1">
            {ALL_EVENTS.map(e => (
              <label key={e.value} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!!draftEvents[e.value]}
                  onCheckedChange={(v) => setDraftEvents(p => ({ ...p, [e.value]: !!v }))}
                  data-testid={`notif-channel-event-${e.value}`}
                />
                {e.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end pt-1">
          <Button
            size="sm"
            onClick={onCreate}
            disabled={createMut.isPending}
            data-testid="notif-channel-create-submit"
          >
            {createMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Plus className="mr-1 h-4 w-4" /> Channel anlegen
          </Button>
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  brandId: string;
  channel: NotificationChannel;
  onUpdate: (patch: NotificationChannelUpdate) => Promise<void>;
  onDelete: () => Promise<void>;
  onTest: () => Promise<void>;
}

function ChannelRow({ channel, onUpdate, onDelete, onTest }: RowProps) {
  const [name, setName] = useState(channel.name);
  const [isActive, setIsActive] = useState(channel.isActive);
  const [replaceUrl, setReplaceUrl] = useState("");
  const [mention, setMention] = useState((channel.config?.mention as string) ?? "");
  const [events, setEvents] = useState<Record<NotificationLeadEvent, boolean>>({
    "lead.created": channel.eventsEnabled.includes("lead.created"),
    "lead.appointment_booked": channel.eventsEnabled.includes("lead.appointment_booked"),
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(channel.name);
    setIsActive(channel.isActive);
    setMention((channel.config?.mention as string) ?? "");
    setEvents({
      "lead.created": channel.eventsEnabled.includes("lead.created"),
      "lead.appointment_booked": channel.eventsEnabled.includes("lead.appointment_booked"),
    });
  }, [channel]);

  const save = async () => {
    setBusy(true);
    try {
      const patch: NotificationChannelUpdate = {
        name: name.trim(),
        isActive,
        eventsEnabled: ALL_EVENTS.map(e => e.value).filter(v => events[v]),
        config: channel.kind === "slack"
          ? { ...(channel.config ?? {}), mention: mention.trim() }
          : (channel.config ?? {}),
      };
      if (replaceUrl.trim()) patch.webhookUrl = replaceUrl.trim();
      await onUpdate(patch);
      setReplaceUrl("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-md border p-3 space-y-2" data-testid={`notif-channel-row-${channel.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide rounded bg-muted px-1.5 py-0.5">
            {channel.kind}
          </span>
          <span className="font-medium text-sm">{channel.name}</span>
          {!channel.isActive && (
            <span className="text-xs text-muted-foreground">(inaktiv)</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => { void onTest(); }}
            data-testid={`notif-channel-test-${channel.id}`}
            title="Test-Nachricht senden"
          >
            <Send className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (window.confirm(`Channel "${channel.name}" wirklich löschen?`)) {
                void onDelete();
              }
            }}
            data-testid={`notif-channel-delete-${channel.id}`}
            title="Löschen"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground font-mono break-all">
        {channel.webhookUrlPreview}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid={`notif-channel-name-${channel.id}`}
          />
        </div>
        <div className="flex items-end gap-2 pb-1">
          <Switch
            checked={isActive}
            onCheckedChange={setIsActive}
            data-testid={`notif-channel-active-${channel.id}`}
          />
          <Label className="text-xs">Aktiv</Label>
        </div>
      </div>
      <div>
        <Label className="text-xs">Webhook-URL ersetzen (optional)</Label>
        <Input
          value={replaceUrl}
          onChange={(e) => setReplaceUrl(e.target.value)}
          placeholder="leer lassen = bestehenden URL behalten"
          data-testid={`notif-channel-url-${channel.id}`}
        />
      </div>
      {channel.kind === "slack" && (
        <div>
          <Label className="text-xs">Mention (optional)</Label>
          <Input
            value={mention}
            onChange={(e) => setMention(e.target.value)}
            placeholder="<!channel> / <@U12345>"
            data-testid={`notif-channel-mention-${channel.id}`}
          />
        </div>
      )}
      <div>
        <Label className="text-xs">Events</Label>
        <div className="flex flex-wrap gap-3 pt-1">
          {ALL_EVENTS.map(e => (
            <label key={e.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={!!events[e.value]}
                onCheckedChange={(v) => setEvents(p => ({ ...p, [e.value]: !!v }))}
                data-testid={`notif-channel-${channel.id}-event-${e.value}`}
              />
              {e.label}
            </label>
          ))}
        </div>
      </div>

      {channel.lastErrorMessage ? (
        <p className="text-xs text-destructive flex items-start gap-1" data-testid={`notif-channel-error-${channel.id}`}>
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <strong>Letzter Fehler:</strong> {channel.lastErrorMessage}
            {channel.lastErrorAt ? ` (${new Date(channel.lastErrorAt).toLocaleString()})` : null}
          </span>
        </p>
      ) : channel.lastTestStatus === "ok" ? (
        <p className="text-xs text-green-600 flex items-center gap-1" data-testid={`notif-channel-ok-${channel.id}`}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Letzter Test erfolgreich
          {channel.lastTestAt ? ` (${new Date(channel.lastTestAt).toLocaleString()})` : null}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button size="sm" onClick={save} disabled={busy} data-testid={`notif-channel-save-${channel.id}`}>
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Speichern
        </Button>
      </div>
    </li>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBrandWidget,
  useUpdateBrandWidget,
  useRotateBrandWidgetKey,
  useListUsers,
  getGetBrandWidgetQueryKey,
  type BrandWidget,
  type BrandWidgetUpdate,
  type WidgetField,
  type WidgetRoutingRule,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, RefreshCw, Copy, Check } from "lucide-react";

interface Props {
  brandId: string;
}

type FieldDraft = WidgetField & { _key: string };
type RuleDraft = WidgetRoutingRule & { _key: string };

function fieldsToDraft(fields: WidgetField[] | undefined | null): FieldDraft[] {
  return (fields ?? []).map((f, i) => ({ ...f, _key: `${f.key}-${i}` }));
}

function rulesToDraft(rules: WidgetRoutingRule[] | undefined | null): RuleDraft[] {
  return (rules ?? []).map((r, i) => ({ ...r, _key: r.id ?? `r-${i}` }));
}

/**
 * Brand-Lead-Widget Konfiguration (Task #262).
 *
 * Owner-Hinweis: Der eigentliche Brand-CRUD läuft in BrandFormDialog;
 * Widget-Settings sind kein Bestandteil von POST /brands oder PATCH /brands —
 * sie werden in eigenen Endpunkten unter /brands/:id/widget gepflegt und sind
 * deshalb erst nach dem ersten Speichern der Brand verfügbar.
 *
 * Save-Semantik dieses Sub-Forms:
 *   - "Speichern" patched ausschließlich Widget-Felder.
 *   - Sichtbares Snippet enthält Brand-spezifischen Public-Key.
 *   - "Schlüssel rotieren" erzeugt Public-Key + Cal-Secret neu (irreversibel).
 */
export function BrandWidgetSettings({ brandId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error } = useGetBrandWidget(brandId);
  const { data: users = [] } = useListUsers();
  const updateMut = useUpdateBrandWidget();
  const rotateMut = useRotateBrandWidgetKey();

  const [enabled, setEnabled] = useState(false);
  const [greeting, setGreeting] = useState("");
  const [thankYou, setThankYou] = useState("");
  const [submitLabel, setSubmitLabel] = useState("");
  const [calComEnabled, setCalComEnabled] = useState(false);
  const [calComUrl, setCalComUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [fields, setFields] = useState<FieldDraft[]>([]);
  const [rules, setRules] = useState<RuleDraft[]>([]);
  const [copied, setCopied] = useState<"snippet" | "key" | "secret" | null>(null);

  // Hydrate state from API.
  useEffect(() => {
    if (!data) return;
    setEnabled(!!data.enabled);
    setGreeting(data.config.greeting ?? "");
    setThankYou(data.config.thankYou ?? "");
    setSubmitLabel(data.config.submitLabel ?? "");
    setCalComEnabled(!!data.config.calComEnabled);
    setCalComUrl(data.config.calComUrl ?? "");
    setPrimaryColor(data.config.primaryColor ?? "");
    setFields(fieldsToDraft(data.config.fields));
    setRules(rulesToDraft(data.routingRules));
  }, [data]);

  const snippetUrl = useMemo(() => {
    // Snippet zeigt direkt auf den Public-Endpoint; absolut, damit Embedding
    // auf Fremd-Domains (Marketing-Pages) funktioniert.
    if (typeof window === "undefined") return "/api/external/widget/embed.js";
    return `${window.location.origin}/api/external/widget/embed.js`;
  }, []);

  const snippet = data?.publicKey
    ? `<script src="${snippetUrl}" data-public-key="${data.publicKey}" async></script>`
    : "";

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading widget settings…
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="text-sm text-destructive py-2">
        Failed to load widget settings.
      </p>
    );
  }

  const copy = async (kind: "snippet" | "key" | "secret", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const addField = () => {
    setFields((prev) => [
      ...prev,
      { _key: `new-${prev.length}-${Date.now()}`, key: "", label: "", type: "text", required: false },
    ]);
  };
  const updateField = (idx: number, patch: Partial<FieldDraft>) => {
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };
  const removeField = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      { _key: `new-${prev.length}-${Date.now()}`, match: { field: "email", op: "domain", value: "" }, ownerId: "" },
    ]);
  };
  const updateRule = (idx: number, patch: Partial<RuleDraft>) => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const updateRuleMatch = (idx: number, patch: Partial<RuleDraft["match"]>) => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, match: { ...r.match, ...patch } } : r)));
  };
  const removeRule = (idx: number) => {
    setRules((prev) => prev.filter((_, i) => i !== idx));
  };

  const save = async () => {
    // Validate fields: keys must be non-empty + unique; selects need options.
    const seenKeys = new Set<string>();
    for (const f of fields) {
      const key = f.key.trim();
      if (!key) {
        toast({ title: "Each field needs a key", variant: "destructive" });
        return;
      }
      if (seenKeys.has(key)) {
        toast({ title: `Duplicate field key: ${key}`, variant: "destructive" });
        return;
      }
      seenKeys.add(key);
      if (f.type === "select") {
        const opts = (f.options ?? []).map((o) => o.trim()).filter(Boolean);
        if (opts.length === 0) {
          toast({ title: `Field "${key}" needs options`, variant: "destructive" });
          return;
        }
      }
    }
    for (const r of rules) {
      if (!r.ownerId) {
        toast({ title: "Each routing rule needs an owner", variant: "destructive" });
        return;
      }
      if (!r.match.value.trim()) {
        toast({ title: "Each routing rule needs a match value", variant: "destructive" });
        return;
      }
    }
    if (calComEnabled && !calComUrl.trim()) {
      toast({ title: "Cal.com URL required when enabled", variant: "destructive" });
      return;
    }

    const payload: BrandWidgetUpdate = {
      enabled,
      config: {
        greeting: greeting.trim() || null,
        thankYou: thankYou.trim() || null,
        submitLabel: submitLabel.trim() || null,
        primaryColor: primaryColor.trim() || null,
        calComEnabled,
        calComUrl: calComUrl.trim() || null,
        fields: fields.map((f) => ({
          key: f.key.trim(),
          label: f.label.trim() || f.key.trim(),
          type: f.type,
          required: !!f.required,
          options: f.type === "select" ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined,
        })),
      },
      routingRules: rules.map((r) => ({
        id: r.id,
        match: { field: r.match.field, op: r.match.op, value: r.match.value.trim() },
        ownerId: r.ownerId,
      })),
    };

    try {
      const updated = await updateMut.mutateAsync({ id: brandId, data: payload });
      void qc.invalidateQueries({ queryKey: getGetBrandWidgetQueryKey(brandId) });
      // Re-hydrate from the canonical server response so any defaults the
      // backend filled in (e.g. first-activation public key) become visible.
      reflect(updated);
      toast({ title: "Widget settings saved" });
    } catch (e: unknown) {
      const body = (e as { response?: { data?: { error?: string } } })?.response?.data;
      toast({
        title: "Save failed",
        description: body?.error ?? (e instanceof Error ? e.message : "Unknown error"),
        variant: "destructive",
      });
    }
  };

  function reflect(updated: BrandWidget) {
    setEnabled(!!updated.enabled);
    setGreeting(updated.config.greeting ?? "");
    setThankYou(updated.config.thankYou ?? "");
    setSubmitLabel(updated.config.submitLabel ?? "");
    setCalComEnabled(!!updated.config.calComEnabled);
    setCalComUrl(updated.config.calComUrl ?? "");
    setPrimaryColor(updated.config.primaryColor ?? "");
    setFields(fieldsToDraft(updated.config.fields));
    setRules(rulesToDraft(updated.routingRules));
  }

  const rotate = async () => {
    if (!confirm("Rotate the public key + Cal.com secret? Existing snippets must be re-embedded.")) return;
    try {
      await rotateMut.mutateAsync({ id: brandId });
      void qc.invalidateQueries({ queryKey: getGetBrandWidgetQueryKey(brandId) });
      toast({ title: "Widget keys rotated" });
    } catch (e: unknown) {
      toast({
        title: "Rotate failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const busy = updateMut.isPending || rotateMut.isPending;

  return (
    <div className="space-y-5" data-testid="brand-widget-settings">
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="widget-enabled" className="text-sm font-medium">
            Lead-widget enabled
          </Label>
          <p className="text-xs text-muted-foreground">
            Public form on this brand's marketing page; submits create leads in this brand's pipeline.
          </p>
        </div>
        <Switch
          id="widget-enabled"
          checked={enabled}
          onCheckedChange={setEnabled}
          data-testid="switch-widget-enabled"
        />
      </div>

      {/* Snippet + keys */}
      {data.publicKey ? (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Embed snippet</Label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={rotate}
              disabled={busy}
              data-testid="button-widget-rotate"
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Rotate keys
            </Button>
          </div>
          <div className="flex items-stretch gap-2">
            <Textarea
              readOnly
              value={snippet}
              rows={2}
              className="font-mono text-xs"
              data-testid="textarea-widget-snippet"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => copy("snippet", snippet)}
              aria-label="Copy snippet"
            >
              {copied === "snippet" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            <div className="space-y-0.5">
              <span className="text-muted-foreground">Public key</span>
              <div className="flex items-center gap-1">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1">{data.publicKey}</code>
                <Button type="button" size="sm" variant="ghost" onClick={() => copy("key", data.publicKey ?? "")}>
                  {copied === "key" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            <div className="space-y-0.5">
              <span className="text-muted-foreground">Cal.com webhook secret</span>
              <div className="flex items-center gap-1">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1">{data.calSecret ?? "—"}</code>
                {data.calSecret && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => copy("secret", data.calSecret ?? "")}>
                    {copied === "secret" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Save with widget enabled to generate the public key + embed snippet.
        </p>
      )}

      {/* Texts */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="widget-greeting">Greeting</Label>
          <Textarea
            id="widget-greeting"
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={2}
            placeholder="Tell us a bit about your project — we'll get back within one business day."
            data-testid="input-widget-greeting"
          />
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="widget-submit-label">Submit button</Label>
            <Input
              id="widget-submit-label"
              value={submitLabel}
              onChange={(e) => setSubmitLabel(e.target.value)}
              placeholder="Send request"
              data-testid="input-widget-submit-label"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="widget-color">Primary color (override)</Label>
            <div className="flex gap-2">
              <Input
                id="widget-color"
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : "#2D6CDF"}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="w-14 p-1"
              />
              <Input
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="flex-1 font-mono"
                placeholder="(brand default)"
              />
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="widget-thank-you">Thank-you message</Label>
          <Textarea
            id="widget-thank-you"
            value={thankYou}
            onChange={(e) => setThankYou(e.target.value)}
            rows={2}
            placeholder="Thanks! We received your request and will be in touch shortly."
            data-testid="input-widget-thank-you"
          />
        </div>
      </div>

      {/* Qualifier fields */}
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Qualifier fields</Label>
            <p className="text-xs text-muted-foreground">
              Extra fields shown after name + email. Stored as <code>lead.widgetMeta.qualifier</code>.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={addField} data-testid="button-widget-add-field">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add field
          </Button>
        </div>
        {fields.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No qualifier fields yet.</p>
        )}
        <div className="space-y-2">
          {fields.map((f, idx) => (
            <div key={f._key} className="rounded border bg-card p-2 space-y-2" data-testid={`widget-field-${idx}`}>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_140px_auto] gap-2">
                <Input
                  value={f.key}
                  onChange={(e) => updateField(idx, { key: e.target.value })}
                  placeholder="key (e.g. industry)"
                  className="font-mono text-xs"
                />
                <Input
                  value={f.label}
                  onChange={(e) => updateField(idx, { label: e.target.value })}
                  placeholder="Label"
                />
                <Select
                  value={f.type}
                  onValueChange={(v) => updateField(idx, { type: v as WidgetField["type"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="textarea">Textarea</SelectItem>
                    <SelectItem value="select">Select</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button" size="sm" variant="ghost"
                  onClick={() => removeField(idx)}
                  aria-label="Remove field"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!f.required}
                    onChange={(e) => updateField(idx, { required: e.target.checked })}
                  />
                  Required
                </label>
                {f.type === "select" && (
                  <Input
                    value={(f.options ?? []).join(", ")}
                    onChange={(e) => updateField(idx, { options: e.target.value.split(",").map((s) => s.trim()) })}
                    placeholder="Comma-separated options"
                    className="text-xs"
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Cal.com */}
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Cal.com booking</Label>
            <p className="text-xs text-muted-foreground">
              After submit, the visitor can book a slot. Bookings get linked to the lead via webhook.
            </p>
          </div>
          <Switch
            checked={calComEnabled}
            onCheckedChange={setCalComEnabled}
            data-testid="switch-widget-cal-enabled"
          />
        </div>
        {calComEnabled && (
          <div className="space-y-1.5">
            <Label htmlFor="widget-cal-url">Cal.com URL</Label>
            <Input
              id="widget-cal-url"
              value={calComUrl}
              onChange={(e) => setCalComUrl(e.target.value)}
              placeholder="https://cal.com/team/intro/30min"
              data-testid="input-widget-cal-url"
            />
            {data.calSecret && (
              <p className="text-xs text-muted-foreground">
                Webhook URL:{" "}
                <code className="rounded bg-muted px-1">
                  {typeof window !== "undefined" ? window.location.origin : ""}
                  /api/external/widget/{data.publicKey}/cal-webhook
                </code>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Routing rules */}
      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Owner routing</Label>
            <p className="text-xs text-muted-foreground">
              First matching rule wins. Without rules, leads stay unassigned.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={addRule} data-testid="button-widget-add-rule">
            <Plus className="mr-1 h-3.5 w-3.5" /> Add rule
          </Button>
        </div>
        {rules.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No routing rules — leads remain unassigned.</p>
        )}
        <div className="space-y-2">
          {rules.map((r, idx) => (
            <div key={r._key} className="rounded border bg-card p-2 space-y-2" data-testid={`widget-rule-${idx}`}>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_1fr_auto] gap-2">
                <Input
                  value={r.match.field}
                  onChange={(e) => updateRuleMatch(idx, { field: e.target.value })}
                  placeholder="field (email, domain, qualifier.industry)"
                  className="font-mono text-xs"
                />
                <Select
                  value={r.match.op}
                  onValueChange={(v) => updateRuleMatch(idx, { op: v as WidgetRoutingRule["match"]["op"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equals">equals</SelectItem>
                    <SelectItem value="contains">contains</SelectItem>
                    <SelectItem value="domain">domain</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={r.match.value}
                  onChange={(e) => updateRuleMatch(idx, { value: e.target.value })}
                  placeholder="value (e.g. acme.com)"
                />
                <Button
                  type="button" size="sm" variant="ghost"
                  onClick={() => removeRule(idx)}
                  aria-label="Remove rule"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">→ Owner</span>
                <Select value={r.ownerId} onValueChange={(v) => updateRule(idx, { ownerId: v })}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Select owner…" /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.name ?? u.email ?? u.id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy} data-testid="button-widget-save">
          {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save widget settings
        </Button>
      </div>
    </div>
  );
}

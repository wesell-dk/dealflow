import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useListClauseSuggestions,
  useGetClauseSuggestion,
  useDecideClauseSuggestion,
  useGetClauseSuggestionConfig,
  useUpdateClauseSuggestionConfig,
  useGetClauseSuggestionStats,
  getListClauseSuggestionsQueryKey,
  getGetClauseSuggestionQueryKey,
  getGetClauseSuggestionStatsQueryKey,
  getGetClauseSuggestionConfigQueryKey,
  getListClauseFamiliesQueryKey,
  type ClauseSuggestion,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Inbox,
  GitCompare,
  CheckCircle2,
  XCircle,
  Languages,
  Sparkles,
  Layers,
  Settings,
  ArrowLeft,
  History,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/auth-context";
import { SuggestionStatusBadge, TONE_TEXT_CLASSES, type Tone } from "@/components/patterns/status-badges";

function diffWords(a: string, b: string): { text: string; kind: "same" | "add" | "del" }[] {
  const aw = a.split(/(\s+)/);
  const bw = b.split(/(\s+)/);
  const m = aw.length, n = bw.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aw[i] === bw[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: { text: string; kind: "same" | "add" | "del" }[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (aw[i] === bw[j]) { out.push({ text: aw[i], kind: "same" }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ text: aw[i], kind: "del" }); i++; }
    else { out.push({ text: bw[j], kind: "add" }); j++; }
  }
  while (i < m) { out.push({ text: aw[i++], kind: "del" }); }
  while (j < n) { out.push({ text: bw[j++], kind: "add" }); }
  return out;
}


type Action = "new_variant" | "replace_variant" | "add_translation" | "discard";

export default function ClausesSuggestions() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdmin = !!(user?.isPlatformAdmin || user?.role === "Tenant Admin");

  const [statusFilter, setStatusFilter] = useState<"open" | "accepted" | "rejected" | "all">("open");
  const [sourceFilter, setSourceFilter] = useState<"ad-hoc" | "edit" | "all">("all");
  const [familyFilter, setFamilyFilter] = useState<string>("all");

  const params = useMemo(() => {
    const p: Record<string, string> = {};
    if (statusFilter !== "all") p.status = statusFilter;
    if (sourceFilter !== "all") p.sourceType = sourceFilter;
    if (familyFilter !== "all") p.familyId = familyFilter;
    return p;
  }, [statusFilter, sourceFilter, familyFilter]);

  const { data: suggestions, isLoading } = useListClauseSuggestions(params);
  const { data: stats } = useGetClauseSuggestionStats({ days: 30 });
  const { data: config } = useGetClauseSuggestionConfig();

  const [openId, setOpenId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 border-b pb-4">
        <Inbox className="h-8 w-8 text-muted-foreground" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="suggestions-title">
            {t("pages.clauseSuggestions.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("pages.clauseSuggestions.subtitle")}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link href="/clauses">
            <Button variant="outline" size="sm" data-testid="back-to-clauses">
              <ArrowLeft className="h-4 w-4 mr-1" />
              {t("pages.clauseSuggestions.backToLibrary")}
            </Button>
          </Link>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setShowSettings(true)} data-testid="open-settings">
              <Settings className="h-4 w-4 mr-1" />
              {t("pages.clauseSuggestions.thresholds")}
            </Button>
          )}
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            icon={<Sparkles className="h-4 w-4" />}
            label={t("pages.clauseSuggestions.statOpen")}
            value={stats.open}
            tone="amber"
            testId="stat-open"
          />
          <StatTile
            icon={<CheckCircle2 className="h-4 w-4" />}
            label={t("pages.clauseSuggestions.statAccepted")}
            value={stats.accepted}
            tone="emerald"
            testId="stat-accepted"
          />
          <StatTile
            icon={<XCircle className="h-4 w-4" />}
            label={t("pages.clauseSuggestions.statRejected")}
            value={stats.rejected}
            tone="rose"
            testId="stat-rejected"
          />
          <StatTile
            icon={<Layers className="h-4 w-4" />}
            label={t("pages.clauseSuggestions.statTotal")}
            value={stats.total}
            tone="sky"
            testId="stat-total"
          />
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("pages.clauseSuggestions.filters")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">{t("common.status")}</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="h-9 w-40" data-testid="filter-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">{t("pages.clauseSuggestions.statusOpen")}</SelectItem>
                <SelectItem value="accepted">{t("pages.clauseSuggestions.statusAccepted")}</SelectItem>
                <SelectItem value="rejected">{t("pages.clauseSuggestions.statusRejected")}</SelectItem>
                <SelectItem value="all">{t("common.all")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.source")}</Label>
            <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as typeof sourceFilter)}>
              <SelectTrigger className="h-9 w-40" data-testid="filter-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")}</SelectItem>
                <SelectItem value="edit">{t("pages.clauseSuggestions.sourceEdit")}</SelectItem>
                <SelectItem value="ad-hoc">{t("pages.clauseSuggestions.sourceAdHoc")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(stats?.byFamily?.length ?? 0) > 0 && (
            <div>
              <Label className="text-xs">{t("pages.clauseSuggestions.family")}</Label>
              <Select value={familyFilter} onValueChange={setFamilyFilter}>
                <SelectTrigger className="h-9 w-56" data-testid="filter-family">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.all")}</SelectItem>
                  {stats?.byFamily?.map(f => (
                    <SelectItem key={f.familyId} value={f.familyId}>
                      {f.familyName} ({f.open})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (suggestions?.length ?? 0) === 0 ? (
        <div className="p-12 text-center border rounded-md text-muted-foreground bg-muted/10">
          {t("pages.clauseSuggestions.empty")}
        </div>
      ) : (
        <div className="grid gap-3">
          {suggestions?.map(s => (
            <SuggestionRow key={s.id} s={s} onOpen={() => setOpenId(s.id)} />
          ))}
        </div>
      )}

      {openId && (
        <SuggestionDialog
          id={openId}
          onClose={() => setOpenId(null)}
          isAdmin={isAdmin}
          onDecided={async () => {
            await Promise.all([
              qc.invalidateQueries({ queryKey: getListClauseSuggestionsQueryKey(params) }),
              qc.invalidateQueries({ queryKey: getGetClauseSuggestionStatsQueryKey({ days: 30 }) }),
              qc.invalidateQueries({ queryKey: getListClauseFamiliesQueryKey() }),
            ]);
            setOpenId(null);
            toast({ title: t("pages.clauseSuggestions.toastDecided") });
          }}
        />
      )}

      {showSettings && config && (
        <SettingsDialog
          config={config}
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            await qc.invalidateQueries({ queryKey: getGetClauseSuggestionConfigQueryKey() });
            setShowSettings(false);
            toast({ title: t("pages.clauseSuggestions.toastConfigSaved") });
          }}
        />
      )}
    </div>
  );
}

function StatTile({
  icon, label, value, tone, testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "amber" | "emerald" | "rose" | "sky";
  testId: string;
}) {
  const toneMap: Record<typeof tone, Tone> = {
    amber: "warning",
    emerald: "success",
    rose: "danger",
    sky: "info",
  };
  const colorClass = TONE_TEXT_CLASSES[toneMap[tone]];
  return (
    <Card data-testid={testId}>
      <CardContent className="py-4 flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
          <div className={`text-2xl font-bold tabular-nums ${colorClass}`}>{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function SuggestionRow({ s, onOpen }: { s: ClauseSuggestion; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <Card
      className="hover:bg-muted/30 transition cursor-pointer"
      onClick={onOpen}
      data-testid={`suggestion-row-${s.id}`}
    >
      <CardContent className="py-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{s.proposedName}</span>
            {s.familyName && <Badge variant="outline" className="text-xs">{s.familyName}</Badge>}
            <SuggestionStatusBadge
              status={s.status}
              label={t(`pages.clauseSuggestions.status${s.status[0].toUpperCase()}${s.status.slice(1)}`, s.status)}
            />
            <Badge variant="outline" className="text-xs">
              {s.sourceType === "edit" ? t("pages.clauseSuggestions.sourceEdit") : t("pages.clauseSuggestions.sourceAdHoc")}
            </Badge>
            {s.diffPct != null && (
              <span className="text-xs text-muted-foreground">
                <GitCompare className="h-3 w-3 inline mr-0.5" />
                {s.diffPct}% {t("pages.clauseSuggestions.diff")}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              <History className="h-3 w-3 inline mr-0.5" />
              {s.occurrenceCount}× {t("pages.clauseSuggestions.seen")}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{s.proposedSummary}</p>
          <div className="text-xs text-muted-foreground mt-1.5">
            {s.authorName && <span>{s.authorName} · </span>}
            {new Date(s.lastSeenAt).toLocaleString()}
            {s.baseVariantName && (
              <span className="ml-2">
                {t("pages.clauseSuggestions.baseVariant")}: <strong>{s.baseVariantName}</strong>
              </span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SuggestionDialog({
  id, onClose, isAdmin, onDecided,
}: {
  id: string;
  onClose: () => void;
  isAdmin: boolean;
  onDecided: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: detail, isLoading } = useGetClauseSuggestion(id);
  const decide = useDecideClauseSuggestion();
  const [action, setAction] = useState<Action>("new_variant");
  const [tone, setTone] = useState("standard");
  const [severity, setSeverity] = useState("medium");
  const [severityScore, setSeverityScore] = useState<number>(3);
  const [replaceVariantId, setReplaceVariantId] = useState<string>("");
  const [translationVariantId, setTranslationVariantId] = useState<string>("");
  const [locale, setLocale] = useState<"de" | "en">("en");
  const [decisionNote, setDecisionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const baseBody = detail?.baseVariantBody ?? "";
  const proposedBody = detail?.proposedBody ?? "";

  async function submit() {
    if (!detail) return;
    setSubmitting(true);
    try {
      await decide.mutateAsync({
        id,
        data: {
          action,
          decisionNote: decisionNote.trim() || undefined,
          ...(action === "new_variant"
            ? { tone, severity, severityScore }
            : action === "replace_variant"
            ? { replaceVariantId: replaceVariantId || detail.baseVariantId || undefined, tone, severity, severityScore }
            : action === "add_translation"
            ? { locale, translationVariantId: translationVariantId || detail.baseVariantId || undefined }
            : {}),
        },
      });
      await qc.invalidateQueries({ queryKey: getGetClauseSuggestionQueryKey(id) });
      await onDecided();
    } catch (e) {
      // Handled by toast in caller scope
      console.error(e);
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        {isLoading || !detail ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                {detail.proposedName}
              </DialogTitle>
              <DialogDescription className="flex flex-wrap gap-2 items-center">
                {detail.familyName && <Badge variant="outline">{detail.familyName}</Badge>}
                <SuggestionStatusBadge
                  status={detail.status}
                  label={t(`pages.clauseSuggestions.status${detail.status[0].toUpperCase()}${detail.status.slice(1)}`, detail.status)}
                />
                <Badge variant="outline">
                  {detail.sourceType === "edit" ? t("pages.clauseSuggestions.sourceEdit") : t("pages.clauseSuggestions.sourceAdHoc")}
                </Badge>
                {detail.diffPct != null && (
                  <span className="text-xs">
                    <GitCompare className="h-3 w-3 inline mr-0.5" />
                    {detail.diffPct}% {t("pages.clauseSuggestions.diff")}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {detail.occurrenceCount}× {t("pages.clauseSuggestions.seen")}
                </span>
                {detail.contractId && (
                  <Link href={`/contracts/${detail.contractId}`}>
                    <span className="text-xs text-primary hover:underline">
                      → {t("pages.clauseSuggestions.fromContract")}
                    </span>
                  </Link>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                  {t("pages.clauseSuggestions.proposedSummary")}
                </div>
                <p className="text-sm border rounded p-3 bg-muted/10">{detail.proposedSummary}</p>
              </div>

              {detail.baseVariantName && (
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                      {t("pages.clauseSuggestions.baseVariant")}: {detail.baseVariantName}
                    </div>
                    <div className="border rounded p-3 text-sm bg-rose-500/5 whitespace-pre-wrap">{baseBody}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">
                      {t("pages.clauseSuggestions.proposedBody")}
                    </div>
                    <div className="border rounded p-3 text-sm bg-emerald-500/5 whitespace-pre-wrap">{proposedBody}</div>
                  </div>
                </div>
              )}

              {detail.baseVariantName && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase mb-1">Redlining</div>
                  <div className="border rounded p-3 text-sm bg-muted/10 leading-relaxed">
                    {diffWords(baseBody, proposedBody).map((seg, i) => (
                      <span
                        key={i}
                        className={
                          seg.kind === "add"
                            ? "bg-emerald-500/20 text-emerald-800 dark:text-emerald-300"
                            : seg.kind === "del"
                            ? "bg-rose-500/20 text-rose-800 dark:text-rose-300 line-through"
                            : ""
                        }
                      >
                        {seg.text}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {detail.status === "open" && isAdmin && (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm">{t("pages.clauseSuggestions.decision")}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <Label className="text-xs">{t("pages.clauseSuggestions.action")}</Label>
                      <Select value={action} onValueChange={(v) => setAction(v as Action)}>
                        <SelectTrigger className="h-9" data-testid="action-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new_variant">
                            {t("pages.clauseSuggestions.actionNewVariant")}
                          </SelectItem>
                          <SelectItem value="replace_variant">
                            {t("pages.clauseSuggestions.actionReplaceVariant")}
                          </SelectItem>
                          <SelectItem value="add_translation">
                            <span className="flex items-center gap-1">
                              <Languages className="h-3 w-3" />
                              {t("pages.clauseSuggestions.actionAddTranslation")}
                            </span>
                          </SelectItem>
                          <SelectItem value="discard">
                            {t("pages.clauseSuggestions.actionDiscard")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {(action === "new_variant" || action === "replace_variant") && (
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label className="text-xs">{t("pages.clauses.toneLabel")}</Label>
                          <Select value={tone} onValueChange={setTone}>
                            <SelectTrigger className="h-9" data-testid="tone-select">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["zart", "moderat", "standard", "streng", "hart"].map(t => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">{t("pages.clauses.overrideSeverity")}</Label>
                          <Select value={severity} onValueChange={setSeverity}>
                            <SelectTrigger className="h-9" data-testid="severity-select">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="low">low</SelectItem>
                              <SelectItem value="medium">medium</SelectItem>
                              <SelectItem value="high">high</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">{t("pages.clauses.severityScore")}</Label>
                          <Input
                            type="number"
                            min={1}
                            max={5}
                            value={severityScore}
                            onChange={(e) => setSeverityScore(Number(e.target.value))}
                            className="h-9"
                            data-testid="severity-score-input"
                          />
                        </div>
                      </div>
                    )}

                    {action === "replace_variant" && (detail.familyVariants?.length ?? 0) > 0 && (
                      <div>
                        <Label className="text-xs">{t("pages.clauseSuggestions.replaceTarget")}</Label>
                        <Select
                          value={replaceVariantId || detail.baseVariantId || ""}
                          onValueChange={setReplaceVariantId}
                        >
                          <SelectTrigger className="h-9" data-testid="replace-target-select">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {detail.familyVariants?.map(v => (
                              <SelectItem key={v.id} value={v.id}>
                                {v.name} · {v.tone} ({v.severityScore})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {action === "add_translation" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">{t("pages.clauses.translationLocale")}</Label>
                          <Select value={locale} onValueChange={(v) => setLocale(v as "de" | "en")}>
                            <SelectTrigger className="h-9" data-testid="locale-select">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="de">{t("pages.clauses.translationLocaleDe")}</SelectItem>
                              <SelectItem value="en">{t("pages.clauses.translationLocaleEn")}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {(detail.familyVariants?.length ?? 0) > 0 && (
                          <div>
                            <Label className="text-xs">{t("pages.clauseSuggestions.translationTarget")}</Label>
                            <Select
                              value={translationVariantId || detail.baseVariantId || ""}
                              onValueChange={setTranslationVariantId}
                            >
                              <SelectTrigger className="h-9" data-testid="translation-target-select">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {detail.familyVariants?.map(v => (
                                  <SelectItem key={v.id} value={v.id}>
                                    {v.name} · {v.tone} ({v.severityScore})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <Label className="text-xs">{t("pages.clauseSuggestions.decisionNote")}</Label>
                      <Textarea
                        value={decisionNote}
                        onChange={(e) => setDecisionNote(e.target.value)}
                        rows={2}
                        placeholder={t("pages.clauseSuggestions.decisionNotePlaceholder")}
                        data-testid="decision-note"
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {detail.status !== "open" && (
                <div className="text-sm border rounded p-3 bg-muted/20">
                  <div className="font-semibold mb-1">{t("pages.clauseSuggestions.alreadyDecided")}</div>
                  {detail.decisionAction && (
                    <div className="text-xs text-muted-foreground">
                      {t("pages.clauseSuggestions.action")}: <strong>{detail.decisionAction}</strong>
                      {detail.decisionBy && <> · {detail.decisionBy}</>}
                      {detail.decisionAt && <> · {new Date(detail.decisionAt).toLocaleString()}</>}
                    </div>
                  )}
                  {detail.decisionNote && <p className="text-xs mt-1">{detail.decisionNote}</p>}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={onClose} data-testid="cancel-button">
                {t("common.cancel")}
              </Button>
              {detail.status === "open" && isAdmin && (
                <Button onClick={submit} disabled={submitting} data-testid="submit-decision">
                  {submitting ? t("common.loading") : t("common.save")}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({
  config, onClose, onSaved,
}: {
  config: { diffThresholdPct: number; repeatThreshold: number };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const update = useUpdateClauseSuggestionConfig();
  const [diff, setDiff] = useState(config.diffThresholdPct);
  const [rep, setRep] = useState(config.repeatThreshold);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await update.mutateAsync({ data: { diffThresholdPct: diff, repeatThreshold: rep } });
      await onSaved();
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pages.clauseSuggestions.thresholds")}</DialogTitle>
          <DialogDescription>{t("pages.clauseSuggestions.thresholdsHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.diffThresholdPct")}</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={diff}
              onChange={(e) => setDiff(Number(e.target.value))}
              data-testid="diff-threshold-input"
            />
          </div>
          <div>
            <Label className="text-xs">{t("pages.clauseSuggestions.repeatThreshold")}</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={rep}
              onChange={(e) => setRep(Number(e.target.value))}
              data-testid="repeat-threshold-input"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button onClick={save} disabled={saving} data-testid="save-thresholds">
            {saving ? t("common.loading") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

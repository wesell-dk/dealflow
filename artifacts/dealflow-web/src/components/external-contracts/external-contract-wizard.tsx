import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRequestExternalContractUploadUrl,
  useExtractExternalContractFields,
  useCreateExternalContract,
  useListBrands,
  useListContractTypes,
  getListExternalContractsQueryKey,
  type ExternalContractDraftFields,
  type ExternalContractParty,
  type ExternalContractPartyRole,
  type ExternalContractClauseFamily,
  type ExternalContractExtractResponse,
} from "@workspace/api-client-react";
import { AIConfidenceBadge } from "@/components/copilot/ai-confidence-badge";
import { AIFeedbackButtons } from "@/components/copilot/ai-feedback-buttons";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Upload, Sparkles, Check, AlertTriangle, Trash2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const ALLOWED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_BYTES = 20 * 1024 * 1024;

const PARTY_ROLES: ExternalContractPartyRole[] = [
  "customer",
  "supplier",
  "our_entity",
  "third_party",
  "unknown",
];

const ROLE_LABEL: Record<ExternalContractPartyRole, string> = {
  customer: "Kunde",
  supplier: "Lieferant",
  our_entity: "Eigene Firma",
  third_party: "Dritter",
  unknown: "Unbekannt",
};

const EMPTY_DRAFT: ExternalContractDraftFields = {
  title: null,
  contractTypeGuess: null,
  parties: [],
  currency: null,
  valueAmount: null,
  effectiveFrom: null,
  effectiveTo: null,
  autoRenewal: false,
  renewalNoticeDays: null,
  terminationNoticeDays: null,
  governingLaw: null,
  jurisdiction: null,
  identifiedClauseFamilies: [],
  confidence: {},
  // Task #69: aggregierte Konfidenz fuer den Wizard. Bevor die KI laeuft,
  // ist der Default "low" plus Hinweis, dass der User selber pruefen muss.
  overallConfidence: "low",
  overallConfidenceReason: "Noch keine KI-Auswertung verfügbar.",
  notes: [],
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  defaultBrandId?: string | null;
};

type Step = 1 | 2 | 3;

function ConfidenceBadge({ value }: { value?: number }) {
  if (value === undefined || value === null) return null;
  const pct = Math.round(value * 100);
  const color =
    pct >= 80
      ? "bg-green-500/15 text-green-700 dark:text-green-400"
      : pct >= 50
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
      : "bg-red-500/15 text-red-700 dark:text-red-400";
  return (
    <span className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${color}`}>
      {pct}%
    </span>
  );
}

export function ExternalContractWizard({ open, onOpenChange, accountId, defaultBrandId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [brandId, setBrandId] = useState<string>(defaultBrandId ?? "__none__");
  const [contractTypeCode, setContractTypeCode] = useState<string>("__none__");
  const [busy, setBusy] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(true);
  const [aiInvocationId, setAiInvocationId] = useState<string | null>(null);
  const [aiExtraction, setAiExtraction] = useState<ExternalContractExtractResponse | null>(null);
  const [objectPath, setObjectPath] = useState<string>("");
  const [draft, setDraft] = useState<ExternalContractDraftFields>(EMPTY_DRAFT);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: brands = [] } = useListBrands();
  const { data: contractTypes = [] } = useListContractTypes();
  const requestUrlMut = useRequestExternalContractUploadUrl();
  const extractMut = useExtractExternalContractFields();
  const createMut = useCreateExternalContract();

  const reset = () => {
    setStep(1);
    setFile(null);
    setBrandId(defaultBrandId ?? "__none__");
    setContractTypeCode("__none__");
    setBusy(false);
    setAiAvailable(true);
    setAiInvocationId(null);
    setAiExtraction(null);
    setObjectPath("");
    setDraft(EMPTY_DRAFT);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    onOpenChange(false);
    setTimeout(reset, 200);
  };

  const handleNextFromStep1 = async () => {
    if (!file) {
      toast({ title: "Bitte Datei auswählen", variant: "destructive" });
      return;
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      toast({ title: "Nur PDF oder DOCX erlaubt", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "Datei zu groß (max. 20 MB)", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const upload = await requestUrlMut.mutateAsync({
        data: { fileName: file.name, size: file.size, contentType: file.type },
      });
      const putRes = await fetch(upload.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload fehlgeschlagen: ${putRes.status}`);
      setObjectPath(upload.objectPath);

      const extraction = await extractMut.mutateAsync({
        data: {
          objectPath: upload.objectPath,
          fileName: file.name,
          mimeType: file.type,
          accountId,
        },
      });
      setAiAvailable(extraction.aiAvailable);
      setAiInvocationId(extraction.invocationId ?? null);
      setAiExtraction(extraction);
      const sug = extraction.suggestion;
      setDraft({
        ...sug,
        title: sug.title ?? file.name.replace(/\.(pdf|docx)$/i, ""),
      });
      if (sug.contractTypeGuess && contractTypeCode === "__none__") {
        const match = contractTypes.find(
          (c) => c.code.toLowerCase() === sug.contractTypeGuess?.toLowerCase()
        );
        if (match) setContractTypeCode(match.code);
      }
      if (!extraction.aiAvailable) {
        toast({
          title: "KI nicht verfügbar",
          description: "Bitte Felder manuell ausfüllen.",
        });
      }
      setStep(2);
    } catch (e) {
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!file) return;
    if (!draft.title || draft.title.trim().length === 0) {
      toast({ title: "Titel ist Pflicht", variant: "destructive" });
      setStep(2);
      return;
    }
    setBusy(true);
    try {
      const created = await createMut.mutateAsync({
        data: {
          accountId,
          brandId: brandId === "__none__" ? null : brandId,
          contractTypeCode: contractTypeCode === "__none__" ? null : contractTypeCode,
          objectPath,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          title: draft.title,
          parties: draft.parties,
          currency: draft.currency ?? null,
          valueAmount: draft.valueAmount ? Number(draft.valueAmount) : null,
          effectiveFrom: draft.effectiveFrom ?? null,
          effectiveTo: draft.effectiveTo ?? null,
          autoRenewal: draft.autoRenewal,
          renewalNoticeDays: draft.renewalNoticeDays ?? null,
          terminationNoticeDays: draft.terminationNoticeDays ?? null,
          governingLaw: draft.governingLaw ?? null,
          jurisdiction: draft.jurisdiction ?? null,
          identifiedClauseFamilies: draft.identifiedClauseFamilies,
          confidence: draft.confidence,
          aiInvocationId: aiInvocationId,
          notes: draft.notes.length > 0 ? draft.notes.join("\n") : null,
        },
      });
      toast({ title: "Vertrag gespeichert" });
      await qc.invalidateQueries({
        queryKey: getListExternalContractsQueryKey({ accountId }),
      });
      await qc.invalidateQueries({
        queryKey: getListExternalContractsQueryKey(),
      });
      void created;
      close();
    } catch (e) {
      toast({
        title: "Speichern fehlgeschlagen",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const updateDraft = <K extends keyof ExternalContractDraftFields>(
    key: K,
    value: ExternalContractDraftFields[K]
  ) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const updateParty = (idx: number, party: Partial<ExternalContractParty>) => {
    setDraft((d) => ({
      ...d,
      parties: d.parties.map((p, i) => (i === idx ? { ...p, ...party } : p)),
    }));
  };

  const addParty = () => {
    setDraft((d) => ({
      ...d,
      parties: [...d.parties, { role: "unknown", name: "" }],
    }));
  };

  const removeParty = (idx: number) => {
    setDraft((d) => ({
      ...d,
      parties: d.parties.filter((_, i) => i !== idx),
    }));
  };

  const updateClause = (idx: number, patch: Partial<ExternalContractClauseFamily>) => {
    setDraft((d) => ({
      ...d,
      identifiedClauseFamilies: d.identifiedClauseFamilies.map((c, i) =>
        i === idx ? { ...c, ...patch } : c
      ),
    }));
  };

  const removeClause = (idx: number) => {
    setDraft((d) => ({
      ...d,
      identifiedClauseFamilies: d.identifiedClauseFamilies.filter((_, i) => i !== idx),
    }));
  };

  const conf = draft.confidence ?? {};

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Externen Vertrag hochladen
            <span className="ml-3 text-sm font-normal text-muted-foreground">
              Schritt {step} von 3
            </span>
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div>
              <Label>Datei (PDF oder DOCX, max. 20 MB)</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                data-testid="external-contract-file-input"
              />
              {file && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Marke (optional)</Label>
                <Select value={brandId} onValueChange={setBrandId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— keine —</SelectItem>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vertragstyp (optional)</Label>
                <Select value={contractTypeCode} onValueChange={setContractTypeCode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— wird ggf. von KI vorgeschlagen —</SelectItem>
                    {contractTypes.map((t) => (
                      <SelectItem key={t.id} value={t.code}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded border bg-muted/30 p-3 text-xs text-muted-foreground">
              Im nächsten Schritt liest die KI Kerndaten aus dem Dokument und schlägt Felder vor.
              Du kannst alles korrigieren, bevor gespeichert wird.
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {!aiAvailable && (
              <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600" />
                <div>
                  <div className="font-medium">KI nicht verfügbar</div>
                  <div className="text-muted-foreground">
                    Bitte Felder manuell ausfüllen. Datei ist bereits hochgeladen.
                  </div>
                </div>
              </div>
            )}
            {aiAvailable && aiExtraction && (
              <div
                className="flex flex-wrap items-center gap-3 rounded border bg-muted/20 p-3 text-sm"
                data-testid="external-contract-ai-confidence-row"
              >
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-medium">KI-Auswertung</span>
                <AIConfidenceBadge
                  level={aiExtraction.confidenceLevel ?? draft.overallConfidence ?? undefined}
                  numeric={aiExtraction.confidence ?? undefined}
                  reason={aiExtraction.confidenceReason ?? draft.overallConfidenceReason ?? undefined}
                  showReason
                  testId="external-contract-confidence"
                />
                {aiExtraction.recommendationId && (
                  <AIFeedbackButtons
                    recommendationId={aiExtraction.recommendationId}
                    testIdPrefix="external-contract-feedback"
                  />
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Titel *<ConfidenceBadge value={conf.title} /></Label>
                <Input
                  value={draft.title ?? ""}
                  onChange={(e) => updateDraft("title", e.target.value)}
                  data-testid="external-contract-title-input"
                />
              </div>
              <div>
                <Label>Währung<ConfidenceBadge value={conf.currency} /></Label>
                <Input
                  value={draft.currency ?? ""}
                  onChange={(e) => updateDraft("currency", e.target.value || null)}
                  placeholder="EUR"
                />
              </div>
              <div>
                <Label>Wert<ConfidenceBadge value={conf.valueAmount} /></Label>
                <Input
                  type="number"
                  value={draft.valueAmount ?? ""}
                  onChange={(e) => updateDraft("valueAmount", e.target.value || null)}
                />
              </div>
              <div>
                <Label>Gültig ab<ConfidenceBadge value={conf.effectiveFrom} /></Label>
                <Input
                  type="date"
                  value={draft.effectiveFrom ?? ""}
                  onChange={(e) => updateDraft("effectiveFrom", e.target.value || null)}
                />
              </div>
              <div>
                <Label>Gültig bis<ConfidenceBadge value={conf.effectiveTo} /></Label>
                <Input
                  type="date"
                  value={draft.effectiveTo ?? ""}
                  onChange={(e) => updateDraft("effectiveTo", e.target.value || null)}
                />
              </div>
              <div>
                <Label>Kündigungsfrist (Tage)<ConfidenceBadge value={conf.terminationNoticeDays} /></Label>
                <Input
                  type="number"
                  value={draft.terminationNoticeDays ?? ""}
                  onChange={(e) =>
                    updateDraft(
                      "terminationNoticeDays",
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              </div>
              <div>
                <Label>Renewal-Frist (Tage)<ConfidenceBadge value={conf.renewalNoticeDays} /></Label>
                <Input
                  type="number"
                  value={draft.renewalNoticeDays ?? ""}
                  onChange={(e) =>
                    updateDraft(
                      "renewalNoticeDays",
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                />
              </div>
              <div>
                <Label>Geltendes Recht<ConfidenceBadge value={conf.governingLaw} /></Label>
                <Input
                  value={draft.governingLaw ?? ""}
                  onChange={(e) => updateDraft("governingLaw", e.target.value || null)}
                  placeholder="DE"
                />
              </div>
              <div>
                <Label>Gerichtsstand<ConfidenceBadge value={conf.jurisdiction} /></Label>
                <Input
                  value={draft.jurisdiction ?? ""}
                  onChange={(e) => updateDraft("jurisdiction", e.target.value || null)}
                />
              </div>
              <div className="col-span-2 flex items-center justify-between rounded border p-3">
                <div className="flex items-center gap-2">
                  <Label htmlFor="autoRenewal">Automatische Verlängerung</Label>
                  <ConfidenceBadge value={conf.autoRenewal} />
                </div>
                <Switch
                  id="autoRenewal"
                  checked={draft.autoRenewal}
                  onCheckedChange={(v) => updateDraft("autoRenewal", v)}
                  data-testid="external-contract-autoRenewal-switch"
                />
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <Label>Vertragsparteien<ConfidenceBadge value={conf.parties} /></Label>
                <Button type="button" variant="outline" size="sm" onClick={addParty}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Partei
                </Button>
              </div>
              <div className="space-y-2">
                {draft.parties.length === 0 && (
                  <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
                    Keine Parteien identifiziert.
                  </div>
                )}
                {draft.parties.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Select
                      value={p.role}
                      onValueChange={(v) =>
                        updateParty(idx, { role: v as ExternalContractPartyRole })
                      }
                    >
                      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PARTY_ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={p.name}
                      onChange={(e) => updateParty(idx, { name: e.target.value })}
                      placeholder="Name der Partei"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeParty(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <Label>Identifizierte Klausel-Familien</Label>
              <div className="mt-2 space-y-1">
                {draft.identifiedClauseFamilies.length === 0 && (
                  <div className="rounded border border-dashed p-3 text-center text-xs text-muted-foreground">
                    Keine Klausel-Familien identifiziert.
                  </div>
                )}
                {draft.identifiedClauseFamilies.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={c.name}
                      onChange={(e) => updateClause(idx, { name: e.target.value })}
                      className="flex-1"
                    />
                    <Badge variant="outline" className="tabular-nums">
                      {Math.round((c.confidence ?? 0) * 100)}%
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeClause(idx)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {draft.notes.length > 0 && (
              <div>
                <Label>KI-Notizen</Label>
                <Textarea
                  readOnly
                  value={draft.notes.join("\n")}
                  rows={3}
                  className="text-xs"
                />
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3 text-sm">
            <div className="rounded border bg-muted/30 p-4">
              <div className="flex items-center gap-2 font-medium">
                <Sparkles className="h-4 w-4 text-primary" /> Zusammenfassung
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                <dt className="text-muted-foreground">Titel</dt>
                <dd className="font-medium">{draft.title || "—"}</dd>
                <dt className="text-muted-foreground">Datei</dt>
                <dd>{file?.name}</dd>
                <dt className="text-muted-foreground">Wert</dt>
                <dd>
                  {draft.valueAmount
                    ? `${Number(draft.valueAmount).toLocaleString("de-DE")} ${draft.currency ?? ""}`
                    : "—"}
                </dd>
                <dt className="text-muted-foreground">Laufzeit</dt>
                <dd>
                  {draft.effectiveFrom ?? "—"} → {draft.effectiveTo ?? "—"}
                </dd>
                <dt className="text-muted-foreground">Auto-Renewal</dt>
                <dd>{draft.autoRenewal ? "Ja" : "Nein"}</dd>
                <dt className="text-muted-foreground">Parteien</dt>
                <dd>
                  {draft.parties.length
                    ? draft.parties.map((p) => `${ROLE_LABEL[p.role]}: ${p.name}`).join(", ")
                    : "—"}
                </dd>
                <dt className="text-muted-foreground">Klausel-Familien</dt>
                <dd>{draft.identifiedClauseFamilies.length}</dd>
              </dl>
            </div>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div>
            {step > 1 && (
              <Button variant="ghost" onClick={() => setStep((s) => (s - 1) as Step)} disabled={busy}>
                Zurück
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={close} disabled={busy}>
              Abbrechen
            </Button>
            {step === 1 && (
              <Button
                onClick={handleNextFromStep1}
                disabled={busy || !file}
                data-testid="external-contract-next-step1"
              >
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Hochladen & analysieren
              </Button>
            )}
            {step === 2 && (
              <Button onClick={() => setStep(3)} data-testid="external-contract-next-step2">
                Weiter
              </Button>
            )}
            {step === 3 && (
              <Button
                onClick={handleSave}
                disabled={busy}
                data-testid="external-contract-save"
              >
                {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Check className="h-4 w-4 mr-2" />}
                Speichern
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

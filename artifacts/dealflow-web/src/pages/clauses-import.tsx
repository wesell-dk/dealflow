import { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRequestClauseImportUploadUrl,
  useCreateClauseImport,
  useListClauseImports,
  useGetClauseImport,
  useDeleteClauseImport,
  useDecideClauseImportSuggestion,
  useListBrands,
  useListContractTypes,
  useListClauseFamilies,
  getListClauseImportsQueryKey,
  getGetClauseImportQueryKey,
  getListClauseFamiliesQueryKey,
  type ClauseImportJob,
  type ClauseImportSuggestion,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Upload,
  ArrowLeft,
  Trash2,
  Download,
  Check,
  X,
  FileText,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

const ALLOWED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_BYTES = 20 * 1024 * 1024;
const NONE = "__none__";

function statusBadge(status: ClauseImportJob["status"], t: (k: string) => string) {
  switch (status) {
    case "extracting":
      return <Badge variant="outline" className="bg-sky-500/10 text-sky-700 border-sky-400/40">{t("pages.clauseImport.statusExtracting")}</Badge>;
    case "processing":
      return <Badge variant="outline" className="bg-violet-500/10 text-violet-700 border-violet-400/40">{t("pages.clauseImport.statusProcessing")}</Badge>;
    case "awaiting_review":
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-400/40">{t("pages.clauseImport.statusAwaitingReview")}</Badge>;
    case "completed":
      return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-400/40">{t("pages.clauseImport.statusCompleted")}</Badge>;
    case "failed":
      return <Badge variant="outline" className="bg-rose-500/10 text-rose-700 border-rose-400/40">{t("pages.clauseImport.statusFailed")}</Badge>;
  }
}

export default function ClausesImportPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const isAdmin = !!(user?.isPlatformAdmin || user?.role === "Tenant Admin");

  // Crude routing: path is /clauses/import or /clauses/import?job=<id>
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(search);
  const activeJobId = params.get("job");

  if (!isAdmin) {
    return (
      <div className="p-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Forbidden
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Only Tenant Admins can import legacy contracts.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (activeJobId) {
    return (
      <ReviewView
        jobId={activeJobId}
        onBack={() => setLocation("/clauses/import")}
      />
    );
  }
  return <ListView onOpenJob={(id) => setLocation(`/clauses/import?job=${id}`)} />;
}

function ListView({ onOpenJob }: { onOpenJob: (id: string) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [brandId, setBrandId] = useState<string>(NONE);
  const [contractTypeCode, setContractTypeCode] = useState<string>(NONE);
  const [language, setLanguage] = useState<"de" | "en">("de");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: brands = [] } = useListBrands();
  const { data: contractTypes = [] } = useListContractTypes();
  const { data: jobs = [], isLoading } = useListClauseImports();

  const requestUpload = useRequestClauseImportUploadUrl();
  const createImport = useCreateClauseImport();
  const deleteImport = useDeleteClauseImport();

  const reset = () => {
    setFile(null);
    setBrandId(NONE);
    setContractTypeCode(NONE);
    setLanguage("de");
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!file) {
      toast({ title: t("pages.clauseImport.filePickError"), variant: "destructive" });
      return;
    }
    if (!ALLOWED_MIME.includes(file.type) || file.size > MAX_BYTES || file.size <= 0) {
      toast({ title: t("pages.clauseImport.filePickError"), variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const upload = await requestUpload.mutateAsync({
        data: { fileName: file.name, size: file.size, contentType: file.type },
      });
      const putRes = await fetch(upload.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      const job = await createImport.mutateAsync({
        data: {
          objectPath: upload.objectPath,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          brandId: brandId === NONE ? null : brandId,
          contractTypeCode: contractTypeCode === NONE ? null : contractTypeCode,
          language,
          note: note.trim() ? note.trim() : null,
        },
      });
      toast({ title: t("pages.clauseImport.uploadSuccess") });
      reset();
      await qc.invalidateQueries({ queryKey: getListClauseImportsQueryKey() });
      onOpenJob(job.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isUnsupportedType =
        /contentType|mimeType/i.test(msg) &&
        /pdf|docx/i.test(msg);
      toast({
        title: isUnsupportedType
          ? t("pages.clauseImport.filePickError")
          : t("pages.clauseImport.uploadFailed"),
        description: isUnsupportedType ? undefined : msg,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("pages.clauseImport.deleteJobConfirm"))) return;
    try {
      await deleteImport.mutateAsync({ id });
      toast({ title: t("pages.clauseImport.jobDeleted") });
      await qc.invalidateQueries({ queryKey: getListClauseImportsQueryKey() });
    } catch (e) {
      toast({
        title: "Error",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 border-b pb-4">
        <Link href="/clauses">
          <Button variant="ghost" size="sm" data-testid="link-back-clauses">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("pages.clauseImport.back")}
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("pages.clauseImport.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t("pages.clauseImport.subtitle")}</p>
        </div>
      </div>

      <Card data-testid="clause-import-upload-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-muted-foreground" />
            {t("pages.clauseImport.uploadCard")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>{t("pages.clauseImport.fileLabel")}</Label>
            <Input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              data-testid="clause-import-file-input"
            />
            {file && (
              <p className="mt-1 text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>{t("pages.clauseImport.brandLabel")}</Label>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger data-testid="clause-import-brand-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("pages.clauseImport.brandNone")}</SelectItem>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("pages.clauseImport.contractTypeLabel")}</Label>
              <Select value={contractTypeCode} onValueChange={setContractTypeCode}>
                <SelectTrigger data-testid="clause-import-contract-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("pages.clauseImport.contractTypeNone")}</SelectItem>
                  {contractTypes.map((ct) => (
                    <SelectItem key={ct.id} value={ct.code}>{ct.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("pages.clauseImport.languageLabel")}</Label>
              <Select value={language} onValueChange={(v) => setLanguage(v as "de" | "en")}>
                <SelectTrigger data-testid="clause-import-language-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="de">{t("pages.clauseImport.languageDe")}</SelectItem>
                  <SelectItem value="en">{t("pages.clauseImport.languageEn")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>{t("pages.clauseImport.noteLabel")}</Label>
            <Textarea
              rows={2}
              placeholder={t("pages.clauseImport.notePlaceholder")}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              data-testid="clause-import-note-input"
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleUpload}
              disabled={busy || !file}
              data-testid="clause-import-submit"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {busy ? t("pages.clauseImport.uploading") : t("pages.clauseImport.uploadAndAnalyze")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="clause-import-jobs-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            {t("pages.clauseImport.jobsCard")}
            <Badge variant="outline" className="ml-2">{jobs.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : jobs.length === 0 ? (
            <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t("pages.clauseImport.jobsEmpty")}
            </div>
          ) : (
            <div className="divide-y">
              {jobs.map((j) => (
                <div
                  key={j.id}
                  className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between"
                  data-testid={`clause-import-job-row-${j.id}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{j.fileName}</span>
                      {statusBadge(j.status, t)}
                      <Badge variant="secondary" className="uppercase">{j.language}</Badge>
                      {j.brandName && <Badge variant="outline">{j.brandName}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(j.createdAt).toLocaleString()} ·{" "}
                      {j.suggestionCount} / {j.pendingCount} pending /{" "}
                      {j.acceptedCount} ok / {j.rejectedCount} rej
                      {j.errorMessage && (
                        <span className="text-rose-600 ml-2">⚠ {j.errorMessage}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenJob(j.id)}
                      data-testid={`clause-import-open-${j.id}`}
                    >
                      {t("pages.clauseImport.openJob")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(j.id)}
                      data-testid={`clause-import-delete-${j.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewView({ jobId, onBack }: { jobId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const { data: job, isLoading } = useGetClauseImport(jobId);
  const { data: families = [] } = useListClauseFamilies();

  if (isLoading || !job) {
    return (
      <div className="p-8">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 border-b pb-4">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="clause-import-review-back">
          <ArrowLeft className="h-4 w-4 mr-1" />
          {t("pages.clauseImport.reviewBack")}
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">
            {t("pages.clauseImport.reviewTitle", { file: job.fileName })}
          </h1>
          <p className="text-muted-foreground text-xs mt-1">
            {t("pages.clauseImport.reviewMeta", {
              count: job.suggestionCount,
              pending: job.pendingCount,
              accepted: job.acceptedCount,
              rejected: job.rejectedCount,
            })}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {statusBadge(job.status, t)}
          {job.downloadUrl && (
            <a href={job.downloadUrl} target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-1" />
                {t("pages.clauseImport.downloadOriginal")}
              </Button>
            </a>
          )}
        </div>
      </div>

      {job.errorMessage && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="py-3 text-sm text-rose-700 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {errorLabel(job.errorMessage, t)}
          </CardContent>
        </Card>
      )}

      {job.suggestions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {t("pages.clauseImport.suggestionsEmpty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {job.suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              jobId={job.id}
              jobLanguage={job.language}
              suggestion={s}
              families={families}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function errorLabel(code: string, t: (k: string) => string): string {
  if (code === "ai_not_configured") return t("pages.clauseImport.errorAiNotConfigured");
  if (code === "text_extraction_failed") return t("pages.clauseImport.errorTextExtraction");
  if (code === "object_not_found") return t("pages.clauseImport.errorObjectNotFound");
  if (code === "ai_failed") return t("pages.clauseImport.errorAiFailed");
  return code;
}

function SuggestionCard({
  jobId,
  jobLanguage,
  suggestion,
  families,
}: {
  jobId: string;
  jobLanguage: "de" | "en";
  suggestion: ClauseImportSuggestion;
  families: Array<{ id: string; name: string; variants?: Array<{ id: string; name: string }> }>;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const decide = useDecideClauseImportSuggestion();

  const [familyId, setFamilyId] = useState<string>(suggestion.suggestedFamilyId ?? "");
  const [targetVariantId, setTargetVariantId] = useState<string>(
    suggestion.matchedVariantId ?? NONE,
  );
  const [name, setName] = useState(suggestion.suggestedName);
  const [summary, setSummary] = useState(suggestion.suggestedSummary);
  const [body, setBody] = useState(suggestion.extractedText);
  const [decisionNote, setDecisionNote] = useState("");
  const [overrideTranslation, setOverrideTranslation] = useState(false);
  const [busy, setBusy] = useState(false);

  const familyVariants = useMemo(() => {
    const f = families.find((x) => x.id === familyId);
    return f?.variants ?? [];
  }, [families, familyId]);

  // For non-de language we treat accept as a translation; user must pick a target variant.
  const isTranslationCase = jobLanguage !== "de" || targetVariantId !== NONE;

  const isPending = suggestion.status === "pending_review";

  const submit = async (decision: "accept" | "reject") => {
    setBusy(true);
    try {
      await decide.mutateAsync({
        id: jobId,
        sid: suggestion.id,
        data: {
          decision,
          familyId: familyId || null,
          targetVariantId: targetVariantId === NONE ? null : targetVariantId,
          nameOverride:
            decision === "accept" && name !== suggestion.suggestedName ? name : null,
          summaryOverride:
            decision === "accept" && summary !== suggestion.suggestedSummary ? summary : null,
          bodyOverride:
            decision === "accept" &&
            (body !== suggestion.extractedText || overrideTranslation)
              ? body
              : null,
          decisionNote: decisionNote.trim() ? decisionNote.trim() : null,
        },
      });
      toast({
        title:
          decision === "accept"
            ? t("pages.clauseImport.decisionAccepted")
            : t("pages.clauseImport.decisionRejected"),
      });
      await qc.invalidateQueries({ queryKey: getGetClauseImportQueryKey(jobId) });
      await qc.invalidateQueries({ queryKey: getListClauseImportsQueryKey() });
      await qc.invalidateQueries({ queryKey: getListClauseFamiliesQueryKey() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTranslationConflict = msg.includes("translation_exists");
      toast({
        title: t("pages.clauseImport.decisionFailed"),
        description: isTranslationConflict
          ? t("pages.clauseImport.translationExists")
          : msg,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card data-testid={`suggestion-card-${suggestion.id}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start gap-2">
          <Sparkles className="h-4 w-4 mt-1 text-violet-500" />
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">{suggestion.suggestedName}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              #{suggestion.orderIndex + 1}
              {suggestion.pageHint ? ` · S. ${suggestion.pageHint}` : ""} ·{" "}
              <span className="capitalize">{suggestion.suggestedTone}</span> ·{" "}
              <span className="uppercase">{suggestion.suggestedSeverity}</span>
              {suggestion.similarityScore != null && (
                <span> · sim {Math.round(suggestion.similarityScore * 100)}%</span>
              )}
            </p>
          </div>
          {!isPending && (
            <Badge
              variant="outline"
              className={
                suggestion.status === "accepted"
                  ? "bg-emerald-500/10 text-emerald-700 border-emerald-400/40"
                  : "bg-rose-500/10 text-rose-700 border-rose-400/40"
              }
            >
              {suggestion.status === "accepted"
                ? t("pages.clauseImport.alreadyAccepted")
                : t("pages.clauseImport.alreadyRejected")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs">{t("pages.clauseImport.extractedText")}</Label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            disabled={!isPending}
            className="font-mono text-xs"
            data-testid={`suggestion-body-${suggestion.id}`}
          />
        </div>

        {isPending && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Summary</Label>
                <Input value={summary} onChange={(e) => setSummary(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{t("pages.clauseImport.matchedFamily")}</Label>
                <Select value={familyId || NONE} onValueChange={(v) => setFamilyId(v === NONE ? "" : v)}>
                  <SelectTrigger data-testid={`suggestion-family-${suggestion.id}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t("pages.clauseImport.noMatchedFamily")}</SelectItem>
                    {families.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {suggestion.alternativeMatches.length > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {t("pages.clauseImport.alternativeMatches")}:{" "}
                    {suggestion.alternativeMatches
                      .map((a) => `${a.familyName} (${Math.round(a.confidence * 100)}%)`)
                      .join(", ")}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-xs">{t("pages.clauseImport.matchedVariant")}</Label>
                <Select
                  value={targetVariantId}
                  onValueChange={setTargetVariantId}
                  disabled={!familyId}
                >
                  <SelectTrigger data-testid={`suggestion-variant-${suggestion.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      {t("pages.clauseImport.noMatchedVariant")}
                    </SelectItem>
                    {familyVariants.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {isTranslationCase
                    ? t("pages.clauseImport.acceptCreateTranslation")
                    : t("pages.clauseImport.acceptCreateVariant")}
                </p>
              </div>
            </div>

            {isTranslationCase && (
              <div className="flex items-center gap-2 rounded border p-2">
                <Switch
                  id={`override-${suggestion.id}`}
                  checked={overrideTranslation}
                  onCheckedChange={setOverrideTranslation}
                />
                <Label htmlFor={`override-${suggestion.id}`} className="text-xs">
                  {t("pages.clauseImport.translationOverride")}
                </Label>
              </div>
            )}

            <div>
              <Label className="text-xs">{t("pages.clauseImport.decisionNote")}</Label>
              <Input
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                data-testid={`suggestion-note-${suggestion.id}`}
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => submit("reject")}
                disabled={busy}
                data-testid={`suggestion-reject-${suggestion.id}`}
              >
                <X className="h-4 w-4 mr-1" />
                {t("pages.clauseImport.decisionReject")}
              </Button>
              <Button
                size="sm"
                onClick={() => submit("accept")}
                disabled={busy || !familyId}
                data-testid={`suggestion-accept-${suggestion.id}`}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-1" />
                )}
                {t("pages.clauseImport.decisionAccept")}
              </Button>
            </div>
          </>
        )}

        {!isPending && (
          <div className="text-xs text-muted-foreground">
            {suggestion.createdVariantId &&
              t("pages.clauseImport.createdVariantHint", { id: suggestion.createdVariantId })}
            {suggestion.createdTranslationId && (
              <>
                {" "}
                {t("pages.clauseImport.createdTranslationHint", {
                  id: suggestion.createdTranslationId,
                })}
              </>
            )}
            {suggestion.decisionNote && <div className="mt-1 italic">„{suggestion.decisionNote}"</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

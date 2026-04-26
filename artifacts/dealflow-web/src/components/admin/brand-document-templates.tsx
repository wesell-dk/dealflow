/**
 * Brand-Vorlagen-Sektion (Task #155)
 *
 * Zeigt pro documentType (Angebot / Auftragsbestaetigung / Rechnung / Vertrag)
 * eine Drop-Zone, in der der Admin eine Referenz-PDF hochladen kann. Nach
 * Upload analysiert der Server das Layout und speichert es als Profil. Die
 * Karte zeigt anschliessend Status, Fehler, sowie Buttons "Original",
 * "Vorschau", "Neu analysieren", "Loeschen".
 *
 * Wir reden NICHT ueber den orval-Client, weil die Endpoints sehr
 * spezialisiert sind (Stream-Antworten, multi-step upload) — direkter fetch
 * mit BASE_URL ist hier robuster.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, FileText, RefreshCw, Trash2, ExternalLink, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

type DocumentType = "quote" | "order_confirmation" | "invoice" | "contract";

interface ProfileSummary {
  language: "de" | "en";
  pageSize: "A4" | "Letter";
  documentTitle: string;
  logoPosition: "top-left" | "top-right" | "top-center";
  accentPrimary: string;
  accentSecondary: string | null;
  fontHierarchy: { docTitlePt: number; sectionHeadingPt: number; bodyPt: number };
  columns: Array<{ label: string; align: "left" | "right" | "center"; widthPct: number }>;
  totals: { subtotalLabel: string; taxLabel: string | null; grandTotalLabel: string };
  pageNumberFormat: string;
  footer: { addressLine: string; legalLine: string; bankLine: string };
}

interface BrandTemplate {
  id: string;
  brandId: string;
  documentType: DocumentType;
  fileName: string;
  fileHash: string;
  status: "pending" | "ready" | "failed";
  errorText: string | null;
  language: string | null;
  hasProfile: boolean;
  profileSummary: ProfileSummary | null;
  analysisInvocationId: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const TYPES: Array<{ value: DocumentType; label: string; hint: string }> = [
  { value: "quote", label: "Quote",
    hint: "Template for newly generated quote PDFs. Ideally a typical quote with header, logo, line items and totals block." },
  { value: "order_confirmation", label: "Order confirmation",
    hint: "Template for order confirmations — usually structured like a quote, but with a different title and a delivery line." },
  { value: "invoice", label: "Invoice",
    hint: "Invoice layout — important for invoice PDFs (required fields, footer with bank details)." },
  { value: "contract", label: "Contract",
    hint: "Clause-based contract layout. No line-item block — clause structure and signature field instead." },
];

const STATUS_LABEL: Record<BrandTemplate["status"], string> = {
  pending: "processing",
  ready: "active",
  failed: "Error",
};

const MAX_BYTES = 25 * 1024 * 1024;

interface Props {
  brandId: string;
}

export function BrandDocumentTemplates({ brandId }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<BrandTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyType, setBusyType] = useState<DocumentType | null>(null);

  const apiBase = `${import.meta.env.BASE_URL}api/orgs/brands/${brandId}/document-templates`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(apiBase, { credentials: "include" });
      if (!res.ok) throw new Error(`list failed: ${res.status}`);
      const data: BrandTemplate[] = await res.json();
      setItems(data);
    } catch (err) {
      toast({
        title: "Failed to load templates",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [apiBase, toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  const upload = useCallback(async (type: DocumentType, file: File) => {
    if (file.type !== "application/pdf") {
      toast({ title: "Wrong file type", description: "Please choose a PDF file.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: "File too large", description: `Max ${MAX_BYTES / 1024 / 1024} MB.`, variant: "destructive" });
      return;
    }
    setBusyType(type);
    try {
      const sigRes = await fetch(`${apiBase}/upload-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          size: file.size,
          contentType: file.type,
          documentType: type,
        }),
      });
      if (!sigRes.ok) throw new Error(`upload-url ${sigRes.status}`);
      const { uploadURL, objectPath } = await sigRes.json() as { uploadURL: string; objectPath: string };
      const put = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`PUT failed: ${put.status}`);
      const analyze = await fetch(apiBase, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: type, objectPath, fileName: file.name }),
      });
      if (!analyze.ok) {
        const body = await analyze.text().catch(() => "");
        throw new Error(`analyze ${analyze.status}: ${body.slice(0, 200)}`);
      }
      const saved: BrandTemplate = await analyze.json();
      toast({
        title: saved.status === "ready" ? "Template analyzed" : "Template saved (analysis failed)",
        description: saved.status === "ready"
          ? `${file.name} — layout is active.`
          : saved.errorText ?? "Please re-analyze later.",
        variant: saved.status === "ready" ? "default" : "destructive",
      });
      await refresh();
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusyType(null);
    }
  }, [apiBase, refresh, toast]);

  const reanalyze = useCallback(async (type: DocumentType) => {
    setBusyType(type);
    try {
      const res = await fetch(`${apiBase}/${type}/reanalyze`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error(`reanalyze ${res.status}`);
      const updated: BrandTemplate = await res.json();
      toast({
        title: updated.status === "ready" ? "Re-analyzed" : "Analysis failed",
        description: updated.errorText ?? "",
        variant: updated.status === "ready" ? "default" : "destructive",
      });
      await refresh();
    } catch (err) {
      toast({
        title: "Re-analyze failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusyType(null);
    }
  }, [apiBase, refresh, toast]);

  const remove = useCallback(async (type: DocumentType) => {
    if (!window.confirm(`Really delete template "${TYPES.find(t => t.value === type)?.label}"?`)) return;
    setBusyType(type);
    try {
      const res = await fetch(`${apiBase}/${type}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) throw new Error(`delete ${res.status}`);
      toast({ title: "Template deleted" });
      await refresh();
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusyType(null);
    }
  }, [apiBase, refresh, toast]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading templates…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {TYPES.map(t => {
        const item = items.find(i => i.documentType === t.value) ?? null;
        return (
          <TemplateCard
            key={t.value}
            type={t.value}
            label={t.label}
            hint={t.hint}
            item={item}
            busy={busyType === t.value}
            apiBase={apiBase}
            onUpload={(file) => upload(t.value, file)}
            onReanalyze={() => reanalyze(t.value)}
            onRemove={() => remove(t.value)}
          />
        );
      })}
    </div>
  );
}

interface CardProps {
  type: DocumentType;
  label: string;
  hint: string;
  item: BrandTemplate | null;
  busy: boolean;
  apiBase: string;
  onUpload: (file: File) => void;
  onReanalyze: () => void;
  onRemove: () => void;
}

function TemplateCard({ type, label, hint, item, busy, apiBase, onUpload, onReanalyze, onRemove }: CardProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onUpload(file);
  };
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="rounded-md border p-3" data-testid={`brand-template-${type}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
        </div>
        {item && (
          <div className="flex items-center gap-1 text-xs">
            {item.status === "ready" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
            {item.status === "failed" && <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />}
            {item.status === "pending" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span className={
              item.status === "ready" ? "text-emerald-700" :
              item.status === "failed" ? "text-amber-700" :
              "text-muted-foreground"
            }>{STATUS_LABEL[item.status]}</span>
          </div>
        )}
      </div>

      {item ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="truncate" title={item.fileName}>{item.fileName}</span>
          </div>
          {item.status === "failed" && item.errorText && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              {item.errorText}
            </p>
          )}
          {item.status === "ready" && item.profileSummary && (
            <ProfileSummaryView summary={item.profileSummary} />
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" asChild disabled={busy}>
              <a href={`${apiBase}/${type}/source.pdf`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Original
              </a>
            </Button>
            {item.status === "ready" && (
              <Button type="button" size="sm" variant="outline" asChild disabled={busy}>
                <a href={`${apiBase}/${type}/preview.pdf`} target="_blank" rel="noreferrer">
                  <FileText className="h-3.5 w-3.5 mr-1" /> Preview
                </a>
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={onReanalyze} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
              Re-analyze
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => inputRef.current?.click()} disabled={busy}>
              <Upload className="h-3.5 w-3.5 mr-1" /> Replace
            </Button>
            <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onRemove} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
            </Button>
          </div>
          <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={handleChange} />
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={`mt-3 cursor-pointer rounded border-2 border-dashed p-3 text-center text-xs transition-colors ${
            dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:border-muted-foreground/60"
          }`}
          data-testid={`brand-template-${type}-dropzone`}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing…
            </span>
          ) : (
            <span className="text-muted-foreground">Drag a PDF here or click — up to 25 MB</span>
          )}
          <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={handleChange} />
        </div>
      )}
    </div>
  );
}

/**
 * Lesbare Darstellung der Profil-Eigenschaften, die die KI aus der
 * Referenz-PDF extrahiert hat. Erlaubt Admins, ohne Vorschau-PDF zu
 * verifizieren, dass das Layout korrekt erkannt wurde.
 */
function ProfileSummaryView({ summary }: { summary: ProfileSummary }) {
  const logoLabel: Record<ProfileSummary["logoPosition"], string> = {
    "top-left": "top left",
    "top-right": "top right",
    "top-center": "top center",
  };
  return (
    <div className="rounded border bg-muted/30 p-2 text-xs space-y-2" data-testid="brand-template-profile-summary">
      <div className="flex flex-wrap gap-x-4 gap-y-1 items-center">
        <span><span className="text-muted-foreground">Title:</span> <strong>{summary.documentTitle || "—"}</strong></span>
        <span><span className="text-muted-foreground">Language:</span> {summary.language.toUpperCase()}</span>
        <span><span className="text-muted-foreground">Format:</span> {summary.pageSize}</span>
        <span><span className="text-muted-foreground">Logo:</span> {logoLabel[summary.logoPosition]}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Accent colors:</span>
        <ColorChip hex={summary.accentPrimary} />
        {summary.accentSecondary && <ColorChip hex={summary.accentSecondary} />}
      </div>
      <div>
        <span className="text-muted-foreground">Font (pt):</span>{" "}
        Title {summary.fontHierarchy.docTitlePt} · Heading {summary.fontHierarchy.sectionHeadingPt} · Body {summary.fontHierarchy.bodyPt}
      </div>
      {summary.columns.length > 0 && (
        <div>
          <span className="text-muted-foreground">Columns:</span>{" "}
          {summary.columns.map((c, i) => (
            <span key={i} className="inline-block mr-1">
              <code className="rounded bg-background border px-1 py-0.5">{c.label || "—"}</code>
              <span className="text-muted-foreground"> {Math.round(c.widthPct)}%·{c.align}</span>
              {i < summary.columns.length - 1 && <span className="mx-0.5 text-muted-foreground">·</span>}
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-x-4">
        <span><span className="text-muted-foreground">Total:</span> {summary.totals.subtotalLabel || "—"} → {summary.totals.grandTotalLabel || "—"}</span>
        <span><span className="text-muted-foreground">Tax:</span> {summary.totals.taxLabel || "—"}</span>
        <span><span className="text-muted-foreground">Page number:</span> <code className="bg-background border rounded px-1">{summary.pageNumberFormat || "—"}</code></span>
      </div>
      {(summary.footer.addressLine || summary.footer.legalLine || summary.footer.bankLine) && (
        <div className="space-y-0.5">
          <div className="text-muted-foreground">Footer:</div>
          {summary.footer.addressLine && <div className="truncate" title={summary.footer.addressLine}>· {summary.footer.addressLine}</div>}
          {summary.footer.legalLine && <div className="truncate" title={summary.footer.legalLine}>· {summary.footer.legalLine}</div>}
          {summary.footer.bankLine && <div className="truncate" title={summary.footer.bankLine}>· {summary.footer.bankLine}</div>}
        </div>
      )}
    </div>
  );
}

function ColorChip({ hex }: { hex: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-3 w-3 rounded-sm border"
        style={{ backgroundColor: hex }}
        aria-hidden
      />
      <code className="text-[10px]">{hex}</code>
    </span>
  );
}

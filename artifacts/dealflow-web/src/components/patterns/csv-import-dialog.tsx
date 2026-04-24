import { useState, useRef, type ChangeEvent } from "react";
import { Upload, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";

export interface CSVImportField {
  key: string;
  label: string;
  required?: boolean;
}

export interface CSVImportDialogProps<TInput> {
  triggerLabel?: string;
  title: string;
  fields: CSVImportField[];
  buildRow: (mapped: Record<string, string>) => TInput | null;
  onImport: (row: TInput) => Promise<unknown>;
  testId?: string;
}

function parseCSV(text: string): { header: string[]; rows: string[][] } {
  // Strip BOM
  text = text.replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };
  const sep = lines[0].includes(";") && !lines[0].includes(",") ? ";" :
              lines[0].includes(";") && lines[0].split(";").length > lines[0].split(",").length ? ";" : ",";
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else {
        if (c === '"') inQ = true;
        else if (c === sep) { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]);
  const rows = lines.slice(1).map(split);
  return { header, rows };
}

export function CSVImportDialog<TInput>({
  triggerLabel = "Import",
  title,
  fields,
  buildRow,
  onImport,
  testId,
}: CSVImportDialogProps<TInput>) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [parsed, setParsed] = useState<{ header: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ ok: number; failed: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setParsed(null);
    setMapping({});
    setProgress(0);
    setResult(null);
    setImporting(false);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const p = parseCSV(text);
      setParsed(p);
      // Auto-map by case-insensitive label/key match
      const auto: Record<string, string> = {};
      fields.forEach((f) => {
        const found = p.header.find((h) =>
          h.toLowerCase() === f.key.toLowerCase() ||
          h.toLowerCase() === f.label.toLowerCase(),
        );
        if (found) auto[f.key] = found;
      });
      setMapping(auto);
    };
    reader.readAsText(f, "utf-8");
  }

  async function runImport() {
    if (!parsed) return;
    setImporting(true);
    setProgress(0);
    let ok = 0, failed = 0;
    for (let i = 0; i < parsed.rows.length; i++) {
      const row = parsed.rows[i];
      const mapped: Record<string, string> = {};
      fields.forEach((f) => {
        const src = mapping[f.key];
        if (!src) return;
        const idx = parsed.header.indexOf(src);
        if (idx >= 0) mapped[f.key] = row[idx] ?? "";
      });
      const built = buildRow(mapped);
      if (!built) { failed++; setProgress(Math.round(((i + 1) / parsed.rows.length) * 100)); continue; }
      try {
        await onImport(built);
        ok++;
      } catch {
        failed++;
      }
      setProgress(Math.round(((i + 1) / parsed.rows.length) * 100));
    }
    setResult({ ok, failed });
    setImporting(false);
    toast({
      title: "Import abgeschlossen",
      description: `${ok} importiert, ${failed} übersprungen.`,
      variant: failed > 0 ? "default" : "default",
    });
  }

  const requiredOk = fields.filter((f) => f.required).every((f) => mapping[f.key]);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => { reset(); setOpen(true); }}
        data-testid={testId}
      >
        <Upload className="h-3.5 w-3.5" />
        <span className="text-xs">{triggerLabel}</span>
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Erste Zeile = Spaltennamen. Trennzeichen Komma oder Semikolon. UTF-8.
            </DialogDescription>
          </DialogHeader>

          {!parsed && (
            <div
              className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-10 cursor-pointer hover:bg-muted/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="CSV-Datei wählen"
            >
              <FileText className="h-10 w-10 text-muted-foreground mb-3" />
              <p className="text-sm font-medium">CSV-Datei wählen</p>
              <p className="text-xs text-muted-foreground mt-1">oder hierher ziehen</p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onFile}
                className="hidden"
                data-testid={testId ? `${testId}-file` : undefined}
              />
            </div>
          )}

          {parsed && !result && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
              <div className="text-xs text-muted-foreground">
                {parsed.rows.length} Zeilen erkannt — ordne CSV-Spalten den Feldern zu:
              </div>
              <div className="grid gap-2">
                {fields.map((f) => (
                  <div key={f.key} className="grid grid-cols-2 items-center gap-3">
                    <div className="text-sm">
                      {f.label}
                      {f.required && <span className="text-destructive ml-1">*</span>}
                    </div>
                    <Select
                      value={mapping[f.key] ?? "__none__"}
                      onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === "__none__" ? "" : v }))}
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue placeholder="— ignorieren —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— ignorieren —</SelectItem>
                        {parsed.header.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {importing && (
                <div className="space-y-2 pt-2">
                  <Progress value={progress} />
                  <div className="text-xs text-center text-muted-foreground">
                    {progress}%
                  </div>
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="flex flex-col items-center py-6 text-center">
              {result.failed === 0 ? (
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mb-3" />
              ) : (
                <AlertCircle className="h-10 w-10 text-amber-500 mb-3" />
              )}
              <p className="text-lg font-semibold">{result.ok} importiert</p>
              {result.failed > 0 && (
                <p className="text-sm text-muted-foreground">{result.failed} übersprungen (ungültige Zeilen)</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {result ? "Schließen" : "Abbrechen"}
            </Button>
            {parsed && !result && (
              <Button onClick={runImport} disabled={!requiredOk || importing} data-testid={testId ? `${testId}-run` : undefined}>
                {importing ? "Importiere…" : `Import starten (${parsed.rows.length})`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

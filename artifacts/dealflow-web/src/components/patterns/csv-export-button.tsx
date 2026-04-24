import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export interface CSVColumn<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
}

export interface CSVExportButtonProps<T> {
  filename: string;
  rows: T[];
  columns: CSVColumn<T>[];
  testId?: string;
  disabled?: boolean;
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function CSVExportButton<T>({ filename, rows, columns, testId, disabled }: CSVExportButtonProps<T>) {
  const { toast } = useToast();

  function handleExport() {
    if (rows.length === 0) {
      toast({ title: "Keine Daten", description: "Es gibt nichts zu exportieren." });
      return;
    }
    const header = columns.map((c) => csvEscape(c.label)).join(";");
    const body = rows
      .map((r) => columns.map((c) => csvEscape(c.value(r))).join(";"))
      .join("\n");
    // BOM for Excel UTF-8 friendliness
    const csv = "\uFEFF" + header + "\n" + body;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: "Export bereit", description: `${rows.length} Einträge → ${filename}` });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 gap-1.5"
      onClick={handleExport}
      disabled={disabled || rows.length === 0}
      data-testid={testId}
    >
      <Download className="h-3.5 w-3.5" />
      <span className="text-xs">Export</span>
    </Button>
  );
}

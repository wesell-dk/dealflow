import { useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  useListAttachmentLibrary,
  useCreateAttachmentLibraryItem,
  useDeleteAttachmentLibraryItem,
  useRequestUploadUrl,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FieldHint } from "@/components/ui/field-hint";
import { ATTACHMENT_CATEGORIES } from "@/lib/glossary";
import { Paperclip, Upload, Trash2, Search, Loader2, Plus, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CATEGORIES = ["all", "datasheet", "terms", "reference", "certificate", "other"];
const UPLOAD_CATEGORIES = ["datasheet", "terms", "reference", "certificate", "other"] as const;

export default function Attachments() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: items, isLoading, refetch } = useListAttachmentLibrary();
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("all");
  const [uploadOpen, setUploadOpen] = useState(false);

  // Upload form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [uploadCategory, setUploadCategory] = useState("other");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const requestUrlMut = useRequestUploadUrl();
  const createMut = useCreateAttachmentLibraryItem();
  const deleteMut = useDeleteAttachmentLibraryItem();

  const filtered = useMemo(() => {
    if (!items) return [];
    return items.filter((a) => {
      const matchesCat = category === "all" || a.category === category;
      const matchesQuery =
        !filter ||
        a.name.toLowerCase().includes(filter.toLowerCase()) ||
        a.tags.some((t) => t.toLowerCase().includes(filter.toLowerCase()));
      return matchesCat && matchesQuery;
    });
  }, [items, filter, category]);

  const resetForm = () => {
    setName("");
    setDescription("");
    setTags("");
    setUploadCategory("other");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!file || !name) {
      toast({
        variant: "destructive",
        title: t("pages.attachments.missingFields"),
      });
      return;
    }
    setUploading(true);
    try {
      const upload = await requestUrlMut.mutateAsync({
        data: { kind: "document", name: file.name, contentType: file.type, size: file.size },
      });
      const putRes = await fetch(upload.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error(`Upload failed: ${putRes.status}`);
      await createMut.mutateAsync({
        data: {
          name,
          description: description || undefined,
          category: uploadCategory,
          tags: tags ? tags.split(",").map((s) => s.trim()).filter(Boolean) : [],
          mimeType: file.type,
          size: file.size,
          objectPath: upload.objectPath,
        },
      });
      toast({ title: t("pages.attachments.uploaded") });
      setUploadOpen(false);
      resetForm();
      refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        variant: "destructive",
        title: t("pages.attachments.uploadFailed"),
        description: msg,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMut.mutateAsync({ id });
      toast({ title: t("pages.attachments.deleted") });
      refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: msg,
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("pages.attachments.title")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("pages.attachments.subtitle")}
          </p>
        </div>
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogTrigger asChild>
            <Button data-testid="attachment-upload-button">
              <Plus className="h-4 w-4 mr-1" />
              {t("pages.attachments.upload")}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("pages.attachments.uploadTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>{t("common.name")}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>{t("pages.attachments.description")}</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor="upload-category">{t("pages.attachments.category")}</Label>
                    <FieldHint
                      title="Kategorie"
                      text="Bestimmt, wie das Dokument in der Bibliothek gefiltert und an Quotes/Verträge vorgeschlagen wird. Wähle einen Eintrag, um die Beschreibung zu sehen."
                    />
                  </div>
                  <Select
                    value={uploadCategory}
                    onValueChange={setUploadCategory}
                  >
                    <SelectTrigger id="upload-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.filter((c) => c !== "all").map((c) => {
                        const entry = ATTACHMENT_CATEGORIES[c];
                        return (
                          <SelectItem key={c} value={c} className="py-2">
                            <div className="flex flex-col">
                              <span>{entry?.label ?? c}</span>
                              {entry?.short && (
                                <span className="text-[11px] leading-snug text-muted-foreground">
                                  {entry.short}
                                </span>
                              )}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("pages.attachments.tags")}</Label>
                  <Input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="dsgvo, dpa"
                  />
                </div>
              </div>
              <div>
                <Label>{t("pages.attachments.file")}</Label>
                <Input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.xlsx,.md,.csv,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("pages.attachments.formatHint")}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUploadOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleUpload}
                disabled={uploading || !file || !name}
                data-testid="attachment-upload-submit"
              >
                {uploading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Upload className="h-4 w-4 mr-1" />
                {t("pages.attachments.upload")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t("pages.attachments.searchPlaceholder")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c === "all" ? t("common.all") : c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <Skeleton className="h-64 w-full" />}

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          {t("pages.attachments.empty")}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((a) => (
          <Card key={a.id} data-testid={`attachment-card-${a.id}`}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="font-semibold flex items-center gap-2">
                    <Paperclip className="h-4 w-4 text-primary" />
                    {a.name}
                  </div>
                  {a.description && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {a.description}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge variant="secondary" className="text-xs">
                      {a.category}
                    </Badge>
                    {a.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                    <Badge variant="outline" className="text-xs">
                      v{a.version}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {a.mimeType} · {(a.size / 1024).toFixed(0)} KB
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid={`attachment-open-${a.id}`}
                    onClick={() => {
                      const path = a.objectPath.startsWith("/objects/")
                        ? `/api/storage${a.objectPath}`
                        : a.objectPath;
                      window.open(path, "_blank");
                    }}
                    title={t("common.open")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(a.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

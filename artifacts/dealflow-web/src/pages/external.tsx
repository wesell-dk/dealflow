import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, ShieldAlert, MessageSquare, Lock, Info, Pencil, PenLine, CheckCircle2 } from "lucide-react";
import { toAssetSrc } from "@/lib/asset-url";

type ExtCapability = "view" | "comment" | "edit_fields" | "sign_party";
type EditableField = "effectiveFrom" | "effectiveTo" | "governingLaw" | "jurisdiction";

interface Comment {
  id: string;
  contractClauseId: string | null;
  authorType: "user" | "external";
  authorName: string;
  body: string;
  createdAt: string;
}
interface ExternalView {
  collaborator: {
    id: string;
    email: string;
    name: string | null;
    organization: string | null;
    capabilities: ExtCapability[];
    editableFields: EditableField[];
    expiresAt: string;
  };
  contract: {
    id: string;
    title: string;
    status: string;
    template: string | null;
    currency: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    governingLaw: string | null;
    jurisdiction: string | null;
  };
  brand: { id: string; name: string; primaryColor: string | null; logoUrl: string | null } | null;
  clauses: { id: string; family: string; variant: string; severity: string; summary: string }[];
  comments: Comment[];
}

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/v1`;

export default function ExternalContractPage() {
  const { t } = useTranslation();
  const [, params] = useRoute<{ token: string }>("/external/:token");
  const token = params?.token ?? "";

  const [data, setData] = useState<ExternalView | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  // Edit-Felder Form-State (nur sichtbar bei capability=edit_fields).
  const [editDraft, setEditDraft] = useState<Partial<Record<EditableField, string | null>>>({});
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMessage, setEditMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Mitzeichnen-Modal (nur sichtbar bei capability=sign_party).
  const [signOpen, setSignOpen] = useState(false);
  const [signName, setSignName] = useState("");
  const [signSubmitting, setSignSubmitting] = useState(false);
  const [signMessage, setSignMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const padRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false, lastX: 0, lastY: 0,
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/external/${encodeURIComponent(token)}`);
      if (!r.ok) {
        setError({ status: r.status, message: r.status === 401 ? "expired_or_revoked" : "invalid" });
        setData(null);
      } else {
        const json = (await r.json()) as ExternalView;
        setData(json);
      }
    } catch (e) {
      setError({ status: 0, message: String(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const canComment = useMemo(
    () => data?.collaborator.capabilities.includes("comment") ?? false,
    [data],
  );
  const canEditFields = useMemo(
    () =>
      (data?.collaborator.capabilities.includes("edit_fields") ?? false) &&
      (data?.collaborator.editableFields?.length ?? 0) > 0,
    [data],
  );
  const canSign = useMemo(
    () => data?.collaborator.capabilities.includes("sign_party") ?? false,
    [data],
  );

  function fieldValue(f: EditableField): string {
    if (f in editDraft) return (editDraft[f] as string | null) ?? "";
    const v = data?.contract[f] ?? null;
    return v ?? "";
  }
  function setField(f: EditableField, v: string) {
    setEditDraft((prev) => ({ ...prev, [f]: v === "" ? null : v }));
  }
  function fieldLabel(f: EditableField): string {
    return f === "effectiveFrom" ? "Contractsbeginn"
      : f === "effectiveTo" ? "Contractsende"
      : f === "governingLaw" ? "Governing law"
      : "Jurisdiction";
  }

  async function saveEdits() {
    if (!data) return;
    setSavingEdit(true);
    setEditMessage(null);
    try {
      const r = await fetch(`${API_BASE}/external/${encodeURIComponent(token)}/contract`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editDraft),
      });
      if (!r.ok) {
        const txt = await r.text();
        setEditMessage({ kind: "err", text: txt || `HTTP ${r.status}` });
      } else {
        setEditMessage({ kind: "ok", text: "Felder succeeded gespeichert." });
        setEditDraft({});
        await load();
      }
    } catch (e) {
      setEditMessage({ kind: "err", text: String(e) });
    } finally {
      setSavingEdit(false);
    }
  }

  // ── Mitzeichnen: Signatur-Pad-Helfer ──────────────────────────────────
  function getPadCtx(): CanvasRenderingContext2D | null {
    const canvas = padRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d");
  }
  function clearPad() {
    const canvas = padRef.current;
    const ctx = getPadCtx();
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureDataUrl(null);
  }
  function relativePoint(canvas: HTMLCanvasElement, ev: PointerEvent | React.PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    return { x, y };
  }
  function onPadDown(ev: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = padRef.current;
    const ctx = getPadCtx();
    if (!canvas || !ctx) return;
    canvas.setPointerCapture(ev.pointerId);
    const p = relativePoint(canvas, ev);
    drawingRef.current = { active: true, lastX: p.x, lastY: p.y };
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function onPadMove(ev: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current.active) return;
    const canvas = padRef.current;
    const ctx = getPadCtx();
    if (!canvas || !ctx) return;
    const p = relativePoint(canvas, ev);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    drawingRef.current.lastX = p.x;
    drawingRef.current.lastY = p.y;
  }
  function onPadUp() {
    if (!drawingRef.current.active) return;
    drawingRef.current.active = false;
    const canvas = padRef.current;
    if (!canvas) return;
    setSignatureDataUrl(canvas.toDataURL("image/png"));
  }

  async function submitSignature() {
    if (!data) return;
    const trimmed = signName.trim();
    if (trimmed.length === 0) {
      setSignMessage({ kind: "err", text: "Please enter your name." });
      return;
    }
    setSignSubmitting(true);
    setSignMessage(null);
    try {
      const r = await fetch(`${API_BASE}/external/${encodeURIComponent(token)}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          signatureImage: signatureDataUrl ?? undefined,
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        setSignMessage({ kind: "err", text: txt || `HTTP ${r.status}` });
      } else {
        const json = (await r.json()) as { signer: { signedAt: string } };
        setSignedAt(json.signer.signedAt);
        setSignMessage({ kind: "ok", text: "Contract succeeded mitgezeichnet." });
        setSignOpen(false);
      }
    } catch (e) {
      setSignMessage({ kind: "err", text: String(e) });
    } finally {
      setSignSubmitting(false);
    }
  }

  function openSignDialog() {
    setSignName(data?.collaborator.name ?? "");
    setSignatureDataUrl(null);
    setSignMessage(null);
    setSignOpen(true);
    // Pad nach dem Render leeren — getPadCtx braucht das DOM.
    setTimeout(() => clearPad(), 0);
  }

  async function postComment() {
    if (!commentBody.trim()) return;
    setPosting(true);
    try {
      const r = await fetch(`${API_BASE}/external/${encodeURIComponent(token)}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: commentBody.trim() }),
      });
      if (r.ok) {
        setCommentBody("");
        await load();
      } else {
        const txt = await r.text();
        setError({ status: r.status, message: txt });
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header
        className="border-b py-4 px-6"
        style={data?.brand?.primaryColor ? { borderTopColor: data.brand.primaryColor, borderTopWidth: 4 } : undefined}
      >
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          {data?.brand?.logoUrl ? (
            <img src={toAssetSrc(data.brand.logoUrl)} alt={data.brand.name} className="h-8 w-auto" />
          ) : (
            <FileText className="h-8 w-8 text-muted-foreground" />
          )}
          <div className="flex-1">
            <h1 className="text-lg font-semibold">{data?.brand?.name ?? "DealFlow.One"}</h1>
            <p className="text-xs text-muted-foreground">Externer Contracts-Zugang</p>
          </div>
          {data && (
            <div className="text-xs text-muted-foreground text-right">
              <div>{data.collaborator.email}</div>
              <div>
                Valid to {new Date(data.collaborator.expiresAt).toLocaleString()}
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-6">
        {loading && <Skeleton className="h-40 w-full" />}

        {error && (
          <Card className="border-destructive bg-destructive/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <Lock className="h-5 w-5" />
                {error.status === 401
                  ? "This magic link has expired or was revoked."
                  : error.status === 404
                  ? "Magic link invalid."
                  : "Ein Error ist aufgetreten."}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Please contact the person who sent you the link — they can create a
                neuen Magic-Link create.
              </p>
            </CardContent>
          </Card>
        )}

        {data && (
          <>
            {/* Externer Zugriff Banner — informiert Anwalt/Berater ueber Read-only- und
                Audit-Status, sodass keine Verwechslung mit internaler Bearbeitung entsteht. */}
            <div
              className="border-l-4 border-amber-500 bg-amber-500/10 px-4 py-3 rounded-md flex items-start gap-3"
              data-testid="ext-access-banner"
              role="status"
            >
              <Info className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <div className="font-semibold text-amber-900 dark:text-amber-200">
                  External access via magic link
                </div>
                <p className="text-amber-900/80 dark:text-amber-200/80 mt-0.5">
                  You are working with a time-limited access, logged with{" "}
                  <strong>{data.brand?.name ?? "DealFlow.One"}</strong> protokollierten Zugang.
                  All actions are logged with your email address{" "}
                  <strong>{data.collaborator.email}</strong> in the audit log.
                  Permissions:{" "}
                  {data.collaborator.capabilities.map((c) => (
                    <Badge key={c} variant="outline" className="ml-1 text-[10px] uppercase">
                      {c === "view" ? "Read"
                       : c === "comment" ? "Comment"
                       : c === "edit_fields" ? "Felder edit"
                       : "Countersign"}
                    </Badge>
                  ))}
                </p>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{data.contract.title}</span>
                  <Badge variant="outline">{data.contract.status}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 text-sm">
                {data.contract.template && (
                  <div>
                    <div className="text-muted-foreground text-xs">Template</div>
                    <div>{data.contract.template}</div>
                  </div>
                )}
                {data.contract.currency && (
                  <div>
                    <div className="text-muted-foreground text-xs">Currency</div>
                    <div>{data.contract.currency}</div>
                  </div>
                )}
                {data.contract.effectiveFrom && (
                  <div>
                    <div className="text-muted-foreground text-xs">Valid from</div>
                    <div>{new Date(data.contract.effectiveFrom).toLocaleDateString()}</div>
                  </div>
                )}
                {data.contract.effectiveTo && (
                  <div>
                    <div className="text-muted-foreground text-xs">Valid to</div>
                    <div>{new Date(data.contract.effectiveTo).toLocaleDateString()}</div>
                  </div>
                )}
                {data.contract.governingLaw && (
                  <div>
                    <div className="text-muted-foreground text-xs">Governing law</div>
                    <div>{data.contract.governingLaw}</div>
                  </div>
                )}
                {data.contract.jurisdiction && (
                  <div>
                    <div className="text-muted-foreground text-xs">Jurisdiction</div>
                    <div>{data.contract.jurisdiction}</div>
                  </div>
                )}
              </CardContent>
            </Card>

            {canEditFields && (
              <Card data-testid="ext-edit-fields-card" className="border-amber-500/50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Pencil className="h-4 w-4" />
                    Felder edit
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    You can change the following fields directly. Each change is recorded in the
                    audit log with your email address.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {data.collaborator.editableFields.map((f) => {
                      const isDate = f === "effectiveFrom" || f === "effectiveTo";
                      return (
                        <div key={f} className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            {fieldLabel(f)}
                          </label>
                          <input
                            type={isDate ? "date" : "text"}
                            className="w-full border rounded px-2 py-1 text-sm bg-background"
                            value={fieldValue(f)}
                            onChange={(e) => setField(f, e.target.value)}
                            data-testid={`ext-edit-${f}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {editMessage && (
                    <p
                      className={`text-xs ${
                        editMessage.kind === "ok" ? "text-emerald-600" : "text-destructive"
                      }`}
                      data-testid="ext-edit-message"
                    >
                      {editMessage.text}
                    </p>
                  )}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={saveEdits}
                      disabled={savingEdit || Object.keys(editDraft).length === 0}
                      data-testid="ext-edit-submit"
                    >
                      Save changes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {canSign && (
              <Card data-testid="ext-sign-card" className="border-primary/40">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <PenLine className="h-4 w-4" />
                    Countersign as external counsel
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {signedAt ? (
                    <div
                      className="border rounded-md px-3 py-2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 flex items-center gap-2 text-sm"
                      data-testid="ext-sign-confirmation"
                      role="status"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Contract mitgezeichnet am {new Date(signedAt).toLocaleString()}.
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Du kannst diesen Contract als externaler Mitzeichner gegenzeichnen.
                      Your signature is logged with your email address
                      protokolliert und an das Signatur-Paket des Contracts angeheftet.
                    </p>
                  )}
                  {signMessage && !signOpen && (
                    <p
                      className={`text-xs ${
                        signMessage.kind === "ok" ? "text-emerald-600" : "text-destructive"
                      }`}
                      data-testid="ext-sign-message"
                    >
                      {signMessage.text}
                    </p>
                  )}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={openSignDialog}
                      disabled={signedAt !== null}
                      data-testid="ext-sign-open"
                    >
                      <PenLine className="h-4 w-4 mr-1" />
                      {signedAt ? "Already countersigned" : "Countersign"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Clauses</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.clauses.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">Keine Clauses hinterlegt.</p>
                )}
                {data.clauses.map((cl) => (
                  <div key={cl.id} className="border rounded-md p-3" data-testid={`ext-clause-${cl.id}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{cl.family}</span>
                      <Badge variant="outline" className="text-xs">{cl.variant}</Badge>
                      <Badge
                        variant="outline"
                        className={`text-xs ${
                          cl.severity === "high"
                            ? "bg-rose-500/10 text-rose-600 border-rose-500/30"
                            : cl.severity === "medium"
                            ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                            : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
                        }`}
                      >
                        {cl.severity}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{cl.summary}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  Comments
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.comments.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">Noch keine Comments.</p>
                )}
                {data.comments.map((c) => (
                  <div key={c.id} className="border-l-2 border-muted pl-3" data-testid={`ext-comment-${c.id}`}>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{c.authorName}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {c.authorType === "external" ? "external" : "internal"}
                      </Badge>
                      <span>{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-sm mt-1 whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}

                {canComment ? (
                  <div className="space-y-2 pt-2 border-t">
                    <textarea
                      className="w-full border rounded p-2 text-sm bg-background"
                      rows={3}
                      placeholder="Comment add…"
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      data-testid="ext-comment-input"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={postComment}
                        disabled={!commentBody.trim() || posting}
                        data-testid="ext-comment-submit"
                      >
                        Senden
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic flex items-center gap-1 pt-2 border-t">
                    <ShieldAlert className="h-3 w-3" />
                    Comments disabled for this access.
                  </p>
                )}
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground text-center pt-4">
              {t("appName", { defaultValue: "DealFlow.One" })} — sicherer externaler Zugang
            </p>
          </>
        )}
      </main>

      <Dialog open={signOpen} onOpenChange={(open) => { if (!signSubmitting) setSignOpen(open); }}>
        <DialogContent data-testid="ext-sign-dialog" className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              Contract mitzeichnen
            </DialogTitle>
            <DialogDescription>
              Bitte bestaetige deine Countersignature. Datum und Uhrzeit werden automatisch
              uebernommen. Die Unterschrift wird mit deiner E-Mail-Adresse{" "}
              <strong>{data?.collaborator.email}</strong> in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <input
                type="text"
                className="w-full border rounded px-2 py-1 text-sm bg-background"
                value={signName}
                onChange={(e) => setSignName(e.target.value)}
                placeholder="Vor- und Nachname"
                data-testid="ext-sign-name"
                maxLength={200}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">
                  Unterschrift (optional)
                </label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline"
                  onClick={clearPad}
                  data-testid="ext-sign-pad-clear"
                >
                  zuruecksetzen
                </button>
              </div>
              <canvas
                ref={padRef}
                width={420}
                height={120}
                className="w-full border rounded bg-white touch-none cursor-crosshair"
                onPointerDown={onPadDown}
                onPointerMove={onPadMove}
                onPointerUp={onPadUp}
                onPointerCancel={onPadUp}
                onPointerLeave={onPadUp}
                data-testid="ext-sign-pad"
              />
              <p className="text-[11px] text-muted-foreground">
                Du kannst hier optional eine Unterschrift zeichnen. Wenn leer, wird nur der
                Name als Countersignature gespeichert.
              </p>
            </div>
            {signMessage && signOpen && (
              <p
                className={`text-xs ${
                  signMessage.kind === "ok" ? "text-emerald-600" : "text-destructive"
                }`}
                data-testid="ext-sign-dialog-message"
              >
                {signMessage.text}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSignOpen(false)}
              disabled={signSubmitting}
              data-testid="ext-sign-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitSignature}
              disabled={signSubmitting || signName.trim().length === 0}
              data-testid="ext-sign-submit"
            >
              {signSubmitting ? "Wird gespeichert..." : "Countersignature bestaetigen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

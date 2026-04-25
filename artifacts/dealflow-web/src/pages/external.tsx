import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, ShieldAlert, MessageSquare, Lock } from "lucide-react";

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
    capabilities: ("view" | "comment" | "sign_party")[];
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
            <img src={data.brand.logoUrl} alt={data.brand.name} className="h-8 w-auto" />
          ) : (
            <FileText className="h-8 w-8 text-muted-foreground" />
          )}
          <div className="flex-1">
            <h1 className="text-lg font-semibold">{data?.brand?.name ?? "DealFlow.One"}</h1>
            <p className="text-xs text-muted-foreground">Externer Vertrags-Zugang</p>
          </div>
          {data && (
            <div className="text-xs text-muted-foreground text-right">
              <div>{data.collaborator.email}</div>
              <div>
                Gültig bis {new Date(data.collaborator.expiresAt).toLocaleString()}
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
                  ? "Dieser Magic-Link ist abgelaufen oder wurde widerrufen."
                  : error.status === 404
                  ? "Magic-Link ungültig."
                  : "Ein Fehler ist aufgetreten."}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Bitte kontaktiere die Person, die dir den Link geschickt hat — sie kann einen
                neuen Magic-Link erstellen.
              </p>
            </CardContent>
          </Card>
        )}

        {data && (
          <>
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
                    <div className="text-muted-foreground text-xs">Währung</div>
                    <div>{data.contract.currency}</div>
                  </div>
                )}
                {data.contract.effectiveFrom && (
                  <div>
                    <div className="text-muted-foreground text-xs">Gültig ab</div>
                    <div>{new Date(data.contract.effectiveFrom).toLocaleDateString()}</div>
                  </div>
                )}
                {data.contract.effectiveTo && (
                  <div>
                    <div className="text-muted-foreground text-xs">Gültig bis</div>
                    <div>{new Date(data.contract.effectiveTo).toLocaleDateString()}</div>
                  </div>
                )}
                {data.contract.governingLaw && (
                  <div>
                    <div className="text-muted-foreground text-xs">Rechtswahl</div>
                    <div>{data.contract.governingLaw}</div>
                  </div>
                )}
                {data.contract.jurisdiction && (
                  <div>
                    <div className="text-muted-foreground text-xs">Gerichtsstand</div>
                    <div>{data.contract.jurisdiction}</div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Klauseln</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.clauses.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">Keine Klauseln hinterlegt.</p>
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
                  Kommentare
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.comments.length === 0 && (
                  <p className="text-sm text-muted-foreground italic">Noch keine Kommentare.</p>
                )}
                {data.comments.map((c) => (
                  <div key={c.id} className="border-l-2 border-muted pl-3" data-testid={`ext-comment-${c.id}`}>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{c.authorName}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {c.authorType === "external" ? "extern" : "intern"}
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
                      placeholder="Kommentar hinzufügen…"
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
                    Kommentare deaktiviert für diesen Zugang.
                  </p>
                )}
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground text-center pt-4">
              {t("appName", { defaultValue: "DealFlow.One" })} — sicherer externer Zugang
            </p>
          </>
        )}
      </main>
    </div>
  );
}

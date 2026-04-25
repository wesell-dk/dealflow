import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListExternalContracts,
  useGetExternalContract,
  useDeleteExternalContract,
  getListExternalContractsQueryKey,
  type ExternalContract,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { FileText, Plus, Download, Trash2, RefreshCw, ExternalLink } from "lucide-react";
import { ExternalContractWizard } from "./external-contract-wizard";
import { useToast } from "@/hooks/use-toast";

type Props = {
  accountId: string;
  defaultBrandId?: string | null;
};

export function ExternalContractsCard({ accountId, defaultBrandId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const { data: contracts = [], isLoading } = useListExternalContracts({ accountId });
  const deleteMut = useDeleteExternalContract();

  const handleDelete = async (id: string) => {
    if (!confirm("Externen Vertrag wirklich löschen? Datei wird ebenfalls entfernt.")) return;
    try {
      await deleteMut.mutateAsync({ id });
      toast({ title: "Vertrag gelöscht" });
      await qc.invalidateQueries({
        queryKey: getListExternalContractsQueryKey({ accountId }),
      });
      await qc.invalidateQueries({ queryKey: getListExternalContractsQueryKey() });
    } catch (e) {
      toast({
        title: "Löschen fehlgeschlagen",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    }
  };

  return (
    <Card data-testid="external-contracts-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4" /> Bestandsverträge
          <Badge variant="outline" className="ml-1">{contracts.length}</Badge>
        </CardTitle>
        <Button
          size="sm"
          onClick={() => setWizardOpen(true)}
          data-testid="external-contract-upload-button"
        >
          <Plus className="h-4 w-4 mr-1" /> Externen Vertrag hochladen
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Lade…</div>
        ) : contracts.length === 0 ? (
          <div className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">
            Noch keine externen Verträge hinterlegt.
          </div>
        ) : (
          <div className="space-y-2">
            {contracts.map((c) => (
              <ExternalContractRow
                key={c.id}
                contract={c}
                onOpen={() => setDetailId(c.id)}
                onDelete={() => handleDelete(c.id)}
              />
            ))}
          </div>
        )}
      </CardContent>
      <ExternalContractWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        accountId={accountId}
        defaultBrandId={defaultBrandId}
      />
      {detailId && (
        <ExternalContractDetailDialog
          id={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </Card>
  );
}

function ExternalContractRow({
  contract,
  onOpen,
  onDelete,
}: {
  contract: ExternalContract;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded border p-3 hover:bg-muted/40 transition-colors"
      data-testid={`external-contract-row-${contract.id}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">{contract.title}</span>
          <Badge variant="secondary" className="text-[10px]">Extern</Badge>
          {contract.renewalRelevant && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <RefreshCw className="h-3 w-3" /> Renewal
            </Badge>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {contract.fileName} · {(contract.fileSize / 1024).toFixed(0)} KB
          {contract.effectiveTo && ` · gültig bis ${new Date(contract.effectiveTo).toLocaleDateString("de-DE")}`}
          {contract.valueAmount && ` · ${Number(contract.valueAmount).toLocaleString("de-DE")} ${contract.currency ?? ""}`}
        </div>
      </button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        data-testid={`external-contract-delete-${contract.id}`}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ExternalContractDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useGetExternalContract(id);

  return (
    <Dialog open onOpenChange={(v) => (v ? null : onClose())}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {data?.title ?? "Externer Vertrag"}
            <Badge variant="secondary">Extern</Badge>
          </DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="text-sm text-muted-foreground">Lade…</div>
        ) : (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Datei</dt>
              <dd className="break-all">{data.fileName} ({(data.fileSize / 1024).toFixed(0)} KB)</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd><Badge variant="outline">{data.status}</Badge></dd>
              {data.brandName && (<><dt className="text-muted-foreground">Marke</dt><dd>{data.brandName}</dd></>)}
              {data.contractTypeCode && (<><dt className="text-muted-foreground">Typ</dt><dd>{data.contractTypeCode}</dd></>)}
              <dt className="text-muted-foreground">Wert</dt>
              <dd>
                {data.valueAmount
                  ? `${Number(data.valueAmount).toLocaleString("de-DE")} ${data.currency ?? ""}`
                  : "—"}
              </dd>
              <dt className="text-muted-foreground">Laufzeit</dt>
              <dd>
                {data.effectiveFrom ? new Date(data.effectiveFrom).toLocaleDateString("de-DE") : "—"}
                {" → "}
                {data.effectiveTo ? new Date(data.effectiveTo).toLocaleDateString("de-DE") : "—"}
              </dd>
              <dt className="text-muted-foreground">Auto-Renewal</dt>
              <dd>{data.autoRenewal ? `Ja (${data.renewalNoticeDays ?? "?"} Tage)` : "Nein"}</dd>
              {data.terminationNoticeDays && (
                <><dt className="text-muted-foreground">Kündigungsfrist</dt><dd>{data.terminationNoticeDays} Tage</dd></>
              )}
              {data.governingLaw && (
                <><dt className="text-muted-foreground">Recht / Gerichtsstand</dt><dd>{data.governingLaw}{data.jurisdiction ? ` / ${data.jurisdiction}` : ""}</dd></>
              )}
            </dl>
            {data.parties.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Parteien</div>
                <ul className="mt-1 space-y-1">
                  {data.parties.map((p, i) => (
                    <li key={i} className="text-sm">
                      <span className="text-muted-foreground">{p.role}:</span> {p.name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.identifiedClauseFamilies.length > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Klausel-Familien
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {data.identifiedClauseFamilies.map((c, i) => (
                    <Badge key={i} variant="outline" className="text-xs">
                      {c.name} · {Math.round(c.confidence * 100)}%
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {data.notes && (
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">Notizen</div>
                <p className="mt-1 whitespace-pre-wrap text-sm">{data.notes}</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Schließen</Button>
          {data && (
            <Button asChild data-testid="external-contract-download">
              <a href={data.downloadUrl} target="_blank" rel="noreferrer">
                <Download className="h-4 w-4 mr-1" /> Original herunterladen
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

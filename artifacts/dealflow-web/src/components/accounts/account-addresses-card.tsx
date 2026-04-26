import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateAccountAddress,
  useUpdateAccountAddress,
  useDeleteAccountAddress,
  getGetAccountQueryKey,
  getListAccountAddressesQueryKey,
  AccountAddressType,
  type AccountAddress,
  type AccountAddressInput,
  type AccountAddressPatch,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { Building2, MapPin, MoreHorizontal, Pencil, Plus, Star, Trash2, Loader2 } from "lucide-react";

const TYPE_LABELS: Record<AccountAddressType, string> = {
  hauptsitz: "Hauptsitz",
  rechnungsadresse: "Rechnungsadresse",
  lieferadresse: "Lieferadresse",
  werk: "Werk",
  niederlassung: "Niederlassung",
  sonstiges: "Sonstiges",
};

const TYPE_ORDER: AccountAddressType[] = [
  "hauptsitz",
  "rechnungsadresse",
  "lieferadresse",
  "werk",
  "niederlassung",
  "sonstiges",
];

type Props = {
  accountId: string;
  addresses: AccountAddress[];
};

// Standorte-Karte für die Account-Detailseite — listet aktive und
// inaktive Standorte sortiert nach Primary, Typ und Label.
export function AccountAddressesCard({ accountId, addresses }: Props) {
  const [editAddress, setEditAddress] = useState<AccountAddress | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<AccountAddress | null>(null);

  const sorted = useMemo(() => sortAddresses(addresses), [addresses]);
  const active = sorted.filter((a) => a.isActive);
  const inactive = sorted.filter((a) => !a.isActive);

  return (
    <Card data-testid="account-addresses-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          Standorte
          <Badge variant="secondary" className="ml-1 font-normal">{active.length}</Badge>
        </CardTitle>
        <Button size="sm" onClick={() => setCreateOpen(true)} data-testid="account-address-add">
          <Plus className="h-3.5 w-3.5 mr-1" /> Standort hinzufügen
        </Button>
      </CardHeader>
      <CardContent>
        {active.length === 0 && inactive.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm" data-testid="account-addresses-empty">
            Noch keine Standorte hinterlegt. Lege z. B. Hauptsitz oder Rechnungsadresse an.
          </div>
        ) : (
          <div className="space-y-3">
            {active.map((a) => (
              <AddressRow
                key={a.id}
                address={a}
                accountId={accountId}
                onEdit={() => setEditAddress(a)}
                onDelete={() => setToDelete(a)}
              />
            ))}
            {inactive.length > 0 && (
              <details className="rounded-md border border-dashed p-2 text-sm">
                <summary className="cursor-pointer text-muted-foreground">
                  Archivierte Standorte ({inactive.length})
                </summary>
                <div className="mt-2 space-y-2">
                  {inactive.map((a) => (
                    <AddressRow
                      key={a.id}
                      address={a}
                      accountId={accountId}
                      onEdit={() => setEditAddress(a)}
                      onDelete={() => setToDelete(a)}
                      muted
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </CardContent>

      <AddressDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        accountId={accountId}
        existing={null}
      />
      <AddressDialog
        open={!!editAddress}
        onOpenChange={(o) => { if (!o) setEditAddress(null); }}
        accountId={accountId}
        existing={editAddress}
      />
      <DeleteAddressDialog
        accountId={accountId}
        target={toDelete}
        onClose={() => setToDelete(null)}
      />
    </Card>
  );
}

function sortAddresses(list: AccountAddress[]): AccountAddress[] {
  return [...list].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    const ai = TYPE_ORDER.indexOf(a.types[0] ?? "sonstiges");
    const bi = TYPE_ORDER.indexOf(b.types[0] ?? "sonstiges");
    if (ai !== bi) return ai - bi;
    return (a.label ?? "").localeCompare(b.label ?? "");
  });
}

function AddressRow({
  address, accountId, onEdit, onDelete, muted,
}: {
  address: AccountAddress;
  accountId: string;
  onEdit: () => void;
  onDelete: () => void;
  muted?: boolean;
}) {
  const qc = useQueryClient();
  const update = useUpdateAccountAddress();
  const { toast } = useToast();

  const lines = [
    address.street,
    [address.postalCode, address.city].filter(Boolean).join(" "),
    [address.region, address.country].filter(Boolean).join(", "),
  ].filter((s) => s && s.trim());

  const setPrimary = async () => {
    try {
      await update.mutateAsync({
        id: accountId,
        addressId: address.id,
        data: { isPrimary: true },
      });
      await qc.invalidateQueries({ queryKey: getGetAccountQueryKey(accountId) });
      await qc.invalidateQueries({ queryKey: getListAccountAddressesQueryKey(accountId) });
      toast({ title: "Als Primär gesetzt" });
    } catch (e) {
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      });
    }
  };

  return (
    <div
      className={`flex items-start justify-between gap-3 p-3 border rounded-lg ${muted ? "opacity-60" : ""}`}
      data-testid={`address-row-${address.id}`}
    >
      <div className="flex items-start gap-2 min-w-0">
        <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{address.label || "Standort"}</span>
            {address.isPrimary && (
              <Badge variant="default" className="gap-1">
                <Star className="h-3 w-3" /> Primär
              </Badge>
            )}
            {address.types.map((t) => (
              <Badge key={t} variant="outline">{TYPE_LABELS[t]}</Badge>
            ))}
          </div>
          {lines.length > 0 && (
            <div className="text-sm text-muted-foreground mt-1 whitespace-pre-line">
              {lines.join("\n")}
            </div>
          )}
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Aktionen" data-testid={`address-actions-${address.id}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!address.isPrimary && address.isActive && (
            <DropdownMenuItem onSelect={setPrimary} data-testid={`address-set-primary-${address.id}`}>
              <Star className="h-3.5 w-3.5 mr-2" /> Als Primär setzen
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onEdit} data-testid={`address-edit-${address.id}`}>
            <Pencil className="h-3.5 w-3.5 mr-2" /> Bearbeiten
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={onDelete}
            data-testid={`address-delete-${address.id}`}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            {address.isActive ? "Archivieren" : "Endgültig löschen"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function AddressDialog({
  open, onOpenChange, accountId, existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accountId: string;
  existing: AccountAddress | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const create = useCreateAccountAddress();
  const update = useUpdateAccountAddress();
  const isEdit = Boolean(existing);

  const [label, setLabel] = useState("");
  const [street, setStreet] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [country, setCountry] = useState("");
  const [types, setTypes] = useState<Set<AccountAddressType>>(new Set(["rechnungsadresse"]));
  const [isPrimary, setIsPrimary] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(existing?.label ?? "");
    setStreet(existing?.street ?? "");
    setPostalCode(existing?.postalCode ?? "");
    setCity(existing?.city ?? "");
    setRegion(existing?.region ?? "");
    setCountry(existing?.country ?? "");
    setTypes(new Set(existing?.types ?? ["rechnungsadresse"]));
    setIsPrimary(existing?.isPrimary ?? false);
  }, [open, existing]);

  const pending = create.isPending || update.isPending;

  const toggleType = (t: AccountAddressType) => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (types.size === 0) {
      toast({
        title: "Typ fehlt",
        description: "Mindestens ein Adresstyp ist erforderlich.",
        variant: "destructive",
      });
      return;
    }
    const typeArray = Array.from(types);
    try {
      if (isEdit && existing) {
        const patch: AccountAddressPatch = {
          label: label.trim() || null,
          street: street.trim() || null,
          postalCode: postalCode.trim() || null,
          city: city.trim() || null,
          region: region.trim() || null,
          country: country.trim() || null,
          types: typeArray,
          isPrimary,
        };
        await update.mutateAsync({
          id: accountId,
          addressId: existing.id,
          data: patch,
        });
        toast({ title: "Standort aktualisiert" });
      } else {
        const data: AccountAddressInput = {
          label: label.trim() || null,
          street: street.trim() || null,
          postalCode: postalCode.trim() || null,
          city: city.trim() || null,
          region: region.trim() || null,
          country: country.trim() || null,
          types: typeArray,
          isPrimary,
        };
        await create.mutateAsync({ id: accountId, data });
        toast({ title: "Standort angelegt" });
      }
      await qc.invalidateQueries({ queryKey: getGetAccountQueryKey(accountId) });
      await qc.invalidateQueries({ queryKey: getListAccountAddressesQueryKey(accountId) });
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Speichern fehlgeschlagen",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="account-address-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Standort bearbeiten" : "Standort anlegen"}</DialogTitle>
          <DialogDescription>
            Standorte können mehrere Rollen haben (z. B. Hauptsitz und Rechnungsadresse).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="addr-label">Label</Label>
            <Input
              id="addr-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="z. B. Werk Süd"
              disabled={pending}
              data-testid="account-address-label"
            />
          </div>
          <div className="space-y-2">
            <Label>Typen *</Label>
            <div className="grid grid-cols-2 gap-2">
              {TYPE_ORDER.map((t) => (
                <label key={t} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={types.has(t)}
                    onCheckedChange={() => toggleType(t)}
                    disabled={pending}
                    data-testid={`account-address-type-${t}`}
                  />
                  <span>{TYPE_LABELS[t]}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="addr-street">Straße</Label>
            <Input
              id="addr-street"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              placeholder="Musterstraße 1"
              disabled={pending}
              data-testid="account-address-street"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="addr-zip">PLZ</Label>
              <Input
                id="addr-zip"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="10115"
                disabled={pending}
                data-testid="account-address-zip"
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="addr-city">Stadt</Label>
              <Input
                id="addr-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Berlin"
                disabled={pending}
                data-testid="account-address-city"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="addr-region">Region / Bundesland</Label>
              <Input
                id="addr-region"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="Berlin"
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="addr-country">Land (ISO)</Label>
              <Input
                id="addr-country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="DE"
                disabled={pending}
                data-testid="account-address-country"
              />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={isPrimary}
              onCheckedChange={(v) => setIsPrimary(Boolean(v))}
              disabled={pending}
              data-testid="account-address-primary"
              className="mt-0.5"
            />
            <span>
              Als primären Standort markieren
              <span className="block text-xs text-muted-foreground">
                Bisherige Primär-Standorte werden automatisch zurückgesetzt.
              </span>
            </span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending} data-testid="account-address-submit">
              {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Speichern" : "Anlegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAddressDialog({
  accountId, target, onClose,
}: {
  accountId: string;
  target: AccountAddress | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const del = useDeleteAccountAddress();

  return (
    <AlertDialog open={!!target} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Standort archivieren</AlertDialogTitle>
          <AlertDialogDescription>
            {target && (
              <>„{target.label || "Standort"}" wird deaktiviert. Verknüpfte Kontakte verlieren die Standort-Zuordnung.</>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Abbrechen</AlertDialogCancel>
          <AlertDialogAction
            disabled={del.isPending}
            data-testid="account-address-delete-confirm"
            onClick={async (e) => {
              e.preventDefault();
              if (!target) return;
              try {
                await del.mutateAsync({ id: accountId, addressId: target.id });
                await qc.invalidateQueries({ queryKey: getGetAccountQueryKey(accountId) });
                await qc.invalidateQueries({ queryKey: getListAccountAddressesQueryKey(accountId) });
                toast({ title: "Standort archiviert" });
                onClose();
              } catch (err) {
                toast({
                  title: "Fehler",
                  description: err instanceof Error ? err.message : "",
                  variant: "destructive",
                });
              }
            }}
          >
            Archivieren
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

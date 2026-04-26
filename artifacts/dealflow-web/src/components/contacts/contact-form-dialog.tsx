import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateContact,
  useUpdateContact,
  getGetAccountQueryKey,
  getListContactsQueryKey,
  type ContactInput,
  type ContactPatch,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import type { AccountAddress } from "@workspace/api-client-react";

export type EditableContact = {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string | null;
  isDecisionMaker: boolean;
  addressId?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  contact?: EditableContact | null;
  initialDraft?: Partial<EditableContact> | null;
  addresses?: AccountAddress[];
};

export function ContactFormDialog({ open, onOpenChange, accountId, contact, initialDraft, addresses }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const create = useCreateContact();
  const update = useUpdateContact();
  const isEdit = Boolean(contact);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isDecisionMaker, setIsDecisionMaker] = useState(false);
  const [addressId, setAddressId] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    const src = contact ?? initialDraft ?? {};
    setName(src.name ?? "");
    setRole(src.role ?? "");
    setEmail(src.email ?? "");
    setPhone(src.phone ?? "");
    setIsDecisionMaker(Boolean(src.isDecisionMaker));
    setAddressId(src.addressId ?? "");
  }, [open, contact, initialDraft]);

  const activeAddresses = (addresses ?? []).filter((a) => a.isActive);

  const pending = create.isPending || update.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast({ title: "Name missing", description: "Please enter a name.", variant: "destructive" });
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast({ title: "Invalid email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    try {
      if (isEdit && contact) {
        const patch: ContactPatch = {};
        if (trimmedName !== contact.name) patch.name = trimmedName;
        const r = role.trim();
        if (r !== contact.role) patch.role = r;
        if (trimmedEmail !== contact.email) patch.email = trimmedEmail || null;
        const p = phone.trim();
        if (p !== (contact.phone ?? "")) patch.phone = p || null;
        if (isDecisionMaker !== contact.isDecisionMaker) patch.isDecisionMaker = isDecisionMaker;
        const newAddrId = addressId || null;
        const oldAddrId = contact.addressId ?? null;
        if (newAddrId !== oldAddrId) patch.addressId = newAddrId;
        if (Object.keys(patch).length === 0) {
          onOpenChange(false);
          return;
        }
        await update.mutateAsync({ id: contact.id, data: patch });
        toast({ title: "Contact updated", description: trimmedName });
      } else {
        const data: ContactInput = {
          name: trimmedName,
          role: role.trim(),
          email: trimmedEmail || null,
          phone: phone.trim() || null,
          isDecisionMaker,
          addressId: addressId || null,
        };
        await create.mutateAsync({ id: accountId, data });
        toast({ title: "Contact created", description: trimmedName });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetAccountQueryKey(accountId) }),
        qc.invalidateQueries({ queryKey: getListContactsQueryKey({ accountId }) }),
      ]);
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Save failed",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!pending) onOpenChange(o); }}>
      <DialogContent className="max-w-md" data-testid="contact-form-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit contact" : "Add contact"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the details of this contact."
              : "Add a new contact for this customer."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="contact-name">Name *</Label>
            <Input
              id="contact-name"
              data-testid="contact-form-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Anna Schmidt"
              autoFocus
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-role">Role</Label>
            <Input
              id="contact-role"
              data-testid="contact-form-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Managing Director, Procurement"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              data-testid="contact-form-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="anna.schmidt@firma.de"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-phone">Phone</Label>
            <Input
              id="contact-phone"
              data-testid="contact-form-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+49 30 1234567"
              disabled={pending}
            />
          </div>
          {activeAddresses.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="contact-address">Standort</Label>
              <Select
                value={addressId || "_none"}
                onValueChange={(v) => setAddressId(v === "_none" ? "" : v)}
                disabled={pending}
              >
                <SelectTrigger id="contact-address" data-testid="contact-form-address">
                  <SelectValue placeholder="Standort wählen…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">— kein Standort —</SelectItem>
                  {activeAddresses.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {[a.label, a.city, a.country].filter(Boolean).join(", ") || a.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional — verknüpft den Kontakt mit einem Standort dieses Kunden.
              </p>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isDecisionMaker}
              onCheckedChange={(v) => setIsDecisionMaker(Boolean(v))}
              disabled={pending}
              data-testid="contact-form-decision-maker"
            />
            <span>Decision maker</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending} data-testid="contact-form-submit">
              {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

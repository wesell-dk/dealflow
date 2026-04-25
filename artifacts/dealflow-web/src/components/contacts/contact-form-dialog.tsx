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
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export type EditableContact = {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string | null;
  isDecisionMaker: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  contact?: EditableContact | null;
  initialDraft?: Partial<EditableContact> | null;
};

export function ContactFormDialog({ open, onOpenChange, accountId, contact, initialDraft }: Props) {
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

  useEffect(() => {
    if (!open) return;
    const src = contact ?? initialDraft ?? {};
    setName(src.name ?? "");
    setRole(src.role ?? "");
    setEmail(src.email ?? "");
    setPhone(src.phone ?? "");
    setIsDecisionMaker(Boolean(src.isDecisionMaker));
  }, [open, contact, initialDraft]);

  const pending = create.isPending || update.isPending;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast({ title: "Name fehlt", description: "Bitte einen Namen angeben.", variant: "destructive" });
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      toast({ title: "E-Mail ungültig", description: "Bitte eine gültige E-Mail-Adresse eingeben.", variant: "destructive" });
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
        if (Object.keys(patch).length === 0) {
          onOpenChange(false);
          return;
        }
        await update.mutateAsync({ id: contact.id, data: patch });
        toast({ title: "Kontakt aktualisiert", description: trimmedName });
      } else {
        const data: ContactInput = {
          name: trimmedName,
          role: role.trim(),
          email: trimmedEmail || null,
          phone: phone.trim() || null,
          isDecisionMaker,
        };
        await create.mutateAsync({ id: accountId, data });
        toast({ title: "Kontakt angelegt", description: trimmedName });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getGetAccountQueryKey(accountId) }),
        qc.invalidateQueries({ queryKey: getListContactsQueryKey({ accountId }) }),
      ]);
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
      <DialogContent className="max-w-md" data-testid="contact-form-dialog">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Kontakt bearbeiten" : "Kontakt hinzufügen"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Aktualisiere die Daten dieses Ansprechpartners."
              : "Lege einen neuen Ansprechpartner für diesen Kunden an."}
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
              placeholder="z.B. Anna Schmidt"
              autoFocus
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-role">Rolle</Label>
            <Input
              id="contact-role"
              data-testid="contact-form-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="z.B. Geschäftsführerin, Einkauf"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact-email">E-Mail</Label>
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
            <Label htmlFor="contact-phone">Telefon</Label>
            <Input
              id="contact-phone"
              data-testid="contact-form-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+49 30 1234567"
              disabled={pending}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isDecisionMaker}
              onCheckedChange={(v) => setIsDecisionMaker(Boolean(v))}
              disabled={pending}
              data-testid="contact-form-decision-maker"
            />
            <span>Entscheider</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={pending} data-testid="contact-form-submit">
              {pending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Speichern" : "Anlegen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

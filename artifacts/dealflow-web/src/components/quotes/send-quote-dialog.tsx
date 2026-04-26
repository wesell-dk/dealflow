import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSendQuoteEmail,
  useGetDeal,
  useListContacts,
  getGetQuoteQueryKey,
  getGetDealQueryKey,
  getListContactsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Mail, AlertTriangle } from "lucide-react";

interface Props {
  quoteId: string;
  quoteNumber: string;
  dealId: string;
  language: "de" | "en";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RecipientChoice {
  email: string;
  name: string;
  role: string;
  isDecisionMaker: boolean;
  selected: boolean;
}

function parseList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map(v => v.trim())
    .filter(Boolean);
}

export function SendQuoteDialog({ quoteId, quoteNumber, dealId, language }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const sendMut = useSendQuoteEmail();

  // Pull deal → accountId, then contacts of that account.
  const { data: deal } = useGetDeal(dealId, {
    query: { enabled: open, queryKey: getGetDealQueryKey(dealId) },
  });
  const accountId = deal?.accountId;
  const contactsParams = accountId ? { accountId } : undefined;
  const { data: contacts, isLoading: contactsLoading } = useListContacts(
    contactsParams,
    {
      query: {
        enabled: open && !!accountId,
        queryKey: getListContactsQueryKey(contactsParams),
      },
    },
  );

  const customer = deal?.accountName ?? "";
  const brandName = deal?.brandName ?? "";

  // Suggested defaults regenerate when context becomes available.
  const defaultSubject = useMemo(() => {
    const number = quoteNumber;
    if (language === "en") {
      return `Quote ${number}${brandName ? " – " + brandName : ""}`;
    }
    return `Angebot ${number}${brandName ? " – " + brandName : ""}`;
  }, [quoteNumber, brandName, language]);

  const defaultMessage = useMemo(() => {
    const customerLine = customer ? customer : t("pages.quote.send.defaultCustomer");
    if (language === "en") {
      return [
        `Dear team at ${customerLine},`,
        "",
        `please find attached our quote ${quoteNumber}.`,
        "Should you have any questions, please feel free to reach out.",
        "",
        "Kind regards",
        brandName || t("pages.quote.send.defaultBrand"),
      ].join("\n");
    }
    return [
      `Sehr geehrtes Team von ${customerLine},`,
      "",
      `anbei finden Sie unser Angebot ${quoteNumber}.`,
      "Bei Rückfragen stehen wir Ihnen gerne zur Verfügung.",
      "",
      "Mit freundlichen Grüßen",
      brandName || t("pages.quote.send.defaultBrand"),
    ].join("\n");
  }, [customer, brandName, quoteNumber, language, t]);

  const [recipients, setRecipients] = useState<RecipientChoice[]>([]);
  const [extraTo, setExtraTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [touchedSubject, setTouchedSubject] = useState(false);
  const [touchedMessage, setTouchedMessage] = useState(false);

  // Hydrate dialog defaults whenever it opens or context arrives.
  useEffect(() => {
    if (!open) return;
    if (!touchedSubject) setSubject(defaultSubject);
    if (!touchedMessage) setMessage(defaultMessage);
  }, [open, defaultSubject, defaultMessage, touchedSubject, touchedMessage]);

  // Build recipient list from contacts. Decision-makers are pre-selected.
  useEffect(() => {
    if (!open || !contacts) return;
    const withEmail: RecipientChoice[] = contacts
      .filter(c => typeof c.email === "string" && EMAIL_RE.test(c.email))
      .map(c => ({
        email: c.email,
        name: c.name,
        role: c.role,
        isDecisionMaker: c.isDecisionMaker,
        // default: pre-select decision makers; if none flagged, pick all.
        selected: c.isDecisionMaker,
      }));
    if (withEmail.length > 0 && !withEmail.some(r => r.selected)) {
      for (const r of withEmail) r.selected = true;
    }
    setRecipients(withEmail);
  }, [open, contacts]);

  function reset() {
    setOpen(false);
    setExtraTo("");
    setCc("");
    setTouchedSubject(false);
    setTouchedMessage(false);
    setSubject("");
    setMessage("");
    setRecipients([]);
  }

  const selectedFromContacts = recipients.filter(r => r.selected).map(r => r.email);
  const extras = parseList(extraTo);
  const allTo = Array.from(new Set([...selectedFromContacts, ...extras]));
  const ccList = Array.from(new Set(parseList(cc)));

  const invalidTo = allTo.find(e => !EMAIL_RE.test(e));
  const invalidCc = ccList.find(e => !EMAIL_RE.test(e));
  const noContactsWithEmail =
    !contactsLoading && !!contacts && recipients.length === 0;
  const canSubmit =
    allTo.length > 0
    && !invalidTo
    && !invalidCc
    && subject.trim().length > 0
    && message.trim().length > 0
    && !sendMut.isPending;

  async function onSend() {
    if (!canSubmit) return;
    try {
      await sendMut.mutateAsync({
        id: quoteId,
        data: {
          to: allTo,
          cc: ccList.length > 0 ? ccList : undefined,
          subject: subject.trim(),
          message,
        },
      });
      toast({
        title: t("pages.quote.send.success"),
        description: allTo.join(", "),
      });
      await qc.invalidateQueries({ queryKey: getGetQuoteQueryKey(quoteId) });
      reset();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toast({
        title: t("pages.quote.send.failed"),
        description: msg,
        variant: "destructive",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
      <DialogTrigger asChild>
        <Button
          variant="default"
          size="sm"
          data-testid={`quote-send-${quoteId}`}
        >
          <Mail className="h-4 w-4 mr-1.5" />
          {t("pages.quote.send.action")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("pages.quote.send.title", { number: quoteNumber })}</DialogTitle>
          <DialogDescription>
            {t("pages.quote.send.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("pages.quote.send.recipients")}</Label>
            {contactsLoading && (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> {t("common.loading")}
              </div>
            )}
            {noContactsWithEmail && (
              <Alert variant="destructive" data-testid="quote-send-no-contacts">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {t("pages.quote.send.noContactEmails")}
                </AlertDescription>
              </Alert>
            )}
            {recipients.length > 0 && (
              <div className="space-y-1.5 rounded-md border p-3">
                {recipients.map((r, i) => (
                  <label
                    key={r.email}
                    className="flex items-start gap-2 cursor-pointer text-sm"
                    data-testid={`quote-send-contact-${i}`}
                  >
                    <Checkbox
                      checked={r.selected}
                      onCheckedChange={(checked) => {
                        setRecipients(prev =>
                          prev.map((p, j) => j === i ? { ...p, selected: checked === true } : p),
                        );
                      }}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{r.name}{r.isDecisionMaker && (
                        <span className="ml-2 text-xs uppercase tracking-wide text-primary">
                          {t("pages.quote.send.decisionMaker")}
                        </span>
                      )}</div>
                      <div className="text-xs text-muted-foreground">{r.email}{r.role ? ` · ${r.role}` : ""}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="quote-send-extra-to">{t("pages.quote.send.additionalRecipients")}</Label>
            <Input
              id="quote-send-extra-to"
              placeholder="name@example.com, ..."
              value={extraTo}
              onChange={(e) => setExtraTo(e.target.value)}
              data-testid="quote-send-extra-to"
            />
            {invalidTo && (
              <p className="text-xs text-destructive">
                {t("pages.quote.send.invalidEmail", { email: invalidTo })}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="quote-send-cc">{t("pages.quote.send.cc")}</Label>
            <Input
              id="quote-send-cc"
              placeholder="cc@example.com"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              data-testid="quote-send-cc"
            />
            {invalidCc && (
              <p className="text-xs text-destructive">
                {t("pages.quote.send.invalidEmail", { email: invalidCc })}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="quote-send-subject">{t("pages.quote.send.subject")}</Label>
            <Input
              id="quote-send-subject"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setTouchedSubject(true); }}
              data-testid="quote-send-subject"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="quote-send-message">{t("pages.quote.send.message")}</Label>
            <Textarea
              id="quote-send-message"
              value={message}
              onChange={(e) => { setMessage(e.target.value); setTouchedMessage(true); }}
              rows={9}
              data-testid="quote-send-message"
            />
            <p className="text-xs text-muted-foreground">
              {t("pages.quote.send.attachmentHint", { number: quoteNumber })}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => reset()} disabled={sendMut.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={onSend}
            disabled={!canSubmit}
            data-testid="quote-send-submit"
          >
            {sendMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <Mail className="h-4 w-4 mr-1.5" />
            {t("pages.quote.send.action")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

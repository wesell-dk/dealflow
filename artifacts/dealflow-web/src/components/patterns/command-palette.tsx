import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  Building2, Briefcase, FileText, FileSignature, Quote as QuoteIcon, ListChecks,
  Plus, Search, Settings, Home, Users, Receipt, Boxes, ShieldCheck, History,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useListAccounts, useListDeals, useListContracts, useListQuotes } from "@workspace/api-client-react";
import { useRecents } from "@/hooks/use-recents";

interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: typeof Building2;
  shortcut?: string;
}

const NAV: NavItem[] = [
  { id: "home", label: "Start", href: "/home", icon: Home, shortcut: "G H" },
  { id: "accounts", label: "Accounts", href: "/accounts", icon: Building2, shortcut: "G A" },
  { id: "deals", label: "Deals", href: "/deals", icon: Briefcase, shortcut: "G D" },
  { id: "contracts", label: "Verträge", href: "/contracts", icon: FileText, shortcut: "G C" },
  { id: "quotes", label: "Angebote", href: "/quotes", icon: QuoteIcon, shortcut: "G Q" },
  { id: "negotiations", label: "Verhandlungen", href: "/negotiations", icon: FileSignature },
  { id: "tasks", label: "Aufgaben", href: "/tasks", icon: ListChecks },
  { id: "users", label: "Nutzer", href: "/admin/users", icon: Users },
  { id: "products", label: "Produkte", href: "/products", icon: Boxes },
  { id: "billing", label: "Abrechnung", href: "/billing", icon: Receipt },
  { id: "audit", label: "Audit-Log", href: "/audit", icon: ShieldCheck },
  { id: "settings", label: "Einstellungen", href: "/settings", icon: Settings },
];

const ACTIONS: { id: string; label: string; href: string; icon: typeof Plus }[] = [
  { id: "new-account", label: "Neuer Account", href: "/accounts?new=1", icon: Building2 },
  { id: "new-deal", label: "Neuer Deal", href: "/deals?new=1", icon: Briefcase },
  { id: "new-contract", label: "Neuer Vertrag", href: "/contracts?new=1", icon: FileText },
  { id: "new-quote", label: "Neues Angebot", href: "/quotes?new=1", icon: QuoteIcon },
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const recents = useRecents();

  // Lists are typically already cached by other pages; refetch is cheap.
  const { data: accounts } = useListAccounts();
  const { data: deals } = useListDeals();
  const { data: contracts } = useListContracts();
  const { data: quotes } = useListQuotes();

  // Reset query when closed
  useEffect(() => { if (!open) setQuery(""); }, [open]);

  const q = query.trim().toLowerCase();
  const matchAcc = useMemo(() => {
    if (!accounts) return [];
    const list = q ? accounts.filter((a) => a.name.toLowerCase().includes(q) || a.industry.toLowerCase().includes(q)) : accounts;
    return list.slice(0, 6);
  }, [accounts, q]);
  const matchDeals = useMemo(() => {
    if (!deals) return [];
    const list = q ? deals.filter((d) => d.name.toLowerCase().includes(q) || d.accountName.toLowerCase().includes(q)) : deals;
    return list.slice(0, 6);
  }, [deals, q]);
  const matchContracts = useMemo(() => {
    if (!contracts) return [];
    const list = q ? contracts.filter((c) => (c.title ?? "").toLowerCase().includes(q)) : contracts;
    return list.slice(0, 4);
  }, [contracts, q]);
  const matchQuotes = useMemo(() => {
    if (!quotes) return [];
    const list = q ? quotes.filter((qq) =>
      (qq.id ?? "").toLowerCase().includes(q) ||
      (qq.number ?? "").toLowerCase().includes(q) ||
      (qq.dealName ?? "").toLowerCase().includes(q)
    ) : quotes;
    return list.slice(0, 4);
  }, [quotes, q]);

  const matchNav = useMemo(() => q
    ? NAV.filter((n) => n.label.toLowerCase().includes(q))
    : NAV.slice(0, 6), [q]);

  function go(href: string) {
    onOpenChange(false);
    navigate(href);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Suche Accounts, Deals, Verträge … oder schreib einen Befehl"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>Keine Treffer für „{query}".</CommandEmpty>

        {!q && recents.length > 0 && (
          <>
            <CommandGroup heading="Zuletzt geöffnet">
              {recents.slice(0, 5).map((r) => (
                <CommandItem key={`${r.kind}-${r.id}`} value={`recent-${r.label}`} onSelect={() => go(r.href)}>
                  <History className="h-4 w-4 mr-2 text-muted-foreground" />
                  <span>{r.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground capitalize">{r.kind}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {matchAcc.length > 0 && (
          <CommandGroup heading="Accounts">
            {matchAcc.map((a) => (
              <CommandItem key={a.id} value={`acc-${a.name}-${a.id}`} onSelect={() => go(`/accounts/${a.id}`)}>
                <Building2 className="h-4 w-4 mr-2 text-blue-600" />
                <span className="truncate">{a.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{a.industry}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {matchDeals.length > 0 && (
          <CommandGroup heading="Deals">
            {matchDeals.map((d) => (
              <CommandItem key={d.id} value={`deal-${d.name}-${d.id}`} onSelect={() => go(`/deals/${d.id}`)}>
                <Briefcase className="h-4 w-4 mr-2 text-emerald-600" />
                <span className="truncate">{d.name}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{d.accountName}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {matchContracts.length > 0 && (
          <CommandGroup heading="Verträge">
            {matchContracts.map((c) => (
              <CommandItem key={c.id} value={`con-${c.title}-${c.id}`} onSelect={() => go(`/contracts/${c.id}`)}>
                <FileText className="h-4 w-4 mr-2 text-indigo-600" />
                <span className="truncate">{c.title || c.id}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {matchQuotes.length > 0 && (
          <CommandGroup heading="Angebote">
            {matchQuotes.map((qq) => (
              <CommandItem key={qq.id} value={`quote-${qq.number}-${qq.id}`} onSelect={() => go(`/quotes/${qq.id}`)}>
                <QuoteIcon className="h-4 w-4 mr-2 text-violet-600" />
                <span className="truncate">{qq.number || qq.id}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{qq.dealName}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />
        <CommandGroup heading="Aktionen">
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            return (
              <CommandItem key={a.id} value={`action-${a.label}`} onSelect={() => go(a.href)}>
                <Plus className="h-4 w-4 mr-2 text-foreground" />
                <Icon className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                <span>{a.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Navigation">
          {matchNav.map((n) => {
            const Icon = n.icon;
            return (
              <CommandItem key={n.id} value={`nav-${n.label}`} onSelect={() => go(n.href)}>
                <Icon className="h-4 w-4 mr-2 text-muted-foreground" />
                <span>{n.label}</span>
                {n.shortcut && <CommandShortcut>{n.shortcut}</CommandShortcut>}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {!q && (
          <div className="border-t px-3 py-2 text-[10px] text-muted-foreground flex items-center gap-3">
            <Search className="h-3 w-3" />
            <span>Tipp: ⌘ K öffnet diese Suche von überall</span>
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}

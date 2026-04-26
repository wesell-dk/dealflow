import { Link } from "wouter";
import { History, Building2, Briefcase, FileText, Quote as QuoteIcon, FileSignature, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRecents, useRemoveRecent, clearRecents, type RecentKind } from "@/hooks/use-recents";

const ICONS: Record<RecentKind, typeof Building2> = {
  account: Building2,
  deal: Briefcase,
  contract: FileText,
  quote: QuoteIcon,
  negotiation: FileSignature,
  lead: UserPlus,
};

const KIND_LABEL: Record<RecentKind, string> = {
  account: "Account",
  deal: "Deal",
  contract: "Contract",
  quote: "Quote",
  negotiation: "Negotiation",
  lead: "Lead",
};

export function RecentsDropdown() {
  const items = useRecents();
  const removeRecent = useRemoveRecent();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" data-testid="recents-trigger">
          <History className="h-4 w-4" />
          <span className="hidden md:inline text-xs">Recent</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Recently opened</span>
          {items.length > 0 && (
            <button
              onClick={() => clearRecents()}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear list
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No entries yet — open an account or deal.
          </div>
        ) : (
          items.map((item) => {
            const Icon = ICONS[item.kind];
            return (
              <DropdownMenuItem key={`${item.kind}-${item.id}`} asChild className="group">
                <Link
                  href={item.href}
                  className="flex items-center gap-2 w-full"
                >
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate flex-1">{item.label}</span>
                  <span className="text-[10px] text-muted-foreground">{KIND_LABEL[item.kind]}</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeRecent(item.kind, item.id);
                    }}
                    className="ml-1 opacity-0 group-hover:opacity-100 hover:bg-muted rounded p-0.5"
                    aria-label="Remove from list"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Link>
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

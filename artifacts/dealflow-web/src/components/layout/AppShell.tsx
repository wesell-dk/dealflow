import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  BadgeDollarSign,
  CheckSquare,
  FileSignature,
  Handshake,
  PenTool,
  TrendingUp,
  Users,
  BarChart3,
  Bot,
  Scale,
  Settings,
  Search,
  Bell,
  Menu,
  Languages,
  ClipboardCheck,
  CalendarClock,
  History,
  FileStack,
  Paperclip,
  Building2,
  ClipboardList,
  User as UserIcon,
  UserPlus,
  BookOpen,
  Upload,
  Lightbulb,
  ChevronRight,
  ChevronDown,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useGetTenant, useGetDashboardSummary } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { setLanguage } from "@/lib/i18n";
import { HelpBot } from "@/components/help-bot";
import { ScopeSwitcher } from "@/components/scope-switcher";
import { HelpCircle, Compass } from "lucide-react";
import { useOnboarding } from "@/contexts/onboarding-context";
import { WelcomeDialog } from "@/components/onboarding/welcome-dialog";
import { PageHelpDrawer } from "@/components/onboarding/page-help";
import { CommandPalette } from "@/components/patterns/command-palette";
import { RecentsDropdown } from "@/components/patterns/recents-dropdown";

interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  gate?: boolean;
  badgeKey?: "approvals" | "signatures" | "renewals" | "obligations" | "priceIncreases";
}

interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

function useNavigationGroups(): NavGroup[] {
  const { t } = useTranslation();
  const { user } = useAuth();

  const settingsItems: NavItem[] = [
    { key: "templates", label: t("nav.templates"), href: "/templates", icon: FileStack },
    { key: "clauses", label: t("nav.clauses"), href: "/clauses", icon: BookOpen },
    { key: "clausesImport", label: t("nav.clausesImport"), href: "/clauses/import", icon: Upload },
    { key: "clausesSuggestions", label: t("nav.clausesSuggestions"), href: "/clauses/suggestions", icon: Lightbulb },
    { key: "attachments", label: t("nav.attachments"), href: "/attachments", icon: Paperclip },
    { key: "pricing", label: t("nav.pricing"), href: "/pricing", icon: BadgeDollarSign },
    { key: "admin", label: t("nav.admin"), href: "/admin", icon: Settings },
    { key: "audit", label: t("nav.audit"), href: "/audit", icon: History },
  ];
  if (user?.isPlatformAdmin) {
    settingsItems.push({
      key: "platformAdmin",
      label: t("nav.platformAdmin"),
      href: "/platform-admin",
      icon: Building2,
      gate: true,
    });
  }

  return [
    {
      key: "overview",
      label: t("nav.groups.overview"),
      items: [{ key: "home", label: t("nav.home"), href: "/", icon: LayoutDashboard }],
    },
    {
      key: "sales",
      label: t("nav.groups.sales"),
      items: [
        { key: "leads", label: t("nav.leads"), href: "/leads", icon: UserPlus },
        { key: "accounts", label: t("nav.accounts"), href: "/accounts", icon: Users },
        { key: "deals", label: t("nav.deals"), href: "/deals", icon: Briefcase },
        { key: "quotes", label: t("nav.quotes"), href: "/quotes", icon: FileText },
        { key: "negotiations", label: t("nav.negotiations"), href: "/negotiations", icon: Handshake },
        { key: "approvals", label: t("nav.approvals"), href: "/approvals", icon: CheckSquare, badgeKey: "approvals" },
      ],
    },
    {
      key: "closing",
      label: t("nav.groups.closing"),
      items: [
        { key: "orderConfirmations", label: t("nav.orderConfirmations"), href: "/order-confirmations", icon: ClipboardCheck },
        { key: "contracts", label: t("nav.contracts"), href: "/contracts", icon: FileSignature },
        { key: "signatures", label: t("nav.signatures"), href: "/signatures", icon: PenTool, badgeKey: "signatures" },
      ],
    },
    {
      key: "postSale",
      label: t("nav.groups.postSale"),
      items: [
        { key: "obligations", label: t("nav.obligations"), href: "/obligations", icon: ClipboardList, badgeKey: "obligations" },
        { key: "renewals", label: t("nav.renewals"), href: "/renewals", icon: CalendarClock, badgeKey: "renewals" },
        { key: "priceIncreases", label: t("nav.priceIncreases"), href: "/price-increases", icon: TrendingUp, badgeKey: "priceIncreases" },
      ],
    },
    {
      key: "insights",
      label: t("nav.groups.insights"),
      items: [
        { key: "reports", label: t("nav.reports"), href: "/reports", icon: BarChart3 },
        { key: "copilot", label: t("nav.copilot"), href: "/copilot", icon: Bot },
        { key: "wissensbasis", label: t("nav.wissensbasis"), href: "/wissensbasis", icon: Scale },
      ],
    },
    {
      key: "settings",
      label: t("nav.groups.settings"),
      collapsible: true,
      defaultCollapsed: true,
      items: settingsItems,
    },
  ];
}

const SETTINGS_COLLAPSED_STORAGE_KEY = "dealflow.sidebar.settingsCollapsed";

function hrefMatches(currentPath: string, href: string): boolean {
  if (href === "/") return currentPath === "/";
  return currentPath === href || currentPath.startsWith(href + "/");
}

function Sidebar({ currentPath }: { currentPath: string }) {
  const groups = useNavigationGroups();
  const { data: summary } = useGetDashboardSummary();
  const badgeCounts: Record<NonNullable<NavItem["badgeKey"]>, number | undefined> = {
    approvals: summary?.openApprovals,
    signatures: summary?.signaturesPending,
    renewals: summary?.renewalsDueSoonCount,
    obligations: summary?.overdueObligationsCount,
    priceIncreases: summary?.priceLettersAwaitingResponseCount,
  };
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const g of groups) {
      if (g.collapsible) {
        initial[g.key] = g.defaultCollapsed ?? false;
      }
    }
    if (typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(SETTINGS_COLLAPSED_STORAGE_KEY);
        if (stored != null) initial.settings = stored === "1";
      } catch {
        // ignore storage errors
      }
    }
    return initial;
  });

  function toggleGroup(key: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === "settings" && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(SETTINGS_COLLAPSED_STORAGE_KEY, next.settings ? "1" : "0");
        } catch {
          // ignore storage errors
        }
      }
      return next;
    });
  }

  // Pick the single most-specific (longest matching href) item across all
  // groups so that overlapping routes like /clauses vs /clauses/import only
  // highlight one entry.
  let bestMatchHref: string | null = null;
  for (const group of groups) {
    for (const item of group.items) {
      if (
        hrefMatches(currentPath, item.href) &&
        (bestMatchHref === null || item.href.length > bestMatchHref.length)
      ) {
        bestMatchHref = item.href;
      }
    }
  }

  function isItemActive(href: string): boolean {
    return href === bestMatchHref;
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex h-14 items-center px-4 lg:h-[64px] lg:px-5">
        <Link href="/" className="flex items-center gap-2.5 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-brand-2 text-primary-foreground shadow-sm">
            <Briefcase className="h-4 w-4" />
          </span>
          <span className="text-base tracking-tight">DealFlow One</span>
        </Link>
      </div>
      <div className="flex-1 overflow-auto py-2">
        <nav className="grid items-start px-2 text-sm font-medium lg:px-3">
          {groups.map((group, gIdx) => {
            const isCollapsed = !!group.collapsible && !!collapsed[group.key];
            const headingClass =
              "px-3 pt-4 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/80";
            return (
              <div key={group.key} className={gIdx === 0 ? "" : "mt-0.5"}>
                {group.collapsible ? (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className={`flex w-full items-center justify-between ${headingClass} hover:text-muted-foreground transition-colors`}
                    aria-expanded={!isCollapsed}
                    data-testid={`sidebar-group-toggle-${group.key}`}
                  >
                    <span>{group.label}</span>
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                    )}
                  </button>
                ) : (
                  <div className={headingClass} data-testid={`sidebar-group-${group.key}`}>
                    {group.label}
                  </div>
                )}
                {!isCollapsed && (
                  <div className="space-y-0.5 mt-1">
                    {group.items.map((item) => {
                      const isActive = isItemActive(item.href);
                      const count = item.badgeKey ? badgeCounts[item.badgeKey] : undefined;
                      const showBadge = typeof count === "number" && count > 0;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors ${
                            isActive
                              ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                              : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                          }`}
                          data-testid={`sidebar-nav-${item.key}`}
                        >
                          <item.icon
                            className={`h-4 w-4 shrink-0 ${
                              isActive
                                ? "text-sidebar-primary-foreground"
                                : "text-muted-foreground/80 group-hover:text-foreground"
                            }`}
                          />
                          <span className="flex-1 truncate">{item.label}</span>
                          {showBadge && (
                            <span
                              className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold tabular-nums ${
                                isActive
                                  ? "bg-white/70 text-sidebar-primary-foreground dark:bg-white/15"
                                  : "bg-brand-2/15 text-[hsl(var(--brand-2))] dark:bg-brand-2/25 dark:text-brand-2-foreground"
                              }`}
                              data-testid={`sidebar-badge-${item.key}`}
                            >
                              {count}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: tenant } = useGetTenant();
  const { user, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const { openHelp, openWelcome } = useOnboarding();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((p) => !p);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[230px_1fr] lg:grid-cols-[260px_1fr]">
      <div className="hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:block">
        <Sidebar currentPath={location} />
      </div>
      <div className="flex flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/60 bg-background/80 px-4 backdrop-blur-md lg:h-[60px] lg:px-6">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0 md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col bg-sidebar text-sidebar-foreground p-0">
              <Sidebar currentPath={location} />
            </SheetContent>
          </Sheet>
          <div className="flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="group flex w-full max-w-xl items-center gap-2 rounded-full border border-border/70 bg-card/70 px-4 h-10 text-sm text-muted-foreground shadow-xs hover:border-foreground/30 hover:bg-card transition-colors text-left"
              data-testid="header-cmdk-trigger"
              aria-label="Open search (Cmd+K)"
            >
              <Search className="h-4 w-4" />
              <span className="flex-1 truncate">{t("common.searchOrCommand", { defaultValue: "Suchen…" })}</span>
              <kbd className="hidden md:inline-flex items-center gap-0.5 rounded-md border border-border/70 bg-muted/60 px-1.5 py-0.5 text-[10px] font-mono">
                ⌘ K
              </kbd>
            </button>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="hidden xl:flex items-center gap-2 text-sm text-muted-foreground mr-1">
              {tenant?.name && <span className="font-medium text-foreground">{tenant.name}</span>}
              {tenant?.region && <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{tenant.region}</span>}
            </div>
            <ScopeSwitcher />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={() => setPaletteOpen(true)}
              data-testid="header-assistant-button"
              title="Copilot / Assistant"
            >
              <Sparkles className="h-4 w-4" />
              <span className="sr-only">Assistant</span>
            </Button>
            <RecentsDropdown />
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={openWelcome}
              data-testid="header-tour-button"
              title="Open workflow overview"
            >
              <Compass className="h-4 w-4" />
              <span className="sr-only">Tour</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
              onClick={openHelp}
              data-testid="header-help-button"
              title="Help for the current page (What can I do here?)"
            >
              <HelpCircle className="h-4 w-4" />
              <span className="sr-only">Help</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1 rounded-full px-2.5 text-muted-foreground hover:text-foreground hover:bg-accent"
                >
                  <Languages className="h-4 w-4" />
                  <span className="text-[11px] font-semibold uppercase">{i18n.resolvedLanguage ?? "de"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t("common.language")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLanguage("de")}>Deutsch</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguage("en")}>English</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent"
            >
              <Bell className="h-4 w-4" />
              <span className="sr-only">Notifications</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full p-0">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-gradient-to-br from-primary/15 to-brand-2/25 text-foreground text-xs font-semibold">
                      {user?.initials || <UserIcon className="h-4 w-4" />}
                    </AvatarFallback>
                  </Avatar>
                  <span className="sr-only">User menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span>{user?.name ?? t("common.myAccount")}</span>
                    {user?.email && <span className="text-xs text-muted-foreground font-normal">{user.email}</span>}
                    {user?.role && <span className="text-xs text-muted-foreground font-normal">{user.role}</span>}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => (window.location.href = `${import.meta.env.BASE_URL}profile`)} data-testid="menu-profile">
                  Profil
                </DropdownMenuItem>
                <DropdownMenuItem>{t("common.settings")}</DropdownMenuItem>
                <DropdownMenuItem>{t("common.support")}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void logout()} data-testid="button-logout">
                  <LogOut className="h-4 w-4 mr-2" />
                  {t("common.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-8 overflow-auto">
          {children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <HelpBot />
      <WelcomeDialog />
      <PageHelpDrawer />
    </div>
  );
}

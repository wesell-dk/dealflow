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
  Settings,
  Search,
  Bell,
  Menu,
  Languages,
  ClipboardCheck,
  History,
  User as UserIcon,
} from "lucide-react";
import { useGetTenant } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/auth-context";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function useNavigation() {
  const { t } = useTranslation();
  return [
    { name: t("nav.home"), href: "/", icon: LayoutDashboard },
    { name: t("nav.accounts"), href: "/accounts", icon: Users },
    { name: t("nav.deals"), href: "/deals", icon: Briefcase },
    { name: t("nav.quotes"), href: "/quotes", icon: FileText },
    { name: t("nav.pricing"), href: "/pricing", icon: BadgeDollarSign },
    { name: t("nav.approvals"), href: "/approvals", icon: CheckSquare },
    { name: t("nav.contracts"), href: "/contracts", icon: FileSignature },
    { name: t("nav.negotiations"), href: "/negotiations", icon: Handshake },
    { name: t("nav.signatures"), href: "/signatures", icon: PenTool },
    { name: t("nav.priceIncreases"), href: "/price-increases", icon: TrendingUp },
    { name: t("nav.orderConfirmations"), href: "/order-confirmations", icon: ClipboardCheck },
    { name: t("nav.reports"), href: "/reports", icon: BarChart3 },
    { name: t("nav.audit"), href: "/audit", icon: History },
    { name: t("nav.copilot"), href: "/copilot", icon: Bot },
    { name: t("nav.admin"), href: "/admin", icon: Settings },
  ];
}

function Sidebar({ currentPath }: { currentPath: string }) {
  const navigation = useNavigation();
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex h-14 items-center border-b px-4 lg:h-[60px] lg:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Briefcase className="h-6 w-6 text-primary" />
          <span className="text-lg">DealFlow One</span>
        </Link>
      </div>
      <div className="flex-1 overflow-auto py-2">
        <nav className="grid items-start px-2 text-sm font-medium lg:px-4 space-y-1">
          {navigation.map((item) => {
            const isActive = currentPath === item.href || (item.href !== "/" && currentPath.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 transition-all hover:text-primary ${
                  isActive ? "bg-muted text-primary" : "text-muted-foreground"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
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

  return (
    <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[280px_1fr]">
      <div className="hidden border-r bg-muted/40 md:block">
        <Sidebar currentPath={location} />
      </div>
      <div className="flex flex-col">
        <header className="flex h-14 items-center gap-4 border-b bg-muted/40 px-4 lg:h-[60px] lg:px-6">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="shrink-0 md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex flex-col">
              <Sidebar currentPath={location} />
            </SheetContent>
          </Sheet>
          <div className="w-full flex-1">
            <form>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder={t("common.search")}
                  className="w-full appearance-none bg-background pl-8 shadow-none md:w-2/3 lg:w-1/3"
                />
              </div>
            </form>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
              {tenant?.name && <span className="font-medium text-foreground">{tenant.name}</span>}
              {tenant?.region && <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{tenant.region}</span>}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5">
                  <Languages className="h-4 w-4" />
                  <span className="text-xs font-semibold uppercase">{i18n.resolvedLanguage ?? "de"}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{t("common.language")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLanguage("de")}>Deutsch</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLanguage("en")}>English</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" size="icon" className="h-8 w-8 rounded-full">
              <Bell className="h-4 w-4" />
              <span className="sr-only">Notifications</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="icon" className="rounded-full">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/10 text-primary">
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
        <main className="flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6 overflow-auto">
          {children}
        </main>
      </div>
      <HelpBot />
    </div>
  );
}

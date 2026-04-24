import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { OnboardingProvider } from "@/contexts/onboarding-context";
import LoginPage from "@/pages/login";
import { Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";
import Deals from "@/pages/deals";
import DealDetail from "@/pages/deal";
import Quotes from "@/pages/quotes";
import QuoteDetail from "@/pages/quote";
import Pricing from "@/pages/pricing";
import Approvals from "@/pages/approvals";
import Contracts from "@/pages/contracts";
import ContractDetail from "@/pages/contract";
import AmendmentDetail from "@/pages/amendment";
import Negotiations from "@/pages/negotiations";
import NegotiationDetail from "@/pages/negotiation";
import Signatures from "@/pages/signatures";
import SignatureDetail from "@/pages/signature";
import PriceIncreases from "@/pages/price-increases";
import PriceIncreaseDetail from "@/pages/price-increase";
import Accounts from "@/pages/accounts";
import AccountDetail from "@/pages/account";
import Reports from "@/pages/reports";
import Copilot from "@/pages/copilot";
import Admin from "@/pages/admin";
import OrderConfirmations from "@/pages/order-confirmations";
import OrderConfirmationDetail from "@/pages/order-confirmation";
import Audit from "@/pages/audit";
import Clauses from "@/pages/clauses";
import Templates from "@/pages/templates";
import Attachments from "@/pages/attachments";

const queryClient = new QueryClient();

function ProtectedRoutes() {
  const { user, loading } = useAuth();
  const [, setLocation] = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) {
    setTimeout(() => setLocation("/login"), 0);
    return null;
  }
  return (
    <OnboardingProvider>
      <AppShell>
        <Switch>
        <Route path="/" component={Home} />
        <Route path="/deals" component={Deals} />
        <Route path="/deals/:id" component={DealDetail} />
        <Route path="/quotes" component={Quotes} />
        <Route path="/quotes/:id" component={QuoteDetail} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/approvals" component={Approvals} />
        <Route path="/contracts" component={Contracts} />
        <Route path="/contracts/:id" component={ContractDetail} />
        <Route path="/amendments/:id" component={AmendmentDetail} />
        <Route path="/negotiations" component={Negotiations} />
        <Route path="/negotiations/:id" component={NegotiationDetail} />
        <Route path="/signatures" component={Signatures} />
        <Route path="/signatures/:id" component={SignatureDetail} />
        <Route path="/price-increases" component={PriceIncreases} />
        <Route path="/price-increases/:id" component={PriceIncreaseDetail} />
        <Route path="/accounts" component={Accounts} />
        <Route path="/accounts/:id" component={AccountDetail} />
        <Route path="/reports" component={Reports} />
        <Route path="/copilot" component={Copilot} />
        <Route path="/admin" component={Admin} />
        <Route path="/order-confirmations" component={OrderConfirmations} />
        <Route path="/order-confirmations/:id" component={OrderConfirmationDetail} />
        <Route path="/audit" component={Audit} />
        <Route path="/clauses" component={Clauses} />
        <Route path="/templates" component={Templates} />
        <Route path="/attachments" component={Attachments} />
        <Route component={NotFound} />
        </Switch>
      </AppShell>
    </OnboardingProvider>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route>
        <ProtectedRoutes />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

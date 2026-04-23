import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";
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

const queryClient = new QueryClient();

function Router() {
  return (
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
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

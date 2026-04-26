import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Users,
  Briefcase,
  FileText,
  FileStack,
  Paperclip,
  BadgeDollarSign,
  CheckSquare,
  FileSignature,
  Handshake,
  PenTool,
  TrendingUp,
  ClipboardCheck,
  BarChart3,
  History,
  Bot,
  Settings,
} from "lucide-react";

export type HelpAction = {
  label: string;
  to: string;
};

export type HelpEntry = {
  route: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  purpose: string;
  howTo: string[];
  prerequisites?: string[];
  nextSteps?: HelpAction[];
  tip?: string;
};

export const WORKFLOW_STEPS: Array<{
  key: string;
  route: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  short: string;
}> = [
  { key: "account",    route: "/accounts",            icon: Users,           title: "1. Customer",       short: "Create customer" },
  { key: "deal",       route: "/deals",               icon: Briefcase,       title: "2. Deal",           short: "Capture opportunity" },
  { key: "quote",      route: "/quotes",              icon: FileText,        title: "3. Quote",          short: "Create quote" },
  { key: "approval",   route: "/approvals",           icon: CheckSquare,     title: "4. Approval",       short: "Get approval" },
  { key: "negotiation",route: "/negotiations",        icon: Handshake,       title: "5. Negotiation",    short: "Finalize terms" },
  { key: "contract",   route: "/contracts",           icon: FileSignature,   title: "6. Contract",       short: "Draft contract" },
  { key: "signature",  route: "/signatures",          icon: PenTool,         title: "7. Signature",      short: "Collect signature" },
  { key: "order",      route: "/order-confirmations", icon: ClipboardCheck,  title: "8. Order",          short: "Order confirmation" },
  { key: "renewal",    route: "/price-increases",     icon: TrendingUp,      title: "9. Renewal",        short: "Price increase / renewal" },
];

export const HELP_CONTENT: Record<string, HelpEntry> = {
  "/": {
    route: "/",
    icon: LayoutDashboard,
    title: "Home",
    purpose: "Central overview: your pipeline, open tasks, risks and Copilot hints at a glance.",
    howTo: [
      "KPI tiles (Open Deals, Win Rate, Avg. Cycle Time) show the current state of your pipeline.",
      "The task list on the right bundles open approvals, signatures and quotes.",
      "Copilot hints suggest the next sensible action – usually with a direct jump into the deal.",
    ],
    nextSteps: [
      { label: "Open pipeline", to: "/deals" },
      { label: "Open approvals", to: "/approvals" },
    ],
    tip: "New here? Start with 'Create customer' to follow the thread Account → Deal → Quote → Contract.",
  },
  "/accounts": {
    route: "/accounts",
    icon: Users,
    title: "Customers",
    purpose: "Master data of all business customers including health score, open deals and total value.",
    howTo: [
      "Click 'Create customer' in the top right to create a new account with name, industry and country.",
      "Click on a customer name to see contacts and all related deals.",
      "The health score immediately shows whether a customer needs active attention (red) or is stable (green).",
    ],
    nextSteps: [
      { label: "First deals in the pipeline", to: "/deals" },
    ],
    tip: "Set up customers cleanly – they are the anchor for all deals, contracts and order confirmations.",
  },
  "/deals": {
    route: "/deals",
    icon: Briefcase,
    title: "Deals",
    purpose: "Active sales opportunities – the pipeline view shows stages, values and owners.",
    howTo: [
      "'Create deal' opens the form with required fields (customer, brand, value, stage, owner).",
      "Stages: Qualified → Discovery → Proposal → Negotiation → Closing → Won/Lost.",
      "Click on a deal for details, quotes, contracts and activity history.",
    ],
    prerequisites: ["At least one customer exists."],
    nextSteps: [
      { label: "Create quote", to: "/quotes" },
      { label: "Draft contract", to: "/contracts" },
    ],
    tip: "Keep 'Next step' and 'Expected close date' up to date – forecasts and Copilot recommendations rely on them.",
  },
  "/quotes": {
    route: "/quotes",
    icon: FileText,
    title: "Quotes",
    purpose: "Concrete pricing proposals for deals – versionable, with margin/discount logic and approval workflow.",
    howTo: [
      "'New quote' opens the wizard and walks you through deal selection, line items and terms.",
      "Each quote has a sequential number and versioned history.",
      "The status badge (Draft, Pending Approval, Approved, Sent) shows the current workflow step.",
    ],
    prerequisites: ["A deal in an active stage exists."],
    nextSteps: [
      { label: "Review approvals", to: "/approvals" },
    ],
    tip: "Discount above the threshold? The system automatically creates an approval task – visible in the Approvals area.",
  },
  "/templates": {
    route: "/templates",
    icon: FileStack,
    title: "Templates",
    purpose: "Reusable building blocks for contracts and quotes – clauses, standard text, brand-specific defaults.",
    howTo: [
      "Templates are organized by brand / contract type.",
      "Mark productive versions as 'active'; drafts stay invisible to other users.",
      "Changes only affect newly created contracts – existing ones keep their version.",
    ],
    tip: "Maintain templates as a central asset – they save negotiation time and reduce compliance risk.",
  },
  "/attachments": {
    route: "/attachments",
    icon: Paperclip,
    title: "Attachments",
    purpose: "Uploaded documents (NDA, RFPs, specifications) managed centrally and linkable to deal/quote/contract.",
    howTo: [
      "Upload file → set metadata (type, visibility) → link to entity.",
      "Visibility 'internal' stays in the team; 'external' can be shared with customers.",
    ],
  },
  "/pricing": {
    route: "/pricing",
    icon: BadgeDollarSign,
    title: "Pricing",
    purpose: "Master prices, margin thresholds and discount rules – the basis for quote and approval logic.",
    howTo: [
      "Define list prices and margin floors per brand.",
      "Discount thresholds automatically trigger approvals on quotes.",
    ],
    tip: "Clean pricing logic = fewer escalations. Maintain master prices quarterly.",
  },
  "/approvals": {
    route: "/approvals",
    icon: CheckSquare,
    title: "Approvals",
    purpose: "All pending approvals – discounts, special conditions, contract clauses.",
    howTo: [
      "Approval tasks are created automatically by quotes/contracts as soon as thresholds are exceeded.",
      "Approve or reject with a justification – the decision is persisted in the audit log.",
    ],
    nextSteps: [
      { label: "Open audit log", to: "/audit" },
    ],
    tip: "Copilot can deliver an 'Approval Readiness' analysis per approval (in the detail area).",
  },
  "/contracts": {
    route: "/contracts",
    icon: FileSignature,
    title: "Contracts",
    purpose: "Binding agreements – draft, negotiation, signature, activation.",
    howTo: [
      "Create a contract from a won deal – uses brand defaults and clauses.",
      "Status flow: Draft → In Negotiation → Pending Signature → Active → (Renewal/Amendment).",
      "In the detail area you'll find clauses, risks (Copilot) and history.",
    ],
    prerequisites: ["A deal in stage 'Closing' or 'Won'."],
    nextSteps: [
      { label: "Open negotiation", to: "/negotiations" },
      { label: "Collect signature", to: "/signatures" },
    ],
  },
  "/negotiations": {
    route: "/negotiations",
    icon: Handshake,
    title: "Negotiations",
    purpose: "Structured, documented negotiation sessions on contracts – points, counter-proposals, status.",
    howTo: [
      "Negotiations are created on a contract basis – each session captures discussion points.",
      "Copilot can provide 'Negotiation Support' hints per point (in the detail).",
    ],
  },
  "/signatures": {
    route: "/signatures",
    icon: PenTool,
    title: "Signatures",
    purpose: "Overview of all open and completed signature processes with status per signer.",
    howTo: [
      "A signature request is generated automatically when the contract transitions to 'Pending Signature'.",
      "Status per signer: pending / signed / declined.",
    ],
  },
  "/price-increases": {
    route: "/price-increases",
    icon: TrendingUp,
    title: "Price increases",
    purpose: "Planned and ongoing price adjustments for existing customers – reason, amount, communication status.",
    howTo: [
      "Create a price increase action per customer or contract group.",
      "Reason + amount + planned effective date – Copilot can suggest argumentation.",
    ],
  },
  "/order-confirmations": {
    route: "/order-confirmations",
    icon: ClipboardCheck,
    title: "Order confirmations",
    purpose: "Confirmed orders from active contracts – handover to delivery/billing system.",
    howTo: [
      "Order confirmations originate from active contracts with a concrete order.",
      "Status: Draft → Sent → Confirmed.",
    ],
  },
  "/reports": {
    route: "/reports",
    icon: BarChart3,
    title: "Reports",
    purpose: "Aggregated pipeline, forecast and performance reports across brands, owners and time ranges.",
    howTo: [
      "Apply filters (period, brand, stage), then open the report.",
      "Export as CSV or share the link with stakeholders.",
    ],
  },
  "/audit": {
    route: "/audit",
    icon: History,
    title: "Audit log",
    purpose: "Complete history of critical actions – approvals, contract changes, logins, configuration.",
    howTo: [
      "Filter by actor, action type or time range.",
      "Each entry contains tenant, timestamp, actor and payload diff.",
    ],
  },
  "/copilot": {
    route: "/copilot",
    icon: Bot,
    title: "Copilot",
    purpose: "AI-assisted analyses per domain – deal summary, pricing review, contract risks, approval readiness and more.",
    howTo: [
      "Pick a mode (e.g. 'Deal Summary') and the target entity – Copilot returns a structured result.",
      "Results are persisted as 'Insight' on the deal/contract and remain findable there.",
    ],
    tip: "Copilot complements – it never replaces. Read the rationale and sources before adopting a recommendation.",
  },
  "/admin": {
    route: "/admin",
    icon: Settings,
    title: "Administration",
    purpose: "Tenant configuration: brands, companies, users, roles, scopes.",
    howTo: [
      "Create / invite users, assign role and scope (which companies/brands are visible).",
      "Configure brands incl. default clauses and branding.",
    ],
    tip: "Scopes are essential for multi-brand setups – a user only sees data within their active scope.",
  },
};

export function getHelpForRoute(path: string): HelpEntry | null {
  if (HELP_CONTENT[path]) return HELP_CONTENT[path];
  for (const key of Object.keys(HELP_CONTENT)) {
    if (key !== "/" && path.startsWith(key)) return HELP_CONTENT[key];
  }
  return HELP_CONTENT["/"] ?? null;
}

export function getCurrentWorkflowStep(path: string) {
  return WORKFLOW_STEPS.find(s => path === s.route || (s.route !== "/" && path.startsWith(s.route))) ?? null;
}

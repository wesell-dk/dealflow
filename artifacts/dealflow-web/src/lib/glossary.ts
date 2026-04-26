export type GlossaryEntry = {
  label: string;
  short: string;
  long?: string;
};

export type GlossaryGroup = Record<string, GlossaryEntry>;

export const DEAL_STAGES: GlossaryGroup = {
  qualified: {
    label: "Qualified",
    short: "Need confirmed, budget roughly known – a real reason to buy exists.",
    long: "Initial contact has happened, the customer has a concrete trigger and the budget is in a plausible range. No solution defined yet.",
  },
  discovery: {
    label: "Discovery",
    short: "Requirements, stakeholders and decision path are being clarified.",
    long: "Build deep understanding: pains, technical requirements, buying center, timeline, competitors. Outcome is a jointly understood scope.",
  },
  proposal: {
    label: "Proposal",
    short: "A concrete quote has been issued and is with the customer – awaiting response.",
    long: "A quote with line items, pricing and terms has been sent. Approvals for discounts/special conditions have been obtained.",
  },
  negotiation: {
    label: "Negotiation",
    short: "Terms, clauses or pricing are being negotiated with the customer.",
    long: "The customer raises counter-demands – e.g. on price, term, SLA, liability. Negotiation steps are documented in the Negotiations area.",
  },
  closing: {
    label: "Closing",
    short: "Contract is ready for signature – only formal steps remain.",
    long: "Content is mutually accepted, signers are named, contract is awaiting signature. Risk is significantly reduced, forecast weighted high.",
  },
  won: {
    label: "Won",
    short: "Contract is signed – the deal counts toward revenue.",
    long: "Closed. From here, order confirmation, onboarding and possibly renewal planning take over in the Renewals area.",
  },
  lost: {
    label: "Lost",
    short: "Deal lost or cancelled by the customer – lost reason is recorded.",
    long: "Important: capture the loss reason (price, competitor, timing, budget). This data feeds reports and pricing analytics.",
  },
};

export const QUOTE_STATUS: GlossaryGroup = {
  draft: {
    label: "Draft",
    short: "Quote is being created – not yet sent, not yet approved.",
  },
  pending_approval: {
    label: "Pending approval",
    short: "Discount or special term exceeds the threshold – awaiting approval.",
  },
  approved: {
    label: "Approved",
    short: "Internally signed off, can be sent to the customer.",
  },
  sent: {
    label: "Sent",
    short: "Delivered to the customer – response (acceptance/rejection) pending.",
  },
  accepted: {
    label: "Accepted",
    short: "Customer has confirmed the quote – contract/order to follow.",
  },
  rejected: {
    label: "Rejected",
    short: "Customer rejects the quote – a new version may be needed.",
  },
  expired: {
    label: "Expired",
    short: "Validity date passed – extension or new quote required.",
  },
};

export const CONTRACT_STATUS: GlossaryGroup = {
  draft: {
    label: "Draft",
    short: "Contract draft is being prepared internally – not yet with the customer.",
  },
  in_negotiation: {
    label: "In negotiation",
    short: "Clauses and terms are being exchanged with the customer.",
  },
  pending_signature: {
    label: "Pending signature",
    short: "Content is final – signers are named, signature process is running.",
  },
  active: {
    label: "Active",
    short: "Contract is signed and in force.",
  },
  expired: {
    label: "Expired",
    short: "Contract term has ended – renewal action required.",
  },
  terminated: {
    label: "Terminated",
    short: "Contract was ended before expiry – termination reason is documented.",
  },
};

export const APPROVAL_STATUS: GlossaryGroup = {
  pending: {
    label: "Open",
    short: "Awaiting decision from the responsible approver.",
  },
  approved: {
    label: "Approved",
    short: "Approved – the triggering quote/contract can proceed.",
  },
  rejected: {
    label: "Rejected",
    short: "Not approved – reason is stored in the audit log.",
  },
  escalated: {
    label: "Escalated",
    short: "Forwarded to the next hierarchy level (e.g. Sales Director).",
  },
};

export const SIGNATURE_STATUS: GlossaryGroup = {
  pending: {
    label: "Open",
    short: "Request is with the signer – not yet acted on.",
  },
  signed: {
    label: "Signed",
    short: "Signature is in place – legally documented.",
  },
  declined: {
    label: "Declined",
    short: "Signer has refused the signature – contract must be revised.",
  },
};

export const ATTACHMENT_CATEGORIES: GlossaryGroup = {
  datasheet: {
    label: "Datasheet",
    short: "Technical specification of a product or service.",
  },
  terms: {
    label: "Terms",
    short: "T&Cs, DPA, NDA or other legal framework documents.",
  },
  reference: {
    label: "Reference",
    short: "Case study, customer testimonial or comparable trust material.",
  },
  certificate: {
    label: "Certificate",
    short: "Compliance, security or quality proof (e.g. ISO 27001).",
  },
  other: {
    label: "Other",
    short: "Anything that does not fit the categories above.",
  },
};

export const TENANT_PLANS: GlossaryGroup = {
  Starter: {
    label: "Starter",
    short: "Entry-level plan – small teams, core features, basic limits.",
  },
  Growth: {
    label: "Growth",
    short: "Growing teams – higher limits, advanced reports and approvals.",
  },
  Business: {
    label: "Business",
    short: "Mid-market companies – SSO, granular roles, advanced audit features.",
  },
  Enterprise: {
    label: "Enterprise",
    short: "Enterprise customers – dedicated region, custom SLAs, on-prem options.",
  },
};

export const TENANT_REGIONS: GlossaryGroup = {
  EU: {
    label: "EU",
    short: "Data residency in the European Union (Frankfurt) – GDPR compliant.",
  },
  US: {
    label: "US",
    short: "Data residency in the USA (Virginia) – suitable for North American customers.",
  },
  UK: {
    label: "UK",
    short: "Data residency in the United Kingdom (London) – separated from EU data.",
  },
  APAC: {
    label: "APAC",
    short: "Data residency in Asia-Pacific (Singapore) – latency-optimized for the region.",
  },
};

export const CONCEPTS: GlossaryGroup = {
  brand: {
    label: "Brand",
    short: "Determines branding, contract clauses, default pricing and templates for this deal.",
    long: "A brand bundles visual branding, default clauses, list prices and approval thresholds. The brand selected here is automatically applied to all downstream documents (quote, contract, order confirmation).",
  },
  company: {
    label: "Company",
    short: "Selling legal entity (e.g. \"DealFlow GmbH\"). Determines invoicing party and tax setup.",
  },
  owner: {
    label: "Owner",
    short: "Account owner – the person actively driving this deal.",
    long: "The owner sees the deal in their personal forecast and is the point of contact for follow-up tasks (approvals, negotiations, renewals).",
  },
  value: {
    label: "Value",
    short: "Expected order value in EUR – basis for forecast and pipeline analytics.",
    long: "For subscription deals: ARR (Annual Recurring Revenue). For one-off deals: total amount. Weighted by stage and probability in reports.",
  },
  expectedCloseDate: {
    label: "Expected close date",
    short: "Date the deal is expected to be won or lost – feeds forecast buckets.",
  },
  probability: {
    label: "Probability",
    short: "Subjective estimate in percent (0–100). Multiplied with the value to compute the forecast contribution.",
  },
  scope: {
    label: "Scope",
    short: "Which brands and companies a user is allowed to see. Controls visibility and editing rights.",
  },
};

export const GLOSSARY = {
  dealStages: DEAL_STAGES,
  quoteStatus: QUOTE_STATUS,
  contractStatus: CONTRACT_STATUS,
  approvalStatus: APPROVAL_STATUS,
  signatureStatus: SIGNATURE_STATUS,
  attachmentCategories: ATTACHMENT_CATEGORIES,
  tenantPlans: TENANT_PLANS,
  tenantRegions: TENANT_REGIONS,
  concepts: CONCEPTS,
} as const;

export type GlossaryGroupKey = keyof typeof GLOSSARY;

export function getEntry(group: GlossaryGroupKey, value: string): GlossaryEntry | null {
  const g = GLOSSARY[group];
  return (g && g[value]) ?? null;
}

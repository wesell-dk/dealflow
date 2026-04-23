# DealFlow One

## Overview

**DealFlow One** is a best-in-class **Commercial Execution Platform** for B2B
companies. It unifies the entire commercial closing process — from opportunity
through quote, approval, contract, signature, order confirmation, price change
and post-close handover — in a single, very clear and powerful application.

The product is positioned as the convergence of:

- the **simplicity of HubSpot**,
- the **rule-engine strength of Salesforce**,
- the **document quality of PandaDoc**, and
- the **automation of Zoho**

…all expressed in one extremely clear UI.

DealFlow One is **deal-centric**. It is **not** an ERP, not an accounting
package and not just a document generator. It is the operative control center
for the **commercial close**.

## Core Product Idea

DealFlow One turns a fragmented, error-prone and intransparent closing process
into a unified, intelligent and steerable **Commercial Flow**. In one place it
combines:

- Deals, Accounts, Contacts, Roles in commercial context
- Quotes with full versioning and acceptance state
- Price positions, price rules, price overrides, price validity
- Approvals (margin, discount, contract deviations, brand exceptions)
- Contracts with clause families and clause variants
- Negotiations with structured counterproposals
- Signatures and order confirmations
- Price-increase letters as a first-class workflow
- Sales performance reporting
- AI Copilot as an orchestrating layer over the whole flow

## Design Principle — Simple on the surface, powerful underneath

- Surface: very clear visual order, few main areas, role-oriented, always shows
  the next sensible step.
- Underneath: multi-tenant, multi-company, multi-brand, scope-based RBAC,
  price/validity logic, contract variants, audit trails, versioning, GDPR
  capability, event/workflow orchestration and AI assistance across the full
  process.

## Organisational Core Model

```
Platform
└── Tenant (Mandant)
    └── Company (Firma)
        └── Brand (Brand / Branding)
            └── Users with Roles + Visibility Scope
```

- **Tenant**: top-level customer of the SaaS.
- **Company**: legal/operative unit inside a tenant (holdings, country
  subsidiaries, business units).
- **Brand**: commercial expression inside a company (logos, templates,
  pricebook overrides, clause variants, tone of voice).
- **User**: belongs to exactly one tenant, has one or more roles and a
  visibility scope on companies and brands.

## Permission Model

- **Role** = *what* a user may do (Sales Rep, Sales Manager, RevOps, Legal
  Reviewer, Finance Approver, Tenant Admin, Read-Only Executive, Brand
  Manager, Integration Admin, …).
- **Scope** = *which* organisational units the user may see (entire tenant,
  selected companies, selected brands inside selected companies, optionally
  teams/deal types).

## Core Domains

- Organisation (Tenant / Company / Brand)
- Identity & Permissions (User / Team / Role / Scope)
- Customer & Relationship (Account / Contact / Contact Role)
- Deal (commercial master object)
- Quote & Pricing (Quote, QuoteVersion, LineItem, PricePosition, PriceRule)
- Contract (ContractTemplate, ClauseFamily, ClauseVariant, ContractVersion)
- Approvals (ApprovalCase, ApprovalStep, ApprovalReason)
- Signature (SignaturePackage, Signer, SignatureStatus)
- Order Confirmation & Handover
- Price Increase Letters
- Negotiation & Counterproposal
- Reports & KPIs
- AI Copilot Orchestration
- Governance, Audit, GDPR
- Integrations & API

## Versioning as a First Principle

Versioned objects: Quotes, Price Positions, Price Rules, Contracts, Contract
Clauses, Approval States, Brandings/Templates, Price-Increase Letters,
Customer Reactions. The platform distinguishes:

- current working state
- current approved/effective state
- historic state (point-in-time queryable)

## Key Screens

DealFlow One is built around a small number of very clear top-level
workspaces:

1. **Home / Today** — role-filtered work queue and pipeline pulse.
2. **Deal Workspace** — the one screen where a deal lives end-to-end.
3. **Quote Studio** — versioned quote authoring with pricing intelligence.
4. **Pricing Workspace** — price positions, rules, overrides, validity.
5. **Approval Hub** — all open approvals with reason, impact, deadline.
6. **Contract Workspace** — clause-based contracting with redlines & variants.
7. **Negotiation & Counterproposal Workspace** — structured customer reactions
   and impact-aware response.
8. **Signature Center** — signature packages, signers, sequence, status.
9. **Order Confirmation & Handover Center** — close → onboarding bridge.
10. **Price Increase Center** — bulk price-uplift campaigns.
11. **Reports & Performance Cockpit** — Win Rate, Cycle Time, Discount
    Discipline, Approval Latency, Forecast Quality.
12. **AI Copilot Workspace** — orchestrating, explanation-first AI surface.
13. **Tenant Admin Console** — users, roles, scopes, brands, templates,
    approval matrices, integrations, API.
14. **Platform Admin Console** — operator-level tenant lifecycle.

## Stack

- **Monorepo**: pnpm workspaces (the workspace tooling enforces pnpm).
- **Process supervisor (production)**: PM2 — the production deployment runs
  the API server under PM2 (`pm2-runtime`). In dev the artifact workflows
  manage the processes directly.
- **Frontend**: React + Vite + TypeScript + TanStack Query + Tailwind +
  shadcn/ui.
- **Backend**: Express 5 (TypeScript, ESM, esbuild bundle).
- **Database**: PostgreSQL via Drizzle ORM.
- **Validation**: Zod (`zod/v4`) + drizzle-zod.
- **API codegen**: Orval, from `lib/api-spec/openapi.yaml` → React Query hooks
  (`@workspace/api-client-react`) and Zod schemas (`@workspace/api-zod`).
- **Logging**: pino + pino-http.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages.
- `pnpm run build` — typecheck + build everything.
- `pnpm --filter @workspace/api-spec run codegen` — regenerate hooks and Zod
  schemas after editing the OpenAPI spec.
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only).
- `pnpm --filter @workspace/api-server run dev` — run the API server locally.
- `pnpm --filter @workspace/api-server run start:pm2` — run the API server
  through PM2 (`pm2-runtime`) for production-like execution.

## Artifacts

- `artifacts/dealflow-web` — DealFlow One web app (React + Vite, served at
  `/`).
- `artifacts/api-server` — Express API server, served at `/api`.
- `artifacts/mockup-sandbox` — design canvas (kept from scaffold).

## API Surface (high level)

Implemented in `lib/api-spec/openapi.yaml`. Domains:

- `/orgs/*` — tenants, companies, brands, users
- `/accounts`, `/contacts` — customer master
- `/deals` — deal CRUD + per-deal sub-resources
- `/quotes`, `/quotes/{id}/versions`, `/quotes/{id}/line-items`
- `/price-positions`, `/price-rules`
- `/approvals` — approval cases and decisions
- `/contracts`, `/clauses`
- `/negotiations` — counterproposals & rounds
- `/signatures` — packages and signer status
- `/price-increases` — campaigns and letters
- `/reports/*` — KPI summaries
- `/copilot/*` — AI summaries, suggestions, drafts

## GDPR & Governance

Per-tenant data isolation, role + scope enforced at API layer, full audit
trail on commercial state changes, soft-delete + retention policy hooks,
exportable user data, redacted secrets in logs.

## Known limitations (demo scope)
- No authentication: `/orgs/me` returns the seeded user `u_priya`. Production needs auth middleware + scope-based RBAC enforcement on every router.
- Request bodies are cast, not Zod-validated, in handlers. Wire the generated Zod schemas through middleware before exposing publicly.

## Spracheinstellung
- Kommunikation mit dem Nutzer erfolgt **immer auf Deutsch**.

# DealFlow One

## Overview

**DealFlow One** is a Commercial Execution Platform for B2B companies, unifying the entire commercial closing process from opportunity to post-close handover in a single application. It aims to combine the simplicity of HubSpot, the rule-engine strength of Salesforce, the document quality of PandaDoc, and the automation of Zoho into one clear UI. DealFlow One is deal-centric, serving as the operative control center for the commercial close by transforming fragmented processes into a unified, intelligent, and steerable Commercial Flow.

Key capabilities include managing deals, accounts, contacts, and roles; versioned quotes with pricing intelligence; robust approval workflows; clause-based contracts with negotiation support; electronic signatures; order confirmations; price increase management; sales performance reporting; and an AI Copilot for orchestration. The platform's design principle is "simple on the surface, powerful underneath," offering a clear visual order while supporting multi-tenant, multi-company, multi-brand, scope-based RBAC, and comprehensive versioning.

## User Preferences

- Kommunikation mit dem Nutzer erfolgt **immer auf Deutsch**.

## System Architecture

**Design Principle:** Simple on the surface, powerful underneath.
- **Surface:** Clear visual order, few main areas, role-oriented, always shows the next sensible step.
- **Underneath:** Multi-tenant, multi-company, multi-brand, scope-based RBAC, price/validity logic, contract variants, audit trails, versioning, GDPR capability, event/workflow orchestration, and AI assistance.

**Organisational Core Model:**
- **Platform**: Top-level container.
- **Tenant**: Top-level customer.
- **Company**: Legal/operative unit within a tenant.
- **Brand**: Commercial expression within a company (logos, templates, pricebook overrides).
- **User**: Belongs to one tenant, has roles and visibility scope.

**Permission Model:**
- **Role**: Defines user capabilities (e.g., Sales Rep, Legal Reviewer).
- **Scope**: Defines organisational units a user can access (e.g., entire tenant, selected companies/brands).

**Core Domains:** Organisation, Identity & Permissions, Customer & Relationship, Deal, Quote & Pricing, Contract, Approvals, Signature, Order Confirmation & Handover, Price Increase Letters, Negotiation & Counterproposal, Reports & KPIs, AI Copilot Orchestration, Governance, Audit, GDPR, Integrations & API.

**Versioning:** Critical objects (Quotes, Price Positions, Contracts, Approvals) are versioned, distinguishing current working, approved/effective, and historic states.

**Key Workspaces:** The system is structured around 14 key workspaces: Home/Today, Deal Workspace, Quote Studio, Pricing Workspace, Approval Hub, Contract Workspace, Negotiation & Counterproposal, Signature Center, Order Confirmation & Handover, Price Increase Center, Reports & Performance Cockpit, AI Copilot Workspace, Tenant Admin Console, and Platform Admin Console.

**Technical Stack:**
- **Monorepo**: pnpm workspaces.
- **Process supervisor (production)**: PM2.
- **Frontend**: React, Vite, TypeScript, TanStack Query, Tailwind, shadcn/ui.
- **Backend**: Express 5 (TypeScript, ESM, esbuild).
- **Database**: PostgreSQL via Drizzle ORM.
- **Validation**: Zod + drizzle-zod.
- **API codegen**: Orval (from `openapi.yaml`) generates React Query hooks and Zod schemas.
- **Logging**: pino + pino-http.

**AI Layer (Phase 1):**
- **Architecture**: A thin, interchangeable AI layer in `artifacts/api-server/src/lib/ai/`.
- **Provider**: Anthropic adapter via Replit AI Integration.
- **Prompt Registry**: Typed registry with stable keys, model specification, typed input builders, and Zod output schemas.
- **Structured Output**: Converts Zod schemas to Anthropic tool-input schemas and validates responses.
- **Orchestrator**: Central `runStructured()` function handles provider calls, output validation, and error classification.
- **Audit Log**: Every AI call (successful or failed) is logged to `ai_invocations` table, capturing actor, tenant, scope, prompt key, model, token usage, latency, and status.
- **Domain Context Builder**: `artifacts/api-server/src/lib/ai/context.ts` builds scope-validated, typed contexts for Deal, Quote, Contract, and Approval entities, ensuring cross-tenant isolation.
- **Copilot Modes**: Ten modes are defined in `artifacts/api-server/src/lib/ai/prompts/dealflow.ts` (`deal.summary`, `negotiation.support`, `pricing.review`, `approval.readiness`, `contract.draft`, `contract.risk`, `contract.redline`, `price-increase.support`, `executive.brief`, `deal.health`), each with a German system prompt, typed user input, and Zod output schema.
- **Productive HTTP Endpoints**: Four modes are currently endpoint-activated (`/api/copilot/deal-summary/:dealId`, `/api/copilot/pricing-review/:quoteId`, `/api/copilot/approval-readiness/:approvalId`, `/api/copilot/contract-risk/:contractId`), persisting insights as `copilot_insight`.

**GDPR & Governance:** Per-tenant data isolation, role + scope enforced at API layer, full audit trail, soft-delete, retention policy hooks, exportable user data, redacted secrets in logs.

**Onboarding & In-App Help (April 2026):**
- **Welcome Tour**: First-visit modal (`components/onboarding/welcome-dialog.tsx`) introduces the 9-phase commercial workflow ("Roter Faden" — Account → Deal → Quote → Approval → Negotiation → Contract → Signature → Order → Renewal). Stored in `localStorage["dealflow.onboarding.v1"]`.
- **Per-Page Help Drawer**: `components/onboarding/page-help.tsx` renders right-side drawer keyed by route, with purpose, step-by-step "So gehst du vor", a tip, and "next sensible step" suggestions. Content registry at `lib/help-content.ts` covers all 17 sidebar routes.
- **Workflow Map Component**: `components/onboarding/workflow-map.tsx` shows 9 numbered phases with completion check-marks driven by `OnboardingContext.completedSteps`.
- **Header Buttons**: `header-tour-button` re-opens welcome dialog; `header-help-button` opens page help drawer.
- **Context Provider**: `contexts/onboarding-context.tsx` wraps the app and persists `seenWelcome`, `completedSteps`, `currentRoute`.

**Frontend CRUD (April 2026):**
- **Account Form**: `components/accounts/account-form-dialog.tsx` (create + edit, with health-score field on edit). New "Kunde anlegen" button on `/accounts` and empty-state CTA. "Bearbeiten" button on account detail.
- **Deal Form**: `components/deals/deal-form-dialog.tsx` (create + edit). Create wires to `/deals` Plus button and account-detail "Deal anlegen" button. Edit wires to deal-detail "Bearbeiten" button.
- **Cache Invalidation**: Deal mutations invalidate `getGetAccountQueryKey(accountId)` so the parent account's Deals card refreshes immediately after creating/editing a deal.
- **Backend**: Added `PATCH /api/v1/accounts/:id` endpoint and `AccountPatch` OpenAPI schema. `PATCH /api/v1/deals/:id` already existed.
- **Scope Fix**: `lib/scope.ts → allowedAccountIds()` now also includes accounts owned by the current user (and, for tenantWide users, all accounts owned by users in the same tenant). Previously, freshly-created accounts without deals were invisible even to their creator.

## External Dependencies

- **PostgreSQL**: Primary database for data persistence.
- **Anthropic AI Integration**: Used for the AI Copilot functionality, accessed via Replit AI Integration (`AI_INTEGRATIONS_ANTHROPIC_BASE_URL` + `AI_INTEGRATIONS_ANTHROPIC_API_KEY`).
- **HubSpot (conceptual)**: Referenced for simplicity benchmark.
- **Salesforce (conceptual)**: Referenced for rule-engine strength benchmark.
- **PandaDoc (conceptual)**: Referenced for document quality benchmark.
- **Zoho (conceptual)**: Referenced for automation benchmark.
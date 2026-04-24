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

**AI Help-Bot — Tool-using Agent (April 2026 v2):**
- **Agent Loop**: `artifacts/api-server/src/lib/ai/agent.ts → runAgent()` runs a real Anthropic `tool_use` loop (max 6 steps). Each iteration: send conversation + tool-results, parse `tool_use` blocks, execute tools, feed `tool_result` back. Terminates on `stop_reason='end_turn'` or step cap. Per-tool errors are caught and returned as `tool_result is_error` (the loop continues so the model can recover).
- **Tools Registry**: `artifacts/api-server/src/lib/ai/tools/dealflowAgent.ts` exposes 7 scope-aware tools: `search_accounts`, `search_deals`, `pipeline_stats`, `recent_activity` (read), `create_account`, `create_contact`, `create_deal` (write). All read tools filter by `allowedAccountIds`/`allowedDealIds`/`allowedCompanyIds`. `recent_activity` filters audit rows by visible entity sets and suppresses unmappable entity types for restricted users (no out-of-scope leak). `create_deal` refuses with a hint if `brandId` is omitted but the user has > 1 brand in scope. All mutating tools write an `ai_invocations` audit row with `actor='<user> (HelpBot)'` plus a normal `auditLogTable` entry.
- **Endpoint**: `POST /api/v1/copilot/help` now uses `runAgent`. Reply schema extended: `traces: [{kind:'tool_call'|'tool_error'|'message', tool?, arguments?, result?, errorClass?, errorMessage?}]` and `meta.steps`. The post-agent action derivation maps `create_account/create_deal` → `navigate` to the parent list so the UI shows a "Jetzt öffnen →" link to the freshly created entity's parent.
- **Untrusted-Output Guard**: Action paths still validated against `HELP_ROUTES`. Suggestions still filtered to known routes. Tool result strings/arrays trimmed to model-safe sizes (`clampForModel`).
- **Fallback (no AI)**: Reverted to `navigate|none` only — when AI is unconfigured/errors, the bot lotses the user to `/accounts` or `/deals` rather than promising it will open a dialog it can't open.
- **Frontend**: `components/help-bot.tsx` renders trace cards per tool call (icon, German label, compact summary or list of result rows with values/stage). Quick-actions are now read-focused (Pipeline-Stats, Top 5 Deals, Letzte Kunden, Letzte Aktivität). Removed the old `AccountFormDialog`/`DealFormDialog` wiring — the agent creates real records directly.

**Onboarding tour fix + Live data (April 2026 v2):**
- **Workflow Map `mode` prop**: `components/onboarding/workflow-map.tsx` now supports `mode: "navigate" | "inline"`. In `inline` mode each step is an accordion button that expands to show purpose + first 3 howTo bullets and a "Jetzt öffnen" link, instead of navigating immediately. Used by `welcome-dialog.tsx` so the modal stays open while the user reads.
- **PageHelp Live Data**: `components/onboarding/page-help.tsx` adds an "Aus deinen Daten" section that fetches the relevant list endpoint (only when the drawer is open, `staleTime: 30_000`) and shows route-specific stat cards: `/accounts` (Kunden gesamt, Ohne aktiven Deal), `/deals` (Offene, Im Closing, Pipeline-Wert in EUR, Gesamt), `/approvals` (Offen/Genehmigt/Abgelehnt), `/contracts`, `/quotes`, `/signatures`, `/negotiations` and aggregate Home view.

**Frontend CRUD (April 2026):**
- **Account Form**: `components/accounts/account-form-dialog.tsx` (create + edit, with health-score field on edit). New "Kunde anlegen" button on `/accounts` and empty-state CTA. "Bearbeiten" button on account detail.
- **Deal Form**: `components/deals/deal-form-dialog.tsx` (create + edit). Create wires to `/deals` Plus button and account-detail "Deal anlegen" button. Edit wires to deal-detail "Bearbeiten" button.
- **Cache Invalidation**: Deal mutations invalidate `getGetAccountQueryKey(accountId)` so the parent account's Deals card refreshes immediately after creating/editing a deal.
- **Backend**: Added `PATCH /api/v1/accounts/:id` endpoint and `AccountPatch` OpenAPI schema. `PATCH /api/v1/deals/:id` already existed.
- **Scope Fix**: `lib/scope.ts → allowedAccountIds()` now also includes accounts owned by the current user (and, for tenantWide users, all accounts owned by users in the same tenant). Previously, freshly-created accounts without deals were invisible even to their creator.

**HubSpot best-in-class Patterns A–L (April 2026):**
- **Saved Views (A)**: `savedViewsTable` (id, userId, tenantId, entityType, name, filters jsonb, columns jsonb, sortBy, sortDir, position, isDefault). Routes `/saved-views` (CRUD scoped to current user). `<SavedViewTabs>` renders built-in + user views as `role=tab` buttons with `+` and `×`.
- **Filter Chips (B)**: `<FilterChipsRow>` + `<FilterChip>` with popover-edit, value-pill and reset-all.
- **Bulk Selection (C)**: row-level checkboxes + sticky `<BulkActionBar>` ("N ausgewählt", Owner/Stage/Delete actions). Backend: `POST /accounts/bulk/owner|delete`, `POST /deals/bulk/owner|stage`. Tenant-isolation: ownerId is validated against `usersTable WHERE tenantId=scope.tenantId` via `resolveOwnerId()` helper, returning 422 on cross-tenant assignment. Deals require non-null owner (DB column NOT NULL); accounts allow null to unset.
- **Inline Edit (D)**: `<InlineEditField>` (text/select/number/date/currency) — click cell, edit, Enter to PATCH. `useEffect` skips re-sync while editing to avoid clobbering local state.
- **Activity Timeline (E)**: `<ActivityTimeline>` reads from audit_log feed.
- **Cmd+K (F)**: `<CommandPalette>` (cmdk) with Accounts/Deals/Contracts/Quotes/Actions/Recents groups, registered globally in AppShell.
- **Recents (G)**: `<RecentsDropdown>` in topbar; localStorage-tracked on detail-route mount.
- **Column Chooser (H)**: `<ColumnChooser>` popover with checkboxes; `useColumnVisibility(storageKey, defs)` persists to localStorage. Saved-View ↔ Chooser sync: visible columns mirror into `view.columns` via guarded `useEffect`; selecting a tab applies stored `view.columns` via `colVis.setAll(...)`.
- **Empty States (I)**: `<EmptyStateCard>` (icon, headline, body, CTA).
- **Pagination (J)**: `<PaginationBar>` with page-size selector (25/50/100).
- **CSV Im-/Export (K)**: `<CSVExportButton>` (client-side from rows) + `<CSVImportDialog>` (file → preview → POST batch); dropzone is keyboard-accessible (Enter/Space).
- **Tour Banner (L)**: dismissible `<TourBanner>` on `/` with "Tour erneut starten" toggle.
- **Cross-Tenant Owner Hardening**: `getUserMap(tenantId?)` is now tenant-scoped at all 7 callers + `dealCtx(tenantId)`. `POST /deals` validates `ownerId` tenant membership before insert. `respondOcDetail(req,...)` carries tenant context for owner resolution. Eliminates cross-tenant user-name leakage via owner mapping.
- **Generated Query Keys**: All cache invalidations use `getList*QueryKey()` / `getGet*QueryKey(id)` from `lib/api-client-react/src/generated/api.ts` (no hardcoded arrays).

**Platform-Admin, Quote-Duplicate, Price-Bundles (April 2026):**
- **Platform-Admin (A)**: New `users.isPlatformAdmin` flag (Priya seeded as Platform-Admin). Backend routes `GET/POST /api/v1/platform/tenants` gated by `requirePlatformAdmin` middleware. Tenant create is wrapped in a DB transaction (tenant + first admin user + 3 system roles atomic) with race-safe email-uniqueness handling (409 on conflict). Frontend: `/platform-admin` page with tenant card grid + "Mandant anlegen" dialog. Sidebar entry "Plattform" only visible if `user.isPlatformAdmin === true`. Route guarded — non-admins redirect to `/`.
- **Quote duplicate (B)**: `POST /api/v1/quotes/:id/duplicate` clones header, current version (`sectionsSnapshot`, `notes`), all line items and attachments inside a DB transaction. New `qt_*`/`qv_*` IDs, status=`draft`, version=1, dealId preserved, number suffixed `-COPY-NNNN`. UI: AlertDialog-confirm `quote-duplicate-button.tsx` shown both on quote detail header and as per-row dropdown action on `/quotes`.
- **Price-Position-Bundles (C)**: New `price_position_bundles` + `price_position_bundle_items` tables (tenant-isolated, optional brand/company scope). CRUD endpoints `/api/v1/price-bundles` plus PUT `/items` for atomic replace. `validateBundleItems` resolves each position's effective tenantId via `companies.tenantId` to block cross-tenant bundle item references; `loadVisiblePositions` applies the same tenant + brand/company-scope filter on read so bundles can never serve as a back door to out-of-scope positions. Frontend: new "Bündel" tab on `/pricing` (card grid, create/edit/delete). `quote-wizard.tsx` Step 2 gets a toolbar with "Aus Pricebook" (multi-select picker with search/category-filter/qty) and "Bundle hinzufügen" (single-click expands a whole bundle into line items).
- **i18n discipline**: All keys live under their canonical namespace (`pages.quotes.*`, `pages.platformAdmin.*`, `pages.pricing.*`, `quoteWizard.*`, `bundlePicker.*`, `bundleForm.*`, `pricebookPicker.*`) in both `de.json` and `en.json`.

## External Dependencies

- **PostgreSQL**: Primary database for data persistence.
- **Anthropic AI Integration**: Used for the AI Copilot functionality, accessed via Replit AI Integration (`AI_INTEGRATIONS_ANTHROPIC_BASE_URL` + `AI_INTEGRATIONS_ANTHROPIC_API_KEY`).
- **HubSpot (conceptual)**: Referenced for simplicity benchmark.
- **Salesforce (conceptual)**: Referenced for rule-engine strength benchmark.
- **PandaDoc (conceptual)**: Referenced for document quality benchmark.
- **Zoho (conceptual)**: Referenced for automation benchmark.
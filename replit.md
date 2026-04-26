# DealFlow One

## Overview

DealFlow One is a Commercial Execution Platform designed for B2B companies. It unifies CRM, CPQ, document management, and automation into a single, deal-centric UI, transforming disparate commercial processes into an intelligent Commercial Flow. The platform acts as a central source of truth for commercial operations, aiming to boost efficiency and strategic oversight throughout B2B sales cycles by managing deals, quotes, contracts, approvals, and leveraging AI-driven orchestration. Its vision is to streamline commercial closing, provide a unified operational view, and enhance decision-making through intelligent automation and AI assistance.

## User Preferences

- Kommunikation mit dem Nutzer erfolgt **immer auf Deutsch**.

## System Architecture

**Design Principles:** The system emphasizes simplicity, clear visual hierarchy, and role-specific interfaces. It supports multi-tenant, multi-company, multi-brand operations, granular Role-Based Access Control (RBAC), complex pricing, contract variations, comprehensive versioning, audit trails, GDPR compliance, event/workflow orchestration, and AI assistance.

**Organizational Core Model:** A hierarchical structure encompassing Platform > Tenant > Company > Brand, with defined user roles and visibility scopes.

**Permission Model:** Access is managed through Roles (capabilities) and Scope (organizational units).

**Core Domains:** Organisation, Identity & Permissions, Customer & Relationship, Deal, Quote & Pricing, Contract, Approvals, Signature, Order Confirmation & Handover, Price Increase Letters, Negotiation & Counterproposal, Reports & KPIs, AI Copilot Orchestration, Governance, Audit, GDPR, Integrations & API.

**Versioning:** Critical entities such as Quotes, Price Positions, Contracts, and Approvals maintain distinct versions for current, approved/effective, and historical states.

**Key Workspaces:** The platform offers 14 dedicated workspaces, including a Home/Today dashboard, Deal Workspace, Quote Studio, Approval Hub, Contract Workspace, Signature Center, and an AI Copilot Workspace.

**Technical Stack:**
- **Monorepo**: pnpm workspaces.
- **Frontend**: React, Vite, TypeScript, TanStack Query, Tailwind, shadcn/ui.
- **Backend**: Express 5 (TypeScript, ESM, esbuild).
- **Database ORM**: Drizzle ORM for PostgreSQL.
- **Validation**: Zod with drizzle-zod.
- **API Codegen**: Orval (generates React Query hooks and Zod schemas from `openapi.yaml`).

**AI Layer:**
- **Architecture**: A modular AI layer with an Anthropic adapter.
- **Prompt Registry**: Typed registry facilitating stable keys, model specifications, typed input builders, and Zod output schemas.
- **Orchestrator**: Manages provider calls, output validation, and error classification.
- **Audit Log**: All AI invocations are comprehensively logged.
- **Domain Context Builder**: Ensures scope-validated, typed contexts for entities while maintaining cross-tenant isolation.
- **Copilot Modes**: Ten modes supporting various commercial tasks (e.g., deal summary, negotiation, contract drafting).
- **AI Help-Bot**: A tool-using agent with a registry for system interaction (e.g., `search_accounts`, `create_deal`).
- **AI Recommendations**: Supports persistence of recommendations with confidence scores, status updates (accepted/rejected/modified), and feedback for metrics and calibration.

**GDPR & Governance:** Features include per-tenant data isolation, API-level role/scope enforcement, full audit trails, soft-delete, retention policy hooks, exportable user data, and redacted secrets in logs.

**Frontend CRUD & Best Practices:** Implements robust CRUD operations for core entities with cache invalidation and scope-aware data handling. Includes features like saved views, filter chips, bulk selection, inline editing, activity timelines, command palette, recents, column choosers, pagination, CSV import/export, and dismissible tour banners.

**Platform Administration & Core Features:**
- **Platform-Admin**: Manages tenants.
- **Quote Duplication**: Allows cloning of quotes.
- **Price Position Bundles**: Manages bundled price positions with tenant and brand/company scope validation.
- **Contract Management**: Includes schema for `contract_types`, `contract_playbooks`, `clause_deviations`, `obligations`. Engines evaluate deviations and derive obligations. CRUD routes for contract types, playbooks, and obligations, with reporting enhancements.
- **Brand-specific Clause Variants**: Supports `brandClauseVariantOverridesTable` for brand-specific modifications and `clauseVariantCompatibilityTable` for defining `requires`/`conflicts` rules between variants.
- **Email for Magic-Link Invitations**: Automatically sends branded invitation emails with magic links upon external collaborator creation.
- **Magic-Link for External Collaborators**: Provides time-limited access for external parties with capabilities and additional security layers like IP allowlists, editable field whitelists, and expiration limits.
- **UX Improvements**: Includes brand logo preview, "create template" dialog, full CRUD for price positions and rules, improved linking to admin profiles, permission checkbox lists for custom roles, unified role sources for users and approval chains, improved approval chain builder with selectors, mandatory clause family multi-select, enhanced account detail page with enriched contact data, brand hierarchy with `parentBrandId`, and automatic deal value adoption from accepted quotes.
- **Crawler Enhancements**: Improved parsing for multiple managing directors and domestic phone numbers. Enhanced company name extraction to prioritize legal forms over boilerplate text.
- **Account Soft-Delete / Archiving**: Implements `archived_at` column, allowing bulk archiving and restoration of accounts.
- **Renewal Engine**: Introduces `renewal_opportunities` table with risk scoring (0-100) and status tracking. Materialization job scans contracts for auto-renewal opportunities. Provides endpoints for triggering renewals, filtering, summaries, and updates.
- **Customer Contacts & Website Suggestions**: Provides CRUD for contacts and a web scraper to suggest contacts from company websites, including email/phone extraction and deduplication.
- **External Existing Contracts with AI Capture**: Supports uploading external contracts via signed URLs, AI-extraction of data, and integration into the renewal engine.
- **Contract Type Binding**: Enforces `tenantId` and `contractTypeId` binding on new contracts, with heuristics for type derivation and retro-binding capabilities.
- **CUAD-Gate for Contract Approval**: Implements a check for "Coverage, Understanding, Adoption, and Design" (CUAD) before contract approval requests, blocking if mandatory categories are missing, with override options for tenant administrators.
- **Bilingual Clause Library & Language Switcher**: Introduces `clause_variant_translations` for English and German, with language selection on contracts and quotes, and detection of missing translations.
- **Learning Clauses from Active Contract Work**: Implements `clause_suggestions` to learn from ad-hoc clause edits, with diffing, content hashing, and decision workflows (accept, reject, supersede, add translation, new variant).
- **Renewal Pipeline Trend Chart**: Adds an endpoint for stacked monthly renewal data, displayed as a 12-month bar chart in reports.
- **Renewal Trend Breakdown**: Extends the trend data to allow grouping by brand and owner, with stacked bars for top entities.
- **Actions from Renewal Trend Chart**: Enables direct actions from the renewal trend chart, allowing users to snooze, mark as done, or notify owners for individual or bulk renewals.
- **Quote Wizard Step 1 Redesign**: Two-column template grid with search, "alle Branchen anzeigen" toggle, "Empfohlen"-Badge auf vorgeschlagener Vorlage, Stats-Block (Positionen / Standard-Rabatt / Sektionen) und inline Sektions-Outline. Neue "Leeres Angebot starten"-Karte erlaubt Anlegen ohne Vorlage; Backend `POST /quotes/from-template` akzeptiert `templateId` jetzt optional/null und legt dann ein leeres Angebot an (templateId in `quote_versions` ist nullable).
- **Lexoffice-style Inline Quote Editor**: Single-page editor for quote drafts with drag-and-drop sortable line items (`@dnd-kit`), inline editing of name/description/qty/list price/discount, "Zwischenüberschriften" (section headings) as a separate `kind='heading'` row that renders as a section header in both UI and PDF, pricebook autocomplete via inline command popover, "Aus Pricebook"/"Bundle einfügen" buttons reusing existing pricing pickers, and a live PDF preview iframe that refreshes ~600ms after debounced auto-save. New routes `/quotes/new` (deal selection → blank draft) and the existing `/quotes/:id` switches to the inline editor when status='draft' (read-only line-items card stays for sent/accepted). Quotes list "New" button now offers a choice between inline editor and the existing template wizard. Schema: added `kind` ('item'|'heading', default 'item') and `sortOrder` (int, default 0) to `line_items`; PUT `/quote-versions/:id/line-items` accepts both fields; reads order by `sortOrder`. Headings contribute 0 to totals; clone/duplicate copies kind+sortOrder; contract avgDiscountPct ignores headings. Tax/unit columns are intentionally out of scope.

## External Dependencies

- **PostgreSQL**: Primary relational database.
- **Anthropic AI Integration**: Powers AI Copilot and AI Help-Bot functionalities.
- **Resend HTTP-API**: Used for sending email invitations.
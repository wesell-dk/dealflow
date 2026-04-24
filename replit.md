# DealFlow One

## Overview

**DealFlow One** is a Commercial Execution Platform for B2B companies, designed to unify the entire commercial closing process from opportunity to post-close handover into a single application. It aims to combine the best aspects of leading commercial tools (CRM, CPQ, document management, and automation) into a clear, deal-centric UI. The platform transforms fragmented commercial processes into a unified, intelligent, and steerable Commercial Flow. Key capabilities include managing deals, accounts, contacts, and roles; versioned quotes with pricing intelligence; robust approval workflows; clause-based contracts with negotiation support; electronic signatures; order confirmations; price increase management; sales performance reporting; and an AI Copilot for orchestration. The business vision is to provide a single source of truth for commercial operations, enhancing efficiency and strategic oversight for B2B sales cycles.

## User Preferences

- Kommunikation mit dem Nutzer erfolgt **immer auf Deutsch**.

## System Architecture

**Design Principle:** Simple on the surface, powerful underneath. The system provides a clear visual order with role-oriented interfaces while supporting multi-tenant, multi-company, multi-brand, scope-based Role-Based Access Control (RBAC), complex pricing logic, contract variants, audit trails, comprehensive versioning, GDPR compliance, event/workflow orchestration, and AI assistance.

**Organisational Core Model:** The platform is structured around a hierarchy of Platform > Tenant > Company > Brand, with Users assigned roles and visibility scopes within this structure.

**Permission Model:** Access is controlled by Roles (defining capabilities) and Scope (defining accessible organisational units).

**Core Domains:** Key functional areas include Organisation, Identity & Permissions, Customer & Relationship, Deal, Quote & Pricing, Contract, Approvals, Signature, Order Confirmation & Handover, Price Increase Letters, Negotiation & Counterproposal, Reports & KPIs, AI Copilot Orchestration, Governance, Audit, GDPR, Integrations & API.

**Versioning:** Critical objects such as Quotes, Price Positions, Contracts, and Approvals maintain distinct versions for current working, approved/effective, and historic states.

**Key Workspaces:** The system provides 14 dedicated workspaces for different commercial activities, including Home/Today, Deal Workspace, Quote Studio, Approval Hub, Contract Workspace, Signature Center, and an AI Copilot Workspace.

**Technical Stack:**
- **Monorepo**: pnpm workspaces.
- **Frontend**: React, Vite, TypeScript, TanStack Query, Tailwind, shadcn/ui.
- **Backend**: Express 5 (TypeScript, ESM, esbuild).
- **Database**: PostgreSQL via Drizzle ORM.
- **Validation**: Zod + drizzle-zod.
- **API codegen**: Orval (from `openapi.yaml`) generates React Query hooks and Zod schemas.

**AI Layer:**
- **Architecture**: A thin, interchangeable AI layer with an Anthropic adapter.
- **Prompt Registry**: Typed registry with stable keys, model specification, typed input builders, and Zod output schemas for structured output.
- **Orchestrator**: Central `runStructured()` function handles provider calls, output validation, and error classification.
- **Audit Log**: All AI invocations are logged for auditing purposes.
- **Domain Context Builder**: Ensures scope-validated, typed contexts for entities, maintaining cross-tenant isolation.
- **Copilot Modes**: Ten defined modes for various commercial tasks (e.g., deal summary, negotiation support, contract drafting).
- **AI Help-Bot**: A tool-using agent with a defined tool registry for interacting with the system (e.g., `search_accounts`, `create_deal`).

**GDPR & Governance:** Features per-tenant data isolation, role and scope enforcement at the API layer, full audit trails, soft-delete, retention policy hooks, exportable user data, and redacted secrets in logs.

**Onboarding & In-App Help:** Includes a Welcome Tour, per-page help drawers with contextual information, and a workflow map component to guide users through the commercial process.

**Frontend CRUD & Best Practices:** Implements robust CRUD operations for core entities (Accounts, Deals) with features like cache invalidation and scope-aware data handling. Incorporates best practices inspired by HubSpot, including saved views, filter chips, bulk selection, inline editing, activity timelines, command palette, recents, column choosers, empty states, pagination, CSV import/export, and dismissible tour banners.

**Platform Administration & Core Features:**
- **Platform-Admin**: Dedicated functionality for platform administrators to manage tenants.
- **Quote Duplication**: Allows cloning of quotes with associated items and attachments.
- **Price Position Bundles**: Enables the creation and management of bundled price positions with tenant and brand/company scope validation.

**Audit / Hardening (April 2026):**
- **Attachment Library Open/Download**: Each attachment card on `/attachments` now exposes a Download icon that opens the file via `/api/storage/objects/...`.
- **Seed Placeholder PDFs**: `seedPlaceholderObjectsIdempotent()` generates tiny valid PDFs for the 9 seed attachments at server start (idempotent, scoped to `tenantId='tn_root'` and `objectPath LIKE '/objects/uploads/seed-%'` so customer uploads are never touched). Helpers: `ObjectStorageService.uploadObjectEntity()` and `objectEntityExists()`.
- **InlineEditField select fix**: Resolved a closure race in `kind="select"` where `onOpenChange(false)` reverted the picked value. `commit()` now accepts an explicit override and a `committingRef` distinguishes commit-close from outside-click.
- **Brand logoUrl length**: `PATCH /api/brands/:id` allows `logoUrl` up to 256 KB (data:image URIs); other text fields remain capped at 512 chars.

**In-App-Glossar & FieldHint (April 2026):**
- **`lib/glossary.ts`**: Zentrale Wörterbuch-Datei mit Kurz- und Langbeschreibungen für die wichtigsten Domain-Enums (Deal-Phasen, Quote-/Vertrag-/Approval-/Signatur-Status, Anhang-Kategorien, Tenant-Pläne, Tenant-Regionen) sowie konzeptionelle Begriffe (Marke, Company, Owner, Wert, Wahrscheinlichkeit, Scope).
- **`<FieldHint>`-Komponente** (`components/ui/field-hint.tsx`): Wiederverwendbares kleines Info-Icon (Lucide HelpCircle) das einen Radix-Popover mit Titel + Erklärung öffnet. Akzeptiert entweder `term={{ group, value }}` (aus dem Glossar) oder `title`/`text` für Ad-hoc-Erklärungen.
- **Anwendung**: Deal-Form (Wert, Phase, Marke, Company, Verantwortlich, Abschlussdatum, Wahrscheinlichkeit) zeigt jetzt Hint-Icons an Labels, und die Phase-Auswahl rendert Label + Beschreibung pro Option direkt in der Dropdown-Liste. Dasselbe Pattern in Tenant-Form (Plan, Region) und Anhang-Upload (Kategorie). Grids im Deal-Form sind jetzt responsiv (`grid-cols-1 sm:grid-cols-2`) und alle neu hinzugefügten Selects haben `htmlFor`/`id`-Verknüpfung für Screenreader.

## External Dependencies

- **PostgreSQL**: Primary database.
- **Anthropic AI Integration**: Used for the AI Copilot and Help-Bot functionalities.
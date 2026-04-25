# DealFlow One

## Overview

DealFlow One is a Commercial Execution Platform for B2B companies, unifying the entire commercial closing process from opportunity to post-close handover. It combines CRM, CPQ, document management, and automation into a clear, deal-centric UI, transforming fragmented processes into a unified, intelligent Commercial Flow. Key capabilities include deal, account, contact, and role management; versioned quotes with pricing intelligence; robust approval workflows; clause-based contracts with negotiation support; electronic signatures; order confirmations; price increase management; sales performance reporting; and an AI Copilot for orchestration. The platform aims to be a single source of truth for commercial operations, enhancing efficiency and strategic oversight for B2B sales cycles.

## User Preferences

- Kommunikation mit dem Nutzer erfolgt **immer auf Deutsch**.

## System Architecture

**Design Principle:** Simple on the surface, powerful underneath. The system provides a clear visual order with role-oriented interfaces while supporting multi-tenant, multi-company, multi-brand, scope-based Role-Based Access Control (RBAC), complex pricing logic, contract variants, audit trails, comprehensive versioning, GDPR compliance, event/workflow orchestration, and AI assistance.

**Organisational Core Model:** The platform is structured around a hierarchy of Platform > Tenant > Company > Brand, with Users assigned roles and visibility scopes.

**Permission Model:** Access is controlled by Roles (defining capabilities) and Scope (defining accessible organisational units).

**Core Domains:** Organisation, Identity & Permissions, Customer & Relationship, Deal, Quote & Pricing, Contract, Approvals, Signature, Order Confirmation & Handover, Price Increase Letters, Negotiation & Counterproposal, Reports & KPIs, AI Copilot Orchestration, Governance, Audit, GDPR, Integrations & API.

**Versioning:** Critical objects like Quotes, Price Positions, Contracts, and Approvals maintain distinct versions for current working, approved/effective, and historic states.

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
- **Audit Log**: All AI invocations are logged.
- **Domain Context Builder**: Ensures scope-validated, typed contexts for entities, maintaining cross-tenant isolation.
- **Copilot Modes**: Ten defined modes for various commercial tasks (e.g., deal summary, negotiation support, contract drafting).
- **AI Help-Bot**: A tool-using agent with a defined tool registry for interacting with the system (e.g., `search_accounts`, `create_deal`).
- **AI Recommendations**: Features persistence of recommendations with confidence scores, allowing for status updates (accepted/rejected/modified) and feedback, along with metrics for acceptance rate and calibration.

**GDPR & Governance:** Features per-tenant data isolation, role and scope enforcement at the API layer, full audit trails, soft-delete, retention policy hooks, exportable user data, and redacted secrets in logs.

**Onboarding & In-App Help:** Includes a Welcome Tour, per-page help drawers with contextual information, and a workflow map component. An in-app glossary (`lib/glossary.ts`) provides short and long descriptions for domain enums and concepts, integrated with a reusable `<FieldHint>` component for contextual explanations.

**Frontend CRUD & Best Practices:** Implements robust CRUD operations for core entities (Accounts, Deals) with features like cache invalidation and scope-aware data handling. Incorporates best practices including saved views, filter chips, bulk selection, inline editing, activity timelines, command palette, recents, column choosers, empty states, pagination, CSV import/export, and dismissible tour banners.

**Platform Administration & Core Features:**
- **Platform-Admin**: Functionality for managing tenants.
- **Quote Duplication**: Allows cloning of quotes.
- **Price Position Bundles**: Enables management of bundled price positions with tenant and brand/company scope validation.
- **Contract Management MVP Phase 1**: Includes schema additions for `contract_types`, `contract_playbooks`, `clause_deviations`, `obligations`. Engines for `evaluateDeviations` and `deriveObligations`, with auto-hooks on status change. CRUD routes for contract types, playbooks, and obligations, plus reporting enhancements. Frontend includes new pages for obligations, deviations, and admin configuration.
- **Brand-specific Clause Variants & Compatibility**: Introduces `brandClauseVariantOverridesTable` for brand-specific clause modifications and `clauseVariantCompatibilityTable` for defining `requires`/`conflicts` rules between variants. Backend engines resolve variants for brands and evaluate compatibility. Frontend supports managing overrides and compatibility rules, and displays compatibility badges.
- **Magic-Link for External Collaborators**: Implements `externalCollaboratorsTable` for secure, temporary access to contracts. Backend supports creating, retrieving, and deleting collaborators, with public routes for external viewing and commenting. Frontend includes an `ExternalCollaboratorsCard` for management and a public `external-view.tsx` page.
- **UX-Hardening 2026-04 (User-Feedback a–k)**: Eleven systematic UX improvements:
  - Brand logo preview now renders via `toAssetSrc` (resolves storage paths through the API base).
  - Templates page has a "Vorlage erstellen" dialog (name, industry, sections, defaults, attachments).
  - Pricing workspace exposes full CRUD on Positionen and Regeln (`PricePositionFormDialog`, `PriceRuleFormDialog` with global/company/brand scope picker; backend adds `PATCH/DELETE /price-positions/:id`, `POST/PATCH/DELETE /price-rules`, `DELETE /industry-profiles/:id`, plus tenant scope guards). `price_rules` now carries `tenantId` to enforce tenant isolation even for `global`-scoped rules; `mapBrand` returns `parentBrandId` so the inline parent-brand picker hydrates correctly.
  - Quote-Wizard "Branche noch nicht konfiguriert"-Hinweis verlinkt direkt in Admin → Branchenprofile.
  - Custom-Rollen erhalten Permission-Checkbox-Liste (gruppierter Permission-Katalog).
  - Benutzer-Rollen und Approval-Chain-Rollen ziehen aus derselben kanonischen Rollen-Quelle.
  - Approval-Chain-Builder ersetzt Roh-JSON durch Field/Op/Value-Selektoren mit Helper-Texten.
  - Pflicht-Klauselfamilien als Multi-Select mit Familien-Manager.
  - Account-Detailseite mit Edit-Dialog; Anlage-Form um Website, Telefon, Adresse, USt-ID, Größe und primären Kontakt erweitert; "Website prüfen" entdeckt Impressum-Links auf der Startseite, parst JSON-LD (Organization/LocalBusiness) und das `<address>`-Tag, fällt auf tolerante Regex (USt-ID mit Leerzeichen, mehrzeilige Adresse) zurück; Land per Nominatim, sonst TLD-Heuristik.
  - Brand-Hierarchie mit `parentBrandId` (inline-Editor, Sub-Marken-Indikator, nested Picker), CompanyDialog-Checkbox "Auch als Standard-Marke anlegen".
  - Deal-Wert ist optional und wird beim ersten akzeptierten Angebot automatisch übernommen.
- **Account-Soft-Delete / Archivieren (2026-04 Follow-up²)**: Spalte `accounts.archived_at` (timestamptz, nullable). `POST /accounts/bulk/delete` archiviert standardmäßig (setzt `archived_at = now()`), liefert `mode:"archived"`. Mit `cascade:true` läuft das alte harte Cascade-Delete (Deals/Letters/Renewals/Kontakte/externe Verträge weg, Verträge/Verpflichtungen behalten geleerte Account-Zuordnung) plus Audit-Action `bulk_purge`. Neuer Endpunkt `POST /accounts/bulk/restore` setzt `archived_at = NULL`. `GET /accounts?status=active|archived|all` filtert; Default `active`. Frontend (`accounts.tsx`): Status-Tabs "Aktiv | Archiv", Bulk-Bar im Aktiv-Modus zeigt "Archivieren" (sicher), im Archiv-Modus "Wiederherstellen" + "Endgültig löschen". Confirm-Dialog hat im Aktiv-Modus einen Toggle "Stattdessen endgültig löschen", der direkt die Cascade-Löschung mit Warntext auslöst. Activity-Timeline labelt `bulk_archive`/`bulk_restore`/`bulk_purge`.
- **Kontakte am Kunden + Website-Vorschläge (Task #74)**: Neue Endpunkte `POST /accounts/:id/contacts`, `PATCH /contacts/:id`, `DELETE /contacts/:id` und `POST /accounts/:id/contacts/scrape-from-website` (nutzt `gateAccount` für Schreibrecht; jede Mutation schreibt Audit). Der People-Crawler probiert origin + `/impressum`, `/imprint`, `/team`, `/ueber-uns`, `/about`, `/kontakt`, `/contact`, `/management`, `/leadership`, `/people`, erkennt CEO/Geschäftsführer/Vorstand/Founder etc. zuverlässig (DE/EN), liest E-Mail/Telefon aus dem Umfeld + `mailto:`-Links inklusive Deobfuscation `[at]`, `(at)`, `AT … DOT`, dedupliziert über Name+E-Mail, sortiert Entscheider zuerst und markiert bestehende Kontakte als `isDuplicate`. UI: Account-Detailseite hat zwei Buttons im Kontakte-Card, Dialog `ContactFormDialog` für Anlage/Bearbeitung, Dialog `ContactScrapeDialog` mit Mehrfach-Auswahl und Pre-Check der nicht-doppelten Vorschläge, Drei-Punkte-Menü pro Kontakt für Bearbeiten/Löschen mit AlertDialog-Bestätigung.
- **Bilingual Clause Library + Vertrags-/Quote-Sprachumschalter (2026-04)**: Neue Tabelle `clause_variant_translations` (Locale `de`|`en`, Felder `name`, `summary`, `body`, `source`, `license`, `sourceUrl`). Spalte `language` auf `contracts` und `quotes` (Default: Brand → Tenant → `de`) inkl. Zod-Validierung. Backend resolved die Sprache je Vertrag/Quote, snapshottet Klauseln bereits in der gewählten Sprache und meldet fehlende Übersetzungen als `translationMissing` und in der Approval-Readiness als `missingInformation`. Neue Routen `GET/PUT/DELETE /clause-variants/:id/translations`, locale-angereicherte `GET /clause-families`. Frontend: Sprachfassungen-Karte auf `/clauses` (DE/EN-Badges, Admin-Dialog mit Name/Zusammenfassung/Body/Source/License/SourceURL); `Languages`-Switcher im Vertrag und Quote (PDF/Preview sprachabhängig). Seed: 3 neue Familien (cf_warr Gewährleistung, cf_conf Geheimhaltung, cf_juris Gerichtsstand) × 5 Varianten mit DE/EN-Übersetzungen; idempotente `augmentClauseTranslations()` ergänzt fehlende Übersetzungen auf bestehenden DBs (DE intern-baseline, EN bonterms-style/CC-BY-4.0).

## External Dependencies

- **PostgreSQL**: Primary database.
- **Anthropic AI Integration**: Used for the AI Copilot and Help-Bot functionalities.
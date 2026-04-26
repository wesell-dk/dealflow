# DealFlow One

## Overview

DealFlow One is a Commercial Execution Platform for B2B companies, designed to streamline commercial operations by integrating CRM, CPQ, document management, and automation into a deal-centric UI. Its purpose is to provide a central source of truth for managing deals, quotes, contracts, and approvals with AI-driven orchestration, ultimately enhancing efficiency and strategic oversight through intelligent automation and AI assistance. The platform aims to improve decision-making and accelerate commercial closing processes, fostering a unified operational view.

## User Preferences

- Kommunikation mit dem Nutzer erfolgt **immer auf Deutsch**.

## System Architecture

**Design Principles:** The system emphasizes simplicity, clear visual hierarchy, and role-specific interfaces, supporting multi-tenant, multi-company, multi-brand operations with granular Role-Based Access Control (RBAC). Key features include complex pricing, contract variations, comprehensive versioning, audit trails, GDPR compliance, event/workflow orchestration, and AI assistance.

**Organizational Core Model:** A hierarchical structure of Platform > Tenant > Company > Brand defines user roles and visibility scopes.

**Permission Model:** Access is governed by Roles (capabilities) and Scope (organizational units).

**Core Domains:** Key functional areas include Organization, Identity & Permissions, Customer & Relationship, Deal, Quote & Pricing, Contract, Approvals, Signature, Order Confirmation & Handover, Price Increase Letters, Negotiation & Counterproposal, Reports & KPIs, AI Copilot Orchestration, Governance, Audit, GDPR, Integrations & API.

**Versioning:** Critical entities such as Quotes, Price Positions, Contracts, and Approvals maintain distinct versions for current, approved/effective, and historical states.

**Key Workspaces:** The platform features 14 dedicated workspaces, including Home/Today, Deal Workspace, Quote Studio, Approval Hub, Contract Workspace, Signature Center, and AI Copilot Workspace.

**Technical Stack:**
- **Monorepo**: pnpm workspaces.
- **Frontend**: React, Vite, TypeScript, TanStack Query, Tailwind, shadcn/ui.
- **Backend**: Express 5 (TypeScript, ESM, esbuild).
- **Database ORM**: Drizzle ORM for PostgreSQL.
- **Validation**: Zod with drizzle-zod.
- **API Codegen**: Orval (generates React Query hooks and Zod schemas from `openapi.yaml`).

**AI Layer:** A modular AI layer with an Anthropic adapter, featuring a typed Prompt Registry, an Orchestrator for managing provider calls and output validation, and a comprehensive Audit Log. The Domain Context Builder ensures scope-validated, typed contexts while maintaining cross-tenant isolation. AI Copilot Modes support various commercial tasks (e.g., deal summary, negotiation, contract drafting), and an AI Help-Bot acts as a tool-using agent for system interaction. AI Recommendations are supported with persistence, confidence scores, and feedback mechanisms.

**GDPR & Governance:** Features include per-tenant data isolation, API-level role/scope enforcement, full audit trails, soft-delete, retention policy hooks, exportable user data, and redacted secrets in logs.

**Frontend CRUD & Best Practices:** Implements robust CRUD operations with cache invalidation and scope-aware data handling, including saved views, filter chips, bulk selection, inline editing, activity timelines, command palette, recents, column choosers, pagination, CSV import/export, and dismissible tour banners.

**Platform Administration & Core Features:**
- **Platform-Admin**: Manages tenants.
- **Quote Management**: Features include quote duplication and a best-in-class inline quote editor with live PDF preview, tax rate selection, inline validation, and keyboard shortcuts.
- **Price Position Bundles**: Manages bundled price positions with tenant and brand/company scope validation.
- **Contract Management**: Includes schema for contract types, playbooks, clause deviations, and obligations. Features include brand-specific clause variants, a bilingual clause library with language switcher, AI-driven learning clauses from active contract work, and a robust consistency linter with quick-fix options and hard-stop gates for approval/signature based on lint errors.
- **Magic-Link Invitations**: Sends branded invitation emails and provides time-limited access for external collaborators with additional security layers.
- **Account Management**: Features include WZ-2008 industry codes, multi-location support, and soft-delete/archiving.
- **Renewal Engine**: Introduces renewal opportunities with risk scoring and status tracking, supporting renewal triggering, filtering, and reporting via trend charts with action capabilities.
- **Lead Management**: Provides an inbox for lead qualification, conversion to accounts/deals, and tracking.
- **Customer Contacts & Website Suggestions**: CRUD for contacts and web scraping to suggest contacts from company websites.
- **External Existing Contracts with AI Capture**: Supports uploading external contracts, AI-extraction of data, and integration into the renewal engine.
- **CUAD-Gate for Contract Approval**: Implements a "Coverage, Understanding, Adoption, and Design" check before contract approval requests, with override options for tenant administrators.
- **Pricing Workspace**: Localized pricing UI with categories, subcategories, and auto-generated SKUs.
- **Regulatorik-Compliance**: Configurable regulatory library (DSGVO/AVV, EU AI Act, DSA, NIS2, LkSG, plus tenant-specific) with AI-driven applicability detection, compliance checks against clauses, manual overrides, and tenant-wide compliance overview.

## External Dependencies

- **PostgreSQL**: Primary relational database.
- **Anthropic AI Integration**: Powers AI Copilot and AI Help-Bot functionalities.
- **Resend HTTP-API**: Used for sending email invitations.
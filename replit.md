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
- `pnpm run build` — typecheck + build everything (no DB needed).
- `pnpm run test` — run tests across all artifacts (today: the cross-tenant
  isolation suite *and* the negative-validation suite in
  `artifacts/api-server/tests/`, both run with `node --test` + `tsx`).
  Requires `DATABASE_URL` (see below).
- `pnpm run test:isolation` — alias that runs just the API tenant-isolation +
  negative-validation suites. Wired into the `ci` validation step so every
  significant change is checked for cross-tenant leakage.
- `pnpm run ci` — full CI gate: `build` followed by `test`. This is the
  registered `ci` validation and is the merge gate. **Requires a reachable
  `DATABASE_URL`.** It injects neutral `PORT=1` / `BASE_PATH=/` defaults for
  the per-artifact vite configs, so it runs standalone outside of an artifact
  workflow. Do not run this from `pnpm install` / dev workflows; it is meant
  for CI / pre-merge. (Defaults: `PORT=1`, `BASE_PATH=/`. Override if you need
  the build output to use a specific base.)
- `pnpm --filter @workspace/api-spec run codegen` — regenerate hooks and Zod
  schemas after editing the OpenAPI spec.
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only).
- `pnpm --filter @workspace/api-server run dev` — run the API server locally.
- `pnpm --filter @workspace/api-server run start:pm2` — run the API server
  through PM2 (`pm2-runtime`) for production-like execution.

### Test prerequisites

`pnpm run test` and `pnpm run ci` boot the API server in-process and execute
real DB queries against the configured Postgres. They will throw immediately
if `DATABASE_URL` is missing (see `lib/db/src/index.ts`). On Replit the
workspace already provisions `DATABASE_URL`; in any other environment, export
a Postgres connection string before invoking these scripts:

```bash
export DATABASE_URL=postgres://user:pass@host:5432/dbname
pnpm run ci
```

There is intentionally **no** local fallback (e.g. an in-memory Postgres):
the tenant-isolation tests must hit the real schema to be meaningful.

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
- `/copilot/diagnostics/ai-health` — AI provider health probe (Tenant-Admin only)

## AI-Layer (Phase 1)

Schmaler, austauschbarer AI-Layer in `artifacts/api-server/src/lib/ai/`:

- `provider.ts` — Anthropic-Adapter über die Replit AI Integration
  (`AI_INTEGRATIONS_ANTHROPIC_BASE_URL` + `AI_INTEGRATIONS_ANTHROPIC_API_KEY`,
  automatisch provisioniert — kein eigener API-Key). Lazy-Init, austauschbar
  über das `AIProvider`-Interface.
- `promptRegistry.ts` — typisierte Prompt-Registry mit stabilen Keys (z. B.
  `diagnostic.ping`). Jeder Prompt kennt sein Modell, System-Prompt, einen
  typisierten Input-Builder und ein zod-Output-Schema.
- `structuredOutput.ts` — wandelt zod-Schemas in Anthropic-tool-input-Schemas
  und validiert die zurückgelieferten tool-Inputs.
- `orchestrator.ts` — zentrale `runStructured()`-Funktion: Provider-Aufruf,
  Output-Validierung, Fehlerklassifizierung (config / provider / validation).
- `auditLog.ts` + `ai_invocations`-Tabelle (`lib/db/src/schema/index.ts`) —
  jeder Call schreibt actor, tenant, active-scope-Snapshot, prompt-Key,
  Modell, Token-Usage, Latenz, Status. Audit ist Pflicht.

Feldregel: Routen importieren AI-Funktionalität ausschließlich aus
`../lib/ai` (Barrel) und rufen NIE direkt den Provider.

### Phase 1 / Schritt 2 — Domain-Context-Builder

`artifacts/api-server/src/lib/ai/context.ts` baut für die vier zentralen
Entitäten einen scope-validierten, typisierten Kontext, den die Prompts als
Input erhalten:

- `buildDealContext(req, dealId)` → `DealContext`
- `buildQuoteContext(req, quoteId)` → `QuoteContext` (inkl. Deal- und
  Account-Roll-up)
- `buildContractContext(req, contractId)` → `ContractContext` (inkl.
  Vertragsklauseln + offene Approvals)
- `buildApprovalContext(req, approvalId)` → `ApprovalContext` (inkl. Deal,
  Account, aktuellem Quote)

Jeder Builder ruft `entityScopeStatus()` und wirft `NotInScopeError`
(`status: 'missing' | 'forbidden'`), die die HTTP-Routen auf 404/403
mappen. Sekundärdaten (Account/Brand/Company) werden ausschließlich über
die bereits scope-validierte Wurzel geladen — Cross-tenant-Bypass ist
unmöglich.

### Phase 1 / Schritt 3 — 10 Copilot-Modi

`artifacts/api-server/src/lib/ai/prompts/dealflow.ts` registriert die zehn
Modi der Spec mit deutschem System-Prompt, typisiertem `buildUser` und
zod-Output-Schema. PROMPT_REGISTRY exportiert alle:

| Key | Modell | Output-Form |
| --- | --- | --- |
| `deal.summary` | sonnet-4-6 | headline + status + health + keyFacts/blockers/nextSteps |
| `negotiation.support` | sonnet-4-6 | customerStance + openTopics + draftReply |
| `pricing.review` | sonnet-4-6 | summary + margin/discount-Assessment + policyFlags |
| `approval.readiness` | sonnet-4-6 | decisionReady + recommendation + rationale + missingInfo |
| `contract.draft` | sonnet-4-6 | recommendedTemplate + sections + clauses |
| `contract.risk` | sonnet-4-6 | overallRisk + riskSignals (clause/finding/recommendation) |
| `contract.redline` | sonnet-4-6 | redlines (added/removed/modified) + overallStance |
| `price-increase.support` | sonnet-4-6 | tone + draftLetter + perSku rationale |
| `executive.brief` | haiku-4-5 | headline + oneLiner + highlights/risks/asks |
| `deal.health` | sonnet-4-6 | healthScore + drivers + recommendedActions |

`structuredOutput.ts` wurde erweitert um `z.nullable` (Type-Array-Trick),
`z.union` aus `z.literal` (→ JSON-Schema `enum`) und
`z.array.min/max` (→ `minItems`/`maxItems`) — alle zehn Schemas erzeugen
ein für Anthropic gültiges Tool-Input-Schema.

### Phase 1 / Schritt 4 — Produktive HTTP-Endpoints

In `artifacts/api-server/src/routes/dealflow.ts` sind vier Modi
endpoint-aktiviert:

- `POST /api/copilot/deal-summary/:dealId`
- `POST /api/copilot/pricing-review/:quoteId`
- `POST /api/copilot/approval-readiness/:approvalId`
- `POST /api/copilot/contract-risk/:contractId`

Jede Route: Context-Builder → `runStructured()` → Persistierung als
`copilot_insight` (kind = `ai_<mode>`, triggerType + triggerEntityRef
über `copilot_insights_trigger_uniq` für Re-Run-Idempotenz via
`onConflictDoUpdate`). Antwort:
`{ ok, result, invocationId, insightId, model, latencyMs }`.

Fehlerklassifizierung:

- `NotInScopeError 'missing'` → 404 `not_found`
- `NotInScopeError 'forbidden'` → 403 `forbidden`
- `AIOrchestrationError 'config_error' | 'audit_unavailable'` → 503
- alle anderen `AIOrchestrationError` → 502 mit `code` (`validation_error`,
  `no_tool_call`, `provider_error`)

Jeder Versuch — auch fehlgeschlagene — schreibt einen Audit-Eintrag in
`ai_invocations` (Schema-Konformitäts-Check ist bewusst strikt; bei
sehr dichten Kontexten kann das Modell sporadisch off-schema antworten,
was kontrolliert als 502 + Audit auftaucht).

Die übrigen sechs Modi (`negotiation.support`, `contract.draft`,
`contract.redline`, `price-increase.support`, `executive.brief`,
`deal.health`) sind im Registry verdrahtet und werden in Phase 2
zusammen mit der UI an HTTP-Endpoints gebunden — die Architektur ist
dafür komplett vorbereitet (gleicher Routenpattern, gleicher
Persistenz-Helper).

## GDPR & Governance

Per-tenant data isolation, role + scope enforced at API layer, full audit
trail on commercial state changes, soft-delete + retention policy hooks,
exportable user data, redacted secrets in logs.

## Known limitations (demo scope)
- No authentication: `/orgs/me` returns the seeded user `u_priya`. Production needs auth middleware + scope-based RBAC enforcement on every router.
- Request bodies are cast, not Zod-validated, in handlers. Wire the generated Zod schemas through middleware before exposing publicly.

## Spracheinstellung
- Kommunikation mit dem Nutzer erfolgt **immer auf Deutsch**.

## Konzept-Quelldokumente (verbindliche Spezifikation)
Die fachliche Zielspezifikation liegt unter `docs/konzept/`:
- `00_gesamtkonzeption.md` — Gesamtkonzept (Vision, Domänen, Prinzipien)
- `01_datenmodell_rechte_api.md` — Datenmodell, Rechte, API-Zielbild, Screen-Start
- `02_screens_teil2.md` — Screen-by-Screen Teil 2 (Negotiation, Signature, Order Confirmation, Price Increase, Reports, Copilot, Platform Admin)

Diese Dokumente sind die Quelle der Wahrheit für jede Frage „ist Feature X im Konzept?". Vor größeren Änderungen immer dort nachlesen.

# E2E: Status Badge Tone Rendering

This is the canonical end-to-end browser smoke test plan for verifying
that status badges across the migrated pages now render through the
central tone system (`components/patterns/status-badges.tsx`) and use
no manual `bg-emerald-100`, `bg-amber-100`, `bg-rose-100`,
`bg-green-100`, or `bg-yellow-100` classes (charts, redlining diff,
heat dots, and trend up/down icons are explicitly out of scope).

It is written as a `runTest()` plan (Playwright-based) for browser
verification. The fast, CI-enforced regression layer is
`tests/status-badges.test.tsx`, which renders every migrated badge
component via `react-dom/server` and asserts the central tone
classes — that suite runs in `pnpm run ci`. Use this e2e plan
through the testing skill for full visual smoke coverage.

## Test plan (paste into `runTest({ testPlan })`)

```text
PREREQUISITES:
The seed dataset already contains price-increase campaigns,
negotiations, clause families, and clause suggestions. No setup needed.

BROWSER FLOW:
1. [New Context] Create a new browser context (1280x720)
2. [Browser] Navigate to /login
3. [Browser] Type "priya@helix.com" into the E-Mail input
4. [Browser] Type "dealflow" into the Passwort input
5. [Browser] Click the "Anmelden" button
6. [Verify] Assert redirect away from /login (URL should not contain "/login")

# ── Page 1: Price increases list ─────────────────────────────────────
7. [Browser] Navigate to /price-increases
8. [Verify]
   - At least one campaign card is visible.
   - document.querySelectorAll('.bg-emerald-50, .bg-amber-50, .bg-rose-50').length >= 3
   - document.querySelectorAll('.bg-emerald-100, .bg-amber-100, .bg-rose-100, .bg-green-100, .bg-yellow-100').length === 0
   - Use exact class selectors with the leading dot — NOT substring
     matches like [class*="bg-emerald"]. Substring matches will
     incorrectly match the new central tones (bg-amber-50).

# ── Page 2: Price increase detail (KPI tone classes) ─────────────────
9. [Browser] Click the first campaign card link.
10. [Verify]
   - URL matches /price-increases/.+
   - "Accepted", "Pending", and "Rejected" are visible.
   - document.querySelectorAll('.text-emerald-700').length >= 1
   - document.querySelectorAll('.text-amber-700').length >= 1
   - document.querySelectorAll('.text-rose-700').length >= 1
   - document.querySelectorAll('.text-green-700, .text-yellow-700, .text-red-700').length === 0

# ── Page 3: Clauses ──────────────────────────────────────────────────
11. [Browser] Navigate to /clauses
12. [Verify]
   - At least one clause family is shown.
   - data-testid="suggestions-tile" is visible.
   - document.querySelectorAll('.text-amber-700').length >= 1
   - document.querySelectorAll('.bg-amber-100, .bg-emerald-100, .bg-rose-100').length === 0

# ── Page 4: Clause suggestions ───────────────────────────────────────
13. [Browser] Click data-testid="suggestions-tile".
14. [Verify]
   - URL is /clauses/suggestions
   - document.querySelectorAll('.text-amber-700, .text-emerald-700, .text-rose-700, .text-sky-700').length >= 1
   - document.querySelectorAll('.bg-amber-100, .bg-emerald-100, .bg-rose-100').length === 0

# ── Page 5: Copilot ──────────────────────────────────────────────────
15. [Browser] Navigate to /copilot
16. [Verify] Page renders without errors. h1 is visible.

# ── Page 6: Reports ──────────────────────────────────────────────────
17. [Browser] Navigate to /reports
18. [Verify]
   - "Renewals mit Risiko", "Offene Klausel-Abweichungen", and
     "Überfällige Pflichten" are visible.
   - document.querySelectorAll('.text-amber-600, .text-red-600').length === 0
     (these were the legacy classes, now replaced with TONE_TEXT_CLASSES
     warning/danger which are text-amber-700 / text-rose-700.)
```

## Required technical context

- App: DealFlow One. Web at `/`, API at `/api`.
- Login uses email + password. Demo password for all demo accounts
  is `dealflow`. `priya@helix.com` is a Tenant Admin.
- Central tone source of truth:
  `artifacts/dealflow-web/src/components/patterns/status-badges.tsx`
- Light-mode tone classes the central system emits:
  - success → `bg-emerald-50 text-emerald-700 border-emerald-200`
  - warning → `bg-amber-50 text-amber-700 border-amber-200`
  - danger  → `bg-rose-50 text-rose-700 border-rose-200`
  - info    → `bg-sky-50 text-sky-700 border-sky-200`
  - neutral → `bg-muted text-muted-foreground border-border`
- TONE_TEXT_CLASSES re-uses `text-{emerald|amber|rose|sky}-700`.
- TONE_ICON_CLASSES re-uses `text-{emerald|amber|rose|sky}-600`.
- Out-of-scope rendered classes that may still appear and are
  EXPECTED (do not flag them): `bg-emerald-500`, `bg-amber-500`,
  `bg-rose-500`, `bg-green-500`, `bg-amber-400`, `bg-red-500`,
  `bg-emerald-50/40`, `bg-emerald-300`, `bg-rose-500/5`,
  `bg-emerald-500/5`, `bg-emerald-500/10`, `bg-amber-500/10`,
  `bg-rose-500/10`, `text-rose-500`, `text-amber-500`,
  `text-emerald-500`, `text-rose-600`, `text-amber-600`
  (only on copilot insight icons).

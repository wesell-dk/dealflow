# E2E: Renewal Trend Chart Click Flow

This is the canonical end-to-end browser test plan for the renewal trend
chart drilldown on `/reports`. It is written as a `runTest()` plan
(Playwright-based) since the workspace does not yet have a standalone
Playwright suite. To execute it, run the test plan below through the
testing skill.

## What it covers

- Login as Tenant Admin (`priya@helix.com` / `dealflow`)
- Seeds a single open renewal opportunity in the next 12 months
- Opens `/reports`, clicks the matching month bar in
  `card-renewal-trend`
- Verifies navigation to `/renewals?ym=YYYY-MM` and that
  `badge-ym-filter` is visible
- Verifies that `button-clear-ym-filter` removes the filter
- Cleans up the seeded renewal

## Test plan (paste into `runTest({ testPlan })`)

```text
PREREQUISITES (run before browser steps):
1. [DB] Generate a unique run id ${runId} = "e2etrnd_" + nanoid(6).
   Pick a target month ~7 months out (must be within the next 12 months
   from the first day of the current UTC month) and store as
   ${ymTarget} (format YYYY-MM) and ${dueDate} (first of that month,
   YYYY-MM-DD).
2. [DB] Insert a renewal opportunity:
   INSERT INTO renewal_opportunities (
     id, tenant_id, contract_id, account_id, brand_id,
     due_date, status, risk_score, value_amount, currency,
     created_at, updated_at
   ) VALUES (
     'rnw_' || '${runId}', 'tn_root', 'ctr_' || '${runId}',
     'acc_002', 'br_helix', '${dueDate}', 'open', 30, 12500, 'EUR',
     NOW(), NOW()
   )
3. [DB] Verify insert: SELECT id, due_date, status FROM
   renewal_opportunities WHERE id = 'rnw_' || '${runId}'

BROWSER FLOW:
4. [New Context] Create a new browser context (1280x720)
5. [Browser] Navigate to /login
6. [Browser] Enter "priya@helix.com" / "dealflow" and click Sign In
7. [Verify] Assert redirect away from /login
8. [Browser] Navigate to /reports
9. [Verify]
   - card-renewal-trend is visible
   - At least one bar is rendered for ${ymTarget}
10. [Browser] Click the bar inside card-renewal-trend that corresponds
    to ${ymTarget}
11. [Verify]
   - URL is /renewals?ym=${ymTarget}
   - badge-ym-filter is visible and contains ${ymTarget}
   - button-clear-ym-filter is visible
12. [Browser] Click button-clear-ym-filter
13. [Verify]
   - URL no longer contains "ym="
   - badge-ym-filter is no longer in the DOM

CLEANUP:
14. [DB] DELETE FROM renewal_opportunities WHERE id = 'rnw_' || '${runId}'
15. [DB] Verify cleanup: SELECT count(*) FROM renewal_opportunities
    WHERE id = 'rnw_' || '${runId}' returns 0
```

## Required technical context

- App: DealFlow One. Web at `/`, API at `/api`.
- Trend endpoint: `GET /api/renewals/_trend?horizonMonths=12` returns
  12 monthly buckets keyed by `ym=YYYY-MM` starting at the first day
  of the current UTC month. It filters by `tenant_id`, `status='open'`,
  `due_date` in range, and requires the `account_id` to be visible
  via `entityScopeStatus`. For tenantWide users that means the account
  must exist in the `accounts` table.
- IMPORTANT: account ids in this project use the `acc_*` prefix
  (e.g. `acc_002` Nordstern AG). Do NOT use `ac_001` — that account
  does not exist and the row will be silently filtered out of the
  trend response.
- Brand `br_helix` (Helix Core) exists in tenant `tn_root`.
- Click handler on the trend chart navigates via wouter's
  `setLocation` to `/renewals?ym=${ym}`.
- Renewals page reads `ym` from the query string and renders
  `badge-ym-filter` plus `button-clear-ym-filter` when set.

## Testids referenced

- `card-renewal-trend`
- `badge-ym-filter`
- `button-clear-ym-filter`

# E2E: Quotes — bulk status / archive / restore

Smoke test for the bulk action bar on `/quotes`. Covers two flows:

1. On the **Active** tab — set bulk status to `expired` (only `draft`
   and `sent` quotes transition; others are reported as `skipped` in
   the toast) and bulk-archive selected quotes.
2. On the **Archived** tab — bulk-restore (un-archive) the previously
   archived quotes back to the Active list.

## What it covers

- Login as Tenant Admin (`priya@helix.com` / `dealflow`)
- Seeds three quotes: two in status `draft` (bulk-expirable) plus one
  in status `accepted` (bulk-skip case)
- Selects all three, runs bulk "Set status → Mark as expired", and
  asserts the two drafts flip to `expired` while the accepted quote
  is left alone (toast reports `2 updated, 0 failed, 1 skipped`)
- Selects all three, archives them via the confirm dialog, and
  asserts they leave the Active tab and `archived_at IS NOT NULL`
- Switches to the Archived tab, selects all three, restores them via
  bulk-unarchive and asserts they reappear in Active with
  `archived_at IS NULL`
- Cleans up the seeded rows (and dependent quote_versions)

## Test plan (paste into `runTest({ testPlan })`)

```text
PREREQUISITES (run before browser steps):
1. [DB] Generate ${runId} = "e2eqte_" + nanoid(6).
2. [DB] Resolve a deal visible to priya@helix.com:
   SELECT d.id AS deal_id, d.tenant_id, d.currency
   FROM deals d
   JOIN brands b ON b.id = d.brand_id
   WHERE b.tenant_id = 'tn_root'
   ORDER BY d.created_at DESC LIMIT 1
   → store ${dealId}, ${tenantId}, ${currency} (default 'EUR').
3. [DB] Insert three quotes (two draft, one accepted):
   INSERT INTO quotes
     (id, tenant_id, deal_id, number, status, current_version,
      currency, valid_until, created_at)
   VALUES
     ('qte_a_' || '${runId}', '${tenantId}', '${dealId}',
      'E2E-A-' || '${runId}', 'draft', 1, '${currency}',
      (CURRENT_DATE + INTERVAL '14 days'), NOW()),
     ('qte_b_' || '${runId}', '${tenantId}', '${dealId}',
      'E2E-B-' || '${runId}', 'draft', 1, '${currency}',
      (CURRENT_DATE + INTERVAL '14 days'), NOW()),
     ('qte_c_' || '${runId}', '${tenantId}', '${dealId}',
      'E2E-C-' || '${runId}', 'accepted', 1, '${currency}',
      (CURRENT_DATE + INTERVAL '14 days'), NOW())
4. [DB] Insert one matching quote_versions row per quote:
   INSERT INTO quote_versions
     (id, tenant_id, quote_id, version, total_amount, discount_pct,
      margin_pct, status, sections_snapshot, created_at)
   VALUES
     ('qv_a_' || '${runId}', '${tenantId}',
      'qte_a_' || '${runId}', 1, 1000, 0, 30, 'draft',
      '[]'::jsonb, NOW()),
     ('qv_b_' || '${runId}', '${tenantId}',
      'qte_b_' || '${runId}', 1, 2000, 0, 30, 'draft',
      '[]'::jsonb, NOW()),
     ('qv_c_' || '${runId}', '${tenantId}',
      'qte_c_' || '${runId}', 1, 3000, 0, 30, 'accepted',
      '[]'::jsonb, NOW())

BROWSER FLOW — bulk set status (expire):
5.  [New Context] Create a new browser context (1280x720)
6.  [Browser] Navigate to /login
7.  [Browser] Enter "priya@helix.com" / "dealflow", click Sign In
8.  [Verify] Assert redirect away from /login.
9.  [Browser] Navigate to /quotes
10. [Verify] Active tab is selected by default and the rows
    quote-row-qte_a_${runId}, quote-row-qte_b_${runId},
    quote-row-qte_c_${runId} are visible.
11. [Browser] Click quote-select-qte_a_${runId},
    quote-select-qte_b_${runId}, quote-select-qte_c_${runId}.
12. [Verify] bulk-action-bar is visible.
13. [Browser] Click quotes-bulk-status-trigger and pick
    "Mark as expired" (value `expired`).
14. [Verify]
    - A toast titled "Quotes marked as expired" appears within 5s
      and its body matches "2 updated, 0 failed, 1 skipped" (or DE
      equivalent).
    - bulk-action-bar disappears.
15. [DB] SELECT id, status FROM quotes
    WHERE id IN ('qte_a_' || '${runId}', 'qte_b_' || '${runId}',
                 'qte_c_' || '${runId}')
    → qte_a_* and qte_b_* status = 'expired';
      qte_c_* status = 'accepted' (unchanged).

BROWSER FLOW — bulk archive:
16. [Browser] Click quote-select-qte_a_${runId},
    quote-select-qte_b_${runId}, quote-select-qte_c_${runId}.
17. [Browser] Click quotes-bulk-archive.
18. [Verify] An AlertDialog appears titled "Archive 3 quote(s)?".
19. [Browser] Click quotes-bulk-archive-confirm.
20. [Verify]
    - Dialog closes, bulk-action-bar disappears.
    - Rows quote-row-qte_a_${runId}, quote-row-qte_b_${runId},
      quote-row-qte_c_${runId} are no longer in the DOM (Active
      tab hides archived quotes).
21. [DB] SELECT id, archived_at FROM quotes
    WHERE id IN ('qte_a_' || '${runId}', 'qte_b_' || '${runId}',
                 'qte_c_' || '${runId}')
    → all three rows have archived_at NOT NULL.

BROWSER FLOW — bulk unarchive:
22. [Browser] Switch to the Archived tab (filters tab labelled
    "Archived" / "Archiv"). The three quote rows reappear.
23. [Browser] Click quote-select-qte_a_${runId},
    quote-select-qte_b_${runId}, quote-select-qte_c_${runId}.
24. [Browser] Click quotes-bulk-unarchive.
25. [Verify]
    - bulk-action-bar disappears.
    - Rows leave the Archived tab.
26. [Browser] Switch back to the Active tab.
27. [Verify] All three rows are visible again.
28. [DB] SELECT id, archived_at FROM quotes
    WHERE id IN ('qte_a_' || '${runId}', 'qte_b_' || '${runId}',
                 'qte_c_' || '${runId}')
    → all three rows have archived_at IS NULL.

CLEANUP:
29. [DB] DELETE FROM quote_versions
    WHERE id IN ('qv_a_' || '${runId}', 'qv_b_' || '${runId}',
                 'qv_c_' || '${runId}')
30. [DB] DELETE FROM quotes
    WHERE id IN ('qte_a_' || '${runId}', 'qte_b_' || '${runId}',
                 'qte_c_' || '${runId}')
31. [DB] Verify: SELECT count(*) FROM quotes WHERE id LIKE
    'qte_%_' || '${runId}' → 0.
```

## Required technical context

- Endpoints exercised: `PATCH /api/quotes/{id}` (single-item) invoked
  once per selected quote in parallel via `Promise.allSettled` for
  both `{ status }` transitions and `{ archived }` toggles.
- Status transitions are only allowed from `draft` or `sent` to
  `expired` / `rejected` — anything else returns 409 and contributes
  to the `failed` / `skipped` counter in the toast (`skipped` covers
  rows the UI already knows can't transition).
- Archive/un-archive applies regardless of status. The Active tab
  uses `archived=active`, the Archived tab uses `archived=archived`.
- The Active tab is selected on first navigation; switching tabs
  resets `selected` and `page`.

## Testids referenced

- `quote-row-{id}`, `quote-select-{id}`
- `quotes-select-all`
- `quotes-bulk-status-trigger`
- `quotes-bulk-archive`
- `quotes-bulk-archive-confirm`
- `quotes-bulk-unarchive`
- `bulk-action-bar`

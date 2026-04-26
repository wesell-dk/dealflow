# E2E: Approvals — bulk approve / reject

Smoke test for the bulk action bar on `/approvals`. Mirrors the
single-row approve/reject flow but exercises the multi-select
checkboxes, header "Select all decidable" toggle, and the bulk
reject comment dialog. Single-item endpoints are called in parallel
via `Promise.allSettled`, so the toast must report the ok/fail count.

## What it covers

- Login as Tenant Admin (`priya@helix.com` / `dealflow`)
- Seeds two open approval requests on an existing deal that the
  current user can decide on (single-stage chain, no `stages` array)
- Selects both via the per-row checkboxes, fires bulk approve, and
  asserts both rows leave the open list and the bulk action bar
  disappears
- Seeds two more open approvals, selects via the header
  "Select all decidable" checkbox, opens the bulk-reject dialog,
  enters a comment, and confirms — asserts the same outcomes
- Cleans up any seeded approval rows

## Test plan (paste into `runTest({ testPlan })`)

```text
PREREQUISITES (run before browser steps):
1. [DB] Generate ${runId} = "e2eapv_" + nanoid(6).
2. [DB] Resolve a tenant_id and a dealId visible to priya@helix.com:
   SELECT d.id AS deal_id, d.tenant_id
   FROM deals d
   JOIN brands b ON b.id = d.brand_id
   WHERE b.tenant_id = 'tn_root'
   ORDER BY d.created_at DESC LIMIT 1
   → store as ${dealId}, ${tenantId}.
3. [DB] Insert two open approvals (single-stage = empty stages):
   INSERT INTO approvals
     (id, tenant_id, deal_id, type, reason, requested_by, status,
      priority, impact_value, currency, stages, current_stage_idx,
      created_at)
   VALUES
     ('apr_a_' || '${runId}', '${tenantId}', '${dealId}',
      'discount', 'E2E bulk approve A', 'usr_priya', 'open',
      'medium', 1000, 'EUR', '[]'::jsonb, 0, NOW()),
     ('apr_b_' || '${runId}', '${tenantId}', '${dealId}',
      'discount', 'E2E bulk approve B', 'usr_priya', 'open',
      'medium', 1500, 'EUR', '[]'::jsonb, 0, NOW())
4. [DB] Verify: SELECT count(*) FROM approvals
   WHERE id IN ('apr_a_' || '${runId}', 'apr_b_' || '${runId}')
   → expect 2.

BROWSER FLOW — bulk approve:
5.  [New Context] Create a new browser context (1280x720)
6.  [Browser] Navigate to /login
7.  [Browser] Enter "priya@helix.com" / "dealflow", click Sign In
8.  [Verify] Assert redirect away from /login.
9.  [Browser] Navigate to /approvals
10. [Verify] Cards approval-apr_a_${runId} and approval-apr_b_${runId}
    are visible.
11. [Browser] Click the per-row checkbox approval-select-apr_a_${runId}
    and then approval-select-apr_b_${runId}.
12. [Verify] bulk-action-bar is visible.
13. [Browser] Click approvals-bulk-approve.
14. [Verify]
    - bulk-action-bar disappears.
    - Both cards approval-apr_a_${runId} and approval-apr_b_${runId}
      are no longer in the DOM (open list filter is the default).
15. [DB] SELECT id, status FROM approvals
    WHERE id IN ('apr_a_' || '${runId}', 'apr_b_' || '${runId}')
    → both rows status = 'approved'.

PREREQUISITES — second batch (bulk reject):
16. [DB] INSERT two more open approvals:
    INSERT INTO approvals
      (id, tenant_id, deal_id, type, reason, requested_by, status,
       priority, impact_value, currency, stages, current_stage_idx,
       created_at)
    VALUES
      ('apr_c_' || '${runId}', '${tenantId}', '${dealId}',
       'discount', 'E2E bulk reject C', 'usr_priya', 'open',
       'medium', 800, 'EUR', '[]'::jsonb, 0, NOW()),
      ('apr_d_' || '${runId}', '${tenantId}', '${dealId}',
       'discount', 'E2E bulk reject D', 'usr_priya', 'open',
       'medium', 900, 'EUR', '[]'::jsonb, 0, NOW())

BROWSER FLOW — bulk reject:
17. [Browser] Reload /approvals (or navigate to it again).
18. [Verify] Cards approval-apr_c_${runId} and approval-apr_d_${runId}
    are visible.
19. [Browser] Click the header checkbox approvals-select-all
    (selects every decidable open approval on the page — at minimum
    the two new ones).
20. [Verify] bulk-action-bar is visible.
21. [Browser] Click approvals-bulk-reject.
22. [Verify] The bulk-reject dialog opens and
    approvals-bulk-reject-confirm is visible but disabled (the
    comment textarea is required).
23. [Browser] Fill approvals-bulk-reject-comment with
    "E2E bulk rejection ${runId}".
24. [Browser] Click approvals-bulk-reject-confirm.
25. [Verify]
    - The dialog closes and bulk-action-bar disappears.
    - Cards approval-apr_c_${runId} / approval-apr_d_${runId} are no
      longer in the DOM.
26. [DB] SELECT id, status, decision_comment FROM approvals
    WHERE id IN ('apr_c_' || '${runId}', 'apr_d_' || '${runId}')
    → both rows status = 'rejected', decision_comment contains
      "E2E bulk rejection ${runId}".

CLEANUP:
27. [DB] DELETE FROM approvals
    WHERE id IN ('apr_a_' || '${runId}', 'apr_b_' || '${runId}',
                 'apr_c_' || '${runId}', 'apr_d_' || '${runId}')
28. [DB] Verify: SELECT count(*) FROM approvals WHERE id LIKE
    'apr_%_' || '${runId}' → 0.
```

## Required technical context

- App: DealFlow One. Web at `/`, API at `/api`.
- Endpoints exercised: `POST /api/approvals/{id}/decide` (single-item)
  invoked once per selected row in parallel via `Promise.allSettled`.
- Approvals page lists open approvals by default; only rows with
  `canDecide && status === 'open'` are selectable. Single-stage
  approvals (`stages: []`) on a deal Priya already owns satisfy
  `canDecide` for her admin role.
- The bulk reject confirm button is disabled until the textarea has
  a non-empty value (matches single-row reject UX).

## Testids referenced

- `approval-{id}`, `approval-select-{id}`
- `approvals-select-all`
- `approvals-bulk-approve`
- `approvals-bulk-reject`
- `approvals-bulk-reject-comment`
- `approvals-bulk-reject-confirm`
- `bulk-action-bar`

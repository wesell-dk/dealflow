# E2E: Signatures — bulk remind

Smoke test for the bulk action bar on `/signatures`. Verifies that
`bulk-remind` only fires for packages whose status is `in_progress`
or `sent`, and that the per-row reminder endpoint is invoked once
per selected package via `Promise.allSettled`.

## What it covers

- Login as Tenant Admin (`priya@helix.com` / `dealflow`)
- Seeds two `in_progress` signature packages with one pending signer
  each (so the reminder endpoint has a target to email)
- Selects both, fires bulk remind, asserts the toast appears and
  `signers.last_reminder_at` is bumped on both packages
- Cleans up the seeded rows

## Test plan (paste into `runTest({ testPlan })`)

```text
PREREQUISITES (run before browser steps):
1. [DB] Generate ${runId} = "e2esig_" + nanoid(6).
2. [DB] Resolve a deal visible to priya@helix.com:
   SELECT d.id AS deal_id, d.tenant_id
   FROM deals d
   JOIN brands b ON b.id = d.brand_id
   WHERE b.tenant_id = 'tn_root'
   ORDER BY d.created_at DESC LIMIT 1
   → store ${dealId}, ${tenantId}.
3. [DB] Insert two signature packages in status 'in_progress':
   INSERT INTO signature_packages
     (id, tenant_id, deal_id, title, status, mode,
      reminder_interval_hours, escalation_after_hours, created_at)
   VALUES
     ('sig_a_' || '${runId}', '${tenantId}', '${dealId}',
      'E2E bulk remind A — ${runId}', 'in_progress', 'sequential',
      48, 120, NOW()),
     ('sig_b_' || '${runId}', '${tenantId}', '${dealId}',
      'E2E bulk remind B — ${runId}', 'in_progress', 'sequential',
      48, 120, NOW())
4. [DB] Insert one pending signer per package:
   INSERT INTO signers
     (id, tenant_id, package_id, name, email, role, order_index,
      status, sent_at)
   VALUES
     ('sgnr_a_' || '${runId}', '${tenantId}',
      'sig_a_' || '${runId}', 'E2E Signer A',
      'e2e-a-' || '${runId}' || '@example.com',
      'customer', 0, 'pending',
      NOW() - INTERVAL '3 hours'),
     ('sgnr_b_' || '${runId}', '${tenantId}',
      'sig_b_' || '${runId}', 'E2E Signer B',
      'e2e-b-' || '${runId}' || '@example.com',
      'customer', 0, 'pending',
      NOW() - INTERVAL '3 hours')

BROWSER FLOW:
5.  [New Context] Create a new browser context (1280x720)
6.  [Browser] Navigate to /login
7.  [Browser] Enter "priya@helix.com" / "dealflow", click Sign In
8.  [Verify] Assert redirect away from /login.
9.  [Browser] Navigate to /signatures
10. [Verify] Default tab is "In Progress"; rows
    signature-row-sig_a_${runId} and signature-row-sig_b_${runId}
    are visible.
11. [Browser] Click signature-select-sig_a_${runId} and
    signature-select-sig_b_${runId}.
12. [Verify] bulk-action-bar is visible.
13. [Browser] Click signatures-bulk-remind.
14. [Verify]
    - A toast titled "Reminders processed" / "Erinnerungen
      verarbeitet" appears within 5s.
    - bulk-action-bar disappears.
15. [DB] SELECT package_id, last_reminder_at FROM signers
    WHERE id IN ('sgnr_a_' || '${runId}',
                 'sgnr_b_' || '${runId}')
    → both rows have last_reminder_at NOT NULL and within the last
      minute.

CLEANUP:
16. [DB] DELETE FROM signers
    WHERE id IN ('sgnr_a_' || '${runId}', 'sgnr_b_' || '${runId}')
17. [DB] DELETE FROM signature_packages
    WHERE id IN ('sig_a_' || '${runId}', 'sig_b_' || '${runId}')
18. [DB] Verify: SELECT count(*) FROM signature_packages
    WHERE id LIKE 'sig_%_' || '${runId}' → 0.
```

## Required technical context

- Endpoints exercised: `POST /api/signatures/{packageId}/remind`
  (single-item) invoked once per selected package in parallel via
  `Promise.allSettled`.
- The bulk-remind button is only enabled when at least one selected
  package is in `in_progress` or `sent` status (other statuses are
  skipped server-side with 409).
- The "In Progress" tab maps to `status=in_progress`.

## Testids referenced

- `signature-row-{id}`, `signature-select-{id}`
- `signatures-select-all`
- `signatures-bulk-remind`
- `bulk-action-bar`

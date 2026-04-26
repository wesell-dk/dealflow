# E2E: Platform-Admin — tenant edit + disable + reactivate

Smoke test for the new Platform-Admin CRUD on `/platform-admin`:

- Edit dialog (name + plan + region + internal notes)
- Disable (soft-delete) confirmation flow
- Reactivate confirmation flow

The test reuses an existing tenant (`tn_root`) so it does not need to create
anything via the API beforehand. All mutations go through the UI.

## What it covers

- Login as Platform Admin (`priya@helix.com` / `dealflow`)
- Opens `/platform-admin`, asserts the existing `tn_root` card is rendered
- Opens the edit dialog (`tenant-edit-tn_root`), changes `notes`
  to a unique string, saves, and asserts the toast + dialog close
- Re-opens the edit dialog, asserts the `notes` value is persisted
- Closes the edit dialog
- Clicks the disable button, confirms in the alert dialog, asserts the
  `Disabled` badge appears on the card
- Clicks the reactivate button, confirms, asserts the `Disabled` badge
  is removed and the disable button is back

## Test plan (paste into `runTest({ testPlan })`)

```text
PREREQUISITES (run before browser steps):
1.  [Setup] Generate ${runId} = "e2etna_" + nanoid(6).
2.  [Setup] Compute ${notes} = "E2E note " + ${runId}.
3.  [DB] Verify the existing tenant exists and is currently active:
    SELECT id, status FROM tenants WHERE id = 'tn_root'
    → expect 1 row with status = 'active'.

BROWSER FLOW:
4.  [New Context] Create a new browser context (1280x800).
5.  [Browser] Navigate to /login.
6.  [Browser] Enter "priya@helix.com" / "dealflow" and click Sign In.
7.  [Verify] Assert redirect away from /login.
8.  [Browser] Navigate to the URL path **/platform-admin** (NOT /admin —
    /admin is a different page; the platform-admin page is at
    /platform-admin).
9.  [Verify]
    - URL pathname ends with /platform-admin
    - platform-admin-page is visible
    - tenant-card-tn_root is visible
    If the URL has redirected to / instead, fail with the message
    "Platform-admin redirect — `priya@helix.com` should have
    isPlatformAdmin = true. Re-login and retry."

EDIT FLOW:
10. [Browser] Click tenant-edit-tn_root.
11. [Verify] tenant-form-dialog is visible.
12. [Browser] Clear input-tenant-notes and type ${notes}.
13. [Browser] Click submit-tenant.
14. [Verify] A toast containing the tenant name "Helix" or "tn_root"
    appears, and tenant-form-dialog is no longer visible.
15. [Browser] Click tenant-edit-tn_root again.
16. [Verify] input-tenant-notes value equals ${notes}.
17. [Browser] Click the dialog cancel button (text "Cancel" / "Abbrechen")
    to close the dialog.
18. [Verify] tenant-form-dialog is no longer visible.

DISABLE FLOW:
19. [Browser] Click tenant-disable-tn_root.
20. [Verify] tenant-status-confirm is visible.
21. [Browser] Click tenant-status-confirm-button.
22. [Verify]
    - tenant-status-confirm is no longer visible
    - tenant-status-tn_root (the "Disabled" badge) becomes visible
    - tenant-reactivate-tn_root is visible
    - tenant-disable-tn_root is no longer in the DOM

REACTIVATE FLOW:
23. [Browser] Click tenant-reactivate-tn_root.
24. [Verify] tenant-status-confirm is visible.
25. [Browser] Click tenant-status-confirm-button.
26. [Verify]
    - tenant-status-confirm is no longer visible
    - tenant-status-tn_root is no longer in the DOM
    - tenant-disable-tn_root is visible again

CLEANUP:
27. [DB] Reset tenant state in case the test failed mid-flow:
    UPDATE tenants
       SET status = 'active', disabled_at = NULL, notes = NULL
     WHERE id = 'tn_root'
28. [DB] Verify cleanup: SELECT status, notes FROM tenants
    WHERE id = 'tn_root' → status = 'active' AND notes IS NULL.
```

## Required technical context

- App: DealFlow One (web at `/`, API at `/api`).
- `priya@helix.com` is the only seeded platform admin (`isPlatformAdmin = true`).
- The platform-admin page is gated client-side by `user.isPlatformAdmin`.
- Endpoints used:
  - `PATCH /api/v1/platform/tenants/{id}` (handled by `useUpdatePlatformTenant`).
  - The same endpoint is used both for field edits (`name/plan/region/notes`)
    and for status transitions (`status: "active" | "disabled"`).
- The disable/reactivate buttons render conditionally based on
  `tenant.status === "disabled"`.

## Testids referenced

- `platform-admin-page`
- `tenant-card-tn_root`
- `tenant-edit-tn_root`
- `tenant-form-dialog`
- `input-tenant-notes`
- `submit-tenant`
- `tenant-disable-tn_root`
- `tenant-reactivate-tn_root`
- `tenant-status-tn_root`
- `tenant-status-confirm`
- `tenant-status-confirm-button`

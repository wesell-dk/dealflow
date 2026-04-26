# E2E: Price-Increase wizard — 3-step new campaign

Smoke test for the new "+ Neue Kampagne" wizard on `/price-increases`.
The wizard has three steps:

1. Campaign basics (name, effective date, currency)
2. Account picker + default uplift %
3. Review summary + create

The test runs through all three steps, creates a campaign, and asserts
that the new card appears in the list.

## What it covers

- Login as Tenant Admin / Platform Admin (`priya@helix.com` / `dealflow`)
- Opens `/price-increases`, clicks `price-increase-new`
- Fills step 1 (name, effective date), advances to step 2
- Selects all visible accounts, advances to step 3
- Asserts the summary reflects the entered values
- Submits, asserts a success toast, and verifies the new campaign card
  is rendered in the list

## Test plan (paste into `runTest({ testPlan })`)

```text
PREREQUISITES (run before browser steps):
1. [Setup] Generate ${runId} = "e2epi_" + nanoid(6).
2. [Setup] Compose ${campaignName} = "E2E Wizard " + ${runId}.
3. [Setup] Compute ${effective} as today's UTC date in YYYY-MM-DD format.

BROWSER FLOW:
4. [New Context] Create a new browser context (1280x800).
5. [Browser] Navigate to /login.
6. [Browser] Enter "priya@helix.com" / "dealflow", click Sign In.
7. [Verify] Assert redirect away from /login.
8. [Browser] Navigate to /price-increases.
9. [Verify] price-increase-new is visible.
10. [Browser] Click price-increase-new.
11. [Verify] price-increase-wizard is visible AND wizard-step-1 is visible.

STEP 1 — basics:
12. [Browser] Type ${campaignName} into input-pi-name.
13. [Browser] Set input-pi-date value to ${effective}.
14. [Browser] Click wizard-next.
15. [Verify] wizard-step-2 is visible.

STEP 2 — accounts + uplift:
16. [Browser] Clear input-pi-uplift and type "4.5".
17. [Browser] Click wizard-toggle-all-accounts.
18. [Verify] At least one wizard-account-row-* checkbox is now checked.
19. [Browser] Click wizard-next.
20. [Verify] wizard-step-3 is visible.

STEP 3 — review + submit:
21. [Verify]
    - summary-name text equals ${campaignName}
    - summary-uplift text contains "4.5"
    - summary-account-count text is a number > 0
22. [Browser] Click wizard-submit.
23. [Verify]
    - A toast containing ${campaignName} appears
    - price-increase-wizard is no longer visible
24. [Verify] At least one price-increase-card-* is rendered whose
    visible card title text contains ${campaignName}.

CLEANUP:
25. [DB] Find the seeded campaign id:
    SELECT id FROM price_increase_campaigns
     WHERE name = '${campaignName}' LIMIT 1
    → store as ${campaignId}.
26. [DB] If ${campaignId} is non-null, run:
    DELETE FROM price_increase_letters WHERE campaign_id = '${campaignId}';
    DELETE FROM price_increase_campaigns WHERE id = '${campaignId}';
27. [DB] Verify cleanup: SELECT count(*) FROM price_increase_campaigns
    WHERE id = '${campaignId}' → 0.
```

## Required technical context

- App: DealFlow One (web at `/`, API at `/api`).
- New endpoint: `POST /api/v1/price-increases`
  (`PriceIncreaseCampaignCreate` schema).
  Body shape: `{ name, effectiveDate, currency, defaultUpliftPct, accountIds[] }`.
- The wizard uses `useListAccounts()` to populate the account picker —
  the seeded tenant `tn_root` ships with multiple accounts (acc_001 …
  acc_010), so the toggle-all action will check at least one row.
- Campaign creation seeds one draft letter per account (status `draft`),
  bound by `allowedAccountIds` for the calling user.
- Cleanup must remove letters first because of the FK from
  `price_increase_letters.campaign_id`.

## Testids referenced

- `price-increase-new`
- `price-increase-wizard`
- `wizard-step-1`, `wizard-step-2`, `wizard-step-3`
- `wizard-step-indicator`, `wizard-step-counter`
- `wizard-next`, `wizard-back`, `wizard-submit`
- `input-pi-name`, `input-pi-date`, `input-pi-uplift`, `select-pi-currency`
- `wizard-toggle-all-accounts`, `wizard-accounts-list`,
  `wizard-account-row-{accountId}`, `wizard-account-checkbox-{accountId}`
- `summary-name`, `summary-date`, `summary-currency`,
  `summary-uplift`, `summary-account-count`, `summary-account-{accountId}`
- `price-increase-card-{campaignId}`

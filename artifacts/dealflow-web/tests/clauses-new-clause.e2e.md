# E2E: Clauses — top-level "+ Neue Klausel" dialog

Smoke test for the new top-level `+ Neue Klausel` dialog on `/clauses`.
The dialog exposes a family picker (existing OR new) plus a variant
form (name, severity, score, summary, body, tone) plus an optional
DE/EN translations editor.

This test exercises the **"new family + variant + DE translation"**
path because that is the most complete flow and the path the user
is most likely to hit when bootstrapping a new clause.

## What it covers

- Login as Tenant Admin / Platform Admin (`priya@helix.com` / `dealflow`)
- Opens `/clauses`, clicks `clauses-new-clause`
- Switches to "Create new family" mode, fills name + description
- Fills the variant block (name, severity, score, summary, body)
- Adds a DE language version
- Submits, asserts a success toast, and verifies the new family card
  is rendered on the page

## Test plan (paste into `runTest({ testPlan })`)

```text
PREREQUISITES (run before browser steps):
1. [Setup] Generate ${runId} = "e2ecl_" + nanoid(6).
2. [Setup] Compose:
   - ${familyName}  = "E2E Family " + ${runId}
   - ${variantName} = "E2E Variant " + ${runId}
   - ${familyDesc}  = "E2E description " + ${runId}
   - ${summary}     = "E2E summary " + ${runId}
   - ${body}        = "E2E body text " + ${runId}
   - ${trName}      = "E2E DE name " + ${runId}
   - ${trSummary}   = "E2E DE summary " + ${runId}

BROWSER FLOW:
3.  [New Context] Create a new browser context (1280x800).
4.  [Browser] Navigate to /login.
5.  [Browser] Enter "priya@helix.com" / "dealflow" and click Sign In.
6.  [Verify] Assert redirect away from /login.
7.  [Browser] Navigate to /clauses.
8.  [Verify] clauses-new-clause is visible.
9.  [Browser] Click clauses-new-clause.
10. [Verify] new-clause-dialog is visible.

FAMILY MODE:
11. [Browser] Click family-mode-new.
12. [Verify] input-new-family-name is visible.
13. [Browser] Type ${familyName}  into input-new-family-name.
14. [Browser] Type ${familyDesc} into input-new-family-description.

VARIANT FIELDS:
15. [Browser] Type ${variantName} into input-variant-name.
16. [Browser] Select "high" in select-variant-severity.
17. [Browser] Clear input-variant-severity-score and type "75".
18. [Browser] Type ${summary} into input-variant-summary.
19. [Browser] Type ${body} into input-variant-body.

TRANSLATION:
20. [Browser] Click add-translation.
21. [Verify] translation-row-0 is visible.
22. [Browser] Ensure translation-locale-0 is set to "de" (default;
    if not, change it).
23. [Browser] Type ${trName}    into translation-name-0.
24. [Browser] Type ${trSummary} into translation-summary-0.

SUBMIT:
25. [Browser] Click submit-new-clause.
26. [Verify]
    - A toast containing ${variantName} appears
    - new-clause-dialog is no longer visible
27. [Verify] On /clauses, the page now contains an element whose
    visible text contains ${familyName} (the new family card).

CLEANUP:
28. [DB] Find ids:
    SELECT v.id AS variant_id, f.id AS family_id
    FROM clause_variants v JOIN clause_families f ON f.id = v.family_id
    WHERE v.name = '${variantName}' LIMIT 1
    → store as ${variantId} and ${familyId}.
29. [DB] Delete in FK order:
    DELETE FROM clause_variant_translations WHERE variant_id = '${variantId}';
    DELETE FROM clause_variants WHERE id = '${variantId}';
    DELETE FROM clause_families WHERE id = '${familyId}';
30. [DB] Verify cleanup: SELECT count(*) FROM clause_families
    WHERE id = '${familyId}' → 0.
```

## Required technical context

- App: DealFlow One (web at `/`, API at `/api`).
- New endpoint: `POST /api/v1/clause-families` (despite the name, this
  endpoint also creates the inline variant + optional translations).
  Body shape: `{ familyId? | newFamily{name,description}, variant{...},
  translations?[{locale,name,summary,body?}] }`.
- Permission: requires Tenant Admin (or platform admin). `priya@helix.com`
  matches both.
- The "+ Neue Klausel" / "+ New clause" button is rendered by
  `pages/clauses.tsx` and gated on `isTenantAdmin`.
- Family + variant ids use prefixes `cf_` / `cv_`; translation rows use
  `cvt_`. Cleanup must delete translations before the variant before the
  family because of the FK chain.

## Testids referenced

- `clauses-new-clause`
- `new-clause-dialog`
- `family-mode-existing`, `family-mode-new`
- `select-clause-family`
- `input-new-family-name`, `input-new-family-description`
- `input-variant-name`, `select-variant-severity`,
  `input-variant-severity-score`, `input-variant-summary`,
  `input-variant-body`
- `add-translation`, `translation-row-0`, `translation-locale-0`,
  `translation-name-0`, `translation-summary-0`,
  `translation-body-0`, `translation-remove-0`
- `submit-new-clause`

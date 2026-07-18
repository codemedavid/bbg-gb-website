# TDD Evidence — Aesthetics product line import

**Task:** Add the genuinely-new data extracted from `bbg Price list.xlsx` to the
site — the ~28 aesthetics injectables (skin boosters, dermal fillers, toxins)
that were not already in the curated catalog.
**Branch:** `feat/three-mode-pricing`
**Source plan:** the inline `/plan` produced this session (scope confirmed by
the user: "add aesthetics only", "one Aesthetics category").

## Key context

The peptide/BAC/blend data from the spreadsheet was already curated into
`lib/db/data/catalog.ts` (48 products). Reconciliation showed only the
right-block, PHP-only aesthetics line was missing. This import adds exactly that
and leaves the existing catalog and its prices untouched.

## Checkpoints

| Stage | Commit | Meaning |
|---|---|---|
| RED | `aceaf19` | catalog integrity guards pass; 3 aesthetics-present tests fail (category + products absent) |
| GREEN | `684d11c` | 28 aesthetics rows + category added; all 97 tests + tsc pass |

## User journeys

1. As a shopper, I want to browse aesthetic injectables (Rejuran, Profhilo,
   Juvederm, Botox, …) so I can buy fillers/toxins alongside peptides.
2. As the shop owner, I want these priced in PHP only (no USD list price) since
   that is how the price list quotes them.
3. As a developer, I want a data-integrity guard so a future catalog edit can't
   introduce an orphaned category, duplicate code, or zero price unnoticed.

## Task report

| Task | Summary | Validation | Result |
|---|---|---|---|
| 1. De-risk (read-only) | Confirmed the reconstitution calculator is a standalone `/calc` screen (manual inputs, reads no product) and the storefront displays only `pricePhp`; `priceUsd` is already `string \| null` throughout | grep of `lib/calculator.ts`, `app/(storefront)/calc/page.tsx`, `priceUsd` usages | No UI change needed |
| 2. RED guard | Added `lib/db/data/catalog.test.ts` | `npx vitest run lib/db/data/catalog.test.ts` | 3 failed / 5 passed (RED) |
| 3. GREEN | Added `aesthetics` category + description + 28 `SeedProduct` rows; made `code` and `priceUsd` nullable | `npx vitest run` + `npx tsc --noEmit` | 97 passed, tsc clean |
| 4. Seed & verify | Re-seeded, queried DB via app `getDb` | `npm run db:seed`; tsx drive | 7 categories, 75 products, 28 aesthetics with null USD/code render fine |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Every product references a defined category slug | `catalog.test.ts:every product references a defined category slug` | unit | PASS |
| 2 | No duplicate non-empty product codes | `catalog.test.ts:no duplicate non-empty product codes` | unit | PASS |
| 3 | Every product has a positive PHP price | `catalog.test.ts:every product has a positive PHP price` | unit | PASS |
| 4 | Every category slug has a description | `catalog.test.ts:every category slug has a description` | unit | PASS |
| 5 | An `aesthetics` category exists | `catalog.test.ts:defines an aesthetics category` | unit | PASS |
| 6 | ≥25 aesthetics products are added | `catalog.test.ts:adds the aesthetics products` | unit | PASS |
| 7 | Iconic items from each group present (Rejuran i, Profhilo, JUVEDERM Ultra 3, Nabota, Xeomin) | `catalog.test.ts:includes iconic items from each aesthetics group` | unit | PASS |
| 8 | Aesthetics priced PHP-only, arrival salt_liquid | `catalog.test.ts:prices aesthetics in PHP only` | unit | PASS |

## Post-seed verification (real data path)

```
category: Aesthetics / slug: aesthetics / sortOrder: 7
aesthetics product count: 28
  JUVEDERM Ultra 3 | spec=2x1ml prefilled syringes | code=null | php=3970.00 | usd=null | arrival=salt_liquid | 💉
  Blue Peptide     | spec=5ml | code=QSG07 | php=4062.50 | usd=null | arrival=salt_liquid | 💉
  Xeomin           | spec=100U | code=null | php=1400.00 | usd=null | arrival=salt_liquid | 💉
total products in DB: 75
```

## Coverage and known gaps

`lib/db/data/**` is excluded from the coverage config (it is data, not logic),
so no numeric coverage applies. The integrity guards are the safety net.
Not done (intentional, out of agreed scope): peptide price reconciliation
against the fresh extract, and a Playwright storefront screenshot of the new
category (verification was done through the app's query layer instead).

## Merge evidence

RED `aceaf19` → GREEN `684d11c`. If squashed: 3 reproducer tests failed with the
aesthetics data absent; after adding 28 PHP-only aesthetics products under a new
`aesthetics` category, all 97 tests and `tsc --noEmit` pass, and a post-seed DB
query confirms 28 aesthetics products (75 total) served with null USD/code.

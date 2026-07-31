# Opening Group Buy on every catalog product — TDD evidence

**Date:** 2026-07-31
**Branch:** `feat/group-buy-section`
**Source plan:** none. Journeys were derived during this TDD run from the request
"open all products for group buy", scoped with the user to *flip the per-product
switch catalog-wide*, applied *local first, then production*.

## Starting state (measured, not assumed)

A read-only inspection of the production database before any change:

| Fact | Value |
|---|---|
| Products | 95, all `is_active = true` |
| `is_group_buy = true` | **0** |
| Products with any `gb_*` term configured | **0** |
| MOQ campaigns | 3 (1 open, 1 approved, 1 completed), all with 0 included products |

`products.is_group_buy` is the admin product form's "Offer through Group Buy"
switch. It is a catalog setting: it declares that a campaign or a hatian carrying
this product may seed its terms from the product's `gb_*` columns
(`lib/pricing.ts` `campaignDefaultsFor` / `kahatiDefaultsFor`). It does not, on
its own, list anything on the storefront — that is what campaigns do. This was
stated to the user before the work started, and the scope was confirmed anyway.

## User journeys

1. As an admin, I want every product in the catalog offered through Group Buy
   without ticking a switch 95 times, so campaigns can be built from any product.
2. As an admin, I want that bulk change to leave pricing alone, so no product is
   silently repriced.
3. As an operator, I want to rehearse the change against production and see the
   exact number of rows it will touch before it touches them.
4. As an operator, I want a re-run after a partial failure to be safe.

## Task report

### 1. Reproducer written and RED validated

- **Summary:** Wrote `lib/product-group-buy-bulk.test.ts` — 8 tests against an
  isolated in-memory PGlite via `lib/test/harness.ts`.
- **Command:** `npx vitest run lib/product-group-buy-bulk.test.ts`
- **Output:**
  ```
  FAIL  lib/product-group-buy-bulk.test.ts
  Error: Failed to load url ./product-group-buy-bulk … Does the file exist?
  Test Files  1 failed (1)
  ```
- **RED type:** compile-time. The test newly references
  `openGroupBuyForAllProducts`, which did not exist. The failure is the missing
  implementation, not broken setup — the harness and every other suite were green.
- **Checkpoint:** `b2db1e1 test: add reproducer for opening group buy across the catalog`

### 2. Minimal implementation and GREEN validated

- **Summary:** Added `lib/product-group-buy-bulk.ts`. The UPDATE sets only
  `is_group_buy` and is scoped `where is_group_buy = false`, which is what makes
  it idempotent. Added `scripts/qa/open-all-group-buy.ts` as the runner — dry run
  by default, `--apply` to write, prints the target host without the password.
- **Command:** `npx vitest run lib/product-group-buy-bulk.test.ts`
- **Output:** `Test Files 1 passed (1) / Tests 8 passed (8)`
- **Regression check:** `npm test` → `Test Files 112 passed (112) / Tests 1064 passed (1064)`
- **Type check:** `npx tsc --noEmit --pretty false` → exit 0, no output
- **Checkpoint:** `06bbbf6 feat: open Group Buy on every catalog product`

### 3. Refactor

None applied. The module is 60 lines including its header comment, one exported
function, no duplication to remove. Refactoring for its own sake would have been
churn, so no third checkpoint commit was created.

### 4. Applied — local, then production

Local QA database (`DATABASE_URL=` + `PGLITE_PATH=./.pglite-gbqa`, bootstrapped
from `drizzle/*.sql` and seeded to the same 95 products):

```
Target: local PGlite (no DATABASE_URL set)
Products scanned : 95   Already open: 0    Would open: 95   (dry run)
Products scanned : 95   Already open: 0    Opened    : 95   (--apply)
Products scanned : 95   Already open: 95   Opened    : 0    (re-run — idempotent)
```

Independent read-back of the local database: 95/95 `is_group_buy`, 0 products
with any `gb_*` term set, 0 null prices.

Production (`aws-1-ap-south-1.pooler.supabase.com:6543`), dry run first, then
applied with the user's explicit approval of the 95-row number:

```
Products scanned : 95   Already open: 0    Would open: 95   (dry run)
Products scanned : 95   Already open: 0    Opened    : 95   (--apply)
```

Independent read-back of production after the write:

| Check | Result |
|---|---|
| `(is_group_buy, is_active)` | `(true, true)` × 95 — no other combination exists |
| `gb_price_per_kit_php` non-null | 0 |
| `gb_price_per_piece_php` non-null | 0 |
| `gb_vials_per_kit` / `gb_min_vials` / `gb_max_vials_per_batch` non-null | 0 / 0 / 0 |
| `price_php` null or ≤ 0 | 0 |
| Spot check of 5 rows | prices, stock, `is_on_hand`, `on_hand_kit_php` unchanged |

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Every product in the catalog ends with the Group Buy switch on | `lib/product-group-buy-bulk.test.ts:turns the group buy switch on for every product in the catalog` | integration | PASS | `npx vitest run lib/product-group-buy-bulk.test.ts` |
| 2 | A product already open is counted separately, not re-opened | `…:counts a product whose switch is already on separately from the ones it opens` | integration | PASS | same |
| 3 | A second run opens nothing — safe after a partial failure | `…:opens nothing on a second run — the operation is idempotent` | integration | PASS | same |
| 4 | Group buy terms are never written, so no product becomes a ₱0 kit | `…:leaves the group buy terms untouched, so no product is repriced to a ₱0 kit` | integration | PASS | same |
| 5 | Shop price, USD price, stock, on-hand fields and `is_active` are untouched | `…:leaves shop pricing, stock and the on-hand fields exactly as they were` | integration | PASS | same |
| 6 | A delisted product is opened too, and stays delisted | `…:opens a delisted product too — the switch is a catalog setting, not a listing` | integration | PASS | same |
| 7 | `dryRun` reports the real number without writing | `…:reports what it would open without writing when dryRun is set` | integration | PASS | same |
| 8 | An empty catalog is nothing to do, not an error | `…:reports an empty catalog as nothing to do rather than failing` | integration | PASS | same |

## Coverage

```
npx vitest run lib/product-group-buy-bulk.test.ts --coverage \
  --coverage.include='lib/product-group-buy-bulk.ts'

File                    | % Stmts | % Branch | % Funcs | % Lines
lib/product-group-buy-bulk.ts |   100 |      100 |     100 |     100
```

`scripts/qa/open-all-group-buy.ts` is not unit-tested — `scripts/**` is excluded
from coverage by `vitest.config.ts`, and the runner holds no rules, only
argument parsing and printing. Its behaviour was verified by execution against
both databases, recorded above.

## Known gaps and follow-ups

- **The switch is not yet load-bearing for customers.** `is_group_buy` is read by
  the admin product form and by the seeding helpers; no storefront surface filters
  on it. Opening all 95 products does not, by itself, put anything new on
  `/groupbuy` — that board renders campaigns. If the goal is customers seeing
  every product as buyable through group buy, the next piece of work is campaigns
  (or wiring the flag into a storefront query), not this flag.
- **`campaignDefaultsFor` has no production caller.** It is exercised by tests
  only; the campaign form does not currently seed from a product's terms. Worth
  confirming that is intended.
- **All 95 products have null group buy terms**, so every campaign seeded from
  them will fall back to the global defaults. Setting real per-product terms is a
  separate admin task.

## Revert

Every product was `false` before this change and none had terms, so the prior
state is restorable exactly and losslessly:

```sql
UPDATE products SET is_group_buy = false;
```

## Merge evidence

If the checkpoint commits are squashed, this section is the record:

- **RED** — `npx vitest run lib/product-group-buy-bulk.test.ts` failed to load the
  suite because `openGroupBuyForAllProducts` did not exist (`b2db1e1`).
- **GREEN** — the same command passed 8/8; `npm test` 1064/1064; `tsc --noEmit`
  exit 0 (`06bbbf6`).
- **Refactor** — none needed; no commit.
- **Applied** — local PGlite 95 opened then 0 on re-run; production 95 opened,
  read-back confirms 95/95 open with all `gb_*` terms still null.

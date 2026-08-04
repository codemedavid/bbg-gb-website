# Listing group buy products on the board — TDD evidence

**Date:** 2026-07-31
**Branch:** `feat/group-buy-section`
**Source plan:** none. Journeys were derived from the question *"why can't it
appear on the groupbuy page, since that's the use of our groupbuy page"* —
raised after [open-all-group-buy.tdd.md](./open-all-group-buy.tdd.md) flipped
`is_group_buy` on all 95 products and the board still showed one card.

## Why it could not appear — the two blockers, diagnosed before any code

1. **Structural.** `/groupbuy` calls `GET /api/campaigns`, which reads
   `moq_campaigns` and nothing else (`app/api/campaigns/route.ts:12`). It never
   queries `products`. `products.is_group_buy` is a *permission* — "a campaign
   may carry this product" — with no route to the board.
2. **Pricing.** Even given a product-aware board, `campaignDefaultsFor` returns
   `pricePerKitPhp: null` for all 95, because `gb_price_per_kit_php` is null on
   every row and `positiveMoney` treats unset **and zero** as "not sold this
   way, never free" (`lib/pricing.ts:288`). There was nothing to charge.

A third fact shaped the design: `moq_campaigns` has **no `product_id` column**.
Products are linked through the `included_products` JSON the admin campaign form
already writes.

## Design decision

Open one campaign per flagged product, rather than teaching the board to render
products. A campaign already has a card, a cart line, a checkout path, batching
and admin screens — all tested. A parallel product-shaped listing would need
every one of those rebuilt. Using `included_products` as the link means **no new
column and no migration**.

Pricing rule, chosen by the user from three options: absent an explicit group buy
kit price, a kit costs its vials at **shop list price**. Never below the shop, so
it cannot sell at a loss; the group buy discount is the admin lowering it after.

## User journeys

1. As a customer, I want the products offered for group buy to appear on the
   group buy board, because that is what the page is for.
2. As an admin, I do not want a bulk listing to invent a price, or to open a free
   kit for a product it cannot price.
3. As an admin, I want re-running it to be safe, and not to duplicate a campaign
   I already listed by hand.

## Task report

### 1. Reproducer written and RED validated

- **Summary:** `lib/campaign-seed.test.ts` (11 unit tests on the pure seeding
  rules) and `lib/campaign-seed-bulk.test.ts` (12 integration tests on PGlite).
- **Command:** `npx vitest run lib/campaign-seed.test.ts lib/campaign-seed-bulk.test.ts`
- **Output:**
  ```
  FAIL  lib/campaign-seed-bulk.test.ts — Failed to load url ./campaign-seed-bulk
  FAIL  lib/campaign-seed.test.ts      — Failed to load url ./campaign-seed
  Test Files  2 failed (2)
  ```
- **RED type:** compile-time — both modules referenced by the tests were absent.
- **Checkpoint:** `6391f9b test: add reproducer for listing group buy products on the board`

### 2. Implementation and GREEN validated

- **Summary:** `lib/campaign-seed.ts` (pure `campaignSeedFor`) and
  `lib/campaign-seed-bulk.ts` (`openCampaignsForGroupBuyProducts`), plus the
  runner `scripts/qa/list-group-buy-products.ts` (dry run unless `--apply`).
- **Command:** `npx vitest run lib/campaign-seed.test.ts lib/campaign-seed-bulk.test.ts`
- **Output:** `Test Files 2 passed (2) / Tests 23 passed (23)`
- **Regression check:** `npm test` → `Test Files 114 passed (114) / Tests 1087 passed (1087)`
- **Type check:** `npx tsc --noEmit --pretty false` → exit 0, no output
- **Checkpoint:** `5a105f0 feat: list group buy products on the board by opening a campaign each`

### 3. Refactor

None. Two focused modules, no duplication to remove; no third commit.

### 4. End-to-end proof on a running app

Applied to the local QA PGlite (`DATABASE_URL=` + `PGLITE_PATH=./.pglite-gbqa`):

```
Flagged, listed products : 95   Already on the board: 0   Campaigns opened: 95
Flagged, listed products : 95   Already on the board: 95  Campaigns opened: 0   (re-run)
```

Then `next dev` against that database, querying the exact endpoint the board
consumes:

```
GET /api/campaigns → campaigns returned: 95, open: 95
  Tirzepatide 15mg vial   open  ₱32,000/kit  moq 10  included 1
  Tirzepatide 30mg vial   open  ₱48,500/kit  moq 10  included 1
  …
```

The `/groupbuy` HTML itself is the client shell (the board is fetched by
`useCampaigns`), so the API response is the meaningful assertion. A browser
screenshot was attempted but the chrome-devtools profile was locked by another
session; this was not worked around, and no visual check is claimed.

### 5. Production

Dry run, then applied with the user's explicit approval after being shown the
price range and three caveats (no discount vs shop, non-vial items framed as
kits, Retatrutide appearing twice):

```
Flagged, listed products : 95   Already on the board: 0   Campaigns opened: 95
```

Read-back:

| Check | Result |
|---|---|
| Campaigns by status | 96 open (95 new + 1 pre-existing test), 1 approved, 1 completed |
| Campaigns with exactly 1 linked product | 95 |
| Campaigns priced ≤ 0 | **0** |
| Products carried by more than one live campaign | **0** |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | An admin-set group buy kit price is used as-is | `campaign-seed.test.ts:prices a kit from the group buy price the admin set on the product` | unit | PASS |
| 2 | Without one, a kit costs its vials at shop price | `…:falls back to the shop price times the kit size when no group buy price is set` | unit | PASS |
| 3 | That fallback uses the product's own kit size | `…:uses the product's own kit size for that fallback, not the global ten` | unit | PASS |
| 4 | A zero group buy price is unset, not free | `…:treats a zero group buy price as unset rather than as a free kit` | unit | PASS |
| 5 | Fractional prices round to centavos | `…:rounds a fractional shop price to centavos` | unit | PASS |
| 6 | An unpriceable product yields no campaign at all | `…:refuses to seed a campaign it cannot price rather than opening a free one` | unit | PASS |
| 7 | The card reads as a product (name + spec) | `…:names the campaign after the product and its spec…` | unit | PASS |
| 8 | The product is linked, in stock | `…:carries the product in includedProducts, in stock` | unit | PASS |
| 9 | Batch size and per-customer minimum come from product terms | `…:takes its batch size and per-customer minimum from the product terms` | unit | PASS |
| 10 | Untermed products get a full batch and a one-kit minimum | `…:defaults to a full batch and a one-kit minimum…` | unit | PASS |
| 11 | Arrival group carries to the batch | `…:carries the arrival group so the batch ships with its own group` | unit | PASS |
| 12 | One open campaign per flagged product | `campaign-seed-bulk.test.ts:opens one campaign per flagged product…` | integration | PASS |
| 13 | Each is priced from the product, with fallback | `…:prices each campaign from the product, falling back to the shop price` | integration | PASS |
| 14 | The product↔campaign link is written | `…:links the product through includedProducts…` | integration | PASS |
| 15 | Each opens as batch #1 of its own series | `…:opens each campaign as batch #1 of its own series` | integration | PASS |
| 16 | Unflagged products are ignored | `…:ignores a product that is not flagged for group buy` | integration | PASS |
| 17 | Delisted products are ignored | `…:ignores a delisted product…` | integration | PASS |
| 18 | A second run opens nothing | `…:skips a product that already has a live campaign — the operation is idempotent` | integration | PASS |
| 19 | No duplicate of an admin's hand-made listing | `…:does not open a duplicate for a product an admin already listed by hand` | integration | PASS |
| 20 | A cancelled campaign does not delist a product forever | `…:re-lists a product whose only campaign was cancelled` | integration | PASS |
| 21 | An unpriceable product is reported, not listed | `…:refuses to list a product it cannot price, and reports it instead` | integration | PASS |
| 22 | dryRun writes nothing | `…:writes nothing under dryRun but reports what it would open` | integration | PASS |
| 23 | An empty catalog is nothing to do | `…:reports an empty catalog as nothing to do rather than failing` | integration | PASS |

Evidence for all 23: `npx vitest run lib/campaign-seed.test.ts lib/campaign-seed-bulk.test.ts`

## Coverage

```
lib/campaign-seed.ts       100% stmts / 100% branch / 100% funcs / 100% lines
lib/campaign-seed-bulk.ts  100% stmts / 100% branch / 100% funcs / 100% lines
```

`scripts/qa/list-group-buy-products.ts` is not unit-tested — `scripts/**` is
excluded from coverage in `vitest.config.ts` and the runner holds no rules, only
argument parsing and printing. It was verified by execution against both
databases.

## Known gaps and follow-ups

- **The seeded prices carry no group buy discount.** Every kit is list price ×
  kit size, so a customer saves nothing versus the shop. Lowering them is a
  per-product admin action and was explicitly deferred by the user.
- **Non-vial products are framed as kits of ten.** "BAC Water 3ml", "Nabota per
  piece" and "Rentox per piece" now have ₱4,750–₱12,000 ten-unit kits. Flagged
  before applying; the user chose to open all 95 anyway.
- **Retatrutide 20mg appears twice** — the pre-existing "Retatrutide 20mg — GB
  test" campaign (2/10 kits, real commitments) has no linked product, so it
  cannot be deduped against the new "Retatrutide 20mg vial".
- **No browser screenshot.** The chrome-devtools profile was locked by a
  concurrent session. The API assertion stands in its place.
- **`campaignDefaultsFor` still has no other production caller** — the admin
  campaign form does not seed from a product's terms. Unchanged by this work.

## Revert

The 95 new campaigns all have `committed = 0`, so they can be removed without
touching money:

```sql
DELETE FROM moq_campaigns
WHERE committed = 0
  AND jsonb_array_length(included_products) = 1
  AND created_at > '2026-07-31';
```

Verify the row count before running it; the three pre-existing campaigns have
`jsonb_array_length(included_products) = 0` and are excluded by that clause.

## Merge evidence

- **RED** — both suites failed to load; `campaign-seed` and `campaign-seed-bulk`
  did not exist (`6391f9b`).
- **GREEN** — 23/23 new tests; full suite 1087/1087; `tsc --noEmit` exit 0 (`5a105f0`).
- **Refactor** — none needed; no commit.
- **Applied** — local 95 opened then 0 on re-run, `GET /api/campaigns` returned
  95 open priced campaigns on a running app; production 95 opened, read-back
  confirms 95 single-product campaigns, none priced ≤ 0, no product on two live
  campaigns.

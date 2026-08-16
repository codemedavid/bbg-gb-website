# MOQ shelf: aggregate target, not on-hand stock

**Date:** 2026-08-17
**Branch:** `feat/group-buy-page`
**Source plan:** none on disk — planned inline in session (`/ecc:plan`), journeys derived below.
**Commits:** `4665282` → `f89df64` (six checkpoints, one per phase)

## What was wrong

The admin's Edit MOQ product form collected **Stock**, and the whole shelf was
modelled on it: an order drew stock down, a cancellation put it back,
`inStock = stock > 0 && stock >= minOrderQty` decided whether anything was
buyable. None of that was true — nothing on this shelf is on hand. The MOQ is a
**target**: the units all buyers together must reach before the buy is placed
with the supplier.

Deleting the field alone would have bricked the shelf. Every new product saves
with `stock = 0`, so `inStock` is false, the card reads "Out of stock", the Add
button is disabled and checkout rejects the line. The availability model had to
move off stock in the same change.

## User journeys

1. As an admin, I want the MOQ to be the first thing I set on a product, so the
   form reflects what the page is for.
2. As an admin, I never want to type a stock figure for something nobody holds.
3. As a customer, I want to see how close a buy is to going ahead, so I know
   whether to order now.
4. As a customer, I want to order any quantity — including one that overshoots
   the target — without being told the shelf is out.
5. As an admin, I want a cancelled order to stop counting towards the target, so
   I never place a supplier order on demand that was refunded.
6. As an admin, I want to close a filled round and start collecting again, with
   the orders from the closed round staying settled.

## Task report

### Phase 1 — schema (`4665282`)

Added `moq`, `committed`, `cycle_no` to `moq_products` and `moq_cycle_no` to
`order_items`, via `drizzle/0025_moq_product_targets.sql`. `stock` is retained
and unread — dropping a column on a live database is its own deliberate
migration, not a passenger on a feature. Backfill seeds `moq` from the old
`min_order_qty` (the only number on the row that ever meant "how many we need"),
then resets `min_order_qty` to 1.

- **RED** — `npx vitest run lib/db/moq-products.test.ts`:
  `column "moq" of relation "moq_products" does not exist` (3 failed).
  Note the test schema is built from the **migration files**, not `schema.ts`, so
  editing the schema alone left it red until the migration existed.
- **GREEN** — 19 passed across `moq-products`, `migrations-journal`, `schema-shape`.

### Phase 2 — pure rules (`c04de90`)

New `lib/moq-product-cycle.ts`: `moqProductStatus`, `moqLineOutcome`,
`closedCycle`. `validateMoqQty` lost its `stock` argument.

The reusable-looking helper was **not** reused: `groupBuyMoqStatus` clamps
capacity to `MOQ_BATCH_MAX_KITS = 10`, correct for a kit batch and catastrophic
for a 500-unit shelf target — it would render 500 as 10/10. Pinned by
`scales progress to the target rather than to a ten-kit batch`.

- **RED** — `Failed to load url ./moq-product-cycle. Does the file exist?`
- **GREEN** — 96 passed (`moq-product-cycle`, `pricing`).

### Phase 3 — admin write path (`f0f116a`)

MOQ moved to a full-width emphasised field directly under Name; Stock deleted;
the shelf card shows `committed / target` with a progress bar. The form gained
an `aria-label`, which both makes field order assertable and announces the
dialog.

- **RED** — 7 failed in `page.test.tsx`, including
  `leads the form with the MOQ` and `offers no stock field anywhere on the shelf`.
- **GREEN** — 28 passed (page) + 34 passed (admin API routes, form contract).

### Phase 4 — order path (`94ec7f2`)

Checkout increments `committed` under a guarded UPDATE and stamps the line with
the cycle it joined. Cancellation releases those units, floored at zero.
`moq-restock.test.ts` → `moq-release.test.ts`, since release is what it proves.

- **RED** — 14 failed: checkout `expected 400 to be 201`, every release case
  `Cannot read properties of null (reading 'order')`.
- **GREEN** — 37 passed (checkout, release, order edit).

### Phase 5 — storefront (`ec27233`)

Card carries a labelled `progressbar`; always buyable; cart lines uncapped and
seeded at the per-order floor, never at the target. Board copy rewritten — step 2
used to say "up to whatever stock is left", which is now false.

- **RED** — `Unable to find an accessible element with the role "button" and name /unavailable/i`.
- **GREEN** — full suite 201 files / 2105 tests; `tsc --noEmit` clean.

### Phase 6 — cycle control (`f89df64`)

`POST /api/admin/moq-products/:id/cycle` resets the counter and advances the
cycle, guarded on the cycle number it read. Reaching the target does **not**
auto-roll: hitting the MOQ means the buy *can* go ahead, not that anyone sent it.

- **RED** — `Failed to load url ./route`; then 5 failed in `page.test.tsx` for the
  missing Close round button.
- **GREEN** — 8 passed (cycle route) + 33 passed (admin page).

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Progress scales to the real target, not a ten-kit batch cap | `lib/moq-product-cycle.test.ts:scales progress to the target` | unit | PASS |
| 2 | Overshooting the target is a valid, displayable state | `lib/moq-product-cycle.test.ts:keeps counting past the target` | unit | PASS |
| 3 | A closed round's orders stay "processing" after the counter resets | `lib/moq-product-cycle.test.ts:keeps a line from a closed cycle proceeding` | unit | PASS |
| 4 | A zero target cannot divide the progress bar by nothing | `lib/moq-product-cycle.test.ts:survives a target of zero` | unit | PASS |
| 5 | The form leads with MOQ, straight after the name | `app/admin/moq-products/page.test.tsx:leads the form with the MOQ` | component | PASS |
| 6 | No stock field survives anywhere on the admin shelf | `app/admin/moq-products/page.test.tsx:offers no stock field anywhere` | component | PASS |
| 7 | The form sends `moq` and never sends `stock` | `app/admin/moq-products/page.test.tsx:submits everything the admin typed` | component | PASS |
| 8 | Creating a product rejects a target below 1 | `app/api/admin/moq-products/route.test.ts:rejects a target below 1` | integration | PASS |
| 9 | Raising a target does not disturb what buyers committed | `form-contract.test.ts:round-trips an edit built from the existing product` | integration | PASS |
| 10 | Checkout commits units towards the target | `app/api/orders/moq.test.ts:commits the purchased quantity` | integration | PASS |
| 11 | A line records the cycle it joined | `app/api/orders/moq.test.ts:stamps the line with the cycle it joined` | integration | PASS |
| 12 | A single order may overshoot the target | `app/api/orders/moq.test.ts:accepts a quantity that overshoots` | integration | PASS |
| 13 | Two buyers accumulate rather than overwrite | `app/api/orders/moq.test.ts:adds a second buyer on top of the first` | integration | PASS |
| 14 | A rejected order leaves the counter untouched | `app/api/orders/moq.test.ts:leaves the counter untouched when rejected` | integration | PASS |
| 15 | Cancelling releases the committed units | `moq-release.test.ts:takes the cancelled units back off the counter` | integration | PASS |
| 16 | Cancelling twice releases once | `moq-release.test.ts:does not release twice` | integration | PASS |
| 17 | The counter can never go negative | `moq-release.test.ts:never drives the counter negative` | integration | PASS |
| 18 | The card reports progress to assistive tech | `MoqProductCard.test.tsx:reports the progress to assistive tech` | component | PASS |
| 19 | A listed product is buyable whatever its progress | `MoqProductCard.test.tsx:stays buyable while the target is unreached` / `after the target is reached` | component | PASS |
| 20 | Cart lines seed at the per-order floor, not the target | `MoqBoard.test.tsx:seeds the cart line at the per-order floor` | component | PASS |
| 21 | Cart lines have no ceiling | `lib/store/cart.test.ts:lets an MOQ line grow as large as the customer wants` | unit | PASS |
| 22 | Closing a round zeroes the counter and advances the cycle | `cycle/route.test.ts:puts the counter back to zero` / `advances the cycle number` | integration | PASS |
| 23 | Two concurrent closes advance exactly one round | `cycle/route.test.ts:advances exactly one round when clicked twice` | integration | PASS |
| 24 | A round can be closed short of its target | `cycle/route.test.ts:closes a round that never reached its target` | integration | PASS |
| 25 | Only an admin can close a round | `cycle/route.test.ts:rejects a customer` | integration | PASS |

## Coverage

```
npx vitest run --coverage --coverage.include='lib/moq-product*' ... (MOQ surface)

All files          |   99.26 |       90 |     100 |   99.26 |
  moq-product-cycle.ts  |     100 |    91.66 |     100 |     100 |
  moq-products.ts       |     100 |      100 |     100 |     100 |
  MoqProductCard.tsx    |     100 |    91.66 |     100 |     100 |
  cycle/route.ts        |     100 |      100 |     100 |     100 |
  admin moq-products/page.tsx | 100 |  89.65 |     100 |     100 |
```

Whole suite: `npx vitest run` → **202 files, 2118 tests, all passing**.
`npx tsc --noEmit` → **0 errors**.

## Known gaps and follow-ups

- **`moq_products.stock` still exists**, defaulted and unread. Dropping it is a
  separate migration against the live database.
- **No packing-fee waiver on this shelf.** A buyer topping up their commitment
  mid-round pays the ₱200 MOQ fee again. Group buys waive this within a series
  (`lib/campaign-commitment.ts`); the equivalent keyed on product + cycle is not
  implemented. Raised with the client, not yet decided.
- **`moqLineOutcome` is not yet rendered** on the customer's order pages. The
  rule and its tests exist; wiring it into order detail is a follow-up.
- **No automatic rollover** when a target is reached — deliberate (see Phase 6).
- **`min_order_qty` is dormant**, reset to 1 by the migration and absent from the
  form. Still enforced server-side if an admin sets it directly.

## Deploy note

`0025_moq_product_targets.sql` must be applied before this ships:
`npm run db:check` reports the drift, `npm run db:push` applies it. The backfill
rewrites `min_order_qty` on existing rows — check the shelf's targets afterwards.

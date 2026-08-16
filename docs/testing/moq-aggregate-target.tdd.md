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
| 26 | Cancelling an order from a closed round leaves the live round alone | `moq-release.test.ts:leaves the current round alone when cancelling` | integration | PASS |
| 27 | Editing an order from a closed round leaves the live round alone | `order-edit-server.moq.test.ts:leaves the current round alone when editing` | integration | PASS |
| 28 | An MOQ line edit follows the quantity up and down, uncapped | `order-edit-server.moq.test.ts:follows a quantity increase` / `decrease` / `far beyond the target` | integration | PASS |
| 29 | An overshoot never announces >100% to a screen reader | `MoqProductCard.test.tsx:does not announce more than 100%` | component | PASS |
| 30 | A clean checkout of HEAD builds and passes | `git archive HEAD` + `vitest run` + `tsc --noEmit` | build | PASS |

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

## Post-review cycle

A `/code-review` of `3cef4e5..HEAD` found defects the original run missed. Both
categories were reproduced as failing tests before being fixed.

### Cross-cycle counter corruption (`4aa3e84`)

Cancelling **or** editing an order that joined a **closed** round debited the
round now filling. Those units already went to the supplier; taking them off
round 2 erases demand belonging to its buyers and stalls a buy that was ready to
place. The line already snapshotted `moqCycleNo` — the writes simply were not
guarded on it.

- **RED** — `expected 100 to be 300` (cancel path),
  `expected 250 to be 300` (edit path). Both are the erased-round symptom.
- **GREEN** — 34 passed across the four touched suites.
- New file `lib/order-edit-server.moq.test.ts` covers the edit path, which had no
  MOQ-specific tests at all before.

Also fixed in the same commit: the cycle route could return 500 instead of 404 if
the product was deleted between the guarded UPDATE and the lost-race re-read, and
`aria-valuenow` was unclamped so an overshoot announced ~124% to a screen reader
(now clamped, with the true figure in `aria-valuetext`).

### HEAD did not build or test on a clean checkout (`4a0d000`)

**Process failure, not a code defect.** The MOQ commits staged four files a
concurrent session had already modified — `lib/db/schema.ts`,
`drizzle/meta/_journal.json`, `lib/test/harness.ts`, `lib/admin-api.ts` — taking
that session's edits along. Their *new* files stayed untracked, so HEAD
referenced code that was not in HEAD. Staging explicit paths was not enough;
the paths themselves were already dirty.

Reproduced by exporting HEAD to a scratch directory
(`git archive HEAD | tar -x`) and running the suite there:

```
× migration journal > has a file on disk for every entry
  → expected [ '0023_password_reset_tokens', …(1) ] to deeply equal []
× moq_products table > (all 5 cases)
  → relation "password_reset_tokens" does not exist
```

Every integration test in the repo fails that way, because `resetDb()` truncates
the table. `next build` fails separately on `lib/admin-api.ts:7`,
`Cannot find module './accounts'`.

Fixed by committing the exact closure HEAD dangles on — the two migration SQL
files the committed journal names, plus `lib/accounts.ts` and its test (its only
imports are tracked modules). The remainder of that session's work stays
untracked and theirs to commit.

- **GREEN** — clean checkout of HEAD: **194 files / 2026 tests passing**,
  `tsc --noEmit` **0 errors**. (Fewer than the working tree's 203/2125 because
  the other session's untracked test files are correctly not in HEAD.)

**Lesson for the next change in this repo:** before staging, check
`git status` for files another session has already modified, and stage only
files whose *current diff* is entirely yours.

## Known gaps and follow-ups

- **`moq_products.stock` still exists**, defaulted and unread. Dropping it is a
  separate migration against the live database.
- **No packing-fee waiver on this shelf.** A buyer topping up their commitment
  mid-round pays the ₱200 MOQ fee again. Group buys waive this within a series
  (`lib/campaign-commitment.ts`); the equivalent keyed on product + cycle is not
  implemented. Raised with the client, not yet decided.
- **`moqLineOutcome` is not yet rendered** on the customer's order pages, and
  `orderItems.moqCycleNo` is written but never read outside tests. The migration
  and schema comments PROMISE that a line in a filled cycle keeps reading
  "Processing" — that promise is not kept on any surface yet. Either wire it into
  the order views or soften the comments; the column is load-bearing for the
  release/edit guards either way.
- **The backfill may give existing rows a meaningless target.** It seeds `moq`
  from `min_order_qty`, which is 1 on most rows, so those listings read "target
  reached" after a single unit. The old `stock` value is the column that actually
  expressed intended volume. Decide per-row before deploying.
- **An unverified order can declare a buy filled.** With no ceiling, one
  `proof_review` order with no confirmed payment can commit 9,999 units and push
  a target to `reached` — the signal an admin acts on to place a real supplier
  order. Overshooting is by design; unverified orders counting toward the
  threshold is a separate, undecided question.
- **No automatic rollover** when a target is reached — deliberate (see Phase 6).
- **`min_order_qty` is dormant**, reset to 1 by the migration and absent from the
  form. Still enforced server-side if an admin sets it directly.

## Deploy note

`0025_moq_product_targets.sql` must be applied before this ships:
`npm run db:check` reports the drift, `npm run db:push` applies it. The backfill
rewrites `min_order_qty` on existing rows — check the shelf's targets afterwards.

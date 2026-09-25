# Filled kahati kit dropped from cart + "Packing fee due now" mislabel — TDD evidence

**Source plan:** none — journeys derived from two customer reports on 2026-09-25.

## What happened (prod, 2026-09-25)

A customer sent one ₱3,986.30 transfer for a mixed cart, then reported that
T30 SF "disappeared", and that the cartridge, pharmabac and pen needle went
with it. The prod orders show:

| Order | Placed (Manila) | Contents | Total |
|---|---|---|---|
| BBG-3074 | 11:31:54 | Pen Cartridge ×10, Pharmagrade BACWATER ×10, Pen Needle 8mm ×1 (on-hand) | ₱1,280.00 |
| KH-3075 | 11:31:54 | Tirzepatide SF 15mg ×2, PT141 10mg ×1 (kahati) | ₱1,431.30 |
| KH-3076 | 11:47:20 | Tirzepatide SF 30mg ×2 (kahati, re-ordered) | ₱1,275.00 |

The three totals add up to exactly ₱3,986.30. The on-hand items were never
lost: they were split into their own order, BBG-3074. T30 SF was the only line
checkout actually dropped. The cart held it on counter `e62e5125`, which had
filled 10/10 and been sealed `closed`. Its successor `97acf55c` was open at the
time. `checkKahati` treated the sealed counter as dead and returned a 400
`unavailable`. The client then removed the line and kept the proof attached, so
the next Place went through without T30. MOQ batches already roll forward to
their open successor (`resolveOpenBatch`). Kahati counters did not.

A second report showed the checkout summary reading **"Packing fee due now
₱14,851"**: ₱14,551 of non-hatian goods plus one ₱300 fee, all labelled as a
packing fee.

## User journeys

1. As a customer whose kahati kit filled while it sat in my cart, I want
   checkout to place my vials in the next open kit for that product, so that I
   am not charged for vials that no order holds.
2. As a customer with a mixed cart, I want the amount due now labelled as what
   it is, so that I don't read my goods as a packing fee.

## Test specification

| # | What is guaranteed | Test | Type | RED | GREEN |
|---|---|---|---|---|---|
| 1 | Preflight does not flag a sealed counter whose product has an open successor | `lib/checkout-preflight.test.ts` › passes a sealed counter whose product has an open successor | integration (pglite) | FAIL: `expected [ {…} ] to deeply equal []` | PASS |
| 2 | A sealed counter with no open successor is still flagged | same file › still flags a sealed counter whose product has no open successor | integration | PASS (guard) | PASS |
| 3 | A cancelled counter does not roll, even with an open sibling | same file › still flags a cancelled counter… | integration | PASS (guard) | PASS |
| 4 | POST /api/orders places the line on the successor: 201, `order_items.group_buy_id` = successor, successor `claimed_slots` +2 | `app/api/orders/unavailable-lines.test.ts` › places the line on the open successor | integration | FAIL: `expected 400 to be 201` | PASS |
| 5 | The rolled line is not listed in `data.unavailable` | same file › does not list it as unavailable | integration | FAIL | PASS |
| 6 | Summary says "Due now", not "Packing fee due now", on a mixed cart under the packing-fee rule | `components/OrderSummary.downpayment.test.tsx` › does not call goods a packing fee on a mixed cart | component | FAIL | PASS |
| 7 | A hatian-only cart still reads "Packing fee due now" | same file › still calls it the packing fee when the fee is all there is | component | PASS (guard) | PASS |
| 8 | Checkout payment card never labels the full-price amount a packing fee | `app/checkout/downpayment.test.tsx` › never labels the full-price amount a packing fee | component | FAIL: multiple "Packing fee due now" | PASS |

RED command: `npx vitest run lib/checkout-preflight.test.ts app/api/orders/unavailable-lines.test.ts components/OrderSummary.downpayment.test.tsx app/checkout/downpayment.test.tsx`.
Result: 5 failed, 45 passed.
GREEN (same command): 4 files, 50/50 passed. `npx tsc --noEmit`: 0 errors.

## Change

- `lib/kahati-server.ts` — `resolveJoinableKahati(db, g)`. A `closed` counter
  with a product link resolves to that product's one `open` counter, if there
  is one. Every other status is returned unchanged.
- `lib/checkout-preflight.ts`, `app/api/orders/route.ts` — both resolve the
  cart's counter through it before any status or price check. The transaction's
  guarded claim UPDATE is unchanged, so oversell protection is the same.
- `components/OrderSummary.tsx`, `app/checkout/page.tsx` — "Packing fee due
  now" is used only when `dueOnOtherModes` is 0.

## Known gaps / follow-ups

- A counter sealed by an admin cycle roll (`rollOpenKahatis`) is also `closed`
  and now rolls forward too. That is intended: the product is still sold. If
  the successor's price differs, the existing `requireQuoteMatches` 409 tells
  the customer and re-prices the cart.
- No data fix was made for KH-3075/KH-3076: the customer re-ordered T30 SF
  herself, and the three orders together match the transfer.
- Full suite (`npx vitest run --maxWorkers=2`): 3593 passed, 23 failed in 9
  files. The **identical 23 fail on untouched `main` (850a1e2)** — verified by
  running those 9 files in a detached worktree at that commit and diffing the
  FAIL lists (identical). They are pre-existing packing-fee / downpayment /
  pasalo expectations (e.g. `route.test.ts` expects 6450, gets 780), not
  regressions from this change. Coverage run not executed.

## Commits

- `9c2e962` test: RED reproducer
- `1ecbd19` fix: GREEN

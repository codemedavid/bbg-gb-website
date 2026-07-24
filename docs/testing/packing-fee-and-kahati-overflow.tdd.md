# TDD Evidence — Per-placement packing fee + Kahati overflow roll-over

**Date:** 2026-07-24
**Branch:** `feat/client-changes-jul21`
**Source plan:** derived inline from the `/plan` output for the client request below (no `.plan.md` artifact). Email integration was explicitly **removed from scope** by the user.

## Client request (verbatim, Taglish)

> "Kasi bawat placement ng client sa ibat ibang peps magbabayad sila ng packing fee. Pwede po natin e-edit? Sa cart na magdagdag ng packing fee?
> Sa kahati naman po, pag napuno ang 10 vials dapat mag-reset ulit sa panibago. Pag sumubra na sa 10 vials, na-stock na sya sa 10."

Decisions confirmed with the user: **packing fee per placement across all modes**; **roll kahati overflow into a fresh batch**; **email out of scope**.

## User journeys

1. As a customer joining two different hatians (peps), I want each placement to carry its own packing fee, so the cart total reflects the real per-batch packing/shipping cost.
2. As a customer committing more vials than are currently open in a hatian, I want the counter to fill to 10 (reset/open a fresh batch) and the remainder to roll into that new batch, so my order is never rejected and the counter never shows more than 10.
3. As that same customer, I want the overflow (which lands in two counters internally) to still cost me **one** packing fee, because I made one placement.

## Task report

### Task 1 — Per-placement packing fee (pure core)
- Summary: `packingFeeFor` now sums one fee per distinct placement (per listing), deduping overflow fragments that share a `placementKey`, instead of one max fee per mode.
- Command: `npx vitest run lib/pricing.test.ts`
- RED: `expected 220 to be 370` and `expected 150 to be 300` (two same-mode kahati listings summed).
- GREEN: `Tests 60 passed (60)`.
- Guarantee: two different hatians / MOQ products / on-hand products each add their own packing fee; a shared `placementKey` collapses to one.

### Task 2 — Cart summary mirrors the server
- Summary: client `lib/store/cart.ts` `packingFeeFor` sums per line (each cart line is one placement).
- Command: `npx vitest run lib/store/cart.test.ts`
- RED: `expected 210 to be 330` (two kahati placements).
- GREEN: `Tests 20 passed (20)`.
- Guarantee: the cart/checkout summary shows the same per-placement total the server charges.

### Task 3 — `closeFullKahati` returns the opened sibling
- Summary: returns `{ sealed, opened }` so checkout can claim overflow into the fresh sibling; admin caller updated to use `.sealed`.
- Command: `npx vitest run lib/kahati-server.test.ts` (+ admin lifecycle, orders route)
- RED: `expected undefined to match object` on `result.sealed`.
- GREEN: `Tests 58 passed (58)` across the three suites.

### Task 4 — Checkout overflow roll-over
- Summary: the orders-route kahati branch loops the guarded claim across counters — fills the current counter (which closes it and auto-opens a sibling) and rolls the remainder into the sibling; emits one order line per counter with a shared `placementKey`; validates the per-person minimum against the whole commit and caps a single commitment at one kit.
- Command: `npx vitest run app/api/orders`
- RED: `app/api/orders/kahati-overflow.test.ts` — overflow returned `400` (`expected 400 to be 201`).
- GREEN: `Tests 69 passed (69)`. The prior "reject the loser" concurrency test was rewritten to the new spec (overflow rolls; invariant preserved: no counter exceeds its cap).
- Guarantee: a commitment larger than the open vials fills to 10, opens a sibling, and places the rest there; the split is two order lines (so cancellations refund the right counter) but exactly one packing fee.

### Task 5 — UI allows over-commit
- Summary: `JoinSheet` clamps to the kit cap (`totalSlots`) not the counter's remainder, passes that cap to the cart, and adds accessible labels to the qty steppers.
- Command: `npx vitest run components/JoinSheet.test.tsx`
- RED: `stock` expected `totalSlots`; commit-past-open expected qty `10`.
- GREEN: `Tests 6 passed (6)`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Two same-mode placements each pay their own packing fee (150+220=370) | `lib/pricing.test.ts:sums a packing fee per placement` | unit | PASS |
| 2 | Two distinct kahati placements = 2 hatian fees | `lib/pricing.test.ts:charges two hatian fees` | unit | PASS |
| 3 | Overflow fragments sharing a placementKey = one fee | `lib/pricing.test.ts:counts overflow fragments…as one fee` | unit | PASS |
| 4 | Cart summary sums a fee per kahati placement (330) | `lib/store/cart.test.ts:sums a fee per kahati placement` | unit | PASS |
| 5 | `closeFullKahati` returns sealed counter + fresh open sibling | `lib/kahati-server.test.ts:seals the full counter and hands back…sibling` | integration | PASS |
| 6 | Over-commit fills current to 10, closes it, rolls remainder into a sibling | `app/api/orders/kahati-overflow.test.ts:fills the current counter…rolls the overflow` | integration | PASS |
| 7 | Overflow = two order lines, one packing fee, correct totals | `app/api/orders/kahati-overflow.test.ts:records the split as two order lines but charges a single packing fee` | integration | PASS |
| 8 | Normal within-capacity commit stays a single line | `app/api/orders/kahati-overflow.test.ts:still places a normal within-capacity commitment` | integration | PASS |
| 9 | No counter is pushed past its cap under concurrent commits | `app/api/orders/route.test.ts:caps a counter at its slot limit and rolls overflow` | integration | PASS |
| 10 | Customer may commit past the open vials, capped at one kit | `components/JoinSheet.test.tsx:lets the customer commit more than the vials currently open` | component | PASS |

## Coverage (changed modules)

`npx vitest run --coverage …` — `lib/pricing.ts` 100% lines, `components/JoinSheet.tsx` 100%, `lib/kahati-server.ts` 97.6%, `lib/store/cart.ts` 80.6% (uncovered lines are pre-existing unrelated helpers). Full suite: **618 passed (618)**.

## Known gaps / follow-ups

- **On-hand multi-fee:** per the "all modes" decision, a cart with two distinct on-hand products now charges two on-hand packing fees. If the client only meant kahati/peps, restrict `packingFeeFor` to non-`product` kinds — trivially reversible.
- **Below-minimum join:** if a counter's remaining vials are below its per-person minimum, `JoinSheet` still blocks joining (conservative). Overflow could technically let such a customer meet the minimum via a sibling; left as a follow-up.
- **Live browser QA** on the local PGlite environment (`DATABASE_URL= STORAGE_DRIVER=local`) is recommended before shipping to visually confirm the cart total and the over-commit → roll-over flow.

## Merge evidence (RED → GREEN)

Commits on `feat/client-changes-jul21`:
1. `feat: charge one packing fee per placement, not per mode` — RED (pricing 220→370, cart 210→330) → GREEN.
2. `feat: roll kahati overflow into a fresh batch instead of rejecting it` — RED (overflow 400) → GREEN (orders 69).
3. `feat: let a kahati join exceed the open vials, capped at one kit` — RED (JoinSheet stock/qty) → GREEN (6).

---

# ADDENDUM — Packing fee reverted to one per checkout parcel (per mode)

**Date:** 2026-07-24 (later session)
**Branch:** `main`
**Supersedes:** Task 1 and Task 2 above. The per-placement model is **reversed**.

## Client request (verbatim)

> "Can we fix the packing fee? Because supposedly its per checkout not per product so we only get to pay packing fee for every checkout of the customer allow them to buy different vial from other products and only get packing fee per checkout."

**Decision confirmed with the user (AskUserQuestion):** *one fee per parcel/mode.* The
checkout already splits into one order per fulfillment mode (on-hand ships now, a
kahati waits for its batch — separate parcels), so the fee is charged **once per mode
present**, never once per product. A single-mode checkout is therefore literally one
fee. When two listings within one mode carry different admin-set fees, the **largest**
applies (the parcel costs at least its priciest item to pack) — noted to the user as
the chosen default.

## Revised user journeys

1. As a customer buying several different on-hand vials/products in one checkout, I want to pay **one** packing fee, because they ship together as one parcel.
2. As a customer whose cart mixes modes (on-hand + kahati), I want one fee per mode, because each mode ships as its own parcel with its own lifecycle.
3. As a customer whose kahati commitment overflows into two counters, I still pay one packing fee — same mode, one parcel.

## Task report

### Task A — `packingFeeFor` charges one fee per mode (pure core)
- Summary: `lib/pricing.ts` `packingFeeFor` groups items by fulfillment mode and charges one fee per mode — the largest per-listing fee within that mode — then sums across modes. `placementKey` machinery removed (per-mode grouping subsumes it).
- Command: `npx vitest run lib/pricing.test.ts`
- RED: `expected 370 to be 220`, `expected 300 to be 150` (per-placement code still summed).
- GREEN: `Tests 60 passed (60)`.
- Guarantee: several placements in one mode = one fee (the largest); distinct modes each add one fee; overflow fragments (same mode) = one fee.

### Task B — Cart summary mirrors the server
- Summary: `lib/store/cart.ts` `packingFeeFor` groups by mode (largest fee wins), matching the server.
- Command: `npx vitest run lib/store/cart.test.ts`
- RED: `expected 330 to be 210` (two kahati placements summed).
- GREEN: `Tests 20 passed (20)`.
- Guarantee: the cart/checkout summary shows the same one-fee-per-mode total the server charges.

### Task C — No regression in the overflow / orders path
- Summary: `placementKey` dropped from `PriceableItem` and the orders route; kahati overflow still charges one fee because both fragments are the same mode.
- Command: `npx vitest run app/api/orders`; `npx tsc --noEmit`
- GREEN: `Tests 69 passed (69)`; typecheck exit 0. `kahati-overflow.test.ts` (one fee for a split commitment) unchanged and still PASS.

## Revised test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| A1 | Several placements in one mode = one fee, the largest (150 & 220 → 220) | `lib/pricing.test.ts:charges one fee per mode even with several placements` | unit | PASS |
| A2 | Two distinct kahati placements = one hatian fee | `lib/pricing.test.ts:charges a single hatian fee for two distinct kahati placements` | unit | PASS |
| A3 | Overflow fragments (same mode) = one fee | `lib/pricing.test.ts:charges one fee for overflow fragments` | unit | PASS |
| A4 | Mixed cart sums one fee per mode present (200+150=350) | `lib/pricing.test.ts:sums one packing fee per fulfillment mode present` | unit | PASS |
| B1 | Cart summary charges one hatian fee for two placements, largest wins (210) | `lib/store/cart.test.ts:charges one hatian fee for two kahati placements` | unit | PASS |
| C1 | Overflow split = two order lines, one packing fee | `app/api/orders/kahati-overflow.test.ts:records the split as two order lines but charges a single packing fee` | integration | PASS |

## Coverage (changed modules)

`npx vitest run lib/pricing.test.ts lib/store/cart.test.ts --coverage` — `lib/pricing.ts` **100% lines / 98.41% branch**, `lib/store/cart.ts` **83.09% lines** (uncovered lines are pre-existing cart mutation helpers, not the fee logic). Full suite: **618 passed (618)**. Typecheck: exit 0.

## Follow-up resolved

- The prior report's "On-hand multi-fee" known gap is **resolved**: a cart with two distinct on-hand products now charges one on-hand fee, per the client's per-checkout intent.

## Open decision for the client

- Within one mode, listings with **different** admin-set fees collapse to the **largest**. If the client instead wants the flat mode default (ignoring per-listing overrides when combined) or the smallest, it's a one-line change in both `packingFeeFor` copies.

## Merge evidence (RED → GREEN), branch `main`

1. `test: packing fee is one-per-mode, not per placement (RED)` — 4 tests RED for the intended reason.
2. `feat: charge one packing fee per checkout parcel, not per placement` — GREEN, full suite 618 pass, tsc clean.

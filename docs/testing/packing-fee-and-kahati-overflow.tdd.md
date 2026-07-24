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

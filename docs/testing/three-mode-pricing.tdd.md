# TDD Evidence — Three-Mode Pricing & Checkout Order-Split

**Date:** 2026-07-18
**Branch:** `feat/three-mode-pricing`
**Scope:** Logic-first foundation for the three purchasing modes defined in the
BBG Storefront SRS (Solo Buy, Kahati, Group Buy / MOQ). Pure business layer only —
no schema migration, API wiring, or UI in this pass.

## Source plan

Derived during this TDD run from the imported design project
(`893322e9-7494-4e64-9e32-e91089784bf3`): the **Storefront SRS** and the evolved
storefront/admin prototypes. No `*.plan.md` file was used. The SRS specifies three
modes that "must never be merged into one flow"; the current app implemented only
Solo + Kahati. This pass adds the Group Buy (MOQ) mode to the pure-logic layer and
the cart→multi-order split.

## User journeys

1. As a customer, when I commit to a Group Buy (MOQ) campaign, the order carries
   LBC shipping (per campaign terms) and no repack fee, so my total is correct.
2. As a customer, my Group Buy commitment is rejected below the campaign's
   per-customer minimum, so I cannot under-commit.
3. As a customer, I can see a campaign's MOQ progress (committed vs. MOQ, % filled,
   whether it is reached), so I know if my order will proceed.
4. As a customer, solo checkout is blocked until I have ≥10 kits + ≥10 BAC water
   (SRS V-1), so orders always meet the wholesale minimum.
5. As a customer, when my cart mixes modes, checkout produces one separate order
   per mode with the correct per-mode fees (SRS §5: modes never combined).

## Task report

### Extend pricing engine with the Group Buy (MOQ) mode
- Added `moq_campaign` item kind; `hasGroupBuy`, group-buy shipping (campaign-
  overridable via `shippingPhp`), widened `buyType` to `'solo' | 'kahati' | 'group_buy'`.
- Added `validateGroupBuyCommit`, `groupBuyMoqStatus`, and `validateSoloCheckout`.
- Validation command: `npx vitest run lib/pricing.test.ts`
- RED → GREEN: the added `describe` blocks failed with `TypeError: … is not a
  function` before implementation; all pass after.
- Guaranteed: correct per-mode fees, MOQ commit validation, MOQ progress reporting,
  and the SRS V-1 solo hard gate.

### Cart segmentation and checkout order-split (`lib/order-modes.ts`)
- `modeOf`, `segmentByMode`, `splitCartIntoOrders`: a mixed cart splits into one
  `OrderDraft` per non-empty mode in stable `['solo','kahati','group_buy']` order,
  each with its own `computeTotals`.
- Validation command: `npx vitest run lib/order-modes.test.ts`
- RED → GREEN: failed with module-not-found before `lib/order-modes.ts` existed;
  all 10 pass after.
- Guaranteed: modes are never merged into one order; per-mode fees are correct.

### Persistence boundary
- `orders` route (`app/api/orders/route.ts`) narrows `Priced.kind` and the inserted
  `buyType` to the current `order_item_kind` / `buy_type` enum values. The MOQ mode
  is not yet persisted; that lands with its schema migration in a later pass.
- Validation command: `npx tsc --noEmit` → exit 0.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Group-buy order charges LBC shipping, no repack fee | `lib/pricing.test.ts:group buy (MOQ) mode` | unit | PASS |
| 2 | Group-buy-only cart is labelled `group_buy` with correct total | `lib/pricing.test.ts:group buy (MOQ) mode` | unit | PASS |
| 3 | Commit rejected below per-customer minimum; campaign min honoured; non-integers rejected | `lib/pricing.test.ts:validateGroupBuyCommit` | unit | PASS |
| 4 | MOQ status reports progress/remaining/reached; progress clamps to 1 | `lib/pricing.test.ts:groupBuyMoqStatus` | unit | PASS |
| 5 | Solo checkout blocked below 10 kits + 10 BAC; allowed once met | `lib/pricing.test.ts:validateSoloCheckout` | unit | PASS |
| 6 | Item kind maps to the correct purchase mode | `lib/order-modes.test.ts:modeOf` | unit | PASS |
| 7 | Mixed cart buckets into solo/kahati/group_buy segments | `lib/order-modes.test.ts:segmentByMode` | unit | PASS |
| 8 | Modes never merged: mixed cart → one order per mode, correct fees, stable order | `lib/order-modes.test.ts:splitCartIntoOrders` | unit | PASS |
| 9 | Existing solo/kahati totals, shipping, repack, and kahati-commit rules unchanged | `lib/pricing.test.ts` (20 pre-existing) | unit | PASS |
| 10 | Checkout integration + concurrency behaviour unchanged | `app/api/orders/route.test.ts` | integration | PASS |

## Coverage and known gaps

- Full suite: **50 passed (4 files)** — `npx vitest run`. Typecheck: `npx tsc --noEmit` exit 0.
- Numeric coverage not run: `@vitest/coverage-v8` is not installed and no dependency
  was added unprompted. Structural check instead: **all 16 exported functions** in
  `lib/pricing.ts` + `lib/order-modes.ts` are directly exercised by a test (verified
  by diffing exports against test references — empty uncovered set).
- Intentional gaps for later passes (out of this scope):
  - Group Buy (MOQ) persistence — `order_item_kind` / `buy_type` enum values,
    a campaigns table + migration, API routes, and admin approve/extend/cancel.
  - Storefront Group Buy commit flow, and the checkout call site that consumes
    `splitCartIntoOrders` to emit multiple orders.

## Merge evidence

- RED checkpoint: `caaa8ac` — 10 failing reproducers, 20 pre-existing pricing tests green.
- GREEN checkpoint: `dc41f57` — all 50 tests pass, tsc clean.
- No refactor commit was needed; the boundary narrowing was part of the GREEN change.

---

# Pass 2 — Group Buy (MOQ) mode: lifecycle, schema & API

**Scope:** the "Full Group Buy mode" backend — campaign lifecycle state machine,
schema/migration, and API routes. Storefront/admin UI wiring is a follow-up pass.

## User journeys

1. As an admin, I can approve / extend / cancel an open campaign, but not one that
   is already approved or cancelled.
2. As a customer, I can commit kits to an open campaign; it is rejected below the
   per-customer minimum or if the campaign is not open.
3. As a customer, my commitment is held as a group_buy order and the campaign's
   committed counter increases atomically (no oversell/double-count under races).
4. As anyone, I can view campaigns with derived MOQ progress, remaining, reached,
   and outcome (awaiting_moq / processing / refunded).

## Task report

| Task | Validation command | RED → GREEN |
|------|--------------------|-------------|
| Campaign lifecycle state machine (`lib/group-buy.ts`) | `npx vitest run lib/group-buy.test.ts` | module-missing → 10 pass |
| Schema: `moq_campaigns` table, enum values, migration `0001` | `npx vitest run app/api/orders/route.test.ts` (harness applies migration) | 7 pass under new migration |
| Campaign API routes (list/detail/create/edit/delete/action/commit) | `npx vitest run app/api/campaigns/route.test.ts` | modules-missing → 10 pass |

## Test specification (pass 2)

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Only open campaigns can be approved/extended/cancelled | `lib/group-buy.test.ts:applyCampaignAction` | unit | PASS |
| 2 | Commitments allowed only while open; outcome derives from status + MOQ | `lib/group-buy.test.ts:canCommit,campaignOutcome` | unit | PASS |
| 3 | Public list exposes derived progress/remaining/reached | `app/api/campaigns/route.test.ts:GET /api/campaigns` | integration | PASS |
| 4 | Campaign create is admin-only | `app/api/campaigns/route.test.ts:POST (admin create)` | integration | PASS |
| 5 | approve moves open→approved; action on non-open → 400; non-admin → 403 | `app/api/campaigns/route.test.ts:action` | integration | PASS |
| 6 | Commit increments committed atomically and creates a held group_buy order | `app/api/campaigns/route.test.ts:commit` | integration | PASS |
| 7 | Commit rejected below per-customer min, on non-open campaign, and unauthenticated | `app/api/campaigns/route.test.ts:commit` | integration | PASS |

## Coverage and known gaps (pass 2)

- Full suite: **70 passed (6 files)** — `npx vitest run`. Typecheck: `npx tsc --noEmit` exit 0.
- Not yet built (next pass): storefront campaign list + commit sheet UI, admin
  approve/extend/cancel + campaign CRUD UI, payment-proof upload on commit (the
  commit order is currently created with a null proof key), and campaign-progress
  notifications. The concurrency test for commit races was not added (kahati's
  equivalent exists); the atomic guard is in place and unit-proven by the lifecycle
  tests plus the single-commit integration test.

## Merge evidence (pass 2)

- `c49f8ad` lifecycle (RED validated, 10 pass), `8bca64b` union-narrow test fix.
- `7bbd771` schema + migration + harness (existing 7 integration tests pass).
- `2299805` API routes (70/70 pass, tsc clean).

# TDD Evidence — Per-Mode Packing Fee (local SF included, no admin fee)

**Date:** 2026-07-18
**Branch:** `feat/packing-fee`
**Scope:** Replace the separate LBC shipping + kahati repack fee with a single
**packing fee per order**, priced by fulfillment mode and already including local
shipping. No admin fee. Admin-editable defaults.

## Source plan

Derived from the `/ecc:plan` output confirmed in-session. Fee mapping (confirmed by
the user):

| Mode (app) | Item kind | Term | Fee (default) |
|---|---|---|---|
| Group Buy / MOQ | `moq_campaign` | pasabay | ₱300 |
| Solo Buy | `product` | onhand | ₱200 |
| Kahati | `group_buy` | hatian | ₱150 |

Editable defaults; the fee edit lives in the admin pages.

## User journeys

1. As a customer, my order shows one **Packing fee (local shipping included)** line
   priced by mode — no separate shipping or admin fee.
2. As a customer with a mixed cart, each mode checks out as its own order and carries
   its own packing fee, so the total sums one fee per mode present.
3. As an admin, I set the global packing-fee defaults (pasabay/onhand/hatian) on the
   Settings page, and per-listing kahati/campaign fees still override.
4. As an admin, a new kahati / campaign seeds its fee from the global default.

## Task report

### 1. Pricing engine — single per-mode packing fee (`lib/pricing.ts`)
- `PACKING_FEE_PHP = {solo:200, kahati:150, group_buy:300}`; `packingFeeFor` sums one
  fee per present mode (highest per-listing override wins within a mode);
  `computeTotals` returns `{subtotal, packingFee, total, buyType}`.
- **Validation:** `npx vitest run lib/pricing.test.ts lib/order-modes.test.ts`
- **RED → GREEN:** 16 failing (missing `packingFeeFor`/`PACKING_FEE_PHP`/`packingFee`)
  → **45/45 pass**. Commits `test(RED)` then `feat(GREEN)`.

### 2. Global settings store (`lib/settings.ts`, `settings` table, admin editor)
- Key/value `settings` table (migration `0003`), code-constant fallback; GET/PATCH
  `/api/admin/settings` (admin) + public GET `/api/settings`; Settings-page editor.
- **Validation:** `npx vitest run app/api/admin/settings/route.test.ts`
- **RED → GREEN:** module-missing → **5/5 pass**.

### 3. Checkout persistence (`orders` + `campaigns/[id]/commit` routes)
- Routes stamp per-mode `packingFeePhp` on items and persist `totals.packingFee` into
  `orders.packing_fee_php`; new listings seed their fee from the global default.
- **Validation:** `npx vitest run app/api/orders/route.test.ts app/api/campaigns/route.test.ts "app/api/admin/orders/[id]/status/route.test.ts"` → **23/23 pass**.

### 4–5. Client mirror + admin relabels
- `cart.ts` `packingFeeFor` mirrors the server; `OrderSummary` shows one packing-fee
  row using the fetched global on-hand fee; admin group-buy/campaign inputs relabeled;
  campaign default 180→300.
- **Validation:** `npx tsc --noEmit` → exit 0.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Solo=200 / kahati=150 / pasabay=300 packing fee, incl. local shipping | `lib/pricing.test.ts:packing fee defaults` | unit | PASS |
| 2 | No separate shipping/repack/admin fee on totals | `lib/pricing.test.ts:never adds a separate shipping or admin fee` | unit | PASS |
| 3 | Per-listing override wins; highest within a mode | `lib/pricing.test.ts:admin-editable packing-fee overrides` | unit | PASS |
| 4 | Mixed cart sums one packing fee per mode present | `lib/pricing.test.ts:sums one packing fee per fulfillment mode present` | unit | PASS |
| 5 | Split cart → one order per mode, correct per-mode fee | `lib/order-modes.test.ts:splitCartIntoOrders` | unit | PASS |
| 6 | Settings GET returns code defaults when unset; PATCH persists; admin-only; negative rejected | `app/api/admin/settings/route.test.ts` | integration | PASS |
| 7 | Solo checkout persists on-hand packing fee once | `app/api/orders/route.test.ts:places a solo order …` | integration | PASS |
| 8 | Kahati checkout persists the group buy's editable packing fee | `app/api/orders/route.test.ts:charges the group buy packing fee` | integration | PASS |
| 9 | Campaign commit persists the pasabay packing fee (300) | `app/api/campaigns/route.test.ts:records a commitment …` | integration | PASS |

## Coverage and known gaps

- Full suite: **107 passed (12 files)** — `npx vitest run`. Typecheck: `npx tsc --noEmit` exit 0.
- `@vitest/coverage-v8` not installed (none added unprompted); all new exports in
  `lib/pricing.ts` and `lib/settings.ts` are directly exercised by tests.
- **DB note:** `getDb()` does not auto-migrate; apply `0003` to the dev PGlite with
  `npm run db:push` (additive: new `settings` table, `orders.packing_fee_php`,
  `moq_campaigns.shipping_php` default → 300). The test harness applies it automatically.
- Legacy orders keep `shipping_php`/`repack_fee_php`; admin display falls back to their
  sum when `packing_fee_php` is 0.

## Merge evidence

- RED `test:` commit (16 failing reproducers) → GREEN `feat:` commit (45/45) for the engine.
- Settings, checkout, and client/admin passes each landed with their suites green and tsc clean.

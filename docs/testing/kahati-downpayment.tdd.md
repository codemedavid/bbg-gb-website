# TDD Evidence — Kahati (Hatian) Downpayment

**Source plan:** inline `/plan` output in-session (2026-07-18); no `.plan.md` artifact.
**Branch:** `feat/kahati-downpayment`

## Feature

Kahati orders reserve slots with an admin-editable downpayment (default ₱150,
settings key `kahati_downpayment`) paid at checkout and **deducted from the
order total**; the balance is collected after the kahati ends. Packing fees are
unchanged (₱300 pasabay / ₱200 on-hand / ₱150 hatian, local SF included, no
admin fee). Rationale: filter out joy-buyers who commit slots and never pay.

## User journeys

1. As a customer with kahati items, I check out by paying only the downpayment
   now (proof uploaded for that amount) and see the balance I owe later.
2. As a customer, I see downpayment paid + remaining balance in My Orders.
3. As the admin, I change the downpayment in Admin → Settings and new orders use it.
4. As the admin, I see downpayment paid + balance to collect on each kahati order.

## RED → GREEN

- **RED** commit `60b8efd` — `test: add failing specs for kahati downpayment (RED)`.
  Ran `npx vitest run` on the four touched test files: **13 failed / 50 passed**.
  Failures were the intended ones (missing `splitKahatiDownpayment`, missing
  `kahatiDownpayment` in settings responses, missing `orders.downpayment_php`).
- **GREEN** commit `a74c0c3` — backend implementation. Full suite: **121/121 passed**.
- UI commit `1cee001` — storefront + admin UI. Full suite re-run: **121/121 passed**,
  `npx tsc --noEmit` clean.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Total splits into ₱150 default downpayment + balance | `lib/pricing.test.ts` › kahati downpayment split | unit | PASS |
| 2 | Admin-set amount honoured; clamped to [0, total]; centavo rounding | `lib/pricing.test.ts` (4 cases) | unit | PASS |
| 3 | GET /api/admin/settings returns default 150 when unset | `app/api/admin/settings/route.test.ts` | integration | PASS |
| 4 | PATCH persists a new downpayment; packing-fee-only patch leaves it alone | same file | integration | PASS |
| 5 | Negative downpayment rejected with 400 | same file | integration | PASS |
| 6 | Public /api/settings exposes packing fees + downpayment without auth | `app/api/settings/route.test.ts` | integration | PASS |
| 7 | Kahati checkout snapshots downpayment_php = 150 by default; total unchanged | `app/api/orders/route.test.ts` | integration | PASS |
| 8 | Admin-set `kahati_downpayment` setting used at checkout | same file | integration | PASS |
| 9 | Downpayment capped at order total (₱70 order → ₱70 downpayment) | same file | integration | PASS |
| 10 | Solo orders record zero downpayment | same file | integration | PASS |

Evidence command: `npx vitest run` → `Test Files 13 passed (13) · Tests 121 passed (121)`.

## Coverage

`npx vitest run --coverage` (v8, installed as devDependency this session):
feature-touched logic is fully covered — `lib/pricing.ts` 100% stmts,
`lib/settings.ts` 100%, admin + public settings routes 100%, orders route
exercised by 13 checkout tests. Repo-wide line coverage is ~22% because React
pages/components have no test harness in this repo (pre-existing gap, applies
to all prior features; UI here follows the same convention and was verified by
typecheck + full-suite regression).

## Known gaps / follow-ups

- Success page does not show the downpayment split (it has no order data
  client-side); checkout, order history, and email carry the information.
- Live Supabase DB must run `scripts/supabase-migrate-downpayment.sql`
  (adds `orders.downpayment_php`) before deploying this branch.
- Mixed solo+kahati carts check out as one order whose whole total is subject
  to the single downpayment — mirrors existing single-order checkout behavior.

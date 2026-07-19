# TDD evidence — client feedback fixes (2026-07-19)

**Branch:** `feat/kahati-downpayment`
**Source plan:** none — journeys derived from the client's six-item feedback list during this TDD run.
**Checkpoints:** `26fab4e` (RED) → `3d62e96` (GREEN) → `f31d80f` (extra guard).

Baseline before any change: **17 test files, 171 tests passing.**
After: **21 test files, 215 tests passing.** `tsc --noEmit` clean, `next build` compiled successfully.

---

## User journeys

1. As an admin, I want to add a payment method with a QR image so customers can pay at checkout.
2. As a customer, I want my cart emptied after a successful order so I don't re-buy the same items.
3. As a customer on the checkout page, I want a Home button so the page isn't a dead end.
4. As a customer on the Kahati board, I want the counter and progress bar to move as other people join.
5. As an admin, I want to change the packing fee and have the new value reach customer totals.
6. As a customer, I want a hatian to start at 0 vials, accept joins up to 10, then close automatically.

---

## Root causes

| # | Symptom | Actual cause |
|---|---------|--------------|
| 1, 5 | "Error adding a payment method" / "cannot upload QR" | `STORAGE_DRIVER` was unset. `lib/env.ts` did `process.env.STORAGE_DRIVER \|\| 'local'`, so the deploy silently selected the **local filesystem** driver, which `fs.writeFile`s into `./uploads`. That path is read-only on serverless hosts, so every upload threw `EROFS` and `handler()` mapped it to a bare 500. Adding a payment method fails for the same reason: the admin form requires a QR on a new method, so the create path always goes through the failing upload. |
| 2 | Items remain in cart after checkout | **Not reproducible — already fixed.** `app/checkout/page.tsx` already calls `clear()` on a successful order. New tests confirm `clear()` empties both in-memory state and persisted storage. Reported as fixed, not re-fixed. |
| 2 | No Home button on Checkout | Genuinely missing. `BackHeader` only rendered a back arrow, and checkout sits outside the bottom nav. |
| 3 | Counter/progress bar not updating | `useGroupBuys` inherited the global query defaults (`staleTime: 30_000`, `refetchOnWindowFocus: false`) with no `refetchInterval`. The board is shared state, so another customer's join was never fetched until a hard reload. Two display bugs compounded it: `progress` divided by `totalSlots` unguarded (`NaN` when 0), and the badge test `remaining <= 10` is always true at a 10-vial cap, so every card read "N VIALS LEFT". |
| 4 | Packing fee hardcoded | Fees were **already** admin-editable (`settings` table + `/api/admin/settings` + Settings page). The real defect: `lib/store/cart.ts:packingFeeFor` accepted only `onHandFee`, so the kahati leg fell back to the `PACKING_FEE_PHP` constant and an edited Hatian fee never reached the cart. (The "₱350" the client saw is `solo 200 + kahati 150` — one fee per mode in a mixed cart.) |
| 6 | Hatian logic | Default 0 vials and auto-close/auto-reopen at the cap were **already** correct and tested. Two real gaps: `groupBuySchema.totalSlots` had no upper bound, so an admin could create a 50-vial hatian; and editing `claimedSlots` up to the cap left `status = 'open'` in the database. |

---

## Changes

- **`lib/storage-driver.ts` (new)** — `resolveStorageDriver` rejects an unknown driver, honours an explicit one, and otherwise auto-detects from present credentials (ImageKit → Supabase → local). `describeDriverProblem` reports local-in-production.
- **`lib/storage.ts`** — `putFile` throws `ApiError(503, …)` naming `STORAGE_DRIVER` instead of letting `EROFS` surface as "Something went wrong."
- **`lib/env.ts`** — storage driver now resolved through the above.
- **`lib/kahati.ts`** — added `kahatiProgressPercent` (clamped, zero-cap safe) and `kahatiBadge`.
- **`lib/queries.ts`** — `useGroupBuys` polls every 15s (`KAHATI_POLL_MS`), refetches on focus and on mount.
- **`lib/store/cart.ts` / `components/OrderSummary.tsx`** — `packingFeeFor(items, fees: PackingFees)` reads admin settings for every mode.
- **`lib/admin-schemas.ts`** — `totalSlots` / `minVials` capped at `KAHATI_MAX_VIALS`; `totalSlots` optional (defaults to 10).
- **`app/api/admin/groupbuys/[id]/route.ts`** — an edit that fills the kit closes the hatian, unless the admin set `status` in the same request.
- **`components/headers.tsx` / `app/checkout/page.tsx`** — `BackHeader` gained `showHome`; checkout opts in.
- **`components/GroupBuyCard.tsx`, `app/admin/groupbuys/page.tsx`, `app/api/groupbuys/route.ts`** — use the shared kahati helpers.
- **`.env.example`** — documents that `STORAGE_DRIVER` is required in production and why.

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | An unknown `STORAGE_DRIVER` is rejected, not downgraded to local | `lib/storage-driver.test.ts` | unit | PASS |
| 2 | An unset driver auto-detects imagekit/supabase from credentials | `lib/storage-driver.test.ts` | unit | PASS |
| 3 | Local storage in production is reported as a problem | `lib/storage-driver.test.ts` | unit | PASS |
| 4 | A misconfigured production upload fails 503 naming `STORAGE_DRIVER` | `lib/storage.test.ts` | integration | PASS |
| 5 | Local uploads still work in development | `lib/storage.test.ts` | integration | PASS |
| 6 | Admin can create a method with a QR and get back a `qrUrl` | `app/api/admin/payment-methods/route.test.ts` (pre-existing) | integration | PASS |
| 7 | Progress is 0 (never NaN) at a zero cap, clamped to 100 above it | `lib/kahati.test.ts` | unit | PASS |
| 8 | A fresh hatian badges "OPEN", not "10 VIALS LEFT" | `lib/kahati.test.ts` | unit | PASS |
| 9 | Badge counts down the last vials and singularises "1 VIAL LEFT" | `lib/kahati.test.ts` | unit | PASS |
| 10 | Cart uses the admin Hatian fee when a listing has no override | `lib/store/cart.test.ts` | unit | PASS |
| 11 | A per-listing kahati fee still beats the admin default | `lib/store/cart.test.ts` | unit | PASS |
| 12 | A mixed cart charges one fee per mode (200 + 150 = 350) | `lib/store/cart.test.ts` | unit | PASS |
| 13 | Checkout clears every line from state and persisted storage | `lib/store/cart.test.ts` | unit | PASS |
| 14 | A new hatian starts at 0 claimed vials, status open | `app/api/admin/groupbuys/route.test.ts` | integration | PASS |
| 15 | A vial cap above 10 is rejected with a message naming the cap | `app/api/admin/groupbuys/route.test.ts` | integration | PASS |
| 16 | An omitted cap defaults to one kit (10) | `app/api/admin/groupbuys/route.test.ts` | integration | PASS |
| 17 | An admin edit that fills the kit closes the hatian in the DB | `app/api/admin/groupbuys/route.test.ts` | integration | PASS |
| 18 | An under-filled hatian stays open | `app/api/admin/groupbuys/route.test.ts` | integration | PASS |
| 19 | Rolling the count back reopens the hatian | `app/api/admin/groupbuys/route.test.ts` | integration | PASS |
| 20 | An explicit admin close is not silently reopened | `app/api/admin/groupbuys/route.test.ts` | integration | PASS |
| 21 | Reaching 10 at checkout closes the hatian and opens a sibling | `app/api/orders/route.test.ts` (pre-existing) | integration | PASS |
| 22 | Concurrent commits never oversell kahati slots | `app/api/orders/route.test.ts` (pre-existing) | integration | PASS |

Commands: `npm test` · `npx vitest run --coverage` · `npx tsc --noEmit` · `npx next build`

---

## Edge cases covered

- Zero vial cap (progress would be `NaN`), negative claimed count, claimed above cap.
- Blank / whitespace / mixed-case `STORAGE_DRIVER` values.
- Both ImageKit and Supabase credentials present simultaneously (ImageKit wins).
- PATCH with no new QR file keeps the stored one (pre-existing test).
- Admin closing a hatian explicitly vs. an edit incidentally filling it.
- Mixed on-hand + kahati cart fee summation; multiple kahati listings (highest fee wins); empty cart.

---

## Coverage and known gaps

`npx vitest run --coverage`: **all files 26.83% lines**, `lib` **51.88%**. Touched logic:
`lib/kahati.ts` 100%, `lib/admin-schemas.ts` 100%, `lib/store/cart.ts` 82.97%, `lib/storage.ts` 28.35%
(the supabase/imagekit branches need live credentials).

**The 80% project-wide target is not met, and this change does not close that gap.** The shortfall is
entirely untested `.tsx` — every page and component reports 0%. `vitest.config.ts` sets
`environment: 'node'` and the repo has no `jsdom` / `@testing-library/react` dependency, so there is
no component-test capability to write against. Adding it is a separate piece of work.

Consequently these are verified by reading, not by an automated test:
- The Home button rendering on `/checkout`.
- `useGroupBuys` actually polling in a browser.
- The admin form's `max={10}` inputs (the API rule behind them *is* tested).

## Required configuration (not code — must be set by the operator)

The QR/payment-method fix is only complete once the deployment sets:

```
STORAGE_DRIVER=imagekit
IMAGEKIT_PUBLIC_KEY=public_xxxxx
IMAGEKIT_PRIVATE_KEY=private_xxxxx
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/your_id
```

Until then production uploads return a 503 that names the missing variable. **No database migration is
required** — `settings`, `payment_methods.qr_key` and the group-buy columns all already exist.

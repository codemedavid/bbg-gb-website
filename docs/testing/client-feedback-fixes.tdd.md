# TDD evidence — client feedback fixes (2026-07-19)

**Branch:** `feat/kahati-downpayment`
**Source plan:** none — journeys derived from the client's six-item feedback list during this TDD run.
**Checkpoints:** `26fab4e` (RED) → `3d62e96` (GREEN) → `f31d80f` (extra guard).

Baseline before any change: **17 test files, 171 tests passing.**
After: **25 test files, 237 tests passing.** `tsc --noEmit` clean, `next build` compiled successfully.

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

## DOM test setup (follow-up)

The three gaps below were originally unverifiable because the repo had no component-test capability.
That has since been added:

- `jsdom`, `@testing-library/react` v16 (React 19 line), `@testing-library/jest-dom`,
  `@testing-library/dom`, `@testing-library/user-event` as devDependencies.
- `vitest.config.ts`: `environmentMatchGlobs` routes `**/*.test.tsx` to jsdom while route/integration
  tests stay on node; `esbuild: { jsx: 'automatic' }` because tsconfig uses `jsx: "preserve"` (Next
  owns the real transform); `setupFiles: ['./lib/test/setup-dom.ts']` registers the jest-dom matchers.

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 23 | Checkout renders a Home link to `/` | `app/checkout/page.test.tsx` | component | PASS |
| 24 | A successful order empties the cart | `app/checkout/page.test.tsx` | component | PASS |
| 25 | A successful order routes to `/success/<orderNo>` | `app/checkout/page.test.tsx` | component | PASS |
| 26 | A **failed** order leaves the cart intact | `app/checkout/page.test.tsx` | component | PASS |
| 27 | `useGroupBuys` refetches on an interval | `lib/queries.test.tsx` | hook | PASS |
| 28 | Polling continues for as long as the board is open | `lib/queries.test.tsx` | hook | PASS |
| 29 | A newer vial count replaces the old one on the next poll | `lib/queries.test.tsx` | hook | PASS |
| 30 | Other queries are **not** turned into pollers | `lib/queries.test.tsx` | hook | PASS |
| 31 | A fresh hatian card badges OPEN, not "10 VIALS LEFT" | `components/GroupBuyCard.test.tsx` | component | PASS |
| 32 | The progress bar width tracks claimed vials, clamped 0–100% | `components/GroupBuyCard.test.tsx` | component | PASS |
| 33 | A zero cap renders 0% width, never `NaN` | `components/GroupBuyCard.test.tsx` | component | PASS |
| 34 | A closed hatian's Join button is disabled | `components/GroupBuyCard.test.tsx` | component | PASS |
| 35 | `BackHeader` hides Home unless `showHome` is set | `components/headers.test.tsx` | component | PASS |

**Mutation-checked.** Each new test was verified to fail against the pre-fix source: removing
`refetchInterval`, restoring the `remaining <= 10` badge threshold, dropping the `showHome` block, and
deleting `clear()` from checkout each produced failures (8 and 2 respectively), and all passed again
once reverted. These are regression tests, not vacuous assertions.

## Coverage and known gaps

`npx vitest run --coverage`: **all files 32.87% lines** (was 26.83% before the DOM setup).
Touched surfaces: `app/checkout` 96.26%, `components/GroupBuyCard.tsx` 100%, `lib/kahati.ts` 100%
(branches 100%), `lib/admin-schemas.ts` 100%, `lib/store/cart.ts` 82.97%, `lib/queries.ts` 58.82%,
`components/headers.tsx` 33.33%, `lib/storage.ts` 28.35%.

**The 80% project-wide target is still not met.** The remaining shortfall is the admin and storefront
pages (`app/admin/**`, `app/(storefront)/**`), which are at 0% — the DOM harness now exists to test
them, but writing those tests was out of scope here. `headers.tsx` and `queries.ts` are partial for
the same reason: only `BackHeader` and `useGroupBuys` (the changed symbols) are covered.

`lib/storage.ts` stays low because the supabase/imagekit upload branches need live credentials; the
driver-selection logic in front of them is fully unit-tested instead.

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

---

# Follow-up — Hatian 7-vial minimum (2026-07-19)

**Requirement.** A hatian only succeeds if it reaches at least 7 vials before closing. 7-10 vials is
"Good to Go" and proceeds normally. Under 7 at expiry it is cancelled, participants are notified, and
nothing is fulfilled.

**Checkpoints:** `<RED>` reproducers → `<GREEN>` implementation.

## What changed and why

The old rule made the **cap** the success condition: `resolveExpiredKahatiStatus` returned `'closed'`
only when `claimedSlots >= totalSlots`, so a hatian expiring at 7-9 vials was wrongly cancelled. That
function also turned out to be **dead code** — `sweepExpiredKahatis` duplicated the rule in raw SQL.
The sweep now calls the pure helper, so there is one source of truth.

- `lib/pricing.ts` — new `KAHATI_MIN_VIABLE_VIALS = 7`.
- `lib/kahati.ts` — `isKahatiViable(claimed)`; `resolveExpiredKahatiStatus(claimed)` drops its unused
  `totalSlots` argument and keys off the minimum; `kahatiBadge` gains `GOOD TO GO` and counts toward
  the minimum (`"2 MORE TO GO"`) rather than the cap.
- `lib/kahati-server.ts` — `sweepExpiredKahatis` returns `{ closed, cancelled, ordersCancelled }` and,
  for each failed hatian, cancels every live participant order, writes a status-history entry naming
  the hatian and its shortfall, returns on-hand vials to stock, and emails each participant.
- `lib/email.ts` — `kahatiCancelledEmail`, stating the refund.
- UI — `GroupBuyCard` shows a minimum marker on the progress bar, a green "Good to go" line once
  viable and an "N more vials" line before that; `JoinSheet` states the refund condition at the point
  of commitment; the Kahati page steps explain the 7-vial rule.

**Decisions taken with the client:** failed hatians auto-cancel participant orders and email them
(rather than leaving it to the admin); a mixed order (hatian + on-hand) is cancelled whole with its
on-hand vials restocked.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 36 | The minimum is 7 and sits below the 10-vial cap | `lib/kahati.test.ts` | unit | PASS |
| 37 | `isKahatiViable` flips at exactly 7 | `lib/kahati.test.ts` | unit | PASS |
| 38 | Expiring at 7 or 9 vials **closes** (was: cancelled) | `lib/kahati.test.ts` | unit | PASS |
| 39 | Expiring at 6 or 0 vials cancels | `lib/kahati.test.ts` | unit | PASS |
| 40 | Badge reads GOOD TO GO at 7-9, FULL at 10 | `lib/kahati.test.ts` | unit | PASS |
| 41 | Badge counts down to the minimum ("2 MORE TO GO") | `lib/kahati.test.ts` | unit | PASS |
| 42 | Sweep closes an expired hatian that met the minimum | `lib/kahati-server.test.ts` | integration | PASS |
| 43 | Sweep cancels one that is a single vial short | `lib/kahati-server.test.ts` | integration | PASS |
| 44 | A future deadline is left untouched | `lib/kahati-server.test.ts` | integration | PASS |
| 45 | Sweep reports which hatians it closed and cancelled | `lib/kahati-server.test.ts` | integration | PASS |
| 46 | Every participant's order is cancelled on failure | `lib/kahati-server.test.ts` | integration | PASS |
| 47 | Status history records the hatian and its shortfall | `lib/kahati-server.test.ts` | integration | PASS |
| 48 | Every participant is emailed (`kahati_cancelled`) | `lib/kahati-server.test.ts` | integration | PASS |
| 49 | On-hand vials in a mixed order return to stock | `lib/kahati-server.test.ts` | integration | PASS |
| 50 | A **successful** hatian leaves its orders alone | `lib/kahati-server.test.ts` | integration | PASS |
| 51 | A repeat sweep does not re-cancel, double-restock or re-email | `lib/kahati-server.test.ts` | integration | PASS |
| 52 | Orders on an unrelated hatian are untouched | `lib/kahati-server.test.ts` | integration | PASS |
| 53 | Line items survive cancellation for the customer's records | `lib/kahati-server.test.ts` | integration | PASS |
| 54 | Card spells out how many vials are still needed | `components/GroupBuyCard.test.tsx` | component | PASS |
| 55 | Card confirms a viable hatian is good to go | `components/GroupBuyCard.test.tsx` | component | PASS |
| 56 | Joining is still allowed after the minimum, up to the cap | `components/GroupBuyCard.test.tsx` | component | PASS |

**Mutation-checked.** Reverting `isKahatiViable` to the 10-vial cap and removing the participant
release produced 14 failures; both passed again once restored.

## Edge cases covered

Exactly 7 (the boundary), 6 (one short), 0 (empty), 9 (viable but unfilled), 10 (full — still closes
early and opens a sibling), repeat sweeps, mixed hatian + on-hand orders, orders already cancelled,
unrelated hatians in the same sweep, and a cap below the minimum (badge falls back to the cap).

## Notes and limits

- **Refunds are recorded, not executed.** There is no payment gateway — payments arrive as uploaded
  proofs — so the flow cancels the order, promises the refund by email and leaves the admin to send
  the money. Any real refund automation would need a payment integration first.
- **The sweep is lazy, not scheduled.** It runs when the board is read (public or admin). A failed
  hatian is therefore cancelled on the next board view, not the instant its deadline passes. A cron
  would make this prompt; that is a separate change.
- **No migration required** — `group_buys.status` already has `cancelled`, and `orders.status` already
  has `cancelled`.

Totals after this change: **26 test files, 260 tests passing.** `tsc --noEmit` clean, `next build` compiles.

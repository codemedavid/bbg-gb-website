# TDD evidence — per-cycle packing fee + weekly Wed→Wed schedule

**Source plan**: inline `/ecc:plan` output in the session of 2026-08-08 (no `.plan.md` artifact).
**Requirement**: client request "Update Packing Fee & Group Buy Schedule".

## Requirements, as resolved with the client

Four readings were ambiguous and were settled before any code was written:

| # | Requirement | Decision |
|---|---|---|
| 1 | ₱150 packing fee | **Hatian only.** Group Buy stays ₱300, solo ₱200, MOQ ₱300. `packing_fee_kahati` was already 150 — no amount change was needed. |
| 2 | Fee added, never deducted | The ₱150 taken at hatian commit **is** the packing fee — client's words: *"downpayment and packing fee is just the same"*. It became an added line: ₱4,000 → total ₱4,150, ₱150 paid now, ₱4,000 balance. |
| 3 | Once per active cycle | One fee per customer per schedule cycle, spanning **both** boards. Solo and MOQ keep their own per-parcel fee. |
| 4 | Wed→Wed, admin-configurable | Weekly recurrence: opening day + time, closing day + time, all Asia/Manila. Same weekday on both ends ⇒ a **full week**. |

## User journeys

1. As an admin, I set an opening day/time and a closing day/time once, and both Group Buy and Hatian open and close together every week without me touching anything.
2. As an admin, I can read back the exact Philippine-time instants my four fields resolve to before I save them.
3. As an admin, I can take both boards dark for the rest of this cycle without disturbing next week's.
4. As a customer, I see the ₱150 packing fee as a separate line **added** to my product total: ₱4,000 + ₱150 = ₱4,150.
5. As a customer who already paid the packing fee this Group Buy/Hatian cycle, I am not charged it again on further orders — on either board.
6. As a customer, my final settlement collects the goods I owe and does not bill the packing fee a second time.

## Task report

### 1. Weekly recurrence engine — `lib/schedule-recurrence.ts`

Pure `(recurrence, instant) → cycle`. Manila conversion is delegated to the single existing `Intl`-based converter in `lib/schedule.ts`; no second timezone conversion was introduced.

- **RED**: `npx vitest run lib/schedule-recurrence.test.ts` → `Error: Cannot find module '@/lib/schedule-recurrence'` (compile-time RED — the intended missing implementation). Commit `c9e4cbd`.
- **GREEN**: same command → `Test Files 1 passed | Tests 29 passed`. Commit `de56f6e`.
- **Guarantees**: Wed→Wed is seven days; a same-weekday close resolves to the next week, never a few hours; opening inclusive, closing exclusive; every half-set or corrupt recurrence reads CLOSED.

**Design defect found by the tests, not by review**: a same-weekday window whose *closing time is later than its opening time* (Wed 09:00 → Wed 18:00) ran past the following Wednesday's opening, so two cycles overlapped and a cycle key had two possible answers. Fixed by clamping a cycle's close to the next opening, with the invariant pinned by its own test (`never lets one cycle overlap the next`).

### 2. Storage, gate, admin API and admin card

- **RED**: `npx vitest run lib/settings-schedule.test.ts` → `Tests 20 failed | 1 passed`.
- **GREEN**: → `Tests 21 passed`. Commit `12dcaa0`.
- **RED**: `npx vitest run app/api/admin/settings/schedule.test.ts` → `12 failed | 2 passed`; **GREEN** → `23 passed` (with `route.test.ts`).
- **RED**: `npx vitest run app/admin/settings/SchedulePanel.test.tsx` → `12 failed | 1 passed`; **GREEN** → `13 passed`. Commit `2441da8`.
- **Guarantees**: one shared set of keys (`schedule_open_day/open_time/close_day/close_time`) — a per-module key would fail the "exactly one set of keys" test; a half-set schedule is a 400, not a 500, and leaves the previous schedule intact; a pause closes this cycle only and a *corrupt* pause is ignored rather than keeping the storefront dark forever.

### 3. Cycle identity on orders — `orders.cycle_key`

- **RED**: `npx vitest run app/api/orders/cycle-key.test.ts` → `4 failed | 1 passed`.
- **GREEN**: → `5 passed`. Commit `f22b72d`.
- Migration `drizzle/0017_order_cycle_key.sql`, hand-written to match this repo's convention (drizzle-kit `generate` cannot run — pre-existing snapshot collision at `0010/0011`). Nullable, so it is safe on a live database and legacy rows keep their behaviour.
- **Guarantees**: gated orders carry the running cycle's opening instant; two orders in one cycle share one key; on-hand orders carry none; a mixed cart stamps only its gated half.

### 4. One packing fee per cycle — `lib/packing-cycle.ts`

- **RED**: `npx vitest run lib/packing-cycle.test.ts` → `Cannot find module '@/lib/packing-cycle'`; **GREEN** → `10 passed`.
- **RED**: `npx vitest run app/api/orders/packing-fee-cycle.test.ts` → `8 failed | 2 passed`; **GREEN** → `10 passed`. Commit `e60f5a3`.
- **Guarantees**: ₱4,000 + ₱150 = ₱4,150 with the fee in its own column; ₱150 paid now and ₱4,000 left to settle (a ₱3,850 balance would mean the fee had been deducted); no second fee for another hatian, for the other board, or for a cart spanning both at once; charged again next cycle; not satisfied by an on-hand order; not shared between customers.

### 5. Settlement cutover — the highest-risk change

`isReadyToSettle` excluded any order carrying a packing fee, as the marker of a pre-deferral legacy order. Under the new rule *every* order carries one, so left untouched this would have silently made **all** hatian orders permanently unsettleable. Three generations of order now meet in this flow and the guard distinguishes them by cycle key as well as fee.

- **RED**: `npx vitest run lib/settlement.test.ts` → `3 failed | 25 passed`; **GREEN** → `28 passed`. Commit `ccadc41`.
- A second instance of the same defect was then caught by the integration suite: `lib/settlement-server.ts` was not passing `cycleKey` into `isReadyToSettle`, so real orders were still excluded. Fixed in `f375ca9`.
- **Guarantees**: an order that paid at checkout is settleable and is charged no second fee; a waived order is too; a genuine legacy order (fee, no cycle) stays out of the flow; a deferred-era order (no fee, no cycle) still has its fee collected at settlement exactly as before.

### 6. Retiring the duplicate ₱150

With the fee collected at commit time, `kahati_downpayment` and `packing_fee_kahati` were the same number stored under two names — a drift hazard and two labels for one payment in the admin UI. `KAHATI_DOWNPAYMENT_PHP`, `splitKahatiDownpayment`, `kahatiDownpaymentDue`, `hasOpenKahatiCommitment`, the settings key and the admin card were removed. Commit `4a6f190`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Wednesday→Wednesday is a seven-day cycle, not a few hours | `lib/schedule-recurrence.test.ts:resolves Wednesday to Wednesday as a seven-day cycle` | unit | PASS |
| 2 | One cycle never overlaps the next, so a cycle key is an identity | `lib/schedule-recurrence.test.ts:never lets one cycle overlap the next` | unit | PASS |
| 3 | The window is Philippine time, not the host clock | `lib/schedule-recurrence.test.ts:is still closed one minute before the Manila opening` | unit | PASS |
| 4 | Every half-set or corrupt schedule closes both boards | `lib/schedule-recurrence.test.ts:cycleAt — failing closed` (11 cases) | unit | PASS |
| 5 | Both boards reopen weekly with no admin action | `lib/settings-schedule.test.ts:reports open again the following week without any admin action` | integration | PASS |
| 6 | Both boards follow one schedule, stored under one set of keys | `lib/settings-schedule.test.ts:persists the schedule under exactly one shared set of keys` | integration | PASS |
| 7 | A pause closes this cycle only; the next opens on schedule | `lib/settings-schedule.test.ts:lets the next cycle open once the pause has elapsed` | integration | PASS |
| 8 | A bad schedule is a 400 and leaves the previous one intact | `app/api/admin/settings/schedule.test.ts:leaves the previous schedule intact when it rejects a new one` | integration | PASS |
| 9 | The admin sees the instants their four fields resolve to | `app/admin/settings/SchedulePanel.test.tsx:shows the instants the recurrence resolves to, in Philippine time` | component | PASS |
| 10 | ₱4,000 + ₱150 = ₱4,150, fee in its own column | `app/api/orders/packing-fee-cycle.test.ts:adds the fee on top of the product total` | integration | PASS |
| 11 | The fee is not deducted — ₱150 now, ₱4,000 still to settle | `app/api/orders/packing-fee-cycle.test.ts:leaves the product total whole — the fee is what is paid now` | integration | PASS |
| 12 | No second fee for another hatian in the same cycle | `app/api/orders/packing-fee-cycle.test.ts:does not charge a second fee for another hatian in the same cycle` | integration | PASS |
| 13 | No second fee across the two boards, either order | `app/api/orders/packing-fee-cycle.test.ts:does not charge again on the other board in the same cycle` | integration | PASS |
| 14 | One fee for a single cart spanning both boards | `app/api/orders/packing-fee-cycle.test.ts:charges one fee for a cart spanning both boards at once` | integration | PASS |
| 15 | The fee is charged again in the next cycle | `app/api/orders/packing-fee-cycle.test.ts:charges the cycle fee again in the next cycle` | integration | PASS |
| 16 | An on-hand order does not satisfy the cycle's fee | `app/api/orders/packing-fee-cycle.test.ts:is not satisfied by an on-hand order` | integration | PASS |
| 17 | A waived order cannot itself waive the next one | `lib/packing-cycle.test.ts:ignores an order that was itself waived` | unit | PASS |
| 18 | A cancelled order is not treated as having paid | `lib/packing-cycle.test.ts:ignores a cancelled order` | unit | PASS |
| 19 | Orders that paid at checkout are still settleable | `lib/settlement.test.ts:settles an order that paid its packing fee at checkout` | unit | PASS |
| 20 | The settlement charges no second packing fee | `lib/settlement.test.ts:charges no second packing fee at settlement` | unit | PASS |
| 21 | Genuine legacy orders stay out of the settlement flow | `lib/settlement.test.ts:still keeps a legacy order out of the flow` | unit | PASS |
| 22 | Deferred-era orders still have their fee collected | `lib/settlement.test.ts:still collects the deferred fee for an order placed before cycles existed` | unit | PASS |
| 23 | The settled goods total is whole — the fee never came out of it | `app/api/settlements/route.test.ts:charges no packing fee for hatians already paid for at checkout` | integration | PASS |
| 24 | Client and server agree on the fee shown vs. charged | `lib/store/cart.test.ts:charges ONE fee for a cart spanning both boards` | unit | PASS |

## Validation actually run

```bash
npx vitest run                 # Test Files 155 passed | Tests 1551 passed
npx vitest run --coverage      # All files 80.5% statements / 86.86% branch
npx tsc --noEmit --pretty false
```

Per-module coverage of the changed surface:

```
packing-cycle.ts |     100 |    92    |   100 |   100
pricing.ts       |     100 |    99.06 |   100 |   100
settings.ts      |     100 |    97.18 |   100 |   100
settlement.ts    |     100 |   100    |   100 |   100
```

## Known gaps and follow-ups

- **`npm run db:check` was not run** — it needs `DATABASE_URL` pointing at the production Supabase. `orders.cycle_key` must exist there before deploy, or every gated checkout 500s. The column is nullable, so applying `drizzle/0017_order_cycle_key.sql` is safe on the live database.
- **No browser QA yet.** The admin card and checkout summary are covered by component tests only; a pass on PGlite + `STORAGE_DRIVER=local` is still worth doing.
- **Concurrent-checkout race.** Two simultaneous checkouts in one cycle can both read "unpaid" and both charge ₱150. This is the same class of race the previous per-series waiver had; the existing idempotency key covers resubmission but not two genuinely distinct carts.
- **The waiver no longer requires the parcel to be open.** The old rule stopped waiving once an order shipped; the cycle rule does not, deliberately — a cycle is a fixed period, and an early shipment is not a reason to charge for the same week twice. Pinned by `charges nothing more even after the first order ships`.
- **`drizzle-kit generate` is unusable** in this repo (`0010/0011` snapshot collision, pre-existing). Migration 0017 was hand-written and registered in `_journal.json`, matching the convention of 0011–0016.

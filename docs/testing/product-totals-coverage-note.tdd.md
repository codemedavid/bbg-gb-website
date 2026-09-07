# Product Totals — the sheet states its own scope

**Date:** 2026-09-07
**Trigger:** client report (Chelle, 10:42 Manila) — "ang total dito sa report 3.1 …
tapos bilanganin ko yun close na, 8.2 pala"
**Source plan:** none. Journeys were derived during this TDD run from the client
message and from production data.

## The finding

Both numbers were right; they measure different things.

| Figure | What it counts | Value |
|---|---|---|
| Report `Kits` for Tirzepatide (Salt Form) 30mg | live kahati vials ordered **Aug 30 – Sep 5** (Manila) | 31 vials = **3.1** |
| Closed counters on the Hatian board | every counter opened for that product since **Aug 2** | 82 vials = **8.2** |

Verified against production:

- 31 vials x $10.20/vial = **$316.20**, exactly the sheet's Total USD cell.
- The product's 10 counters span Aug 2 → Sep 3. Five of them (52 vials) are the
  August batches already ordered and shipped (Batch 7 and earlier).
- Per week, live vials: Aug 3–9 = 31 (3.1), Aug 10–16 = 12 (1.2),
  Aug 30 – Sep 5 = 31 (3.1).
- Scoped to that one week the board still reads 32 vs the report's 31: order
  KH-2750 was cancelled while counter `7cfda5ca` was already closed, and
  `app/api/admin/orders/[id]/status/route.ts` deliberately leaves a terminal
  counter's historical count alone. It is the only drifting counter in the
  current cycle.

No arithmetic bug. The defect is that the workbook never said which days its
figures covered, the `Kits` column had no total to check, and every download was
named `BBG-Week-<from>.xlsx` whatever range was picked.

## User journeys

1. As the admin placing the supplier order, I want the batch sheet to say which
   days it covers, so I can tell whether a counter on the board belongs to it.
2. As the admin reconciling the sheet, I want a `Kits` total, so the column I
   order from can be checked in one figure.
3. As the admin downloading several ranges into one folder, I want the filename
   to carry the real range, so a one-week sheet is not mistaken for any other.

## Task report

| Task | Validation run | RED | GREEN |
|---|---|---|---|
| `totals.kits`, summed from rows | `npx vitest run lib/report/product-totals.test.ts` | 4 failed — `totals` had no `kits` | 15 passed |
| TOTAL row + coverage note on the sheet | `npx vitest run lib/report/weekly-xlsx.test.ts` | 3 failed — Kits cell `null`, last row still `TOTAL` | 41 passed |
| Filename carries the range | `npx vitest run app/admin/reports/page.test.tsx` | 1 failed — called with 3 args, no end date | 8 passed |

RED evidence (commit `4465352`): `Test Files 3 failed (3) · Tests 8 failed | 56 passed (64)`.
GREEN evidence (commit `2b36939`): `Test Files 18 passed (18) · Tests 224 passed (224)`, `tsc --noEmit` exit 0.

The same pair ran again for the Orders screen's own report button, which drops
the range end the same way (RED `3 failed | 4 passed`, commit `99f213d`; GREEN
`7 passed`, commit `e9dffae`).

Whole suite on the final tree: `npx vitest run` → **273 files, 3000 tests, all
passing**. An earlier run of the same tree failed three `app/api/pasalo/e2e-*`
tests that pass in isolation and passed on re-run; they touch neither the rollup
nor the workbook, and the flake is the known single-writer PGlite contention.


## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `totals.kits` is summed from the rows, not `qty / 10` (36.1, not 6.4, for 31 vials at kit size 10 + 33 pieces at kit size 1) | `lib/report/product-totals.test.ts:sums kits from the rows rather than dividing the vial total by a single kit size` | unit | PASS |
| 2 | The kits total is rounded, so a kit size that does not divide the quantity cannot print float noise | `lib/report/product-totals.test.ts:rounds the kits total instead of carrying float noise into the sheet` | unit | PASS |
| 3 | An empty range still returns `{ usd: 0, qty: 0, kits: 0 }` | `lib/report/product-totals.test.ts:returns an empty rollup when the week has no orders` | unit | PASS |
| 4 | The TOTAL row carries USD, quantity **and** kits | `lib/report/weekly-xlsx.test.ts:closes with a TOTAL row summing USD, quantity and kits` | integration (real .xlsx round-trip) | PASS |
| 5 | The sheet closes with a line naming the covered range, the cancelled-order exclusion and the kit-size rule | `lib/report/weekly-xlsx.test.ts:closes with a line stating the period the figures cover and what is excluded` | integration | PASS |
| 6 | The period is stated even when the range produced no rows | `lib/report/weekly-xlsx.test.ts:states the period even when the range produced no rows` | integration | PASS |
| 7 | Each segment downloads with the selected end date, so the filename carries the real range | `app/admin/reports/page.test.tsx:downloads each half as its own workbook, stamped with the range it covers` | component | PASS |

## Follow-up 1 — dates on every report surface

Client: "so i think its best to have a certain details of dates also for the
reports." RED `9a8150a` (7 failing), GREEN `3786ec7` (497 passing, tsc clean).

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 8 | The order sheet closes with its own coverage line, worded for a sheet that LISTS cancelled orders and only leaves them out of the totals | `weekly-xlsx.test.ts:closes the order sheet with the period it covers` | PASS |
| 9 | The SUMMARY pivot closes with the period the buyers were totalled over | `weekly-xlsx.test.ts:closes with the period the buyers were totalled over` | PASS |
| 10 | A tab claims "Week N" only when the range is exactly that Mon–Sun week; otherwise it names its dates | `weekly-xlsx.test.ts:names the sheet for its dates when the range is not one Mon–Sun week` | PASS |
| 11 | The Batch 6 caption makes the same distinction | `weekly-xlsx.test.ts:drops the week number from the caption when the range is not a single week` | PASS |
| 12 | Each on-screen section leads with its range, and an empty half says "No orders in <range>." | `page.test.tsx:states the covered dates in every section header` | PASS |

## Follow-up 2 — the batch, not a typed range

Prompted by a second client question: "is this report the correct report of qty
for this batch?" It was not, by 8 vials.

The sheet had been pulled with an end date of Sep 6 or later, sweeping in
**KH-2829** (Sep 6, 00:51 Manila) — the first order of the NEXT cycle, carrying
3 vials of Retatrutide (Saltform) 30mg and 5 of BAC Water 3ml. That is the
fingerprint: the sheet reads 11 for Retatrutide (Saltform) 30mg where the batch
holds 8.

| Figure | Value |
|---|---|
| Cycle `2026-08-29` (the batch) | 87 orders, **542** live vials, Aug 30 00:13 → Sep 4 22:33 |
| The downloaded sheet | **550** vials |
| Correct range for it | **Aug 30 → Sep 5** |

No refunded lines exist in either cycle, so nothing else moves the totals.

RED `26d779a`, GREEN `389fb96`.

| # | What is guaranteed | Test | Result |
|---|---|---|---|
| 13 | Orders group into batches by cycle key, newest first | `lib/report/cycles.test.ts:groups orders into batches, newest batch first` | PASS |
| 14 | A batch is dated by its own orders in Manila — 16:30Z on Aug 29 is Aug 30 there, and dating off UTC would open the range a day early into the previous batch | `cycles.test.ts:dates a batch by its own orders, in Manila` | PASS |
| 15 | Every order counts (cancelled included, matching the report header) but only live vials total | `cycles.test.ts:counts every order but totals only the vials still being ordered` | PASS |
| 16 | The endpoint returns each batch with its span, newest first | `app/api/admin/report/cycles/route.test.ts:lists each batch with the dates its own orders span, newest first` | PASS |
| 17 | Vials count group-buy lines only, not on-hand lines on the same order | `route.test.ts:counts group-buy vials only, not the on-hand items on the same order` | PASS |
| 18 | Picking a batch fills From/To; typing a date drops back to Custom range | `page.test.tsx:fills the range from a batch instead of making the admin type it` | PASS |

Bug caught during implementation: the vial query chained two `.where()` calls,
and drizzle's second call REPLACES the first rather than adding to it — every
on-hand line on a kahati order counted as vials (103 where 4 was right). Test 17
was written against that and now pins the `and()`.

Whole suite after both follow-ups: `npx vitest run` → **276 files, 3030 tests,
all passing**; `tsc --noEmit` exit 0.

## Known gaps

- The Hatian board still lists every counter ever opened with no batch or date
  on the card. Counting closed counters there remains an all-time figure; the
  fix chosen here makes the sheet self-describing instead.
- The batch picker fills a From/To, so it inherits that shape's one blind spot:
  a cycle boundary falls at 22:00, and an order placed between 22:00 and
  midnight shares a calendar date with the batch before it. The preset is dated
  from the batch's own orders, which avoids it in every case seen so far, and
  the label carries the batch's order count so a mismatch against the section
  header is visible. Filtering the report by `cycle_key` outright would remove
  the blind spot entirely.
- The Group Buy supplier workbook (`BBG-ProductTotals`) already carries a
  `# BBG Product Totals - Week N · <range>` caption and was left as is.
- A counter that fills across a range boundary still splits across two sheets,
  which is why kits are fractional. Sizing the batch by closed counters instead
  of by order date was considered and deliberately not taken.

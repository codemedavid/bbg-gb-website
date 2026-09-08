# Pasalo scoped to one batch

**Source plan:** none. Raised by the client during a walkthrough of the refund
feature: *"Baka pwede mo po lagyan ng filter para kung anong date lang nag
umpisa ang GB at nag end, so in this way the Pasalo will only cover a certain
date — baka kasi mapasama ang old data."*

## The defect

Neither Pasalo control was scoped to anything:

- `openPasaloStage` moved **every** counter sitting at `status = 'open'`
- `closePasaloStage` decided **every** counter sitting at `status = 'pasalo'`

A counter left behind by an earlier cycle was therefore pulled into the current
batch, cancelled with it, and its customers' refunds written against a batch
they were never part of. The refund *report* was already scoped correctly (it
filters on `order_item_refunds.created_at`, and one close is one batch) — the
two buttons were the hole.

## Decisions taken

| Question | Answer | Why |
|---|---|---|
| Which date defines the batch? | `opens_at`, falling back to `created_at` | A counter written weeks early for this cycle was *created* in the last one. Judging it by `created_at` alone files it under a batch it never traded in. `opens_at` null means "already on the board" — every pre-scheduling row — and those are exactly the old rows the filter must exclude. |
| What happens to an out-of-range counter on close? | Left in the stage, and **named** | Skipping silently strands a batch in Pasalo that nobody looks for again. The count is returned, shown in the confirm dialog, warned about in the panel, and logged. |
| No range passed? | Unscoped sweep, as before | Keeps every existing caller and all 22 prior Pasalo tests behaving identically. |

## User journeys

1. As an admin, I open Pasalo for this week's batch, so that a counter left over
   from last cycle stays on the Kahati board instead of joining it.
2. As an admin, I close Pasalo for this week's batch, so that only this batch's
   customers are refunded.
3. As an admin, I am told which counters the close left behind, so that a batch
   is never stranded in Pasalo unnoticed.
4. As an admin, a counter scheduled early for this cycle is still counted in it.

## RED

`npx vitest run lib/pasalo.test.ts app/api/admin/groupbuys/pasalo/batch-window.test.ts`

```
Tests  15 failed | 18 passed (33)

× leaves a counter from an earlier cycle on the Kahati board
  → expected { opened: 2, …(3) } to match object { opened: 1, skippedOutOfRange: 1 }
× does not refund a counter left over from an earlier cycle
  → expected { fulfilled: +0, failed: 2, …(6) } to match object { failed: 1, refundsWritten: 1, …(1) }
× marks a Pasalo counter from an earlier cycle as outside the range
  → expected undefined to be true
TypeError: isCounterInBatchWindow is not a function
```

`opened: 2` and `failed: 2` are the defect stated numerically: two counters
swept where one belongs to the range. Checkpoint `a1376b0`.

## GREEN

`npx vitest run` → **279 files, 3059 tests passed**. `npx tsc --noEmit` clean.
Checkpoint `bc3d880`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `opens_at` decides the batch when set; `created_at` when it is not | `lib/pasalo.test.ts:counterStartedAt` | unit | PASS |
| 2 | A counter before, or after, the window is excluded | `lib/pasalo.test.ts:isCounterInBatchWindow` | unit | PASS |
| 3 | The end bound is exclusive, matching `dateRangeBounds` | `lib/pasalo.test.ts:is inclusive of the first instant…` | unit | PASS |
| 4 | No window given includes everything, so an unscoped call is unchanged | `lib/pasalo.test.ts:includes everything when no window…` | unit | PASS |
| 5 | Opening leaves an earlier cycle's counter on the Kahati board | `batch-window.test.ts:leaves a counter from an earlier cycle…` | integration | PASS |
| 6 | A counter scheduled early is judged by `opens_at`, not `created_at` | `batch-window.test.ts:judges a scheduled counter…` | integration | PASS |
| 7 | Closing writes no refund for an earlier cycle's counter, and leaves it in `pasalo` | `batch-window.test.ts:does not refund a counter left over…` | integration | PASS |
| 8 | Both controls report `skippedOutOfRange` | `batch-window.test.ts` (open + close) | integration | PASS |
| 9 | Omitting the range still sweeps and decides the whole board | `batch-window.test.ts:still sweeps…` / `still decides…` | integration | PASS |
| 10 | The board marks an out-of-range Pasalo counter `inWindow: false` | `batch-window.test.ts:marks a Pasalo counter…` | integration | PASS |
| 11 | Every prior Pasalo guarantee still holds | `app/api/admin/groupbuys/pasalo/route.test.ts` (22) | integration | PASS |

## Known gaps

- **The range is only as precise as what the admin picks.** A cycle opens at
  22:00 Manila, so no hand-typed From/To reproduces one exactly — this is why
  the Reports page offers the batch picker, and the same caveat that already
  applies to the supplier refund export applies here.
- **No UI test for the stray-counter warning.** `StrayCounters` is covered
  indirectly by test 10 (the `inWindow` flag it renders from); the panel itself
  has no component test, consistent with the rest of the admin reports UI.
- **Not verified against the production driver.** Tests run on PGlite; the
  filtering is in application code rather than SQL, so no driver-specific
  behaviour is involved.

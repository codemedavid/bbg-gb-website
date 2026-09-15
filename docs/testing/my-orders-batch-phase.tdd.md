# My Orders: which batch is still running (KH-2919)

## Source

No plan file. Reported 2026-09-15 with a phone screenshot: a customer saw
"Kulang pa - N more vials bago tumuloy ang batch" and it was taken for the
Aug 31 batch, which had already finished.

## What prod showed

The notices were **correct**. Every "Kulang pa" row belonged to KH-2919, placed
2026-09-15 10:23 Manila in cycle `2026-09-10T14:30:00.000Z` (Thu Sep 10 22:30 →
Wed Sep 16 12:00 Manila, still trading). Its short counters really were short
(GHK-Cu 50mg 4/7, Tirzepatide 30mg 4/7, SS31 10mg 4/7, NAD+ 500mg 5/7, SS-31
50mg 1/7). The Aug 31 batch (KH-2729) had all four counters closed and read
"Pumasok".

The defect was presentation: a batch's title sat *above* its rows, so the last
rows of the live batch sat directly on top of "Batch ng Aug 31, 2026". Nothing
said which batch was live.

The user chose: each batch in its own panel with its title inside, plus an
Ongoing/Done label.

## User journey

As a customer with orders in two batches, I want to see which batch is still
collecting and when it closes, so a "Kulang pa" line isn't mistaken for a
finished batch.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | The batch of the cycle trading now is `ongoing` | `lib/order-batches.test.ts` › batchPhase › calls the batch of the cycle still trading ongoing | unit | PASS |
| 2 | A batch from an earlier cycle is `done` | › calls a batch from an earlier cycle done | unit | PASS |
| 3 | With no cycle trading (between cycles / paused) every batch is `done` | › calls every batch done while no cycle is trading | unit | PASS |
| 4 | Orders from before cycles have no phase | › gives orders that belong to no batch no phase | unit | PASS |
| 5 | `GET /api/settings` names the current cycle's key and closing instant, from `getCurrentCycle` | `app/api/settings/route.test.ts` › names the cycle still trading and when it closes | integration (PGlite) | PASS |
| 6 | The live batch reads "Ongoing · closes Sep 16, 2026, 12:00 PM" (Manila) | `app/(storefront)/orders/page.test.tsx` › whether each batch is still running › says the batch of the cycle still trading is ongoing | component | PASS |
| 7 | An earlier batch reads "Done", never "Ongoing" | › says a batch from an earlier cycle is done | component | PASS |

## Evidence

Command: `npx vitest run lib/order-batches.test.ts "app/(storefront)/orders/page.test.tsx" app/api/settings/route.test.ts`

- Baseline before any edit: 41 passed.
- RED (`9845903`): 7 failed | 41 passed. `batchPhase is not a function`;
  `Unable to find an element by: [data-testid="batch-phase"]`;
  `expected undefined to deeply equal { …(2) }`.
- GREEN (`6131b36`): 48 passed.
- Refactor: none needed.

Coverage: `lib/order-batches.ts` 100% statements / 100% lines / 91.4% branches
(uncovered branches are in `groupOrdersIntoBatches`, pre-existing).

## Known gaps

- Not checked in a real browser, and no Playwright screenshots at 320–1440.
  Layout is verified only through the component tests.
- The pinned batch header was not built: the page's `SectionHeader` is already
  `sticky top-0` with a height that changes by breakpoint, so a second sticky
  bar would need a measured offset. The enclosing panel resolves the ambiguity
  without it.
- `tsc --noEmit`: 13 errors, all in other sessions' uncommitted files
  (`app/api/groupbuys/route.test.ts`, `lib/kahati.test.ts`,
  `lib/pricing.test.ts`, `lib/product-board-bulk.ts`); none in these changes.
- ESLint was not run: the repo has no flat config for the installed ESLint 10.
- No data change in prod; nothing to backfill.

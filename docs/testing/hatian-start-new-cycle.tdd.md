# Start new cycle — hatian board

**Source plan:** none. Journeys were derived during this TDD run from two
screenshots: `/admin/groupbuys` (the Hatian board, no cycle control) and
`/admin/group-buy/campaigns` (the Campaigns board, which has had one).

**Branch:** `feat/group-buy-page`
**Checkpoints:** `02196b0` (RED) → `c756d4b` (GREEN) → `25df679` (refactor)

A follow-up request added a search box to the same board and to the products
catalog; that cycle is recorded in
[admin-board-search.tdd.md](admin-board-search.tdd.md).

## User journeys

1. As an admin, I want a "Start new cycle" control on the Hatian board, so that I
   can end every counter that has vials on it at once instead of pressing Close
   on each card in turn.
2. As an admin, I want each ended counter to reopen as a fresh sibling at 0/10,
   so that customers keep joining the same hatian in the next cycle — Close on
   its own opens no successor, so the counter simply leaves the board.
3. As an admin, I want counters nobody has joined left alone, so that starting a
   cycle does not record batches that were never ordered or litter the board with
   empty duplicates.
4. As an admin, I want to confirm before ending the whole board, so that a stray
   click on the header cannot end every counter.
5. As an admin, I want the control hidden when nothing is running, so it is never
   a no-op.
6. As an admin, I want customer orders left exactly as they were, so that
   reconciling them stays my decision on the orders screen.

## Task report

### 1. Board-level rollover (`lib/kahati-server.ts`)

`rollOpenKahatis(db)` seals every open counter with `claimedSlots > 0` and opens
its successor; empty ones are counted and left running. The seal-and-succeed body
was extracted out of `closeFullKahati` as `sealKahatiAndOpenSuccessor` so the
cycle path does not call a function whose name claims the counter was full;
`closeFullKahati` stays the fill-driven entry point and no existing call site
changed.

- Command: `npx vitest run lib/kahati-cycle.test.ts`
- RED: `TypeError: rollOpenKahatis is not a function` — 8 failed (8)
- GREEN: 8 passed (8)
- Guarantees: joined counters seal as `closed` with their vial count preserved
  and a 0-vial successor open; empty counters untouched with no successor minted;
  non-open counters ignored; price/cap/minimum/packing fee inherited; the second
  run is a no-op; a below-minimum counter is closed rather than handed to the
  expiry-cancel sweep; the one-open-counter-per-product index still holds.

### 2. Admin endpoint (`app/api/admin/groupbuys/cycle/route.ts`)

`POST /api/admin/groupbuys/cycle`, mirroring `POST /api/campaigns/cycle`. Returns
`rolled`, `skippedEmpty` and a per-counter list so the admin can be told what was
*not* touched.

- Command: `npx vitest run app/api/admin/groupbuys/cycle/route.test.ts`
- RED: suite failed to load — `Failed to load url ./route` (compile-time RED, the
  route did not exist)
- GREEN: 4 passed (4)
- Guarantees: rolls and reports correctly; refuses a customer with 403 and a
  signed-out visitor with 401, writing nothing in either case.

### 3. UI control (`app/admin/groupbuys/page.tsx`, `lib/admin-api.ts`)

`startKahatiCycle` mutation plus a header button guarded on `running.length > 0`,
behind the shared `ConfirmDialog`.

- Command: `npx vitest run app/admin/groupbuys/page.test.tsx`
- RED: 3 failed | 24 passed (27) — no "Start new cycle" control on the board
- GREEN: 27 passed (27)
- Guarantees: confirming fires the mutation once; backing out fires nothing; the
  control is absent when no counter is open; the dialog names the counter count.
- The "hides the control" assertion was mutation-checked: forcing the guard to
  `true` fails it (`1 failed | 26 passed`), so it is not a vacuous pass.

### 4. Refactor

Both headers carried the same inline outlined-button class string. Extracted as
`btnBoardAction` in `components/admin-ui.tsx` and used by both boards.

- Command: `npx vitest run app/admin/groupbuys/page.test.tsx app/admin/group-buy/campaigns/page.test.tsx`
- Result: 45 passed (45)

## Test specification

| # | What is guaranteed | Test file or command | Type | Result |
|---|--------------------|----------------------|------|--------|
| 1 | A counter with vials seals as `closed` and a 0-vial successor opens | `lib/kahati-cycle.test.ts:seals every counter that has vials claimed…` | unit | PASS |
| 2 | A counter nobody joined stays open and mints no successor | `lib/kahati-cycle.test.ts:leaves counters nobody has joined open…` | unit | PASS |
| 3 | Counters that are not open are ignored entirely | `lib/kahati-cycle.test.ts:ignores counters that are not open` | unit | PASS |
| 4 | The successor is the same offer: price, cap, minimum, packing fee | `lib/kahati-cycle.test.ts:carries price, cap, minimum and packing fee…` | unit | PASS |
| 5 | Each counter rolls independently; skipped ones are counted | `lib/kahati-cycle.test.ts:rolls each counter independently…` | unit | PASS |
| 6 | Re-running the control seals nothing (the successors are empty) | `lib/kahati-cycle.test.ts:is a no-op the second time…` | unit | PASS |
| 7 | A below-minimum counter is closed, not cancelled, and the expiry sweep cannot then cancel its orders | `lib/kahati-cycle.test.ts:closes a counter below the viable minimum…` | unit | PASS |
| 8 | A product still has exactly one open counter after the roll | `lib/kahati-cycle.test.ts:keeps one open counter per product…` | unit | PASS |
| 9 | The endpoint ends joined counters and opens successors | `app/api/admin/groupbuys/cycle/route.test.ts:ends every joined counter…` | integration | PASS |
| 10 | The response names the counters deliberately left running | `…route.test.ts:reports the counters it deliberately left running` | integration | PASS |
| 11 | A customer gets 403 and the board is unchanged | `…route.test.ts:refuses a customer` | integration | PASS |
| 12 | A signed-out visitor gets 401 and the board is unchanged | `…route.test.ts:refuses a signed-out visitor` | integration | PASS |
| 13 | Confirming ends the cycle once | `app/admin/groupbuys/page.test.tsx:ends the cycle once the admin confirms` | unit (RTL) | PASS |
| 14 | Backing out leaves the board alone | `…page.test.tsx:leaves the board alone when the admin backs out` | unit (RTL) | PASS |
| 15 | The control is hidden when no counter is open | `…page.test.tsx:hides the control when no counter is open` | unit (RTL) | PASS |
| 16 | The dialog says how many counters are about to end | `…page.test.tsx:says how many counters are about to end` | unit (RTL) | PASS |

## Coverage

```
npx vitest run --coverage --coverage.provider=v8 \
  --coverage.include='lib/kahati-server.ts' \
  --coverage.include='app/api/admin/groupbuys/cycle/**' \
  --coverage.include='app/admin/groupbuys/page.tsx' \
  lib/kahati-cycle.test.ts app/api/admin/groupbuys/cycle/route.test.ts \
  app/admin/groupbuys/page.test.tsx lib/kahati-rollover.test.ts lib/kahati-server.test.ts
```

| File | % Stmts | % Branch | % Funcs | % Lines |
|------|---------|----------|---------|---------|
| All files | 98.09 | 80.18 | 74 | 98.09 |
| `app/admin/groupbuys/page.tsx` | 97.91 | 80 | 66.66 | 97.91 |
| `app/api/admin/groupbuys/cycle/route.ts` | 100 | 100 | 100 | 100 |
| `lib/kahati-server.ts` | 98.27 | 78.78 | 92.85 | 98.27 |

Above the 80% floor. The two uncovered ranges are pre-existing code this change
did not touch: `page.tsx:375-381` (`handleDelete`) and `kahati-server.ts:177-179`
(`cancelKahati`). Every line added by this change is covered.

Full suite: `npm test` → **2439 passed | 3 failed (2442)**. The three failures
(`app/api/campaigns/route.test.ts`, `app/api/admin/groupbuys/[id]/lifecycle.test.ts`,
`app/api/admin/orders/[id]/status/route.test.ts`) are 30s timeouts under
parallel PGlite contention, not regressions — re-run together in isolation they
give **27 passed (27)**.

`npx tsc --noEmit` → clean.

## Live QA

Local dev server on PGlite (`DATABASE_URL=` + `STORAGE_DRIVER=local`, port 3020),
seeded, signed in as `admin@bbgpeptides.ph`.

- **Route resolution:** `POST /api/admin/groupbuys/cycle` unauthenticated returns
  `401 {"error":"Authentication required."}` — the static `cycle` segment wins
  over the sibling `[id]` route, which returns `405` for POST on a UUID. No
  conflict.
- **End to end:** board of 5 joined counters (7, 5, 9, 3, 2 vials) plus one
  hand-made empty counter → `{"rolled":5,"skippedEmpty":1}`. Afterwards: 11
  counters — 5 `closed` with their vial counts intact, 5 fresh `open` at 0/10,
  and the empty one still `open` with no successor.
- **Orders:** the one seeded order (BBG-2417) stayed `shipped`. Untouched.
- **UI:** the button renders beside "+ New group buy" in the header, matching the
  campaigns board. The dialog reads "Start a new cycle across 6 counters?" with
  "End all & start next" / "Keep the board as it is". Neither board passes a
  `tone`, so both fall to the same `danger` default — the two dialogs match.

## Known gaps and flagged decisions

- **A counter below the 7-vial viable minimum is rolled like any other.** This
  matches the campaigns board, where `rollBatch` seals a below-MOQ batch as
  `approved`, and it is what "start a new cycle" means: the batch is being
  ordered. The consequence is worth stating — those participants keep live orders
  on a batch that may not be worth ordering, and because the counter is now
  `closed` the expiry sweep will never auto-cancel and refund them. That is
  deliberate (test #7 pins it) and it is why the dialog says "settle those on the
  orders screen", but it means an admin who does *not* want a thin counter to
  proceed must cancel it individually **before** starting the cycle.
- No E2E (Playwright) test was added; the live QA above covers the same path
  manually. The repo has no Playwright suite for the admin board to extend.
- `.pglite` was re-pushed and re-seeded locally to run the QA (the datadir was
  stale — `column "supplier_code" of relation "products" does not exist`). That
  is a pre-existing local-environment issue, unrelated to this change.

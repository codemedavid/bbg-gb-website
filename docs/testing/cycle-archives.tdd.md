# Cycle archives — TDD evidence

**Source plan:** none. Journeys were derived in-session from the owner's words on
2026-09-10: "start new cycle should remove all the previous commitments",
"every cycle open will be like cycle 1 … all data of that cycle will be archived
once closed to the cycle archives … the past batches will go back to 0",
"don't remove the campaigns, just make it back to 0", and the report
"No campaigns yet — there's no campaign na" from a local dev server.

## User journeys

1. As the admin, when a cycle opens (by schedule or button), every joined
   counter and batch is sealed and a fresh one opens at 0, so the boards start
   like cycle 1.
2. As the admin, I want the previous cycle's counters, batches and orders filed
   under that cycle in Cycle Archives, so the live boards and the orders screen
   show only the current cycle.
3. As the admin, I want an approved campaign to come back at 0 on the next
   cycle, never to vanish from the board.
4. As the admin, when the board cannot be loaded I want to read why, not an
   empty board telling me to create campaigns.

## Task report

| Task | RED | GREEN |
|---|---|---|
| Boundary rolls joined listings (a77278a) | `lib/cycle-boundary-refresh.test.ts` 2 failed | 11 passed |
| cycle_key stamping, board/order scoping, archive API+pages (1e649c7) | new suites written first; e.g. `lib/cycle-archive.test.ts` failed on missing module, `app/api/admin/cycles/route.test.ts` failed on missing route | full suite 305 files / 3374 passed |
| Approved campaign reopened at 0 (5a04290) | `lib/campaign-roll-server.test.ts` 6 failed (`reopened` undefined) | 67 passed across roll/boundary/campaign suites |
| Boards show load failure (this commit pair) | `test: reproduce…` — 2 failed / 72 passed | `fix: show…` — 74 passed |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | First board read of a new cycle seals joined counters/batches and opens successors at 0 | `lib/cycle-boundary-refresh.test.ts` "seals a joined counter…", "seals a joined batch…" | integration | PASS |
| 2 | A counter joined after the cycle was claimed is never sealed by a board read | same file, "does not seal a counter joined after the cycle was claimed" | integration | PASS |
| 3 | Every listing carried into the cycle is stamped; a pasalo counter keeps its cycle | same file, "names every listing…", "leaves a pasalo counter…" | integration | PASS |
| 4 | Checkout stamps the listing with its first commitment's cycle, once | `app/api/orders/cycle-key.test.ts` "the cycle a listing traded in" | integration | PASS |
| 5 | Admin Hatian board = trading + ended this cycle | `app/api/admin/groupbuys/route.test.ts` "this cycle's board" | integration | PASS |
| 6 | Admin campaign board = trading + ended this cycle; customers unchanged | `app/api/campaigns/route.test.ts` "the admin sees this cycle's board" | integration | PASS |
| 7 | Participants scoped to the batch's cycle; same-cycle overflow still gathered | `app/api/admin/campaigns/[id]/commitments/route.test.ts` | integration | PASS |
| 8 | `?cycle=current` scopes orders to the latest cycle, dark boards included | `app/api/admin/orders/cycle-scope.test.ts` | integration | PASS |
| 9 | Archive index and per-cycle detail are admin-only and correct | `app/api/admin/cycles/route.test.ts` | integration | PASS |
| 10 | Archive pages render counts, links, and a cycle's rows | `app/admin/cycles/page.test.tsx` | unit | PASS |
| 11 | Orders board defaults to current cycle, "All cycles" widens it | `app/admin/orders/cycle-scope.test.tsx` | unit | PASS |
| 12 | Approved campaign with nothing open gets a fresh batch at 0; cancelled left alone | `lib/campaign-roll-server.test.ts`, boundary "brings an approved campaign back at 0" | integration | PASS |
| 13 | Board/archive pure rules and Manila cycle label | `lib/cycle-archive.test.ts`, `lib/schedule-recurrence.test.ts` latestCycle | unit | PASS |
| 14 | Both admin boards show the server's reason on a failed load | `app/admin/group-buy/campaigns/page.test.tsx`, `app/admin/groupbuys/page.test.tsx` "when the board cannot be loaded" | unit | PASS |

## Coverage and known gaps

- Full suite after the last change: see the run recorded in the session
  (305 files). No skipped tests.
- No Playwright E2E was added; the archive pages are covered by RTL unit
  tests and the routes by PGlite integration tests.
- The "No campaigns yet" report itself was **not** a code defect: the local
  PGlite database behind `.pglite` had never had `drizzle/0031`–`0033`
  applied (`column "kahati_vials" does not exist`), so every admin read
  returned 500. Remedy: stop the dev server, `npm run db:push`, restart.
- Prod has NOT had `drizzle/0033_cycle_archive.sql` applied; it must be
  applied before pushing (see memory `cycle-archive-migration-0033`).

## Addendum 2026-09-10 — "add all the products in the groupbuy and kahati"

Journey: as the admin, opening either board lists a counter/batch for every
flagged product, even while the storefront is paused, so the catalog is on the
boards before the cycle opens.

| Stage | Command | Result |
|---|---|---|
| RED (`test: reproduce the boards that stay empty…`) | `npx vitest run app/api/admin/groupbuys/route.test.ts app/api/campaigns/route.test.ts` | 5 failed: boards stayed `[]` |
| GREEN (`fix: both boards open a listing…`) | same | 35 passed; full suite 3385 passed |

Guarantees: `GET /api/admin/groupbuys` seeds a counter per flagged product
(boards closed included, idempotent); `GET /api/campaigns` seeds a batch per
flagged product for customers and for admins on a closed storefront, idempotent.

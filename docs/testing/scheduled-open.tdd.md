# TDD evidence — scheduled opening for Group Buy and Kahati

**Branch:** `feat/group-buy-page`
**Date:** 2026-08-03
**Source plan:** none. This ran from a diagnostic question — "why don't I see the
schedule settings of groupbuy and kahati so it can automatically open" — whose
answer was that the feature did not exist. Journeys below were written during
this TDD run.

## What was actually missing

Before this change, neither board modelled an opening date:

- `group_buys` carried `closes_at` only; `moq_campaigns` carried `deadline` only.
- `group_buy_status` and `moq_campaign_status` had no pre-open state, and both
  defaulted to `'open'`, so a row was live the instant it was saved.
- Both admin forms had exactly one date input, and it was the closing one.

The auto-opening that *did* exist (`closeFullKahati`, `openSuccessor`) is
fill-triggered succession, not a clock: a batch opens because the previous one
filled, never because a date arrived.

## User journeys

1. As an admin, I want to set the date a group buy batch goes live, so a campaign
   can be prepared ahead of time and post itself without me being at a keyboard.
2. As an admin, I want the same for a Kahati counter.
3. As a customer, I must not see or be able to join a campaign that has not opened
   yet — not on the board, not through the API.
4. As an admin, I want to see what I have scheduled, distinguishable from what is
   closed.
5. As either, a row whose open date arrives must go live without any manual step.

## Design decision

The app has deliberately had **no scheduler** (`lib/kahati-server.ts:3`) — even
deadline expiry is resolved lazily when someone reads the board. Scheduled
opening follows that grain rather than introducing the first cron: `'scheduled'`
is a stored status, and the flip to `'open'` rides the existing sweeps.

Consequence, stated plainly: a row opens on the first board read at or after its
`opens_at`, not at the exact second. On a board with any traffic that is
indistinguishable; on a completely idle board a scheduled row stays dark until
someone looks. That was the accepted trade for adding no infrastructure.

## RED → GREEN

| Stage | Commit | Evidence |
|---|---|---|
| RED | `3a929d3` | `npx vitest run lib/schedule*.test.*` → **24 failed / 3 passed** |
| GREEN | `af88b43` | same command → **35 passed**; full suite **970 passed / 107 files** |

RED failure reasons — all the intended absence, none incidental:

```
Error: Failed to load url ./schedule ... Does the file exist?
error: invalid input value for enum group_buy_status: "scheduled"
error: invalid input value for enum moq_campaign_status: "scheduled"
AssertionError: expected 201 to be 400        (no window validation)
```

A second RED/GREEN pair inside the same cycle, found by `tsc` rather than by the
suite — the badge helper mapped every non-open status to `CLOSED`:

```
RED:   × kahatiBadge > marks a scheduled hatian as scheduled, not closed
       → expected 'CLOSED' to be 'SCHEDULED'
GREEN: lib/kahati.test.ts — 970 passed
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | No open date, or one already past, opens the row now | `lib/schedule.test.ts:openingStatus` | unit | PASS |
| 2 | A future open date holds the row at `scheduled` | `lib/schedule.test.ts:openingStatus` | unit | PASS |
| 3 | The open boundary is inclusive — a row is open at its own open minute | `lib/schedule.test.ts:opens at exactly the open date` | unit | PASS |
| 4 | An open date at or after the close date is refused | `lib/schedule.test.ts:scheduleWindowError` | unit | PASS |
| 5 | A due Kahati counter is opened by the sweep | `lib/schedule-sweep.test.ts:opens a counter whose open date has passed` | integration | PASS |
| 6 | A not-yet-due counter is left alone | `lib/schedule-sweep.test.ts:leaves a counter whose open date is still ahead` | integration | PASS |
| 7 | An opening is reported exactly once — repeat sweeps are no-ops | `lib/schedule-sweep.test.ts:reports an opening exactly once` | integration | PASS |
| 8 | A `scheduled` row with no open date never opens | `lib/schedule-sweep.test.ts:never opens a scheduled counter with no open date` | integration | PASS |
| 9 | A counter whose whole window elapsed opens *and* resolves in one pass | `lib/schedule-sweep.test.ts:opens and then resolves a counter whose window has fully elapsed` | integration | PASS |
| 10 | A scheduled counter is off the public Kahati board until it opens | `lib/schedule-sweep.test.ts:keeps a scheduled counter off the public board` | integration | PASS |
| 11 | A due Group Buy batch is opened by `openDueBatches` | `lib/schedule-sweep.test.ts:opens a batch whose open date has passed` | integration | PASS |
| 12 | Listing the campaign board performs the flip | `lib/schedule-sweep.test.ts:opens due batches when the board is listed` | integration | PASS |
| 13 | A scheduled batch is withheld from the public board | `lib/schedule-sweep.test.ts:hides a scheduled batch from the public board` | integration | PASS |
| 14 | An admin still sees their scheduled batch | `lib/schedule-sweep.test.ts:shows a scheduled batch to an admin` | integration | PASS |
| 15 | `POST /api/campaigns` with a future date creates `scheduled` | `lib/schedule-routes.test.ts` | integration | PASS |
| 16 | `POST /api/campaigns` with no/past date creates `open` | `lib/schedule-routes.test.ts` | integration | PASS |
| 17 | `POST /api/admin/groupbuys` derives status the same way | `lib/schedule-routes.test.ts` | integration | PASS |
| 18 | Both create routes reject an open date at/after the close | `lib/schedule-routes.test.ts` | integration | PASS |
| 19 | Checkout refuses a commitment to a scheduled batch, committed stays 0 | `lib/schedule-routes.test.ts:refuses a commitment to a scheduled group buy` | integration | PASS |
| 20 | Checkout refuses a join on a scheduled kahati, claimed stays 0 | `lib/schedule-routes.test.ts:refuses a join on a scheduled kahati` | integration | PASS |
| 21 | Both admin forms render an "Opens at" input | `lib/schedule-forms.test.tsx` | component | PASS |
| 22 | The typed open date reaches the API unchanged | `lib/schedule-forms.test.tsx:sends the typed open date to the API` | component | PASS |
| 23 | The form refuses a draft opening at/after its deadline | `lib/schedule-forms.test.tsx` | unit | PASS |
| 24 | A scheduled counter badges SCHEDULED, not CLOSED | `lib/kahati.test.ts:kahatiBadge` | unit | PASS |

## Coverage

`npx vitest run --coverage` — **970 passed, 107 files**. All files 74.37% stmts
(pre-existing project baseline; unchanged by this work). Touched modules:

| Module | Stmts | Branch |
|---|---|---|
| `lib/schedule.ts` | 100% | 100% |
| `lib/kahati.ts` | 100% | 100% |
| `lib/kahati-server.ts` | 100% | 82.75% |
| `lib/moq-schemas.ts` | 100% | 100% |
| `lib/admin-schemas.ts` | 100% | 100% |
| `lib/campaign-form.ts` | 100% | 100% |
| `lib/group-buy.ts` | 100% | 95.83% |
| `lib/moq-batch-server.ts` | 88.88% | 73.52% |

`npx tsc --noEmit` — clean. Typecheck caught two real gaps the suite did not:
both `MoqCampaign['status']` badge maps were non-total once the enum grew, which
would have rendered a blank badge on a scheduled batch.

## Known gaps

- **Exact-second opening.** By design (see above) the flip is read-triggered. If
  precise timing is ever required, the swap is a cron hitting a protected route
  that calls the same two functions — no other change.
- **PATCH window validation is pair-wise, not merged.** Editing `opensAt` alone
  is checked against a supplied `deadline` only; the stored deadline is not
  re-read. This matches the existing `groupBuyPatchSchema` precedent for the cap
  check and is documented in `lib/moq-schemas.ts`.
- **`scheduled` is selectable in the Kahati admin status dropdown.** Choosing it
  without an open date produces a permanently dark row. The sweep's `isNotNull`
  guard makes that inert rather than dangerous, and the create path never
  produces it — the admin sets a date and the status is derived.
- **Migration not in `drizzle/meta/_journal.json`.** `drizzle/0012_scheduled_open.sql`
  is hand-written, following the precedent set by `0011_kahati_within_cap.sql`.
  The test harness applies files in sorted filename order and does not read the
  journal; `drizzle-kit push` reconciles from the schema.

## Applying to a live database

`ALTER TYPE ... ADD VALUE` and two nullable `ADD COLUMN`s. Additive and
backward-compatible: `opens_at IS NULL` reads as "already open", so every
existing counter and batch keeps its current behaviour. Run `npm run db:push`
(or apply `drizzle/0012_scheduled_open.sql`), then `npm run db:check` to confirm
the deployed shape matches.

---

> **Renumbered on merge (2026-08-05).** `main` had independently used `0012` and
> `0013`, so on merging this branch these migrations moved to
> `0014_scheduled_open.sql`, `0015_product_kit_size.sql` and
> `0016_product_kit_size_backfill.sql`, and were recorded in
> `drizzle/meta/_journal.json`. Filenames quoted above are the ones in force when
> the commands were run — they are left as-is so the evidence stays literal.
> Re-application is safe: every one of these statements is idempotent, which is
> why the production copies applied under the old numbers need no undoing.

# Ending a batch and starting the next — TDD evidence

**Date:** 2026-08-19
**Branch:** `feat/group-buy-page`
**Source plan:** none. Journeys were derived during this TDD run from the
operator's request: *"how can I end the current running GB and open another GB
now, and put all the GB orders made today into the newly opened batch."*

---

## The problem this closes

`applyCampaignAction('open', 'approve')` ended a batch and stopped there. Nothing
opened its successor — only a batch *filling to its MOQ* did that
(`completeFullBatch` → `openSuccessor`). So an admin who wanted the next batch
before this one filled had to create a campaign by hand, and `POST /api/campaigns`
writes batch #1 of a **new series** (`seriesId = id`).

The visible symptom on production: five products carried two board entries each —
the Aug-2 series and a same-named series created 2026-08-19 — because five
campaigns were hand-created that day instead of rolled.

---

## User journeys

1. As an admin, I want to end a running batch and have its next batch open in the
   same breath, so the group buy carries on without me hand-making a campaign.
2. As an admin, I want the batch I just ended to archive **under the same card**,
   not to become a rival entry on the board.
3. As an admin, I want to end every running batch at once, so starting a new
   trading cycle is one action rather than ninety.
4. As an admin, I want batches nobody joined left alone, so a new cycle does not
   record supplier orders that were never placed.
5. As an admin, I want customer order statuses untouched by any of this, because
   settling orders is my decision on the orders screen.

---

## Task report

### 1. The lifecycle rule (`lib/group-buy.ts`)

Added `'roll'` to `MoqCampaignAction`, mapped to `'approved'`, plus
`canRollBatch(status)`. A rolled batch reads as approved — it ran, it closed, it
proceeds — and what distinguishes `roll` is the successor, which is a write and
therefore not this state machine's job.

- **Validation:** `npx vitest run lib/campaign-roll.test.ts`
- **RED:** `expected { ok: true, status: undefined } to deeply equal { ok: true, status: 'approved' }`
  and `TypeError: canRollBatch is not a function`
- **GREEN:** 4 passed.

### 2. The rollover (`lib/moq-batch-server.ts`)

`rollBatch` seals a running batch as `approved` and opens its successor;
`rollOpenBatches` does it board-wide. `completeFullBatch` and `rollBatch` now
share one guarded seal (`sealAndSucceed`), so the fill path and the admin path
cannot drift apart.

Sealed as `approved`, not `completed`: the batch did not reach its cap, it was
ended deliberately, and `approved` is precisely "proceeding without having
filled".

- **Validation:** `npx vitest run lib/campaign-roll-server.test.ts`
- **RED:** `TypeError: rollBatch is not a function` ×6, `rollOpenBatches is not a function` ×4
- **GREEN:** 10 passed.

### 3. The routes

`POST /api/campaigns/[id]/action {action:'roll'}` answers with the successor —
the batch that is live now. `POST /api/campaigns/cycle` rolls the whole board and
reports what it skipped.

The cycle route is deliberately **not** behind the trading-window gate: it is the
control that *ends* a cycle, and an admin must reach it whether the boards are
open or shut.

- **Validation:** `npx vitest run app/api/campaigns/roll.test.ts`
- **RED:** `Failed to load url ./cycle/route … Does the file exist?`
- **GREEN:** 5 passed.

### 4. The admin controls

"End & start next" on a running card; "Start new cycle" on the board, hidden when
nothing is running. Both confirm first, and both confirms state in plain words
that customer orders are not changed.

- **Validation:** `npx vitest run app/admin/group-buy/campaigns/`
- **RED:** `Unable to find an accessible element with the role "button" and name /end batch #1 of Retatrutide 30mg/i` ×3
  and `… /start new cycle/i` ×3
- **GREEN:** 51 passed (includes the 41 pre-existing tests in that directory;
  `page.test.tsx`'s `useMutate` mock gained a `startCycle` stub, since the page
  now reads it).

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A running batch rolls to `approved`; nothing else does | `lib/campaign-roll.test.ts:applyCampaignAction — roll` | unit | PASS |
| 2 | A completed batch refuses to roll — it already has a successor | `lib/campaign-roll.test.ts:refuses to roll a completed batch` | unit | PASS |
| 3 | Rolling opens batch #N+1 in the **same series**, committed 0 | `lib/campaign-roll-server.test.ts:ends the running batch and opens its successor` | integration | PASS |
| 4 | The successor carries name, MOQ, per-customer min and price | `lib/campaign-roll-server.test.ts:carries the batch terms into the successor` | integration | PASS |
| 5 | A series is left with exactly one open batch | `lib/campaign-roll-server.test.ts:leaves exactly one open batch` | integration | PASS |
| 6 | A non-open batch mints no successor | `lib/campaign-roll-server.test.ts:refuses a batch that is not open` | integration | PASS |
| 7 | Two rolls racing one batch open **one** successor | `lib/campaign-roll-server.test.ts:opens one successor when two rolls race` | integration | PASS |
| 8 | **Orders and their statuses are never touched** | `lib/campaign-roll-server.test.ts:does not touch the orders committed to the batch` | integration | PASS |
| 9 | A board cycle rolls joined batches and leaves empty ones open | `lib/campaign-roll-server.test.ts:rolls every batch that has commitments` | integration | PASS |
| 10 | A board cycle ignores approved/completed/cancelled batches | `lib/campaign-roll-server.test.ts:ignores batches that are not open` | integration | PASS |
| 11 | A second cycle immediately after is a no-op | `lib/campaign-roll-server.test.ts:is a no-op the second time` | integration | PASS |
| 12 | The roll route answers with the open successor | `app/api/campaigns/roll.test.ts:ends the batch and answers with the successor` | integration | PASS |
| 13 | Rolling a non-running batch is a 400 | `app/api/campaigns/roll.test.ts:refuses a batch that is not running` | integration | PASS |
| 14 | Both routes refuse a customer (403) | `app/api/campaigns/roll.test.ts:refuses a customer` ×2 | integration | PASS |
| 15 | The cycle route reports `rolled` and `skippedEmpty` | `app/api/campaigns/roll.test.ts:rolls every running batch and reports what it skipped` | integration | PASS |
| 16 | "End & start next" appears only on a running batch | `app/admin/group-buy/campaigns/roll.test.tsx:does not offer to end a %s batch` | component | PASS |
| 17 | Both controls write nothing when the confirm is declined | `…roll.test.tsx:writes nothing when the confirm is declined` ×2 | component | PASS |
| 18 | The confirms say orders are not changed / empty batches stay open | `…roll.test.tsx:says the customers keep their orders`, `…warns that batches nobody joined stay open` | component | PASS |
| 19 | The cycle control is hidden when no batch is running | `…roll.test.tsx:hides the cycle control when no batch is running` | component | PASS |

---

## Coverage

`npx vitest run --coverage` — **213 files, 2255 tests, all passing.**
Project total: **86.39% lines, 88.26% branches, 79.2% functions.**

| File | Lines | Branches | Functions |
|---|---|---|---|
| `lib/group-buy.ts` | 100% | 96.29% | 100% |
| `lib/moq-batch-server.ts` | 90.84% | 79.06% | 92.3% |
| `lib/moq-schemas.ts` | 100% | 100% | 100% |
| `app/api/campaigns/cycle/route.ts` | 100% | 100% | 100% |
| `app/api/campaigns/[id]/action/route.ts` | 100% | 69.23% | 100% |
| `app/admin/group-buy/campaigns/page.tsx` | 100% | 96% | 90.9% |
| `app/admin/group-buy/campaigns/CampaignCard.tsx` | 100% | 80% | 87.5% |
| `lib/admin-api.ts` | 55.69% | 72.72% | 20.58% |

`npx tsc --noEmit` — clean.

### Known gaps

- **`lib/admin-api.ts` at 55.69%** is pre-existing and by design: the file is a
  thin React-Query wrapper whose mutations are mocked out in every component
  test. The `startCycle` mutation added here is one line of that shape and is
  exercised indirectly through the page tests' mock.
- **`action/route.ts` branches at 69.23%** — the 409 arm (`rollBatch` returning
  null after the lifecycle check passed) is reachable only if another request
  seals the same batch between the SELECT and the guarded UPDATE. The equivalent
  race is covered directly at the server layer (spec #7).
- **Not covered:** no E2E/Playwright journey was added for the new controls; the
  component tests assert the confirm-then-mutate path against a mocked API.

---

## Merge evidence

Checkpoint commits on `feat/group-buy-page`, in order:

| Commit | Stage |
|---|---|
| `ac21f7b` | RED — reproducers for the rollover (12 failed / 2 passed) |
| `b8ebdef` | GREEN — `roll` action, `rollBatch`, `rollOpenBatches`, both routes (19 passed; full suite 2245) |
| `d31f3bc` | RED — reproducers for the admin controls (6 failed / 4 passed) |
| `f49ddc7` | GREEN — the two board controls (51 passed; full suite 2255) |

No refactor-only commit: the one refactor this cycle called for — folding
`completeFullBatch` and `rollBatch` onto a shared `sealAndSucceed` — was the
minimal implementation rather than a follow-up cleanup, so it landed inside
`b8ebdef` with the suite green.

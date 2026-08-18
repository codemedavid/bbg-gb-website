# Campaign board — archive finished batches by series

**Date:** 2026-08-18 · **Branch:** `feat/group-buy-page`

## Source plan

No `*.plan.md`. The journey was derived in this TDD run from an admin
screenshot of the board and a read-only survey of the production data.

## What prompted it

The admin campaign board rendered one card per batch. Production held **226
batches** — 106 open, 95 cancelled, 19 completed, 6 approved — so the batches
that still needed a decision were buried under the ones that were already
history.

Two facts constrained the fix, both verified against the production database
before any code was written:

- 18 of the 19 completed batches carry real `order_items` (25 orders, Aug 7–12).
- `order_items.moq_campaign_id` has `delete_rule = NO ACTION`, so the board's ✕
  (Delete) fails with a foreign-key error on any batch that has order lines.

Deleting finished batches was therefore off the table, and reopening one would
break the one-live-batch-per-series invariant. The batches had to stay, and stop
competing for attention.

## User journey

> As an admin, I want the campaign board grouped by batch series with finished
> batches archived behind a per-series toggle, so I see what is live at a glance
> and can still open Batch #1's history whenever I need it.

## Task report

### 1. Group batches into series (`lib/campaign-series.ts`)

Pure function `groupBySeries` folds a flat batch list into one entry per series:
the batch fronting the group is the newest **live** batch (`scheduled`, `open`,
`approved`), or — for a series that has ended — its newest batch, so a finished
group buy keeps its place instead of vanishing with its participants.

- **RED** — `npx vitest run lib/campaign-series.test.ts`
  `Error: Failed to load url ./campaign-series … Does the file exist?`
  (compile-time RED: the module under test did not exist)
- **GREEN** — same command: `Test Files 1 passed (1) · Tests 10 passed (10)`

### 2. Archive the past batches on the board (`app/admin/group-buy/campaigns/`)

`page.tsx` now renders one `SeriesGroup` per series; `CampaignCard` was
extracted so the live batch and the archived ones render identically. Past
batches sit behind a `Past batches (N)` toggle (`aria-expanded` /
`aria-controls`), newest batch first, and keep every action they had.

- **RED** — `npx vitest run app/admin/group-buy/campaigns/page.test.tsx`
  `Tests 5 failed | 13 passed (18)` — every failure was the missing archive: the
  board still rendered one flat card per batch and offered no toggle.
- **GREEN** — same command: `Tests 18 passed (18)`
- Type check: `npx tsc --noEmit --pretty false` — clean.
- Full suite: `npx vitest run` — `Test Files 204 passed (204) · Tests 2142
  passed (2142)`, so nothing else on the board regressed.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Every batch of one series collapses into a single board entry | `lib/campaign-series.test.ts:collects every batch of one series into a single group` | unit | PASS | `npx vitest run lib/campaign-series.test.ts` |
| 2 | Two series sharing a name are never merged | `lib/campaign-series.test.ts:keeps separate series apart even when they share a name` | unit | PASS | same |
| 3 | The group is fronted by the live batch, not the newest finished one | `lib/campaign-series.test.ts:fronts the group with the live batch, not the newest finished one` | unit | PASS | same |
| 4 | `scheduled` and `approved` batches count as live | `lib/campaign-series.test.ts:treats scheduled and approved batches as live` | unit | PASS | same |
| 5 | A fully finished series stays on the board, fronted by its last batch | `lib/campaign-series.test.ts:fronts a fully finished series with its last batch` | unit | PASS | same |
| 6 | Archived batches are ordered newest batch first | `lib/campaign-series.test.ts:archives the remaining batches newest first` | unit | PASS | same |
| 7 | A stray second live batch is archived, never dropped | `lib/campaign-series.test.ts:keeps a second live batch reachable in the archive` | unit | PASS | same |
| 8 | Groups are ordered by name so a long board can be scanned | `lib/campaign-series.test.ts:orders groups by name so a long board can be scanned` | unit | PASS | same |
| 9 | Only the live batch of a series shows up front | `app/admin/group-buy/campaigns/page.test.tsx:shows only the live batch of a series up front` | component | PASS | `npx vitest run app/admin/group-buy/campaigns/page.test.tsx` |
| 10 | The toggle names how many batches the archive holds | `…page.test.tsx:names how many batches the archive holds` | component | PASS | same |
| 11 | Opening the archive reveals the batches newest first | `…page.test.tsx:reveals the archived batches newest first when opened` | component | PASS | same |
| 12 | A series on its first batch shows no archive toggle | `…page.test.tsx:offers no archive toggle for a series on its first batch` | component | PASS | same |
| 13 | One series' history opens without opening another's | `…page.test.tsx:opens one series' history without opening another's` | component | PASS | same |
| 14 | An archived batch can still be cancelled once its history is open | `…page.test.tsx:cancels an archived batch once its history is open` | component | PASS | same |
| 15 | Approve/extend/cancel/delete and the create/edit routes still work | `…page.test.tsx` (`lifecycle actions stay on the list`, `reaching the create and edit screens`) | component | PASS | same |

## Coverage

`npx vitest run --coverage --coverage.include='lib/campaign-series.ts'
--coverage.include='app/admin/group-buy/campaigns/**' lib/campaign-series.test.ts
app/admin/group-buy/campaigns/page.test.tsx`

| File | % Stmts | % Branch |
|------|---------|----------|
| `lib/campaign-series.ts` | 100 | 100 |
| `SeriesGroup.tsx` | 100 | 100 |
| `page.tsx` | 100 | 100 |
| `CampaignCard.tsx` | 100 | 78.57 |

`CampaignForm.tsx`, the `[id]`, `[id]/participants` and `new` routes report 0%
here only because the include glob pulls in the whole directory; they are
untouched by this change and covered by their own suites.

## Known gaps

- The archive is display-only. No lifecycle rule changed: `applyCampaignAction`
  in `lib/group-buy.ts:27` still allows only `cancel` on a completed batch,
  and there is still no reopen.
- The 19 completed batches and their 25 orders remain in the database
  untouched, by design — the request was to organise the board, not clear data.
- The ✕ (Delete) button still 500s on any batch with order lines
  (`order_items.moq_campaign_id` is `NO ACTION`). Pre-existing, and now easier
  to hit by accident inside an open archive; worth a follow-up that either
  disables delete for a batch with orders or reports the conflict in words.

## Merge evidence

RED → GREEN checkpoints on `feat/group-buy-page`:

- `c83a41a test:` reproducer for grouping the campaign board by series (RED)
- `b2594ff feat:` group campaign batches by series (GREEN, 10 passed)
- `c97e4d9 test:` reproducer for the archived, series-grouped board (RED, 5 failed)
- `a7b810f feat:` archive finished batches under each group buy (GREEN, 28 passed)

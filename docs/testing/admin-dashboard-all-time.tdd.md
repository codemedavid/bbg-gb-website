# Admin dashboard: all-time orders in the analytics

## Source plan

No `*.plan.md`. Journeys were derived during this TDD run from the request:
*"fix the sales analytics so that the data of all time orders is in the
dashboard analytics."*

What the unfiltered `/admin` dashboard showed before this run:

| Surface | Period it read |
|---|---|
| Total revenue / Total packing fees tiles | all time (already correct) |
| Orders this week / this month tiles | 7 / 30 days (context, kept) |
| Order summary chart | **last 7 days only** |
| Fast-moving items | **last 30 days only**, with a lifetime catalog fallback |

So the numbers were all-time but the picture was not: the chart and the
ranking only knew the current batch. Prod holds orders since 2026-08-07 across
six cycles; the chart showed one week of them.

## User journeys

1. As an admin, I want the unfiltered dashboard to chart every order ever
   placed, so I can see how each batch compared without picking dates.
2. As an admin, I want the fast movers ranked over the whole order history, so
   the list reflects what actually sells and not only the last month.
3. As an admin, I want the page to say the chart and ranking are all-time, so
   I do not misread a weekly bucket as a day.
4. As an admin, I still want a picked date range to narrow both, day by day, as
   it did before.

## Task report

### 1. Chart every order, bucketed by Manila week

`dailySummary()` without a window now groups every non-cancelled order by
`date_trunc('week', created_at + interval '8 hours')`, keyed by the Monday as
`YYYY-MM-DD`. A per-day series over a shop's whole history is more bars than
the chart can label; weeks stay readable for years. The +8h shift (Manila has no
DST) resolves identically on postgres-js and pglite, unlike a named zone. A
window still reads day by day.

- RED: `npx vitest run app/api/admin/stats/route.test.ts app/admin/page.test.tsx`
  → `summarises every order ever placed week by week, keyed by the Manila Monday`
  failed: `expected [] to deeply equal [ [ '2026-06-01', 2, 2000 ], …(1) ]`
  (orders from June were outside the seven-day window).
- GREEN: same command → 27 passed.
- Prod check (read-only SQL against Supabase): the identical query returns six
  weekly buckets from `2026-08-03` to `2026-09-07`, totalling 351 orders.

### 2. Rank fast movers over the whole history

`fastMovingItems()` without a window drops the 30-day filter and ranks every
non-cancelled order's items by units. The lifetime catalog fallback is kept for
a shop with no orders at all; a range still gets no fallback.

- RED: `ranks fast movers over every order ever placed, not only the last
  thirty days` failed: received only `['Retatrutide 10mg', 7]`; the 99-unit
  order from 45 days ago was missing.
- GREEN: passes with `[['Tirzepatide 10mg', 99], ['Retatrutide 10mg', 7]]`.

### 3. Label the page as all-time

Subtitle reads *All-time performance, with this week and month at a glance.*;
the chart is titled *Weekly order summary · all time* and bars are labelled by
their Monday (`Jun 1`) rather than a weekday; the ranking is titled
*Fast-moving items · all time*; the empty state says *No orders yet.* The date
labels are parsed as local midnight so a bare `YYYY-MM-DD` cannot print the day
before west of Greenwich. A picked range keeps its daily labels and titles.

- RED: `presents the unfiltered dashboard as all-time, with the chart bucketed
  by week` failed: `Unable to find an element with the text: /all-time
  performance/i`.
- GREEN: passes.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | Unfiltered fast movers rank every order ever placed, oldest included | `app/api/admin/stats/route.test.ts:ranks fast movers over every order ever placed, not only the last thirty days` | integration | PASS | `npx vitest run app/api/admin/stats/route.test.ts` |
| 2 | Unfiltered chart buckets every non-cancelled order by Manila week, keyed by its Monday, ordered oldest first | `app/api/admin/stats/route.test.ts:summarises every order ever placed week by week, keyed by the Manila Monday` | integration | PASS | same |
| 3 | A picked range still charts day by day and ranks on the range alone | `app/api/admin/stats/route.test.ts` date-range filter suite (unchanged) | integration | PASS | same |
| 4 | The unfiltered page says all-time, titles the chart and ranking as such, and labels week bars by date | `app/admin/page.test.tsx:presents the unfiltered dashboard as all-time, with the chart bucketed by week` | unit | PASS | `npx vitest run app/admin/page.test.tsx` |
| 5 | Filtered page keeps its daily titles and empty-state wording | `app/admin/page.test.tsx` date filter suite (unchanged) | unit | PASS | same |
| 6 | Fee boundaries still bind as strings, not Dates | `lib/analytics.test.ts` (unchanged) | unit | PASS | `npx vitest run lib/analytics.test.ts` |

## Coverage and known gaps

- `npx tsc --noEmit`: no errors in the touched files. The only errors reported
  are in `scripts/qa/e2e-groupbuy.ts`, an uncommitted file another session is
  editing (duplicate declarations); not touched here.
- `next lint` is not configured in this repo (it prompts to create a config), so
  no lint pass was run.
- No coverage run: the repo has no `test:coverage` script.
- Not built: a per-cycle chart. `cycle_key` is null on 165 prod orders placed
  before the archive work, so weeks are the honest all-time bucket for now.
- The chart hides per-bar labels past 14 bars, so after roughly three and a half
  months of trading the weekly bars will render unlabelled (hover still shows
  the revenue). Revisit when that happens.

## Merge evidence

- `bca3c71` test: reproduce the dashboard that only charts and ranks the last 7/30 days of orders (RED)
- `e8441d3` fix: chart and rank every order ever placed on the unfiltered admin dashboard (GREEN)
- No refactor commit: nothing to clean up after the minimal fix.

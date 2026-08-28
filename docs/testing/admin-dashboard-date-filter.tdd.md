# Admin dashboard: date-range filter + non-clipping stat figures

## Source plan

No `*.plan.md`. Journeys were derived during this TDD run from a photo of the
live `bbgph.org/admin` dashboard and the request: *"Ang dashboard gusto nila
lagyan ng filter para pwede lang e choose ang date … and the total revenue is
not responsive."*

Two problems in that photo:

1. Every figure is pinned to this week / this month / all time. A question about
   one batch's days — "how did 10–12 August go?" — has no answer on the page.
2. `TOTAL REVENUE` reads **`₱1,255,096.2`**. The last digit is missing. A stat
   card is a fifth of the row and its width is fixed by the grid, so a figure at
   a fixed 28px does not widen the card — it spills out of it.

## User journeys

1. As an admin, I want to pick a start and end date on the dashboard, so the
   order revenue, packing fees, the chart and the fast movers cover only that
   period.
2. As an admin, I want to clear the dates and get the standing week / month /
   all-time dashboard back.
3. As an admin, I want a backwards range refused with a reason, instead of a
   number that answers no question I asked.
4. As an admin, I want a large revenue figure to stay completely readable inside
   its card at every screen width.

## Task report

### 1. Date-range filter (server)

`GET /api/admin/stats` accepts an optional `?from=&to=` pair of inclusive
Manila-calendar dates. `dashboardStats(range?)` narrows the period figures —
`totals.range`, `packingFees.range`, `dailySummary`, `fastMoving` — to that
window. All-time totals and the pending-proof queue deliberately do **not**
narrow: one is the context the range is read against, the other is a live work
queue with no period at all.

Two decisions worth recording:

- **A half-filled pair is a 400, not an open-ended filter.** "Everything since
  10 August" and "everything up to 10 August" are different questions; silently
  picking one puts a number on screen that answers neither.
- **Fast movers get no lifetime fallback inside a range.** The unfiltered
  dashboard falls back to catalog leaders when no orders exist yet, which is
  useful on a new shop. Inside a range it would contradict the answer: "nothing
  sold between these dates" is the truth, and lifetime leaders deny it.

`statsRangeError` (`lib/analytics-range.ts`) is shared by the picker and the
route, so a backwards range is refused once, in one wording, on both sides.

Also renamed `weeklySummary` → `dailySummary` end to end: with a range the field
can hold any number of days, and the old name would have been a lie.

### 2. Date-range filter (client)

`useStats(range)` keys the range into the react-query cache, so clearing the
filter reads the unfiltered entry back rather than refetching. A filtered
dashboard trades the two standing period cards for one, so the row carries four
tiles instead of five and each range figure sits beside its own all-time
counterpart.

RED for this journey initially specified *five* cards including a separate
"Orders in range" tile. That test failed on `getByText(/Aug 10, 2026 – Aug 12,
2026/)` matching twice — the layout printed the range in the subtitle *and* in a
card sub-line. The spec was the thing at fault, so the layout was reduced to
four distinct cards and the test updated to match; no assertion was weakened.

### 3. Stat figures that do not clip

`StatCard` moved to its own file and now steps the headline figure down by its
character count (`statValueClass`), with each step also clamping against the
viewport. `tabular-nums` is what makes character count a faithful proxy for
rendered width — every figure here is digits, commas and a dot. `break-words`,
never `truncate`: hiding digits is the one thing a revenue card must not do.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | No range asked for ⇒ `range` is null and the standing periods are untouched | `app/api/admin/stats/route.test.ts:reports no range when none is asked for` | integration | PASS | `npx vitest run app/api/admin/stats/route.test.ts` |
| 2 | Order count and revenue scope to the chosen Manila days, inclusive of both ends; all-time stays all-time | `route.test.ts:scopes order count and revenue to the chosen Manila calendar days` | integration | PASS | same |
| 3 | Packing fees scope to the range, still excluding cancelled and settled-twice charges | `route.test.ts:scopes packing fees to the range` | integration | PASS | same |
| 4 | The chart becomes a day-by-day summary of the range | `route.test.ts:turns the weekly chart into a day-by-day summary` | integration | PASS | same |
| 5 | Fast movers rank on the range alone, with no lifetime fallback | `route.test.ts:ranks fast movers on the range alone` / `:leaves fast movers empty when the range sold nothing` | integration | PASS | same |
| 6 | An end date before the start is a 400 | `route.test.ts:rejects an end date before the start date` | integration | PASS | same |
| 7 | A malformed date is a 400, not a silently wrong period | `route.test.ts:rejects a malformed date` | integration | PASS | same |
| 8 | Half a range is a 400, not an open-ended filter | `route.test.ts:rejects half a range` | integration | PASS | same |
| 9 | Packing-fee week/month/all-time totals are unchanged by this work | `route.test.ts:combines order and deferred-settlement fees by period` | integration | PASS | same |
| 10 | Period boundaries stay wire-encodable primitives (postgres-js Bind) | `lib/analytics.test.ts:binds the period boundaries as wire-encodable parameters` | unit | PASS | `npx vitest run lib/analytics.test.ts` |
| 11 | The dashboard starts unfiltered and asks for no range | `app/admin/page.test.tsx:starts unfiltered` | unit (RTL) | PASS | `npx vitest run app/admin/page.test.tsx` |
| 12 | A range is requested only once both ends are set | `page.test.tsx:asks for the chosen range only once both ends are set` | unit (RTL) | PASS | same |
| 13 | A served range replaces the standing period cards and keeps all-time beside them | `page.test.tsx:replaces the standing period cards with the range figures` | unit (RTL) | PASS | same |
| 14 | A backwards range is not requested and says why | `page.test.tsx:refuses to request a backwards range and says why` | unit (RTL) | PASS | same |
| 15 | Clear returns to the unfiltered dashboard | `page.test.tsx:returns to the unfiltered dashboard when the range is cleared` | unit (RTL) | PASS | same |
| 16 | The chart is titled for the period it is actually showing | `page.test.tsx:labels the summary chart for the range it is actually showing` | unit (RTL) | PASS | same |
| 17 | An empty range says so, rather than implying the last seven days were empty | `page.test.tsx:says the range is empty` | unit (RTL) | PASS | same |
| 18 | Short figures keep the full display size | `app/admin/StatCard.test.tsx:keeps a short figure at the full display size` | unit | PASS | `npx vitest run app/admin/StatCard.test.tsx` |
| 19 | A long peso figure steps down so it cannot overflow its card | `StatCard.test.tsx:steps a long peso figure down` | unit | PASS | same |
| 20 | The step never falls below the smallest legible size | `StatCard.test.tsx:never steps below the smallest legible size` | unit | PASS | same |
| 21 | The whole figure renders, never truncated | `StatCard.test.tsx:renders the whole figure at the size its length calls for` | unit | PASS | same |

### RED

```
npx vitest run app/admin/page.test.tsx app/admin/StatCard.test.tsx \
  app/api/admin/stats/route.test.ts

 Test Files  3 failed (3)
      Tests  18 failed | 4 passed (22)

 FAIL app/admin/StatCard.test.tsx
   Error: Failed to resolve import "./StatCard" from "app/admin/StatCard.test.tsx"
 FAIL app/admin/page.test.tsx
   TypeError: Cannot read properties of undefined (reading 'map')
 FAIL app/api/admin/stats/route.test.ts
   AssertionError: expected 200 to be 400
```

Commit `16f3d53`.

### GREEN

```
npx vitest run app/admin/page.test.tsx app/admin/StatCard.test.tsx \
  app/api/admin/stats/route.test.ts

 ✓ app/admin/StatCard.test.tsx (4 tests)
 ✓ app/admin/page.test.tsx (11 tests)
 ✓ app/api/admin/stats/route.test.ts (11 tests)

 Test Files  3 passed (3)
      Tests  26 passed (26)
```

Commit `73446a3`. `npx tsc --noEmit` clean.

### Full suite

```
npm test
 Test Files  7 failed | 226 passed (233)
      Tests  7 failed | 2469 passed (2476)
```

All seven failures are `Test timed out in 30000ms` in files this change does not
touch (`app/api/campaigns/*`, `app/api/orders/kahati-*`,
`app/api/admin/orders/*`). Re-run in isolation:

```
npx vitest run app/api/campaigns/route.test.ts \
  app/api/orders/kahati-downpayment-policy.test.ts \
  app/api/orders/kahati-overflow.test.ts app/api/admin/orders/proofs.test.ts \
  app/api/campaigns/commitments/route.test.ts \
  'app/api/admin/orders/[id]/status/kahati-cancel-release.test.ts' \
  'app/api/admin/orders/[id]/status/moq-release.test.ts'

 Test Files  7 passed (7)
      Tests  51 passed (51)
```

One of them took 29.1s against the 30s cap, so these are load-related flakes
under the parallel run, pre-existing and unrelated.

## Browser verification

jsdom cannot say whether a number fits a box, so the clipping fix was checked in
a real headless Chrome (CDP) against a local PGlite server, with the stats
response rewritten in-page to the exact figures from the reported screenshot
(214 orders, ₱1,255,096.25, ₱32,400 packing fees).

Breakpoints 320 / 375 / 768 / 1024 / 1440 / 1920, measuring each figure's
`scrollWidth` against its card's content box:

| width | overflowing figures | horizontal page scroll |
|-------|--------------------|------------------------|
| 320 | 0 | no |
| 375 | 0 | no |
| 768 | 0 | no |
| 1024 | 0 | no |
| 1440 | 0 | no |
| 1920 | 0 | no |

At 1440 a card's content box is **128px**. With the pre-fix rule reinstated
(`font-size:28px !important`) the same figure breaks across two lines —
`₱1,255,0` / `96.25` — and pushes its sub-line out of alignment with the row.
With the fix it renders at 19px, complete, on one line. Screenshots captured
before/after at every breakpoint.

The filter was then driven end to end in the same browser:

```
--- 1. backwards range is refused ---
alert     : The end date must be on or after the start date.
lastCall  : /api/admin/stats                        <- no ranged request sent

--- 2. valid range ---
lastCall  : /api/admin/stats?from=2026-08-10&to=2026-08-12
subtitle  : Performance for Aug 10, 2026 – Aug 12, 2026.
chart     : Daily order summary (3 bars)
horizScroll: false
  fits | Revenue in range      | ₱148,730.50   | 22 orders             | 23px
  fits | Total revenue         | ₱1,255,096.25 | 214 orders all-time   | 19px
  fits | Packing fees in range | ₱4,400        | ₱32,400 all-time      | 28px
  fits | Pending proofs        | 1             | Awaiting verification | 28px

--- 3. clear ---
subtitle  : Weekly & monthly performance at a glance.
chart     : Weekly order summary (7 bars)
clearBtn  : false
cards     : Orders this week | Orders this month | Total revenue |
            Total packing fees | Pending proofs
```

Browser console on `/admin` against the real API: clean, no warnings or errors.

## Coverage

```
npx vitest run --coverage.enabled \
  --coverage.include='app/admin/StatCard.tsx' \
  --coverage.include='app/admin/DateRangeFilter.tsx' \
  --coverage.include='app/admin/page.tsx' \
  --coverage.include='app/api/admin/stats/route.ts' \
  --coverage.include='lib/analytics.ts' \
  --coverage.include='lib/analytics-range.ts' \
  app/admin/page.test.tsx app/admin/StatCard.test.tsx \
  app/api/admin/stats/route.test.ts lib/analytics.test.ts

file                                stmts branch  funcs  lines
ALL FILES                            100  97.02    100    100
app/admin/DateRangeFilter.tsx        100    100    100    100
app/admin/StatCard.tsx               100  85.71    100    100
app/admin/page.tsx                   100  95.74    100    100
app/api/admin/stats/route.ts         100    100    100    100
lib/analytics-range.ts               100    100    100    100
lib/analytics.ts                     100    100    100    100
```

Against the 80% minimum, on every axis.

### Known gaps

- The uncovered branches are the `accent` fallback in `StatCard` and the
  `error instanceof Error` fallback on the dashboard's error card — both
  defensive defaults with no distinct behaviour to assert.
- The day-by-day chart hides its per-bar labels above 14 bars, so a long range
  stays legible. There is no test for that threshold; it is a presentation
  detail with no correctness consequence, verified by eye in the browser pass.
- The picker offers no presets ("last 7 days", "this month"). Not asked for; the
  request was to choose the dates.

---

# Follow-up cycle: one revenue headline, not two

## Source plan

Derived from the reported symptom, 2026-08-28: *"the dashboard element is
still not responsive most importantly the total revenue and it cant be filtered
out by custom dates to see the revenue in the custom dates."*

Two findings, both established before any code changed:

1. **The report came from production, which has none of this work.** `origin/main`
   has no `DateRangeFilter`, no `lib/analytics-range.ts`, no extracted
   `StatCard.tsx`; its stat value is a hard `text-[28px]` in a fixed
   `xl:grid-cols-5` row. `₱1,925,496.25` measures ~185px in a 128px card box
   there, so it spills — and there is no picker to filter with. Both reported
   symptoms are explained by the branch being unshipped, not by a defect in it.
2. **One real defect survived on the branch.** Filtering rendered *two* revenue
   cards — a scoped `Revenue in range`, and the lifetime figure still sitting
   under `Total revenue`. The card an admin actually watches never moved.

Finding 1 is a release question and is out of scope for this cycle. Finding 2 is
the cycle below.

## User journey

> As an admin, I want the revenue figure I already watch to change when I pick a
> date range, so that I can read revenue for those dates without first learning
> which of two similar cards is the live one.

## Task report

### Collapse the two revenue cards into one scoped card

The filtered row no longer emits a separate range card. `Total revenue` keeps
its slot and its label, takes `totals.range.revenue` whenever a range is served,
and moves the lifetime total down to its sub line (`6 orders · ₱1,925,496.25
all-time`) so the range stays readable against the whole. The filtered row drops
from four tiles to three (`xl:grid-cols-3`), which also gives the widest figure
appreciably more room than the five-tile default.

Validation: `npx vitest run app/admin/page.test.tsx`

RED — failing for the intended reason, the second card:

```
× moves the revenue headline itself to the range, rather than standing a second
  card beside it
  → expect(element).not.toBeInTheDocument()
    expected document not to contain element, found <div ...>Revenue in range</div>
 Tests  1 failed | 11 passed (12)
```

GREEN:

```
✓ app/admin/StatCard.test.tsx (4 tests)
✓ app/admin/page.test.tsx (12 tests)
 Tests  16 passed (16)
```

Guaranteed by the passing test: with a range served, exactly one revenue card
renders; it is labelled `Total revenue`; it shows the range figure and not the
lifetime one; and the lifetime total survives as sub-line context.

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | A served range puts the range revenue under `Total revenue`, not the lifetime figure | `app/admin/page.test.tsx:moves the revenue headline itself to the range…` | unit | PASS | `npx vitest run app/admin/page.test.tsx` |
| 2 | No second `Revenue in range` card renders alongside it | same test | unit | PASS | same |
| 3 | The lifetime total is retained as `N orders · ₱X all-time` context | same test | unit | PASS | same |
| 4 | The unfiltered dashboard still shows the standing week/month/all-time cards | `app/admin/page.test.tsx:starts unfiltered…` | unit | PASS | same |
| 5 | Clearing the range restores the unfiltered row | `app/admin/page.test.tsx:returns to the unfiltered dashboard…` | unit | PASS | same |

## Browser verification

Live dev server on :3000 (PGlite, one order of ₱4,555 dated Wed), reading the
rendered card text at each step:

| State | `TOTAL REVENUE` card |
|---|---|
| Unfiltered | `₱4,555` · 1 orders all-time |
| 2026-08-01 → 2026-08-31 (contains the order) | `₱4,555` · 1 orders · ₱4,555 all-time |
| 2026-01-01 → 2026-01-31 (contains none) | `₱0` · 0 orders · ₱4,555 all-time |

The headline moves, and only one revenue card is present in the filtered states.

API, via the authenticated page session:

```
?from=2026-08-01&to=2026-08-31 → 200 range {count: 1, revenue: 4555}
?from=2026-01-01&to=2026-01-31 → 200 range {count: 0, revenue: 0}
?from=2026-08-31&to=2026-08-01 → 400 "The end date must be on or after the start date."
```

## Full suite

```
npx vitest run app/admin/ app/api/admin/stats/ lib/
 Test Files  129 passed (129)
      Tests  1451 passed (1451)
```

## Known gaps

- **Unshipped.** These commits live on `feat/group-buy-page`, 19 ahead of
  `origin/main`. Production still shows the pre-fix dashboard. The three
  dashboard commits (`16f3d53`, `73446a3`, `af402c0`) plus this cycle's two
  touch only dashboard/analytics files and depend on nothing else from the
  branch — `isValidYmd`, `dateRangeBounds` and `formatDateRange` are already on
  `main` — so they cherry-pick cleanly without dragging in the campaign-form
  changes that conflict with `feat/group-buy-section`.
- **Unfiltered slack is thin.** In the five-tile default row, `₱1,925,496.25`
  steps down to 19px and measures 126px inside a 128px box — it fits, and
  `break-words` means anything larger wraps rather than clips. A figure of
  `₱10,000,000.00` or beyond would wrap to two lines. Not corrected here; the
  filtered row's three-tile layout is unaffected.

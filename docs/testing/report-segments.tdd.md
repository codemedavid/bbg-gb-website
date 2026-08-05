# TDD evidence — splitting the weekly report into On-Hand and Group Buy / Kahati

**Source plan**: written inline during `/ecc:plan` on 2026-08-05 (no `*.plan.md` artifact).
**Branch**: `feat/group-buy-page`
**Scope decided with the user**: two separate `.xlsx` files, two buckets (on-hand vs
kahati + group buy + MOQ combined), split applied to both the on-page Reports view
and the downloads.

## Why

The Product Totals sheet is what the batch order is sized from, and it carried
on-hand sales alongside the vials still owed to the supplier. On-hand stock has
already left the stockroom — counting it toward the kits to order buys it twice.
This is the same class of defect as the 10x kahati kit over-count fixed in
`71d1d57`, one level up: right arithmetic, wrong population.

## User journeys

1. As the admin placing the weekly batch order, I want a Group Buy / Kahati report
   holding only pre-ordered vials, so the kit counts I order from are not inflated
   by stock that already shipped.
2. As the admin reviewing on-hand sales, I want an On-Hand report holding only
   ready-stock orders, so its revenue and unit counts stand on their own.
3. As the admin, I want each half to download as its own workbook, so I can hand
   the batch-order file to whoever places the order without on-hand rows in it.
4. As the admin, I want the on-page Reports view to match the files I download.

## Task report

### Task 1 — Classification rule (`lib/report/segment.ts`)

Decides which half an order belongs to. Reads `orders.buy_type` first and the
`order_items.kind` of its lines as a fallback, because `buy_type` is NOT NULL with
a `'solo'` default: a row written before that column was populated reads as
on-hand even when its lines are hatian vials.

- Command: `npx vitest run lib/report/segment.test.ts`
- RED: `Error: Failed to load url ./segment … Does the file exist?` — 0 tests collected
- GREEN: `✓ lib/report/segment.test.ts (11 tests)` — `Tests 11 passed (11)`
- Commits: `5df03f4` (RED) → `f171e4e` (GREEN)

### Task 2 — Segmented builder (`buildSegmentedWeeklyReport`)

Partitions the week and calls the existing `buildWeeklyReport` twice, so row
numbering, paid/pending counts, the cancelled-order exclusion and the kit rollup
cannot drift between halves. The combined builder is untouched.

- Command: `npx vitest run lib/report/build.test.ts`
- RED: `Tests 7 failed | 6 passed (13)` — `TypeError: buildSegmentedWeeklyReport is not a function`.
  The 6 passing are the pre-existing combined-report assertions, unmodified.
- GREEN: `Tests 13 passed (13)`; `lib/report` suite `84 passed (84)`
- Commits: `34f4555` (RED) → `25e7b27` (GREEN)

### Task 3 — Endpoint (`GET /api/admin/report/weekly`)

Selects `orders.buy_type` and `order_items.kind` so the rule can see both signals,
and returns `segments` alongside the existing combined `report`. Integration test
runs against real PGlite through the actual route — the pure builder cannot see
the join that feeds it.

- Command: `npx vitest run app/api/admin/report/weekly/`
- RED: `Tests 7 failed | 1 passed (8)` — `Cannot read properties of undefined (reading 'groupbuy')`.
  The 1 passing is the back-compat check that `report` is still returned.
- GREEN: `Test Files 3 passed (3)`, `Tests 20 passed (20)` — segments, kahati-kits and
  product-totals suites together
- Commits: `86bfbf7` (RED) → `c5898fe` (GREEN)

### Task 4 — Per-segment workbooks (`lib/report/weekly-xlsx.ts`)

Filenames gain an `-onhand` / `-groupbuy` suffix; sheet tabs gain a segment label.

- Command: `npx vitest run lib/report/weekly-xlsx.test.ts lib/report/weekly-xlsx-download.test.ts`
- RED: `Tests 3 failed | 28 passed (31)` — sheet name ignored the segment and both
  halves downloaded as the same `BBG-Week-<date>.xlsx`
- GREEN: `lib/report` suite `90 passed (90)`
- Commits: `4d69164` (RED) → `43549e5` (GREEN)

Constraint found while implementing: Excel rejects `/ \ ? * [ ]` in a worksheet name
and truncates past 31 characters, so the display label "Group Buy / Kahati" cannot be
used verbatim on a tab — hence `SEGMENT_SHORT_LABEL`. Pinned by a test that asserts
both properties for every segment.

### Task 5 — UI (`/admin/reports`, Orders toolbar)

Each half is its own `region` with its own rollups and its own download button.

- Commands: `npx vitest run app/admin/reports/`, `npx vitest run app/admin/orders/WeeklyReportButton.test.tsx`
- RED: reports page `Tests 4 failed | 1 passed (5)`; WeeklyReportButton `5/5 failed`
  (`Unable to find an accessible element with the role "button" and name /on-hand/i`)
- GREEN: `app/admin/reports` `13 passed (13)`; `WeeklyReportButton` `5 passed (5)`
- Commits: `a9d6595`, `5ca8089` (RED) → `f24374f` (GREEN) → `cbb0f72` (refactor)

One test correction during this task: the page-level download assertion expected the
Monday from the mocked response, but the page picks its own week and defaults to the
most recent full one. The test was wrong, not the component; it now derives the
expected Monday from `mostRecentFullWeekMonday`.

Two buttons rather than one firing both downloads: Chrome raises a "Download multiple
files" prompt on a second programmatic download, and a blocked one fails silently.

## Test specification

| # | What is guaranteed | Test file / name | Type | Result |
|---|---|---|---|---|
| 1 | A solo order files under on-hand; kahati / group_buy / moq file under group buy | `lib/report/segment.test.ts:segmentOfOrder` | unit | PASS |
| 2 | An order whose `buy_type` is a defaulted `'solo'` but whose lines are hatian vials still files under group buy | `lib/report/segment.test.ts:overrides a defaulted solo buy type…` | unit | PASS |
| 3 | Partitioning loses no order, duplicates none, and preserves row order within each half | `lib/report/segment.test.ts:partitionBySegment` | unit | PASS |
| 4 | The batch-order rollup names only pre-ordered lines — no on-hand stock | `lib/report/build.test.ts:keeps the batch-order rollup free of on-hand stock` | unit | PASS |
| 5 | The on-hand rollup names only on-hand lines | `lib/report/build.test.ts:keeps the on-hand rollup free of pre-ordered vials` | unit | PASS |
| 6 | Counts, money totals and the cancelled-order exclusion apply per half | `lib/report/build.test.ts:counts and totals each half independently` / `still excludes cancelled orders…` | unit | PASS |
| 7 | Each half numbers its rows from 1 | `lib/report/build.test.ts:numbers each half from 1…` | unit | PASS |
| 8 | The endpoint files an on-hand and a hatian order on opposite sides, through the real join | `app/api/admin/report/weekly/segments.test.ts:files an on-hand order and a hatian order on opposite sides` | integration | PASS |
| 9 | On-hand stock never reaches the batch-order rollup end to end | `…segments.test.ts:keeps on-hand stock out of the batch-order rollup` | integration | PASS |
| 10 | The 10x kahati kit fix survives the split (109 vials → 10.9 kits) | `…segments.test.ts:still divides a hatian line by its supplier kit size within its half` | integration | PASS |
| 11 | A one-sided week returns the other half empty, not absent | `…segments.test.ts:leaves the other half empty rather than absent…` | integration | PASS |
| 12 | A legacy order with a defaulted buy type is filed by its line kinds | `…segments.test.ts:files a legacy order with a defaulted buy type…` | integration | PASS |
| 13 | The combined `report` is still returned for existing consumers | `…segments.test.ts:still returns the whole week under \`report\`` | integration | PASS |
| 14 | Each half downloads under its own filename, so neither overwrites the other | `lib/report/weekly-xlsx-download.test.ts:stamps the segment into the filename…` | unit | PASS |
| 15 | Segment sheet names stay legal and ≤31 chars, so the workbook opens | `lib/report/weekly-xlsx.test.ts:keeps a segment sheet name legal…` | unit | PASS |
| 16 | Each workbook still carries its own Product Totals sheet | `lib/report/weekly-xlsx.test.ts:still carries its own Product Totals sheet` | unit | PASS |
| 17 | The page renders one labelled region per half, each holding only its own data | `app/admin/reports/page.test.tsx:keeps each half's orders and product totals inside its own section` | component | PASS |
| 18 | Each page button downloads its own half under its own segment | `app/admin/reports/page.test.tsx:downloads each half as its own workbook` | component | PASS |
| 19 | A half with no orders disables only its own button | `app/admin/reports/page.test.tsx:disables only the button…` | component | PASS |
| 20 | The Orders toolbar downloads each half separately and surfaces failures as toasts | `app/admin/orders/WeeklyReportButton.test.tsx` | component | PASS |

## Full-suite and build verification

```
npm test          → Test Files 140 passed (140), Tests 1346 passed (1346)
npx tsc --noEmit  → exit 0
npx next build    → succeeded; /admin/reports 117 kB, /admin/orders 121 kB first-load JS
```

ExcelJS remains dynamically imported — the admin bundles did not grow.

## Coverage

`npx vitest run --coverage lib/report/ app/admin/reports/ app/admin/orders/WeeklyReportButton.test.tsx app/api/admin/report/`

| Area | % Stmts | % Branch | % Funcs | % Lines |
|---|---|---|---|---|
| `lib/report` (incl. `segment.ts`, `build.ts`, `weekly-xlsx.ts`) | 100 | 95.69 | 100 | 100 |
| `app/api/admin/report/weekly/route.ts` | 100 | 69.23 | 100 | 100 |
| `app/admin/reports` | 99.51 | 87.80 | 91.66 | 99.51 |
| `app/admin/orders/WeeklyReportButton.tsx` | 100 | 93.33 | 75 | 100 |

All well above the 80% threshold. The route's uncovered branches are the `?week=`
parameter fallbacks and the null-coalescing on optional order columns, which
pre-date this change.

## Browser QA

Run on PGlite (`DATABASE_URL=` + `STORAGE_DRIVER=local`), never the prod Supabase in
`.env`. Seeded week 2026-07-27 with two on-hand orders (11 units) and one kahati
order (30 vials, kit size 10).

- `/admin/reports` rendered On-Hand (2 orders · ₱4,180 · 11 units) and
  Group Buy / Kahati (1 order · ₱27,000 · 30 units → **3 kits**) as separate
  sections. Neither section showed the other's rows.
- Both buttons downloaded successfully into the same folder without collision:
  `BBG-Week-2026-07-27-onhand.xlsx` and `BBG-Week-2026-07-27-groupbuy.xlsx`.
  Reopened with ExcelJS: sheets `On-Hand · Week 31 | Product Totals` (BBG-9002,
  BBG-9001) and `Group Buy · Week 31 | Product Totals` (BBG-9003, 30 qty / 3 kits).
- No console errors or warnings after both downloads.
- 768px: section headers stack, tiles reflow 2-up, tables scroll inside their own
  container, no horizontal page overflow.

One defect found only by the browser pass and not by any test: the two Orders-toolbar
buttons competed for the remaining width and wrapped mid-label ("On-" / "Hand").
Fixed in `cbb0f72` with `whitespace-nowrap`.

## Known gaps

- No Playwright E2E covers the download; the browser QA above was manual via
  Chrome DevTools. The download path itself is unit-tested end to end
  (`weekly-xlsx-download.test.ts` round-trips a real `.xlsx` buffer).
- The MOQ shelf (`buy_type = 'moq'`) is bucketed with group buy per the agreed
  two-bucket split. If the team places that shelf's orders separately, the rule
  lives in one function (`segmentOfOrder`) and a third bucket is a local change.

## Merge evidence

If these commits are squashed, the RED/GREEN record above is the surviving proof.
Checkpoint commits on `feat/group-buy-page`, oldest first:

```
5df03f4 test: reproducer for the on-hand / group-buy report split          (RED 1)
f171e4e feat: classify a weekly-report order as on-hand or group buy       (GREEN 1)
34f4555 test: reproducer for the segmented weekly report                   (RED 2)
25e7b27 feat: build the weekly report as two halves, on-hand and group buy (GREEN 2)
86bfbf7 test: reproducer for the split weekly-report endpoint              (RED 3)
c5898fe feat: serve the weekly report split into on-hand and group buy     (GREEN 3)
4d69164 test: reproducer for per-segment weekly workbooks                  (RED 4)
43549e5 feat: export each half of the weekly report as its own workbook    (GREEN 4)
a9d6595 test: reproducer for the split Reports page                        (RED 5a)
5ca8089 test: reproducer for the split Orders-page weekly export           (RED 5b)
f24374f feat: split the Reports page and Orders export into two halves     (GREEN 5)
cbb0f72 refactor: stop the segment download buttons breaking mid-label     (refactor)
```

# TDD evidence — weekly product totals

**Source plan**: inline `/ecc:plan` run on 2026-08-03, from
`~/Downloads/BRS-ProductTotals Batch 18 7pm 3-22-26.xlsx`. No `*.plan.md` artifact was written.

**Branch**: `feat/group-buy-page` · **Checkpoints**: `b13fe88` (RED) → `bc5a756` (GREEN)

## User journeys

1. As an admin, I want the weekly report to total each product's quantity and USD across the week,
   so I know how much of each item to order from the supplier.
2. As an admin, I want that quantity expressed in kits, so I can place the batch order in the unit
   the supplier actually sells in.
3. As an admin, I want the product totals inside the report I already download, so one file serves
   the whole weekly workflow.

## What the reference file decided

The sample is a flat CSV-style export (no fills, no widths, `#`-prefixed title lines). It was treated
as the **data contract**, not the styling contract — the new sheet matches the repo's existing
formatted output instead.

| Sample column | Source |
|---|---|
| `#` | rank after sorting |
| `Product` | `order_items.name_snapshot` |
| `Variant / Code` | `products.code` (left join) |
| `Specs` | `order_items.spec_snapshot` |
| `Total USD` | Σ `unit_price_usd × qty` |
| `Total Qty` | Σ `qty` |
| unlabeled 7th | `qty ÷ products.kit_size` — shipped as **Kits** |

The unlabeled column is `qty ÷ 10` for vialed peptides but `qty ÷ 1` for Lemon Bottle, Profhilo and
Restylane. No pack-size field existed, so `products.kit_size` was added (default 10, backfilled to 1
for `LB10, LB50, CK-LMB, CK-PRF, CK-RSTG, CK-RSTB`) and exposed on the admin product form.

## Task report

### 1. Pure rollup builder — `lib/report/product-totals.ts`

Grouping, ranking, kit conversion and cancelled-order exclusion, with no I/O.

- **RED** — `npx vitest run lib/report/product-totals.test.ts …`
  ```
  FAIL lib/report/product-totals.test.ts
  Error: Failed to load url ./product-totals … Does the file exist?
  ```
- **GREEN** — `npx vitest run lib/report` → `13 tests` passed in `product-totals.test.ts`.
- **Guarantees**: variants of one product stay separate rows; lines with no product row group by
  name+spec; ranking is deterministic; a null USD price contributes 0, never `NaN`.

### 2. Report wiring — `lib/report/build.ts`

`WeeklyReport` gained `productTotals`, so both renderers read one set of numbers.

- **RED** — `× buildWeeklyReport > attaches the per-product rollup alongside the per-order rows`
  → `Cannot read properties of undefined (reading 'rows')`
- **GREEN** — `npx vitest run lib/report/build.test.ts` → 6 passed.

### 3. Second worksheet — `lib/report/weekly-xlsx.ts`

- **RED** — 7 failures in `weekly-xlsx.test.ts`, all
  `TypeError: Cannot read properties of undefined (reading 'indexOf')` (no `PRODUCT_TOTALS_HEADERS`).
- **GREEN** — `npx vitest run lib/report/weekly-xlsx.test.ts` → 18 passed.
- **Guarantees**: the workbook carries two sheets with the order sheet first; product USD is a
  formatted number, not text; the `TOTAL` row sums USD and quantity.

### 4. On-page section — `app/admin/reports/ProductTotalsReport.tsx`

- **RED** — `Failed to resolve import "./ProductTotalsReport"`.
- **GREEN** — `npx vitest run app/admin/reports` → 6 passed in `ProductTotalsReport.test.tsx`,
  plus a new page-level spec asserting the section renders beneath the Order Summary.

### 5. Schema + route join — `products.kit_size`

**This slice was implemented before its test**, so it had no natural RED. Verified by mutation
instead: blanking the join in `route.ts` (`kitSize: it.kitSize` → `kitSize: null`) and re-running.

```
× weekly report product totals > divides quantity by the kit size stored on the product
× weekly report product totals > defaults kit size to 10 for products created without one
  Tests  2 failed | 4 passed (6)
```

Restored, re-verified `6 passed (6)`. The specs fail when the seam breaks, which is what the RED
gate exists to prove.

> `npx drizzle-kit generate` was **not** used for the migration. Its snapshot is stale relative to
> the hand-written `0011_kahati_within_cap.sql` / `0012_scheduled_open.sql` (neither is in
> `meta/_journal.json`), so it re-emitted already-applied DDL under a colliding `0011` filename.
> Since `lib/test/harness.ts` applies every `.sql` in sorted order, that would have double-applied
> the `scheduled` enum values. The generated file and its snapshot were removed and
> `0013_product_kit_size.sql` hand-written to match the existing idempotent convention.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | The same product across separate orders sums into one row | `lib/report/product-totals.test.ts:sums qty and USD for the same product across separate orders` | unit | PASS |
| 2 | TR15 and TR30 stay distinct rows | `…:keeps two variants of the same product name as separate rows` | unit | PASS |
| 3 | Kahati/MOQ lines with no product row group by name+spec | `…:groups items with no linked product by name and spec` | unit | PASS |
| 4 | Rows rank by quantity descending, numbered from 1 | `…:ranks rows by total qty descending and numbers them from 1` | unit | PASS |
| 5 | Ties resolve by USD then name, so order is stable run to run | `…:breaks a qty tie by USD descending, then by name` | unit | PASS |
| 6 | 270 vials at kit size 10 reads 27 kits; 33 at kit size 1 reads 33 | `…:converts qty into kits using the product kit size` | unit | PASS |
| 7 | A partial kit reports as a fraction, not rounded away | `…:reports a partial kit as a fraction` | unit | PASS |
| 8 | An item with no known kit size counts one kit per unit | `…:counts an item with no known kit size as one kit per unit` | unit | PASS |
| 9 | Cancelled orders never reach the rollup | `…:excludes cancelled orders from the rollup` | unit | PASS |
| 10 | A missing USD price contributes 0, not NaN | `…:treats a missing USD price as zero rather than NaN` | unit | PASS |
| 11 | The rollup rides on `WeeklyReport` beside the order rows | `lib/report/build.test.ts:attaches the per-product rollup alongside the per-order rows` | unit | PASS |
| 12 | The workbook carries a second sheet, order sheet first | `lib/report/weekly-xlsx.test.ts:adds the product rollup as a second sheet…` | integration | PASS |
| 13 | Product USD is a number with a currency format, not text | `…:writes product USD as a number with a currency format` | integration | PASS |
| 14 | The sheet closes with a TOTAL row summing USD and qty | `…:closes with a TOTAL row summing USD and quantity` | integration | PASS |
| 15 | An empty week still produces a valid sheet | `…:still produces the sheet when the week has no orders` | integration | PASS |
| 16 | `kit_size` reaches the rollup through the product join | `app/api/admin/report/weekly/product-totals.test.ts:divides quantity by the kit size stored on the product` | integration | PASS |
| 17 | The price-list code survives the join | `…:carries the price-list code through the product join` | integration | PASS |
| 18 | A product created without a kit size defaults to 10 | `…:defaults kit size to 10 for products created without one` | integration | PASS |
| 19 | Cancelled orders stay out end-to-end, not just in the builder | `…:leaves cancelled orders out of the rollup` | integration | PASS |
| 20 | The section renders under the Order Summary on the reports page | `app/admin/reports/page.test.tsx:renders the product totals section beneath the order summary` | component | PASS |
| 21 | Each product renders with code, specs, quantity and kits | `app/admin/reports/ProductTotalsReport.test.tsx:renders one row per product…` | component | PASS |
| 22 | An empty week shows an empty state, not a blank table | `…:shows an empty state when no products sold that week` | component | PASS |

## Coverage

`npx vitest run --coverage lib/report app/admin/reports app/api/admin/report`

```
File               | % Stmts | % Branch | % Funcs | % Lines
 lib/report        |     100 |    94.87 |     100 |     100
  money.ts         |     100 |      100 |     100 |     100
 app/admin/reports |   94.28 |    92.59 |      80 |   94.28
```

Both above the 80% floor. The `All files` figure in that run is ~11% only because coverage is
configured with `all: true` while three directories were exercised — it is not a project-wide number.

Full suite: `npx vitest run` → **1004 passed across 110 files**. `npx tsc --noEmit` → clean.

## Known gaps

- **The migration is not applied anywhere yet.** `npm run db:check` reported
  `SKIPPED — DATABASE_URL is not set`, so drift against prod is unverified from this worktree.
  `0013_product_kit_size.sql` must be applied before the reports page is opened in production, or
  the product join will 500 on the missing column.
- **The `kit_size = 1` backfill is a starting list**, derived from the six per-piece codes visible in
  the reference file. It is not an audit of the whole catalogue. A product that ships per piece but
  was not in that week reads 10× low on Kits until someone edits the field.
- **No browser QA yet.** The section has component and route coverage but has not been opened
  against a seeded PGlite instance (`DATABASE_URL=` + `STORAGE_DRIVER=local`).
- **Week numbering differs from the sample.** The reference file's title says *Week 11* for
  Mon Mar 16 2026; `isoWeekNumber` computes **Week 12** (ISO week 1 of 2026 begins Mon Dec 29 2025).
  The repo's existing function was reused so the new sheet cannot disagree with the order sheet
  beside it. If the team's "Week 11" convention is the intended one, that is a separate change to
  `lib/report/week.ts` affecting both reports.
- **Slice 5 had no natural RED**, as recorded above; mutation testing was substituted.

## Merge evidence

If these commits are squashed: RED was `b13fe88` (8 failed | 16 passed across 4 files, failing on
unresolved `product-totals` / `ProductTotalsReport` modules and an undefined `productTotals`), GREEN
was `bc5a756` (1004 passed across 110 files, tsc clean), and the schema/route slice was
mutation-verified rather than RED-first.

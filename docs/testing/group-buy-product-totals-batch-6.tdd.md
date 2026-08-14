# Group Buy Product Totals — Batch 6 TDD Evidence

## Source plan

- [`docs/plan/group-buy-product-totals-batch-6.md`](../plan/group-buy-product-totals-batch-6.md)
- Reference supplied during development: `BBG-ProductTotals Batch 6.xlsx` (kept outside Git as a local reference file).

## User journeys

1. As an operations admin, I want the Group Buy Excel download to match the Batch 6 Product Totals workbook, so I can send it to the supplier without manually rearranging it.
2. As an operations admin, I want the title, reporting range, order count, units, products, kit quantities, USD totals, and raw quantities populated from the selected report, so the workbook is immediately usable.
3. As an On-Hand report user, I want the existing On-Hand workbook to remain unchanged, so the supplier-specific Group Buy layout does not disrupt fulfilment reporting.

## Task report

### Step 1 — Specify the Batch 6 workbook contract

- Added ExcelJS write/read round-trip assertions for the one-sheet layout, sheet name, title and summary rows, row-3 headers, widths, hidden columns, product values, totals, font, fill, and borders.
- RED command: `npm test -- lib/report/weekly-xlsx.test.ts`
- RED evidence: the target executed 31 tests; 8 failed for the intended missing behavior. The failures showed two worksheets instead of one, the old row-1 header, old widths, missing Batch 6 rows, green instead of black fill, missing Batch 6 totals, and the old Group Buy sheet name.
- RED checkpoint: `aab9191 test: add Batch 6 group-buy export contract`

### Step 2 — Implement the Group Buy-only workbook

- Added a Group Buy-specific workbook path that produces only `BBG-ProductTotals`, while preserving the existing On-Hand and unsegmented workbook paths.
- Product aggregation remains authoritative: the visible quantity is the computed supplier-kit quantity, while hidden columns retain USD and raw unit quantities.
- GREEN command: `npm test -- --no-file-parallelism --cache=false lib/report/weekly-xlsx.test.ts`
- GREEN evidence: `31 passed (31)` after a real XLSX write/read round trip.
- GREEN checkpoint: `9a8b034 feat: match Batch 6 group-buy product totals export`

### Step 3 — Verify compatibility and regression safety

- Report regression command: `npm test -- --no-file-parallelism --cache=false lib/report app/admin/reports app/admin/orders/WeeklyReportButton.test.tsx`
- Result: `12 passed` test files and `119 passed` tests.
- Download/UI regression command: `npm test -- --no-file-parallelism --cache=false lib/report/weekly-xlsx.test.ts lib/report/weekly-xlsx-download.test.ts app/admin/reports/page.test.tsx app/admin/orders/WeeklyReportButton.test.tsx`
- Result: `4 passed` test files and `51 passed` tests.
- Full-suite command: `env POSTHOG_KEY= NEXT_PUBLIC_POSTHOG_KEY= npm test -- --no-file-parallelism --cache=false`
- Result: `178 passed` test files and `1844 passed` tests. Existing React `act(...)` and unavailable persisted-storage warnings were emitted but did not fail tests.
- Build command: `npm run build`
- Result: Next.js production compilation, type checking, static generation, and build tracing completed successfully.

## Test specification

| # | What is guaranteed | Test target | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | Group Buy exports exactly one worksheet named `BBG-ProductTotals` | `weekly-xlsx.test.ts: exports one BBG-ProductTotals worksheet` | Integration | PASS | 31/31 focused workbook tests |
| 2 | Title, order/unit summary, and headers occupy rows 1–3 | `weekly-xlsx.test.ts: places the title, summary and visible headers` | Integration | PASS | ExcelJS round trip |
| 3 | Column widths and hidden USD/raw-unit helper columns match the Batch 6 view | `weekly-xlsx.test.ts: matches the Batch 6 column widths and hidden helper columns` | Integration | PASS | ExcelJS round trip |
| 4 | Product rows preserve names, codes, specs, kits, USD, and raw units | `weekly-xlsx.test.ts: writes product rows as kits, USD and hidden raw units` | Integration | PASS | Numeric cell assertions |
| 5 | Black fill, white bold Aptos Narrow text, borders, and TOTAL styling match the reference | `weekly-xlsx.test.ts: uses the reference black, white-bold table styling and borders` | Integration | PASS | Serialized style assertions |
| 6 | Empty Group Buy reports still produce a valid Batch 6 workbook | `weekly-xlsx.test.ts: closes with the Batch 6 TOTAL row and remains valid when empty` | Edge case | PASS | ExcelJS round trip |
| 7 | On-Hand still exports its existing two-sheet workbook | `weekly-xlsx.test.ts: keeps the current two-sheet On-Hand workbook unchanged` | Regression | PASS | Focused workbook suite |
| 8 | Browser downloads retain segment/date filename behavior and cleanup | `weekly-xlsx-download.test.ts` | Browser integration | PASS | 8/8 download tests |
| 9 | Admin report buttons still invoke the correct segment download | `app/admin/reports/page.test.tsx`, `WeeklyReportButton.test.tsx` | UI integration | PASS | 12/12 UI tests |

## Coverage and known gaps

- Coverage command: `npm test -- --no-file-parallelism --cache=false --coverage --coverage.include=lib/report/weekly-xlsx.ts lib/report/weekly-xlsx.test.ts lib/report/weekly-xlsx-download.test.ts app/admin/reports/page.test.tsx app/admin/orders/WeeklyReportButton.test.tsx`
- `lib/report/weekly-xlsx.ts`: 99.47% statements, 90.32% branches, 100% functions, and 99.47% lines.
- A real desktop Excel application was not automated; compatibility is validated by serializing and reopening the workbook with ExcelJS.
- `npm run build` skipped the database drift comparison because `DATABASE_URL` was unset. This feature has no schema changes, and the remainder of the production build passed.

## Merge evidence

- RED: commit `aab9191` contains the failing Batch 6 contract; 8 intended failures were observed before production changes.
- GREEN: commit `9a8b034` contains the implementation; the same target then passed 31/31.
- Final validation: focused coverage exceeded 80%, report regressions passed 119/119, the full repository passed 1844/1844, and the production build completed.

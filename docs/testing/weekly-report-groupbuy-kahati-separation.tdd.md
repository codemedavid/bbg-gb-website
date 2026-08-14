# Weekly Group Buy and Kahati report separation TDD evidence

## User journey and interpretation

No plan file was supplied. The request was interpreted as: as an admin, I want Group Buy and Kahati orders presented as separate report sections and downloads so that each order mode can be reviewed and exported independently.

## RED

- Added report-builder and API assertions requiring the order `buyType` to survive into report rows.
- Added a real XLSX round-trip test requiring dedicated `Group Buy` and `Kahati` worksheets, named Excel Tables, isolated invoices, and independent totals.
- Command: `npm test -- lib/report/build.test.ts lib/report/weekly-xlsx.test.ts app/api/admin/report/weekly/route.test.ts --reporter=verbose`.
- Result: **RED**, 3 intended failures: `buyType` was absent from builder/API output and the dedicated workbook tables did not exist.
- Checkpoint: `02c2679 test: require separate group buy and kahati reports`.

## GREEN

- Carried the database order mode through the weekly API and report model.
- After integrating the newer report architecture from `origin/main`, the API and admin UI expose three independent segments: On-Hand, Group Buy, and Kahati.
- Group Buy retains its canonical supplier product-totals workbook. Kahati downloads an independent order workbook with the `KahatiOrders` pivot-ready table, product codes, and packing-fee column.
- Each segment renumbers its rows and calculates independent paid/pending/cancelled counts and monetary totals while excluding cancelled orders from money totals.
- Command: `npm test -- lib/report/build.test.ts lib/report/weekly-xlsx.test.ts app/api/admin/report/weekly/route.test.ts --reporter=verbose`.
- Result: **GREEN**, 3 files and 20 tests passed.
- Checkpoint: `8d4698d feat: separate group buy and kahati report sheets`.

## Guarantees

| Guarantee | Test | Type | Result |
|---|---|---|---|
| Order mode survives from the API database row into the report | `route.test.ts` and `build.test.ts` | Integration/unit | PASS |
| Group Buy and Kahati orders appear in different API/UI report segments | `segment.test.ts`, `segments.test.ts`, `page.test.tsx` | Unit/integration/component | PASS |
| Group Buy retains its canonical supplier totals workbook | `weekly-xlsx.test.ts` | Real XLSX round trip | PASS |
| Kahati exports its own pivot-ready order workbook | `weekly-xlsx.test.ts` | Real XLSX round trip | PASS |
| Each separated report carries its own counts and money totals | `build.test.ts`, `segments.test.ts` | Unit/integration | PASS |

## Coverage and validation

- Coverage command: `npm test -- lib/report --coverage --coverage.include=lib/report/build.ts --coverage.include=lib/report/weekly-xlsx.ts --reporter=verbose`.
- Result: **PASS**, 7 files and 52 tests passed; 99.46% statements/lines, 86.95% branches, and 100% functions.
- TypeScript command: `npx tsc --noEmit`.
- Result: **PASS**.
- Admin/API regression command: `npm test -- app/admin/reports/OrderSummaryReport.test.tsx app/admin/reports/page.test.tsx app/api/admin/report/weekly/route.test.ts --reporter=verbose`.
- Result: **PASS**, 3 files and 4 tests passed.
- No feature tests are skipped or disabled.

## Main-branch integration

- Merged the 106 newer `origin/main` commits without force-pushing and resolved seven overlapping report files against main's date-range, segment, and product-total architecture.
- Validation command: `npm test -- lib/report/segment.test.ts lib/report/build.test.ts lib/report/product-codes.test.ts lib/report/weekly-xlsx.test.ts app/api/admin/report/weekly/segments.test.ts app/api/admin/report/weekly/route.test.ts app/admin/reports/page.test.tsx app/admin/reports/OrderSummaryReport.test.tsx app/admin/orders/WeeklyReportButton.test.tsx --reporter=dot`.
- Result: **PASS**, 9 files and 89 tests passed.
- TypeScript: `npx tsc --noEmit` — **PASS**.

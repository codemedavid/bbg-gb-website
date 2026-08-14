# Weekly Group Buy and Kahati report separation TDD evidence

## User journey and interpretation

No plan file was supplied. The request was interpreted as: as an admin, I want Group Buy and Kahati orders separated in the downloaded weekly workbook so that each order mode can be reviewed and pivoted independently, while retaining the complete weekly report.

## RED

- Added report-builder and API assertions requiring the order `buyType` to survive into report rows.
- Added a real XLSX round-trip test requiring dedicated `Group Buy` and `Kahati` worksheets, named Excel Tables, isolated invoices, and independent totals.
- Command: `npm test -- lib/report/build.test.ts lib/report/weekly-xlsx.test.ts app/api/admin/report/weekly/route.test.ts --reporter=verbose`.
- Result: **RED**, 3 intended failures: `buyType` was absent from builder/API output and the dedicated workbook tables did not exist.
- Checkpoint: `02c2679 test: require separate group buy and kahati reports`.

## GREEN

- Carried the database order mode through the weekly API and report model.
- Preserved the complete `Week N` worksheet and its `WeeklyOrders` table.
- Added `Group Buy` / `GroupBuyOrders` and `Kahati` / `KahatiOrders` worksheet-table pairs.
- Each dedicated worksheet filters to its own mode, renumbers its rows, and calculates independent paid/pending/cancelled counts and monetary totals while excluding cancelled orders from money totals.
- Command: `npm test -- lib/report/build.test.ts lib/report/weekly-xlsx.test.ts app/api/admin/report/weekly/route.test.ts --reporter=verbose`.
- Result: **GREEN**, 3 files and 20 tests passed.
- Checkpoint: `8d4698d feat: separate group buy and kahati report sheets`.

## Guarantees

| Guarantee | Test | Type | Result |
|---|---|---|---|
| Order mode survives from the API database row into the report | `route.test.ts` and `build.test.ts` | Integration/unit | PASS |
| The original complete weekly sheet remains available | `weekly-xlsx.test.ts` | Real XLSX round trip | PASS |
| Group Buy orders appear only on the Group Buy sheet | `weekly-xlsx.test.ts` | Real XLSX round trip | PASS |
| Kahati orders appear only on the Kahati sheet | `weekly-xlsx.test.ts` | Real XLSX round trip | PASS |
| Both separated sheets are named Excel Tables ready for PivotTable use | `weekly-xlsx.test.ts` | Real XLSX round trip | PASS |
| Each separated report carries its own PHP total | `weekly-xlsx.test.ts` | Integration | PASS |

## Coverage and validation

- Coverage command: `npm test -- lib/report --coverage --coverage.include=lib/report/build.ts --coverage.include=lib/report/weekly-xlsx.ts --reporter=verbose`.
- Result: **PASS**, 7 files and 52 tests passed; 99.46% statements/lines, 86.95% branches, and 100% functions.
- TypeScript command: `npx tsc --noEmit`.
- Result: **PASS**.
- Admin/API regression command: `npm test -- app/admin/reports/OrderSummaryReport.test.tsx app/admin/reports/page.test.tsx app/api/admin/report/weekly/route.test.ts --reporter=verbose`.
- Result: **PASS**, 3 files and 4 tests passed.
- No feature tests are skipped or disabled.

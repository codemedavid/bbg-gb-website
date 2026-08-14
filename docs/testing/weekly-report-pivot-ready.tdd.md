# Pivot-ready weekly Excel report TDD evidence

## Source and journey

No plan file was supplied. The journey was derived from the request: as an admin, I want the downloaded weekly Excel orders to be a valid PivotTable source so that I can analyze fields without rebuilding the source range.

## RED

- Added a real workbook round-trip assertion requiring a named `WeeklyOrders` Excel Table.
- Command: `npm test -- lib/report/weekly-xlsx.test.ts --reporter=verbose`.
- Result: **RED**, 1 of 13 tests failed because `sheet.getTable('WeeklyOrders')` returned `undefined`; the other 12 workbook tests passed.
- Checkpoint: `6b6e595 test: require pivot-ready weekly orders table`.

## GREEN

- Changed the loose header/data range into the named Excel Table `WeeklyOrders` with filters and striped rows.
- Kept the custom report totals row outside the table so a PivotTable cannot treat it as an order.
- Preserved numeric money cells, column widths, wrapping, frozen header, download behavior, and empty-report handling.
- Command: `npm test -- lib/report/weekly-xlsx.test.ts --reporter=verbose`.
- Result: **GREEN**, 13 of 13 tests passed.
- Checkpoint: `0b22651 feat: make weekly report pivot ready`.

## Guarantees

| Guarantee | Test | Type | Result |
|---|---|---|---|
| The downloaded workbook contains a named `WeeklyOrders` table | `weekly-xlsx.test.ts: stores the order range as a named Excel table` | Integration / real XLSX round-trip | PASS |
| The table contains the header and order rows but excludes the totals row | Same test; serialized table range is `A1:P3` for two orders | Integration | PASS |
| All report columns, including `Packing Fee (PHP)`, are table fields | Same test compares serialized columns with `XLSX_HEADERS` | Integration | PASS |
| Existing workbook layout and money behavior remain intact | Remaining 12 workbook tests | Regression | PASS |

## Coverage and validation

- Command: `npm test -- lib/report --coverage --coverage.include=lib/report/build.ts --coverage.include=lib/report/weekly-xlsx.ts --silent`.
- Result: **PASS**, 6 files and 47 tests passed; 100% statements, 82.35% branches, 100% functions, and 100% lines.
- Command: `./node_modules/.bin/tsc --noEmit`.
- Result: **PASS**.
- No feature tests are skipped or disabled.

## Merge evidence

- RED: `6b6e595` — the workbook had no named table.
- GREEN: `0b22651` — the workbook reopened with `WeeklyOrders` and all workbook tests passed.

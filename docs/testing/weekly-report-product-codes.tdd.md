# Weekly report product-code TDD evidence

## User journey

As an admin, I want every catalog-backed item in the weekly order report to show its Cat. No. so that the downloaded Excel file can be filtered and used as a PivotTable source without looking codes up manually.

## RED

- Added resolver tests for authoritative replacement codes, previously blank codes, legacy-code fallback, and uncoded free-text products.
- Added builder, API integration, and real XLSX round-trip assertions for product codes.
- Command: `npm test -- lib/report/product-codes.test.ts lib/report/build.test.ts lib/report/weekly-xlsx.test.ts app/api/admin/report/weekly/route.test.ts --reporter=verbose`.
- Result: **RED**. All four test files failed for the intended missing behavior: no resolver module, no `productCodes` report field, no Excel column, and no API code resolution.
- Checkpoint: `e7d678d test: add product code report RED coverage`.

## GREEN

- Added the supplied Cat. Nos. as report-level mappings keyed by normalized product name and specification. These mappings supersede older catalog codes; products outside the supplied list retain a stored code, while genuinely uncoded free-text items remain blank.
- The weekly API resolves codes for direct catalog items, catalog-linked Hatian items, and MOQ products in the existing batched line-item query.
- Added a `Product Codes` Excel Table field. Multiple codes use one wrapped line per order item, aligned with `Order Details`.
- The on-page order summary shows the same code beside each product.
- Focused command: `npm test -- lib/report/product-codes.test.ts lib/report/build.test.ts lib/report/weekly-xlsx.test.ts app/api/admin/report/weekly/route.test.ts --reporter=verbose`.
- Result: **GREEN**, 4 files and 23 tests passed.
- UI/regression command: `npm test -- app/admin/reports/OrderSummaryReport.test.tsx app/admin/reports/page.test.tsx lib/report/buyer-fields.test.ts lib/report/weekly-xlsx-download.test.ts --reporter=verbose`.
- Result: **GREEN**, 4 files and 18 tests passed.
- Checkpoint: `502403c feat: add product codes to weekly report`.

## Guarantees

| Guarantee | Test | Type | Result |
|---|---|---|---|
| Supplied Cat. Nos. replace conflicting legacy catalog codes | `product-codes.test.ts` | Unit | PASS |
| Previously blank known products receive their supplied code | `product-codes.test.ts` | Unit | PASS |
| Custom catalog codes are preserved and uncoded free text stays blank | `product-codes.test.ts` | Unit | PASS |
| Product codes survive the report builder aligned with order details | `build.test.ts` | Unit | PASS |
| The weekly API resolves a real catalog product to the supplied code | `route.test.ts` | Database integration | PASS |
| Excel exports `Product Codes` inside the named `WeeklyOrders` table | `weekly-xlsx.test.ts` | Real XLSX round trip | PASS |
| Multi-item codes and details remain line-aligned | `weekly-xlsx.test.ts` | Integration | PASS |
| Admin order summary displays the code beside the item | `OrderSummaryReport.test.tsx` | Component | PASS |

## Coverage and validation

- Coverage command: `npm test -- lib/report --coverage --coverage.include=lib/report/build.ts --coverage.include=lib/report/weekly-xlsx.ts --coverage.include=lib/report/product-codes.ts --reporter=verbose`.
- Result: **PASS**, 7 files and 51 tests passed; 100% statements, 82.6% branches, 100% functions, and 100% lines.
- TypeScript command: `npx tsc --noEmit`.
- Result: **PASS**.
- Full regression command: `npm test -- --reporter=dot`.
- Result: **PASS**, 131 files and 1,224 tests passed.
- `npm run typecheck` is not defined in this repository; the compiler was invoked directly.
- No feature tests are skipped or disabled.

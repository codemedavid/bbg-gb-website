# Group Buy Product Totals — Batch 6 Format

Reference workbook: `BBG-ProductTotals Batch 6.xlsx`.

## Step 1 — Specify the Batch 6 workbook contract

Add workbook-level tests that compare the Group Buy export against the reference layout: a single `BBG-ProductTotals` worksheet; title and order/unit summary on rows 1–2; headers on row 3 in the visible order `#`, `Product`, `Variant / Code`, `Specs`, `Total Qty`, `Total USD`; product data beginning on row 4; and a final `TOTAL` row. Pin the reference widths, hidden helper-column behavior, black fill, white bold Aptos Narrow text, borders, formulas or equivalent computed values, report week/range labels, and numeric totals after an ExcelJS round trip.

Out of scope: changing the On-Hand export or weekly report aggregation rules.

## Step 2 — Implement the exact Group Buy Product Totals export

Refactor the XLSX builder so the Group Buy download produces the Batch 6 Product Totals workbook contract without changing the On-Hand workbook. Populate the title from `weekNo` and `rangeLabel`, the summary from `orderCount` and total units, and the product rows from `report.productTotals`; preserve numeric cells and make kit/quantity semantics match the reference workbook, including its hidden calculation data where required.

Out of scope: changing the On-Hand export, admin report API, order segmentation, or product-total aggregation rules.

## Step 3 — Verify download compatibility and regression safety

Run focused XLSX and download tests, then the project build. Verify the Group Buy button still downloads a valid `.xlsx` with the existing date/segment filename behavior, the generated workbook reopens successfully in ExcelJS, and the On-Hand export retains its current order-summary and product-total sheets.

Out of scope: deployment, database migrations, and unrelated report UI changes.

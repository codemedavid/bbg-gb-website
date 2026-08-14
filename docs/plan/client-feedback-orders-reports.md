# Client Feedback — Orders, Reports, Receipts, and Packing Fees

This plan converts the six client requests into acceptance-focused work. The current branch already contains implementations for these behaviors, so each step must first verify the existing path and only add or change code where the acceptance criteria expose a gap.

## Step 1 — Verify custom calendar date-range reports

Review the admin reports UI, API query bounds, Manila-calendar handling, and spreadsheet export for an admin-selected inclusive start and end date. Fix any gap found and preserve compatibility with the existing weekly report path.

Acceptance:

1. Admins can choose `from` and `to` dates with calendar inputs and invalid reversed ranges are rejected.
2. The on-page report and downloaded workbook contain only orders inside the same inclusive Manila date range.
3. Component, route, and export tests cover boundary dates and the empty-range state.

## Step 2 — Verify editing unpaid cart quantities

Review and, if needed, implement customer quantity editing for items that are still in the local cart and have not been submitted as an order. Enforce product minimums and server-backed stock or campaign constraints consistently across cart and checkout.

Acceptance:

1. Customers can increment, decrement, or type a valid quantity before checkout.
2. Invalid, below-minimum, and over-stock quantities cannot survive normalization or reach checkout unchanged.
3. Quantity changes persist across navigation and immediately update subtotals, fees, and the amount due.

## Step 3 — Verify adding and deleting items before checkout

Review the complete pre-checkout cart journey so customers can return to shopping, add more products or group-buy lines, and remove any unwanted line before placing an order. Fix state, navigation, or accessibility gaps found by tests.

Acceptance:

1. Every cart line has a direct remove action and reducing a line to zero removes it.
2. Customers can continue shopping, add another eligible item, and return to the same persisted cart.
3. Checkout reflects the final edited cart and never submits deleted or stale lines.

## Step 4 — Verify emailed receipts

Review receipt generation and delivery for successful order creation, split-cart orders, and administrative item corrections. Confirm that monetary breakdowns and item snapshots match the stored order and that user-controlled text is safely escaped.

Acceptance:

1. Each newly created order sends or queues one receipt to the authenticated customer's email address.
2. Receipts show items, quantities, subtotal, packing fee, and grand total from persisted order values.
3. An admin order correction sends an updated receipt, while retries or duplicate submissions do not send duplicate receipts.

## Step 5 — Verify one group-buy packing fee per customer and cycle

Review the server and storefront fee-waiver rules for customers with an existing order in the same group-buy series or active packing cycle. Fix any mismatch between quoted and persisted totals, including legacy rows covered by the packing-fee backfill.

Acceptance:

1. The first eligible order in a group-buy cycle carries the packing fee and a later order by the same customer in that cycle carries zero additional fee.
2. A new cycle or unrelated fulfillment mode charges its applicable fee independently.
3. Concurrent checkout and legacy-data tests prove the fee cannot be double-charged or incorrectly waived.

## Step 6 — Verify packing fees in product/order totals

Review report totals, order summaries, and spreadsheet output so packing fees are visibly included in financial totals without incorrectly allocating a shared parcel fee to individual supplier-product rows. Fix calculation or presentation gaps found.

Acceptance:

1. Product subtotal, packing-fee total, and grand total reconcile for every non-cancelled order and selected report range.
2. On-page and spreadsheet report summaries expose the packing-fee total using the same persisted source values.
3. Cancelled orders do not contribute to financial totals, and legacy fee columns remain correctly backfilled or normalized.

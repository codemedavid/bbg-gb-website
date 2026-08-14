# TDD evidence — client feedback: orders, reports, receipts, and packing fees

**Date:** 2026-08-14  
**Source plan:** [`docs/plan/client-feedback-orders-reports.md`](../plan/client-feedback-orders-reports.md)  
**Branch:** `feat/group-buy-page`

## User journeys

1. As an admin, I can select any inclusive calendar range so I can extract only the orders needed for a report.
2. As a customer, I can change quantities in my unsubmitted cart so the order reflects what I intend to buy.
3. As a customer, I can add and remove cart lines before checkout so deleted or stale lines are never ordered.
4. As a customer, I receive an itemized receipt for each order without duplicate receipts when checkout is retried.
5. As a repeat Group Buy customer, I pay the packing fee once per trading cycle, including when checkouts race.
6. As an admin, I can reconcile product subtotal, packing fees, and grand totals in the page and workbook reports.

## Finding and TDD checkpoints

The existing implementation already covered the six visible workflows, but the acceptance audit found one concurrency defect. `paidThisCycle` was read before the checkout transaction. Two simultaneous first checkouts by the same customer could both observe no prior fee and both charge it.

RED checkpoint `89d15fb` added the concurrent integration reproducer.

```text
expected [300, 300] to deeply equal [0, 300]
Test Files  1 failed (1)
Tests       1 failed | 23 passed (24)
```

GREEN checkpoint `7edc6f7` serializes cycle-fee decisions by locking the customer row and re-reading cycle payments inside the transaction. The same target then passed:

```text
Test Files  1 passed (1)
Tests       24 passed (24)
```

Acceptance-coverage checkpoint `940273a` added exact Manila range-boundary tests and proved that an idempotent retry leaves one receipt log.

## Task report

| Plan step | Execution summary | Validation | Guarantee |
|---|---|---|---|
| 1. Report dates | Verified native date inputs, inclusive Manila query bounds, reversed-range rejection, segmented output, and workbook generation. | `npx vitest run app/api/admin/report/weekly/segments.test.ts --reporter=verbose --silent` | The first and last selected Manila dates are included; adjacent instants are excluded; reversed ranges return 400. |
| 2. Edit unpaid cart items | Verified typed quantity changes, min/stock clamping, persistence, and immediate subtotal behavior. | Full suite; `app/cart/page.test.tsx`, `lib/store/cart.test.ts` | Unsubmitted cart quantities are editable and cannot exceed server-backed cart constraints. |
| 3. Add/delete before checkout | Verified direct removal, decrement-at-minimum removal, persisted mixed carts, and the real cart-to-checkout contract. | Full suite; `app/cart/page.test.tsx`, `app/api/orders/cart-contract.test.ts` | Removed lines are absent and every surviving cart kind is accepted and re-priced by checkout. |
| 4. Receipt email | Verified itemized/escaped receipt templates, updated receipts, split-order behavior, and retry idempotency. | `npx vitest run app/api/orders/idempotency.test.ts --reporter=verbose --silent`; full suite | A replayed checkout creates neither another order nor another receipt log. |
| 5. One cycle fee | Added RED concurrency proof and transaction-level serialization; reran sequential, cancellation, successor-batch, cross-board, cross-customer, and concurrency cases. | `npx vitest run app/api/orders/campaign-checkout.test.ts --reporter=verbose --silent` | Two simultaneous first checkouts by one customer persist exactly one fee: `[0, 300]`. |
| 6. Packing fee totals | Verified order subtotal/fee/total reconciliation, cancelled-order exclusion, legacy fee fallback, on-page totals, and workbook totals. | Full suite; `lib/report/build.test.ts`, `lib/report/weekly-xlsx.test.ts`, report component/route tests | Page and spreadsheet summaries use the same persisted packing-fee values without allocating the shared fee to supplier-product rows. |

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | A custom range includes both selected Manila dates and excludes adjacent instants. | `app/api/admin/report/weekly/segments.test.ts:custom Manila calendar ranges` | Integration | PASS |
| 2 | A reversed date range returns HTTP 400. | Same target | Integration | PASS |
| 3 | Customers can type a cart quantity and remove a line directly. | `app/cart/page.test.tsx:CartPage — Group Buy and Kahati separation` | Component | PASS |
| 4 | Quantity changes clamp to MOQ stock/minimum constraints. | `lib/store/cart.test.ts:MOQ cart lines` | Unit | PASS |
| 5 | Every storefront cart line kind crosses the real checkout contract. | `app/api/orders/cart-contract.test.ts` | Integration | PASS |
| 6 | Receipt HTML contains itemized totals and escapes customer-controlled item names. | `lib/email.receipt.test.ts` | Unit | PASS |
| 7 | Retrying one checkout creates one order and one receipt log. | `app/api/orders/idempotency.test.ts` | Integration | PASS |
| 8 | Sequential repeat Group Buy orders pay one cycle fee. | `app/api/orders/campaign-checkout.test.ts:repeat commitments` | Integration | PASS |
| 9 | Concurrent first Group Buy orders by one customer pay one cycle fee total. | `app/api/orders/campaign-checkout.test.ts:charges one cycle fee when the same customer checks out concurrently` | Integration | PASS |
| 10 | Cancelled orders do not contribute to report money or product totals. | `lib/report/build.test.ts`, `lib/report/product-totals.test.ts` | Unit | PASS |
| 11 | Spreadsheet summaries include packing-fee totals. | `lib/report/weekly-xlsx.test.ts:includes the packing-fee total` | Integration | PASS |
| 12 | The whole repository remains regression-green. | `npx vitest run --silent --reporter=dot` | Unit/component/integration | PASS — 178 files, 1,837 tests |

## Coverage and build

Command: `npx vitest run --coverage --silent --reporter=dot`

```text
All files: 82.69% statements, 86.75% branches, 75.16% functions, 82.69% lines
app/api/orders/route.ts: 92.11% statements, 91.78% branches, 100% functions
app/api/admin/report/weekly/route.ts: 100% statements, 87.5% branches, 100% functions
lib/report: 99.74% statements, 92.07% branches, 100% functions
lib/store: 99.25% statements, 89.61% branches, 91.3% functions
```

Command: `npm run build`

```text
Next.js 15.5.20
Compiled successfully
Generated static pages (58/58)
exit 0
```

## Known limitations

- The repository has no Playwright dependency or browser E2E configuration. Critical journeys are covered by React component tests and real route/database integration tests, but not by an installed browser runner.
- The production build's schema drift step was skipped because `DATABASE_URL` was not set. Compilation and static generation passed, but live production-schema parity must be checked in an environment that exposes that variable.
- Overall statement/line coverage exceeds 80%; overall function coverage is 75.16% because unrelated legacy pages and API routes remain untested. All implementation areas in this plan meet strong statement coverage, and the changed checkout route has 100% function coverage.
- SMTP delivery itself depends on deployment credentials. The suite proves receipt construction, recipient selection, logging, idempotency, and send invocation, not delivery by an external mail provider.

## Merge evidence

1. `89d15fb test: reproduce concurrent group-buy cycle fee charge` — RED validated with `[300,300]`.
2. `7edc6f7 fix: serialize group-buy cycle fee decisions` — GREEN validated with 24/24 targeted tests.
3. `940273a test: cover report ranges and receipt idempotency` — acceptance characterization green.

These commits are reachable from the current branch HEAD and preserve the test-first sequence.

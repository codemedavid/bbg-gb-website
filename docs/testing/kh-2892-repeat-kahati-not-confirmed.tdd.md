# KH-2892 — repeat kahati order auto-marked Payment Confirmed

**Source plan:** none; the journey below was written during this TDD run from the admin screenshot of KH-2892.

## Report

In the admin drawer, KH-2892 (kahati, ₱5,968.20) showed **Payment Confirmed**, but:

- no admin had confirmed it;
- the customer never uploaded a proof.

Prod row: `status=payment_confirmed`, `payment_status=not_due`, `downpayment_php=0`, 0 proofs. Its only history entry was written by checkout.

## Business rule (confirmed with the user, 2026-09-15)

- The first kahati order of a cycle pays the downpayment.
- Later orders in the same batch owe **₱0** at checkout.
- Those later orders are paid in full at the final checkout (Settle), and Settle requires a proof.

So the waiver is correct. The defect is only the status that checkout wrote.

## User journey

As an admin, I want a kahati order nobody has paid for to show as Payment Pending, not Payment Confirmed. That way "Payment Confirmed" always means someone checked the money.

## Root cause

`app/api/orders/route.ts` wrote `status = confirmOnly ? 'payment_confirmed' : 'proof_review'`.

In prod, admins had moved 7 of these orders back to `proof_review` by hand: KH-2867, 2868, 2879, 2903, 2905, 2909 and 2917.

## Fix

- Every checkout now writes `status = 'proof_review'`.
- `payment_status` stays `not_due` for the ₱0 order.
- The history note now reads "Order placed — … balance is paid at final checkout".

## Checks on side effects

- **Settle:** `isReadyToSettle` ignores order status, so Settle is unaffected.
- **Customer edits:** still open, because `order-edit` allows edits at `proof_review`.
- **Refunds:** unaffected, because `collectedBasisFor` reads `payment_status`.

## Task report

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | A repeat, no-payment kahati checkout lands at `proof_review` with `payment_status=not_due`, never `payment_confirmed` | `app/api/orders/kahati-repeat.test.ts: never marks a no-payment commitment Payment Confirmed — it waits as Payment Pending` | integration | PASS | RED: `expected 'payment_confirmed' to be 'proof_review'`; GREEN: 18/18 |
| 2 | Under the default packing-fee policy the second commitment is still waived (₱0) and waits at `proof_review` | `app/api/orders/kahati-downpayment-policy.test.ts: still waives the second commitment in the same cycle` | integration | PASS | same run |
| 3 | No regressions in checkout, settlements, payment status, order edit rules or badges | `npx vitest run app/api/orders lib/payment-status.test.ts lib/settlement.test.ts lib/order-edit.test.ts lib/order-badge.test.ts app/checkout app/api/settlements` | integration + unit | PASS | 35 files / 434 tests |

Commits:

- RED: `4b561fb`
- GREEN: the `fix:` commit that follows it

## Known gaps

- **Existing orders:** 20 prod orders still sit at `payment_confirmed` with no proof and ₱0 collected. The user chose to leave them as they are, so no backfill.
- **Admin dashboard count:** "pending proofs" counts every `status='proof_review'` (`lib/analytics.ts`), so ₱0 repeat orders now appear in that number.
- **Admin confirm without proof:** an admin can still move a no-proof order to Payment Confirmed by hand. That is intentional, since it is an admin action.
- **Type check:** `tsc` has 13 errors, all in other sessions' uncommitted files. None are in files touched here.
- **Coverage:** no coverage run was done.

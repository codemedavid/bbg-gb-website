# TDD Evidence — "nawala daw payment": the settled balance was invisible on My Orders

**Source plan**: none on disk. The brief was a customer screenshot forwarded by
the client with three words — *"nawala daw payment"* — showing KH-2791 badged
**No Payment Due**. Journeys were derived here from reading the path and
querying the live Supabase database.
**Branch**: `main`
**Date**: 2026-09-09
**Predecessor**: `docs/testing/checkout-payment-audit.tdd.md` — the cycle that
introduced `orders.payment_status` and `lib/payment-status.ts`. This is the
half that cycle missed: it separated payment from fulfilment on the *order*,
and never asked the settlement.

## What the report turned out to be

A hatian order collects money **twice**:

| Payment | When | Where it is recorded |
|---|---|---|
| Downpayment | at checkout | `orders.payment_status` |
| Balance + packing fee | at the hatian final checkout | a row in `settlements`, linked by `orders.settlement_id` |

Every customer-facing payment label asked `orders.payment_status` alone
(`orderBadge` in `lib/order-status.ts`, and the Payment → Status field on the
order detail page). The second and by far larger payment was therefore
invisible on the one screen the customer checks.

KH-2791 is the pure case. It is a *repeat* kahati commitment in a cycle whose
packing fee was already paid, so it genuinely owed ₱0 at checkout and was
written `not_due` — correctly. Two days later its customer paid the whole
₱1,140 balance through the final checkout and uploaded a BDO proof. Nothing
about that touched the order row, so the badge still read **No Payment Due**
over money they had just sent.

### Evidence from production

```sql
select o.order_no, o.payment_status, s.status as settlement_status,
       s.total_php, s.created_at
from orders o join settlements s on s.id = o.settlement_id
where o.order_no = 'KH-2791';
```

```
KH-2791 | not_due | proof_review | 1140.00 | 2026-09-04 10:43:37+00
```

Not a one-off. Grouped over every order still in the payment phase
(`status in ('proof_review','payment_confirmed')`, live settlement):

| orders | order `payment_status` | settlement | badge showed | should show |
|---:|---|---|---|---|
| 5 | `not_due` | `proof_review` | No Payment Due | Proof Submitted |
| 8 | `not_due` | `paid` | No Payment Due | Payment Confirmed |
| 20 | `confirmed` | `proof_review` | **Payment Confirmed** | Proof Submitted |
| 1 | `proof_submitted` | `paid` | Proof Submitted | Proof Submitted ✓ |

**33 live orders badged wrong**, and the third row is the one that mattered
most. Those 20 orders carry ₱136,487.75 of balances that no admin has looked
at, and each told its customer the payment had been checked. That is the exact
overclaim `lib/payment-status.ts` was written to end, reappearing through the
door it did not cover.

## The rule

`overallPaymentStatus` folds both obligations into one state and reports the
**less resolved** of the two, ranked `rejected < pending < proof_submitted <
confirmed`. Honest in both directions by construction:

- a paid settlement cannot confirm a downpayment still owed or rejected;
- a verified downpayment cannot confirm a balance still in review.

`not_due` is the **identity, not a rank**: an obligation carrying nothing yields
to one that is carrying something. That single case is the reported bug.

A cancelled settlement collected nothing, so it contributes nothing and the
order reads exactly as it did before — matching `settlementLabelKey`, which
already dropped such an order back to "Charged once at final checkout".

`proof_review` maps to `proof_submitted` rather than `pending` because a
settlement **cannot** exist without a proof: `app/api/settlements/route.ts`
calls `validateAndStoreProofs` before the transaction opens, and that throws on
an empty set. The row's existence is the evidence.

## User journeys

1. As a customer who has paid my hatian balance in full, I want My Orders to
   show that payment, so that I do not think the money I sent disappeared.
2. As a customer whose balance an admin has verified, I want to see it
   confirmed, so that I stop waiting.
3. As a customer whose downpayment was verified but whose balance is still in
   review, I do not want to be told my payment is confirmed, so that
   "confirmed" keeps meaning somebody checked.
4. As a customer whose downpayment is still owed, I do not want a paid balance
   to paper over it, so that I know there is still something to pay.
5. As a customer whose settlement was cancelled, I want my order to read as it
   did before, so that a released payment does not linger as a claim.

## Task report

### 1. The badge and the detail page ask about the settlement

`overallPaymentStatus` added to `lib/payment-status.ts` — still pure and
import-free, so the settlement status arrives as a plain string rather than by
importing `lib/settlement.ts`. `orderBadge` and the order detail page's
Payment → Status field call it instead of `derivePaymentStatus`.

**RED**

```
npx vitest run lib/payment-status.test.ts lib/order-badge.test.ts
 Tests  11 failed | 26 passed (37)
   TypeError: overallPaymentStatus is not a function
   AssertionError: expected 'No Payment Due' to be 'Proof Submitted'
   AssertionError: expected 'No Payment Due' to be 'Payment Confirmed'
   AssertionError: expected 'Payment Confirmed' to be 'Proof Submitted'
```

**GREEN**

```
npx vitest run lib/payment-status.test.ts lib/order-badge.test.ts lib/order-status.test.ts
 Test Files  3 passed (3)
      Tests  46 passed (46)
```

### 2. The screen in the screenshot

Three tests added to `app/(storefront)/orders/page.test.tsx` covering the
rendered badge, not just the function — the wiring is `orderBadge(order)`
receiving the whole `Order`, and a future refactor that maps a subset would
otherwise re-break this silently.

Verified as real coverage rather than vacuous: with `lib/order-status.ts`
restored to its pre-fix revision (`git show 96ae4cf:lib/order-status.ts`), two
of the three fail, and the file was restored afterwards (`git diff --stat`
clean).

```
 × reports the balance the customer paid, not the nothing they owed at checkout
 × confirms the payment once the settlement has been verified
      Tests  2 failed | 18 passed (20)
```

**GREEN**

```
npx vitest run 'app/(storefront)/orders/page.test.tsx'
      Tests  20 passed (20)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A `not_due` order with a settlement in review reads as Proof Submitted | `lib/payment-status.test.ts:stops saying nothing is due once the balance has been paid` | unit | PASS |
| 2 | A `not_due` order with a paid settlement reads as Payment Confirmed | `lib/payment-status.test.ts:confirms the payment once an admin has verified the settlement` | unit | PASS |
| 3 | A verified downpayment does not confirm a balance still in review | `lib/payment-status.test.ts:does not claim a confirmed payment while the settlement is unverified` | unit | PASS |
| 4 | A paid settlement does not confirm a downpayment still owed or rejected | `lib/payment-status.test.ts:keeps reporting an unpaid downpayment after the balance clears` | unit | PASS |
| 5 | A cancelled settlement contributes nothing | `lib/payment-status.test.ts:ignores a cancelled settlement, which collected nothing` | unit | PASS |
| 6 | Every order carrying no settlement is unchanged, for all five stored states | `lib/payment-status.test.ts:leaves an order carrying no settlement exactly as it was` | unit | PASS |
| 7 | A pre-column row derives its own state first, then folds the settlement in | `lib/payment-status.test.ts:derives a legacy row own state first, then folds the settlement in` | unit | PASS |
| 8 | An unrecognised settlement status is never read as a payment | `lib/payment-status.test.ts:never reads a settlement status it does not recognise as a payment` | unit | PASS |
| 9 | The badge on KH-2791 stops saying No Payment Due | `lib/order-badge.test.ts:does not say nothing is due on an order the customer has paid in full` | unit | PASS |
| 10 | The badge confirms only once the settlement is verified | `lib/order-badge.test.ts:confirms the payment once an admin has verified the settlement` | unit | PASS |
| 11 | The badge does not overclaim on an unverified settlement | `lib/order-badge.test.ts:does not claim a confirmed payment while the settlement is still unverified` | unit | PASS |
| 12 | A cancelled settlement returns the badge to owing | `lib/order-badge.test.ts:goes back to owing when the settlement was cancelled` | unit | PASS |
| 13 | Past the payment phase the badge still reports the parcel | `lib/order-badge.test.ts:still reports the parcel once it is moving` | unit | PASS |
| 14 | My Orders renders the settled balance on the card | `app/(storefront)/orders/page.test.tsx:reports the balance the customer paid, not the nothing they owed at checkout` | component | PASS |
| 15 | My Orders renders Payment Confirmed on a paid settlement | `app/(storefront)/orders/page.test.tsx:confirms the payment once the settlement has been verified` | component | PASS |
| 16 | My Orders still says No Payment Due with no settlement | `app/(storefront)/orders/page.test.tsx:still says nothing is due when no settlement is carrying anything` | component | PASS |

## Whole suite and type check

```
npx vitest run
 Test Files  293 passed (293)
      Tests  3253 passed (3253)

npx tsc --noEmit --pretty false   (clean)
```

## Scope, and what was deliberately not done

**No migration, and no write path changed.** `/api/orders` and
`/api/orders/[id]` already select `settlements.status` and return it as
`settlementStatus`; `lib/types.ts` already types it. This is the readers
catching up to data they were being handed and discarding. The 33 wrong badges
correct themselves on deploy, with nothing to backfill.

The alternative — having the settlement routes write `orders.payment_status` —
was rejected. One column cannot hold two payments without re-creating the
original conflation: a settlement's `proof_submitted` would overwrite a
downpayment an admin had already verified, destroying a fact rather than
combining two.

**Not changed: the admin payment queue.** `orders_payment_status_idx` answers
"what still needs someone to look at money" for the *order* row, and admins
review settlements on their own board (`/api/admin/settlements`). Folding
settlements into that index would put every settled order back in the order
queue.

**Not changed: `settlementLabelKey`** on the expanded card. It was already
right — "Final payment under review" — which is why the defect only ever showed
on the collapsed badge. That is also why nobody caught it: the information
existed one tap away, on the screen nobody taps.

# KH-2794 "ready to settle" after payment — TDD evidence

## Source

No plan file. The plan was produced inline by `/ecc:plan` on 2026-09-14 from an
admin group-chat report: Lyka's My Orders showed "1 hatian order ready to settle
₱6,327.50" and "Babayaran: ₱85,377.50" beside GB-2801, which was payment
confirmed. Journeys and scale below were derived from read-only prod queries.

What prod showed:

| Order | Cycle | payment_status | settlement | Proofs |
|---|---|---|---|---|
| GB-2801 | 2026-08-29 | confirmed | — | paid in full (₱79,050) |
| KH-2794 | 2026-08-29 | proof_submitted | none | Sep 3 (checkout ₱150) + **Sep 5** |

₱85,377.50 = ₱79,050 (GB-2801, paid) + ₱6,327.50 (KH-2794's ₱6,477.50 − ₱150).
The banner was KH-2794, not GB-2801. All five of its counters were `closed`, and
its Sep 5 balance screenshot went through the order uploader, which no
settlement reads.

Decision taken without a reply: an unverified proof (`proof_submitted`) still
counts as owed, matching `lib/payment-status.ts` ("a screenshot is not a
payment until someone has checked it").

## User journeys

- As a customer who has paid a group buy, I want "Babayaran" to leave it out, so
  I am not told I owe ₱79,050 I already sent.
- As a customer whose hatian closed, I want the order page to send my balance
  through Settle now, so my payment is actually recorded and the banner clears.
- As an admin, I want the balances already paid through the wrong door filed as
  settlements awaiting review, so I can verify them in the Settlements screen
  instead of chasing each customer.

## Task report

### Phase 1 — "Babayaran" counted paid orders

- RED: 6 cases added to `lib/order-batches.test.ts`. `npx vitest run lib/order-batches.test.ts`
  → 3 failed / 17 passed. `expected 85377.5 to be 6327.5` (the KH-2794 case),
  `expected 5000 to be +0` (not due), `expected 2970 to be +0` (paid settlement).
  The 3 passing cases pin what must not change: an unverified group-buy proof
  and a hatian balance after its ₱150 is confirmed both stay owed.
  Checkpoint `cc19937`.
- GREEN: `amountOwed` in `lib/order-batches.ts` — a group buy owes nothing once
  `confirmed` or `not_due`; a hatian balance clears only when its settlement is
  `paid`. `toBatchOrder` passes both fields. `npx vitest run lib/order-batches.test.ts "app/(storefront)/orders/page.test.tsx"`
  → 40/40. Checkpoint `df26973`.
- Prod scale: 138 confirmed orders across 94 customers were inflating the figure
  by ₱1,156,149.50.

### Phase 2 — a closed hatian's balance could be uploaded to the order

- RED: `app/api/orders/[id]/proofs/route.test.ts` → 2 failed / 26 passed
  (`expected 201 to be 409`; 2 proofs filed instead of 1).
  `components/OrderProofSection.test.tsx` → 1 failed / 18 passed (uploader still
  rendered). Checkpoint `6bd013a`.
- GREEN: the route returns 409 ("please pay the balance through Settle now") for
  any order `readySettlementOrders` holds — the same query as the banner.
  `OrderProofSection` takes `settleInstead` and shows a Settle now link in place
  of the uploader; the order details page sets it from `useSettlementPreview`.
  Route + component 47/47; order details page 18/18 after adding
  `useSettlementPreview` to its `@/lib/queries` mock; settlements + orders API
  suites 321/321. Checkpoint `17da410`.
- Prod scale: 17 of the 43 orders the banner offered carried a proof uploaded
  more than 10 minutes after checkout.

### Phase 3 — filing the balances already paid that way

- RED: `lib/balance-proof-settlement-server.test.ts`. First run failed to load
  the missing module; a throwing stub was then added so the fixtures ran →
  9/9 failed on `not implemented`. Checkpoint `613b4ca` (test only).
- GREEN: `lib/balance-proof-settlement-server.ts` finds ready-to-settle hatian
  orders with late proofs and files each customer's lot as one `proof_review`
  settlement — never `paid` — copying the proofs and claiming the orders with
  the final checkout's guard. An unknown order number stops the run before any
  write. `scripts/settle-from-order-proof.ts` is dry-run by default and refuses
  `--apply` without an order list. 9/9. Checkpoint `eafa5a9`.
- Script dry run on PGlite (`DATABASE_URL= STORAGE_DRIVER=local`): ran clean,
  `candidates: 0`; `--apply` with no list refused. **Not run against prod.**

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A confirmed group buy adds nothing to Babayaran (GB-2801 + KH-2794 → ₱6,327.50) | `lib/order-batches.test.ts` › leaves a confirmed group buy out | unit | PASS |
| 2 | A not-due order owes nothing | › owes nothing on an order with no payment due | unit | PASS |
| 3 | An unverified group-buy proof is still owed | › still counts a group buy whose proof nobody has verified | unit | PASS |
| 4 | Confirming a hatian's ₱150 does not clear its balance | › keeps a hatian balance owed after its checkout payment is confirmed | unit | PASS |
| 5 | A paid settlement clears a hatian balance; under review or cancelled does not | › owes nothing … settlement was paid / still counts … under review or was cancelled | unit | PASS |
| 6 | A late proof on a ready-to-settle hatian is refused with 409 and files nothing | `app/api/orders/[id]/proofs/route.test.ts` › a hatian balance goes through Settle now | integration | PASS |
| 7 | A hatian still filling still accepts a top-up proof | › still accepts one while the hatian is filling | integration | PASS |
| 8 | A settle-ready order shows Settle now, not the uploader, and keeps its proofs visible | `components/OrderProofSection.test.tsx`, `app/(storefront)/orders/[id]/page.test.tsx` | component | PASS |
| 9 | Cleanup finds only closed hatians with a post-checkout proof | `lib/balance-proof-settlement-server.test.ts` › findBalanceProofOrders | integration | PASS |
| 10 | Cleanup files `proof_review`, one per customer, copies proofs, clears the banner | › recordBalanceProofSettlements | integration | PASS |
| 11 | Cleanup refuses a non-candidate order number and writes nothing; a rerun files nothing new | › refuses an order number … / does nothing the second time | integration | PASS |

## Coverage and known gaps

`npx vitest run <the four test files> --coverage --coverage.include=<the four source files>` → 76/76.

| File | Stmts | Branch | Uncovered |
|---|---|---|---|
| `lib/order-batches.ts` | 100 | 89.65 | 159–169: pre-existing batch dating/sort branches |
| `lib/balance-proof-settlement-server.ts` | 97.5 | 92.3 | 135–136: the concurrent-claim rollback |
| `components/OrderProofSection.tsx` | 98.87 | 88.88 | 63: pre-existing network-error catch |
| `app/api/orders/[id]/proofs/route.ts` | 100 | 95.45 | 106: pre-existing log ternary |

`scripts/**` is excluded from coverage by `vitest.config`; the script only
prints and passes arguments to the tested module.

Full suite (`npx vitest run`): 3,557 passed, 13 failed across 5 files —
`app/api/groupbuys/route.test.ts`, `components/GroupBuyCard.test.tsx`,
`lib/kahati.test.ts`, `lib/pricing.test.ts`, `lib/listing-sync-server.test.ts`.
All concern per-counter vial minimums and per-vial pricing, being changed by
another session. Four of those files carry that session's uncommitted edits.
`tsc --noEmit` reports 13 errors, all in the same uncommitted files; none in
any file this cycle touched.

Correction recorded: the first type checks were run as `timeout 280 npx tsc … | grep`.
`timeout` does not exist on this Mac, so they never ran. The empty output was
misread as clean. They were re-run without it (exit 2, 13 errors, none ours).

No refactor stage: the GREEN code needed no cleanup to keep.

## Still open

- **Prod cleanup is not applied.** An admin should open each candidate's proofs
  first — none carry an amount, and one may be a top-up of the checkout payment.
  Then, with explicit approval for a prod write:
  `npx tsx scripts/settle-from-order-proof.ts` (dry run) and
  `… --apply KH-2794,…` for the approved orders. They are then confirmed in
  Admin → Settlements.
- Until KH-2794 is filed, Lyka's banner stays. The code fix stops new cases only.

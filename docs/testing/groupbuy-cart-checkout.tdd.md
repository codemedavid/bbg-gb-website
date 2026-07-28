# Group Buy checkout through the cart — TDD evidence

**Source plan**: `/ecc:plan` output in-session (conversational mode, no `*.plan.md` artifact).
**Follow-up requirement** added by the client after the plan was approved: *"same as the kahati — when the user placed an order already in the gbuy the packing fee is already paid in the first order placed, so when the user wants to order again in the same gbuy there's no need to pay a packing fee na."*

## The problem

Two boards violated "payment is reachable only from the cart", in different ways:

| Board | What it did | Consequence |
|---|---|---|
| `/groupbuy` (MOQ campaigns) | `CommitSheet` collected shipping details + proof and posted to `POST /api/campaigns/:id/commit` | The one board where a customer could not fill a basket. One commitment = one payment = one packing fee. No way to keep shopping. |
| `/kahati` | `JoinSheet` added to the cart, then `router.push('/checkout')` | Same outcome by navigation: the first join dead-ends in the payment page. |

A decision recorded here because it shaped the work: **"charge the packing fee only once per checkout" was read as once per parcel, not once per basket.** N group buys bought together are one fee; a group buy alongside an on-hand item is still two, because those ship as two parcels and check out as two orders. This matches the existing documented rule in `lib/pricing.ts` and the hatian settlement model. The alternative (one fee for the whole basket regardless of modes) was presented and declined.

## User journeys

1. As a customer, I want to add a group buy to my cart so I can keep browsing instead of being pushed into payment.
2. As a customer, I want to add several group buys and pay for them in one checkout.
3. As a customer, I want to mix a group buy with on-hand or MOQ stock in one basket.
4. As a customer, I want to change quantities and remove group buy lines before I pay.
5. As a customer, I want the packing fee charged once at checkout, not once per group buy.
6. As a customer who already has an order going in a group buy, I want to order from it again without paying the packing fee a second time.
7. As a customer, I want my cart emptied once the order actually goes through, and left alone when it fails.

## Task report

### 1. Group buy commitments become cart lines
`CartItem['kind']` gained `'moq_campaign'`; `campaignCartLine()` builds the line the way `moqCartLine()` does, so the cart→checkout contract test exercises the real thing. `maxQtyFor` returns `Infinity` for it, for the same reason kahati lines are uncapped: a commitment beyond the batch's room seals it and rolls into the successor the fill opens.

- **RED**: `POST /api/orders` answered `items.0.kind: Invalid enum value`.
- **GREEN**: `npx vitest run app/api/orders/campaign-checkout.test.ts` → 20 passed.

### 2. Checkout prices and claims campaign lines
`itemSchema` accepts the kind; `Priced` widened to full `PriceableItem`; a new branch resolves the series' open batch (`resolveOpenBatch`, extracted from the deleted commit route) and runs `allocateCommitment(tx, …)` **inside the checkout transaction** — so a failure anywhere in the cart releases the claimed kits, which the standalone commit route could not do. `splitCartIntoOrders` already mapped `moq_campaign → group_buy`, so the order split needed no change.

- **Validated**: cancelled-campaign test asserts the sibling on-hand line's stock draw rolled back.

### 3. Packing fee charged once per parcel
No new branch — `packingFeeFor` already keys a Map by mode and takes the largest fee within it. Reusing it *is* the fix. Pinned by test rather than by code so it cannot silently regress.

### 4. Repeat-commitment fee waiver
`lib/campaign-commitment.ts` (pure rules) + `lib/campaign-commitment-server.ts` (query), mirroring the kahati downpayment waiver pair. Two conditions decide whether a series counts as paid, and both earned a test:

- The order must still be **assembling** — `shipped`/`delivered`/`cancelled` no longer hold a parcel, so the next commitment buys a new one.
- The order must have **actually paid** (`packingFeePhp > 0`). A waived order carries ₱0; letting it act as the waiver source would chain the fee away forever (#1 pays → #2 free → #1 ships → #3 rides on #2 → nobody pays again).

Keyed by **series**, not batch: a batch that fills opens a successor on the same terms, and to the customer that is still one group buy.

### 5. UI
`CommitSheet` is a quantity picker; `JoinSheet` no longer navigates; `CampaignCard` reads "Add to cart"; the board dropped its login gate (a localStorage cart needs no session, and `/checkout` already redirects — this also matches the Kahati board and the shop). `GET /api/campaigns/commitments` + `useCampaignPackingFeeWaivers` let the cart display ₱0 exactly where the server will charge ₱0, answered by the same query the checkout route uses.

### 6. The second payment path is gone
`app/api/campaigns/[id]/commit/route.ts` deleted. Its coverage was **ported before the delete**, not dropped: `batch-split.test.ts`, `campaigns/route.test.ts` and the admin status test now drive the same assertions through `POST /api/orders` via the rewritten `commitRequest(campaignId, qty)` harness helper.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A group buy line checks out as a `group_buy` order and claims the kits | `campaign-checkout.test.ts:creates a group_buy order holding the committed kits` | integration | PASS |
| 2 | Each order line points at the batch that actually holds its kits | `campaign-checkout.test.ts:links the order line to the batch` | integration | PASS |
| 3 | Three group buys in one cart cost **one** packing fee | `campaign-checkout.test.ts:charges the campaign packing fee once, not once per group buy` | integration | PASS |
| 4 | A group buy + on-hand cart splits into two orders with their own fees | `campaign-checkout.test.ts:keeps a group buy and an on-hand item in separate orders` | integration | PASS |
| 5 | A group buy is paid in full at checkout — proof required | `campaign-checkout.test.ts:requires a payment proof` | integration | PASS |
| 6 | The campaign's per-customer minimum is enforced server-side | `campaign-checkout.test.ts:enforces the campaign per-customer minimum` | integration | PASS |
| 7 | Overflow seals the batch and rolls into its successor | `campaign-checkout.test.ts:fills the open batch, seals it and rolls the remainder` | integration | PASS |
| 8 | A split commitment is one order with one fee | `campaign-checkout.test.ts:bills a split commitment as one order carrying one packing fee` | integration | PASS |
| 9 | A line aimed at a completed batch lands in the open one | `campaign-checkout.test.ts:routes a line pointing at a completed batch` | integration | PASS |
| 10 | A cancelled campaign rolls back the whole cart, stock draws included | `campaign-checkout.test.ts:refuses a cancelled campaign and rolls back` | integration | PASS |
| 11 | A second order in the same group buy pays no packing fee | `campaign-checkout.test.ts:charges no packing fee on a second order` | integration | PASS |
| 12 | The waiver follows the series into a successor batch | `campaign-checkout.test.ts:waives the fee for the successor batch` | integration | PASS |
| 13 | A different group buy still charges its own fee | `campaign-checkout.test.ts:still charges the fee for a different group buy` | integration | PASS |
| 14 | Once the parcel ships, the next order pays again | `campaign-checkout.test.ts:charges the fee again once the parcel has shipped` | integration | PASS |
| 15 | A fee-waived order cannot itself become the waiver source | `campaign-checkout.test.ts:does not treat a fee-waived order as the one that paid` | integration | PASS |
| 16 | A cancelled order is not a paid fee | `campaign-checkout.test.ts:does not count a cancelled order as having paid` | integration | PASS |
| 17 | The waiver covers the group buy fee only | `campaign-checkout.test.ts:waives only the group buy fee` | integration | PASS |
| 18 | The waiver is per customer | `campaign-checkout.test.ts:keeps another customer paying their own fee` | integration | PASS |
| 19 | The waiver rules hold in isolation (8 cases) | `lib/campaign-commitment.test.ts` | unit | PASS |
| 20 | The commit sheet adds to the cart and issues no request | `CommitSheet.test.tsx:takes no payment of its own` | component | PASS |
| 21 | The commit sheet asks for no shipping details or proof | `CommitSheet.test.tsx:asks for no shipping details or payment proof` | component | PASS |
| 22 | The join sheet leaves the customer on the board | `JoinSheet.test.tsx:leaves the customer on the board` | component | PASS |
| 23 | The board opens the sheet for anonymous visitors instead of bouncing to login | `groupbuy/page.test.tsx:opens the sheet for an anonymous visitor` | component | PASS |
| 24 | The campaign cart line is accepted by checkout verbatim | `cart-contract.test.ts:checks out a group buy line added the way the commit sheet adds it` | integration | PASS |
| 25 | One group buy fee however many campaign lines (client side) | `lib/store/cart.test.ts:charges one group buy fee however many group buys` | unit | PASS |
| 26 | The cart empties on success and survives failure | `app/checkout/page.test.tsx` (pre-existing, still green) | component | PASS |

## Validation commands actually run

```
npm test                → Test Files 91 passed (91) · Tests 843 passed (843)
npx tsc --noEmit        → clean
npx next build          → succeeded (all routes compiled)
npx vitest run --coverage
    All files                      65.02% stmts / 82.64% branch
    lib/campaign-commitment*.ts   100%   stmts / 91.66% branch
    lib/store/cart.ts              98.9% stmts
    components/CommitSheet.tsx    100%   stmts
    components/OrderSummary.tsx    96.55% stmts
```

## Coverage and known gaps

- The two new modules and every file rewritten in this change are at or above the 80% target. The 65% repo-wide figure is unchanged by this work — it is dominated by admin screens that predate it.
- **Browser QA was NOT run.** Every listed scenario is covered by route-level integration tests against real PGlite plus component tests, but the end-to-end click path (add → browse → add again → cart → pay → cart empty) has not been exercised in a browser. Worth doing on `DATABASE_URL= STORAGE_DRIVER=local` before this reaches production.
- **`/api/campaigns/:id/commit` is gone.** Any client still calling it — a bookmarked request, an external integration — now gets a 404. Nothing in this repo does.
- **Behaviour change worth flagging to the client**: campaign orders now emit the standard `order_placed` email and PostHog event, which the old commit route never sent.

## Merge evidence

| Stage | Commit | Evidence |
|---|---|---|
| RED | `d93c84c` | Route answered `items.0.kind: Invalid enum value`; `lib/campaign-commitment.ts` did not exist; CommitSheet still posted to the commit endpoint; JoinSheet still pushed `/checkout`. 28 failing / 44 passing across 6 files. |
| GREEN | `bcc29cc` | 843 passing, `tsc --noEmit` clean, `next build` succeeded. |

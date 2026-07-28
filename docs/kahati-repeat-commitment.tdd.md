# TDD evidence — repeat kahati commitments are confirm-only

**Source plan:** none. Journeys were derived during this TDD run from the client
request: "we should not be asked for another downpayment if we already ordered
from the same kahati before … on the second order no downpayment and no payment
at all should be asked … show all the orders they have now in total on that
kahati. And on the checkout as well the back button goes to the cart and the
back button the cart circles back to checkout."

**Scope decision (client-confirmed during the run).** The downpayment reserves a
customer's place in the next parcel, not a slot in one hatian. The client chose
the waiver rule: *while a hatian the customer already ordered from is still
`open`, no further kahati commitment owes a downpayment* — across products, not
just the same kahati. Once every hatian they joined has sealed, the next
commitment pays its own downpayment again.

Assumptions carried, stated to the client and not objected to:

- A cancelled order is not a live commitment (its downpayment was refunded).
- The waiver covers the kahati downpayment only. A cart mixing on-hand stock
  with a waived kahati line still pays for the stock and still needs a proof.

---

## User journeys

1. As a customer with a kahati already in progress, I want to join another
   hatian without being asked for a second downpayment, so that I am not
   deposited twice for one parcel.
2. As that customer, I want the checkout to ask me for nothing at all — no
   payment method, no proof — and simply confirm the order.
3. As that customer, I want to see the total of everything I already have on
   order across my hatians, so I know what this join is being added to.
4. As a first-time kahati customer, I still want to be charged the downpayment,
   so the reservation means something.
5. As an admin, I want an order with no proof to explain itself, so I do not
   chase a screenshot that was never meant to exist.
6. As a customer on the cart screen, I want the back button to take me somewhere,
   not bounce me between cart and checkout forever.

---

## Task report

### 1. The waiver rule, as pure logic

`lib/kahati-commitment.ts` — `hasOpenKahatiCommitment`, `kahatiDownpaymentDue`,
`summarizeKahatiCommitments`. No I/O, so the rule can be read and tested on its
own.

- Command: `npx vitest run lib/kahati-commitment.test.ts`
- RED: `Failed to load url ./kahati-commitment … Does the file exist?` (module absent)
- GREEN: `✓ lib/kahati-commitment.test.ts (11 tests)`
- Guarantees: an empty history waives nothing; one open hatian waives, whatever
  the product; every-sealed stops waiving; the deposit clamps to the order total;
  rollover siblings group under one hatian name; an order spanning two counters
  counts once.

### 2. Reading a customer's commitments

`lib/kahati-commitment-server.ts` (`listKahatiCommitments`) and
`GET /api/kahati/commitments`. The checkout route and the screen that previews
it call the same query, so what the customer is shown cannot disagree with what
they are charged.

- Command: `npx vitest run app/api/kahati/commitments/route.test.ts`
- RED: `Failed to load url ./route … Does the file exist?` (route absent)
- GREEN: `✓ app/api/kahati/commitments/route.test.ts (6 tests)`
- Guarantees: 401 without a session; nothing for a customer who never joined;
  waived once an open commitment exists; totals vials/pesos/orders per hatian;
  stops waiving when all sealed while still listing the commitment; never leaks
  another customer's commitments.

### 3. The money path

`app/api/orders/route.ts` — the waiver is read before the transaction opens (so
it reflects orders that existed *before* this checkout), the downpayment routes
through `kahatiDownpaymentDue`, and a cart of nothing but waived kahati lines
skips proof validation entirely and is written `payment_confirmed`.

- Command: `npx vitest run app/api/orders/kahati-repeat.test.ts`
- RED: `expected 150 to be +0`, `expected 400 to be 201` (×4) — 5 of 10 failing,
  the other 5 being the guards that already held
- GREEN: `✓ app/api/orders/kahati-repeat.test.ts (10 tests)`
- Guarantees: first commitment charges ₱150 and sits in `proof_review`; second
  charges ₱0; second is accepted with no proof at all and stores
  `paymentProofKey = null`; it is confirmed rather than queued for review; the
  vials are still claimed; the waiver crosses hatians; it lapses once all sealed;
  a cancelled order is not a live commitment; a mixed cart still requires proof;
  a first commitment without proof is still rejected.

### 4. The checkout screen

`app/checkout/page.tsx`, `components/OrderSummary.tsx`,
`components/KahatiCommitmentsCard.tsx`. On a waived, kahati-only cart the
payment-method card and the proof card come off the screen; what replaces them
is the running total of what the customer already holds. The button reads
"Confirm order".

- Command: `npx vitest run app/checkout/page.tsx` (file `app/checkout/page.test.tsx`)
- RED: 5 failing in the new block — `GCash` button present, proof input present,
  no "Confirm order" button
- GREEN: `✓ app/checkout/page.test.tsx (15 tests)`
- Guarantees: no payment method and no file input; no "Downpayment due now"; the
  held hatians and their order numbers are listed; the order posts with no
  `proof` field and redirects to the success page; a cart that also holds an
  on-hand item keeps the whole payment section.

### 5. The admin's view of an order with no proof

`app/admin/orders/page.tsx`. Found while reviewing the blast radius: the sheet
rendered a bare "No proof attached." for these orders.

- Command: `npx vitest run app/admin/orders/`
- RED: `Unable to find an element with the text: /no payment was due/i`
- GREEN: `✓ app/admin/orders/no-proof-reason.test.tsx (2 tests)`
- Guarantees: a kahati order with a waived downpayment explains itself; a solo
  order with no proof is still flagged as a genuine gap.

### 6. The cart/checkout back loop

`app/cart/page.tsx`. Checkout's back button pushes `/cart`; the cart's fell
through to `router.back()`, which walked straight back into checkout. The cart
now names its destination.

- Command: `npx vitest run app/cart/page.test.tsx`
- RED: `expected "spy" to be called with arguments: [ '/' ]`
- GREEN: `✓ app/cart/page.test.tsx (2 tests)`
- Guarantees: back leaves for the storefront and never calls `router.back()` or
  pushes `/checkout`; "Proceed to checkout" still goes forward.

---

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|--------------------|----------------------|-----------|--------|----------|
| 1 | A customer with no history waives nothing | `lib/kahati-commitment.test.ts:is false for a customer who has never joined a hatian` | unit | PASS | `npx vitest run lib/kahati-commitment.test.ts` |
| 2 | One open hatian waives the downpayment, whatever the product | `lib/kahati-commitment.test.ts:holds across different hatians` | unit | PASS | same |
| 3 | The waiver lapses once every hatian has sealed | `lib/kahati-commitment.test.ts:is false once every hatian they joined has sealed` | unit | PASS | same |
| 4 | Rollover siblings read as one hatian in the summary | `lib/kahati-commitment.test.ts:groups rollover siblings under one hatian name` | unit | PASS | same |
| 5 | An order spanning two counters is counted once | `lib/kahati-commitment.test.ts:counts an order once even when it spans two counters` | unit | PASS | same |
| 6 | The commitments endpoint requires a session | `app/api/kahati/commitments/route.test.ts:requires a signed-in customer` | integration | PASS | `npx vitest run app/api/kahati/commitments/route.test.ts` |
| 7 | It never reports another customer's commitments | `app/api/kahati/commitments/route.test.ts:never reports another customer's commitments` | integration | PASS | same |
| 8 | It totals vials, pesos and orders per hatian | `app/api/kahati/commitments/route.test.ts:totals what the customer already holds on each hatian` | integration | PASS | same |
| 9 | A first kahati commitment is charged ₱150 | `app/api/orders/kahati-repeat.test.ts:charges the downpayment on the first commitment` | integration | PASS | `npx vitest run app/api/orders/kahati-repeat.test.ts` |
| 10 | A second commitment is charged ₱0 | `app/api/orders/kahati-repeat.test.ts:charges no downpayment on a second commitment` | integration | PASS | same |
| 11 | A second commitment is accepted with no proof | `app/api/orders/kahati-repeat.test.ts:accepts a second commitment with no payment proof at all` | integration | PASS | same |
| 12 | It is confirmed, not queued for proof review | `app/api/orders/kahati-repeat.test.ts:confirms a no-payment commitment` | integration | PASS | same |
| 13 | It still claims the vials | `app/api/orders/kahati-repeat.test.ts:still claims the vials on a confirm-only commitment` | integration | PASS | same |
| 14 | A cancelled order is not a live commitment | `app/api/orders/kahati-repeat.test.ts:does not count a cancelled order` | integration | PASS | same |
| 15 | A mixed cart still requires proof | `app/api/orders/kahati-repeat.test.ts:still requires proof when the cart also holds an on-hand item` | integration | PASS | same |
| 16 | A first commitment without proof is still rejected | `app/api/orders/kahati-repeat.test.ts:still rejects a first commitment that carries no proof` | integration | PASS | same |
| 17 | The waived checkout asks for no method and no proof | `app/checkout/page.test.tsx:asks for no payment method and no proof of payment` | component | PASS | `npx vitest run app/checkout/page.test.tsx` |
| 18 | It shows no downpayment due | `app/checkout/page.test.tsx:shows no downpayment due` | component | PASS | same |
| 19 | It lists the orders already held | `app/checkout/page.test.tsx:lists the orders the customer already holds` | component | PASS | same |
| 20 | It posts with no proof attached | `app/checkout/page.test.tsx:places the order with no proof attached` | component | PASS | same |
| 21 | A mixed cart keeps the payment section | `app/checkout/page.test.tsx:still collects payment when the cart also holds an on-hand item` | component | PASS | same |
| 22 | The admin sheet explains a waived order's missing proof | `app/admin/orders/no-proof-reason.test.tsx:explains that a waived kahati commitment owed nothing` | component | PASS | `npx vitest run app/admin/orders/` |
| 23 | A genuine missing proof is still flagged | `app/admin/orders/no-proof-reason.test.tsx:still flags a missing proof on an order that did owe money` | component | PASS | same |
| 24 | Cart back leaves for the storefront, never into checkout | `app/cart/page.test.tsx:leaves for the storefront rather than circling back` | component | PASS | `npx vitest run app/cart/page.test.tsx` |
| 25 | Cart still moves forward to checkout | `app/cart/page.test.tsx:still sends the customer forward to checkout` | component | PASS | same |

---

## Coverage and known gaps

- `npx vitest run` — **88 test files passed**, 0 failed.
- `npx tsc --noEmit` — clean (exit 0).
- `npx vitest run --coverage lib/kahati-commitment.test.ts` — `lib/kahati-commitment.ts`
  at **100% statements / branches / functions / lines**.
- Reporter limitation, not a coverage gap: the v8 reporter reports 0% for route
  handlers and page components in this repo because every route/component test
  loads its subject through a top-level `await import()` after `vi.mock`. Those
  paths are exercised by the 16 integration and 17 component tests listed above.

Known gaps and follow-ups:

- **No browser QA run.** Everything above is unit/integration/component. The
  confirm-only checkout has not been walked in a real browser against a seeded
  database.
- **No E2E test** covering join → checkout → join again as one Playwright flow.
- The waiver reads `group_buys.status = 'open'`. A hatian that seals between the
  checkout screen loading and the customer confirming would have the server
  charge a downpayment the screen said was ₱0. The `kahati-commitments` query is
  `staleTime: 0` and is invalidated after each checkout, which narrows the window
  but does not close it. Closing it properly means the server telling the client
  what it charged, on the success screen.

---

## Merge evidence

If these checkpoint commits are squashed, this is the record:

- **RED** `32fa528` — `test: reproducers for the repeat-kahati confirm-only checkout and the cart/checkout back loop (RED)`. 10 failing: two modules absent (compile-time RED), `expected 150 to be +0`, `expected 400 to be 201`, missing UI elements, `expected "spy" to be called with [ '/' ]`.
- **GREEN** `ede6f4d` — `fix: a live kahati commitment waives the downpayment, and the cart stops circling into checkout`. 88 test files pass; `tsc --noEmit` clean.
- **GREEN (admin)** — `fix: an order with no proof says why on the admin sheet`, covered by `app/admin/orders/no-proof-reason.test.tsx`.
- No separate refactor commit: the implementation landed in its final shape, with
  the rule extracted to `lib/kahati-commitment.ts` from the start.

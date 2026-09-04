# TDD Evidence — checkout audit: unpaid orders reported as paid, and invented prices

**Source plan**: none on disk. The brief was a client bug report covering the
whole checkout flow; journeys were derived here from reading the path and
querying the live Supabase database.
**Branch**: `feat/group-buy-page`
**Date**: 2026-09-04
**Predecessor**: `docs/testing/checkout-failures.tdd.md` — the same session's
earlier cycle, which fixed six causes of "some customers cannot check out".
Nothing here re-litigates those.

## Two premises in the brief that the codebase does not share

**This application is not multi-tenant.** Zero occurrences of `tenant` in
`app/`, `lib/`, `components/`, `scripts/` or `drizzle/`. Part 6 of the brief
(tenant isolation) has no work in it, and none was invented.

**The frontend was already not trusted for prices.** `app/checkout/page.tsx`
sends `{kind, refId, qty, unit}` and no money; `app/api/orders/route.ts`
re-reads every price from the database inside the checkout transaction. Part 4
needed no refactor. What it needed — and now has — is the *other* half: telling
the customer when the price it re-read differs from the one they were shown.

## What the investigation found

| Claim | Verdict |
|---|---|
| "Payment Confirmed" without proof | **Confirmed, and in the database.** 72 kahati orders born `payment_confirmed`, ₱158,453.75 of goods, ₱0.00 downpayments; 38 carrying no proof at all; 24 still in that state, worth ₱43,500, 2026-08-08 → 2026-09-04 |
| Prices display as ₱0 | **Confirmed.** `php()` rendered `undefined`/`null`/`NaN`/`''`/`'abc'`/`{}`/`[]` as `'₱0'`; `app/admin/products/page.tsx` did `php(x \|\| 0)`, hitting 6 live products |
| Cart cleared merely by clicking Checkout | **Not found.** `clear()` has three call sites; the checkout one runs only after a confirmed 201. A *deliberate* stale-line removal existed and matched kahati by name prefix — that is fixed |
| Duplicate orders | **Ruled out empirically.** 364 orders, all carrying idempotency keys, zero suspected duplicate pairs |
| Someone "copying the app as a static site" | **Ruled out.** No client component reads `process.env`; `.next/static` carries no configured secret; `anon`/`authenticated`/`public` hold **zero** table grants |

RLS is off on all 17 tables. That is survivable only because those grants are
revoked — a single lever with no defence in depth. Flagged, not changed: adding
RLS to a service-key-only app is a separate piece of work with its own blast
radius.

## User journeys

1. As a customer whose second Kahati commitment owes nothing today, I want my
   order to say so, so that I am not told a payment was confirmed that never
   happened and do not stop expecting the balance.
2. As a customer who has uploaded a proof, I want to see that it landed, so that
   I do not upload it again or message to ask.
3. As an admin, I want "payment confirmed" to mean I checked, so that the field
   is worth reading.
4. As anyone looking at a price, I want a price I cannot be shown to look
   unavailable rather than free, so that I never try to buy a ₱0 vial.
5. As a customer whose cart was priced last week, I want to be told the price
   moved, so that I am not billed a total I never reviewed or evidenced.
6. As a customer with two similarly named Kahati counters, I want the closed one
   removed and not the other.
7. As whoever debugs the next report, I want the checkout path to emit events,
   so that the answer is not another database archaeology session.

## Task report

### 1. An order that owed nothing, reported as paid

`orders.status` ran `proof_review → payment_confirmed → batch_filling → shipped
→ delivered`: two payment facts and three fulfilment facts in one column. A
repeat kahati commitment genuinely owes ₱0 at checkout, `proof_review` would
queue an admin review of a proof that does not exist, and the flow had no third
option — so `app/api/orders/route.ts` wrote `payment_confirmed`, which
`lib/order-status.ts` renders as **"Payment Confirmed"**.

`lib/payment-status.ts` is the second field. `orders.status` keeps its meaning
and its flow exactly, so every admin board, email and report is untouched;
`payment_status` describes only money, and has `not_due` — the state that was
missing. `checkoutPaymentStatus` **cannot return** `confirmed` or `rejected`, so
"the frontend may never set payment_confirmed" is a property of the function
rather than a rule beside it.

- RED: `npx vitest run lib/payment-status.test.ts app/api/orders/payment-status.test.ts`
  — `Cannot find module '@/lib/payment-status'` (compile-time RED; the tests
  newly reference the module that does not exist because the concept does not).
- GREEN: same command — 18 passed.

### 2. The badge that said it

`orderBadge` in `lib/order-status.ts` now decides which field a customer-facing
badge is speaking about: payment during `proof_review`/`payment_confirmed`,
fulfilment once the parcel moves, `Cancelled` first. Wired into the orders list
**and** the order detail page — including the detail page's "Status" field under
the *Payment* heading, which was printing the fulfilment status.

A side effect worth having: `proof_review` with a proof now reads "Proof
Submitted" instead of "Payment Pending", so a customer can see their upload
landed.

- RED: `npx vitest run lib/order-badge.test.ts` — `orderBadge is not a function`.
- GREEN: same command — 9 passed.

### 3. Proof upload, and who may confirm

Uploading now moves `pending → proof_submitted` and nothing else, guarded in the
`WHERE` clause rather than an `if`: a late upload cannot reopen a decision an
admin already made, and a `not_due` order is not dragged into a review queue.
The admin route owns `confirmed`/`rejected` via `paymentVerdictFor` — an
explicit verdict wins, entering `payment_confirmed` confirms, cancelling sets
`not_due`, and every other fulfilment move leaves the verdict alone so marking a
parcel shipped cannot silently confirm a payment nobody checked.

### 4. A formatter that invented prices

`lib/format.ts` answered every unusable input with `'₱0'`. The guard existed for
a real reason — it used to throw and took an admin page down — but the options
were never "crash" or "lie". `php()` now returns `PRICE_UNAVAILABLE` (`—`) for
the unknown, still formats a genuine zero as `₱0`, still never throws, and
`isDisplayablePrice` lets a screen refuse to sell what it cannot price. The live
call site (`php(p.onHandKitPhp || 0)`, 6 products) reads `—`.

- RED: `npx vitest run lib/format.test.ts` — 10 failed
  (`expected '₱0' to be '—'`, `isDisplayablePrice is not a function`).
- GREEN: same command — 15 passed.

### 5. Cart prices that go stale

The cart persists `unitPricePhp` in localStorage and nothing revisits it. The
server always billed the correct current price — so nobody was overcharged by a
tampered request — but silently, so a customer who reviewed ₱1,100 and uploaded
a screenshot for ₱1,100 got an order for ₱1,400 with nothing said.

The cart now sends `quotedUnitPricePhp`: **evidence about what the customer saw,
never arithmetic.** No total is computed from it; a request claiming a ₱1 vial is
refused, not honoured. Mismatch is a 409 naming both figures, thrown inside the
transaction so no stock is drawn and no order written.

- RED: `npx vitest run app/api/orders/stale-price.test.ts` — 4 failed
  (`expected 201 to be 409`), including the ₱1 claim, which returned 201.
- GREEN: same command — 6 passed.

### 6. The wrong cart line removed

`i.name.startsWith(stale.kahatiName)` — and kahati counters are named after the
peptide, so "Retatrutide 10mg" is a prefix of "Retatrutide 10mg (Batch 2)".
`matchesStaleLine` now compares exactly, and fails safe: the worst case is a line
that stays and shows its own refusal again, not one that vanishes.

- RED: `npx vitest run lib/checkout-error.test.ts` — `matchesStaleLine is not a function`.
- GREEN: same command — 7 passed.

### 7. No diagnostics at all

Every defect above was found by reading code and querying production, because
the checkout path emitted nothing. `lib/checkout-log.ts` emits one prefixed JSON
line per lifecycle event. Fields are an **allowlist**, so a caller spreading a
request body in leaks nothing — name, phone, address, email, token and
idempotency key are dropped rather than filtered. It cannot throw.

- RED: `npx vitest run lib/checkout-log.test.ts` — `Cannot find module '@/lib/checkout-log'`.
- GREEN: same command — 7 passed.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | The vocabulary has a state for owing nothing, and it is not worded as a confirmation | `lib/payment-status.test.ts` | unit | PASS |
| 2 | No combination of checkout inputs can produce `confirmed` or `rejected` | `lib/payment-status.test.ts` | unit | PASS |
| 3 | A legacy confirmed order **with** proof derives `confirmed`; **without**, `not_due` | `lib/payment-status.test.ts` | unit | PASS |
| 4 | An unrecognised status derives `pending`, never a paid state | `lib/payment-status.test.ts` | unit | PASS |
| 5 | A confirm-only checkout stores `not_due`, and still owes its goods | `app/api/orders/payment-status.test.ts` | integration | PASS |
| 6 | An attached proof stores `proof_submitted`, not `confirmed` | `app/api/orders/payment-status.test.ts` | integration | PASS |
| 7 | Every order a split cart creates comes out unverified | `app/api/orders/payment-status.test.ts` | integration | PASS |
| 8 | A `not_due` order's badge does not say "confirm" | `lib/order-badge.test.ts` | unit | PASS |
| 9 | An uploaded proof is distinguishable from one never sent | `lib/order-badge.test.ts` | unit | PASS |
| 10 | Past the payment phase the badge reports fulfilment; cancelled wins over both | `lib/order-badge.test.ts` | unit | PASS |
| 11 | A legacy row falls back to deriving from its proofs, and never renders empty | `lib/order-badge.test.ts` | unit | PASS |
| 12 | `php()` renders every unusable value as `—`, never `₱0`, and never throws | `lib/format.test.ts` | unit | PASS |
| 13 | A genuine zero still formats as `₱0` | `lib/format.test.ts` | unit | PASS |
| 14 | `isDisplayablePrice` lets a caller refuse to sell what it cannot price | `lib/format.test.ts` | unit | PASS |
| 15 | A stale quote is refused with both figures named; nothing written, no stock drawn | `app/api/orders/stale-price.test.ts` | integration | PASS |
| 16 | A price that FELL is refused too | `app/api/orders/stale-price.test.ts` | integration | PASS |
| 17 | A client-claimed ₱1 price never produces a ₱1 order | `app/api/orders/stale-price.test.ts` | integration | PASS |
| 18 | A cart sending no quote still checks out (older bundles) | `app/api/orders/stale-price.test.ts` | integration | PASS |
| 19 | A closed kahati removes only itself, not a name-prefix sibling | `lib/checkout-error.test.ts` | unit | PASS |
| 20 | Stock shortfalls and price changes are not treated as stale lines | `lib/checkout-error.test.ts` | unit | PASS |
| 21 | A log line carries identifiers/money and drops name, phone, address, email, token, key | `lib/checkout-log.test.ts` | unit | PASS |
| 22 | The logger never throws, even on circular input | `lib/checkout-log.test.ts` | unit | PASS |

## Validation

```bash
npx vitest run     # 260 files, 2750 tests passed   (baseline 254 / 2698)
npx tsc --noEmit   # exit 0
```

**No pre-existing test was weakened or deleted.** `kahati-repeat.test.ts` and
`kahati-downpayment-policy.test.ts` still assert `status === 'payment_confirmed'`
for the confirm-only path and still pass — deliberately, because `status` keeps
its fulfilment meaning and only the new field describes money. That is what makes
this backwards compatible.

## The production backfill is written but NOT applied

`drizzle/0030_order_payment_status.sql` adds the column and backfills by the same
rule `derivePaymentStatus` falls back to. It has been applied 260 times against
PGlite by the test harness, and dry-run read-only against production:

| Would become | From fulfilment status | Orders | Value |
|---|---|---|---|
| `confirmed` | payment_confirmed / shipped / delivered / batch_filling | 248 | ₱1,684,542.50 |
| `not_due` | cancelled | 27 | ₱679,078.50 |
| **`not_due`** | **payment_confirmed (no proof — the reported bug)** | **24** | **₱43,500.00** |
| `not_due` | shipped / batch_filling (no proof) | 6 | ₱16,035.00 |
| `proof_submitted` | proof_review | 59 | ₱275,703.75 |

364 of 364 orders classify; none fall to the `pending` catch-all.

**I have not run it against production** — it rewrites live customer payment
records, and that is your call, not mine. It applies on the next deploy through
the normal migration path, or immediately with `npm run db:push` against prod.

## Coverage and known gaps

No coverage number: the repo defines no coverage script (`package.json` has
`test` only), and the suite is the project's own gate. Deliberately not covered:

- **The migration has not run against real Postgres.** Verified on PGlite and
  dry-run as SELECTs against production, but this repo has a known
  pglite-vs-postgres-js gap, so the write path is unproven on the real driver.
- **No browser QA.** The badge changes, the 409 price-change toast and the `—`
  price want a pass against PGlite + `STORAGE_DRIVER=local`.
- **RLS is still off on all 17 tables.** Flagged as HIGH and left alone: the
  revoked grants make it currently unexploitable, and adding RLS to a
  service-key-only app is separate work.
- **`app/api/files/[bucket]/[...key]/route.ts` still checks session, not
  ownership.** Local-driver only (production uses ImageKit) and keys are
  `randomUUID()`, so it is LOW and untouched.
- **The 409 price-change path has no component test.** The server side is
  covered; the checkout page's handling of it is not.
- **Whether the stale-quote guard fires often in practice is unknown.** That is
  precisely what `price_changed_mid_checkout` was added to answer — check the
  logs before deciding it is too strict.

## Merge evidence

RED → GREEN preserved in two commits on `feat/group-buy-page`:

```
f84e886 fix: stop checkout claiming payments it never received, and prices it cannot read
e63df47 test: add reproducers for the confirmed-but-unpaid order and the invented ₱0
```

If these are squashed, this file is the surviving record of what was verified.

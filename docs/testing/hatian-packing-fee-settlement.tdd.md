# TDD evidence — hatian packing fee charged once at a final checkout

**Source plan:** inline `/ecc:plan` run, 2026-07-26 (no `.plan.md` artifact; the
plan was confirmed in-session and its four open decisions answered by the client).
**Branch:** `fix/products-mgmt-add-bugs`
**Commits:** `f6a537c` → `f87317e`

## Business rule

A customer must **not** be charged the packing fee every time they commit to a
hatian. They may join and commit to as many hatian batches as they like, paying
only the reservation downpayment. The packing fee is collected **once**, at the
final checkout where they settle every completed hatian order — because those
batches ship as one parcel.

### Decisions confirmed before implementation

| Question | Answer |
|---|---|
| When is a hatian order ready to settle? | When its group buy has reached `closed` / `shipped` / `completed`. Automatic, no admin flag. |
| Who performs the final checkout? | The customer, self-serve, with a proof upload the admin then verifies. |
| Does the rule extend beyond hatian? | No. On-hand, MOQ shelf and Pasabay campaigns keep charging at checkout. |
| Where does admin see commitments? | A participants panel per hatian in Admin → Group Buys. |

## User journeys

1. As a customer, I want to join several hatians without paying a packing fee each
   time, so joining more batches does not cost me more in fees.
2. As a customer, I want one final checkout that settles every completed hatian
   order under a single packing fee, so I know exactly what I still owe.
3. As a customer, I want to see on My Orders that my completed hatians are ready
   to settle, so the balance does not sit unnoticed.
4. As an admin, I want each hatian's participants with their vials, commitment
   time and three payment states, so I can chase whoever has not settled.
5. As an admin, I want to confirm a final payment, so the packing fee reads Paid.

## Task report

### Phase 1 — stop charging at commit (`f6a537c` RED → `28a86cc` GREEN)

Kahati became a deferred packing mode: `packingFeeFor` skips it in both the server
rule (`lib/pricing.ts`) and the cart mirror (`lib/store/cart.ts`). Added
`settlementPackingFee()` — the single fee a settlement charges.

```
$ npx vitest run lib/pricing.test.ts lib/store/cart.test.ts \
    app/api/orders/split.test.ts app/api/orders/route.test.ts
RED:    Tests  22 failed | 107 passed (129)
        → settlementPackingFee is not a function
        → expected 150 to be +0   (kahati still billed at commit)
GREEN:  Tests  129 passed (129)
```

Three further suites held stale expectations of the old rule and were updated to
the new spec (`lib/order-modes.test.ts`, `app/api/orders/kahati-overflow.test.ts`).

### Phase 2 — schema (`56ec111`)

`settlements` table + `orders.settlement_id`, migration `0009_curious_captain_stacy.sql`.
The PGlite harness truncates the new table between tests. `declaredShape()` reflects
`schema.ts`, so `npm run db:check` covers the new table with no edit.

### Phase 3 — settlement API (`28ac3eb` RED → `703404c` GREEN)

```
$ npx vitest run lib/settlement.test.ts app/api/settlements/
RED:    Failed to load url ./settlement, ./route — modules do not exist
GREEN:  Tests  33 passed (33)
$ npx vitest run app/api/admin/settlements/
RED:    Failed to load url ./route
GREEN:  Tests  6 passed (6)
```

### Phase 4 — customer final checkout (`ae4c431`)

```
$ npx vitest run "app/(storefront)/settle" "app/(storefront)/orders"
RED:    Failed to resolve import "./page"  (settle)
        Unable to find text /ready to settle/i  (orders prompt)
GREEN:  Tests  9 passed (9)
```

### Phase 5 — admin participants panel (`f87317e`)

```
$ npx vitest run app/api/admin/groupbuys/commitments.test.ts
RED:    Failed to load url ./[id]/commitments/route
GREEN:  Tests  5 passed (5)
$ npx vitest run app/admin/groupbuys/
RED:    Tests  5 failed | 3 passed (8)
        → Unable to find button named /participants/i
GREEN:  Tests  8 passed (8)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A hatian commitment is charged no packing fee, whatever the listing fee | `lib/pricing.test.ts:deferred kahati packing fee` | unit | PASS |
| 2 | A hatian commitment's total equals its subtotal | `lib/pricing.test.ts:leaves a kahati commitment total equal to its subtotal` | unit | PASS |
| 3 | Other modes keep their fee in a cart that also holds a hatian | `lib/pricing.test.ts:still charges the other modes their fee` | unit | PASS |
| 4 | A settlement charges one fee — the largest of the settled hatians' | `lib/pricing.test.ts:settlementPackingFee` | unit | PASS |
| 5 | The cart quotes ₱0 for hatian lines, matching the server | `lib/store/cart.test.ts:charges nothing for a kahati cart` | unit | PASS |
| 6 | Repeated commitments never stack a fee across visits | `app/api/orders/route.test.ts:charges one packing fee per hatian commitment, never accumulating across visits` | integration | PASS |
| 7 | Overflow across two counters is still ₱0 at commit | `app/api/orders/kahati-overflow.test.ts` | integration | PASS |
| 8 | Only orders whose hatians have all closed are settleable | `lib/settlement.test.ts:isReadyToSettle` | unit | PASS |
| 9 | A legacy order that paid at commit is not billed a second fee | `lib/settlement.test.ts:charges no second fee for a legacy order` | unit | PASS |
| 10 | Three hatians joined across separate visits quote one ₱150 fee | `app/api/settlements/route.test.ts:quotes one packing fee for hatians joined across separate visits` | integration | PASS |
| 11 | Open hatians are excluded from the quote | `…:leaves out commitments whose hatian is still open` | integration | PASS |
| 12 | A settlement charges the fee once and attaches every settled order | `…:charges the packing fee once`, `…:attaches every settled order` | integration | PASS |
| 13 | Already-settled orders cannot be settled again | `…:never creates a second packing fee for orders already settled` | integration | PASS |
| 14 | A retried submission replays instead of charging again | `…:replays the original settlement when the same submission is retried` | integration | PASS |
| 15 | A hatian completing later is its own parcel with its own fee | `…:charges a fresh packing fee for a hatian that completes after an earlier settlement` | integration | PASS |
| 16 | A customer can never settle another customer's orders | `…:never settles another customer's orders` | integration | PASS |
| 17 | Packing fee reads unpaid before, paid after admin confirmation | `…:packing fee status through the settlement lifecycle`, `app/api/admin/settlements/route.test.ts` | integration | PASS |
| 18 | Cancelling a settlement releases its orders to be settled again | `app/api/admin/settlements/route.test.ts:releases the orders` | integration | PASS |
| 19 | The final checkout shows one fee line and the correct total | `app/(storefront)/settle/page.test.tsx` | component | PASS |
| 20 | My Orders prompts the customer once a hatian is ready to settle | `app/(storefront)/orders/page.test.tsx` | component | PASS |
| 21 | Admin sees customer, vials, commit time and the three payments apart | `app/admin/groupbuys/page.test.tsx:hatian participants panel` | component | PASS |
| 22 | Admin API reports the three payment states per participant | `app/api/admin/groupbuys/commitments.test.ts` | integration | PASS |

## Validation

```
$ npm run test
 Test Files  79 passed (79)
      Tests  688 passed (688)          # baseline before this work: 73 files / 621 tests

$ npx tsc --noEmit --pretty false
 (clean)

$ npx vitest run <settlement suites> --coverage.include='lib/settlement*.ts' \
    --coverage.include='lib/pricing.ts' --coverage.include='app/api/**settlements/**'
 All files          |   96.79 |    96.64 |   96.66 |   96.79
  lib/settlement.ts |     100 |     100  |    100  |     100
  lib/pricing.ts    |     100 |   98.61  |    100  |     100
```

## Production migration (applied 2026-07-26)

Migration `0009` was applied to the live Supabase project through the Supabase MCP
as `0009_settlements_hatian_final_checkout`, after confirming the MCP and `.env`
address the same database (matching row counts; `.env` host is that project's
pooler). Purely additive: one new enum, one new table, one nullable column, two
indexes and two foreign keys — no existing column or row was altered.

```
$ npm run db:check
Database matches schema.ts — no drift.
```

### Legacy orders on the live database

Every one of the 13 existing kahati orders was charged its packing fee at commit
time under the old rule (₱150–₱350 on the order row). The settlement fee is
computed only from orders with `packing_fee_php = 0`, so those customers are
quoted **₱0** in packing fees when they settle — they are not billed twice.
Verified against production:

| Customer | Ready orders | Balance due | Settlement packing fee |
|---|---|---|---|
| realpapitotz@gmail.com | 7 | ₱49,937.50 | **₱0** |
| ana@example.com | 2 | ₱15,457.50 | **₱0** |
| admin@bbgpeptides.ph | 1 | ₱2,125.00 | **₱0** |

One further commitment sits on a still-open hatian and is correctly excluded.
The first customer would have paid seven packing fees under the old rule; going
forward, new commitments carry no fee and settle under a single one.

## Known gaps
- **Flaky under load, not a regression.** Two full-suite runs each showed one
  DB-heavy test hitting the 10s hook timeout — a different file each time
  (`idempotency.test.ts`, then `kahati-expiry.test.ts`), both passing in isolation
  and in a clean full run. It worsens under coverage instrumentation, which is why
  the coverage figure above is scoped rather than whole-suite.
- **No E2E.** The final-checkout flow is covered by component + integration tests;
  no Playwright journey was added.
- **Legacy orders.** Hatian orders placed before this change keep their
  commit-time fee and read as "packing fee paid"; they are never billed twice, but
  their fee was per-commitment under the old rule.

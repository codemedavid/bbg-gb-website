# Multi-hatian cancellation + the customer's batch view — TDD evidence

**Source plan:** no `*.plan.md`. Scope came from three findings I reported in
the same session, which the user prioritised: *"yes fix them in that order,
start with 1 and 2"*, plus a customer-facing requirement quoted from the client:

> *"di kasi nila alam if pumasok ba ang na place nila or wala kasi last time
> kino call out pa naman sila para magbayad. Inisa isa ko pa send para
> magbayad. Kasi inaantay lang nila magkano babayaran at ano ang pumasok sa
> kanila."*

## User journeys

1. As a customer who joined several hatians in one checkout, I keep the
   commitments that reached their minimum when another one fails.
2. As a customer, my order is re-billed to what actually survived — I am never
   charged for a vial nobody ordered.
3. As an admin, a healthy counter keeps holding the vials of an order that only
   partly failed.
4. As a customer, I see my orders grouped by batch.
5. As a customer, I see for each hatian whether it got in, is still filling, or
   was cancelled — so nobody has to call me to find out.
6. As a customer, I see how much I owe for that batch, so I am not chased one by
   one.

## Task report

### 1. Cancel the failed lines, not the whole order

`splitCartIntoOrders` splits a cart by **mode**, not by product
(`lib/order-modes.ts:44-51`), so joining five hatians in one checkout is ONE
order with five lines. `releaseKahatiOrders` cancelled the whole **order** when
any one counter fell short — so a customer lost the four batches that made their
minimum because the fifth did not, and got a different outcome from the same
purchase depending only on how many times they pressed checkout.

`lib/pasalo-server.ts:releaseRefundedLines` already ends this at the Pasalo
close and names it in its own comment: *"the same order-granularity mistake this
whole function was written to end, one level up."* This is that level up.

RED:

```
$ npx vitest run lib/kahati-server.test.ts
× leaves the order alive when another of its counters survived
  -> expected 'cancelled' not to be 'cancelled'
× re-bills the order to the lines that survived
  -> expected 4500 to be 1800
 Tests  2 failed | 16 passed (18)
```

First implementation attempt left one failure — an order holding lines on two
counters failing in the same sweep was kept alive by each on the strength of the
other:

```
× still cancels an order whose every counter failed
 Tests  1 failed | 17 passed (18)
```

Fixed by requiring a surviving line's counter to be non-cancelled. GREEN:

```
$ npx vitest run lib/kahati-server.test.ts lib/kahati-cancellation-notice.test.ts
 Test Files  2 passed (2)
      Tests  23 passed (23)
```

**Finding #2 dissolved rather than being fixed separately.** The reported defect
was that a cancelled order's vials stayed claimed on healthy counters. Once the
order is no longer cancelled, those vials are legitimately still held. The test
`keeps the surviving counter holding its vials` pins it so the fix cannot trade
one defect for the other. It passed before the change too — for the wrong
reason — and that is recorded in the RED commit rather than presented as driven.

### 2. My Orders, by batch

`lib/order-batches.ts` groups a customer's orders by `cycle_key` and gives each
commitment a three-way verdict — `in` / `waiting` / `cancelled`.

RED (module missing), then GREEN:

```
$ npx vitest run lib/order-batches.test.ts
 Test Files  1 failed (1)      ->  Tests  14 passed (14)
      Tests  no tests
```

Screen RED:

```
$ npx vitest run "app/(storefront)/orders/page.test.tsx"
× groups the orders into the batch they were placed in
× says a hatian that reached its minimum got in
× says how many more vials a hatian still needs
× says a cancelled hatian did not get in
× shows what the whole batch still owes
  -> Unable to find an element by: [data-testid="commitment-o1-0"] / "batch-amount-due"
```

GREEN:

```
$ npx vitest run "app/(storefront)/orders/page.test.tsx"
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

### 3. Whole-suite and type check

```
$ npx tsc --noEmit --pretty false     # exit 0

$ npx vitest run
 Test Files  289 passed (289)
      Tests  3187 passed (3187)
```

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result |
|---|--------------------|----------------------|-----------|--------|
| 1 | An order survives when another of its counters is still going | `lib/kahati-server.test.ts:leaves the order alive when another of its counters survived` | integration | PASS |
| 2 | The surviving counter keeps holding its vials | `…:keeps the surviving counter holding its vials` | integration | PASS |
| 3 | A partly-failed order is re-billed to its survivors only | `…:re-bills the order to the lines that survived` | integration | PASS |
| 4 | An order whose every counter failed is still cancelled | `…:still cancels an order whose every counter failed` | integration | PASS |
| 5 | A counter at its minimum reads as "got in" | `lib/order-batches.test.ts:says a counter that reached its minimum got in` | unit | PASS |
| 6 | A counter below its minimum reads as still filling | `…:says a counter still short of its minimum is still filling` | unit | PASS |
| 7 | A sealed counter reads as "got in" whatever its count | `…:says a sealed counter got in` | unit | PASS |
| 8 | A cancelled counter reads as "did not get in" | `…:says a cancelled counter did not get in` | unit | PASS |
| 9 | A Pasalo counter is judged on the combined count | `…:judges a Pasalo counter on whether it has reached the minimum yet` | unit | PASS |
| 10 | A counter's own frozen minimum is used, not today's constant | `…:never leaves a counter permanently short of an unreachable minimum` | unit | PASS |
| 11 | Orders of one cycle group into one batch, newest first | `…:puts every order of one cycle in one batch`, `…:leads with the newest batch` | unit | PASS |
| 12 | Orders belonging to no batch are kept, grouped last | `…:keeps orders that belong to no batch, last` | unit | PASS |
| 13 | A batch totals what it still owes, excluding cancelled orders | `…:totals what the batch still owes`, `…:leaves a cancelled order out of what the batch owes` | unit | PASS |
| 14 | Vials are counted as in / waiting / fell through | `…:counts the vials that got in, are still filling, and fell through` | unit | PASS |
| 15 | The grouping does not mutate the caller's orders | `…:does not mutate the caller's orders` | unit | PASS |
| 16 | My Orders groups by batch and shows the batch's amount due | `app/(storefront)/orders/page.test.tsx:groups the orders…`, `…:shows what the whole batch still owes` | component | PASS |
| 17 | Each hatian says pumasok / kulang pa (with the count) / hindi pumasok | `…:says a hatian that reached its minimum got in`, `…:says how many more vials a hatian still needs`, `…:says a cancelled hatian did not get in` | component | PASS |

## Coverage

```
File                   | % Stmts | % Branch | % Funcs | % Lines | Uncovered
lib/order-batches.ts   |     100 |       85 |     100 |     100 | 137-147
lib/kahati-server.ts   |   82.02 |    83.72 |      75 |   82.02 | 192-194,302-386
```

Both clear the 80% target. `kahati-server.ts` lines 302-386 are
`rollOpenKahatis`, covered by its own suites rather than this scoped run.

## Known gaps and deliberate choices

- **Legacy mixed orders are unchanged.** An on-hand line does not keep an order
  alive, so a legacy pre-split order carrying both kinds is still cancelled and
  its stock returned — the behaviour `still restocks on-hand lines inside a
  legacy pre-split mixed order` was given deliberately and is tested for.
  Whether an on-hand purchase should survive a failed hatian is a separate call
  for the client; I did not make it unilaterally.
- **Finding #3 is still open.** `orderItemRefunds` rows are created only by
  `lib/pasalo-server.ts`. A counter cancelled by the expiry sweep still creates
  no refund row, so it does not reach the refund sheet. Not in this scope.
- **The partial-cancellation email.** A surviving order now reports a 0 refund
  and `orderCancelled: false`; the email template itself was not rewritten to
  word the two cases differently.
- **No browser/visual pass** on the new My Orders batch sections.
- **No migration.** Everything derives from existing columns.

## Merge evidence

```
(RED)   test: reproduce a whole order cancelled by one failed hatian
(GREEN) fix: cancel only the failed hatian's lines, not the customer's whole order
(RED)   test: require a per-batch view of what a customer got into
(RED)   test: require My Orders to group by batch and say what got in
(GREEN) feat: show My Orders by batch, and whether each hatian got in
```

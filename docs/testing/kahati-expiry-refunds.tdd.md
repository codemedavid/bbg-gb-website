# Refunds for a hatian cancelled below its minimum — TDD evidence

**Source plan:** none. This is finding #3 of three I reported in-session; the
user prioritised them *"fix them in that order"* and, after #1 and #2 shipped,
said *"do the 3"*.

## The defect

`order_item_refunds` was written in exactly one place: `lib/pasalo-server.ts`,
the Pasalo close. A counter cancelled by the **expiry sweep** — one that never
reached its minimum and never went through Pasalo — did three things:

- cancelled the participants' orders,
- emailed each customer about their refund (`kahatiCancelledEmail`),
- fired a PostHog event carrying the refund amount,

and recorded **no refund row**. So the money was owed, the customer had been
told it was coming, and nothing in the system tracked whether it was ever
actually sent. It never reached the refund panel or the refund export.

The report was never the problem. `lib/report/pasalo-refund-server.ts:53-58`
filters `order_item_refunds` by `createdAt` range alone — not by counter, not by
stage — so rows written anywhere appear in it. Only the writing was missing.

## User journey

7. As an admin, a hatian cancelled for missing its minimum appears on the refund
   sheet like any other refund, so nobody has to remember it by hand.

## Task report

Amounts are computed by `buildPasaloRefunds` (`lib/pasalo-refund.ts`) and written
through `writeRefundRows` (`lib/pasalo-server.ts`, now exported) — the same
rules and the same writer the Pasalo close uses. Two writers would be two
chances to disagree about what a customer is owed, on the one table where that
is unaffordable.

`buildPasaloRefunds` needs every line the customer holds, not just the failed
ones: a surviving line means their parcel still ships and their deposit stays
earned. Lines on counters cancelled **earlier** are excluded — they were
refunded when their own counter went, and counting them as survivors here would
make the customer look like they were still getting a parcel, so their deposit
would never come back from any counter at all.

RED:

```
$ npx vitest run lib/kahati-server.test.ts
× writes a refund row for the line on the cancelled counter
× refunds the deposit the customer actually paid
× does not book a second refund when the sweep runs again
× keeps the deposit when the order survives on another counter
  -> expected [] to have a length of 1 but got +0
```

GREEN:

```
$ npx vitest run lib/kahati-server.test.ts lib/kahati-cancellation-notice.test.ts \
    lib/pasalo-server.test.ts
 Test Files  3 passed (3)
      Tests  50 passed (50)

$ npx tsc --noEmit --pretty false     # exit 0

$ npx vitest run
 Test Files  289 passed (289)
      Tests  3191 passed (3191)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | A cancelled hatian books a refund row against its counter | `lib/kahati-server.test.ts:writes a refund row for the line on the cancelled counter` | integration | PASS |
| 2 | The refund returns the deposit actually collected, and the stored total is its parts | `…:refunds the deposit the customer actually paid` | integration | PASS |
| 3 | A repeat sweep does not book a second refund | `…:does not book a second refund when the sweep runs again` | integration | PASS |
| 4 | A customer still getting a parcel keeps their deposit; only the failed vials are owed | `…:keeps the deposit when the order survives on another counter` | integration | PASS |

Test 3 rests on the unique index on `order_item_refunds.order_item_id` plus
`onConflictDoNothing` — the schema calls that uniqueness "the anti-double-count
guarantee", and this pins that it holds for the sweep as well as the close.

## Coverage

```
File                 | % Stmts | % Branch | % Funcs | % Lines | Uncovered
lib/kahati-server.ts |   85.11 |    83.87 |   77.77 |   85.11 | 195-197,305-389
```

Clears the 80% target. Lines 305-389 are `rollOpenKahatis`, exercised by its own
suites rather than this file.

## Known gaps and deliberate choices

- **The deposit is refunded on the LAST of a customer's counters to fail**, not
  spread across them. That falls out of reusing `buildPasaloRefunds`, whose
  deposit pool is spent once per customer per batch. It is the correct total; it
  just attributes the deposit to one line.
- **The partial-cancellation email: resolved, not left open.** This was flagged
  as a gap and then built. A customer whose order survives on another counter
  now gets `kahatiPartlyCancelledEmail` instead of the whole-order notice. Own
  RED/GREEN cycle:

  ```
  (RED)   test: require a different email when only part of an order fell through
          × does not tell the customer their order was cancelled
          × says the order is still going ahead, and with how many vials
          × quotes the new total the order was re-billed to
          Tests  3 failed | 8 passed (11)
  (GREEN) feat: tell a customer their order continues when only one hatian fell short
          Tests  33 passed (33); full suite 289 files, 3197 passed
  ```

  Two of the five partial-case tests passed before the change, incidentally: the
  old template says "no payment was collected" at a 0 downpayment, and it
  already named the hatian and its shortfall. They are kept as guards, not
  claimed as driven failures.

  The notice carries `releasedVials`, `survivingVials` and `newTotalPhp`; the
  PostHog event reports `partly_cancelled` rather than claiming a cancellation
  that did not happen; `email_log.kind` is a plain varchar, so the new kind
  needed no migration.
- **Legacy mixed orders: resolved, not left open.** This was flagged as a
  deliberate gap and the client answered it — *"onhand is onhand retail so no
  need for any cancelled since the user is buying a onhand stocks in the
  inventory"*. An on-hand line now keeps the order alive and the stock is never
  clawed back. Own RED/GREEN cycle:

  ```
  (RED)   test: require a failed hatian to leave on-hand retail goods alone
          × keeps the on-hand goods in a legacy pre-split mixed order
            -> expected 50 to be 46
  (GREEN) fix: never cancel on-hand retail goods because a hatian fell short
          Tests  22 passed (22); full suite 289 files, 3191 passed
  ```

  This replaced `still restocks on-hand lines inside a legacy pre-split mixed
  order`, which encoded the old behaviour deliberately. The restock loop in
  `releaseKahatiOrders` became unreachable and was removed;
  `vialsForOrderLine` stays, since the admin cancel path and
  `lib/order-edit-server.ts` both still restock through it.
- **No migration.** `order_item_refunds` already existed; only its writers grew.
- **No browser/visual pass.** The refund panel and export were not changed, so
  there was nothing new to look at — but the rows now appearing in them have not
  been eyeballed in a browser.

## Merge evidence

```
(RED)   test: reproduce a failed hatian that owes a refund nothing tracks
(GREEN) fix: book the refund a cancelled hatian owes, so the sheet can see it
```

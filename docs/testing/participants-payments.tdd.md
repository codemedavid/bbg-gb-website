# TDD evidence — Participants & Payments (client item 5)

**Source plan**: none. Journeys were derived during this TDD run from the client's
written request, after an audit of items 2–6 against the codebase.

**Branch**: `feat/group-buy-section`
**Commits**: `dc05b1a` … `3286d00`

## User journeys

1. As an admin, I want to open **Participants & payments** without the page
   crashing, so that I can see who is in a batch at all.
2. As an admin, I want each participant's contact number and shipping address on
   the same screen, so that I can pack and label a parcel without leaving the
   panel and losing my place in the batch.
3. As an admin, I want to see what a participant has **paid** separately from
   what they still **owe**, so that a customer who paid their downpayment does
   not read as one who has paid nothing.
4. As an admin, I want each proof of payment as a thumbnail I can click to
   enlarge, so that I can verify a reference number without opening the orders
   screen once per row.
5. As an admin, I want a batch summary, so that I know how many vials to order
   from the supplier and what the batch is worth.
6. As an admin, I want cancelled orders excluded from the gross income and the
   supplier ordering total, so that I do not over-order and over-forecast.

## Task report

### Task 1 — group buy configuration columns (`dc05b1a`)

`lib/pricing.ts` (already committed as `a418ba2`) read product columns whose
schema had never been committed. Committed `lib/db/schema.ts` and
`drizzle/0013_harsh_mauler.sql` together so the seeding rules have the table they
read. No new tests: `lib/pricing.test.ts` (85 tests) already covered the rules.

### Task 2 — the crash itself (`1b45c69`)

Root cause, three parts:

- The feed renamed `balancePhp` → `orderBalancePhp`; the panel kept reading the
  old name and got `undefined`.
- `php(undefined)` **threw** rather than degrading, so React unmounted the whole
  admin tree into Next's client-side exception screen.
- The panel's own test fixture had drifted the same way and stayed green, so no
  test could catch it.

Fixes: `php()` returns `₱0` for any non-finite value while still rejecting
nullable arguments at compile time; the route annotates its rows with
`HatianCommitment` and the fixture is typed with it, so a rename on either side
is now a compile error.

```
GREEN: npx vitest run app/admin/groupbuys app/api/admin/groupbuys
       Test Files  7 passed (7)
            Tests  143 passed (143)
```

### Task 3 — batch summary module (`5e8e4f9` RED → `4e32538` GREEN)

```
RED:   npx vitest run lib/hatian-batch-summary.test.ts
       Error: Failed to load url ./hatian-batch-summary — the module does not exist.

GREEN: npx vitest run lib/hatian-batch-summary.test.ts
       Test Files  1 passed (1)
            Tests  17 passed (17)
```

Guarantees: gross income is `vials × this counter's per-vial price`, never the
sum of the balance column (an overflow commitment reports the whole order's
balance under both counters it spans); cancelled orders contribute to neither
income nor vials reserved; `confirmed + pending + cancelled === totalParticipants`.

### Task 4 — the feed (`95f8f04` RED → `2654be2` GREEN)

```
RED:   npx vitest run app/api/admin/groupbuys/[id]/commitments/route.test.ts
       Tests  6 failed | 5 passed (11)

GREEN: same command
       Tests  11 passed (11)
```

Two of the new tests were **wrong and were corrected, not the implementation**:

- A fresh commitment sits in `proof_review`, so nothing has cleared — asserting
  `amountPaidPhp === downpaymentPhp` on a fresh order was incorrect. Split into
  an under-review case and an admin-confirmed case.
- Checkout only accepts a **registered, active** payment method, so the test
  needed `makePaymentMethod({ label: 'GoTyme' })`.

### Task 5 — the panel (`ff39520` RED → `3286d00` GREEN)

```
RED:   npx vitest run app/admin/groupbuys/page.test.tsx
       23 tests | 11 failed

GREEN: npx vitest run app/admin/groupbuys app/api/admin/groupbuys \
       lib/hatian-batch-summary.test.ts lib/pricing.test.ts
       Test Files  7 passed (7)
            Tests  168 passed (168)
```

The `settled-count` banner ("1 of 2 fully settled") was **removed**, not kept.
The batch summary answers the same question in the same place as every other
total, and unlike the banner it does not conflate a cancelled order with an
unpaid one. Its test was rewritten against the summary rather than deleted.

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|---|---|---|---|
| 1 | A money formatter never takes the admin down: `php()` degrades to ₱0 on non-finite input | `app/admin/groupbuys/page.test.tsx` | unit | PASS |
| 2 | The feed and the panel share one contract; a rename is a compile error | `app/api/admin/groupbuys/[id]/commitments/route.test.ts:sends every field the participants panel renders` | integration | PASS |
| 3 | Commitment timestamps arrive as ISO strings, not Date objects | `…/route.test.ts:timestamps commitments as ISO strings` | integration | PASS |
| 4 | Contact number and address come from the order's checkout snapshot | `…/route.test.ts:sends the contact number and shipping address captured at checkout` | integration | PASS |
| 5 | A proof still under review counts as ₱0 received | `…/route.test.ts:counts nothing paid while the proof is still under review` | integration | PASS |
| 6 | A confirmed downpayment counts as received, and is not the balance | `…/route.test.ts:counts a downpayment as received once the admin confirms it` | integration | PASS |
| 7 | Proofs reach the browser as signed URLs, never raw storage keys | `…/route.test.ts:sends a fetchable URL for the uploaded proof` | integration | PASS |
| 8 | The panel shows contact, address, amount paid, method and order status | `page.test.tsx:shows how to reach each participant…`, `…separates what a participant has paid…` | unit | PASS |
| 9 | Proofs render as fixed-dimension thumbnails and open in a lightbox | `page.test.tsx:proof of payment` (4 tests) | unit | PASS |
| 10 | Gross income is vials × per-vial price, never the summed balance column | `lib/hatian-batch-summary.test.ts:does not let a shared order balance double-count` | unit | PASS |
| 11 | Cancelled orders leave gross income and vials reserved untouched | `lib/hatian-batch-summary.test.ts:cancelled orders` (5 tests), `page.test.tsx:keeps a cancelled order out of…` | unit | PASS |
| 12 | The three payment counts partition the participant count exactly | `lib/hatian-batch-summary.test.ts:files a cancelled order under neither` | unit | PASS |
| 13 | An empty hatian renders a zeroed summary, not NaN | `lib/hatian-batch-summary.test.ts:reports a zeroed summary` | unit | PASS |

## Coverage and known gaps

```
npx vitest run
Test Files  6 failed | 96 passed (102)
     Tests  1 failed | 935 passed (936)
```

**All 6 failing files are pre-existing and unrelated to this work.** They are the
Item-4 tests (`app/admin/group-buy/**`, `lib/campaign-draft.test.tsx`,
`lib/campaign-form.test.ts`) whose implementation lives on the
`feat/group-buy-page` branch and is absent here. They fail to import.

Typecheck is clean for every file this work touched. Two pre-existing `tsc`
failures remain and are **not** fixed here:

1. The orphaned Item-4 tests above (missing modules).
2. `components/admin/CampaignProductQuickEdit.tsx` reads `Product.groupBuyKitPhp`,
   `groupBuyPiecePhp`, `groupBuyMinOrder`, `groupBuyMaxBatch` and `vialsPerKit` —
   **none of which exist on the `Product` type**. The Item-3 modal does not
   compile. It is also not wired to any campaign form.

Intentional gaps in this work:

- **Batch number and Product are still absent from the panel header.** A hatian
  has no `batch_no` column — counters roll into same-named siblings instead —
  and `groupBuys.productId` exists but the admin list feed returns raw rows with
  no product join and no `perVialPhp`. Both need a decision before implementing.
- **No E2E test.** The panel is covered at the unit and integration layers only;
  the crash it fixes was found by live QA, and a Playwright journey through the
  admin board would have caught it earlier.
- Migration `0013` is committed but **not applied** to the Supabase database in
  `.env`. Anything reading the new product columns will 500 until it runs.

# Pasalo (Bunuan) stage + refund determination + XLSX export — TDD record

**Source plan:** derived in-session from the client brief (audit → Phases A–L),
with four decisions taken by the client before any code was written:

| Decision | Answer |
|---|---|
| Is "Bunuan" a separate stage? | No — Bunuan **is** Pasalo. One stage, `pasalo` in code and DB. |
| Do qualified 7–9 counters stay open? | **Yes**, for top-up. They close with everything else. |
| What counts toward the 7-vial minimum? | **Commit-time vials**, as today, with a separate *payment-confirmed* column so the gap is visible. |
| Three live bugs found in the audit | Fixed **inside** the item-level rewrite, with regression tests. |
| Who closes the stage? | **The admin, manually.** That close is what generates the refund determination. |

---

## User journeys

1. As an admin, when Kahati ends I want short counters to get a second selling
   window instead of being cancelled, so a batch four vials from success is not
   refunded.
2. As a customer, I want to see how many vials a batch still needs **to proceed**
   — not how many until the box is full — so I can tell whether my vial matters.
3. As an admin, I want to close the stage myself and have that close decide every
   counter, so no clock cancels an order or books a refund unattended.
4. As a customer with a mixed result, I want my successful products to keep
   shipping and only the failed one refunded.
5. As an admin, I want a real .xlsx I can sort, filter and sum, showing exactly
   why each customer is owed each peso.
6. As an admin, I want downloading that file to change nothing, and marking a
   refund paid to require a reference.

---

## The load-bearing finding

The audit's central discovery, which changed the whole refund calculation:

> A hatian collects a **deposit** at checkout and settles the goods only *after*
> the batch is confirmed (`lib/settlement.ts`). At Pasalo close the common state
> is a customer who has paid ₱150 and owes ₱4,000.

So refunding a failed line's `line_total_php` by default would pay out money
that never came in. `lib/pasalo-refund.ts` therefore refunds **goods** only where
a settlement was paid (or a pre-deferral order's checkout payment was verified),
and the **deposit** only where nothing the customer ordered survived — because
the packing fee buys one parcel, and a mixed result still gets one.

---

## Task report

### C — quantity vocabulary (`lib/kahati-quantity.ts`)

- **RED:** `npx vitest run lib/kahati-quantity.test.ts` →
  `Failed to load url ./kahati-quantity … Does the file exist?` (0 tests)
- **GREEN:** same command → `20 passed`
- **Guarantees:** `neededToQualify` is the gap to the **minimum** and
  `slotsRemaining` the gap to the **cap**; a Kahati joiner cancelling during
  Pasalo cannot produce negative Pasalo vials; a counter capped below 7 has its
  minimum bowed to the cap so it stays winnable.

### D/G/H — stage lifecycle and item-level release (`lib/pasalo{,-server}.ts`)

- **GREEN:** `npx vitest run lib/pasalo.test.ts lib/pasalo-server.test.ts` →
  `18 passed` + `23 passed`
- Three pre-existing production defects fixed here, each with a named test:
  1. `releaseKahatiOrders` cancelled the **whole order** for any customer holding
     a line on the failed counter — taking their successful products with it.
     → *"refunds only the failed product and keeps the successful one shipping"*
  2. Sibling counters' `claimed_slots` were never decremented, so a batch went to
     the supplier on vials from a cancelled order.
     → *"releases the failed vials from a counter that is still open"*
  3. Cancelling stamped `payment_status='not_due'` over a held deposit.
     → *"never stamps not_due over a deposit it is still holding"*

### F — checkout accepts the stage (`app/api/orders/route.ts`)

Each stage guarded against its **own** deadline in one SQL predicate, so a
counter cannot be claimed against the wrong stage's date. A Pasalo counter does
not roll over: filling it seals it and the overflow is refused.

- **GREEN:** `npx vitest run` (full suite) — no regression in 2865 existing tests.

### J — the workbook (`lib/report/pasalo-refund{,-xlsx}.ts`)

- **GREEN:** `24 passed` + `18 passed`
- Asserts it is a **real** OOXML package (`PK` zip header), not HTML with an
  `.xlsx` extension — money written as numbers with `"₱"#,##0.00`, frozen and
  filtered headers, every column widthed, totals rows, pale tints per state.

### I — routes and admin panel

- **GREEN:** `npx vitest run app/api/admin/groupbuys/pasalo/route.test.ts` → `22 passed`

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | "Needed to qualify" is the gap to 7, never the gap to 10 | `lib/kahati-quantity.test.ts` | unit | PASS |
| 2 | A cancellation during Pasalo cannot book negative Pasalo vials | `lib/kahati-quantity.test.ts` | unit | PASS |
| 3 | Counters at 1–9 enter the stage; empty and full are skipped | `lib/pasalo.test.ts` | unit | PASS |
| 4 | 6 Kahati + 1 Pasalo = 7 is fulfilled, not refunded | `lib/pasalo-server.test.ts` | integration | PASS |
| 5 | Opening the stage twice does not re-freeze the Kahati figure | `lib/pasalo-server.test.ts` | integration | PASS |
| 6 | Closing twice writes no second refund (UNIQUE `order_item_id`) | `lib/pasalo-server.test.ts` | integration | PASS |
| 7 | A mixed result refunds only the failed line; the order keeps shipping and is re-billed for survivors alone | `lib/pasalo-server.test.ts` | integration | PASS |
| 8 | The whole order is cancelled only when every line failed | `lib/pasalo-server.test.ts` | integration | PASS |
| 9 | A cancellation never overwrites a held deposit's payment status | `lib/pasalo-server.test.ts` | integration | PASS |
| 10 | Goods are refunded only where the money actually cleared | `lib/pasalo-refund.test.ts` | unit | PASS |
| 11 | A customer's deposit is booked once across several failed lines and several orders | `lib/pasalo-refund.test.ts` | unit | PASS |
| 12 | The deposit is kept when any of their lines still ships | `lib/pasalo-refund.test.ts` | unit | PASS |
| 13 | A refund amount can never be negative (also a DB CHECK) | `lib/pasalo-refund.test.ts` | unit | PASS |
| 14 | The brief's worked example: ₱1,700 relevant / ₱1,100 successful / ₱600 refund | `lib/report/pasalo-refund.test.ts` | unit | PASS |
| 15 | A half-paid customer rolls up as the LEAST settled of their rows | `lib/report/pasalo-refund.test.ts` | unit | PASS |
| 16 | The export is a real xlsx package, not HTML | `lib/report/pasalo-refund-xlsx.test.ts` | unit | PASS |
| 17 | Money is written as numbers with PHP currency formatting | `lib/report/pasalo-refund-xlsx.test.ts` | unit | PASS |
| 18 | Every sheet freezes and filters its header, and widths every column | `lib/report/pasalo-refund-xlsx.test.ts` | unit | PASS |
| 19 | Sheet 4 states needed-to-qualify and slots-remaining separately | `lib/report/pasalo-refund-xlsx.test.ts` | unit | PASS |
| 20 | Every Pasalo route refuses anonymous and customer callers | `app/api/admin/groupbuys/pasalo/route.test.ts` | integration | PASS |
| 21 | Downloading the workbook marks nothing refunded, however often | `app/api/admin/groupbuys/pasalo/route.test.ts` | integration | PASS |
| 22 | Settling a refund requires a reference | `app/api/admin/groupbuys/pasalo/route.test.ts` | integration | PASS |
| 23 | A second settlement of the same refund is refused (409) | `app/api/admin/groupbuys/pasalo/route.test.ts` | integration | PASS |
| 24 | A refunded line is dropped from the supplier batch sheet and packing list | `app/api/admin/groupbuys/pasalo/route.test.ts` | integration | PASS |
| 25 | The Pasalo banner appears only when a stage is running | `app/(storefront)/kahati/page.test.tsx` | component | PASS |

## Client edge-case checklist

| # | Case | Covered by |
|---|---|---|
| 1–4 | Kahati at exactly 7 / 8 / 9 / 10 | #3, #4, `pasaloEligibility` / `pasaloOutcome` suites |
| 5 | 6 Kahati + 1 Pasalo | #4 |
| 7 | 3 Kahati + 7 Pasalo | `lib/pasalo-server.test.ts` "fulfils a counter Pasalo filled outright" |
| 8 | Pasalo still fails at 6 | `lib/pasalo-server.test.ts` "cancels a counter still short" |
| 9 | Customer with both successful and failed products | #7, #12 |
| 10–11 | Same customer joins twice / has several orders in the batch | #11, "refunds each customer separately and counts them once each" |
| 14 | Two customers race the final slot | Pre-existing guarded UPDATE + `group_buys_claimed_within_cap` CHECK — see Known gaps |
| 19 | Admin manually closes Pasalo | The only way it closes, by design |
| 20–21 | Export downloaded twice / refund already completed | #21, #23 |
| 23 | Price changed after ordering | `lib/pasalo-refund.test.ts` "uses the captured line total" |
| 29 | Quantity cannot exceed 10 | DB CHECK + checkout guard; stepper capped in `JoinSheet` |
| 30 | Refund total cannot go negative | #13 + `order_item_refunds_amount_non_negative` |
| 31 | A failed item cannot be counted twice | UNIQUE `order_item_id` + #6, #11 |

## Coverage and known gaps

- Full suite before this work: **266 files / 2865 tests, all passing.**
- New tests added: **~150** across 8 files.
- **Concurrency (#14) is inherited, not newly written.** Two customers racing the
  last slot was already impossible: the claim is a guarded `UPDATE … WHERE
  claimed_slots + n <= total_slots`, backed by the `group_buys_claimed_within_cap`
  CHECK. Pasalo reuses it unchanged rather than adding a reservation table. It is
  covered by the existing kahati checkout tests, not by a new one.
- **Not implemented:** a customer-facing email when a Pasalo refund is decided.
  `pasaloRefundNotices()` exists in `lib/pasalo-server.ts` and returns the
  recipients, but no send is wired — PostHog owns customer email in this project
  (see `posthog-email-sender-decision`), and choosing that template is a
  separate decision.
- **Not implemented:** exposing `min_viable_vials` on the admin counter form. The
  column exists and defaults to 7; there is no UI to change it per counter yet.
- **Untested by machine:** the admin panel and the customer Pasalo page have no
  component tests beyond the Kahati banner. They are wired to tested routes and
  tested pure modules, and `tsc` is clean, but the rendering itself has been
  exercised only by type-checking — browser QA is still owed.

## Merge evidence

Checkpoint commits on `feat/group-buy-page`:

- `75fee29` — stage + item-level refunds (RED→GREEN on the pure modules, then the
  server integration suite)
- `e85778c` — admin routes + workbook + batch-sheet exclusion
- (this commit) — customer board, admin panel, evidence report

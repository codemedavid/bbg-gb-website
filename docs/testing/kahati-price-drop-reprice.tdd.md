# TDD — a lowered hatian price reaches vials already committed

**Source:** client report 2026-09-14 (WhatsApp): "Si TF15 salt form - 450, pero
ang binayad ko 630/pc, kaya naging 3780". Journeys derived during this run.

## Root cause

Order KH-2737 (6 × Tirzepatide (Salt Form) 15 mg on counter `eb7dc6d7`) was
charged ₱630/vial. The counter reads ₱4,500/kit (₱450) today, and KH-2808 joined
the same counter at ₱450 on Sep 3.

- The Sep 1 order receipt email already said 4 × ₱2,520, so ₱630 was set at
  checkout. The two later "Customer edited their order quantities" edits reuse
  the stored unit price (`app/api/orders/[id]/route.ts`), so they carried it.
- Checkout prices a hatian line as `perVialPrice(counter.pricePerKitPhp)`, so the
  counter row itself held ₱6,300 on Sep 1 and was edited down by Sep 3. The
  Aug 29 seeder produced ₱4,500 for this product (every counter from that run
  matches the seed rule, none the on-hand kit price), so the ₱6,300 was a hand
  edit. There is no audit table to say who made it.
- `PATCH /api/admin/groupbuys/[id]` (and, since Sep 6, `syncKahatis` on a product
  edit) only rewrote the counter row. Commitments already on it kept the old
  price, and nothing flagged the gap.

Same pattern on BBG-2484 (CEB, Aug 7): 3 vials on sibling counter `e5043042`
at ₱630 while that counter is ₱4,500.

## User journeys

- As a hatian customer, when the counter I joined is corrected to a lower price,
  I pay the same per-vial price as everyone else splitting that kit.
- As a hatian customer, a price raised after I joined never charges me more than
  I agreed to.
- As an admin, a repriced order says why its total changed.

## Test specification

| # | Guarantee | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | Lowering a counter's kit price reprices committed lines to the new per-vial price | `reprice-commitments.test.ts: passes the lower per-vial price on…` | integration | PASS |
| 2 | The order is re-totalled by exactly the difference; packing fee kept | `…re-totals the order by exactly the difference…` | integration | PASS |
| 3 | The order history records old → new per-vial price | `…leaves a note on the order…` | integration | PASS |
| 4 | Payment and fulfilment status are not touched | `…does not touch the payment status…` | integration | PASS |
| 5 | Cancelled orders keep their figures | `…does not reprice a cancelled order` | integration | PASS |
| 6 | Raising a counter's price leaves earlier commitments alone | `…keeps the price an earlier buyer agreed to` | integration | PASS |
| 7 | A product repricing that reaches an open counter does the same | `…passes a lower group buy kit price on to vials already committed there` | integration | PASS |

## Evidence

- **RED** — `1833893`: `npx vitest run app/api/admin/groupbuys/reprice-commitments.test.ts`
  → 4 failed | 3 passed. Failures: `expected 630 to be 450`, `expected 3780 to be 2700`,
  note `expected false to be true`, product path `expected 630 to be 450`. Tests 4–6 are
  guards and passed before the fix, as intended.
- **GREEN** — `33c648c`: same file 7/7. Neighbouring suites
  (`app/api/admin/groupbuys/`, `lib/listing-sync*`, `lib/order-edit*`,
  `app/api/admin/products`, `lib/price-adjustment*`): 203 passed, 1 failed.
  The failure, `listing-sync-server.test.ts › never drops the MOQ below the kits
  already committed` (expected 7, got 10), is in the campaign path this change
  does not touch. It follows another session's uncommitted `lib/pricing.ts` edit,
  which stops deriving campaign MOQ from `gbMaxVialsPerBatch`.
- **Typecheck** — `tsc --noEmit` reports 13 errors, all in files other sessions
  have uncommitted edits in (`app/api/groupbuys/route.test.ts`,
  `lib/kahati.test.ts`, `lib/pricing.test.ts`, `lib/product-board-bulk.ts`). None
  are in the files this change touched.
- **Coverage** — `--coverage.include=lib/kahati-reprice-server.ts` ran (7 passed),
  but the per-file row did not print, so no percentage is claimed here.

## Prod repair (not applied)

`scripts/pass-hatian-price-drop.ts` is a dry run by default. The same WHERE clause
run against prod returns exactly:

| Order | Lines | Over | State |
|-------|-------|------|-------|
| KH-2737 | 6 × ₱630 → ₱450 | ₱1,080 | payment_confirmed / proof_submitted, no settlement; total ₱3,780 → ₱2,700 |
| BBG-2484 | 3 × ₱630 → ₱450 | ₱540 | settled and paid ₱6,300; total ₱6,450 → ₱5,910 |

Apply with the prod `DATABASE_URL` and
`--apply eb7dc6d7-2826-4af3-aec8-1d23978e3392,e5043042-4611-4407-bb58-1c9d647a8e97`.
Both orders are paid, so each ends up overpaid by the amount above, to refund
or credit.

## Known gaps

- No audit trail records who changed a counter's price. The ₱6,300 edit is
  inferred from the receipt email and the seeding rule, not observed.
- A settlement's frozen `balance_php` is not rewritten; the difference is the
  refund owed.
- Moving the amount into `order_item_refunds` was ruled out: that table is
  unique per line and reserved for lines that failed at Pasalo close.

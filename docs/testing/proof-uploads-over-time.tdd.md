# Proof of payment over time — TDD evidence

**Source plan**: inline plan produced by `/ecc:plan` in this session (no
`*.plan.md` artifact). Follows on from
[product-channels-and-multi-proof.tdd.md](./product-channels-and-multi-proof.tdd.md).

**Branch**: `feat/group-buy-page`
**Before**: 170 files, 1763 tests
**After**: 173 files, 1814 tests, `tsc --noEmit` clean

---

## What this closes, and why it was open

The previous round delivered multiple proofs **in one submission**. That only
helps a customer who made every transfer before checking out. A bank capping
each transfer at ₱2,000 turns a ₱4,500 order into three payments spread over
hours or days, and the second and third had nowhere to go short of placing a
duplicate order.

The client brief (§9–§14) described the checkout screen throughout, so the first
implementation matched it. The capability was raised as an option before work
started but was not in the brief that followed. It is now built.

---

## User journeys

1. As a customer who paid part of an order today and the rest tomorrow, I want
   to attach tonight's screenshot to the order I already placed.
2. As a customer, I want to see the proofs I have already sent, so I can tell
   whether last night's upload landed.
3. As an admin, I want to record what each transfer was worth and see whether
   the order is fully paid.
4. As a customer settling several hatians at once, I want the same — that
   payment is the largest one I make.

---

## Task report

### Phase 1 — customer adds a proof later

`POST /api/orders/[id]/proofs`, owner-only, with the five-proof cap counting what
the order **already** carries so five visits of one file each are refused on the
sixth exactly as six at once are.

- RED: `npx vitest run "app/api/orders/[id]/proofs/route.test.ts"` →
  `Failed to load url ./route` (25 tests, 0 run); plus 3 failures in
  `lib/proof.test.ts` for the unhandled `existingCount`
- GREEN: `Tests 25 passed`, `Tests 19 passed`
- Commits: `c7d19a2` (RED), `e04b82d` (GREEN)

Decisions taken, both stated in the plan before implementation:

- **Accepting statuses**: `proof_review`, `payment_confirmed`, `batch_filling`.
  Shipped, delivered and cancelled refuse. The plan's recommendation named the
  first two and omitted `batch_filling` from both lists; it is included because
  it is an open order where another peso can legitimately arrive. This widening
  is deliberate and recorded here rather than made silently.
- **No status change on upload.** Reverting a confirmed order to `proof_review`
  would undo an admin's verification on every customer upload. An
  `order_status_history` row is the notification instead.

A real bug surfaced during this phase: `ProofUploader` numbered picked files from
#1, so a file chosen against an order already showing "Proof #1" produced a
second one. Fixed with a `startIndex` prop, TDD'd separately.

### Phase 2 — admin records each amount

`PATCH /api/admin/orders/[id]/proofs/[proofId]`, matched on **both** ids so a
mistyped order id cannot edit another customer's payment record.

- RED: `Failed to load url ./route`; `lib/proof-reconciliation.test.ts` →
  `Cannot find module '@/lib/proof-reconciliation'`
- GREEN: `Tests 11 passed`, `Tests 10 passed`, `Tests 17 passed` (drawer)
- Commit: `51a7304`

`reconcileProofs()` keeps `unrecorded` distinct from `short`: every fresh order
has no amounts against it, and rendering those as "₱0 of ₱4,500 — ₱4,500 short"
would put them in the same bucket as genuinely underpaid orders.

### Phase 3 — settlements

`settlement_payment_proofs` (migration 0021), multi-proof at submission and
afterwards, plus a Proof column in the admin queue — which previously returned
`payment_proof_key` but rendered nothing, so settlement proofs were not viewable
in the UI at all.

- RED: `Failed to load url ./[id]/proofs/route`; admin route →
  `Target cannot be null or undefined`; admin page → no `Proof #1` link
- GREEN: `Tests 17 passed`, `Tests 12 passed`, `Tests 6 passed`
- Commit: `64fec50`

Later uploads are refused once a settlement is `paid` or `cancelled`: it has been
verified and closed, and another screenshot would suggest money is still owed.

### Refactor

`validateAndStoreProof` (single-file) lost its last caller when settlements moved
to the plural form, and was removed — `b25c92f`.

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A proof can be attached to an order placed earlier | `app/api/orders/[id]/proofs/route.test.ts` | integration | PASS |
| 2 | Numbering continues rather than restarting, so no order shows two "Proof #1" | same:`numbers the new proof after the ones already filed` | integration | PASS |
| 3 | Five build up across separate visits; the sixth is refused | same:`builds up to five across separate visits`, `refuses the sixth even though it arrives on its own visit` | integration | PASS |
| 4 | A batch that would overshoot files none of itself | same:`refuses a batch that would overshoot` | integration | PASS |
| 5 | The refusal says how many slots are left, not the total | `lib/proof.test.ts:says how many slots are left` | unit | PASS |
| 6 | Another customer's order is refused 403 and unchanged | `route.test.ts:refuses another customer's order`, `files nothing when it refuses a stranger` | integration | PASS |
| 7 | Signed-out is 401; unknown order is 404 | same | integration | PASS |
| 8 | Accepted on proof_review / payment_confirmed / batch_filling only | same:`when an order still takes payment` | integration | PASS |
| 9 | A late upload does not change the order's status | same:`leaves a confirmed order confirmed` | integration | PASS |
| 10 | It is recorded in order history so the admin sees it happened | same:`records the upload in the order history` | integration | PASS |
| 11 | The legacy `payment_proof_key` keeps pointing at the first proof | same:`leaves the legacy single proof key pointing at the original` | integration | PASS |
| 12 | The customer's order GET returns every proof with its own URL | same:`GET /api/orders/[id]` | integration | PASS |
| 13 | The customer's page lists proofs and offers an uploader while payment is open | `app/(storefront)/orders/[id]/page.test.tsx` | component | PASS |
| 14 | The uploader is hidden on shipped/cancelled orders and at five | `components/OrderProofSection.test.tsx` | component | PASS |
| 15 | A refused upload keeps the picked files and shows the server's reason | same:`keeps the picked files when the upload is refused` | component | PASS |
| 16 | A file picked against an order holding two reads "Proof #3" | `components/ProofUploader.test.tsx:numbers from where an order's existing proofs left off` | component | PASS |
| 17 | The admin can record an amount and reference per proof | `app/api/admin/orders/[id]/proofs/[proofId]/route.test.ts` | integration | PASS |
| 18 | A mistyped order id cannot edit another order's proof | same:`refuses a proof belonging to a different order` | integration | PASS |
| 19 | A customer cannot set what their own payment was worth | same:`refuses a customer, even for their own order` | integration | PASS |
| 20 | Recorded amounts are summed against the order total | `lib/proof-reconciliation.test.ts` | unit | PASS |
| 21 | "Nothing recorded yet" is distinct from "short" | same:`says nothing has been recorded yet` | unit | PASS |
| 22 | Overpayment is flagged, not reported as settled | same:`flags an overpayment` | unit | PASS |
| 23 | The drawer shows "₱3,500 of ₱4,500 — ₱1,000 short" | `app/admin/orders/proof-gallery.test.tsx` | component | PASS |
| 24 | An unchanged field does not fire a write on blur | same:`does not resend an amount that was not changed` | component | PASS |
| 25 | A settlement paid in three transfers is ONE settlement with three proofs | `app/api/settlements/proofs.test.ts` | integration | PASS |
| 26 | Settlement proofs can be added later, up to five, owner-only | same:`a transfer made later` | integration | PASS |
| 27 | A paid or cancelled settlement refuses further proofs | same | integration | PASS |
| 28 | The admin queue returns and renders every settlement proof | `app/api/admin/settlements/route.test.ts`, `app/admin/settlements/page.test.tsx` | integration + component | PASS |

---

## Coverage

```
npx vitest run --coverage
All files                    |   82.68 |   87.27 |   76.04 |   82.68
 app/api/orders/[id]/proofs  |     100 |     100 |     100 |     100
 .../settlements/[id]/proofs |     100 |     100 |     100 |     100
 .../orders/[id]/proofs/[id] |     100 |   82.35 |     100 |     100
 components                  |   96.74 |   91.18 |   89.23 |   96.74
 product-channels.ts         |     100 |     100 |     100 |     100
 channel-guard.ts            |     100 |     100 |     100 |     100
```

Above the 80% minimum.

---

## Known gaps

1. **Still no browser E2E.** This repo has no Playwright setup
   (`playwright.config.*` absent, no `e2e/`). Every case here is covered at the
   route-handler and component level — real handlers against a real in-memory
   Postgres, real DOM events — which is strong but is not a browser. Adding
   Playwright means a new dev dependency and CI surface and was left as an
   explicit separate decision.

2. **The admin cannot record amounts against *settlement* proofs.** The columns
   exist on `settlement_payment_proofs` and the API returns them, but only the
   ORDER side has the write route and the inputs. Symmetrical to add.

3. **No notification when a customer adds a late proof.** It lands in
   `order_status_history` and the admin sees it on the order, but nothing pushes
   it to them — an order sitting at `payment_confirmed` will not resurface in a
   queue. If topping-up turns out to be common, a filter or flag is the follow-up.

4. **Migrations 0019, 0020 and 0021 have not been applied to production.** They
   run in the test harness on every suite run. Run `npm run db:check` first —
   that environment has known drift.

5. **`next lint` is not configured** in this repo (it opens an interactive
   setup), so the gates used were `npm test` and `npx tsc --noEmit`.

---

## Merge evidence

Checkpoint commits on `feat/group-buy-page`, oldest first:

- `c7d19a2` test: add reproducer for adding proof of payment later **(RED)**
- `e04b82d` feat: customers can add proof of payment after placing the order **(GREEN)**
- `51a7304` feat: admin records what each transfer was worth, with a running total **(RED→GREEN)**
- `64fec50` feat: multiple proofs on the hatian final checkout too **(RED→GREEN)**
- `b25c92f` refactor: drop the dead single-proof wrapper **(refactor, still green)**

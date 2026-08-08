# Product Sales Channels + Multiple Payment Proofs — TDD evidence

**Source plan**: inline plan produced by `/ecc:plan` in this session (no `*.plan.md`
artifact was written). Requirements came from the client brief pasted into the
session, sections §1–§17.

**Branch**: `feat/group-buy-page`
**Baseline before this work**: 163 files, 1617 tests passing
**After**: 168 files, 1710 tests passing, `tsc --noEmit` clean

---

## A naming hazard worth stating once

The client's words and the codebase's words are inverted, and every reader of
this code needs the mapping:

| Client term | Table | Cart `kind` | Order mode |
|---|---|---|---|
| **On-Hand** | `products.is_on_hand` | `product` | `solo` |
| **Group Buy** | `moq_campaigns` | `moq_campaign` | `group_buy` |
| **Kahati** | `group_buys` | `group_buy` | `kahati` |

The table named `group_buys` **is Kahati**. A fourth shelf, `moq_products`, is
its own table and is not one of the three channels; it was not touched.

---

## User journeys

1. As an admin, I want to tick which of the three channels a product may be sold
   through, so a Rejuran can stay on Group Buy without appearing in Kahati.
2. As an admin, I want those settings to survive editing a product for an
   unrelated reason, so I do not silently un-list stock.
3. As an admin, I want the campaign product picker to offer only Group Buy
   products, so I cannot build a campaign the server will reject.
4. As a customer, I must not be able to order a product through a channel it is
   not enabled for, even by posting an id directly to the API.
5. As a customer who hit my bank's transfer limit, I want to attach one
   screenshot per transfer — up to five — so my whole payment is evidenced.
6. As a customer, I want to see which files I attached and remove a wrong one
   before I submit.
7. As an admin, I want to see every proof of an order so a payment split across
   three transfers does not read as underpaid.

---

## Task report

### A1 — Channel rule (`lib/product-channels.ts`)

Pure predicate `isChannelEnabled(product, channel)` plus `channelRefusal()`.
Two rules pinned deliberately: an absent channel flag fails **closed** (this
decides whether money may be taken), and no refusal message may contain the word
"Korean" — that would be the hardcoded rule surviving in the copy after leaving
the code.

- RED: `npx vitest run lib/product-channels.test.ts` →
  `Error: Cannot find module '@/lib/product-channels'`
- GREEN: same command → `Test Files 1 passed | Tests 12 passed`
- Commits: `9cb7be2` (test/RED), `24dc343` (impl/GREEN)

### A2 — Backend enforcement across all three channels

`app/api/channel-enforcement.test.ts` posts ids straight to the route handlers,
bypassing every board, because §2 and §15 are explicit that frontend hiding is
not enough.

- RED: `npx vitest run app/api/channel-enforcement.test.ts` →
  `Error: Cannot find module '@/lib/kahati-eligibility'` (26 tests, 0 run)
- GREEN: `Tests 26 passed`
- Commits: `15c554b` (test/RED), `8a011d3` (impl/GREEN)

Enforcement points changed:

| Channel | Display gate | Order gate |
|---|---|---|
| On-Hand | `/api/products?onHand=true` (pre-existing) | `orders/route.ts` rejects `!isChannelEnabled(p,'on_hand')` |
| Kahati | `groupbuys/route.ts` SQL filter on `is_kahati`; seeder likewise | `orders/route.ts` rejects the linked product |
| Group Buy | `campaign-seed-bulk.ts` (pre-existing); picker filtered | **new**: `POST`/`PATCH /api/campaigns` refuse off-channel products |

### A3 — Migration 0019

`is_kahati` added, backfilled as `is_group_buy AND NOT is_korean`, then
`is_korean` dropped. The backfill is wrapped in a `DO` block that checks whether
`is_korean` exists first, because migration 0018 shipped alongside this work and
an environment that skipped it must still land correctly rather than erroring on
a missing column. **No product's current availability changes.**

### A4 / A5 — Admin UI

Labelled **Sales Channels** fieldset with the three checkboxes and the required
caption; campaign picker filtered to Group Buy products while still showing any
a published campaign already carries.

- `app/admin/products/page.test.tsx` → `Tests 13 passed`
- `app/admin/group-buy/campaigns/CampaignForm.test.tsx` → `Tests 17 passed`

### B1/B2 — `order_payment_proofs` + five-proof validator

- RED (validator): `npx vitest run lib/proof.test.ts` →
  `validateAndStoreProofs is not a function`
- RED (route): `npx vitest run app/api/orders/proofs.test.ts` →
  `Cannot read properties of undefined (reading 'Symbol(drizzle:Columns)')`
- GREEN: `Tests 15 passed` and `Tests 14 passed` respectively
- Commit: `a69be14`

`orders.payment_proof_key` is deliberately **kept and still written** with the
first proof; migration 0020 backfills the new table from it. Five readers use
that column, so this lands additively rather than as a simultaneous rewrite.

### B3/B4 — Uploader and admin gallery

- RED (component): `Failed to resolve import "./ProofUploader"`
- RED (admin API): `Target cannot be null or undefined` (`proofs` absent)
- GREEN: `components/ProofUploader.test.tsx` 15 passed;
  `app/api/admin/orders/proofs.test.ts` 9 passed;
  `app/admin/orders/proof-gallery.test.tsx` 9 passed
- Commit: `6a33d37`

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Three channels are independent switches; Group Buy off + Kahati on is expressible | `lib/product-channels.test.ts` | unit | PASS |
| 2 | A missing channel flag refuses rather than permits | `lib/product-channels.test.ts:refuses a channel whose flag is missing` | unit | PASS |
| 3 | No refusal message names a product category | `lib/product-channels.test.ts:carries no hardcoded product category` | unit | PASS |
| 4 | A delisted product is refused through every channel | `app/api/channel-enforcement.test.ts` | integration | PASS |
| 5 | A Kahati-off product's counter id posted straight to checkout is refused 400 | `app/api/channel-enforcement.test.ts:refuses a counter id posted straight to checkout` | integration | PASS |
| 6 | That refusal claims no vials and rolls back the whole cart | `app/api/channel-enforcement.test.ts` | integration | PASS |
| 7 | A Kahati-off product stays on the Group Buy board and is orderable there | `app/api/channel-enforcement.test.ts:Group Buy channel — a product with Group Buy on` | integration | PASS |
| 8 | An On-Hand-off product is absent from the shop and refused at checkout, drawing no stock | `app/api/channel-enforcement.test.ts:On-Hand channel` | integration | PASS |
| 9 | A campaign naming a non-Group-Buy product is refused 400 and writes no row | `app/api/channel-enforcement.test.ts:cannot be added to a campaign through the admin API` | integration | PASS |
| 10 | Counters are withheld retroactively when the switch is turned off | `app/api/channel-enforcement.test.ts:loses a counter that was already open` | integration | PASS |
| 11 | A free-text counter with no product link is never refused | `app/api/channel-enforcement.test.ts` | integration | PASS |
| 12 | Seeding reads `is_kahati`, so Kahati-without-Group-Buy still gets a counter | `lib/kahati-seed-bulk.test.ts` | integration | PASS |
| 13 | The form offers three checkboxes, saves them, and reloads them on edit | `app/admin/products/page.test.tsx:Sales Channels` | component | PASS |
| 14 | The campaign picker offers only Group Buy products, but keeps already-included ones | `app/admin/group-buy/campaigns/CampaignForm.test.tsx` | component | PASS |
| 15 | Fresh seeds and migrated databases agree on which products get counters | `lib/db/data/seed-rows.test.ts` | unit | PASS |
| 16 | 1, 3 and 5 proofs each produce ONE order carrying that many proofs | `app/api/orders/proofs.test.ts` | integration | PASS |
| 17 | A 6th proof is refused, creating no order, no proof rows, and drawing no stock | `app/api/orders/proofs.test.ts:six proofs` | integration | PASS |
| 18 | Proofs keep submission order, so "Proof #1" is stable | `app/api/orders/proofs.test.ts:numbers them in the order they were submitted` | integration | PASS |
| 19 | An over-count batch stores nothing, leaving no orphaned uploads | `lib/proof.test.ts:stores nothing at all when the count is refused` | unit | PASS |
| 20 | One bad file among several refuses the whole batch | `lib/proof.test.ts` | unit | PASS |
| 21 | The legacy `payment_proof_key` still carries the first proof | `app/api/orders/proofs.test.ts:the legacy single-proof column` | integration | PASS |
| 22 | A cart splitting into several orders gives each the same proofs | `app/api/orders/proofs.test.ts` | integration | PASS |
| 23 | The uploader adds rather than replaces, and renumbers after a removal | `components/ProofUploader.test.tsx` | component | PASS |
| 24 | The uploader refuses a 6th and shows why instead of truncating | `components/ProofUploader.test.tsx:refuses a sixth` | component | PASS |
| 25 | Three attached proofs reach the request as three files | `app/checkout/page.test.tsx:sends every attached proof` | component | PASS |
| 26 | A removed proof is left out of the submission | `app/checkout/page.test.tsx:leaves a removed proof out` | component | PASS |
| 27 | The admin API returns every proof with its own URL, ordered | `app/api/admin/orders/proofs.test.ts` | integration | PASS |
| 28 | That route still refuses a non-admin | `app/api/admin/orders/proofs.test.ts:refuses a customer` | integration | PASS |
| 29 | The admin sheet shows a numbered thumbnail per proof, each opening full size | `app/admin/orders/proof-gallery.test.tsx` | component | PASS |
| 30 | Orders predating the table fall back to the legacy proof rather than reading as unpaid | `app/admin/orders/proof-gallery.test.tsx` | component | PASS |
| 31 | A waived kahati downpayment still explains itself instead of "no proof attached" | `app/admin/orders/proof-gallery.test.tsx` | component | PASS |

---

## Coverage

```
npx vitest run --coverage
All files            |   82.24 |    87.02 |   76.09 |   82.24
  channel-guard.ts   |     100 |     100  |    100  |    100
  product-channels.ts|     100 |     100  |    100  |    100
  proof.ts           |     100 |   95.23  |    100  |    100
 components          |   96.55 |   91.52  |   88.7  |   96.55
```

Above the 80% minimum. The three new `lib` modules are at 100% statements.

---

## Known gaps — deliberately not done

These are real and the work is **not** complete without a decision on each.

1. **Settlements are still single-proof.** `app/(storefront)/settle/page.tsx` and
   `settlements.payment_proof_key` were left alone. The hatian final checkout is
   a second payment flow with the same bank-transfer problem, but the client
   brief says "per order" throughout and this was scoped out in the plan and
   flagged before implementation. Mirroring B1–B4 onto settlements is a
   self-contained follow-up.

2. **The admin cannot yet enter a per-proof amount or reference.** The
   `amount_php` and `reference` columns exist, are returned by the API, and the
   thumbnail renders an amount when one is present — but there is no UI or
   endpoint to write them. §13 hedges this ("if the existing payment system
   supports this"); the storage is in place so the UI is additive.

3. **No browser E2E.** §16 asks for E2E testing. This repository has no
   Playwright setup (`playwright.config.*` absent, no `e2e/` directory), so the
   1/3/5/6-proof and removal cases are covered at the route-handler and
   component level instead — real handlers against a real in-memory Postgres,
   and real DOM events. That is strong coverage but it is not a browser.

4. **§17's regression list is covered by the existing suite, not by new targeted
   tests.** Excel export, order reports and payment confirmation pass their
   pre-existing tests unchanged (168 files, 1710 tests), which is evidence of no
   regression, not evidence of new verification.

5. **Migrations 0019 and 0020 have not been applied to production.** They run in
   the test harness on every suite run. Production is a separate step — run
   `npm run db:check` first; that environment has known schema drift.

6. **`next lint` is not configured** in this repo (it drops into an interactive
   setup prompt), so the gates used here were `npm test` and
   `npx tsc --noEmit`.

---

## Merge evidence

If these commits are squashed, the RED/GREEN record above is the surviving
proof. Checkpoint commits on `feat/group-buy-page`, oldest first:

- `9cb7be2` test: add reproducer for per-product sales channels **(RED)**
- `24dc343` feat: express sales channels as three independent per-product switches **(GREEN)**
- `15c554b` test: add reproducer for backend channel enforcement **(RED)**
- `8a011d3` feat: per-product sales channels, enforced on the server **(GREEN)**
- `a69be14` feat: up to five payment proofs on one order **(RED→GREEN, both recorded in the body)**
- `6a33d37` feat: multi-proof upload UI and admin proof gallery **(RED→GREEN)**

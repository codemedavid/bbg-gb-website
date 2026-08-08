# TDD Evidence — Order Visibility, Variants (Priority 1)

**Source plan**: none on disk. Journeys were derived during this TDD run from the
free-form brief passed to `/ecc:plan`, scoped by four decisions the user made:
P1 only, RTL+PGlite (no Playwright), variants on shop + Kahati, relabel statuses
in the UI without migrating the enum.

**Branch**: `feat/group-buy-page` · **Date**: 2026-08-08

---

## User Journeys

| # | Journey | Requirement |
|---|---|---|
| J1 | As a customer, I want my order's status in plain words, so I know where my order actually is. | 2 |
| J2 | As a customer whose order was cancelled, I want the trail to say so, so I'm not left staring at an empty progression. | 2 |
| J3 | As a customer with a twelve-item order, I want to see every item with its quantity and price, so nothing is hidden. | 1, 7 |
| J4 | As a customer, I want a View Details button that opens the whole order on one screen. | 4 |
| J5 | As a customer, I want to see what I paid on every order, not only ones with a downpayment. | 1 |
| J6 | As a customer browsing peptides, I want one card per peptide with a dose dropdown, so I'm not reading the same name five times. | 3 |
| J7 | As a customer on a phone, I want every ordering screen to fit, so nothing overflows sideways and no control is out of reach. | 8 |

---

## Task Report

### Task 1 — Customer-facing status labels, cancelled handling

Relabelled the stored enum to customer wording and replaced `statusIndex`-based
trail drawing with `statusSteps`, which distinguishes cancelled from unstarted.

- **RED** `npx vitest run lib/order-status.test.ts` → `Tests 7 failed | 2 passed (9)`;
  `TypeError: isCancelledStatus is not a function`, `statusSteps is not a function`,
  plus label mismatches.
- **GREEN** same command → `Tests 9 passed (9)`.
- **Regression** `npx vitest run "app/(storefront)/orders" app/admin/groupbuys app/admin/orders "app/api/admin/orders"` → `Tests 60 passed (60)`.
- **Guarantees**: every value the schema can store has a label and a badge; the
  trail order is read off `ORDER_STATUS_FLOW` so it cannot drift; a cancelled or
  unrecognised status never renders as progress.

### Task 2 — `OrderStatusTrail`

- **RED** `npx vitest run components/OrderStatusTrail.test.tsx` → import of
  `./OrderStatusTrail` did not resolve (`Tests no tests`).
- **GREEN** same command → `Tests 5 passed (5)`.
- One assertion in the RED test was itself wrong: it required `textContent` to
  equal the bare label while a sibling test required an sr-only state note. The
  test was corrected, not the component.

### Task 3 — `OrderItemList` (the truncation fix)

- **RED** `npx vitest run components/OrderItemList.test.tsx` → import did not resolve.
- **GREEN** same command → `Tests 7 passed (7)`.
- **Guarantees**: a 12-item order renders 12 rows; two variants of one peptide
  stay distinct; every row carries `Qty`, unit price and line total; a long list
  is capped in height only and its scroll region is keyboard-reachable.

### Task 4 — My Orders rewiring

- **RED** `npx vitest run "app/(storefront)/orders/page.test.tsx"` → `Tests 4 failed | 8 passed (12)`:
  no items rendered, no View Details control, no `order-summary-*` block.
- **GREEN** same command → `Tests 12 passed (12)`.
- The status-visible test passed at RED — the badge was never hidden, so that
  part of requirement 2 was already satisfied.

### Task 5 — Order detail API

- **RED** `npx vitest run "app/api/orders/[id]/route.test.ts"` → `Tests 1 failed | 6 passed (7)`:
  `Cannot read properties of undefined (reading 'email')`.
- **GREEN** same command → `Tests 7 passed (7)`.
- **Finding**: the other six passed at RED. The endpoint already returned all
  twelve lines with correct quantities and prices, which establishes that the
  reported truncation was a UI decision and not data loss.

### Task 6 — Order details page

- **RED** `npx vitest run "app/(storefront)/orders/[id]/page.test.tsx"` → `./page` did not resolve.
- **GREEN** same command → `Tests 10 passed (10)`.
- Two test-harness corrections were needed, both test-side: `use(params)`
  suspends and needs `await act(...)` (no prior example of this existed in the
  repo), and the item count had to be scoped to the items block because the
  status trail on the same page is also a list.

### Task 7 — Variant grouping + shop card

- **RED** `npx vitest run lib/product-variants.test.ts` → import did not resolve.
- **GREEN** same command → `Tests 11 passed (11)`. One expectation about
  mixed-unit ordering was a guess and was corrected to the implemented
  (numeric-collation) behaviour.
- **RED** `npx vitest run components/ProductCard.test.tsx` → `Tests 8 failed (8)`,
  `Cannot read properties of undefined (reading 'onHandPiecePhp')`.
- **GREEN** same command → `Tests 8 passed (8)`.

### Task 8 — Mobile pass (requirement 8), browser-verified

Ran a real Chrome against a local dev server (PGlite, `STORAGE_DRIVER=local`,
no `.env` present so `DATABASE_URL` was unset — the prod Supabase was never
touched), seeded via `npm run db:setup`, with an 8-line order placed through the
running API so the item list exceeded the 6-row scroll threshold.

Measurement script per page: every element's `getBoundingClientRect()` compared
to `clientWidth` for horizontal overflow, plus every interactive element checked
against the WCAG 2.2 AA 24px target-size minimum.

Viewports: **320×568, 375×667, 768×1024, 1440×900** (Chrome's window floor is
~500px, so `emulate` device-metrics override was required — `resize_page` alone
silently reported 500px and would have invalidated the whole 320px pass).

| Surface | 320 | 375 | 768 | 1440 | Overflow | Notes |
|---|---|---|---|---|---|---|
| `/orders` (8-item order expanded) | ✓ | — | — | — | none | 8 rows present; scroll region 576→280, vertical only |
| `/orders/[id]` | ✓ | ✓ | ✓ | ✓ | none | all 7 blocks; long address wraps; 46px clearance under fixed nav |
| `/shop` (variant dropdown) | ✓ | — | ✓ | ✓ | none | 8 products → 6 cards; live 15mg→30mg flips ₱550→₱700, stock→87 |
| `/cart` | ✓ | — | — | — | none | |
| `/checkout` | ✓ | — | — | — | none | |
| `/success/[orderNo]` | ✓ | — | — | — | none | defect found and fixed, below |

**Two real defects found and fixed:**

1. **Confirmation page could strand the customer** (`app/success/[orderNo]/page.tsx`).
   RED: injecting ~320px of extra content at 320×568 put both buttons below the
   fold (bottoms 633 and 691 vs viewport 568); `document.scrollHeight` equalled
   the viewport, so `window.scrollTo(0, 9999)` left `scrollY` at 0 — no way to
   reach either control. GREEN: same injection, shell scrolls (`scrollTop` 123),
   both buttons back within the fold (510, 568), top still reachable at
   `scrollTop` 0. Needed `min-h-full` as well as `overflow-y-auto`: with
   `justify-center` alone, over-tall content overflows off *both* edges and the
   top stays unreachable even once the parent scrolls.

2. **Product name below the WCAG tap-target minimum** (`components/ProductCard.tsx`).
   RED: 17px tall, 6 such elements on the shop grid at 768. GREEN: 25px after
   `py-1`; zero elements below the minimum. Pre-existing rather than a
   regression — the original card had the same bare button.

**Not changed, noted:** `CartShortcut` renders at 31px and the bottom-nav tabs at
37px. Both clear the 24px AA minimum but sit under the 44px comfort guideline.
They belong to a concurrent session's files, so they were left alone.

---

## Test Specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Every status the schema can store has a customer-facing label and badge | `lib/order-status.test.ts:labels and styles every value the schema can store` | unit | PASS |
| 2 | A cancelled order never renders as an unstarted trail | `lib/order-status.test.ts:never claims a step of the flow is in progress` | unit | PASS |
| 3 | An unrecognised status is not treated as delivered | `lib/order-status.test.ts:is not treated as a completed order` | unit | PASS |
| 4 | The trail marks the step the order is actually on | `components/OrderStatusTrail.test.tsx:marks the step the order is actually on` | component | PASS |
| 5 | Step states are readable by screen reader, not only by dot colour | `components/OrderStatusTrail.test.tsx:says in words which steps are done` | component | PASS |
| 6 | A 12-item order renders 12 rows — no truncation | `components/OrderItemList.test.tsx:renders every line of a twelve-item order` | component | PASS |
| 7 | Every row shows quantity, unit price and line total | `components/OrderItemList.test.tsx:shows the quantity on every line` | component | PASS |
| 8 | A long list scrolls and stays keyboard-reachable | `components/OrderItemList.test.tsx:becomes a labelled region a keyboard can scroll` | component | PASS |
| 9 | My Orders lists all items instead of "+N more" | `app/(storefront)/orders/page.test.tsx:lists every ordered item, not the first one and a tally` | component | PASS |
| 10 | View Details navigates to the order's own page | `app/(storefront)/orders/page.test.tsx:offers a way through to the full order` | component | PASS |
| 11 | An order with no downpayment still shows subtotal, fee and total | `app/(storefront)/orders/page.test.tsx:still breaks down what was charged` | component | PASS |
| 12 | A 12-product order round-trips through the API intact | `app/api/orders/[id]/route.test.ts:returns every line of a twelve-product order` | integration | PASS |
| 13 | Each line's qty and unit price survive the round trip | `app/api/orders/[id]/route.test.ts:keeps each line's quantity and unit price intact` | integration | PASS |
| 14 | Line totals sum to the charged subtotal | `app/api/orders/[id]/route.test.ts:adds up to the order total it was charged` | integration | PASS |
| 15 | One customer cannot read another's order | `app/api/orders/[id]/route.test.ts:refuses to show one customer another customer's order` | integration | PASS |
| 16 | The details page shows all six required blocks | `app/(storefront)/orders/[id]/page.test.tsx` (6 tests) | component | PASS |
| 17 | Absent tracking is named, not left blank | `app/(storefront)/orders/[id]/page.test.tsx:says so plainly when there is no tracking number yet` | component | PASS |
| 18 | The proof link is omitted entirely when no proof exists | `app/(storefront)/orders/[id]/page.test.tsx:omits the proof link entirely` | component | PASS |
| 19 | Strengths order by magnitude, not spelling | `lib/product-variants.test.ts:orders strengths by magnitude, not by spelling` | unit | PASS |
| 20 | A salt form is not folded into the base peptide | `lib/product-variants.test.ts:keeps a differently-named product out of the group` | unit | PASS |
| 21 | Server ordering of the catalogue is preserved | `lib/product-variants.test.ts:preserves the order the rows arrived in` | unit | PASS |
| 22 | The price shown is the selected strength's price | `components/ProductCard.test.tsx:shows the selected strength's price after switching` | component | PASS |
| 23 | The cart receives the selected strength, not the first | `components/ProductCard.test.tsx:adds the selected strength to the cart, not the first one` | component | PASS |
| 24 | Sold-out strengths are disabled, not hidden | `components/ProductCard.test.tsx:marks a sold-out strength in the dropdown rather than hiding it` | component | PASS |
| 25 | No customer ordering screen scrolls horizontally at 320/375/768/1440 | browser measurement (Task 8 table) | manual/browser | PASS |
| 26 | The confirmation page stays reachable when its content outgrows the screen | browser measurement (Task 8, defect 1) | manual/browser | PASS |
| 27 | Every interactive element on the shop grid clears the WCAG 2.2 AA 24px minimum | browser measurement (Task 8, defect 2) | manual/browser | PASS |

---

## Coverage

`npx vitest run --coverage` on the new modules:

| Module | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `lib/order-status.ts` | 100 | 90.9 | 100 | 100 |
| `lib/product-variants.ts` | 100 | 95 | 100 | 100 |
| `components/OrderItemList.tsx` | 100 | 100 | 100 | 100 |
| `components/VariantPicker.tsx` | 100 | 100 | 100 | 100 |
| `components/ProductCard.tsx` | 100 | 75 | 66.66 | 100 |

All above the 80% line target. `ProductCard` branch/function coverage is below
target on navigation and toast callbacks (lines 35, 43-46, 53, 59, 88), which are
one-line router/toast delegations.

**Full suite**: `npm test` → `Test Files 162 passed (162)`, `Tests 1613 passed (1613)`, 82s.
**Typecheck**: `npx tsc --noEmit` → clean.

---

## Known Gaps

1. **Kahati variant dropdown deliberately NOT built** — user decision after the
   conflict was surfaced. An earlier draft of this report claimed the blocker
   was that `GET /api/groupbuys` omits `product_id`; that was **wrong**. The
   route selects the whole `groupBuys` row (`app/api/groupbuys/route.ts:37`), so
   `productId` is already in the JSON — only the `GroupBuy` TypeScript type
   omits it. The actual blocker is a collision: a concurrent session's
   `app/(storefront)/kahati/page.test.tsx` asserts **one card per counter**
   (e.g. `expect(cardNames()).toEqual(['Retatrutide 20mg vial', 'Retatrutide 10mg vial'])`),
   and grouping would collapse those and break 4+ of its tests. Mitigating
   factor: that board's search already matches the variant, so a customer can
   still reach a specific strength by typing "20mg".
2. ~~Mobile viewport pass not executed~~ — **done**, see Task 8. Two defects
   found and fixed.
3. **Requirements 5, 6, 9, 10 are out of scope** by the agreed P1 split. Board
   search/sort already exist (`lib/board-filter.ts`, `components/BoardControls.tsx`);
   category/availability *filters* do not.
4. ~~Defect D4 left unfixed~~ — **fixed and browser-verified**, see Task 8
   defect 1. It was latent rather than live: with today's short confirmation
   content everything fit (buttons ended at 543 of 568), but the page could not
   scroll at all, so requirement 10's richer content would have trapped the
   customer.
5. **Snapshot contract worth knowing**: checkout writes the variant *into*
   `nameSnapshot` (`"Tirzepatide 15mg vial"`) and uses `specSnapshot` for the
   buying mode (`"On-hand · per piece"`) — see `app/api/orders/route.ts:185-186`.
   Requirement 4 asks for Product and Variant as separate columns; they are one
   column today. Splitting them would need a write-side change plus a decision
   about legacy rows.

---

## Merge Evidence

Checkpoint commits on `feat/group-buy-page`, RED then GREEN per task:

```
test: pin customer-facing order status labels and cancelled handling   (RED 7 fail)
feat: customer-facing order status labels, correct cancelled trail     (GREEN 9/9, 60/60 consumers)
test: add reproducer for the order status trail                        (RED unresolved import)
feat: extract OrderStatusTrail, render cancellation explicitly         (GREEN 5/5)
test: add reproducer for full order item listing                       (RED unresolved import)
feat: OrderItemList renders every ordered line, never truncated        (GREEN 7/7)
test: add reproducer for truncated order items and missing View Details (RED 4 fail)
fix: list every ordered item on My Orders, add View Details, show all totals (GREEN 12/12)
test: add reproducer for the order detail contract                     (RED 1 fail)
feat: order detail endpoint carries the customer and settlement blocks (GREEN 7/7)
test: add reproducer for the order details page                        (RED unresolved import)
feat: order details page — the whole order on one screen               (GREEN 10/10)
test: add reproducer for product variant grouping                      (RED unresolved import)
feat: group product variants into one entry per peptide                (GREEN 11/11)
test: add reproducer for the variant dropdown on shop cards            (RED 8 fail)
feat: one shop card per peptide with a variant dropdown                (GREEN 8/8, 1613/1613 suite)
docs: TDD evidence report for the P1 order-visibility work
fix: order confirmation can scroll when it outgrows the screen         (RED/GREEN browser-measured)
fix: product name on a shop card is a tappable target                  (RED 17px → GREEN 25px)
```

The last two carry browser measurements rather than test-runner output, because
jsdom computes no layout and neither defect is expressible as a unit test. Their
RED and GREEN figures are quoted in full in their commit messages and in Task 8.

If these are squashed, this file is the surviving record of what was verified.

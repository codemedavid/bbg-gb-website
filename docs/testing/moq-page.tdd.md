# MOQ page — TDD evidence

**Branch:** `feat/kahati-downpayment`
**Source plan:** none. Journeys were derived during this TDD run from the client
request (a dedicated MOQ page plus full admin management), after four design
questions were resolved with the user.

---

## Naming, and why it mattered

This codebase already used "MOQ" for something else. `/groupbuy` (storefront
"Group Buy") is backed by the `moq_campaigns` table, and the admin sidebar
literally read **"MOQ Campaigns"**. `/kahati` (Hatian) is a separate table,
`group_buys`.

So "an MOQ page separate from Group Buy and Hatian" is a **fourth** purchasing
surface, not a rename. That was confirmed with the user before any code was
written, along with three other decisions:

| Question | Decision |
|---|---|
| Data model | New `moq_products` table, fully isolated from `products` |
| Checkout | New fourth purchase mode `moq` with its own packing fee and order |
| Nav placement | Seventh tab, rendered only while the page is enabled |
| Admin naming | Sidebar label `MOQ Campaigns` → `Group Buy Campaigns` (label only) |
| Default state | Page ships **OFF** |
| Seed values | Placeholder price/stock; admin sets the real figures |

The `moq_campaigns` table, its routes and the `/groupbuy` page are untouched.

---

## User journeys

1. As a customer, I want a dedicated MOQ page so I can buy bulk items without
   wading through the Group Buy or Hatian boards.
2. As a customer, I want each MOQ product to show its image, name, price, stock
   and description so I can decide before adding it.
3. As a customer, I want the MOQ minimum enforced so I never build a cart that
   checkout will reject.
4. As a customer, I want my MOQ items billed as their own order so I am not
   charged another mode's packing fee.
5. As an admin, I want to add, edit and delete MOQ products without touching the
   shop catalog.
6. As an admin, I want to switch the whole MOQ page on and off from the dashboard
   and have that choice survive a restart.
7. As a visitor, I should get a 404 on `/moq` while the page is off, even if I
   type the URL directly.

---

## Task report

Each cycle below was committed as a RED checkpoint then a GREEN checkpoint. All
commits are on `feat/kahati-downpayment` and reachable from `HEAD`.

**Baseline before any change:** `npm test` → 39 files, 368 tests passing.

### 1. MOQ purchase mode (`5fa8c27` RED → `5328e00` GREEN)

Added `PACKING_FEE_PHP.moq`, `hasMoq`, `validateMoqQty`, and the `moq` mode in
`order-modes.ts`.

- RED: `npx vitest run lib/pricing.test.ts lib/order-modes.test.ts` →
  `Tests 15 failed | 57 passed (72)`, cause `TypeError: validateMoqQty is not a function`.
- GREEN: same command → `Tests 72 passed (72)`. Full suite 383/383.
- Widening `PackingFees` forced a `moq` key through `lib/settings.ts`. Two
  settings-route tests compared the fee set by exact equality and were updated to
  expect the new key — behaviour change, not a weakened assertion.

### 2. Schema and migration (`(RED commit)` → `d668e5e` GREEN)

- RED: `npx vitest run lib/db/moq-products.test.ts` → `Tests 6 failed (6)`, cause
  `error: invalid input value for enum order_item_kind: "moq_product"`.
- GREEN: `Tests 6 passed (6)`. Full suite 389/389.
- The migration is **generated** (`drizzle/0007_kind_tarantula.sql`), not pushed,
  because `lib/test/harness.ts` replays `drizzle/*.sql` to build the pglite
  schema. An ungenerated migration would leave every integration test running
  against a stale database.
- The `ALTER TYPE ... ADD VALUE` risk was checked explicitly: it replays cleanly
  under pglite, asserted by two tests that cast the new enum literals.

### 3. Visibility toggle (`3` → GREEN in `(settings commit)`)

- RED: `npx vitest run lib/settings-moq.test.ts` → `Tests 6 failed (6)`, cause
  `TypeError: getMoqPageEnabled is not a function`.
- GREEN: `Tests 6 passed (6)`. Full suite 395/395.
- The getter **fails closed**: only the exact string `'true'` enables the page, so
  an absent or corrupt value hides it. Asserted directly.

### 4. Product APIs (`(RED commit)` → `63c6ebe` GREEN)

- RED: suite failed to load — `Failed to load url ./route`.
- GREEN: `Tests 24 passed (24)`. Full suite 419/419.
- `tsc --noEmit` caught a hole the passing tests did not: `parseMoqProductForm`
  returned a union, so `name` and `pricePhp` widened to optional on the create
  path. Fixed with overloads.

### 5. Cart and checkout (`(RED commit)` → `315aaaa` GREEN)

- RED: `npx vitest run app/api/orders/moq.test.ts` → `Tests 9 failed | 5 passed (14)`,
  cause `items.0.kind: Invalid enum value`. The 5 passing cases were rejection
  paths passing for the wrong reason (schema rejection, not business rules); they
  were re-asserted after the mode was wired.
- Cart RED: `Tests 5 failed | 11 passed (16)`.
- GREEN: checkout 14/14, cart 16/16. Full suite 440/440.

### 6. Storefront page and nav (`(RED commit)` → `3c568db` GREEN)

- RED: `MoqProductCard` did not exist; `BottomNav` rendered 6 tabs regardless of
  the setting (`expected [...] to have a length of 7 but got 6`).
- GREEN: 19/19. Full suite 459/459.
- One design fix came out of the RED run: the card said "Out of stock" in three
  places (badge, status line, button), which surfaced as
  `Found multiple elements with the text: /out of stock/i`. The redundant badge
  was removed and the button now reads "Unavailable" — a real de-duplication, not
  a selector workaround.

### 7. Admin management (`df6899f` GREEN)

- RED: `Failed to resolve import "./MoqPageCard"`.
- GREEN: 6/6. Full suite 465/465.

### 8. Seed and board coverage (`cccf8e8` GREEN)

- GREEN: 4 seed tests + 8 `MoqBoard` tests. Full suite **477/477**.

### 9. Admin page coverage (`c1793d3`)

Closed the gap flagged below: `app/admin/moq-products/page.tsx` went from 0% to
**100% statements / 76% branches**. Full suite **502/502**.

These 25 tests were written against already-working code, so they passed on the
first run — there was no RED phase to report. Passing immediately is exactly what
a vacuous test also does, so the suite was mutation-tested instead. Three
mutations were injected into the implementation and each was caught by exactly
one test:

| Mutation | Test that failed |
|---|---|
| Always send `packingFeePhp` | `omits a blank packing fee so the global MOQ default applies` |
| Drop the id on save (edit becomes create) | `updates the existing product rather than creating a new one` |
| Ignore the `confirm()` result | `does not delete when the admin backs out` |

Command: `npx vitest run app/admin/moq-products/page.test.tsx` → `Tests 1 failed | 24 passed (25)` for each mutation; `25 passed (25)` once restored.

One accessibility defect surfaced while writing them: the form's nine field
captions were floating `<span>`s with no association to their controls, so screen
readers never announced them and the inputs had no accessible name. They are now
real `<label>` elements wrapping their inputs — which is also what lets the tests
query by label rather than by test id.

### 10. Post-review defect round (`(RED)` → `(GREEN)`)

Three defects found by auditing the places that switch on the two enums the MOQ
work widened. The first was shipping-breaking.

**A. The cart→checkout contract was broken — every MOQ checkout returned 400.**

The cart stored `kind: 'moq'`; `app/checkout/page.tsx` forwards `i.kind`
verbatim; `POST /api/orders` accepted `'moq_product'`. So no customer could ever
buy an MOQ item.

Both sides were already covered and both suites passed — the cart tests spoke the
cart's vocabulary, the route tests spoke the route's, and **nothing crossed the
seam**. That is the whole lesson of this round: unit tests on either side of an
interface cannot detect that the interface disagrees.

- RED: `npx vitest run app/api/orders/cart-contract.test.ts` →
  `Tests 2 failed | 2 passed (4)`, MOQ line `expected 400 to be 201`, while the
  on-hand and kahati lines both reached 201 — so the failure was the MOQ
  vocabulary, not broken setup.
- GREEN: cart now uses `'moq_product'`; `moqCartLine()` moved into
  `lib/store/cart.ts` so the contract test exercises the exact line the
  storefront builds instead of restating it.

**B. Cancelling an MOQ order permanently lost its stock.**

The cancellation path released group-buy campaign commitments but was never
taught about MOQ lines. Unlike a commitment, this is real inventory that checkout
deducted — nothing errors, the shelf just under-sells forever after.

- RED: `Tests 4 failed | 1 passed (5)` — `expected 42 to be 50`. The passing case
  was the non-cancellation control, confirming the setup was sound.
- GREEN: 15/15 (5 new plus the 10 existing cancellation tests).

**C. The client order types denied values the API really returns.**

`Order['buyType']` lacked `'moq'` and `OrderItem['kind']` lacked both
`'moq_product'` and `'moq_campaign'` — the latter a **pre-existing** gap, since
the campaign-commit route has always written that kind.

- RED: `npx tsc --noEmit` → 3 errors in `lib/types-order-modes.test.ts`. Vitest
  does not typecheck, so the RED signal here is tsc, which covers test files.
- GREEN: both unions pinned to their enum values; narrowing either now fails the
  typecheck.

**Live verification** against a running dev server, which is what the earlier
harness-only checks could not do:

| Step | Result |
|---|---|
| `POST /api/orders` with an MOQ line | **201**, `buyType=moq`, total ₱22,800 |
| MOQ stock after purchase | 40 → **35** |
| Admin `PATCH .../status` `cancelled` | order status `cancelled` |
| MOQ stock after cancellation | **40 restored** |
| Cancelling a second time | still **40** — no double-restock |

### 11. Completion audit

Asked whether the work was complete, the two things I had asserted but never
verified were audited rather than assumed.

**A. The other untested client→API seam turned out to be sound.**

The admin form built its multipart body inline while the route parsed it, with
both sides tested only against their own restatement — the same shape as the
checkout bug. `moqProductFormData`/`moqDraftFrom` moved into
`lib/moq-product-form.ts` and the contract test now posts the exact body the
screen sends. Result: `Tests 33 passed (33)`. No defect; now guarded.

**B. The seventh nav tab was a real 320px regression.**

At six tabs each slot is 53px and the widest label ("Group Buy") renders at 47px.
The MOQ tab drops slots to 46px, so the label wrapped and spilled below the bar.
The seven-tab state now uses a 9.5px label; the six-tab bar is untouched.

This was nearly missed twice. The first browser attempt reported a 320px window
but `document.documentElement.clientWidth` was **500** — Chrome on macOS enforces
a minimum window width, so window resizing never reaches 320. Device-viewport
emulation is required, and the earlier "responsive" check would have been a false
pass.

Measured at a true 320px viewport, after the fix:

| Breakpoint | Tabs | Wrapped labels | Horizontal overflow | Card columns |
|---|---|---|---|---|
| 320 | 7 | 0 | none | 1 |
| 768 | 7 | 0 | none | 2 |
| 1440 | 7 | 0 | none | 3 |

Widest label at 320px: "Group Buy" 47px → **42.6px** in a 46px slot.

Also confirmed visually for the first time: `/moq` hydrates and paints all three
products, and `/admin/moq-products` renders the shelf beside the relabelled
"Group Buy Campaigns" sidebar entry.

---

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|---|---|---|---|
| 1 | MOQ carries its own packing fee default (₱300), admin-editable | `lib/pricing.test.ts` | unit | PASS |
| 2 | A per-listing MOQ packing fee overrides the global default | `lib/pricing.test.ts` | unit | PASS |
| 3 | `validateMoqQty` rejects below-minimum, fractional, over-stock and zero-stock buys | `lib/pricing.test.ts` | unit | PASS |
| 4 | A four-mode cart splits into four orders, `moq` emitted last | `lib/order-modes.test.ts` | unit | PASS |
| 5 | MOQ items never land in the `group_buy` segment | `lib/order-modes.test.ts` | unit | PASS |
| 6 | `moq_products` stores price, stock, min qty, image key; defaults min 1 / stock 0 | `lib/db/moq-products.test.ts` | integration | PASS |
| 7 | `buy_type` accepts `moq`; `order_item_kind` accepts `moq_product` | `lib/db/moq-products.test.ts` | integration | PASS |
| 8 | Visibility defaults OFF and persists in the database | `lib/settings-moq.test.ts` | integration | PASS |
| 9 | A corrupt visibility value reads as OFF (fails closed) | `lib/settings-moq.test.ts` | integration | PASS |
| 10 | Toggling twice updates one row, never inserts a duplicate key | `lib/settings-moq.test.ts` | integration | PASS |
| 11 | Admin can create an MOQ product with price, stock and min qty | `app/api/admin/moq-products/route.test.ts` | integration | PASS |
| 12 | Admin can upload a product image; non-images are rejected | same | integration | PASS |
| 13 | Admin can edit one field without disturbing the others | same | integration | PASS |
| 14 | Delete removes an unreferenced product outright | same | integration | PASS |
| 15 | Admin list includes archived rows and **never** main-catalog products | same | integration | PASS |
| 16 | Customers and anonymous callers get 403/401 on every admin route | same | integration | PASS |
| 17 | Public API 404s while the page is off — anonymous *and* signed in | same | integration | PASS |
| 18 | Public API hides archived products and honours admin sort order | same | integration | PASS |
| 19 | Toggling off takes effect immediately (200 → 404 in one test) | same | integration | PASS |
| 20 | MOQ checkout creates a `buyType: 'moq'` order with the MOQ packing fee | `app/api/orders/moq.test.ts` | integration | PASS |
| 21 | Checkout prices server-side and ignores any client-sent price | same | integration | PASS |
| 22 | Stock is drawn down atomically; a rejected order leaves stock untouched | same | integration | PASS |
| 23 | Checkout re-enforces the minimum order quantity server-side | same | integration | PASS |
| 24 | Archived and unknown MOQ products cannot be bought | same | integration | PASS |
| 25 | An on-hand + MOQ cart becomes two orders with distinct order numbers and fees | same | integration | PASS |
| 26 | MOQ orders carry no downpayment — paid in full | same | integration | PASS |
| 27 | Cart clamps MOQ lines to stock and removes rather than dropping below the minimum | `lib/store/cart.test.ts` | unit | PASS |
| 28 | Card shows image (or emoji fallback), name, spec, price, stock, description, min qty | `components/MoqProductCard.test.tsx` | unit | PASS |
| 29 | Out-of-stock, and stock below one whole minimum, cannot be added | same | unit | PASS |
| 30 | Board seeds the cart line at the product minimum, not at 1 | `app/(storefront)/moq/MoqBoard.test.tsx` | unit | PASS |
| 31 | `/moq` 404s while off, renders while on, and 404s again when switched back | `app/(storefront)/moq/page.test.tsx` | unit | PASS |
| 32 | Nav shows 6 tabs when off, 7 when on; unresolved setting counts as off | `components/BottomNav.test.tsx` | unit | PASS |
| 33 | The admin switch reflects the server, never an optimistic guess, and surfaces save failures | `app/admin/settings/MoqPageCard.test.tsx` | unit | PASS |
| 34 | The seed lists exactly the three named products, blends marked salt/liquid | `lib/db/data/moq-seed.test.ts` | unit | PASS |
| 35 | Admin add sends every typed field; a new product defaults to visible, min qty 1 | `app/admin/moq-products/page.test.tsx` | unit | PASS |
| 36 | A blank packing fee is omitted, not sent as 0 (0 would mean genuinely free) | same | unit | PASS |
| 37 | Edit prefills from the product and carries its id, so it updates rather than creates | same | unit | PASS |
| 38 | Unticking visibility archives the product | same | unit | PASS |
| 39 | A chosen image is attached; omitting it keeps the existing image | same | unit | PASS |
| 40 | A failed save keeps the form open, shows the error and preserves typing | same | unit | PASS |
| 41 | Delete needs confirmation, names the product, and targets the clicked card | same | unit | PASS |
| 42 | Archived products are badged; loading and empty shelves are explained | same | unit | PASS |
| 43 | Every cart line kind is accepted by checkout (on-hand, kahati, MOQ, mixed) | `app/api/orders/cart-contract.test.ts` | integration | PASS |
| 44 | Cancelling an MOQ order returns its units to stock, once only | `app/api/admin/orders/[id]/status/moq-restock.test.ts` | integration | PASS |
| 45 | A non-cancellation status change leaves stock alone | same | integration | PASS |
| 46 | An archived MOQ product is still restocked — the units exist | same | integration | PASS |
| 47 | Client order types admit every buy_type and order_item_kind value | `lib/types-order-modes.test.ts` | typecheck | PASS |
| 48 | The admin form's multipart body round-trips through the API unchanged | `app/api/admin/moq-products/form-contract.test.ts` | integration | PASS |
| 49 | A blank packing fee stores null, not 0 | same | integration | PASS |
| 50 | An edit preserves untouched fields and keeps the existing image | same | integration | PASS |
| 51 | The nav tightens its label size only in the seven-tab state | `components/BottomNav.test.tsx` | unit | PASS |

**Command:** `npm test` → **`Test Files 54 passed (54)`, `Tests 525 passed (525)`**
**Types:** `npx tsc --noEmit` → clean
**Build:** `npm run build` → succeeds; `/moq` listed as ƒ (dynamic), 121 kB first-load JS

---

## Live verification

Run against a real dev server (`npm run dev`, port 3002) with the three products
seeded, exercising the toggle end to end:

| Check | Page OFF | Page ON |
|---|---|---|
| `GET /moq` | **404** | **200** |
| `GET /api/moq-products` | **404** | **200**, all three products |
| `GET /api/settings` → `moqPageEnabled` | `false` | `true` |

Migrations were also replayed against a fresh empty pglite database
(`0000`–`0007`, no errors), then `npx tsx scripts/seed.ts` inserted all three MOQ
products with `moq_page_enabled` absent — which the getter reads as OFF.

---

## Coverage

`npx vitest run --coverage` on the files this work touched:

| File | % Stmts | % Branch |
|---|---|---|
| `lib/moq-products.ts` | 100 | 100 |
| `lib/order-modes.ts` | 100 | 100 |
| `lib/pricing.ts` | 100 | 98.59 |
| `lib/settings.ts` | 100 | 94.73 |
| `lib/store/cart.ts` | 94.23 | 95.55 |
| `components/BottomNav.tsx` | 76.31 | 100 |
| `app/admin/moq-products/page.tsx` | 100 | 76.47 |
| `app/api/moq-products/route.ts` | 100 | 100 |
| `app/api/admin/moq-products/route.ts` | 100 | 94.44 |
| `app/(storefront)/moq/` | 100 | 100 |

Repository-wide statement coverage is 47.14%, still under the 80% target. That
figure is dominated by pre-existing untested `page.tsx` files across the admin
and storefront and is **not** a regression introduced here — every module added
by this work is at or near 100%.

## Known gaps

- ~~`app/admin/moq-products/page.tsx` is at 0% line coverage.~~ **Closed** in
  `c1793d3` — 25 component tests, 100% statements / 76% branches, mutation-tested
  (see cycle 9).
- ~~The cart→checkout seam was untested~~ and ~~the admin form seam was
  untested~~ — both now have contract tests (rounds 10 and 11). **The campaign
  commit payload still has none**, and it predates this work; it could hide the
  same class of defect.
- ~~No browser-level verification.~~ **Closed** in round 11: `/moq` and
  `/admin/moq-products` were confirmed to hydrate and paint in Chrome.
- ~~No responsive screenshots.~~ **Closed** in round 11 at 320/768/1440, which
  found and fixed a real wrapping regression. 1024 was not measured separately —
  it sits between two verified points with no breakpoint change between 768 and
  1024 in this layout.
- **No automated visual-regression baseline.** The responsive checks were
  one-off measurements, not stored screenshots, so a future layout regression
  would not be caught by CI.
- **MOQ product images are served through `signedUrl`.** Under the production
  drivers (ImageKit/Supabase) these are public URLs. Under the local dev storage
  driver they route through `/api/files/...`, which requires a session — so an
  anonymous visitor browsing `/moq` in local dev will not see uploaded images.
  This is pre-existing infrastructure behaviour shared with payment-method QR
  codes, not introduced here, and it was left alone rather than widened in scope.
- **Seeded prices and stock are `0`.** Neither blend is priced as a blend in
  `data/pricelist.json`, so the figures are deliberately blank rather than
  invented. The page must not be switched on until an admin sets them.

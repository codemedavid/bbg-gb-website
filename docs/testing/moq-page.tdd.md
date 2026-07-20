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

**Command:** `npm test` → **`Test Files 49 passed (49)`, `Tests 477 passed (477)`**
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

Repository-wide statement coverage is 42.88%, well under the 80% target. That
figure is dominated by pre-existing untested `page.tsx` files across the admin
and storefront and is **not** a regression introduced here — every module added
by this work is at or near 100% on the logic layers.

## Known gaps

- **`app/admin/moq-products/page.tsx` is at 0% line coverage.** The admin CRUD
  screen is a large form component; its server contract is covered thoroughly by
  the 24 API tests, but the form itself has no component test. This is the main
  outstanding gap and the first thing worth adding.
- **No browser-level verification.** The Chrome DevTools MCP profile was locked
  by another running instance, so the storefront was verified by HTTP status,
  API payload and server-rendered HTML rather than a real page render. Client
  hydration of the product grid and the seventh nav tab is covered by unit tests
  only — both are client-fetched and so are absent from the SSR HTML by design.
- **No visual-regression or responsive screenshots** at 320/768/1024/1440, which
  the web testing rules call for. The card and grid use the same Tailwind
  breakpoints as the existing boards, but this has not been visually confirmed.
- **MOQ product images are served through `signedUrl`.** Under the production
  drivers (ImageKit/Supabase) these are public URLs. Under the local dev storage
  driver they route through `/api/files/...`, which requires a session — so an
  anonymous visitor browsing `/moq` in local dev will not see uploaded images.
  This is pre-existing infrastructure behaviour shared with payment-method QR
  codes, not introduced here, and it was left alone rather than widened in scope.
- **Seeded prices and stock are `0`.** Neither blend is priced as a blend in
  `data/pricelist.json`, so the figures are deliberately blank rather than
  invented. The page must not be switched on until an admin sets them.

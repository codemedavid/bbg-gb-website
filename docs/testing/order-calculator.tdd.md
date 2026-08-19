# Order Calculator — build a quote before checkout

**Date:** 2026-08-19 · **Branch:** `feat/group-buy-page`

## Source plan

No `*.plan.md` file. The plan was produced inline by `/ecc:plan` in this session
from a Claude Design project, and confirmed by the user before any code was
written. The design was read directly from the project rather than described
secondhand:

- Project `0c0d6ba9-cf34-4360-95b9-6976f534c35e`, file `Order Calculator.dc.html`
- Read via the `DesignSync` tool (`list_files`, then `get_file`)

Three decisions were taken by the user at plan time and are the reason the
implementation departs from the mock where it does:

| Decision | Choice |
|---|---|
| Route | New `/order-calc`; the recon calculator at `/calc` stays untouched |
| Fee line | Mode selector (solo / kahati / group_buy / moq), not the mock's flat shipping fee |
| Cart | Estimate only — the calculator never writes to the cart |

## What the design was, and what changed

The mock is a dark-purple "Mica Glow" calculator: a numbered **Add products**
card with a search-to-add list, a numbered **Your order** card with `− qty +`
line rows, and a sticky footer whose `ESTIMATED TOTAL` expands into a breakdown.
That layout is carried over 1:1. Three things could not be carried over:

1. **Data.** The mock inlines a ~170-row JSON blob with `{code, name, spec, vial,
   stock: 'in'|'low'|'out'}`. BBG has a real catalogue, so the page reads
   `useProducts({})` and derives the stock band from the numeric `stock` column
   using the same threshold the shelf uses (`LOW_STOCK_VIALS = 10`, matching
   `components/ProductCard.tsx`). Code search is done client-side because
   `GET /api/products` only filters on name and spec.

2. **The fee.** BBG has no shipping fee. It has a **packing fee priced per
   fulfilment mode**, with local shipping already included (`lib/pricing.ts`).
   A flat ₱500 "shipping fee" would have been wrong for all four modes, so the
   fee follows a mode selector and reads the live table via `usePackingFees()`,
   falling back to `PACKING_FEE_PHP` only while that request is in flight.

3. **The sticky bar's position.** `BottomNav` is already `fixed bottom-0 z-20`.
   The summary sits at `bottom-[76px] z-[15]` above it, and the page reserves
   `pb-[150px]` so the last order line clears both bars. Verified numerically —
   see *Layout verification* below.

## User journeys

> **J1** As a customer, I search the pricelist by name **or code**, so I can find
> an item without scrolling ~170 rows.
>
> **J2** As a customer, I tap a product to add it and adjust vials with −/+, so I
> can build a quote.
>
> **J3** As a customer, I see each line total and a running estimated total, so I
> know the cost before checkout.
>
> **J4** As a customer, I pick a fulfilment mode, so the packing fee matches how
> I will actually buy.
>
> **J5** As a customer, I see stock status, so I do not quote something that is
> out of stock.

## Task report

### 1. Quote math (`lib/order-calc.ts`)

A framework-free module so every number the page shows is tested rather than
assembled inline in JSX: `stockState`, `vialPrice`, `searchProducts`,
`addEntry`, `setEntryQty`, `buildLines`, `orderTotals`.

- **RED** — `npx vitest run lib/order-calc.test.ts`
  → `Error: Failed to load url ./order-calc … Does the file exist?` (0 tests)
- **GREEN** — same command → `Test Files 1 passed (1) · Tests 33 passed (33)`

Two rules here are judgement calls worth recording:

- **An empty order owes no fee.** Quoting ₱200 over an empty basket is the one
  number on the page that would be plainly false.
- **An entry whose product left the catalogue is dropped, not shown at ₱0.** Both
  answers understate the total by what the line was worth; only one of them also
  asserts a price that was never true.

### 2. The surface (`components/OrderCalc*.tsx`)

`OrderCalcStep` (shared numbered card), `OrderCalcSearch`, `OrderCalcLines`,
`OrderCalcSummary`.

- **RED** — `npx vitest run components/OrderCalc`
  → `Test Files 3 failed (3) · Tests no tests` (all three components unresolved)
- **GREEN** — same command → `Test Files 3 passed (3) · Tests 34 passed (34)`

Stepper and remove controls are named per product (`Increase Tirzepatide`), not
generically as in the mock: two rows of identical −/+/✕ buttons are otherwise
indistinguishable to a screen reader, on a list whose whole purpose is changing
a number the customer cares about.

### 3. Route and entry point (`app/(storefront)/order-calc/page.tsx`)

- **RED** — `npx vitest run 'app/(storefront)/order-calc'`
  → failed to resolve `./page` (0 tests)
- **GREEN** — same command → `Test Files 1 passed (1) · Tests 8 passed (8)`

Home gains a second dashed card beside the recon calculator. `/calc` is unchanged.

### 4. Refactor

None taken. The three components were extracted up front rather than split out
of a large page afterwards, and the shared numbered card (`OrderCalcStep`) was
factored on first write. Tests stayed green throughout.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A zero or negative stock count reads as out of stock | `lib/order-calc.test.ts:stockState` | unit | PASS |
| 2 | Stock at or below 10 reads as low, above 10 as in stock | `lib/order-calc.test.ts:stockState` | unit | PASS |
| 3 | The on-hand piece price wins; the catalogue price is the fallback | `lib/order-calc.test.ts:vialPrice` | unit | PASS |
| 4 | A zero or unparseable price yields 0, never NaN | `lib/order-calc.test.ts:vialPrice` | unit | PASS |
| 5 | Search matches product code case-insensitively (J1) | `lib/order-calc.test.ts:searchProducts` | unit | PASS |
| 6 | Search matches name and spec, and caps at 60 rows | `lib/order-calc.test.ts:searchProducts` | unit | PASS |
| 7 | Adding a product already in the order increments it (J2) | `lib/order-calc.test.ts:addEntry` | unit | PASS |
| 8 | Setting quantity to zero or below removes the line (J2) | `lib/order-calc.test.ts:setEntryQty` | unit | PASS |
| 9 | Add and setQty never mutate the entries they are given | `lib/order-calc.test.ts` | unit | PASS |
| 10 | Each line is priced at quantity × vial price (J3) | `lib/order-calc.test.ts:buildLines` | unit | PASS |
| 11 | An entry whose product left the catalogue is dropped | `lib/order-calc.test.ts:buildLines` | unit | PASS |
| 12 | Subtotal, vial count and total reconcile with the fee (J3) | `lib/order-calc.test.ts:orderTotals` | unit | PASS |
| 13 | An empty order is charged no fee | `lib/order-calc.test.ts:orderTotals` | unit | PASS |
| 14 | The search card reports the catalogue size | `components/OrderCalcSearch.test.tsx` | unit | PASS |
| 15 | Typing a code narrows the list to that product (J1) | `components/OrderCalcSearch.test.tsx` | unit | PASS |
| 16 | Tapping a row adds that product (J2) | `components/OrderCalcSearch.test.tsx` | unit | PASS |
| 17 | No matches says so and quotes the query back | `components/OrderCalcSearch.test.tsx` | unit | PASS |
| 18 | Rows badge IN / LOW / OUT OF STOCK (J5) | `components/OrderCalcSearch.test.tsx` | unit | PASS |
| 19 | An out-of-stock product can still be quoted (J5) | `components/OrderCalcSearch.test.tsx` | unit | PASS |
| 20 | An empty order invites a search rather than showing a bare panel | `components/OrderCalcLines.test.tsx` | unit | PASS |
| 21 | Vial count pluralises correctly | `components/OrderCalcLines.test.tsx` | unit | PASS |
| 22 | −/+ step the quantity; stepping down from 1 asks for 0 (J2) | `components/OrderCalcLines.test.tsx` | unit | PASS |
| 23 | Steppers are named per product, so two rows are distinguishable | `components/OrderCalcLines.test.tsx` | unit | PASS |
| 24 | The breakdown stays closed until asked for | `components/OrderCalcSummary.test.tsx` | unit | PASS |
| 25 | Subtotal + fee reconcile against the displayed total (J3) | `components/OrderCalcSummary.test.tsx` | unit | PASS |
| 26 | The fee is labelled packing, noting local shipping is included | `components/OrderCalcSummary.test.tsx` | unit | PASS |
| 27 | All four fulfilment modes are offered, with the active one pressed (J4) | `components/OrderCalcSummary.test.tsx` | unit | PASS |
| 28 | A product tapped in search reaches the order and the total (J2, J3) | `app/(storefront)/order-calc/page.test.tsx` | integration | PASS |
| 29 | Goods + the real ₱200 solo packing fee totals ₱700 on ₱500 of goods | `app/(storefront)/order-calc/page.test.tsx` | integration | PASS |
| 30 | Adding the same product twice makes one line, not two | `app/(storefront)/order-calc/page.test.tsx` | integration | PASS |
| 31 | Stepping a line to nothing removes it and restores the empty state | `app/(storefront)/order-calc/page.test.tsx` | integration | PASS |
| 32 | Changing mode re-prices the fee (₱650 hatian / ₱800 pasabay) (J4) | `app/(storefront)/order-calc/page.test.tsx` | integration | PASS |

## Coverage

`npx vitest run --coverage lib/order-calc.test.ts components/OrderCalc 'app/(storefront)/order-calc'`
→ `Test Files 5 passed (5) · Tests 75 passed (75)`

| File | % Stmts | % Branch | % Funcs | % Lines |
|---|---|---|---|---|
| `lib/order-calc.ts` | 100 | 90.47 | 100 | 100 |
| `app/(storefront)/order-calc/page.tsx` | 100 | 85.71 | 100 | 100 |
| `components/OrderCalcStep.tsx` | 100 | 100 | 100 | 100 |
| `components/OrderCalcSearch.tsx` | 100 | 90 | 100 | 100 |
| `components/OrderCalcLines.tsx` | 100 | 100 | 100 | 100 |
| `components/OrderCalcSummary.tsx` | 100 | 100 | 100 | 100 |

Every new file is at 100% line coverage, comfortably past the 80% floor. The
uncovered branches are defensive fallbacks: the `??` on the packing-fee lookup
before `usePackingFees()` resolves, the `loading` label on the search card, and
optional `code`/`spec` rendering.

## Whole-suite and build

| Check | Command | Result |
|---|---|---|
| Full suite | `npm test` | `209 files passed · 2217 tests passed` |
| Types | `npx tsc --noEmit` | exit 0, no output |
| Build | `npm run build` | clean; `/order-calc` 4.63 kB, 124 kB first load |

124 kB first load is inside the 300 kB app-page budget.

## Layout verification

Run against the **production build** (`next start`) on the local PGlite stack
(`DATABASE_URL=` empty, `PGLITE_PATH=./.pglite`, `STORAGE_DRIVER=local`) — never
the production Supabase in `.env`. 101 seeded products; packing fees read back as
the documented defaults (solo 200 / kahati 150 / group_buy 300 / moq 200).

Driven over the Chrome DevTools Protocol with `Emulation.setDeviceMetricsOverride`,
because the Chrome `--window-size` flag does not set the layout viewport — the
first screenshots taken that way were crops of a wider render and were discarded.

The risk this was checking: the new fixed summary bar colliding with `BottomNav`.

| Viewport | scrollWidth | Overflow-X | Summary bar bottom | BottomNav top | Clearance |
|---|---|---|---|---|---|
| 320 | 320 | none | 824 | 840 | 16px |
| 375 | 375 | none | 824 | 840 | 16px |
| 768 | 768 | none | 824 | 840 | 16px |
| 1440 | 1440 | none | 824 | 840 | 16px |

No overlap and no horizontal overflow at any breakpoint. The last order line
ends at y=472 (320px), far clear of the bar at y=756.

Interaction checked live in the browser at 320 and 375: searching `tirz` returns
6 rows that fit the viewport (`rowRight` 287 at 320px), tapping one adds
Tirzepatide 15mg at ₱550/vial, and switching **On-hand → Hatian** moves the fee
₱200 → ₱150 and the total ₱750 → ₱700.

> One correction worth recording: the first mode-switch run reported "no change".
> That was a bug in the QA script's button matcher (it compared an untrimmed
> `'' + ' ' + textContent` against `/^Hatian$/`), not in the page. After fixing
> the matcher the re-priced numbers above were observed directly.

## Known gaps

- **No E2E spec committed.** The repo has no Playwright harness; browser
  verification here was ad-hoc CDP scripting from the scratchpad and is not
  reproducible in CI. The behaviours it covered are all also asserted in the
  jsdom integration test.
- **No visual-regression baseline.** Screenshots were reviewed by eye, not
  diffed against stored baselines.
- **Contrast and keyboard navigation were not audited** beyond per-product
  control names and native button/input semantics.

## Merge evidence

Checkpoint commits on `feat/group-buy-page`, in order:

| Commit | Stage |
|---|---|
| `4c0a07b` | RED — quote-math reproducer |
| `ca7a779` | GREEN — `lib/order-calc.ts`, 33 passed |
| `71919af` | RED — component reproducers |
| `c74a950` | GREEN — the four components, 34 passed |
| `19bb953` | RED — route reproducer |
| `7ec614a` | GREEN — route + home entry, 8 passed |

If these are squashed, the RED/GREEN summary above is the surviving record.

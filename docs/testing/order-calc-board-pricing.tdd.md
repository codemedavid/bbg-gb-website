# Order Calculator — quote the boards, not the shelf

**Date:** 2026-09-05 · **Branch:** `feat/group-buy-page`

## Source plan

No `*.plan.md` file. The plan was produced inline by `/ecc:plan` in this session
and confirmed by the user before any code was written. It amends
[`order-calculator.tdd.md`](./order-calculator.tdd.md), which records the
original build; three of that document's guarantees are withdrawn here and are
struck through at the source.

The request: *"in the order calculator remove the onhand pricing and make sure
the pricing in the order calc is the one we use for groupbuy and kahati and
remove the low stock in stock since its for groupbuy and kahati only."*

Two scoping decisions were taken at plan time:

| Decision | Choice |
|---|---|
| Fee selector | Narrow to Hatian + Pasabay (user's answer); On-hand and MOQ removed |
| Stock bands | Remove all three, not just LOW/IN |
| Catalogue | Unfiltered — `is_kahati` is false on all 88 products since the batch closed 2026-08-16, so filtering on the channel flags would empty the page |

## The bug this uncovered

`products.price_php` is a **per-kit (10 vials)** figure — the source workbook
column is headed "PER KIT (10 VIALS) PRICE" and reaches the column unchanged
(`lib/db/data/catalog.ts:5-8`). The calculator read it as a **per-vial** price.

`vialPrice` also preferred `on_hand_piece_php`, which masked the error on
products that happen to be stocked on the ready shelf and hid it everywhere else:

| Product | `price_php` (kit) | Calculator showed | Boards charge |
|---|---|---|---|
| Tirzepatide 15mg | 3200 | ₱550 — the on-hand shelf price | ₱320 |
| Tirzepatide 40mg | 6250 | **₱6,250** — the whole kit, per vial | ₱625 |
| Retatrutide 10mg | 4375 | **₱4,375** | ₱437.50 |

So every product without an on-hand piece price was quoted at ten times what
either board charges, on a page badged `LIVE ESTIMATE`.

## The rule adopted

Both boards seed a kit through `seededKitPrice` — the admin's group buy kit
price where one is set, else the shop price — and divide it down
(`lib/campaign-seed.ts`, `lib/kahati-seed.ts`). `vialPrice` now takes the same
path:

```ts
export function vialPrice(p: CalcProduct): number {
  const piece = groupBuyUnitPrice(p, 'piece');
  if (piece != null) return piece;
  const kit = seededKitPrice(p, p.pricePhp);
  return kit == null ? 0 : round2(kit / groupBuyVialsPerKit(p));
}
```

Where a product sets its own `gb_vials_per_kit`, this follows the **Pasabay**
divisor; a hatian always divides by ten because it fills exactly one kit
(`KAHATI_MAX_VIALS === VIALS_PER_KIT`). Every product has that column null
today, so the two boards agree. Noted rather than hidden.

## User journeys

> **J1** As a customer pricing a hatian or pasabay basket, I see the same
> per-vial price the board will charge me, so the quote I decide on is the quote
> I get.
>
> **J2** As a customer, I am not shown a ready-shelf price on a page that quotes
> the scheduled boards, so I never plan around a rate that does not apply.
>
> **J3** As a customer, I am not shown stock bands for boards that hold no
> stock, so nothing implies a vial is on a shelf waiting.
>
> **J4** As a customer, the packing fee I can pick from is one of the two boards
> this page prices, so the fee and the goods belong to the same order.

## Task report

### 1. Quote math (`lib/order-calc.ts`)

Repriced `vialPrice` onto the boards; deleted `stockState`, `StockState` and
`LOW_STOCK_VIALS`; dropped `stock` from `CalcProduct` and `CalcLine`, and the
on-hand price columns from `CalcProduct`.

- **RED** — `npx vitest run lib/order-calc.test.ts …` → `Tests 18 failed | 54 passed (72)`,
  including all six new `vialPrice` cases and
  `vialPrice > ignores the on-hand shelf price entirely`
- **GREEN** — same command → `Test Files 5 passed (5) · Tests 72 passed (72)`

### 2. Pricing types (`lib/pricing.ts`)

Split `GroupBuyPricing` (the three columns that price a product) out of
`GroupBuyConfig` (those plus the two that size a batch), so a surface that only
quotes need not carry fields it never reads. `GroupBuyConfig` is now
`GroupBuyPricing & { gbMinVials, gbMaxVialsPerBatch }` — no behaviour change.

The narrowing surfaced three type errors, all fixed:

- `Product` declares the `gb_*` fields optional, so `Product[]` did not satisfy a
  `GroupBuyPricing` demanding `null`. `GroupBuyPricing` now accepts `undefined`
  as well — `positiveMoney` and `positiveInt` already read both as "not
  configured", so the type states what the code always did.
- `lib/db/data/skin-repair.test.ts:137` passed `gbMinVials` and
  `gbMaxVialsPerBatch` into `groupBuyUnitPrice`, which never reads them. Dead
  weight before, an excess property now — trimmed.

### 3. The product feed (`app/api/products/route.ts`)

`GET /api/products` returned none of the `gb_*` columns, so the calculator could
not have seen an admin-set group buy rate at all — only the shop price. Added
`gbPricePerKitPhp`, `gbPricePerPiecePhp` and `gbVialsPerKit`.

### 4. The surface (`components/OrderCalc*.tsx`, `app/(storefront)/order-calc/page.tsx`)

Stock badges removed from the search rows and replaced with a `PER VIAL`
caption; `MODES` narrowed to Hatian + Pasabay; the page opens on `kahati` rather
than `solo`; the subtitle now says which prices it quotes.

### 5. Refactor

None beyond the type split in task 2, which was part of the implementation
rather than a follow-up. Tests stayed green after it.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | An explicit group buy per-piece price is quoted as-is (J1) | `lib/order-calc.test.ts:vialPrice` | unit | PASS |
| 2 | A group buy kit price is divided by the kit size (J1) | `lib/order-calc.test.ts:vialPrice` | unit | PASS |
| 3 | Absent a group buy price, the shop KIT price is divided, not quoted (J1) | `lib/order-calc.test.ts:vialPrice` | unit | PASS |
| 4 | A product's own `gb_vials_per_kit` is honoured over the default ten | `lib/order-calc.test.ts:vialPrice` | unit | PASS |
| 5 | The on-hand shelf price is never consulted (J2) | `lib/order-calc.test.ts:vialPrice` | unit | PASS |
| 6 | A zero group buy price is ignored, not read as free | `lib/order-calc.test.ts:vialPrice` | unit | PASS |
| 7 | An unusable price yields 0, never NaN | `lib/order-calc.test.ts:vialPrice` | unit | PASS |
| 8 | No IN / LOW / OUT OF STOCK band is rendered (J3) | `components/OrderCalcSearch.test.tsx` | unit | PASS |
| 9 | Every search row stays tappable with no stock gate (J3) | `components/OrderCalcSearch.test.tsx` | unit | PASS |
| 10 | Rows quote the per-vial board price | `components/OrderCalcSearch.test.tsx` | unit | PASS |
| 11 | Hatian and Pasabay are both offered (J4) | `components/OrderCalcSummary.test.tsx` | unit | PASS |
| 12 | No On-hand or MOQ fee is offered (J4) | `components/OrderCalcSummary.test.tsx` | unit | PASS |
| 13 | The active mode is marked pressed | `components/OrderCalcSummary.test.tsx` | unit | PASS |
| 14 | ₱500 of goods + the real ₱150 hatian fee totals ₱650 (J4) | `app/(storefront)/order-calc/page.test.tsx` | integration | PASS |
| 15 | Switching to Pasabay re-prices the fee to ₱800 (J4) | `app/(storefront)/order-calc/page.test.tsx` | integration | PASS |
| 16 | A ₱6,955/kit product with a ₱900 shelf price quotes ₱845.50, not ₱1,050 (J1, J2) | `app/(storefront)/order-calc/page.test.tsx` | integration | PASS |

## Coverage

`npx vitest run --coverage lib/order-calc.test.ts components/OrderCalc*.test.tsx
'app/(storefront)/order-calc/page.test.tsx'`
→ `Test Files 5 passed (5) · Tests 72 passed (72)`

| File | % Stmts | % Branch | % Funcs | % Lines | Uncovered |
|---|---|---|---|---|---|
| `lib/order-calc.ts` | 100 | 91.42 | 100 | 100 | 82, 89, 97 |
| `app/(storefront)/order-calc/page.tsx` | 100 | 85.71 | 100 | 100 | 30 |
| `components/OrderCalcLines.tsx` | 100 | 100 | 100 | 100 | — |
| `components/OrderCalcStep.tsx` | 100 | 100 | 100 | 100 | — |

100% line coverage on every file changed, past the 80% floor. The uncovered
branches are defensive fallbacks that survived this change untouched: the
optional `code`/`spec` rendering in search and line rows (order-calc.ts 82, 89,
97) and the `??` on the packing-fee lookup while `usePackingFees()` is in flight
(page.tsx 30).

## Whole-suite and types

| Check | Command | Result |
|---|---|---|
| Types | `npx tsc --noEmit --pretty false` | exit 0, no output |
| Calculator specs | `npx vitest run lib/order-calc.test.ts components/OrderCalc*.test.tsx 'app/(storefront)/order-calc/page.test.tsx'` | `Test Files 5 passed (5) · Tests 72 passed (72)` |
| Full suite | `npx vitest run` | `Test Files 1 failed \| 272 passed (273) · Tests 2 failed \| 2994 passed (2996)` |

### The two full-suite failures are pre-existing flake, not this change

Both are in `app/api/pasalo/e2e-refund.test.ts` and both read
`Error: Test timed out in 30000ms` — a timeout, not a wrong answer. That file
belongs to the Pasalo refund work and contains no reference to `order-calc`,
`vialPrice`, `groupBuyUnitPrice` or `seededKitPrice`; the `GroupBuyPricing`
split is type-only and emits no runtime change.

Four runs establish it:

| Run | Result |
|---|---|
| `e2e-refund.test.ts` alone @ `14de5a1` (before this work) | 31/31 pass, 92.5s |
| `e2e-refund.test.ts` alone @ this branch | 31/31 pass, 93.0s |
| Full suite @ this branch, run 1 | 3 failed — SCENARIOs 7, 8, 9 |
| Full suite @ this branch, run 2 | 2 failed — SCENARIOs 7, 9 |
| **Full suite @ `14de5a1`** (scratch worktree, `git worktree add --detach`) | **17 failed / 3 files**, same `e2e-refund.test.ts` timeouts among them |

Identical timings in isolation, a failing set that changes between identical
runs, and a pre-change baseline that fails *more* than this branch. Those
scenarios take ~3s each unloaded and exceed the 30s ceiling when 272 other files
compete for the machine. Not introduced here, and not fixed here either.

## Known gaps

- No browser QA run. The change is arithmetic and markup removal, both covered
  by the specs above; the fixed-bar layout the original build verified at four
  breakpoints is untouched.
- `components/ProductCard.tsx:97` renders `php(p.pricePhp)` directly for
  products with no on-hand piece price — the same per-kit-as-per-vial confusion,
  on the storefront shelf rather than the calculator. Out of scope for this
  change and flagged to the user, not fixed.

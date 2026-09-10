# Price adjustment: the group buy price the boards actually quote

## Source plan

No `*.plan.md`. Journeys were derived during this TDD run from the request:
*"BBG Price Adjustment-Sep2026 (1).xlsx — can you update all the prices in the
boards we have for kahati and groupbuy."*

The workbook is byte-identical to the one applied on 2026-09-09. That run had
moved `products.price_php` on 126 rows, yet in prod on 2026-09-10:

| Surface | Open | At the workbook price | Still at the old price |
|---|---|---|---|
| Kahati counters | 122 | 54 | **50** |
| Group Buy batches | 124 | 49 | **40** |

Cause: 102 of 172 products carry `gb_price_per_kit_php`, and on 45 of the
repriced ones it still held the previous kit price. A listing is seeded at that
override, not at the shop price (`seededKitPrice`), so the Sep 9 run's listing
sync correctly moved nothing — the price it was watching had not changed.

## User journeys

1. As the admin, I want the workbook's FINAL PRICE to be what every open Kahati
   counter and Group Buy batch charges, whether the product prices the boards
   through its shop price or through its own group buy price.
2. As the admin, I want the dry run to tell me which board price each row is
   moving from, so I can check the plan against the sheet before applying.
3. As the admin, I want a GTT that is already in the catalog and on both boards
   repriced off the sheet, even though the import rule keeps new GTT rows out.
4. As the admin, I want the workbook's correctly spelt "Tesamorelin (Saltform)"
   and "Cagrilintide (Saltform)" to find the catalog's misspelt products instead
   of coming back unmatched.
5. As a customer, I want the order calculator's per-vial quote and the counter's
   per-vial charge to agree after a repricing.

## Task report

### 1. Plan against both prices (journeys 1, 2)

`PriceableProduct` gains `gbPricePerKitPhp`; a row is *unchanged* only when the
shop price AND the group buy price (when present) already say the sheet figure.
`PriceUpdate` gains `fromGroupBuyPhp`, which the script prints as
`[group buy 7200 -> 7263]`.

- RED: `npx vitest run lib/price-adjustment.test.ts` →
  `is repriced even though its shop price already moved`: `expected [ { row: 2,
  productId: 'vi20', …(2) } ] to deeply equal []`
- GREEN: same command → 34 passed.

### 2. Apply to the override and re-derive the per-vial price (journeys 1, 5)

`applyPriceUpdates` writes `gb_price_per_kit_php = toPhp` when the product
carries one and `gb_price_per_piece_php = round2(toPhp / vialsPerKit)` when it
carries that, then runs the existing listing sync. A product with neither gets
neither.

- RED: `npx vitest run lib/price-adjustment-server.test.ts` →
  `carries the new price onto a counter seeded from the group buy price`:
  `expected 1800 to be 2263`; `keeps the per-vial group buy price in step with
  the kit`: `expected 485 to be 491.3`
- GREEN: same command → 14 passed.

The prior test *"leaves a listing alone when the product prices the board
separately"* encoded the opposite decision and was replaced; the prod data shows
the override is the old price under a second column, not a discount.

### 3. Import-only exclusion (journey 3)

`EXCLUSIONS[].importOnly` marks the GTT rule. The planner consults an
import-only exclusion only for a row that matches nothing.

- RED: `reprices a product the import exclusion would have kept off the
  catalog`: `expected [ { row: 2, name: 'GTT FUAN', …(1) } ] to deeply equal []`
- GREEN: passes; `honours the standing exclusions for a row that matches
  nothing` keeps the import behaviour.

### 4. Saltform aliases (journey 4)

`tesamorelinsaltform → tesamorilinsaltform`, `cagrilintidesaltform →
cagrilentidesaltform` in `lib/pricelist-match.ts`.

- RED: `matches Tesamorelin (Saltform) to the catalog's Tesamorilin`:
  `expected [ Array(2) ] to deeply equal []`
- GREEN: passes; the plain Tesamorelin / Cagrilintide vials stay separate.

### 5. Prod run

```
npx tsx scripts/price-adjustment.ts "…/BBG Price Adjustment-Sep2026 (1).xlsx"          # dry run
  updates 60 / unchanged 75 / unmatched 0 / excluded 0 / ambiguous 0
npx tsx scripts/price-adjustment.ts "…/BBG Price Adjustment-Sep2026 (1).xlsx" --apply
  APPLIED 60 price changes.  open Kahati counters repriced 49  open Group Buy batches repriced 39
```

Plus one targeted `applyPriceUpdates` for the older duplicate Selank (SK10,
product `59ddb4e8…`, 3100 → 3263): 1 counter, 1 batch. After both:

| Surface | Open | At the workbook price | Differ | Not on the sheet |
|---|---|---|---|---|
| Kahati counters | 122 | 107 | 0 | 15 |
| Group Buy batches | 124 | 90 | 0 | 34 |

"Not on the sheet" is pen cartridges, holographic stickers, Brenipatide,
Maritide 5mg, AOD9604, Retatrutide 40mg, KLOW 80mg vial, FUAN GTT1500 (code
GTT1500) and one free-text test batch — the workbook carries no row for them.

Pre-change values are saved in prod at `settings.price_adjustment_rollback_20260910`
(172 products, 122 counters, 124 batches).

## Test specification

| # | What is guaranteed | Test file or command | Test type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | A product whose group buy price still says the old figure is planned for repricing even when its shop price already moved | `lib/price-adjustment.test.ts: is repriced even though its shop price already moved` | unit | PASS | `npx vitest run lib/price-adjustment.test.ts` |
| 2 | A product is left alone only when both prices say the sheet figure | `…: is left alone once both prices say the new figure` | unit | PASS | same |
| 3 | The plan reports the group buy price it moves from | `…: reports the group buy price it is moving from` | unit | PASS | same |
| 4 | A GTT already in the catalog is repriced; a GTT row matching nothing stays excluded | `…: reprices a product the import exclusion would have kept off the catalog`, `…: honours the standing exclusions for a row that matches nothing` | unit | PASS | same |
| 5 | Tesamorelin/Cagrilintide (Saltform) rows match the catalog's misspellings and not the plain vials | `…: matches Tesamorelin (Saltform) …`, `…: matches Cagrilintide (Saltform) …` | unit | PASS | same |
| 6 | Applying moves `gb_price_per_kit_php` to the new figure | `lib/price-adjustment-server.test.ts: moves the product's own group buy price to the new figure` | integration | PASS | `npx vitest run lib/price-adjustment-server.test.ts` |
| 7 | An open counter or batch seeded from the override follows | `…: carries the new price onto a counter/batch seeded from the group buy price` | integration | PASS | same |
| 8 | The explicit per-vial price is re-derived from the new kit | `…: keeps the per-vial group buy price in step with the kit` | integration | PASS | same |
| 9 | A product with no override is given none | `…: gives a product no group buy price it did not already have` | integration | PASS | same |
| 10 | Every open listing on the sheet is at the sheet price in prod | ad-hoc comparison script (above) | prod check | PASS | 0 differ on both boards |

## Coverage and known gaps

- `npx vitest run lib` → 1731 passed, 8 failed. All 8 are in another session's
  uncommitted Kahati vial-cap / campaign MOQ work (`lib/pricing.test.ts`,
  `lib/kahati.test.ts`, `lib/listing-sync-server.test.ts` "never drops the MOQ")
  and predate this run; none touch price adjustment.
- The catalog holds live duplicates the sheet cannot tell apart: two Selank SK10
  products (both now 3263) and two "Retatrutide (Saltform)" 30mg products (spec
  `30` and `30mg`, both 9800). A rerun reports the Retatrutide row as ambiguous
  because the pair now ties on price. Removing the duplicates is a catalog
  decision, not made here.
- Two orphan twins that are neither kahati nor on-hand keep an old group buy
  price (MOTS-c 10mg 3800, Aicar 50mg 3200); they have no listings.
- Seven products have a hand-typed per-vial price that is not kit/vials (for
  example "Tirzepatide (Salt Form) 15 mg" has `gb_vials_per_kit = 4500`); their
  kit price did not change, so this run did not touch them.
- No E2E was added: the change is a script and two pure/server modules with no
  UI surface.

## Merge evidence

- `dd9bdc6` test: reproduce the repricing … (RED: 11 failed | 32 passed)
- `b0985a8` fix: carry a workbook repricing onto the group buy price … (GREEN: 48 passed)

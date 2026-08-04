# TDD evidence — kit_size on the live catalogue

**Branch:** `feat/group-buy-page` · **Date:** 2026-08-05
**Checkpoints:** `e785e28` (parser) → `4c8af0a` (approved list + backfill)
**Source plan:** none. This followed a verification request — "does the weekly report
now have the details we need" — which surfaced two production blockers.

Follows on from [product-totals.tdd.md](./product-totals.tdd.md), whose first two
known gaps this closes.

## What the verification found

The report **code** was complete: 91 tests green across 12 files, and all seven
contract columns present (`#, Product, Variant / Code, Specs, Total USD, Total Qty, Kits`).

Production was a different story:

1. **`products.kit_size` did not exist in the live database.** The weekly route
   selects it (`app/api/admin/report/weekly/route.ts:42`), so the reports page
   returned 500. `0013_product_kit_size.sql` had never been applied anywhere.
2. **`0013`'s backfill was a no-op against the live catalogue.** It keyed on
   price-list codes — `LB10, LB50, CK-LMB, CK-PRF, CK-RSTG, CK-RSTB` — and a
   read-only audit found **0 of 6 present**: those products all carry a `NULL`
   code. Every per-piece product would have sat at the default 10, and the Kits
   column is `qty / kit_size`, so 20 pieces of Botox would have printed as
   **"2 kits"** on the sheet handed to the supplier.

A blanket "per-piece → 1" patch would have been wrong in the other direction:
Juvederm boxes in pairs, Kiara Reju in threes, NCTF135HA in fives.

## User journeys

1. As an admin, I want the Kits column to reflect how the supplier actually sells
   each item, so the batch order I place from it is the right size.
2. As an admin, I want the reports page to load at all in production.
3. As a maintainer, I want a later edit to the parser to fail a test rather than
   silently change what we order.

## Task report

### 1. Derive pack size from spec text — `lib/kit-size.ts`

The catalogue codes almost nothing, but the specs state the pack size. The rule:
in `A x B` the side **without** a unit is the count (`2x1ml` → 2, `2.5mlx10` → 10);
a number written against a unit is a dose, so `15mg vial` stays at the default.

- **RED** — `npx vitest run lib/kit-size.test.ts`
  ```
  Error: Failed to load url ./kit-size … Does the file exist?
  ```
  then, after the first implementation:
  ```
  × treats a spelled-out single syringe as one
    - 1  + 10        ("1 prefilled syringe, 1ml")
    Tests  1 failed | 8 passed (9)
  ```
- **GREEN** — `9 passed`.

### 2. Pin the approved values — `lib/kit-size-catalog.ts`

The parser ran over all 95 live products; the 19 non-default results were reviewed
and signed off. They are stored as data, not as a regex in SQL, because they are
supplier facts a human approved.

- **RED** — `Failed to load url ./kit-size-catalog`.
- **GREEN** — `17 passed` (with `kit-size.test.ts`).
- **Guarantees**: the list is exactly what the parser derives, holds the specific
  signed-off distribution (10×1, 6×2, 1×3, 2×5), and the migration carries an
  UPDATE for every entry at the approved value. Any of those three drifting fails.

### 3. Correct the backfill — `drizzle/0014_product_kit_size_backfill.sql`

Matched on **name**, not id: hard-coded production UUIDs would make the migration
unrunnable locally or in the harness.

## Applying to the live database

`0013` then `0014`, statement by statement, reading the committed SQL:

```
=== drizzle/0013_product_kit_size.sql
  ok   ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "kit_size" integer DEFAU
  ok   UPDATE "products" SET "kit_size" = 1 WHERE "code" IN ('LB10', 'LB50', 'C (0 rows)
=== drizzle/0014_product_kit_size_backfill.sql
  ok   UPDATE … = 1 WHERE "name" IN ( 'Botox Gas', 'Mes  (10 rows)
  ok   UPDATE … = 2 WHERE "name" IN ( 'JUVEDERM Ultra 2   (6 rows)
  ok   UPDATE … = 3 WHERE "name" IN ('Kiara Reju');       (1 rows)
  ok   UPDATE … = 5 WHERE "name" IN ('NCTF135HA', 'NCTF   (2 rows)
```

`0013` matching **0 rows** is the predicted failure, observed in production.

### Post-apply verification (read-only, against live)

```
kit_size distribution: 1:10  2:6  3:1  5:2  10:76      (95 total)
approved products verified in live DB: 19/19
report product join: OK — 56 line items readable
rollup over all live orders: 12 products, 186 units, $802.8
```

The join is the exact query the weekly route runs — the one that was throwing.
`npm run db:check` against live: **`Database matches schema.ts — no drift.`**

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `2x1ml` reads 2 — count is the side without a unit | `lib/kit-size.test.ts:reads the leading number…` | unit | PASS |
| 2 | `2.5mlx10` reads 10 despite the identical shape | `…:reads the trailing number…` | unit | PASS |
| 3 | `50ml x 10 vials` reads 10 with spaces around the x | `…:reads a count separated by spaces…` | unit | PASS |
| 4 | `per piece` reads 1 | `…:treats an explicit "per piece" as one` | unit | PASS |
| 5 | `1 prefilled syringe, 1ml` reads 1 through the adjective | `…:treats a spelled-out single syringe as one` | unit | PASS |
| 6 | `15mg vial` stays at the kit default, not 15 | `…:defaults a plain vial spec to a full kit` | unit | PASS |
| 7 | An unrecognised or empty spec falls back to the kit | `…:defaults an unrecognised or empty spec…` | unit | PASS |
| 8 | Never returns 0 — an Infinity on a supplier order | `…:never returns zero` | unit | PASS |
| 9 | Always returns a whole number | `…:always returns a whole number` | unit | PASS |
| 10 | The approved list covers the 19 reviewed products | `lib/kit-size-catalog.test.ts:covers the 19 products…` | unit | PASS |
| 11 | No approved divisor could corrupt the Kits column | `…:never approves a divisor that would corrupt…` | unit | PASS |
| 12 | Only genuine exceptions are listed, never the default | `…:only lists products that differ from the…` | unit | PASS |
| 13 | The list is exactly what the parser derives | `…:is exactly what the parser derives from each spec` | unit | PASS |
| 14 | The signed-off distribution holds (10/6/1/2) | `…:holds the specific values signed off…` | unit | PASS |
| 15 | The migration has an UPDATE for every approved product | `…:carries an UPDATE for every approved product` | integration | PASS |
| 16 | Each is set to the size approved for it | `…:sets each product to the kit size that was approved` | integration | PASS |
| 17 | The migration touches nothing outside the list | `…:touches nothing outside the approved list` | integration | PASS |

Full suite: `npx vitest run` → **1021 passed across 112 files**. `npx tsc --noEmit` → clean.

## Known gaps

- **The correction is preventive, not yet exercised.** The live rollup reports
  `rows using a corrected divisor: 0` — none of the 19 aesthetics products has
  been ordered yet. The values are verified structurally (19/19 in the database,
  parser and migration pinned) but no real order has flowed through them. The
  first Juvederm or Rejuran order is worth eyeballing on the sheet.
- **Kahati and MOQ lines still report one kit per unit, and now dominate the
  report.** The live rollup's two largest rows are `KLOW 80mg — kahati` at
  **109 units → 109 kits** and 20 → 20. Those are peptide vials, so ~10.9 kits is
  the truthful figure; 109 over-states the batch by 10×. This is the documented
  fallback from `product-totals.tdd.md` (a kahati line references a group buy,
  not a product, so no kit size is reachable) and predates this change — but the
  live data shows it is not an edge case, it is the top of the sheet. Resolving
  it means joining kahati lines back to their underlying product. **Flagged, not
  changed.**
- **`kit_size` for future products.** A per-piece product added tomorrow still
  defaults to 10. The admin product form exposes the field, so it is one edit —
  but nothing warns when the spec and the stored size disagree.
- **`0013`'s dead code-based backfill was left in place** rather than rewritten.
  It is harmless (it matched 0 rows) and rewriting an already-applied migration
  is worse than leaving an honest record of what was tried.

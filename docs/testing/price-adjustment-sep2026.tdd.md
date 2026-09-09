# September 2026 price adjustment — TDD evidence

**Source:** `~/Downloads/BBG Price Adjustment-Sep2026.xlsx`, sheet `FINAL PRICE`
(134 rows: Product | Size / Description | Code | NEW PRICE).

Instruction given: *"update the prices for the products prices, kahati, groupbuy
no onhand seperate entity ung prices ng onhand"*, then, before applying: *"the
order that is already made should not be changed the price we just need to
update is the prices for the next gb and kahati"*.

## User journeys

1. As an admin, September prices land on the kahati/group-buy catalog so the
   NEXT counter opens at the right price.
2. As an admin, on-hand retail prices are untouched — a separate entity.
3. As an admin, a row that cannot be matched confidently is reported, never
   guessed — a wrong price is money.
4. As a customer with an order already placed, my price does not change.

## What had to be verified before writing anything

`price_php` is a KIT price, not per-vial. Confirmed against production before
any change: AICAR 50mg read `price_php` 3600 with `on_hand_kit_php` 4800 and
`on_hand_piece_php` 480, and the workbook offered 3663 — the same scale.
Misreading this would have multiplied or divided every price by ten.

Journey 4 was verified in code, not assumed:

| Claim | Evidence |
|---|---|
| A new counter takes the catalog price | `lib/kahati-seed.ts:34` — `seededKitPrice(p, p.pricePhp)` |
| A placed order is frozen | `order_items.unit_price_php` is a stored snapshot beside `nameSnapshot`/`specSnapshot` |
| A live counter keeps its own price | `app/api/groupbuys/route.ts:53` reads `g.pricePerKitPhp`, never the product |

So the catalog update reaches the next group buy and kahati and nothing already
committed. 63 live counters and 32 open campaigns were running at the time and
were not touched.

## Why codes could not be the key

`lib/pricelist-match.ts:9` states it: the Retatrutide block reuses Tirzepatide's
`BBG1000-**` codes at different prices, so a code lookup returns the wrong
product with full confidence. Production agreed — `SK10` is two products, a
kahati Selank at 3200 and another Selank at 3100. Matching is on name + size
through the existing `findMatches()`.

## Task report

### 1. The planner — `lib/price-adjustment.ts`

Pure. Produces a plan under six headings that account for every row exactly
once, and writes nothing. `PriceUpdate` carries no on-hand field at all, so
there is no shape in which the plan can express a change to `on_hand_*`.

RED (module missing) → GREEN:

```
$ npx vitest run lib/price-adjustment.test.ts
 Test Files  1 failed (1)      ->   Test Files  1 passed (1)
      Tests  no tests                    Tests  10 passed (10)
```

### 2. The script — `scripts/price-adjustment.ts`

Dry run by default; `--apply` writes, and writes only `products.price_php`.

First run against production, nothing applied:

```
Workbook rows: 134   Catalog products: 161
  updates 103 · unchanged 6 · skippedOnHand 4 · ambiguous 9 · unmatched 11 · excluded 1
DRY RUN — nothing was written.
```

### 3. Applied, after the customer-price question was answered

```
APPLIED 103 price changes.
```

Re-run immediately afterwards, confirming idempotence and that the plan is now
satisfied:

```
  updates 0 · unchanged 109 · skippedOnHand 4 · ambiguous 9 · unmatched 11 · excluded 1
```

Spot-checked in production afterwards: Epitalon 50mg moved 8400 → 9563, and the
`on_hand_kit_php` / `on_hand_piece_php` / `on_hand_ten_vial_php` values on
AICAR (4800 / 480), Oxytocin (4800 / 500 / 4800) and Selank (4650 / 500) are
unchanged.

### 4. Whole-suite and type check

```
$ npx tsc --noEmit --pretty false     # exit 0
$ npx vitest run
 Test Files  293 passed (293)
      Tests  3225 passed (3225)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | A matched kahati product is planned at the new price | `lib/price-adjustment.test.ts:plans the new price for a kahati product` | unit | PASS |
| 2 | A product sold only on-hand keeps its price | `…:leaves a product that is only sold on-hand alone` | unit | PASS |
| 3 | The kahati twin is repriced and the on-hand twin is not | `…:reprices the kahati twin and not the on-hand one` | unit | PASS |
| 4 | Two candidates are reported, never guessed | `…:reports an ambiguous row instead of guessing` | unit | PASS |
| 5 | A row matching nothing is reported, not dropped | `…:reports a row that matches nothing rather than dropping it` | unit | PASS |
| 6 | A different size is not treated as a match | `…:does not match a different size of the same product` | unit | PASS |
| 7 | A price already correct is not re-written | `…:leaves a price that is already correct out of the updates` | unit | PASS |
| 8 | Standing exclusions are honoured (FUAN GTT) | `…:honours the standing exclusions` | unit | PASS |
| 9 | Every row is accounted for exactly once | `…:accounts for every row exactly once` | unit | PASS |
| 10 | No update can name an on-hand price column | `…:never proposes a change to an on-hand price column` | unit | PASS |

## Still outstanding — 20 rows not applied

These need a human answer; the script will apply them once the catalog is
unambiguous.

**Ambiguous (9)** — two catalog products match and the sheet does not say which.
The workbook itself lists three of these twice (rows 31/93, 32/129, 36/53):
Rejuran GOLD & SILVER, Aicar 50mg, MOTS-c 10mg ×2, Selank 10mg ×2,
Retatrutide (Saltform) 30mg, Oxytocin 10mg ×2.

**Unmatched (11)** — nothing matches on name + size. Mostly salt-forms and
blends, which either sit under a different name in the catalog or do not exist
yet: Cagrilintide (Saltform) 5mg, SALTFORM-KPV20, GHKcu 100mg + KPV 20mg,
Relaxation PM (RP 226), Lipo C B12 Plus, Tirzepatide 30mg + Cagrilintide 5mg,
Tirzepatide 20mg + Retatrutide 10mg, Tesamorelin (Saltform) 10mg and 5mg,
JUVEDERM Volume, Wolverine (TB500+BPC).

## Known gaps

- **No migration.** `price_php` already existed; only its values changed.
- **The 4 on-hand-only rows** (Skin Repair SM1 ×2, DSIP, L-Carnitine) were
  skipped by design. If the client wants their retail prices moved too, that is
  a separate instruction against the `on_hand_*` columns.
- **The rollback record** is the pre-apply dry run, which lists every
  `from -> to`. It was written to the session scratchpad, not committed —
  reproduce it from git history plus the workbook if it is ever needed.

## Merge evidence

```
(RED)   test: require a reviewable plan before any price is changed
(GREEN) feat: plan a price adjustment without touching a price
        feat: add a dry-run-by-default price adjustment script
```

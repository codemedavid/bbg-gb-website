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

## Second pass — aliases and duplicate resolution

On instruction, two causes were fixed and a further 9 changes applied.

**Four ALIASES** (`lib/pricelist-match.ts`). `baseName` strips a parenthetical
carrying a digit, so "Relaxation PM (RP 226)" lost the code the catalog keeps
inside the product name; same for Lipo C B12 Plus and Wolverine. The fourth is a
plain spelling split — workbook "Cagrilintide", catalog "Cagrilentide".

**Prefer the kahati twin.** Where a row matched a real kahati product and an
orphan (neither kahati nor on-hand, differing only in formatting), the kahati
one is what the sheet means. It settles nothing when both are live kahati or
neither is, and those stay ambiguous.

```
(RED)   test: resolve duplicate catalog rows and four workbook spellings
        Tests  5 failed | 12 passed (17)
(GREEN) fix: match four workbook spellings and prefer the kahati twin
        Tests  22 passed (22); full suite 3232 passed
```

Applied: AICAR 3600→3663, Relaxation PM 6000→6063, Lipo C B12 Plus 4950→5013,
Tirzepatide+Cagrilentide 9000→9063, MOTS-C 3750→3963, Selank 3200→3263,
Wolverine 6300→6363. Re-run afterwards: `updates 0 · unchanged 119`.

Total applied to production across both passes: **112**.

## Third pass — the client's answers

The client answered: SALTFORM-KPV20 is new; JUVEDERM "Volume" is the catalog's
"Voluma"; for a duplicated entry *"Yon higher price po ang inconsider natin"*;
and *"ang wala sa system paki add nalng"*.

**The dearer row wins.** Where the catalog holds one product twice at different
prices, the dearer is the live one — that settles Oxytocin (OXY10 ₱2937.50 vs
OT10 ₱3200). The kahati flag still leads it: a live kahati product beats a
dearer orphan. Where duplicates tie on price AND neither is kahati they are the
same dead listing twice, so BOTH move — updating one would leave its twin
stale, two rows for one product disagreeing about cost. Two tied LIVE products
stay ambiguous, because repricing a real pair off one row should not happen
quietly.

**Two of the three "new" products already existed**, under names the matcher
could not reach:

| Workbook | Catalog held | At |
|---|---|---|
| GHKcu 100mg + KPV 20mg (CUV120) | "GHKcu 100mg + KPV 20mg" | ₱8400 |
| Tirzepatide 20mg + Retatrutide 10mg (TRR30) | same name | ₱7400 |
| SALTFORM-KPV20 | "KPV (SAL**F**ORM)" — typo, code KP20 | ₱6600 |

An INSERT guarded on `code` created a genuine duplicate for the KPV before this
was noticed — the codes differed (KP20 vs SALT-KPV20) so the guard passed. It
was deleted the same minute, after confirming no order line and no counter
referenced it. **A code guard does not catch a name-level duplicate.**

Two catalog names were corrected rather than aliased:
- `CUV120` → "GHK-Cu + KPV" / "120mg vial", its 60mg sibling's convention.
  An alias was rejected here: workbook row 122 is that 60mg sibling under the
  same name, so redirecting the key would have left row 122 unmatched.
- `KP20` → "KPV (SALTFORM)", fixing the SALFORM typo.

```
(RED)   test: resolve a duplicate by the dearer row, per the client
        Tests  4 failed | 20 passed (24)
(RED)   test: require the two remaining new products to match
        Tests  1 failed | 24 passed (25)
(GREEN) fix: match the blends and the saltform KPV to their catalog names
        Tests  30 passed (30)
```

Applied: GHK-Cu + KPV 120mg 8400→8463, Rejuran ×2 2500→2563, Tirzepatide+
Retatrutide 7400→7463, Oxytocin 3200→3263, JUVEDERM Voluma 4000→4063.

## Final state

```
updates 0 · unchanged 127 · skippedOnHand 4 · ambiguous 0 · unmatched 3 · excluded 1
```

**119 prices applied to production** across three passes. Nothing ambiguous
remains.

## Still outstanding — 3 rows, none needing a price change

Cagrilintide (Saltform) 5mg, Tesamorelin (Saltform) 10mg and 5mg are unmatched
only because the catalog misspells them ("CAGRIL**E**NTIDE", "Tesamor**i**lin").
All three already hold the workbook's price — ₱6600, ₱11900, ₱6200 — so nothing
was lost. Fixing those two spellings would make the next run match them; it is a
customer-visible rename and was left for the client.

## Known gaps

- **No migration.** Only column values, two product renames, and one insert that
  was reverted.
- **The 4 on-hand-only rows** (Skin Repair SM1 ×2, DSIP, L-Carnitine) were
  skipped by design.
- **Catalog hygiene.** The orphan rows behind the ambiguity — "Aicar " with a
  trailing space, a second "MOTS-c", a second "Selank", the duplicated Rejuran —
  are neither kahati nor on-hand. Removing them would stop this recurring. Not
  done: it deletes catalog rows and is its own decision.

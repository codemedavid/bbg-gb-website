# TDD evidence — price list import into the group buy catalog

**Task:** extract `~/Downloads/Price list.xlsx` and add its products to the
catalog the Group Buy campaigns draw from, excluding the GTT.

**Source plan:** none. Journeys were derived during this TDD run from the
request; no `*.plan.md` was supplied.

## User journeys

1. As an admin building a Group Buy campaign, I want every product on the
   current price list to appear in the "Included products" picker, so I can run
   a campaign for any of them without hand-adding it first.
2. As an admin, I want the GTT to stay off that picker, because it is sold on
   the MOQ shelf and is not part of the group buy.
3. As a customer, I want the price I see to be the price on the client's
   workbook, so a transcription slip never becomes a mispriced order.

## What the workbook turned out to be

`~/Downloads/Price list.xlsx` (2026-07-30 13:21) is **byte-identical** to the
already-imported `bbg Price list.xlsx` — same SHA-256
`bfd116f9…3d6a7cdb`. Re-running the extractor against the newly named file
reproduced `data/pricelist.json` exactly, changing only the `source` label.
So this task was not a re-extraction of new data; it was finishing an import
that had left 20 priced rows behind.

Sheets: `Pricelist` (97 rows after dedupe), `On Hand` (12), `Catalogue` (empty
apart from its title).

## Task report

### 1. Point the extractor at the workbook it is given

`scripts/extract-pricelist.py` hardcoded `bbg Price list.xlsx`, so it would
have kept reading the older copy. It now takes an optional path argument and
otherwise picks the newest known name in `~/Downloads`, failing loudly if none
is present.

```
$ python3 -m unittest scripts.test_extract_pricelist
Ran 9 tests in 0.002s
OK

$ python3 scripts/extract-pricelist.py "$HOME/Downloads/Price list.xlsx"
Reading /Users/ynadonaire/Downloads/Price list.xlsx
Wrote data/pricelist.json
  pricelist: 97  moq: 2  onHand: 12  warnings: 10
```

Guaranteed: the extractor reads the file it is told to read, and the parsing
regression tests (malformed codes, fused numeric ranges, currency strings)
still hold.

### 2. RED — 20 priced rows never reached the catalog

`lib/db/data/pricelist-coverage.test.ts` asserts every priced `Pricelist` row
maps to a `PRODUCTS` entry. `PRODUCTS` is what `app/admin/campaigns/page.tsx`
lists in its "Included products" picker, so an unimported row is a product no
campaign can offer.

```
$ npx vitest run lib/db/data/pricelist-coverage.test.ts
× imports every priced Pricelist row into the seed catalog
  → expected [ …(20) ] to deeply equal []
+   "Tirzepatide | size=100.0 | code=BBG1000-100 | ₱13437.5 (left row 9)",
+   "Retatrutide | size=30.0 | code=BBG1000-30 | ₱9062.5 (left row 16)",
+   "Retatrutide (Salt Form) | size=15.0 | code=RT15 | ₱5937.5 (left row 18)",
+   … 17 more
 Tests  1 failed | 4 passed (5)
```

Failure cause is the intended one: missing seed data, not a broken harness —
the other four assertions in the same file compiled and passed.

### 3. A collision the drift assertions exposed

The first draft of the test matched rows to products by CAT/Code. Its price
assertions failed in a way that turned out to be a real defect in the source
workbook rather than in the test:

```
"Retatrutide | size=15.0 | code=BBG1000-15 | ₱5625 -> catalog ₱3200"
"Retatrutide | size=30.0 | code=BBG1000-30 | ₱9062.5 -> catalog ₱4850"
```

The workbook reuses Tirzepatide's `BBG1000-**` codes for the Retatrutide line
at different prices, so a code lookup returns the wrong product with full
confidence. Matching is now on **name + size**, never on code, and the catalog
mints `BBG1000-R**` for Retatrutide to keep the two lines apart. Had the test
matched on code, Retatrutide 30mg would have "matched" Tirzepatide 30mg and the
gap would have stayed invisible.

### 4. GREEN — the 20 rows imported

```
$ npx vitest run lib/db/data/
 ✓ lib/db/data/moq-seed.test.ts (4 tests)
 ✓ lib/db/data/catalog.test.ts (8 tests)
 ✓ lib/db/data/pricelist-coverage.test.ts (5 tests)
 Test Files  3 passed (3)   Tests  17 passed (17)

$ npx vitest run
 Test Files  93 passed (93)   Tests  861 passed (861)

$ npx tsc --noEmit
(exit 0)
```

Added to `lib/db/data/catalog.ts`: Tirzepatide 100mg; Retatrutide 30mg;
Retatrutide (Salt Form) 15/20mg; Tesamorelin 10mg; MOTS-C 40mg; Thymosin
Alpha 1 10mg; 5-Amino-1MQ 10/50mg; AICAR 50mg; SLU-PP 5mg; Pinealon 10/20mg;
Oxytocin 10mg; DSIP 10mg; NAD+ 1000mg; AHK-Cu 100mg; L-Carnitine 400mg;
Lipo-C (Focus); Lemon Bottle (China).

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Every priced Pricelist row has a catalog product, so no price-list item is missing from the Group Buy "Included products" picker | `lib/db/data/pricelist-coverage.test.ts:imports every priced Pricelist row into the seed catalog` | unit | PASS |
| 2 | Every imported product carries the workbook's PHP price unchanged | `pricelist-coverage.test.ts:carries the workbook PHP price through unchanged` | unit | PASS |
| 3 | Every imported product carries the workbook's USD price unchanged | `pricelist-coverage.test.ts:carries the workbook USD price through unchanged` | unit | PASS |
| 4 | The FUAN GTT never appears in the group buy catalog | `pricelist-coverage.test.ts:keeps the FUAN GTT out of the group buy catalog` | unit | PASS |
| 5 | The FUAN GTT remains on the MOQ shelf | `pricelist-coverage.test.ts:leaves the FUAN GTT on the MOQ shelf where it already lives` | unit | PASS |
| 6 | No duplicate product codes, every product has a positive price and a real category | `lib/db/data/catalog.test.ts` (4 tests) | unit | PASS |
| 7 | Workbook parsing rejects malformed codes and fused numeric ranges | `scripts/test_extract_pricelist.py` (9 tests) | unit | PASS |

## Deliberate exclusions

Both are encoded in `EXCLUSIONS` in the coverage test, so removing one without
importing its row turns the suite red.

- **FUAN GTT1500** — excluded on the client's instruction. It stays in
  `MOQ_PRODUCTS` (the MOQ shelf) and is asserted absent from `PRODUCTS`. It only
  ever appeared on the `On Hand` sheet, never on `Pricelist`.
- **L Carnitine 5000 (`LC5000`)** — the workbook prices it ₱0. Not imported;
  importing would mean inventing a price.

## Judgement calls worth a second pair of eyes

- **Lemon Bottle (China)** is priced ₱9,500 for 10 vials (its notes column says
  "10 vials") while its neighbours are per-vial. Imported at the workbook figure
  with `spec: '50ml x 10 vials'` rather than silently dividing by ten.
- **SLU-PP** and **AHK-Cu** carry `code: null` — the workbook leaves AHK-Cu's
  code blank and gives SLU-PP `322.0`, which the extractor already flags as
  malformed.
- **Stock levels** on the 20 new rows are seed placeholders in line with their
  siblings, as everywhere else in this file. Prices are not placeholders.

## Known gaps

- The `On Hand` sheet has four rows this import does not cover: Tirzepatide
  (Salt Form/Mounjaro) 10mg and 20mg, listed twice at different prices
  (₱5,200/₱6,800 and ₱6,300/₱8,200 per kit). The block is internally
  inconsistent — its header reads "Retatrutide (Salt Form)" while its rows read
  "Tirzepatide (Salt Form/Mounjaro)" — and neither size appears on the
  `Pricelist` sheet, so there is no list price to attach. Left out pending a
  ruling from the client rather than guessed at.
- Coverage is asserted over the `Pricelist` sheet only. `On Hand` is a pricing
  overlay on products the catalog already carries, not a product source.

## Merge evidence

Checkpoint commits on `main`, in order:

- `bbb5d57` `test:` reproducer added, RED validated (20 rows missing)
- `20c35d0` `feat:` 20 products imported, GREEN validated (861 tests, tsc clean)
- `5124e8b` `refactor:` extractor accepts the workbook path, tests still green

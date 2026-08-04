# TDD evidence — the kahati 10× kit over-count

**Branch:** `feat/group-buy-page` · **Date:** 2026-08-05
**Checkpoints:** `edb4076` (RED) → GREEN in the following commit
**Source plan:** none. Closes the second known gap in
[kit-size-backfill.tdd.md](./kit-size-backfill.tdd.md), which flagged this but
deliberately did not change it.

## The bug

A kahati order line is measured in **vials** and references a group buy, not a
product. The rollup's product join therefore found nothing, kit size resolved to
null, and the builder's documented fallback — one kit per unit — took over. On
the live board that made the two largest rows on the whole sheet read **109 kits
and 20 kits where 10.9 and 2 were the truth**: a 10× *over*-order of the most
ordered item of the week.

The original fallback was reasoned about as avoiding an under-order. On real data
it does the opposite, and it does it to the biggest numbers on the page.

## Why it is fixable now

`group_buys.product_id` exists — added by main's product-level group buy work,
which landed in the same merge. A hatian line can now reach the same kit size a
direct order of that product would use, in one extra hop:

```
order_item -> group_buy -> product.kit_size
```

with the counter's own `total_slots` as the fallback. That column is the hatian's
vial cap, which **is one kit by the feature's own definition**, and it is NOT
NULL — so a hatian always divides by something real, and the one-kit-per-vial
path is gone entirely.

## Scope — the other line kinds were already right

| Line kind | qty is in | Correct divisor | Changed? |
|---|---|---|---|
| direct product | vials | `products.kit_size` | no |
| **kahati** (`group_buy_id`) | **vials** | **counter's product, else vial cap** | **yes** |
| campaign (`moq_campaign_id`) | kits already | 1 | no |
| moq product (`moq_product_id`) | pieces | 1 | no |

A campaign's `moq` and `committed` are both kit counts, so dividing a campaign
line would have *under*-ordered it. That case is pinned as a regression guard.

## RED → GREEN

RED, at the live numbers:

```
× reads 109 vials of a 10-vial-kit product as 10.9 kits, not 109
  → expected 109 to be close to 10.9, received difference is 98.1
× reads 20 vials as 2 kits          → expected 20 to be 2
× falls back to the hatian vial cap → expected 25 to be close to 2.5
× honours a non-standard vial cap   → expected 10 to be 2
  Tests  4 failed | 2 passed (6)
```

The 2 that passed are the per-piece and campaign cases — already correct, and
they stayed correct, which is what makes them a guard rather than noise.

> Two earlier attempts failed on a missing `line_total_php` and on reading
> `body.data.productTotals` instead of `body.data.report.productTotals`. Neither
> counts as RED — a broken fixture is not a reproduced bug — so the setup was
> repaired until the failure was the arithmetic itself.

GREEN: `6 passed`. Full suite **1306 passed across 137 files**, `tsc` clean.

## Verified against live data

The fixed resolution replayed read-only over the production order history:

```
name                                    qty   kits BEFORE -> AFTER
KLOW 80mg — kahati                      109    109 -> 10.9   <== CHANGED
KLOW 80mg — kahati                       20     20 -> 2      <== CHANGED
Tirzepatide + CGL 35mg — kahati           7      7 -> 0.7    <== CHANGED
Tirzepatide 60mg — kahati                 7      7 -> 0.7    <== CHANGED
Retatrutide 20mg — GB test — group buy   12     12 -> 12
Tirzepatide 15mg vial                    11    1.1 -> 1.1
BAC Water 3ml                             9    0.9 -> 0.9

rows changed: 4
total kits before: 162.60
total kits after:   33.90
```

Every changed row is a kahati row. Campaign and direct-product rows are
untouched, which is the guard holding on real data rather than only in fixtures.

**The sheet was asking the supplier for 162.6 kits where 33.9 was the truth.**

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | 109 vials at kit size 10 reads 10.9 kits | `app/api/admin/report/weekly/kahati-kits.test.ts:reads 109 vials…` | integration | PASS |
| 2 | 20 vials reads 2 kits | `…:reads 20 vials as 2 kits` | integration | PASS |
| 3 | A per-piece product stays 1:1 when hatian'd | `…:uses a per-piece product kit size of 1 unchanged` | integration | PASS |
| 4 | A counter naming no product falls back to its vial cap | `…:falls back to the hatian vial cap…` | integration | PASS |
| 5 | A non-standard vial cap is honoured in that fallback | `…:honours a non-standard vial cap in that fallback` | integration | PASS |
| 6 | A campaign line still reads one kit per unit | `…:still reads a campaign line one kit per unit` | integration | PASS |

## Known gaps

- **Kahati rows still group separately from direct orders of the same product.**
  20 vials of TR30 bought directly and 109 via kahati remain two rows (2 kits and
  10.9), not one row of 12.9. The quantities are now each correct and add up, but
  the sheet does not add them for you. Merging them would change the Product
  column's meaning — a kahati row is named `"KLOW 80mg — kahati"` — so it is a UX
  decision, not a data fix. **Not attempted.**
- **No migration and no data change.** This is a read-path fix; the numbers were
  always recoverable from the stored rows. Nothing to apply to production beyond
  deploying the code.
- **The vial-cap fallback assumes a counter is one supplier kit.** True by the
  feature's definition today. An admin who sets a counter to 5 vials meaning
  "half a kit" would report 2 kits for 10 vials, which the tests pin as intended
  behaviour — flagged here in case that convention ever changes.

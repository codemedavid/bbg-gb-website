# Canonical Group Buy Product Totals — TDD Evidence

## Source and user journey

No plan file was supplied. The journey was derived from the two reference
screenshots and the request to produce the clean Batch 6 format:

> As an operations user, I want the Group Buy XLSX to combine Kahati and Group
> Buy batches by catalog product, so the supplier sees one clean Product / Code /
> Specs row with the correct kit quantity and summary totals.

Acceptance guarantees:

- Checkout labels such as `— kahati`, `— group buy (Batch #2)`, and process
  descriptions never become product master data in the export.
- Catalog product id, name, code, spec, kit size, and USD cost drive the rollup.
- Campaign quantities (recorded as kits) normalize to supplier units before
  merging with Kahati quantities (recorded as vials).
- Multiple batches and channels for one variant produce one workbook row.
- The Batch 6 title, order/unit summary, hidden audit columns, and TOTAL row are
  preserved.

## RED / GREEN task report

| Stage | Execution summary | Command | Evidence |
|---|---|---|---|
| RED | Added an API-to-XLSX reproducer containing one linked Kahati line and two campaign batches for `TR30`. | `npx vitest run app/api/admin/report/weekly/product-totals.test.ts app/api/admin/report/weekly/segments.test.ts` | 2 intended failures: three snapshot rows were returned with blank codes, process text, and `$0`; linked Kahati still exported `Retatrutide — kahati`. Checkpoint `38b0fc7`. |
| GREEN | Resolved linked catalog products in a batched query, normalized campaign kits to supplier units, and enriched every linked row with canonical catalog fields. | `npx vitest run app/api/admin/report/weekly/product-totals.test.ts app/api/admin/report/weekly/segments.test.ts app/api/admin/report/weekly/kahati-kits.test.ts` | 23/23 passed. `TR30` exported once as `Tirzepatide / TR30 / 30mg`, 60 supplier units, 6 kits, and `$612`. Checkpoint `f2dbb63`. |
| Regression | Ran all repository tests after the fix. | `npm test -- --reporter=dot --silent` | 178 files passed; 1,845 tests passed; 0 failed. |
| E2E | Created real orders over HTTP against isolated PGlite, generated the production workbook, reopened it, and compared its catalog columns and totals with the live report payload. | `npx tsx scripts/qa/e2e-groupbuy.ts` | 61/61 passed; 8 orders, 6 canonical products, 270 supplier units; no channel/batch labels; XLSX rows matched the API rows. |

## Test specification

| # | What is guaranteed | Test target | Type | Result |
|---|---|---|---|---|
| 1 | Linked Kahati rows use catalog name, code, and spec | `segments.test.ts: keeps on-hand stock out...` | Integration | PASS |
| 2 | Kahati and two campaign batches of one product merge into one canonical row | `product-totals.test.ts: exports one canonical product row...` | Integration | PASS |
| 3 | Campaign kit counts normalize correctly when merged with vial-counted Kahati lines | Same integration test | Integration | PASS |
| 4 | The generated Batch 6 worksheet contains the exact canonical row and report summary | Same integration test, workbook assertions | XLSX integration | PASS |
| 5 | Legacy unlinked Kahati and campaign quantities retain their safe fallbacks | `kahati-kits.test.ts` | Integration | PASS |
| 6 | A real HTTP report and serialized/reopened XLSX contain only catalog columns | `scripts/qa/e2e-groupbuy.ts` | E2E | PASS |

## Coverage and quality gates

Command:

```text
npx vitest run app/api/admin/report/weekly \
  lib/report/product-totals.test.ts \
  lib/report/weekly-xlsx.test.ts \
  lib/report/weekly-xlsx-download.test.ts \
  --coverage \
  --coverage.include=app/api/admin/report/weekly/route.ts \
  --coverage.include=lib/report/product-totals.ts \
  --coverage.include=lib/report/weekly-xlsx.ts
```

Result: 75/75 tests passed. Changed export path coverage was 99.44% statements,
92% branches, 100% functions, and 99.44% lines. `npx tsc --noEmit` also passed.

Known intentional fallback: legacy Kahati counters or campaigns with no valid
catalog product link retain their stored snapshots because no canonical product
exists to substitute. They remain included rather than being silently dropped.

## Merge evidence

- RED checkpoint: `38b0fc7 test(report): reproduce non-canonical group-buy export rows`
- GREEN checkpoint: `f2dbb63 fix(report): export canonical group-buy product totals`

If these commits are later squashed, preserve this RED/GREEN summary in the
merge or pull-request description.

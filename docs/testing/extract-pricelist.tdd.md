# TDD Evidence — extract-pricelist hardening

**Task:** Fix the four correctness findings from `/code-review` on
`scripts/extract-pricelist.py`.
**Branch:** `feat/three-mode-pricing`
**Source plan:** none — journeys derived from the code-review findings during
this TDD run.
**Test suite:** `scripts/test_extract_pricelist.py` (stdlib `unittest`;
worksheets built in-memory with openpyxl).

## Checkpoints

| Stage | Commit | Meaning |
|---|---|---|
| RED | `8a865dd` | 6 new tests fail for the intended reasons; 3 regression guards pass |
| GREEN | `c3f81b0` | all 9 tests pass; extractor output unchanged on real data |

## User journeys (derived from findings)

1. As a data operator, I want a price cell that accidentally contains two
   numbers (a range like `3200-4850`) to be flagged, so a corrupt fused price
   never lands silently in the JSON.
2. As a data operator, I want the two independent column-blocks treated as
   distinct lists, so a coincidental field match across blocks is not merged
   away and duplicate warnings name the right block.
3. As a data operator, I want a MOQ bundle whose price won't parse to be
   reported, so no bundle disappears without a trace.
4. As a data operator, I want a category header with a stray whitespace price
   cell to remain a header, so it isn't emitted as a phantom product.

## Task report

| Finding | Fix summary | Validation command | RED → GREEN |
|---|---|---|---|
| parse_number fuses multi-number cells | Strip only currency/whitespace/commas, then require a single-number full-match | `python3 -m unittest scripts.test_extract_pricelist` | `3200-4850` returned `32004850.0` → now `(None, True)` |
| dedupe key omits block | Add `block` to the dedupe key | same | cross-block identical rows collapsed to 1 → now kept as 2 |
| extract_moq drops bad-price bundles silently | Add `warnings` param; warn + skip on unparseable price | same | `extract_moq(ws, warnings)` raised TypeError → now records a warning |
| has_data counts whitespace-only price | Test cleaned price cells in `has_data` | same | header emitted as product (2 records) → now 1 |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `₱ 5,350.00` still coerces to 5350.0 | `ParseNumber.test_currency_string_still_parses` | unit | PASS |
| 2 | `3,200` thousands separator parses to 3200.0 | `ParseNumber.test_thousands_separator_ok` | unit | PASS |
| 3 | `3200-4850` is malformed, not fused | `ParseNumber.test_range_cell_is_malformed_not_fused` | unit | PASS |
| 4 | `2300 / 3450` is malformed, not fused | `ParseNumber.test_two_numbers_with_slash_is_malformed` | unit | PASS |
| 5 | Cross-block identical rows are both kept | `Dedupe.test_cross_block_identical_fields_are_kept` | unit | PASS |
| 6 | Same-block duplicate dropped, warning cites correct block | `Dedupe.test_same_block_duplicate_is_dropped_and_warned` | unit | PASS |
| 7 | MOQ bundle with unparseable price is warned, not dropped silently | `ExtractMoq.test_unparseable_price_is_warned_not_silently_dropped` | unit | PASS |
| 8 | Valid MOQ bundle still recorded | `ExtractMoq.test_good_bundle_still_recorded` | unit | PASS |
| 9 | Whitespace-only price keeps a header a header | `ExtractBlockHasData.test_whitespace_only_price_does_not_make_header_a_product` | unit | PASS |

## Coverage and known gaps

`coverage.py` is not installed in this environment, so no numeric report was
produced. The four functions changed by the fixes — `parse_number`, `dedupe`,
`extract_moq`, and the `has_data` path in `extract_block` — are each directly
exercised by the tests above. `clean`, `is_header_row`, `extract_on_hand`, and
`main` are exercised end-to-end by running `python3 scripts/extract-pricelist.py`
(output unchanged: 97 pricelist / 2 moq / 12 onHand / 10 warnings) but have no
dedicated unit tests yet — an intentional gap for this bug-fix scope.

## Merge evidence

RED `8a865dd` → GREEN `c3f81b0`. If squashed, preserve: 6 reproducer tests
failed against the original parser for the intended reasons, all 9 pass after
the minimal fixes, and the extractor's real-data output is byte-stable.

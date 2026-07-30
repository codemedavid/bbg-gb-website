# TDD evidence — Campaign Product Quick Edit

**Source plan**: inline `/ecc:plan` run, 2026-07-30 (no `*.plan.md` artifact).
**Status**: partially delivered. The data contract and the modal component are in;
wiring the modal to a campaign form is deferred — see *Collision* below.

## User journeys

1. As an admin, I want to click a product under Included Products and edit its
   group buy terms for this campaign, so that one campaign can carry products on
   different terms.
2. As an admin, I want those terms to start from the product's saved Group Buy
   settings, so that I do not retype the same numbers into every campaign.
3. As an admin, I want a term I leave blank to keep following the product, so
   that editing the catalog does not require re-editing every campaign.

## Collision — why this is partial

While these tests were being written, a second Claude session committed
`25b761b` and `a418ba2`, adding product-level group buy configuration
(`products.is_group_buy`, `gb_price_per_kit_php`, `gb_price_per_piece_php`,
`gb_vials_per_kit`, `gb_min_vials`, `gb_max_vials_per_batch`) and a new admin
surface at `app/admin/group-buy/campaigns/`. That covers journey 2's storage
with a different design — minimums counted in vials, not kits — and its
`drizzle/0012` deprecates `moq_campaigns.price_per_kit_php` and
`per_customer_min`.

Reverted rather than shipped in parallel, to avoid a second set of product
columns:

- `products.group_buy_kit_php` / `group_buy_piece_php` / `group_buy_min_order` /
  `group_buy_max_batch` / `vials_per_kit` and their migration `0014`
- the Group Buy defaults section on `app/admin/products/page.tsx`
- `perCustomerMin` on `moqCampaignSchema`, `CampaignPayload` and the campaign form
- the Included Products rewrite on `app/admin/campaigns/page.tsx`

A commit hygiene failure is recorded here because it cost real cleanup: the RED
checkpoint used `git add -A` and swept the other session's uncommitted working
tree into it. Undone with `git reset --soft a418ba2` plus selective staging;
their files were returned to the working tree untouched.

## Task report

| Task | Command | Result |
|---|---|---|
| Per-product terms on the wire contract | `npx vitest run lib/moq-schemas.test.ts` | RED 9 failed → GREEN 9 passed |
| No regression in campaign routes | `npx vitest run app/api/campaigns/route.test.ts` | 11 passed |
| No regression in the products screen | `npx vitest run app/admin/products/page.test.tsx` | 1 passed |

RED evidence (before implementation), across the four files then in play:

```
 Test Files  4 failed (4)
      Tests  33 failed | 15 passed (48)
```

GREEN evidence (after revert, for what shipped):

```
 Test Files  3 passed (3)
      Tests  21 passed (21)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | An entry with no terms parses unchanged — the product's own settings stand | `lib/moq-schemas.test.ts:accepts an entry with no terms` | unit | PASS |
| 2 | All five terms round-trip on an entry | `lib/moq-schemas.test.ts:accepts the full set of per-campaign terms` | unit | PASS |
| 3 | A negative price per kit is refused | `lib/moq-schemas.test.ts:rejects a negative price per kit` | unit | PASS |
| 4 | A negative price per piece is refused | `lib/moq-schemas.test.ts:rejects a negative price per piece` | unit | PASS |
| 5 | A zero minimum order is refused | `lib/moq-schemas.test.ts:rejects a minimum order of zero` | unit | PASS |
| 6 | A fractional minimum order is refused | `lib/moq-schemas.test.ts:rejects a fractional minimum order` | unit | PASS |
| 7 | A batch size above `MOQ_BATCH_MAX_KITS` is refused | `lib/moq-schemas.test.ts:rejects a batch size above the 10-kit cap` | unit | PASS |
| 8 | A batch size exactly at the cap is accepted | `lib/moq-schemas.test.ts:accepts a batch size exactly at the cap` | unit | PASS |
| 9 | A kit holding no vials is refused | `lib/moq-schemas.test.ts:rejects a kit that holds no vials` | unit | PASS |

## Coverage and known gaps

No coverage run: the repo has no `test:coverage` script, and a full `npm test`
would report against another session's in-flight code.

Untested and deliberately so, because the surface they attach to is being
rebuilt:

- `components/admin/CampaignProductQuickEdit.tsx` — has **no test coverage in
  the repo**. Its behaviour spec (13 cases: seeding, override, blank-inherits,
  remove, validation, checkbox bulk path) is parked at
  `<scratchpad>/quick-edit-behaviour-spec.test.tsx` and must be ported to
  whichever campaign form the modal is wired into.
- `openSuccessor` copying per-product terms into batch #2 — the behaviour holds
  today (it copies `includedProducts` wholesale) but has no regression test.
- Per-product `minOrderQty` / `maxBatchKits` are recorded, not enforced.
  Checkout still counts kits per campaign against `perCustomerMin` and `moq`.

## Next steps

1. Re-seed `draftFor()` in `CampaignProductQuickEdit.tsx` from the other
   session's `gb_*` product columns, converting vials to kits where needed.
2. Wire the modal into `app/admin/group-buy/campaigns/CampaignForm`.
3. Port the parked behaviour spec and run it RED → GREEN.

# TDD evidence — Product-level group buy configuration (client items 2 & 6)

**Source plan**: none. Journeys derived during this TDD run from the client's
written items 2 and 6, which describe the same feature from two sides — item 2
names the section, item 6 lists its fields.

**Branch**: `feat/group-buy-section`
**Commits**: `8b392e6` (RED) → `9aa7692` (GREEN) → `b003304` (refactor)

## User journeys

1. As an admin, I want a product's group buy terms saved on the product, so that
   I state a peptide's price and minimum once instead of retyping them into
   every hatian and every campaign that carries it.
2. As an admin, I want those settings used automatically when the product joins
   a campaign, so that a new batch opens at the agreed terms rather than at the
   shop-wide defaults.
3. As an admin, I want a field I left blank to stay blank, so that "no figure of
   its own" does not become a free kit or a batch nothing fits into.
4. As an admin, I want to be told when a minimum cannot fit the batch I set, so
   that I find out while both numbers are still on screen.
5. As an admin, I want the group buy fields out of the way on ordinary stock, so
   that the catalog form does not read as five fields somebody forgot to fill.

## What was already there, and what was missing

This is the unusual shape of this task and it drove the whole design. The
**columns** existed (`lib/db/schema.ts`, migration `0013`) and the **seeding
rules** existed and were well tested (`lib/pricing.ts`: `groupBuyUnitPrice`,
`kahatiDefaultsFor`, `campaignDefaultsFor`, 85 tests). What did not exist was
anything that ever *wrote* the columns — the only form that saves a product
stopped at the on-hand prices. Every seeded listing therefore fell back to the
global defaults, and the seeding rules were dead code in practice.

So the work is a boundary and a form, not new arithmetic.

## Task report

### Task 1 — reproducers (`8b392e6`)

```
RED: npx vitest run lib/admin-schemas.test.ts app/api/admin/products \
     app/admin/products components/admin/CampaignProductQuickEdit.test.tsx

     ❯ lib/admin-schemas.test.ts                        (12 tests | 7 failed)
     ❯ components/admin/CampaignProductQuickEdit.test.tsx (7 tests | 3 failed)
     ❯ app/admin/products/page.test.tsx                  (7 tests | 6 failed)
     ❯ app/api/admin/products/route.test.ts              (7 tests | 4 failed)

     Test Files  4 failed (4)
          Tests  20 failed | 13 passed (33)
```

Failures were the intended ones: `productSchema` stripped the unknown fields,
the API stored nulls, the form had no section to click, and `draftFor` seeded
every value as `''`.

### Task 2 — the boundary, the API and the form (`9aa7692`)

```
GREEN: same command
       Test Files  4 passed (4)
            Tests  33 passed (33)

       npx vitest run       → Test Files 108 passed (108) / Tests 1032 passed (1032)
       npx tsc --noEmit     → clean (exit 0)
```

Three decisions worth recording:

- **One vocabulary end to end.** The fields are named `gb*` everywhere — column,
  `GroupBuyConfig`, `Product`, schema, form payload. A product row returned by
  the admin API satisfies `GroupBuyConfig` with no adapter, which is what the
  last test in `route.test.ts` asserts by feeding a freshly created row straight
  into `kahatiDefaultsFor`.
- **Null is preserved, never coerced to 0.** For a price, 0 would read as a free
  kit; for a count, as a batch nothing fits in. The fallbacks belong in
  `pricing.ts`, where a listing seeds itself, not in the column.
- **`gbMaxVialsPerBatch` is deliberately uncapped at the boundary.** A hatian
  fills one kit, but a campaign batch holds ten of them — 100 vials of the same
  product. Capping the product at `KAHATI_MAX_VIALS` would make every campaign
  inherit a hatian's ceiling; `kahatiDefaultsFor` already clamps at the point
  where the ceiling actually applies.

**A pre-existing defect fixed along the way.**
`components/admin/CampaignProductQuickEdit.tsx` seeded its draft from five
`Product` fields that existed nowhere in the codebase — `groupBuyKitPhp`,
`groupBuyPiecePhp`, `groupBuyMinOrder`, `groupBuyMaxBatch`, `vialsPerKit`. The
file did not typecheck, and had it been wired up it would have opened every
product blank. It now reads the real column names, and those were the last five
`tsc` errors in the repo.

### Task 3 — refactor: no act() warnings

The two saving tests read `saveMutate.mock.calls` immediately after the click,
but `submit` closes the modal once the mutation resolves, so that `setState` ran
outside the test's `act()` scope and React warned on every run. `savedPayload()`
now awaits the call first.

```
GREEN: npx vitest run app/admin/products
       Tests  7 passed (7)   — and no act() warning
```

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|---|---|---|---|
| 1 | The schema accepts the whole group buy section under the database's own field names | `lib/admin-schemas.test.ts:accepts the whole group buy section` | unit | PASS |
| 2 | An ordinary product carries no group buy terms — absent, not zero | `lib/admin-schemas.test.ts:leaves a product with no group buy terms alone` | unit | PASS |
| 3 | A cleared setting round-trips as null so an admin can undo a price | `…:accepts null for a setting the admin cleared`, `route.test.ts:clears a setting the admin blanked` | unit + integration | PASS |
| 4 | Negative prices, fractional counts and zero counts are rejected at the boundary | `…:rejects a negative group buy price`, `…:rejects a kit that holds no vials`, `…:rejects a minimum or a batch cap below one vial` | unit | PASS |
| 5 | A product may state a batch larger than one hatian holds | `lib/admin-schemas.test.ts:allows a batch cap larger than one hatian holds` | unit | PASS |
| 6 | A PATCH may touch one group buy setting alone | `…:lets a PATCH touch one group buy setting on its own`, `route.test.ts:updates a single group buy setting without disturbing the rest` | unit + integration | PASS |
| 7 | Every setting actually reaches its column, prices included | `app/api/admin/products/route.test.ts:stores every group buy setting the edit form sends` | integration | PASS |
| 8 | Invalid group buy input is rejected with HTTP 400, not stored | `…:refuses a group buy price below zero`, `…:refuses a kit that holds no vials` | integration | PASS |
| 9 | A stored row feeds the seeding rules directly, with no adapter or rename | `…:feeds the saved settings straight into the seeding rules` | integration | PASS |
| 10 | The section stays hidden until the product is offered through group buy | `app/admin/products/page.test.tsx:keeps the group buy settings out of the way…` | unit | PASS |
| 11 | The form sends all five settings under the database's names | `page.test.tsx:sends every group buy setting under the name the database uses` | unit | PASS |
| 12 | A new product starts at a batch of ten vials (the client's default) | `page.test.tsx:starts a new product at a batch of ten vials` | unit | PASS |
| 13 | An existing product's saved terms load back into the fields | `page.test.tsx:loads a product that already has group buy terms` | unit | PASS |
| 14 | A blanked field is sent as null, not zero | `page.test.tsx:clears a blanked setting rather than sending it as zero` | unit | PASS |
| 15 | A minimum larger than the batch is refused while both are on screen | `page.test.tsx:refuses a minimum larger than the batch it has to fit in` | unit | PASS |
| 16 | A newly included product opens at its own saved terms | `components/admin/CampaignProductQuickEdit.test.tsx:opens a newly included product at its own saved settings` | unit | PASS |
| 17 | A term the campaign already agreed outranks the product default | `…QuickEdit.test.tsx:prefers what this campaign already agreed…` | unit | PASS |
| 18 | A term the product never set stays blank, and is dropped from the entry | `…QuickEdit.test.tsx:leaves a field blank…`, `…:drops a cleared field instead of writing zero` | unit | PASS |

## Coverage and known gaps

```
npx vitest run <the four targets> --coverage.provider=v8 \
  --coverage.include='lib/admin-schemas.ts' \
  --coverage.include='app/admin/products/page.tsx' \
  --coverage.include='app/api/admin/products/**' \
  --coverage.include='components/admin/CampaignProductQuickEdit.tsx'

 File                        | % Stmts | % Branch | % Funcs | % Lines
 app/admin/products/page.tsx |   92.61 |    77.94 |   57.69 |   92.61
 app/api/admin/products/…    |   82.60 |    83.33 |  100.00 |   82.60
 app/api/admin/products/[id] |   72.00 |    75.00 |  100.00 |   72.00
 components/admin/…QuickEdit |   48.14 |    96.66 |   87.50 |   48.14
 lib/admin-schemas.ts        |   76.13 |   100.00 |   33.33 |   76.13
```

Full suite: `npx vitest run` → **108 files, 1032 tests, all passing.**
Typecheck: `npx tsc --noEmit` → **clean**, for the first time on this branch.

Every uncovered region is pre-existing code this work did not touch:

- `page.tsx` — the on-hand pricing block and the archive-confirm flow.
- `products/route.ts` — the `GET` list handler; `[id]/route.ts` — `DELETE`.
- `admin-schemas.ts` — `parseMoqProductForm`, which belongs to the MOQ shelf.
- `…QuickEdit.tsx` — the modal's React body. Its exported pure functions
  (`draftFor`, `entryFrom`, `validateDraft`) are covered; the component itself
  is untested because **nothing renders it yet**. Wiring it into the campaign
  form is client item 3, the next cycle.

Intentional gaps and follow-ups:

- **No E2E test.** Covered at the unit and integration layers only. The same gap
  noted in `participants-payments.tdd.md`.
- **`isGroupBuy` is stored but not yet read anywhere.** It is the switch this
  form writes; no campaign or hatian picker filters on it yet. That belongs with
  item 3's product picker.
- **Migration `0013_harsh_mauler.sql` is committed but still not applied** to the
  Supabase database in `.env`. Saving a product from this form will 500 until it
  runs — the tests pass because the PGlite harness migrates from scratch.
  `npm run db:check` diagnoses it.
- The cross-field min/max rule is enforced **in the form only**, not in
  `productSchema`. Adding it there means splitting the schema the way
  `groupBuySchema`/`groupBuyPatchSchema` are split, because `.refine()` has no
  `.partial()`, and a partial PATCH cannot see both halves anyway. The clamp in
  `kahatiDefaultsFor` keeps a bad legacy row safe regardless.

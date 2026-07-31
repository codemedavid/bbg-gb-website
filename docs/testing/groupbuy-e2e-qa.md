# E2E QA — Product Import & Group Buy flow

Full end-to-end pass over the Group Buy system, Phases 1–7. Every result below
was produced by a command in this document; nothing is asserted from reading
code alone.

## Environment

QA runs against an **isolated PGlite database**, never the Supabase in `.env`.

```
DATABASE_URL= PGLITE_PATH=./.pglite-qa STORAGE_DRIVER=local \
JWT_SECRET=qa-secret-do-not-use-in-prod SMTP_HOST= POSTHOG_KEY= \
npx tsx scripts/qa/bootstrap.ts      # applies drizzle/*.sql
npx tsx scripts/seed.ts              # 7 categories, 95 products, 2 users
npx next dev -p 3177                 # same env

npx tsx scripts/qa/audit-products.ts   # Phase 1
npx tsx scripts/qa/e2e-groupbuy.ts     # Phases 2-7 over real HTTP
```

`scripts/qa/bootstrap.ts` applies the migration **files** rather than
`drizzle-kit migrate`, because `drizzle/meta/_journal.json` stops at `0010` —
see Bug 3.

## Baseline

```
$ npx vitest run
 Test Files  108 passed (108)   Tests  1032 passed (1032)
```

## Phase 1 — product import

```
$ npx tsx scripts/qa/audit-products.ts
Price list rows (Pricelist sheet) : 97
  priced + in scope              : 96
  deliberately excluded          : 1  [L Carnitine]
Products in database             : 95

FOUND     : 96
MISSING   : 0
DUPLICATE (a price-list row matching >1 product): 0
DUPLICATE (same name+size rows in the table)    : 0
DUPLICATE (same CAT/Code on >1 product)         : 0
```

No products had to be created and no merge was needed. The one excluded row
(`L Carnitine 5000`, `LC5000`) is priced ₱0 in the workbook; importing it would
mean inventing a price. `FUAN GTT1500` is excluded by the client's instruction
and lives on the MOQ shelf.

Matching is on **name + size, never on CAT/Code** — the workbook reuses
Tirzepatide's `BBG1000-**` codes for the Retatrutide line at different prices,
so a code lookup returns the wrong product with full confidence.

## Phases 2–7 — E2E over HTTP

```
$ npx tsx scripts/qa/e2e-groupbuy.ts
E2E RESULT: 53/53 passed, 0 failed
```

The driver is deliberately **not** a vitest file. The suite calls route handlers
in-process against a fresh in-memory database per file; it cannot catch a defect
that only appears when two checkouts run in sequence against the *same*
persisted database — which is exactly what the packing-fee waiver turns on.

### Phase 4/5 — the packing fee, the core of the request

| Order | Kits | Packing fee | Total |
|---|---|---|---|
| 1st in group buy | 1 | **₱300** | ₱10,700 |
| 2nd in same group buy | 2 | **₱0** | ₱20,800 |
| 3rd in same group buy | 1 | **₱0** | ₱10,400 |
| 1st in a *different* group buy | 1 | **₱300** | ₱10,700 |

Fees observed across the series: `[0, 0, 300]` → exactly one fee, ₱300 total,
4 kits recorded. A resubmitted checkout replayed order `BBG-2451` rather than
charging again.

The waiver is per **series**, not per batch: a batch that fills seals itself and
opens a successor, and to the customer that is one group buy
(`lib/campaign-commitment.ts`).

## Bugs found

### Bug 1 — CRITICAL — production is missing migration 0013

```
$ npm run db:check
Schema drift check FAILED — the database is behind schema.ts.
Missing columns:
  - group_buys.product_id
  - products.is_group_buy
  - products.gb_price_per_kit_php … gb_max_vials_per_batch
```

`GET /api/admin/products` does `select().from(products)`, which names every
column, so **Admin → Product Management currently 500s in production**:

```
PostgresError: column "is_group_buy" does not exist
```

Root cause: `0013_harsh_mauler.sql` was authored but never applied to the
deployed database. Not reproducible locally — the test harness and QA bootstrap
build their schema from `schema.ts`/the migration files, so both always agree.

**Fix: `npm run db:push` against production.** Not applied here — a production
schema change is the owner's call.

### Bug 2 — HIGH — Group Buy campaigns had no admin participants view

Phase 6 asks that an admin can confirm "customer appears only once", "orders
grouped correctly" and "packing fee appears only once". None of that was
visible: `/api/admin/groupbuys/:id/commitments` joins `group_buys`, so a
campaign id returns **200 with zero rows**. `moqCampaignId` was read nowhere in
the admin surface, and the campaign board showed only aggregate `committed/moq`.

RED, before the fix:

```
FAIL [6] admin can list a Group Buy campaign's participants   actual: 404
FAIL [6] the customer appears once for this group buy          actual: 0 rows
FAIL [6] the customer's grouped row shows all their kits       actual: 0 kits
FAIL [6] the grouped row shows exactly one packing fee         actual: ₱0
FAIL [6] the grouped row lists every order under that customer actual: undefined
```

**Fixed.** One row per customer, summing kits across orders and counting each
order's fee once even when it spans two batches. A customer charged a second fee
in the same group buy is flagged (`chargedPackingFeeTwice`) rather than silently
summed away — that is the defect this screen exists to make visible.

GREEN: `53/53`, plus 18 new unit/integration tests.

### Bug 3 — MEDIUM — the migration journal is behind the migration files

`drizzle/meta/_journal.json` ends at `0010_striped_northstar`. `0011_kahati_within_cap.sql`
and `0013_harsh_mauler.sql` exist on disk but are **not in the journal**, and
`0012` is missing entirely. `drizzle-kit migrate` therefore skips them silently;
only `db:push` (diff-based) applies them. This is the mechanism behind Bug 1 and
will cause the next one. Not fixed here — regenerating the journal touches
migration history and should be a deliberate, reviewed change.

## Not defects (expected behaviour, initially mis-asserted by the driver)

- `/api/moq-products` 404s while `moq_page_enabled` is off. Enforced in the
  route, not just the UI, so knowing the URL reveals nothing. Now asserted both
  ways: 404 off, 200 after the admin switches it on.
- `/api/admin/orders` omits `packingFeePhp` — it is a summary list. The fee is
  on the order detail endpoint, which is asserted instead.

## Known limitation, not fixed

A second order in the same group buy is a **separate order row with a ₱0 packing
fee**, not a line appended to the first order. The money is correct — one fee,
verified above — but the request's wording ("added to the customer's existing
Group Buy order/tab") would mean one order holding every commitment. Merging
orders would change what an order *is*: order numbers are handed to customers,
each carries its own proof and status, and a shipped order cannot absorb a new
line. The new participants screen gives the "one tab" view instead. Flagged for
a decision rather than changed unilaterally.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Every priced price-list row exists in Product Management | `scripts/qa/audit-products.ts` | audit | PASS |
| 2 | No duplicate product id, name+spec, or CAT/Code | `audit-products.ts` + E2E Phase 2 | audit/e2e | PASS |
| 3 | The extracted matching rules stay identical to the seed assertion | `lib/db/data/pricelist-coverage.test.ts` (5) | unit | PASS |
| 4 | The campaign selector lists every product exactly once | E2E Phase 2 (4 cases) | e2e | PASS |
| 5 | A campaign is created with all 95 products linked, pricing intact | E2E Phase 3 (5 cases) | e2e | PASS |
| 6 | First order pays exactly one packing fee | E2E Phase 4 | e2e | PASS |
| 7 | Second and third orders in the same group buy pay none | E2E Phase 4 | e2e | PASS |
| 8 | A different group buy still charges its own fee | E2E Phase 4 | e2e | PASS |
| 9 | A resubmitted checkout replays instead of double-charging | E2E Phase 4 | e2e | PASS |
| 10 | Exactly one fee across all orders in a series | E2E Phase 5 (4 cases) | e2e | PASS |
| 11 | Admin sees one row per customer with all kits and one fee | E2E Phase 6 (6 cases) | e2e | PASS |
| 12 | Grouping collapses orders, not customers; spanning orders counted once | `lib/campaign-participants.test.ts` (10) | unit | PASS |
| 13 | The participants route authorises, 404s, groups and flags double charges | `app/api/admin/campaigns/[id]/commitments/route.test.ts` (8) | integration | PASS |
| 14 | Product Mgmt, Group Buy, Kahati, MOQ, Cart, Checkout, Reports, Payment Methods, Settlements, Analytics, Excel source all still respond | E2E Phase 7 (17 cases) | e2e | PASS |

## Final state

```
$ npx tsc --noEmit          # exit 0
$ npx vitest run
 Test Files  110 passed (110)   Tests  1050 passed (1050)
$ npx tsx scripts/qa/e2e-groupbuy.ts
 E2E RESULT: 53/53 passed, 0 failed
```

## Files changed

| File | Why |
|---|---|
| `lib/pricelist-match.ts` | new — matching rules extracted so the audit and the seed test cannot drift |
| `lib/db/data/pricelist-coverage.test.ts` | now imports those rules; behaviour unchanged (5/5 still pass) |
| `lib/campaign-participants.ts` | new — per-customer grouping for a campaign |
| `lib/campaign-participants.test.ts` | new — 10 unit tests |
| `app/api/admin/campaigns/[id]/commitments/route.ts` | new — the participants endpoint (Bug 2) |
| `app/api/admin/campaigns/[id]/commitments/route.test.ts` | new — 8 integration tests |
| `app/admin/group-buy/campaigns/[id]/participants/page.tsx` | new — the admin screen |
| `app/admin/group-buy/campaigns/page.tsx` | "Participants" button on each campaign card |
| `lib/admin-api.ts` | `useCampaignParticipants` + its response type |
| `app/admin/group-buy/isolation.test.ts` | allowlist the new hook, with the reason it is not a hatian crossing |
| `scripts/qa/bootstrap.ts`, `audit-products.ts`, `e2e-groupbuy.ts` | new — the QA harness above |

---

## Production remediation (applied)

### Bug 1 — fixed

`scripts/qa/apply-0013.ts` applied `0013_harsh_mauler.sql` to production.
Written rather than `drizzle-kit push` deliberately: push diffs the whole schema
and decides for itself what to alter, and against a database holding 37 real
orders a catch-up should apply the one missing migration and nothing else. Every
statement is `ADD COLUMN IF NOT EXISTS` / guarded `ADD CONSTRAINT`, in one
transaction.

Pre-flight (`scripts/qa/inspect-prod.ts`) first confirmed none of the 7 columns
existed, that `0011`'s check constraint was already applied (so it must not be
re-added), and that no `group_buys` row would violate the cap.

```
$ npm run db:check
Database matches schema.ts — no drift.
```

### Bug 4 — NEW, HIGH — 20 price-list products were never in production. Fixed.

Only visible once Bug 1 stopped the audit from erroring. Production held **75**
products where the catalog has 95 — missing exactly the 20 rows imported in
`pricelist-catalog-import.tdd.md`.

Root cause: those 20 were added to the **seed catalog**, and the only thing that
applies the seed catalog is `scripts/seed.ts`, which deletes products, orders and
users before inserting. That is unusable against a live database, so the import
could never have reached production. The gap was invisible because every test
builds its database *from* the catalog, so catalog and database always agree
there.

`scripts/qa/import-missing-products.ts` closes it insert-only — no updates, no
deletes, idempotent on name + size. Values come from the reviewed catalog entry
rather than the raw workbook row, so specs read "100mg vial" and not "100.0".

```
$ npx tsx scripts/qa/import-missing-products.ts          # dry run
Missing from the database : 20   Resolved to a catalog entry: 20   Will insert: 20
$ npx tsx scripts/qa/import-missing-products.ts --apply
INSERTED 20 products.

$ npx tsx scripts/qa/audit-products.ts
Products in database : 95
FOUND 96 | MISSING 0 | DUPLICATE 0 / 0 / 0
```

Verified untouched (`scripts/qa/verify-prod.ts`): orders 37, users 10,
group_buys 18, order_items 49 — all unchanged; products 75 → 95; no product left
without a category; prices carry the workbook figures exactly
(Tirzepatide 100mg ₱13,437.50/$215, NAD+ 1000mg ₱4,500/$72).

### Still outstanding

**Bug 3** (`drizzle/meta/_journal.json` stops at `0010`; `0011` and `0013` are
not in it and `0012` is missing) is unfixed. It is the mechanism that produced
Bug 1 and will produce the next one. Regenerating the journal rewrites migration
history and should be its own reviewed change.

`seed.ts` remains destructive-only. Anything the catalog gains from here on has
the same problem Bug 4 had; `import-missing-products.ts` is the safe path for a
live database.

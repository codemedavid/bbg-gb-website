# Boards that never reset, and prices that never followed

Reported 2026-09-10: *"hindi nag rereset ung mga gb list and kahati tapos ung price di updated."*
A new batch had been opened the night before, yet both boards still showed the
previous batch's listings, at the previous batch's prices.

**Source plan** — none. The journeys below were derived during this TDD run from
the production symptom and the code paths behind it.

## What was actually wrong

Three defects, two of which produce the reported symptom.

**1. A cycle left every listing nobody joined completely untouched.**
`rollOpenKahatis` (`lib/kahati-server.ts`) and `rollOpenBatches`
(`lib/moq-batch-server.ts`) skip a listing with no joiners — correctly, in that
there is no batch to end. But "skip" meant *write nothing at all*, and the two
seeders (`lib/kahati-seed-bulk.ts`, `lib/campaign-seed-bulk.ts`) refuse to open a
listing for a product that already carries one. So an empty survivor **blocked
its own replacement** and went on quoting the terms it opened with for as long as
it stayed listed. Since almost no listing is ever joined, "start a new cycle" was
close to a no-op.

**2. The bulk price adjustment never reached the boards.**
`scripts/price-adjustment.ts` wrote `products.price_php` row by row and stopped.
`syncListingsForProduct` — the function that exists precisely to carry a catalog
change out to open listings — had exactly one caller, the single-product admin
PATCH. A workbook applied through the bulk path moved the catalog and left both
boards selling at the old money.

**3. `group_buys_one_open_per_product_idx` is absent in production.**
`group_buys` carries only its primary key, so the kahati seeder's
`onConflictDoNothing` has nothing to bite on and two concurrent board reads can
each open a counter for the same product. Schema drift, not a code defect — see
the repair plan at the bottom.

### The production state that measured it

| Measured on prod, 2026-09-09/10 | |
|---|---|
| Open Kahati counters | 89 — only 26 from the new batch; 63 left over from Aug 12 onward |
| Open Group Buy batches | 32 — 14 of them from Aug 2–27 |
| Counters priced against a catalog that had moved | **34 of 87** product-linked |
| Counters/batches with any joiner | **0** — so a cycle roll changed nothing |
| Products listed twice at two prices | 2 (AOD9604 Pro Max at ₱5,650 *and* ₱5,350; Wolverine twice) |

Worked example: Oxytocin 5mg vial offered at ₱2,000 against a catalog reading
₱2,263. MOTS-C 40mg vial offered at ₱11,562.50 against ₱9,963.

## User journeys

1. As an admin starting a new cycle, I want every listing nobody joined re-read
   from the catalog, so the boards show today's names, prices and caps instead of
   the ones they opened with weeks ago.
2. As an admin applying a price-adjustment workbook, I want the new prices to
   reach the open Group Buy and Kahati listings, so customers are never offered a
   price the catalog no longer says.
3. As an admin, I want a listing customers are committed to left alone by both of
   the above, so nobody's agreed price is rewritten under them.
4. As an admin looking at a board a cycle has just emptied, I want the cycle
   control to be offered and to tell me what it will do, so I am not left with a
   button that hides itself on the one board that needs resetting.

## Task report

### Journey 1 — a cycle re-reads the listings nobody joined

Empty listings are now refreshed **in place**: no successor is minted and no
batch nobody joined is recorded (which is why they were skipped in the first
place), only their terms move. New pure rules `kahatiRefreshPatch` /
`campaignRefreshPatch` in `lib/listing-sync.ts`; guarded writes
`refreshEmptyKahati` / `refreshEmptyCampaign` in `lib/listing-sync-server.ts`,
called from both cycle controls, which now report a `refreshed` count.

- Command: `npx vitest run lib/cycle-refresh.test.ts`
- RED: `expected 2000 to be 2263`, `expected 'Stale Campaign Name' to be 'NAD+ 500mg vial'`, and `expected undefined to be 2` (no `refreshed` field existed) — 12 failed / 1 passed.
- GREEN: `Tests 15 passed (15)`.

Guaranteed: an empty counter's price, name, cap and per-person minimum are
re-derived from its product; the row itself survives (same id, still open, still
empty); a joined counter rolls as before and keeps the price its joiners agreed
to; a free-text listing with no product link is untouched; and a product the
catalog can no longer price is refused wholesale rather than written to ₱0.

### Journey 2 — a repricing reaches the boards

New `lib/price-adjustment-server.ts` `applyPriceUpdates` performs the catalog
write and the listing sync as one operation, one transaction **per product** so
one bad row cannot roll back eighty good ones.
`scripts/price-adjustment.ts` now calls it and reports what moved on each board.

- Command: `npx vitest run lib/price-adjustment-server.test.ts`
- RED: compile-time — `Failed to load url ./price-adjustment-server … Does the file exist?` (the module the fix requires did not exist).
- GREEN: `Tests 8 passed (8)`.

Guaranteed: a planned price lands on the catalog and on the product's open
Kahati counter and Group Buy batch; a listing that is no longer open keeps the
price it closed on; a product carrying its own group buy price is correctly
untouched by a shop-price move; and an empty plan writes nothing.

### Journey 1b — the cycle boundary is the trigger, not a button

The refresh above is reached by the two admin "Start new cycle" buttons. That is
not enough, and the complaint proves it: the 2026-09-09 batch was opened by
moving the **schedule**, nobody pressed anything, and the boards went on serving
August's listings to every customer who loaded them.

So `lib/cycle-boundary-server.ts` `refreshBoardsForNewCycle` runs on the first
board read inside a cycle, riding the same lazy reconciliation as `sweepKahatis`,
`openDueBatches` and the seeders — no cron, nothing that has to stay running. It
is wired into `GET /api/groupbuys` and `GET /api/campaigns`, **before** their
seeders so an existing listing is refreshed and only then is a genuinely new one
opened.

Once per cycle, which needs state: "have I already refreshed this cycle" is not
derivable from the window. A `settings` row holds the cycle's own key, claimed
with a guarded upsert. This is deliberately *not* the "currently open" flag
`lib/schedule.ts` warns against — the value is a cycle key, not a status, so
losing or corrupting it makes a cycle refresh **again** (idempotent) rather than
throwing the storefront open.

- Command: `npx vitest run lib/cycle-boundary-refresh.test.ts`
- RED: compile-time — `Failed to load url ./cycle-boundary-server … Does the file exist?`
- GREEN: `Tests 9 passed (9)`

The two decisive tests load the board through its real route handler and read the
price out of the **response**, because the response is where the customer saw the
stale number.

### Journey 3 — committed listings are left alone

Covered inside both files above rather than as its own module: every refresh
write is guarded on the listing still being `open` **and** still empty
(`claimed_slots = 0` / `committed = 0`), so a checkout landing between the read
and the write makes the UPDATE match nothing.

### Journey 4 — the admin control says what it will do

`app/admin/groupbuys/page.tsx` hid the cycle button entirely when every open
counter was empty, on the reasoning that the server would skip them — the exact
board the fix now acts on. It now shows whenever anything is open, splits the
count into what ends versus what is brought forward, and both dialogs say empty
listings are re-read from product management rather than merely "stay open".

- Command: `npx vitest run app/admin/groupbuys/page.test.tsx app/admin/group-buy/campaigns/roll.test.tsx`
- RED: 2 failed in `page.test.tsx` (control absent, dialog silent), 1 failed in `roll.test.tsx` (dialog silent).
- GREEN: `45 passed (45)` and `10 passed (10)`.

### A bug the coverage pass found

Chasing an uncovered branch in `campaignRefreshPatch` turned up a real defect in
my own composition: `refreshEmptyCampaign` computed each carried product's patch
against the **stored** `included_products`, and each patch returns a whole new
array — so merging them kept only the last product's rename and silently dropped
every earlier one. The array is now threaded through the loop.

- RED: `expected [ { name: 'Reta', … } ] to deeply equal [ … 'Retatrutide' … ]`
- GREEN: `Tests 15 passed (15)`

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | An empty counter is repriced from its product | `lib/cycle-refresh.test.ts:reprices an empty counter from its product` | integration | PASS |
| 2 | The counter row survives — same id, still open, still empty | `lib/cycle-refresh.test.ts:leaves the counter row itself in place` | integration | PASS |
| 3 | A renamed product renames its counter | `lib/cycle-refresh.test.ts:renames an empty counter when the catalog renamed the product` | integration | PASS |
| 4 | Cap and per-person minimum are re-derived | `lib/cycle-refresh.test.ts:reapplies the cap and the per-person minimum` | integration | PASS |
| 5 | The cycle reports how many listings it refreshed | `lib/cycle-refresh.test.ts:reports how many counters it refreshed` | integration | PASS |
| 6 | A listing already matching its product reports no work | `lib/cycle-refresh.test.ts:counts nothing when a counter already matches its product` | integration | PASS |
| 7 | A joined counter rolls, keeping its joiners' price | `lib/cycle-refresh.test.ts:rolls a counter that has vials on it rather than refreshing it` | integration | PASS |
| 8 | A free-text counter with no product link is untouched | `lib/cycle-refresh.test.ts:leaves a counter with no product link alone` | integration | PASS |
| 9 | An unpriceable product never yields a ₱0 listing | `lib/cycle-refresh.test.ts:never writes a price it cannot derive` | integration | PASS |
| 10 | An empty campaign batch is repriced and renamed from its product | `lib/cycle-refresh.test.ts:reprices an empty batch` / `renames an empty batch` | integration | PASS |
| 11 | No successor is minted for an empty batch | `lib/cycle-refresh.test.ts:mints no successor for an empty batch` | integration | PASS |
| 12 | A product's own label inside `included_products` is refreshed | `lib/cycle-refresh.test.ts:relabels the product’s own entry inside included_products` | integration | PASS |
| 13 | A mixed batch is relabelled but neither repriced nor renamed | `lib/cycle-refresh.test.ts:relabels a mixed batch without repricing or renaming it` | integration | PASS |
| 14 | A planned price reaches the catalog | `lib/price-adjustment-server.test.ts:writes the new price to the catalog` | integration | PASS |
| 15 | …and the open Kahati counter | `lib/price-adjustment-server.test.ts:carries the new price onto the product’s open Kahati counter` | integration | PASS |
| 16 | …and the open Group Buy batch | `lib/price-adjustment-server.test.ts:carries the new price onto the product’s open Group Buy batch` | integration | PASS |
| 17 | A closed counter keeps the price it closed on | `lib/price-adjustment-server.test.ts:leaves a counter that is no longer open at the price it closed on` | integration | PASS |
| 18 | A product pricing the board separately is unaffected by a shop-price move | `lib/price-adjustment-server.test.ts:leaves a listing alone when the product prices the board separately` | integration | PASS |
| 19 | The cycle control is offered on an all-empty board | `app/admin/groupbuys/page.test.tsx:offers the control when every open counter is empty` | unit | PASS |
| 20 | The dialog says empty counters are re-read from the catalog | `app/admin/groupbuys/page.test.tsx:says the empty counters will be re-read` + `roll.test.tsx:says batches nobody joined stay open and are re-read` | unit | PASS |
| 21 | The control still hides when nothing is open at all | `app/admin/groupbuys/page.test.tsx:hides the control when every counter has left the board` | unit | PASS |
| 22 | The first board read in a cycle re-reads the empty listings | `lib/cycle-boundary-refresh.test.ts:re-reads the empty counters the first time it runs in a cycle` | integration | PASS |
| 23 | A second read in the same cycle changes nothing, so a mid-cycle admin price survives | `lib/cycle-boundary-refresh.test.ts:does not run twice in the same cycle` | integration | PASS |
| 24 | The next cycle refreshes again | `lib/cycle-boundary-refresh.test.ts:runs again once the next cycle opens` | integration | PASS |
| 25 | A dark board claims no cycle and writes nothing | `lib/cycle-boundary-refresh.test.ts:does nothing while the boards are closed` | integration | PASS |
| 26 | Both boards are covered, not just Kahati | `lib/cycle-boundary-refresh.test.ts:re-reads both boards, not just the counters` | integration | PASS |
| 27 | A joined counter is never repriced by a board read | `lib/cycle-boundary-refresh.test.ts:leaves a joined counter alone` | integration | PASS |
| 28 | **GET /api/groupbuys serves the catalog price on the first read of a cycle** | `lib/cycle-boundary-refresh.test.ts:shows the catalog price on the first read of a new cycle` | e2e (route) | PASS |
| 29 | **GET /api/campaigns does the same** | `lib/cycle-boundary-refresh.test.ts:shows the catalog price on the Group Buy board too` | e2e (route) | PASS |

## Coverage

```
npx vitest run --coverage lib/cycle-refresh.test.ts lib/price-adjustment-server.test.ts \
  lib/listing-sync.test.ts lib/listing-sync-server.test.ts

listing-sync.ts  |   98.44 % Stmts |   89.33 % Branch |   100 % Funcs |   98.44 % Lines
```

Above the 80% floor. The one remaining uncovered pair (`listing-sync.ts:195-196`)
is pre-existing: the `perCustomerMin` clamp in `campaignListingPatch`, on the
*edit* path, untouched by this work.

Whole suite, after the fix: `299 test files, 3314 tests, all passing`.
`npx tsc --noEmit` clean.

## Known gaps

- **Defect 3 is unfixed in code**, because there is nothing to fix in code — the
  index is declared in `lib/db/schema.ts:240` and `drizzle/0013`. Production is
  drifted. It belongs to the repair below.
- **7 open Group Buy batches carry `included_products = []`.** Nothing in the
  catalog speaks for them, so the refresh will never reach them and no sweep will
  ever remove them. They need a human decision — link or cancel. Listed below.
- **The once-per-cycle claim is not truly tested for concurrency.** PGlite
  serialises calls, so `claims the cycle once across repeated calls` would also
  pass a naive read-then-write. Real exclusivity rests on the guarded upsert in
  `claimCycle`, enforced by Postgres and unreachable on the test driver (the
  suite runs PGlite; production runs postgres-js). The test is kept as a guard on
  the contract, not as proof of the mechanism.
- **The first board read of each cycle is slower.** It walks every empty listing
  — on today's prod, 87 counters and 25 batches, one product read and possibly
  one update each. Once per cycle, on a public GET. Acceptable at this size;
  worth batching if the boards grow by an order of magnitude.
- The refresh deliberately overwrites a hand-set price on an **empty** listing.
  That is the chosen semantics of a new cycle ("re-read the terms from the
  catalog") and was confirmed with the client before implementation; a joined
  listing is never touched.

## Production repair — APPLIED 2026-09-10

The client asked for the cycle to be started immediately. The fix was not yet
deployed, so the live "Start new cycle" buttons were still running the old code
and would have done nothing; and this worktree keeps `DATABASE_URL` empty
(embedded PGlite), so `scripts/start-cycle.ts` could not reach production
either. The repricing was therefore applied through the Supabase MCP as SQL
mirroring `kahatiRefreshPatch` / `campaignRefreshPatch`, restricted to the fields
measured as actually drifting.

**Rollback** — the pre-change values are stored in production itself, in
`settings` under the key `cycle_repair_rollback_20260910` (15,113 bytes of JSON:
id, name and price for every empty open listing on both boards). A settings row
is data, not schema, so it does not put the prebuild drift check at risk.

Applied, and verified to zero afterwards:

| | Kahati | Group Buy |
|---|---|---|
| Empty listings in scope | 89 | 25 linked (7 unlinked skipped) |
| Prices corrected | 34 | 21 |
| Names corrected | 1 | 2 |
| `included_products` labels corrected | — | 2 |
| Remaining drift after the run | **0** | **0** |

Spot checks: Oxytocin 5mg vial ₱2,000 → **₱2,263**; MOTS-C 40mg vial ₱11,562.50 →
**₱9,963**; both AOD9604 duplicates now read ₱5,650 and both Wolverine duplicates
₱6,363.

**Deliberately not applied by that SQL:** `moq`, `per_customer_min` and
`arrival_group` on the campaign board, where one row each was drifting. Leaving
them narrows the hand-written write to what the complaint was about; the deployed
code corrects them on the next cycle refresh.

## Remaining production work — NOT APPLIED, for approval

Nothing below has been run against production. All figures are from read-only
queries on 2026-09-10.

### Step 1 — apply the missing unique index (`drizzle/0013`)

```sql
-- Deduplicate first; the index cannot be created while the pairs exist.
-- Both members of both pairs are empty (claimed_slots = 0), so neither drop
-- strands a customer. Keep the older row of each pair, since the refresh will
-- bring its price forward anyway.
UPDATE group_buys SET status = 'cancelled'
WHERE id IN ('6d532393-3151-4800-bcbb-85a63034d794',   -- AOD9604 dup, ₱5,350, 2026-09-02
             '1762702f-3140-4bf9-8996-9e8fdf8c4126');  -- Wolverine dup, 2026-09-02

CREATE UNIQUE INDEX "group_buys_one_open_per_product_idx"
  ON "group_buys" ("product_id") WHERE "status" = 'open';
```

### Step 2 — the repricing happens on its own

With the fix deployed, the **first board read of the next cycle** performs the
repricing with nobody pressing anything. The two "Start new cycle" buttons do the
same thing on demand. Either way, on today's data:

| | Kahati | Group Buy |
|---|---|---|
| Open listings | 87 | 32 |
| Would **roll** (have joiners) | 0 | 0 |
| Would be **repriced** | 34 | 21 |
| Would be **renamed** | 1 | 2 |
| Left alone — no product link | 0 | 7 |
| Left alone — product delisted or switch off | 2 | — |

Net effect on the Kahati board: **+₱2,116 across 34 counters** — the batch-6
adjustment finally landing, mostly small upward corrections.

### Step 3 — decide on the 7 unlinked Group Buy batches

These will never refresh and nothing will ever retire them:

| Name | Listed | Batch # | Created |
|---|---|---|---|
| NAD+ 1000mg | ₱4,700 | 1 | 2026-08-19 |
| Tirzepatide 30mg vial | ₱4,850 | 4 | 2026-09-09 |
| Rejuran GOLD & SILVER (Dual effect serum) | ₱2,500 | 3 | 2026-09-09 |
| Tirzepatide 20mg | ₱4,100 | 3 | 2026-09-09 |
| Bac Water 3ml | ₱475 | 7 | 2026-09-09 |
| Tirzepatide 15mg Vial | ₱3,200 | 6 | 2026-09-09 |
| Tirzepatide 30mg | ₱4,850 | 9 | 2026-09-09 |

Several duplicate a properly-linked campaign of the same name. `openSuccessor`
inherits `included_products`, so an unlinked batch #1 has propagated its missing
link through every successor since — worth a follow-up of its own.

## Checkpoint commits

| Stage | Commit |
|---|---|
| RED | `effd8d2` — `test: reproduce the boards that never reset and the prices that never followed` |
| GREEN | `620ae57` — `fix: reset the boards on a new cycle, and carry a repricing onto them` |
| Refactor / coverage bug | see the commit following `620ae57` |

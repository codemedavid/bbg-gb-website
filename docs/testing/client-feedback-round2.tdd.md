# TDD evidence — client feedback round 2

**Branch:** `feat/kahati-downpayment`
**Date:** 2026-07-20
**Source plan:** produced inline via `/ecc:plan`; journeys derived during this run.

Baseline at start: 28 files / 276 tests green.
Final: **34 files / 329 tests green**, `tsc --noEmit` clean.

---

## The finding that reframed the work

Phase 0 was meant to confirm two prior fixes. Instead it found the app broken at
the database level, which turned out to be the root cause of most of the client's
report.

The connected database was behind migrations `0004`, `0005` and `0006`:

```
[api error] PostgresError: invalid input value for enum group_buy_status: "cancelled"
GET /api/groupbuys 500 in 1516ms
```

Reflected against the live database:

| Declared in `schema.ts` | Present in database |
|---|---|
| `group_buy_status` = open, closed, shipped, completed, **cancelled** | open, closed, shipped, completed |
| `orders.downpayment_php` | missing |
| `orders.courier`, `packed_by`, `total_usd` | missing |
| `order_items.unit_price_usd` | missing |

`drizzle-kit generate` reported "No schema changes" — the migration *files* were
always correct. Only the database was stale.

**All 276 tests were green throughout.** They cannot see this: the pglite harness
builds every table fresh from `schema.ts`, so schema and database agree there by
construction. This is the gap `npm run db:check` now closes.

Applied additively (`IF NOT EXISTS` / `ADD VALUE IF NOT EXISTS`), then verified:

```
$ npm run db:check
Database matches schema.ts — no drift.
```

---

## Task report

### 1 & 2 — Group Buy / MOQ as its own page

The MOQ backend was complete (`GET /api/campaigns`, `POST /api/campaigns/:id/commit`,
admin editor) with **no storefront page**. Built `/groupbuy` with its own card,
commit sheet, copy and nav tab.

- RED: `CampaignCard.test.tsx`, `CommitSheet.test.tsx` — both failed to resolve their component.
- RED: `CommitSheet` then failed 1/9 — the total was hidden until proof was attached, backwards for a pay-first flow.
- GREEN: 11/11 and 9/9.
- Live: real commitment → `/success/BBG-2422`, campaign counter 0 → 1 kit (progress 0.1, remaining 9).

### 3 — Cart clearing

**Not a code bug.** `clear()` was already correct. Verified in-browser with a
3-line mixed cart (2 on-hand + 7-vial kahati):

- → 201, redirect to `/success/BBG-2421`, `localStorage['bbg-cart']` = `{"items":[]}`

The client's symptom was reproduced and explained: when an order **fails**, the
cart correctly keeps its items. Before the migration fix, orders were failing on
the 500s above.

### 4 — Payment method + QR upload

Works locally against the real API: create with QR → 201 with stored `qrUrl`;
PATCH with replacement QR → 200 with a new key; delete → 200. The `/api/files/...`
401 is by design (`requireSession()`) and checkout is behind login.

**Open ops risk:** local `.env` has no `STORAGE_DRIVER`, so uploads resolve to the
`local` driver. If Vercel is likewise missing it, the prior session's code fix is
inert and production QR upload still fails. Unverifiable from here.

### 5 & 6 — Excel export with buyer fields

Two requested fields did not exist as separate data: one `status` conflated
payment with fulfilment state, and `contact` glued phone and email together.

- RED: `weekly-xlsx.test.ts` failed to resolve `./weekly-xlsx` (11 tests).
- RED: `buyer-fields.test.ts` failed 6/8 on missing `phone`/`email`/`paymentStatus`/`orderStatus`.
- RED: `week.test.ts` failed 1/10 on the `.pdf` suffix.
- GREEN: 34/34 across `lib/report/`.
- Live: admin download → `BBG-Week-2026-07-13.xlsx`, correct MIME, PK zip magic, 7333 bytes.
- Live: **every exported cell verified equal to the raw database row** (read directly via SQL, not through the app's query layer).

---

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Drift reports a column the schema declares and the database lacks | `lib/db/drift.test.ts` | unit | PASS |
| 2 | Drift reports a missing enum value | `lib/db/drift.test.ts` | unit | PASS |
| 3 | A spare column the schema dropped is not a deploy blocker | `lib/db/drift.test.ts` | unit | PASS |
| 4 | Reflection covers enums, not just tables (pgEnum is callable) | `lib/db/schema-shape.test.ts` | unit | PASS |
| 5 | Report rows carry name, phone, email, address separately | `lib/report/buyer-fields.test.ts` | unit | PASS |
| 6 | Payment status and order status are distinct fields | `lib/report/buyer-fields.test.ts` | unit | PASS |
| 7 | Cancelled orders report as Refunded, not Paid | `lib/report/buyer-fields.test.ts` | unit | PASS |
| 8 | The workbook opens, with a header row naming every column | `lib/report/weekly-xlsx.test.ts` | integration | PASS |
| 9 | Money is numeric with a currency format, not text | `lib/report/weekly-xlsx.test.ts` | integration | PASS |
| 10 | Totals exclude cancelled orders | `lib/report/weekly-xlsx.test.ts` | integration | PASS |
| 11 | Campaign progress is in kits and may exceed MOQ | `components/CampaignCard.test.tsx` | unit | PASS |
| 12 | A non-open campaign refuses commitments | `components/CampaignCard.test.tsx` | unit | PASS |
| 13 | Commit posts to the campaign endpoint with proof | `components/CommitSheet.test.tsx` | unit | PASS |
| 14 | The campaign's own rejection reason reaches the user | `components/CommitSheet.test.tsx` | unit | PASS |
| 15 | A double-click does not double-commit | `components/CommitSheet.test.tsx` | unit | PASS |

---

---

## Round 2 — code review, then fixes (same branch)

A high-effort review of the four commits above produced 10 findings. Every one of
the three most severe sat in code that had **no test** — the parts that were
test-driven came back clean, the parts verified by eye did not. That correlation
is the main lesson of this run.

| Fix | RED evidence | GREEN |
|---|---|---|
| Group Buy page bounced signed-in users to /login (gated on `user`, ignored `loading`) | "does not bounce a signed-in customer…" failed: spy called with `/login` | 7/7 |
| ExcelJS statically imported despite a comment claiming otherwise; ~22MB in the admin bundle | 4 failures: static import present, no dynamic import, revoke in same tick, anchor not in DOM | 41/41 |
| Object URL revoked in the same tick as `click()` (kills the download in Firefox) | same run as above | 41/41 |
| Drift guard existed but nothing ran it | `check-outcome.test.ts` failed to resolve module (6 tests) | 6/6 + all three exit paths verified live |
| `splitCartIntoOrders` never wired in — mixed carts stacked both packing fees on one order | `split.test.ts` 9/10 failed on missing `body.data.orders` | 368/368 |

### Notable judgement calls

- **The drift gate distinguishes two "cannot confirm" cases.** No `DATABASE_URL`
  skips loudly (exit 0) so a lint-only CI job is not blocked; a *reachable but
  failing* connection is a hard exit 2, because an unknown state must not pass a
  deploy gate. A silent pass here would repeat the "guard that cannot fail" shape
  that already bit once in `schema-shape.ts`.
- **Two kahati-sweep tests changed meaning, and the new behaviour is correct.** A
  failed hatian no longer cancels the customer's separate on-hand order or claws
  back stock they legitimately bought — the old behaviour was compensating for the
  missing split. The restock path is kept for legacy pre-split orders that really
  do mix kinds on one record, with a new test covering it directly.
- **The success page render is not unit-tested.** React 19's `use()` never resolves
  under jsdom (verified: the Suspense fallback persists through `act` flushes), so
  the parsing was extracted to `lib/order-success.ts` and tested there — that is
  where a mistake would actually cost a customer. The rendering itself was verified
  in the browser.

### Coverage movement

`npx vitest run --coverage` — repo-wide statements **38.84% → 41.74%**, branches
77.74% → 79.45%. Still under the 80% target repo-wide because of untouched legacy
surface, but the files this work created now read:

```
100%    lib/order-success.ts, lib/db/check-outcome.ts, lib/report/weekly-xlsx.ts,
        lib/db/drift.ts, lib/db/schema-shape.ts, lib/report/build.ts,
        components/CampaignCard.tsx, components/CommitSheet.tsx, lib/order-modes.ts
94.8%   app/(storefront)/groupbuy/page.tsx   (was 0%)
91.5%   app/api/orders/route.ts
```

## Known gaps

- **`STORAGE_DRIVER` in production is unverified** — see item 4. This is the one
  open item that could still mean a broken feature for the client.
- **The drift gate may skip on Vercel.** `prebuild` runs `db:check`, but if Vercel
  exposes `DATABASE_URL` only at runtime the check skips (loudly) rather than
  failing. Set it in the *build* environment for the gate to actually bite.
- **6 review findings remain unfixed**, all low-risk: CommitSheet blob-URL leak and
  its state-based double-submit guard, stale `weekFilename` JSDoc, the TOTAL row
  sitting inside the sheet's autoFilter range, the bare `catch` in
  `schema-shape.ts`, and the now-dead `contact`/`status` report fields.
- **Copy/data mismatch:** `/kahati` says "Commit at least 1 vial" while seeded
  hatians carry `minVials: 7`. `JoinSheet` clamps correctly so users cannot hit
  the rejection; the copy is misleading, not broken.
- **Test records left in staging:** orders `BBG-2420`, `BBG-2421`, `BBG-2422` and
  campaign "Retatrutide 20mg — GB test" (1 kit committed) were created during
  verification and will appear in reports.
- No E2E suite exists in this repo; live verification was done via driven browser
  and recorded above rather than as committed Playwright specs.

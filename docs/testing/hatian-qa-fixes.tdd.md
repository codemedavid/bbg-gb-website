# TDD Evidence — Hatian (kahati) lifecycle QA fixes (B1–B11)

**Source:** QA audit of the Hatian business rules (scratchpad probes
`kahati-rules.probe.test.ts`, `qa-cancel-release.test.ts`,
`qa-expired-checkout.test.ts`, `qa-concurrency-idempotency.test.ts`), ported
into repo tests. RED commit `a059a77` → GREEN commit `3a564ae`.

## Root causes (diagnosis)

- **B1/B2** The order-cancel branch in
  `app/api/admin/orders/[id]/status/route.ts` released only `moq_campaign` and
  `moq_product` lines — kahati vials stayed claimed and on-hand stock stayed
  drawn after a rejected payment proof.
- **B3/B4** `PATCH /api/admin/groupbuys/[id]` wrote the status blindly:
  cancelling a hatian never released its participants, and closing one below
  the 7-vial minimum stranded live orders on a dead counter.
- **B5** The checkout claim UPDATE never consulted `closesAt`, so an
  expired-but-unswept hatian could still be joined.
- **B6** The auto-close-on-fill in the admin PATCH was gated on
  `b.status === undefined`, but the admin form always sends a status
  (`app/admin/groupbuys/page.tsx`), so an admin fill neither closed the
  counter nor cloned the sibling batch.
- **B7** Neither create nor edit validated `claimedSlots <= totalSlots`.
- **B8** `DELETE` with participant orders bubbled the FK violation as a raw 500.
- **B9** `sweepExpiredKahatis` resolved rows read-then-write, so a checkout
  racing the sweep could be stranded and a just-turned-viable hatian cancelled.
- **B10** No checkout idempotency: a resubmitted checkout created duplicate
  orders and double-claimed vials.
- **B11** `maxQtyFor` returned `Infinity` for kahati lines and `JoinSheet`
  never passed the hatian's remaining vials, so repeated Join taps accumulated
  unbounded; a hatian with fewer vials left than its minimum still offered the
  commit and let the server 400.

## Task report

| Bug | Guarantee | Test (file → name) | RED evidence (excerpt) | GREEN |
|-----|-----------|--------------------|------------------------|-------|
| B1 | Cancelling a kahati order returns its vials to an OPEN hatian, once, and never rewrites a terminal hatian's history | `app/api/admin/orders/[id]/status/kahati-cancel-release.test.ts` → "returns the claimed vials…", "does not release the same vials twice…", "leaves a terminal hatian's historical count untouched" | `AssertionError: expected 3 to be +0` (vials stayed claimed) | PASS |
| B2 | Cancelling restocks on-hand lines (piece and kit) and rolls back soldCount, once | same file → "returns per-piece vials…", "returns a whole kit's worth…", "does not restock twice…" | `AssertionError: expected 17 to be 20` (stock never returned) | PASS |
| B3 | Admin PATCH to `cancelled` cancels every live participant order with a history note, refund email + event, idempotently | `app/api/admin/groupbuys/[id]/lifecycle.test.ts` → "cancels every live participant order", "records why… and emails…", "is idempotent…" | `expected 'proof_review' to be 'cancelled'`; `expected [] to have a length of 1` (no email) | PASS |
| B4 | Admin close below 7 vials becomes a cancellation (row + response say `cancelled`, participants released); close at ≥7 stays a plain close | same file → "persists cancelled, releases the participants…", "keeps a plain close at or above the minimum" | `expected 'closed' to be 'cancelled'` | PASS |
| B5 | Checkout refuses a commit on a hatian whose `closesAt` elapsed, leaves the counter untouched, and says it *closed* (not "N vials left") | `app/api/orders/kahati-expiry.test.ts` → all three | `expected 201 to be 400` (expired hatian joined) | PASS |
| B6 | An admin edit that leaves a hatian open+full closes it and auto-opens exactly one sibling — with or without a status field in the body | `app/api/admin/groupbuys/[id]/lifecycle.test.ts` → both "PATCH auto-close on fill…" tests | `expected [] to have a length of 1` (no sibling); `expected 'open' to be 'closed'` (form fill ignored) | PASS |
| B7 | `claimedSlots` can never exceed `totalSlots` — POST (zod refine, incl. defaulted cap) and PATCH (merged effective row) both 400 | same file → all four "claimedSlots can never exceed totalSlots" tests | `expected 200 to be 400`, `expected 201 to be 400` | PASS |
| B8 | DELETE with participant orders returns a clear 409 pointing at cancellation; an unjoined hatian still deletes | same file → both "DELETE with participant orders" tests | `expected 500 to be 409` (raw FK violation) | PASS |
| B9 | Sweep transitions are guarded conditional UPDATEs: a stale cancel decision (hatian turned viable / already resolved) transitions nothing and releases nobody | `lib/kahati-server.guarded.test.ts` → all four "guarded cancel transition" tests + sweep test | `TypeError: cancelExpiredKahati is not a function` (no guarded transition existed) | PASS |
| B10 | Resubmitting a checkout replays the original orders (same orderNos, no duplicate rows, vials claimed once), split carts keep their several orders per key, DB-level unique `(key, split-index)`; client mints one key per submission and reuses it on retry | `app/api/orders/idempotency.test.ts` → all four; `app/checkout/page.test.tsx` → "sends one idempotency key and reuses it…" | `expected 'BBG-2419' to be 'BBG-2418'` (duplicate order); `expected null to be truthy` (client sent no key) | PASS |
| B11 | Kahati cart lines clamp to the hatian's remaining vials; JoinSheet passes `remaining` and disables the commit with an explanation when `remaining < minVials` | `lib/store/cart.test.ts` → "kahati lines clamp…" (4 tests); `components/JoinSheet.test.tsx` → 3 new tests | `expected 6 to be 5` (accumulated past remaining); `Received element is not disabled` | PASS |

## Implementation notes

- Shared code paths extracted into `lib/kahati-server.ts`: `cancelKahati` /
  `cancelExpiredKahati` (guarded flip + `releaseKahatiOrders`),
  `notifyKahatiCancellations` (emails only after DB work settles) and
  `closeFullKahati` (guarded close + single sibling clone, used by both the
  checkout transaction and the admin edit).
- Schema change for B10: `orders.idempotency_key varchar(100) UNIQUE`
  (`lib/db/schema.ts`, migration `drizzle/0008_wonderful_sumo.sql` via
  `npm run db:generate`; the pglite harness applies it automatically).
- One pre-existing test updated: "does not silently reopen a hatian the admin
  explicitly closed" (`app/api/admin/groupbuys/route.test.ts`) now closes at 7
  vials — below 7 an explicit close is a cancellation by the B4 business rule,
  which the lifecycle tests cover.

## Coverage & known gaps

- Full suite: **594 passed / 67 files** (`npx vitest run`), up from the
  555/62 baseline. `npx tsc --noEmit` clean.
- All new server logic (release branches, guarded transitions, effective-row
  validation, replay path) is exercised by the tests above, including the
  no-key and distinct-key checkout paths.
- PGlite is single-connection, so B9's true race cannot execute in-suite; the
  tests drive `cancelExpiredKahati` with a deliberately stale premise to prove
  the guarded-UPDATE semantics instead.
- **Deferred (by decision, not a gap):** auto-expiry TTL for unpaid
  `proof_review` orders — policy pending, intentionally not implemented.

## Merge evidence

RED commit `a059a77` (reproducers, 31 failing across 8 files) → GREEN commit
`3a564ae` (fixes, suite fully green). If squashed, this report preserves the
RED→GREEN record.

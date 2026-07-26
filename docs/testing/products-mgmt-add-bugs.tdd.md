# Products management — "can't add products" (prod DB drift + two form fixes)

**Source plan:** none — defects investigated from a client report ("can't add products,
both on kahati and gb") via a live QA pass (Chrome DevTools against `next dev` + seeded
local PGlite) plus a read-only prod schema check. Journeys derived during this run.

## Root cause (the actual blocker) — production DB schema drift

The `.env` `DATABASE_URL` points at the **production Supabase**, so both local `npm run dev`
and the live site hit the same prod DB. That DB was **behind `schema.ts`**:

```
$ npm run db:check
Schema drift check FAILED — the database is behind schema.ts.
Missing columns:
  - orders.idempotency_key        # migration 0008, never applied to prod
```

The checkout page always sends an `idempotencyKey` (`app/checkout/page.tsx:75-76`); the order
route both **selects** (`findReplayedCheckout`, `app/api/orders/route.ts:73,384`) and
**inserts** (`route.ts:306`) `orders.idempotency_key`. With the column absent, Postgres
errored and the handler returned a generic `500 "Something went wrong."` → **no order of any
kind (kahati commit, group-buy commit, on-hand) could complete** in production.

**Fix (applied via Supabase MCP `apply_migration`, additive/non-destructive):**

```sql
ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key varchar(100);
ALTER TABLE orders ADD CONSTRAINT orders_idempotency_key_unique UNIQUE (idempotency_key);
```

**Verified:** column + unique constraint present; `npm run db:check` → *"Database matches
schema.ts — no drift."* No code change required. Not a TDD unit (a live DB migration); proof
is the drift check output before/after.

## User journeys (the two code fixes)

* As an admin, I want to add a catalog product without being forced to type a Spec, so that
  items with no meaningful spec (aesthetics "per piece", botulinum toxins) can be listed.
* As an admin, I want to set a closing date when I create a kahati, so the storefront shows a
  real countdown and the expiry/auto-cancel sweep can run (instead of "closes —").

## Task report

### 1. Product `spec` is optional

* **RED** (`1348151`): `lib/admin-schemas.test.ts` — `productSchema.parse({name,pricePhp})`
  and `{spec:''}` threw `ZodError: spec … at least 1 character(s)` (2 failing).
* **Fix** (`5af181c`): `productSchema.spec` → `z.string().max(120).optional()`; create route
  inserts `spec: b.spec ?? ''` so the `NOT NULL` column stays satisfied.
* **GREEN:** `npx vitest run lib/admin-schemas.test.ts` → 4/4 passing.

### 2. Admin can set a kahati closing date

* **RED** (`1348151`): `app/admin/groupbuys/page.test.tsx` — `getByLabelText(/closes at/i)`
  threw (no such field); the create payload had no `closesAt`.
* **Fix** (`5af181c`): `GroupBuyForm` adds a `datetime-local` "Closes at" field
  (`aria-label="Closes at"`), `blank()` seeds `closesAt: null`, and `submit()` sends
  `closesAt: f.closesAt ?? null` (ISO). The `groupBuySchema` and POST route already accepted
  `closesAt` — only the form omitted it.
* **GREEN:** `npx vitest run app/admin/groupbuys/page.test.tsx` → 3/3 passing.

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|--------------------|-----------|------|--------|
| 1 | A product parses with `spec` omitted entirely | `lib/admin-schemas.test.ts` | unit | PASS |
| 2 | A product parses with an empty-string `spec` | `lib/admin-schemas.test.ts` | unit | PASS |
| 3 | `name` (>= 2) and non-negative `pricePhp` are still enforced | `lib/admin-schemas.test.ts` | unit | PASS |
| 4 | The new-hatian form sends the chosen `closesAt` in the save payload | `app/admin/groupbuys/page.test.tsx` | component | PASS |
| 5 | (regression) rejected group-buy/product saves still surface inline; success still closes the modal | `app/admin/{groupbuys,products}/page.test.tsx` | component | PASS |

## Verification

* Targeted: `npx vitest run lib/admin-schemas.test.ts app/admin/groupbuys/page.test.tsx
  app/admin/products/page.test.tsx` → **8/8 passing**.
* Full suite: `npx vitest run` → **73 files, 623/623 passing**.
* `npx tsc --noEmit` → clean.
* Prod schema: `npm run db:check` → no drift.

## Known gaps / deferred

* Live browser re-QA of the two form fixes was not re-run this session (dev server was on the
  isolated local PGlite); behavior is covered by the unit/component tests above. The prod
  migration was verified by the read-only drift check, not by a write-QA order on prod (per
  the project rule against QA writes on the prod Supabase).
* Deploys should run `npm run db:check` / apply pending migrations so this drift cannot recur.

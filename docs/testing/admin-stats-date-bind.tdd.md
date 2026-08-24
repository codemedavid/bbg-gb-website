# Admin dashboard 500 — Date bound as a raw query parameter

## Source

No plan file. Reported as "the admin dashboard is not loading", with two
`Failed to load resource: the server responded with a status of 500` lines in the
browser console on <https://www.bbgph.org/admin>.

## Symptom

`GET /api/admin/stats` answered **500** on production, deterministically, in
~500–700 ms. Every other admin endpoint answered 200:

| Endpoint | Prod |
| --- | --- |
| `/api/admin/stats` | **500** |
| `/api/admin/orders`, `/products`, `/accounts`, `/groupbuys`, `/moq-products`, `/payment-methods`, `/settings`, `/settlements`, `/categories`, `/report/weekly` | 200 |

The whole local suite was green and every local route answered 200, because the
dev fallback runs on pglite.

## Ruled out first

- **Schema drift.** `declaredShape()` from `schema.ts` was diffed against the live
  `information_schema` — every table, column and enum matched. The guard added in
  `admin-dashboard-drift-error.tdd.md` would also have answered 503, not 500.
- **A failing query.** Each statement `dashboardStats()` issues was rendered with
  `.toSQL()` and run verbatim against the production database. All returned rows.
- **The database itself.** `postgres_logs` held no `ERROR`/`FATAL` over 24 h, and
  `supavisor_logs` showed only routine `Connection authenticated` — no pool
  exhaustion, no rejected client.

That combination — valid SQL, no database error, a fast and deterministic 500 —
placed the fault in the driver layer, between drizzle and the wire.

## Root cause

`packingFeeTotals()` interpolated JS `Date` values straight into a raw `sql`
template:

```ts
sql`coalesce(sum(case when ${createdAt} >= ${weekStart} then ${fee} else 0 end), 0)::float`
```

`${weekStart}` becomes a bound parameter carrying no type. drizzle's comparison
helpers (`gte(orders.createdAt, date)`) map a `Date` through the column they are
compared against; a `Date` dropped into a `sql` fragment has no column to be
mapped through. postgres-js — the driver behind every real deployment — then
throws while encoding the Bind message:

```
TypeError: The "string" argument must be of type string or an instance of
Buffer or ArrayBuffer. Received an instance of Date
    at Bind (postgres/src/connection.js:954)
```

pglite accepts a `Date` in that position, so the failure could only ever appear
in production. This is the same blind spot `lib/db/drift.ts` was written for: the
harness builds its database from `schema.ts` with a different driver, so neither
the schema nor the driver behaviour of a deployment is exercised by any test.

`orderTotals()`, `weeklySummary()` and `fastMovingItems()` were unaffected —
they pass their boundaries through `gte(...)`.

## Task report

### RED — a Date reaches the driver as a bound parameter

- Lifted `feeColumns` to module scope, taking its two boundaries as arguments,
  so the query it builds can be inspected without a connection.
- Added `lib/analytics.test.ts`, rendering the aggregate through a postgres-js
  drizzle instance and asserting no bound parameter is a `Date`.
- Command: `npx vitest run lib/analytics.test.ts`
- Result: **RED**, 1 failed — `expected true to be false`, a `Date` in `params`.

### GREEN — bind ISO strings with an explicit cast

- `feeColumns` now binds `weekStart.toISOString()` / `monthStart.toISOString()`
  against `::timestamptz`, matching the `withTimezone: true` columns compared.
- Command: `npx vitest run lib/analytics.test.ts`
- Result: **GREEN**, 1 passed.

### Verification against the production database

- Ran `dashboardStats()` locally with `DATABASE_URL` pointed at the production
  Supabase pooler — the same postgres-js path the deployment uses. Read-only.
- Result: **PASS**. `packingFees {"week":9400,"month":31300,"all":31300}`,
  which reconciles with the figures computed by hand from the two tables
  (orders 24 850 + settlements 6 450 = 31 300); `totals.all` 209 orders /
  ₱1 239 991.25; 7 weekly rows; 8 fast-moving rows; 24 pending proofs.

### Regression

- Command: `npx vitest run` — **2334 passed**, 13 failed.
- All 13 failures are in `app/api/admin/payment-methods/purpose.test.ts`, an
  untracked RED-phase file from a concurrent session for a `purpose` argument
  that does not exist yet. It is also the sole `tsc --noEmit` error
  (`TS2554: Expected 0 arguments, but got 1`). Unrelated to this change and
  left untouched.

## Follow-ups this change does not cover

- The fix is **not deployed**. Production still answers 500 until it ships.
- Prod collapses every unexpected error to `Something went wrong.`; the
  `describeDbProblem` 503 path on this branch is not on `main` yet. Shipping it
  would have named this failure at the point it happened.
- `admin@bbgpeptides.ph` / `password123` — the seed credentials in
  `scripts/seed.ts` — authenticate against production admin today. Rotating them
  was already flagged as an open follow-up in
  `login-demo-credentials.tdd.md`; it is now confirmed live.
- All 17 public tables have RLS disabled.
- `bbgpeptides.ph`, referenced throughout the repo, has lapsed and now serves a
  ParkLogic "available to be registered" page.

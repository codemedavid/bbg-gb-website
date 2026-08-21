# Admin dashboard: schema drift must name itself

TDD evidence report. Branch `feat/group-buy-page`.

## Source plan

No `*.plan.md`. Journeys were derived during this TDD run, from a live incident:
the admin dashboard rendered

```
Could not load the dashboard
Something went wrong.
Try again
```

Diagnosis took a full session. The cause was `products.on_hand_ten_vial_php`
declared in `lib/db/schema.ts` but absent from the database, and
`lib/api-response.ts:22` collapsed the resulting Postgres error into a bare 500
that named neither the column nor the remedy.

Precedent: `lib/storage.ts` already does this for a misconfigured storage driver.
Its test file opens by describing the same symptom — "a bare 500 'Something went
wrong.' — giving no hint that an env var was missing."

## User journeys

1. As an admin, when a page fails because the database is behind `schema.ts`, I
   want the error to name the missing column and the command that repairs it, so
   I can fix it myself instead of filing a bug.
2. As an operator, I want a missing *table* reported as clearly as a missing
   column, because a half-applied migration produces both.
3. As an admin, when a request fails for any other reason, I want the generic
   message preserved, so internal failures do not leak to customers.

## Task report

### 1. Recognise schema drift (`lib/db/db-error.ts`)

`describeDbProblem(err)` returns a remedy message for SQLSTATE `42703`
(undefined column) and `42P01` (undefined table), and `null` for everything else.

Error shapes were captured empirically from PGlite before any test was written,
rather than assumed:

```
{"q":"select nope from t","code":"42703","message":"column \"nope\" does not exist"}
{"q":"select * from missing_table","code":"42P01","message":"relation \"missing_table\" does not exist"}
```

- **Validation command:** `npx vitest run lib/db/db-error.test.ts`
- **RED:** `lib/db/db-error.test.ts (0 test)` —
  `Error: Failed to load url ./db-error`. Compile-time RED: the test newly
  references the missing implementation.
- **GREEN:** `lib/db/db-error.test.ts (8 tests) 3ms` — all passing.
- **Guarantees:** drift is named with its identifier and remedy; a unique
  violation, a plain `Error`, and non-error values are all correctly rejected as
  *not* drift.

### 2. Surface it from the route wrapper (`lib/api-response.ts`)

`handler()` consults `describeDbProblem` before falling back to the generic 500.
Drift answers **503**, matching `lib/storage.ts`: the deployment is
misconfigured, not the request, and the call succeeds unchanged once repaired.
The real error is still `console.error`-logged either way.

- **Validation command:** `npx vitest run lib/api-response.test.ts`
- **RED:**
  ```
  x answers schema drift with the missing column instead of a bare 500
    -> expected 'Something went wrong.' not to be 'Something went wrong.'
  x answers a missing table the same way
    -> expected 500 to be 503
  ```
  5 sibling tests passed in the same run, confirming the failure was the intended
  business-logic gap and not broken setup.
- **GREEN:** `lib/api-response.test.ts (7 tests) 10ms` — all passing.

### 3. Prove it against a real drifted database

`lib/api-response.test.ts` builds the `42703` error by hand, so it could pass on
an error shape drizzle and PGlite never produce.
`app/api/admin/products/drift.test.ts` drops the column the route selects and
lets the driver raise the error itself.

- **Validation command:** `npx vitest run app/api/admin/products/drift.test.ts`
- **Mutation check:** against the pre-fix `lib/api-response.ts` (commit
  `492686f`) the test fails with the original symptom —
  `expected 'Something went wrong.' not to be 'Something went wrong.'` — and
  passes with the fix in place. The test genuinely catches the regression.
- **Isolation defect found and fixed:** the first draft leaked. `resetDb()`
  truncates rows but does not rebuild the schema, and `migrateOnce()` is a no-op
  after the first call, so the dropped column persisted into the next test
  (`expected 200, received 503`). An `afterEach` now re-adds it. Caught by the
  sibling test asserting a healthy 200, not by ordering luck.

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|--------------------|-----------|------|--------|
| 1 | A missing column is reported with its name | `lib/db/db-error.test.ts:names the missing column…` | unit | PASS |
| 2 | A missing table is reported with its name | `lib/db/db-error.test.ts:names the missing table…` | unit | PASS |
| 3 | The message blames `schema.ts`, not the request | `lib/db/db-error.test.ts:says the database is behind schema.ts…` | unit | PASS |
| 4 | The repair command is named, not remembered | `lib/db/db-error.test.ts:names the command that repairs it…` | unit | PASS |
| 5 | A driver with no message still explains itself | `lib/db/db-error.test.ts:still explains itself…` | unit | PASS |
| 6 | A unique violation is not mistaken for drift | `lib/db/db-error.test.ts:ignores a unique-violation…` | unit | PASS |
| 7 | Plain errors and non-errors are not drift | `lib/db/db-error.test.ts:ignores a plain application error` / `ignores values that are not errors at all` | unit | PASS |
| 8 | Drift answers 503 naming the column and `db:push` | `lib/api-response.test.ts:answers schema drift…` | unit | PASS |
| 9 | A missing table answers 503 the same way | `lib/api-response.test.ts:answers a missing table the same way` | unit | PASS |
| 10 | Unexpected failures still hide behind the generic 500 | `lib/api-response.test.ts:still hides an unexpected failure…` | unit | PASS |
| 11 | The real error is logged even when drift is answered | `lib/api-response.test.ts:logs the real error…` | unit | PASS |
| 12 | `ok`, `ApiError`, and `ZodError` paths are unchanged | `lib/api-response.test.ts` (3 tests) | unit | PASS |
| 13 | A really-drifted database answers 503 through a real route | `app/api/admin/products/drift.test.ts:names the missing column…` | integration | PASS |
| 14 | A healthy database still answers 200 | `app/api/admin/products/drift.test.ts:answers normally once the column is there` | integration | PASS |

## Coverage

```
npx vitest run lib/db/db-error.test.ts lib/api-response.test.ts --coverage \
  --coverage.include='lib/db/db-error.ts' --coverage.include='lib/api-response.ts'

File              | % Stmts | % Branch | % Funcs | % Lines
------------------|---------|----------|---------|--------
 api-response.ts  |     100 |      100 |     100 |     100
 db-error.ts      |     100 |      100 |     100 |     100
```

100% on both changed files, against the project's 80% floor.

Full suite: **2269 passed, 1 failed** — `lib/db/kahati-packing-backfill.test.ts`
timed out at 30s under parallel load. Pre-existing flake, not a regression: it
imports neither changed module and passes in 1.6s in isolation. This is the
contention `vitest.config.ts` already documents in its `hookTimeout` comment.

Typecheck: `npx tsc --noEmit` — exit 0.

## Known gaps

- **No E2E test.** The browser hop is covered by reading plus existing tests:
  `lib/api-client.ts:parse` throws `new Error(body.error)`, and
  `app/admin/page.tsx:26` renders `error.message`, so the server string reaches
  the admin verbatim. `lib/admin-api.errors.test.tsx` already covers that
  propagation for mutations. A Playwright test asserting the drift text on a
  rendered dashboard would close this.
- **Scope is deliberately narrow.** Only `42703`/`42P01` qualify. A dropped
  connection or a constraint violation still answers the generic 500 — sending
  an operator to run migrations over those would waste the outage.
- **Schema names now appear in an error body.** `handler()` wraps public routes
  too, so a drifted deploy could show a column name to a customer. Judged worth
  it: these are our own identifiers, not secrets, and the alternative is an
  undiagnosable outage.
- **Not addressed here:** the duplicate-dev-server condition that also produced
  this symptom (two `next dev` processes sharing the single-writer
  `./.pglite`). Offered as a separate cycle and not selected.

## Merge evidence

If these commits are squashed, preserve:

- `492686f` — **RED.** Compile-time RED on `db-error.test.ts` (module absent);
  runtime RED on 2 of 7 `api-response.test.ts` assertions.
- `972cf13` — **GREEN.** 15/15 on the same target; full suite 2269 passed.
- `7d65438` — **Integration + mutation check.** Fails against pre-fix
  `api-response.ts`, passes with it.
- No refactor commit: the implementation is two small pure functions and needed
  no cleanup.

# PGlite single-writer guard

TDD evidence report. Branch `feat/group-buy-page`. Second cycle of the pair
started in [admin-dashboard-drift-error.tdd.md](./admin-dashboard-drift-error.tdd.md).

## Source plan

No `*.plan.md`. Journeys derived from the same incident as the first cycle.

Two `next dev` servers were running from this worktree (`:3000` and `:3011`),
both opening the single-writer PGlite database at `./.pglite`. They diverged:
after a migration was applied, `:3011` answered the admin product list with 200
while `:3000` answered 500 on the identical query, then degraded to 404s. Because
`lib/api-response.ts` masked the cause, it read as an application bug.

PGlite ships a `postmaster.pid`, but it records `-42` — a placeholder from the
WASM build, not an OS pid — so it cannot identify the owner. Verified directly:

```
$ cat .pglite/postmaster.pid
-42
/tmp/pglite/base
```

Hence an explicit lock.

## User journeys

1. As a developer, when I start a second dev server in a worktree that already
   has one, I want it to fail immediately naming the process that holds the
   database, so I do not spend a session chasing phantom 500s.
2. As a developer, when a previous server exited without cleaning up, I want the
   stale lock taken over, so a ghost never blocks me.
3. As the test suite, I want in-memory databases exempt, so per-file instances
   never lock against each other.

## Task report

### 1. Lock policy and claim (`lib/db/pglite-lock.ts`)

`describeLockConflict` is the pure policy; `claimPgliteLock` does the IO.

- **Validation command:** `npx vitest run lib/db/pglite-lock.test.ts`
- **RED:** `lib/db/pglite-lock.test.ts (0 test)` —
  `Error: Failed to load url ./pglite-lock`. Compile-time RED.
- **GREEN:** `lib/db/pglite-lock.test.ts (12 tests) 10ms`.
- **Refactor:** `claimPgliteLock` read the lock file twice — duplication, and a
  TOCTOU window where liveness could be reported for a pid that was never
  tested. Collapsed to a single read while green.

The foreign-owner test uses `process.ppid` (genuinely alive, genuinely not us)
and the stale-owner test uses pid `999999`, so neither mocks `process.kill`.

### 2. Wire it into `getDb()` (`lib/db/index.ts`)

The claim runs in the PGlite branch only; the Supabase branch is untouched.

### 3. The guard's own message was being swallowed

Found by running it for real rather than by a test. With the guard wired in, a
second server on `:3012` correctly refused — but the HTTP response was:

```
HTTP 500
{"success":false,"data":null,"error":"Something went wrong."}
```

The reason appeared only in the server log. The guard built to remove a dead end
had been swallowed by the same catch-all that created it.

`lib/session.ts` imports `next/headers`, so `ApiError` was not available here —
`lib/db` is loaded by scripts that never run inside a request. The refusal
instead carries `code: PGLITE_LOCKED`, which `describeDbProblem` (cycle 1)
passes through verbatim.

- **RED:** `lib/db/db-error.test.ts` — 1 failed, 8 passed;
  `passes the PGlite single-writer refusal through verbatim`.
- **GREEN:** 9 passed.
- **End-to-end re-verification**, second server on `:3012` while `:3000` held it:

```
HTTP 503
{"success":false,"data":null,"error":"Another process (PID 66239) already has
 this PGlite database open. PGlite is single-writer: a second reader gets its
 own stale copy, so the two would silently disagree. Stop the other server
 (kill 66239), or give this one its own database with PGLITE_PATH=..."}
```

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|--------------------|-----------|------|--------|
| 1 | An unclaimed directory is allowed | `pglite-lock.test.ts:allows a directory nobody has claimed` | unit | PASS |
| 2 | A process may re-open its own database | `pglite-lock.test.ts:allows this process to re-open its own database` | unit | PASS |
| 3 | A lock whose owner exited is taken over | `pglite-lock.test.ts:allows taking over a lock whose owner has exited` | unit | PASS |
| 4 | A live foreign owner is refused | `pglite-lock.test.ts:refuses when another live process already holds…` | unit | PASS |
| 5 | The refusal names the holding pid | `pglite-lock.test.ts:names the process holding it…` | unit | PASS |
| 6 | The refusal explains single-writer, not just "locked" | `pglite-lock.test.ts:explains that PGlite is single-writer…` | unit | PASS |
| 7 | A fresh directory records this process | `pglite-lock.test.ts:records this process as the owner…` | integration | PASS |
| 8 | Claiming twice from one process is safe | `pglite-lock.test.ts:is safe to call twice…` | integration | PASS |
| 9 | A real live foreign pid throws | `pglite-lock.test.ts:throws when a different live process holds…` | integration | PASS |
| 10 | A dead owner's lock is taken over on disk | `pglite-lock.test.ts:takes over a lock left behind…` | integration | PASS |
| 11 | A corrupt lock does not wedge the developer out | `pglite-lock.test.ts:ignores a corrupt lock…` | integration | PASS |
| 12 | `memory://` is exempt | `pglite-lock.test.ts:does nothing for an in-memory database…` | integration | PASS |
| 13 | The refusal reaches the caller, not the catch-all | `db-error.test.ts:passes the PGlite single-writer refusal through verbatim` | unit | PASS |

## Coverage

Full suite after the change: **217 files, 2285 tests, all passing.**
`npx tsc --noEmit` — exit 0.

The `lib/db/kahati-packing-backfill.test.ts` timeout noted in cycle 1 passed in
this run, confirming it as load contention rather than a regression.

## Known gaps

- **Advisory, not airtight.** A lock can go stale between the liveness check and
  the open. It only has to beat the silent-divergence default.
- **Pid reuse.** A recycled pid could look like a live owner. The message names
  the pid, so a developer can see it is unrelated.
- **No release on exit.** Nothing deletes the lock on shutdown; the liveness
  check makes that unnecessary, at the cost of a stale file on disk.
- **Scripts are now guarded too.** `scripts/seed.ts` and any `tsx` script
  touching `./.pglite` will refuse while a dev server holds it. That is the
  intended behaviour — a third-process write is exactly what knocked a running
  server's handle loose during this investigation — but it is a workflow change:
  stop the dev server before seeding.
- **Not tested:** two genuinely concurrent `getDb()` calls racing to claim an
  unclaimed directory. Only reachable with real process scheduling.

## Merge evidence

- `cf75378` — **RED.** Compile-time; module absent.
- `7efc5d7` — **GREEN + refactor + the swallowed-message fix.** 28 passing
  across the three affected files; full suite 2285 passing; verified against two
  real dev servers.

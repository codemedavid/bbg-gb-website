# Tier 0 ordering defects TDD evidence

## Source

No plan file was supplied. The three defects were found by the ordering audit
recorded at <https://claude.ai/code/artifact/f3fa0e0f-9d29-44d0-85b2-594d0f3bd210>
and were fixed in the order the audit ranked them. The brief was "fix all the
critical errors first… our goal is to fix it not destroy anything", so every
change below is the minimum that turns its own reproducer, and the full suite
was run before and after to separate these from failures already in the tree.

## User journeys

- As the owner, I want a production deploy to be impossible unless it can sign a
  session cookie nobody else can forge, so that an unset environment variable
  cannot silently issue tokens anyone who has read this repository can mint.
- As an admin, I want cancelling an order to give back exactly what that order
  was holding, even if a colleague clicks Cancel at the same moment, so that a
  counter never reads lower than the truth and a batch never goes to the
  supplier short.
- As whoever next reads `lib/db/schema.ts`, I want it to describe the database
  the site actually runs on, so that a decision about whether a query is covered
  is made against reality.

## Task report

### RED — three reproducers

- Added `lib/jwt-config.test.ts`, `app/api/admin/orders/[id]/status/concurrent-cancel.test.ts`
  and `lib/db/index-drift.test.ts`.
- Commands: `npx vitest run lib/jwt-config.test.ts`,
  `npx vitest run "app/api/admin/orders/[id]/status/concurrent-cancel.test.ts"`,
  `npx vitest run lib/db/index-drift.test.ts`.
- Result: **RED**, each for its intended reason.
  - Signing gate: compile-time RED — `Failed to load url ./jwt-config`. The test
    newly references a module that does not exist, which is the missing gate.
  - Concurrent cancel: runtime RED, 3 of 4 failed. Kahati `8 → 2` where 5 was
    correct; MOQ `6 → 2` where 4 was correct; on-hand stock `17 → 23` against an
    opening 20, **inventing three vials that were never bought**. The fourth
    test (the order still ends cancelled) passed then and now — the defect was
    never visible in the order's own state, only in the counters.
  - Index drift: runtime RED — `expected [ 'email_log_status_sent_at_idx' ] to
    deeply equal []`.
- Checkpoint: `03bc335 test: reproduce the three Tier 0 ordering defects`.

### GREEN — the three fixes

- **Signing key.** New `lib/jwt-config.ts` exports `decideJwtSecretOutcome`,
  mirroring `decideDeliveryConfigOutcome`. `scripts/check-config.ts` now runs
  both gates and reports both before consulting either exit code, so a deploy
  blocked on mail is still told about its signing key. `lib/auth.ts` refuses to
  sign or verify with the public fallback on a production deploy.
- **Concurrent cancel.** In `app/api/admin/orders/[id]/status/route.ts` the
  order is read inside the transaction under `FOR UPDATE` instead of from a
  snapshot taken before it. **Only the read moved** — every release rule is
  byte-for-byte unchanged.
- **Index drift.** `email_log_status_sent_at_idx` declared in `lib/db/schema.ts`.
  Changes no live database; the index has existed since `drizzle/0029`.
- Command: `npx vitest run lib/jwt-config.test.ts lib/db/index-drift.test.ts "app/api/admin/orders/[id]/status/"`.
- Result: **GREEN**, 7 files and 40 tests passed — including all 29 pre-existing
  status tests.
- Checkpoint: `a3cf829 fix: close the three Tier 0 ordering defects`.

### REFACTOR — corrected an overstated comment

- The first comments claimed the missing index was a `DROP` queued behind the
  next deploy. `drizzle/` is 35 migrations deep while `drizzle/meta` stops at
  `0012`, so the recent migrations are hand-written and `drizzle-kit generate`
  is not this repo's live workflow. Comments now state the real, smaller cost.
- Result: **GREEN**, 2 files and 8 tests passed.
- Checkpoint: `a6c971b refactor: state the real cost of the index drift`.

### Coverage follow-up — the guard was untested

- The `lib/auth.ts` guard shipped in `a3cf829` with its only meaningful branch
  uncovered (auth.ts at 39%). Added `lib/auth.production-secret.test.ts`.
- **Mutation-checked:** with the guard deleted, the three production cases fail
  and the three "everywhere else" cases still pass, so they pin behaviour rather
  than implementation.
- Checkpoint: `8bcedbc test: cover the production signing guard in lib/auth.ts`.

## Test specification

| # | What is guaranteed | Test target | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | A production deploy with `JWT_SECRET` unset fails the build | `lib/jwt-config.test.ts: blocks the build when JWT_SECRET is unset` | Unit | PASS | `blocksBuild` true, `exitCode` 1 |
| 2 | A production deploy still using this repo's committed fallback fails the build | `…: blocks the build when JWT_SECRET is the fallback committed in this repo` | Unit | PASS | `DEV_JWT_SECRET` rejected |
| 3 | A secret too short for HS256 fails the build | `…: blocks the build on a secret too short to be an HS256 key` | Unit | PASS | Floor is 32 chars (RFC 7518 §3.2) |
| 4 | Whitespace counts as absence, not as a secret | `…: treats whitespace as absence rather than as a secret` | Unit | PASS | `'   '` blocks |
| 5 | Preview, local and fork builds are never blocked | `…: skips rather than blocks when the secret is missing` | Unit | PASS | `skipped` true, `exitCode` 0 |
| 6 | A skipped check is never reported as a clean bill of health | `…: does not report a skipped check as a clean bill of health` | Unit | PASS | `verified` false |
| 7 | The failure message never contains the secret itself | `…: never puts the secret itself in the message` | Unit | PASS | Guards against leaking it into build logs |
| 8 | A production deploy refuses to SIGN with the public fallback | `lib/auth.production-secret.test.ts: refuses to sign a token when JWT_SECRET is unset` | Unit | PASS | `signToken` rejects; fails if guard removed |
| 9 | A production deploy refuses to VERIFY one too | `…: refuses to VERIFY with it either` | Unit | PASS | Honouring a forgery is the same failure as issuing one |
| 10 | A real secret signs and round-trips normally | `…: signs and round-trips normally once a real secret is set` | Unit | PASS | The guard costs a correct deploy nothing |
| 11 | Local QA and previews are untouched | `…: still signs without JWT_SECRET, so local QA and previews are untouched` | Unit | PASS | Keyed on `VERCEL_ENV`, not `NODE_ENV`, so `next start` still works |
| 12 | Two simultaneous cancels release kahati vials once | `concurrent-cancel.test.ts: releases kahati vials once, not twice` | Integration | PASS | 8 → 5, was 8 → 2 |
| 13 | Two simultaneous cancels restock an on-hand line once | `…: restocks an on-hand line once, not twice` | Integration | PASS | 20 and `soldCount` 0, was 23 |
| 14 | Two simultaneous cancels decrement an MOQ counter once | `…: takes an MOQ commitment off the counter once, not twice` | Integration | PASS | 6 → 4, was 6 → 2 |
| 15 | A lost race is not surfaced as a 500 to the admin who clicked | `…: still leaves the order cancelled` | Integration | PASS | One request fulfils; order ends `cancelled` |
| 16 | Every index a migration created is declared in `schema.ts` | `lib/db/index-drift.test.ts: declares every migrated index in schema.ts` | Unit | PASS | Orphan set empty across all 35 migrations |
| 17 | That guard cannot pass by comparing two empty sets | `…: reads a non-empty set from both sides` | Unit | PASS | Both sides > 10 |
| 18 | Every pre-existing cancel-release rule is unchanged | `kahati-cancel-release.test.ts`, `moq-release.test.ts`, `events.test.ts`, `route.test.ts` | Integration | PASS | 29 tests, untouched and still green |

## Coverage and validation

- Coverage command: `npx vitest run --coverage --coverage.provider=v8 --coverage.include='lib/jwt-config.ts' --coverage.include='lib/auth.ts' --coverage.include='app/api/admin/orders/**/status/route.ts' lib/jwt-config.test.ts lib/auth.production-secret.test.ts "app/api/admin/orders/[id]/status/"`
- Result: **97.93%** statements, 88.63% branches, 87.5% functions on the changed
  modules — `jwt-config.ts` 100%, `status/route.ts` 99.16%, `auth.ts` 90.9%
  (the remainder is `hashPassword`/`verifyPassword`, covered by the auth suites).
- Deploy gate: `npm run config:check` → both gates report; signing check
  correctly SKIPs locally rather than blocking.
- TypeScript: `npx tsc --noEmit` → **no errors in any file changed here**.

## Known gaps

- **Not a clean full-suite run.** `npx vitest run` finishes 3498 passed / 13
  failed across 5 files. None are ours, and this was checked rather than
  assumed: with all six of our files reverted to `HEAD`, `lib/listing-sync-server.test.ts`
  fails identically (`expected 10 to be 7`). The failures are
  `app/api/groupbuys/route.test.ts`, `components/GroupBuyCard.test.tsx`,
  `lib/kahati.test.ts`, `lib/pricing.test.ts` and `lib/listing-sync-server.test.ts`
  — all part of another session's uncommitted campaign/pricing work, and the
  first four also fail `tsc` in that same uncommitted state.
  `app/api/pasalo/e2e-*.test.ts` and `app/api/orders/[id]/proofs/route.test.ts`
  pass in isolation; they are the known whole-suite timeout flake.
- **`JWT_SECRET` in production is still unverified.** No Vercel CLI is installed
  in this worktree, so whether production currently relies on the fallback is
  unknown. `vercel env ls` answers it. The gate added here blocks the *next*
  deploy if it does; it does nothing about a deploy already running.
- **Setting `JWT_SECRET` for the first time signs every user out once.** Tokens
  signed with the old value stop verifying. Passwords, orders and carts are
  untouched.
- **`FOR UPDATE` serialises cancels of the same order, not of different ones.**
  The lock is per-row, so admin throughput is unaffected.
- Tier 1 is untouched: `lib/order-edit-server.ts` still carries its four defects
  (bulk price retained on edit, no status guard on a kahati increase, skipped
  minimums, unlocked delta read). That path has no equivalent of the lock added
  here.

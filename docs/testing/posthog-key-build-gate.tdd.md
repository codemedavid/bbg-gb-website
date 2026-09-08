# Production build gate for customer-email delivery

**Date:** 2026-09-08
**Source plan:** none — journeys derived during this TDD run, from a live
diagnosis of why PostHog "was not working".

## What was actually wrong

PostHog was not broken and neither was the app. `POSTHOG_KEY` has been absent
from the Vercel **production** environment since 2026-09-02. Queried against the
production database on 2026-09-08:

| status | error | rows | most recent |
|---|---|---|---|
| `skipped` | `POSTHOG_KEY is not set, so nothing was sent.` | 245 | 2026-09-07 19:46 |
| `failed` | `POSTHOG_KEY is not set, so nothing was sent.` | 18 | 2026-09-07 19:16 |
| `undeliverable` | `No delivery route ... "settlement_confirmed"` | 2 | 2026-09-06 15:49 |

263 notifications composed, logged, and dropped over six days: 76
`order_receipt`, 62 `status_payment_confirmed`, 41 `status_delivered`, 30
`settlement_placed`, 28 `order_receipt_updated`, 18 `password_reset`, plus the
remaining `status_*` kinds.

Ruled out: not a variable-name mismatch (`lib/env.ts:33` already falls back to
`NEXT_PUBLIC_POSTHOG_KEY`; both absent); not the PostHog workflow re-entry bug
of August (that could only ever affect `password_reset`, while this hits every
kind); not app code (`captureEvent` reports the failure correctly, which is the
only reason it is visible).

The remedy for the outage itself is operational — set the variable and redeploy.
This change addresses the second-order problem: **why nothing announced it.**

## Why no test could have caught it

- `captureEvent` never throws, by design: a PostHog outage must not fail a
  customer's order (`lib/posthog.ts`).
- `vitest.config.ts:52` pins `POSTHOG_KEY` to `''` on purpose, so a suite run
  cannot mail a real customer.

Together those mean the suite is green in exactly the state that breaks
production. The key lives in the environment, not the code, so the deploying
environment is the only witness — hence a build-time gate rather than a test.

## User journey

> As the operator, I want a production deploy to fail loudly when nothing is
> configured to deliver customer email, so that I find out at build time instead
> of from customers who never got a receipt.

## Task report

**Execution.** Added a pure decision function `decideDeliveryConfigOutcome`
(`lib/delivery-config.ts`), mirroring the existing `decideCheckOutcome` split:
the script gathers facts, the library decides what they mean for the build.
`scripts/check-config.ts` gathers them and `prebuild` runs it before `db:check`.

**RED** — `npx vitest run lib/delivery-config.test.ts`

```
FAIL  lib/delivery-config.test.ts [ lib/delivery-config.test.ts ]
Error: Failed to load url ./delivery-config (resolved id: ./delivery-config)
 Test Files  1 failed (1)
```

Compile-time RED against the missing implementation — not an unrelated setup or
syntax failure. Checkpoint `a214788`.

**GREEN** — same target, after implementing

```
 ✓ lib/delivery-config.test.ts (6 tests) 2ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

Checkpoint `078aba9`.

**Regression** — `npm test`: `278 passed (278)` files, `3044 passed (3044)`
tests. `npx tsc --noEmit --pretty false`: clean, exit 0.

**Gate exercised end to end** (`npx tsx scripts/check-config.ts`):

| Environment | Result |
|---|---|
| `VERCEL_ENV=production`, no key — the live outage state | exit **1**, blocks, names `POSTHOG_KEY` and the fix |
| `VERCEL_ENV=production`, key set | exit 0, `POSTHOG_KEY is set` |
| no `VERCEL_ENV` (preview / local / fork) | exit 0, warns, `skipped` |

**Guaranteed by the passing tests:** a production build cannot ship while the
mail it composes has no deliverer; the failure message names the variable; and
builds that never mail a customer are warned rather than blocked, so the gate
does not invite a bypass.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A configured key passes the gate and reads as verified | `lib/delivery-config.test.ts:passes when the key that delivers the mail is configured` | unit | PASS |
| 2 | A production deploy with no delivery key blocks the build (exit 1) | `lib/delivery-config.test.ts:blocks a production deploy when the mail has no delivery key` | unit | PASS |
| 3 | The failure names `POSTHOG_KEY`, so the fix needs no archaeology | `lib/delivery-config.test.ts:names the missing variable so the fix needs no archaeology` | unit | PASS |
| 4 | Preview/local/fork builds warn and pass instead of blocking | `lib/delivery-config.test.ts:warns without blocking on a build that never mails a customer` | unit | PASS |
| 5 | A non-production skip is never reported as verified configuration | `lib/delivery-config.test.ts:does not read a non-production skip as a verified configuration` | unit | PASS |
| 6 | The gate stands down if no kind routes through PostHog any more | `lib/delivery-config.test.ts:stands down when nothing routes through PostHog any more` | unit | PASS |

Evidence command for all six: `npx vitest run lib/delivery-config.test.ts`.

## Coverage

`npx vitest run lib/delivery-config.test.ts --coverage.enabled
--coverage.include='lib/delivery-config.ts'` → **100% statements, branches,
functions, lines**. All four decision branches are exercised.

## Known gaps

- **The gate does not prove mail is delivered.** It proves a key is present. A
  valid-looking key for the wrong project, or a paused workflow, still passes —
  PostHog's ingest endpoint answers `{"status":"Ok"}` even for a bogus key, so
  only the Activity feed can confirm delivery.
- `settlement_confirmed` and the admin-side `order_receipt_updated` still emit
  no event and remain `undeliverable` by design. Unchanged here.
- The gate reads `VERCEL_ENV`. A production deploy from another platform would
  need its own signal.

## Operational note

**This gate blocks the next production deploy until `POSTHOG_KEY` is set** —
that is its purpose, and the current production environment is exactly the state
it refuses. Set the variable in Vercel → Settings → Environment Variables →
Production *before* the next deploy, then redeploy. The 263 dropped
notifications are not resent; individual password resets can be handed over via
Admin → Accounts → "Issue reset link".

See `docs/posthog-events.md` for the event contract and
`docs/testing/password-reset-delivery.tdd.md` for the earlier workflow-side
failure.

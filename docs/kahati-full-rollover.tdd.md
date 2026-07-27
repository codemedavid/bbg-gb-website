# A full kahati always rolls over

**Client rule:** a kahati kit holds 10 vials. `11/10`, `12/10`, `13/10` must be unreachable.
The moment a counter reaches `10/10` it is sealed and a fresh counter opens at `0/10`, so the
next customer's 3 vials read **3/10** — automatically, every time.

Journeys were derived during this TDD run; there was no `*.plan.md`.

## What was actually wrong

The overflow arithmetic was already right. `POST /api/orders` walks counters, seals one that
fills and rolls the remainder into its successor — the two checkout tests in the reproducer
passed on the first RED run, which is what isolated the real defect.

The defect was that **sealing only ever happened as a side effect**. A counter rolled over if,
and only if, a checkout landed on it or an admin edited it. Nothing sealed a counter that
filled and was then left alone, because the only sweep keyed off the **deadline**, not the cap:

```
sweepExpiredKahatis → WHERE status='open' AND closes_at < now   -- never looks at claimed_slots
```

Production row `1c16204f` (KLOW 80mg) is that state, found live during diagnosis:

| id | claimed | cap | status | deadline | successor |
|---|---|---|---|---|---|
| `1c16204f` | 10 | 10 | **open** | 2026-07-31 (future) | **none** |

Filled legitimately on 2026-07-24 (10 vials of live, non-cancelled orders), it sat `open` at
`10/10` for three days. `GET /api/groupbuys` lists every `open` counter, so the board offered a
hatian nobody could join, and no replacement existed to join instead.

Separately, nothing at the database level bounded the counter. `claimed_slots > total_slots`
was blocked only by a `WHERE` clause on one code path, so a script, a console query or any
future path could still mint a `13/10`, and the read surfaces rendered it raw.

## The model

Three layers, weakest to strongest:

1. **Eager rollover** (unchanged) — checkout and admin edits seal on fill via `closeFullKahati`.
2. **The sweep** (`sweepKahatis`, was `sweepExpiredKahatis`) — seals *every* open counter at or
   above its cap and opens each successor, then resolves expired ones as before. It already runs
   on every public and admin board read, so a fill nothing revisits is still caught.
3. **The database** — `CHECK (claimed_slots <= total_slots)` on `group_buys`. The ceiling lives
   in the database, not only in application code; that is the difference between "cannot exceed
   the kit" and "usually does not".

Full counters are swept **first**. A hatian that is both full and expired must roll over, not
merely close: 10 vials clears the 7-vial minimum, so the expiry branch would flip it to
`closed` with **no successor** — precisely the state the sweep exists to prevent.

`closeFullKahati`'s flip is guarded on `status='open'`, so a sweep racing a checkout over the
same counter seals it exactly once; the loser skips it and reports nothing.

`kahatiClaimedDisplay(claimed, cap)` clamps the four read surfaces. The database now refuses to
store an over-cap row, but rows written *before* the constraint must not be published as
"13 / 10 vials" either.

## RED

`npx vitest run lib/kahati-rollover.test.ts lib/kahati.test.ts` → **11 failed | 27 passed**

| Failure | What it proved missing |
|---|---|
| `sweepKahatis is not a function` | no cap-driven sweep existed at all |
| `expected 10 to be +0` | the public board served the full counter as joinable |
| `promise resolved instead of rejecting` | the database accepted `claimed 13` of `10` |
| `kahatiClaimedDisplay is not a function` | no clamp on any read surface |

The 2 rollover tests that **passed** are the checkout-overflow cases (`10/10 + 3 → 3/10`,
`8/10 + 5 → 10/10 + 3/10`). Keeping them is deliberate: they pin the behaviour that already
worked, and their passing is what located the defect in the unattended counter.

## GREEN

| Command | Result |
|---|---|
| `npx vitest run lib/kahati-rollover.test.ts lib/kahati.test.ts` | 38 passed (38) |
| `npx vitest run` | **83 files, 759 passed** |
| `npx tsc --noEmit` | exit 0 |
| `npm run db:check` | `Database matches schema.ts — no drift.` |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A 10/10 open counter with a *future* deadline is sealed and a fresh 0/10 opens | `lib/kahati-rollover.test.ts:seals a 10/10 open counter whose deadline has NOT passed` | integration | PASS |
| 2 | A counter with room is left alone | `…:leaves a counter with room alone` | integration | PASS |
| 3 | A repeat sweep does not open a third counter | `…:is idempotent` | integration | PASS |
| 4 | The successor inherits price, cap, minimum, packing fee and deadline window | `…:the successor inherits …` | integration | PASS |
| 5 | An expired *unfilled* counter is still cancelled — the deadline rule survives | `…:an expired UNFILLED counter is still cancelled` | integration | PASS |
| 6 | The public board never offers a counter with no room | `…:drops the filled counter and lists its fresh successor` | integration | PASS |
| 7 | 10/10 + 3 vials lands 3/10 in a fresh counter | `…:10/10 + 3 vials lands 3/10` | integration | PASS |
| 8 | 8/10 + 5 vials seals at 10/10 and carries 3 over | `…:8/10 + 5 vials seals the first at 10/10` | integration | PASS |
| 9 | The database rejects an UPDATE pushing claimed past the cap | `…:rejects an UPDATE pushing claimed_slots past total_slots` | integration | PASS |
| 10 | A legacy 13/10 row displays as 10/10, never 13/10 | `lib/kahati.test.ts:never renders past the cap` | unit | PASS |
| 11 | The detail endpoint clamps a real over-cap row (constraint dropped to create one) | `app/api/groupbuys/[id]/route.test.ts:never publishes a count past the cap` | integration | PASS |

## Coverage

Full suite, restricted to the files this change touched:

| File | Stmts | Branch | Funcs | Lines |
|---|---|---|---|---|
| `lib/kahati.ts` | 100% | 100% | 100% | 100% |
| `lib/kahati-server.ts` | 100% | 81.5% | 100% | 100% |
| `app/api/groupbuys/route.ts` | 100% | 100% | 100% | 100% |
| `app/api/groupbuys/[id]/route.ts` | 100% | 100% | 100% | 100% |

`app/api/groupbuys/[id]/route.ts` had **no test file at all** before this change and was
modified by it; `route.test.ts` was added to close that gap.

The uncovered branches in `kahati-server.ts` (lines 46, 84, 122, 198, 232) are lost-race arms —
a guarded UPDATE matching zero rows because a concurrent writer got there first. They are
reachable only under true concurrency, and `lib/kahati-server.guarded.test.ts` covers the
equivalent transitions by driving the guards directly.

## Production

Migration `drizzle/0011_kahati_within_cap.sql`, applied to the production Supabase on
2026-07-27 as `kahati_claimed_within_cap`.

- Verified `0` rows over cap immediately before applying, so the clamping `UPDATE` was a no-op.
  It stays in the migration to keep it replayable against any environment.
- Constraint confirmed present: `CHECK ((claimed_slots <= total_slots))`.
- Confirmed it bites: an `UPDATE … SET claimed_slots = 13` against `1c16204f` was rejected with
  `check_violation`; the row still reads `10/10`.
- `npm run db:check` → no drift.

Row `1c16204f` was deliberately **not** hand-edited. It self-heals on the first board read after
deploy — the sweep seals it and opens its successor, which is the fix demonstrating itself on
the data that exposed the bug.

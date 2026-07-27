# A kahati commitment may span more than one kit

**Client rule:** a customer must be able to commit more than 10 vials. The 10-vial cap belongs
to the *counter*, not to the customer — a larger commitment fills this counter to 10, seals it,
opens a fresh one, and keeps rolling until every vial has landed. No counter ever shows 11/10,
and no commitment is ever rejected for being "too big".

Journeys were derived during this TDD run; there was no `*.plan.md`.

## User journeys

1. As a bulk buyer, I want to commit 25 vials in one go, so that I do not have to place three
   separate orders and pay attention to where each counter happens to sit.
2. As a customer, I want my oversized commitment to land in whole 10-vial counters, so that the
   batches the seller orders stay exactly one kit each.
3. As the next customer on the board, I want a joinable counter to exist after someone commits a
   large amount, so that I am not looking at a board of nothing but sealed counters.
4. As a customer, I want the quantity stepper to let me climb past 10, so that the app does not
   refuse a commitment the server would happily accept.

## What changed

| File | Change |
|---|---|
| `app/api/orders/route.ts` | Removed the `qty > totalSlots` rejection (`"A single kahati commitment can be at most 10 vials."`). The claim loop below it was already general — it fills, seals, opens a sibling, and repeats — so deleting the guard is the whole server-side fix. The per-person `minVials` check stays. |
| `components/JoinSheet.tsx` | Stepper clamps to `minVials` only, no longer to `totalSlots`. The cart line no longer carries `stock`. |
| `lib/store/cart.ts` | `maxQtyFor` returns `Infinity` for `group_buy` lines, checked *before* `stock`, so a cart persisted in localStorage with the old `stock: 10` stops clamping too. |

**Upper bound.** Per the decision taken during this run, there is no per-commitment cap. The only
remaining bound is the pre-existing schema guard `qty: z.number().int().positive().max(9999)`.
Stated for the record: a 9999-vial commitment would open ~1000 counters inside one transaction.
That was raised and accepted before implementation.

## Task report

### 1. Server: a commitment larger than one kit is accepted and spread across counters

- **Summary:** deleted the single-kit ceiling; the existing claim loop handles arbitrarily many kits.
- **Command:** `npx vitest run app/api/orders/kahati-multi-kit.test.ts`
- **RED:** 4 failed / 2 passed — `AssertionError: expected 400 to be 201` at the four cases that
  commit 11, 20 and 25 vials. The two that passed (per-person minimum, expired-deadline spill)
  were already-correct guards asserted to make sure the fix did not weaken them.
- **GREEN:** 6 passed.
- **Guaranteed:** 25 vials onto a 7/10 counter produces three sealed counters at exactly 10 and one
  open counter at 2; a 20-vial commit onto an empty counter seals two and leaves a fresh 0/10 open;
  no counter ever exceeds its cap; the whole commitment is one order with one deferred packing fee,
  with each fragment recorded against the counter it actually claimed from.

### 2. Client: the stepper and the cart stop clamping at one kit

- **Summary:** `JoinSheet` clamps to the minimum only and passes no `stock`; `maxQtyFor` treats
  every kahati line as uncapped.
- **Commands:** `npx vitest run components/JoinSheet.test.tsx`, `npx vitest run lib/store/cart.test.ts`
- **RED:** JoinSheet 2 failed (`expected 10 to be 13`; `expected 10 to be undefined`).
  cart.ts 1 failed (`expected 10 to be Infinity`) on the persisted-cart case.
- **GREEN:** JoinSheet 9 passed, cart 21 passed.
- **Guaranteed:** the stepper climbs past a kit but never below `minVials`; repeated Join taps
  accumulate (7 + 7 = 14) instead of clamping to 10; a manual edit to 99 sticks; a cart line saved
  before this change with `stock: 10` no longer caps the customer at one kit.

### 3. Superseded specs updated

`lib/store/cart.test.ts` carried a `describe('kahati lines clamp to the hatian's remaining vials')`
block and `components/JoinSheet.test.tsx` two kit-cap assertions. These encoded the ceiling this
change removes, so they were rewritten to the new rule rather than deleted — the accumulate and
manual-edit cases still exist, now asserting the opposite outcome.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | 25 vials onto a 7/10 counter seal three counters at 10 and leave one open at 2 | `app/api/orders/kahati-multi-kit.test.ts:spans as many 10-vial counters as the commitment needs` | integration | PASS |
| 2 | No counter is ever pushed past its cap by a multi-kit commitment | same test, `claimedSlots <= totalSlots` assertion | integration | PASS |
| 3 | A multi-kit commitment is one order, one deferred packing fee, one fragment per counter | `…:records every fragment against the counter it claimed from, under one order` | integration | PASS |
| 4 | A commitment landing exactly on the cap still leaves a fresh empty counter open | `…:leaves a fresh empty counter open when the commitment lands exactly on the cap` | integration | PASS |
| 5 | An 11-vial commitment is no longer rejected | `…:no longer rejects a commitment for being larger than a single kit` | integration | PASS |
| 6 | The per-person minimum is still enforced | `…:still enforces the per-person minimum` | integration | PASS |
| 7 | A spill into a counter whose deadline has passed is refused and rolls the whole transaction back | `…:refuses to spill into a counter whose deadline has passed` | integration | PASS |
| 8 | The single-counter overflow case still behaves as before | `app/api/orders/kahati-overflow.test.ts` (3 tests) | integration | PASS |
| 9 | The stepper climbs past one kit | `components/JoinSheet.test.tsx:lets the customer commit more vials than a single kit holds` | unit | PASS |
| 10 | The stepper never drops below the per-person minimum | `…:never lets the stepper fall below the hatian's per-person minimum` | unit | PASS |
| 11 | The cart line is created uncapped | `…:leaves the kahati line uncapped so the cart never clamps a multi-kit commitment` | unit | PASS |
| 12 | A kahati line has no quantity ceiling | `lib/store/cart.test.ts:places no limit on a kahati line` | unit | PASS |
| 13 | A cart persisted with the old kit cap stops clamping | `…:ignores a stale kit cap left in a cart persisted before the multi-kit rule` | unit | PASS |
| 14 | Repeated Join taps accumulate rather than clamp | `…:accumulates repeated Join taps instead of clamping them to one kit` | unit | PASS |

## Coverage

- Full suite: **801 passed / 801, 88 files** — `npx vitest run` (17:14).
- `components/JoinSheet.tsx`: 100% statements, 94.44% branches, 100% functions.
- `lib/store/cart.ts`: 83.33% statements, 80.95% branches.
- `app/api/orders` (from the kahati checkout tests alone): 56.53% statements — the route's
  on-hand and MOQ branches are covered by the other files in that directory, not by these.
- A whole-project `vitest run --coverage` could not be completed during this run: a second Claude
  session was running vitest concurrently in the same working tree and the two runs clobber each
  other's `coverage/.tmp`. The per-file figures above were taken with an isolated reports directory.

## Merge evidence

RED checkpoint: `3ca6563` — *test: reproducer for the 10-vial ceiling on a single kahati commitment (RED)*.

The GREEN implementation (`app/api/orders/route.ts`, `components/JoinSheet.tsx`,
`lib/store/cart.ts`, `lib/store/cart.test.ts`) is **not** in a commit of its own. A concurrent
Claude session working on the kahati downpayment waiver in the same working tree ran a broad
`git add` and swept these files into its own commit `32fa528`, which is titled
*"test: reproducers for the repeat-kahati confirm-only checkout and the cart/checkout back loop (RED)"*.
That title describes only that session's changes; the multi-kit implementation rode along
unlabelled. The history was left as-is rather than rewritten, because that session was actively
committing on top of it. Anyone bisecting the multi-kit rule should look at `32fa528` for the
implementation and at this document for what it is verified to do.

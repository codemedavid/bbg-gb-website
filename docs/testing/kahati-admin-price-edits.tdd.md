# TDD Evidence: admin-editable kahati minVials and repack fee

**Source plan** — no `*.plan.md` artifact. Journeys derived during the `/ecc:plan` audit of the
feature list in this session, then narrowed to the bug this cycle fixes.

## User journeys

1. As an admin, I want to raise a kahati's minimum vial commitment, so that a batch only fills
   with participants large enough to be worth repacking.
2. As an admin, I want to edit a kahati's repack fee, so that pricing reflects real handling cost.
3. As a customer, I want the fee quoted at checkout to be the fee I am actually charged.

## Task report

### Bug: checkout ignored the group buy's admin-editable `minVials` and `repackFeePhp`

`groupBuys.minVials` and `groupBuys.repackFeePhp` are editable in the schema, the admin API
(`PATCH /admin/groupbuys/:id`), and the admin UI (`AdminGroupBuys.tsx:25-28`). But
`server/src/routes/orders.ts` called `validateKahatiCommit(qty, remaining)` and `repackFeeFor(items)`,
both of which used the module constants `KAHATI_MIN_VIALS = 7` and `REPACK_FEE_PHP = 150`.
Admin edits therefore had no effect on real orders. The order snapshot even displayed
`Kahati · min ${g.minVials} vials` while enforcing 7.

- **Validation command** — `npm test`
- **RED** (commit `913b9e0`): 3 failed / 23.
  - `enforces the group buy minVials over the default 7` → `expected true to be false`
  - `charges the group buy repack fee over the default 150` → `expected 150 to be 200`
  - `charges a single repack fee for a mixed cart using the edited fee` → `expected 150 to be 200`
  - Failures were caused by the business-logic bug, not setup error. The two fallback tests passed
    at RED, pinning the default behavior against regression.
- **GREEN** (commit `e8bf891`): 23/23 pass; `tsc --noEmit` exit 0.
- **Guarantee** — a kahati's own `minVials` and `repackFeePhp` are enforced at checkout, and the
  documented defaults still apply when a group buy sets none.

### Follow-on: client quoted the default fee while the server charged the edited one

Fixing the server surfaced a worse defect: `client/src/store/cart.ts` hardcoded `REPACK_FEE_PHP`,
so checkout would quote ₱150 while the server charged the edited fee — a customer-visible
bait-and-switch.

- **Validation command** — `npm run build` (client has no test runner; see gaps)
- **Result** — builds clean, 172 modules, 99.69 kB gzipped JS.
- **Fix** (commit `46fa149`) — `repackFor` reads each kahati item's `repackFeePhp`, mirroring the
  server. Carts persisted before this change fall back to ₱150.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | A kahati with `minVials: 20` rejects a 7-vial commit and accepts 20 | `pricing.test.ts:enforces the group buy minVials over the default 7` | unit | PASS | `npm test` |
| 2 | A group buy setting no minimum falls back to `KAHATI_MIN_VIALS` (7) | `pricing.test.ts:falls back to the default minimum when the group buy sets none` | unit | PASS | `npm test` |
| 3 | A kahati with `repackFeePhp: 200` is charged 200, not 150 | `pricing.test.ts:charges the group buy repack fee over the default 150` | unit | PASS | `npm test` |
| 4 | A group buy setting no fee falls back to `REPACK_FEE_PHP` (150) | `pricing.test.ts:falls back to the default repack fee when the group buy sets none` | unit | PASS | `npm test` |
| 5 | A mixed solo+kahati cart charges shipping once and the edited repack fee once | `pricing.test.ts:charges a single repack fee for a mixed cart using the edited fee` | unit | PASS | `npm test` |

## Design decision

One repack fee per order is preserved from the original behavior; when a cart joins several
kahatis, the **highest** fee applies. Charging one fee per kahati joined would also be defensible
but changes billing beyond the scope of this bug — it is not implemented here.

## Coverage and known gaps

`npx vitest run --coverage --root server` → **6.3% statements overall**. The tested modules are at
100% (`pricing.ts` 100/100/100, `calculator.ts` 100 stmts / 83.33 branch). Everything else is 0%:

| Untested | Lines |
|---|---|
| `routes/orders.ts` (checkout, proof upload, slot claiming) | 1-146 |
| `routes/admin.ts` (price edits, order status, COA upload) | 1-192 |
| `routes/auth.ts`, `products.ts`, `groupbuys.ts`, `coa.ts`, `files.ts` | all |
| `services/analytics.ts`, `services/email.ts` | all |
| `middleware/auth.ts`, `middleware/error.ts` | all |

**The 80% bar is not met.** Closing it requires a route-level integration harness (supertest +
a per-test PGlite instance with fixtures) that does not exist yet. The client has no test runner
at all, so the cart fix above is verified only by `tsc` and the production build.

Two unproven concurrency defects were noticed while reading `routes/orders.ts` and are **not**
fixed or tested here:

1. `nextOrderNo()` derives the order number from `count(*)`. Two concurrent checkouts read the
   same count and generate the same `orderNo`, which is `.unique()` in the schema — the second
   insert throws.
2. The kahati slot check and the `claimedSlots` increment are not in a transaction. Concurrent
   checkouts can both pass validation and oversell the batch.

Both need the integration harness to reproduce.

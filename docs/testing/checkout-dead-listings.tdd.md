# Checkout with dead listings in the cart — TDD evidence

## Source

No plan file. Derived from the `/plan` produced in-session on 2026-09-14 for a
customer report (Ruth, 10:12 AM): "Nag-attach ako ng payment, tapos naghang.
Nawala ang Reta SF 20mg sa list ko… same issue pa din." Phase 1 of that plan is
implemented here; Phase 2 (remap a dead line to its replacement listing) and
Phase 3 (upload progress, "check My Orders" on network failure) are not.

Production findings behind the plan (read-only queries):

- The customer is `gie_esguerra@yahoo.com` ("Vangie Tan"; the chat sender name
  did not match the account, and two earlier lookups hit the wrong people). The
  account was created 2026-09-13 21:54 UTC and has no order, proof, settlement
  or email at all — the checkout placed nothing.
- Both live Reta SF 20mg listings (Kahati `6405524a…`, Group Buy `6f6c8252…`)
  are open and shown by the prod boards, and no open counter is past a
  deadline. Deployed code removes a cart line only on a stale-line refusal, a
  "−" at the minimum, or Remove. The dead-listing path therefore fits only if
  her cart predates 2026-09-10 (a guest cart survives signing up) — plausible,
  NOT proven: a refused checkout leaves no server trace, and Postgres logged no
  errors between signup and her message.
- Every Kahati and Group Buy listing was cancelled on 2026-09-10 and re-seeded
  under new ids (`settings.batch_close_rollback_20260910`). The customer's
  persisted cart still held `Retatrutide (Salt Form) 20mg vial`, id `e2e352c3…`
  (cancelled); its replacement `6405524a…` is open.
- Deployed code stored every proof before any line check
  (`app/api/orders/route.ts`), refused on the first dead line only, and the page
  dropped that one line behind a 2.2 s toast.

## User journeys

- As a customer whose cart holds listings that have since closed, I want to be
  told all of them at once — before I wait out a proof upload — so that I am not
  stuck repeating a checkout that removes one item per try and never places.
- As that customer, I want the explanation to stay on screen, say the order was
  not placed, and keep my attached proof, so that I know where I stand and can
  place again in one tap.
- As a customer on a browser still running the previous build, I want the new
  refusal to remain matchable, so that my cart still drops a dead line instead
  of looping.

## Task report

### RED

- Added `app/api/orders/unavailable-lines.test.ts`,
  `app/checkout/unavailable-lines.test.tsx`, and new cases in
  `lib/checkout-error.test.ts`.
- Command: `npx vitest run app/api/orders/unavailable-lines.test.ts app/checkout/unavailable-lines.test.tsx lib/checkout-error.test.ts`
- Result: **RED — 13 failed | 10 passed**, each for the intended reason:
  - `expected "validateAndStoreProofs" to not be called at all, but actually been called 1 times`
  - `expected undefined to deeply equal [ { …(3) } ]` (no dead-line list)
  - page: `expected [ 'product:p1:piece', …(1) ] to deeply equal [ 'product:p1:piece' ]`
  - `unavailableCheckoutLines is not a function`
  - `expected { kahatiName: 'Retatrutide 10mg' } to deeply equal { refId: 'gb-9' }`
  - The 10 passing were deliberate guards: a live cart still places; a stock
    shortfall is not a dead line; the old client can still match `error`.
- Checkpoint: `2db956f test: reproduce the dead-listing checkout that uploads proof then drops one line per try`.

### GREEN

- New `lib/checkout-preflight.ts` — `findUnavailableLines(db, items)`, read-only,
  mirroring only the route's permanent refusals, every message ending in the
  refId.
- `app/api/orders/route.ts` — runs the preflight before `validateAndStoreProofs`;
  on any dead line returns 400 with the first line's message in `error` and all
  of them in `data.unavailable`, logging `checkout_validation_failed`
  (`reason: unavailable_lines`). The two in-transaction closed-kahati refusals and
  the on-hand channel refusal now end in the cart line's refId.
- `lib/api-response.ts` — `fail(status, message, data = null)`.
- `lib/checkout-error.ts` — `unavailableCheckoutLines(body)` (skips malformed
  entries); closed-kahati messages carrying an id match by id before the
  name-only fallback.
- `app/checkout/page.tsx` — removes every listed line together and shows a
  persistent `role="alert"` message: order not placed, which items were removed,
  proof still attached.
- Command: `npx vitest run app/api/orders app/checkout lib/checkout-error.test.ts lib/checkout-preflight.test.ts`
- Result: **GREEN — 30 files, 337 tests passed**, including every pre-existing
  orders and checkout test.

### Guard tests (after GREEN)

- Added `lib/checkout-preflight.test.ts` (15 tests) for the costly direction —
  flagging a LIVE line deletes it from a cart: a Pasalo counter, a completed batch
  rolling into an open successor, a batch still carrying one on-channel product,
  and an on-channel Kahati product are all passed; every dead kind is flagged
  with a message `staleCheckoutLine` resolves to its refId.

### Review

- `ecc:code-reviewer`: 0 critical, 0 high, 0 medium, 3 low — APPROVE. It
  compared each preflight check against the in-transaction check line by line.
  - LOW 3 (on-hand in-transaction refusal lacked refId) — fixed, re-run above.
  - LOW 1 (preflight adds 1–3 sequential reads per distinct line, repeated by
    the transaction) — accepted for now; batch per kind with `inArray` if carts
    grow large.
  - LOW 2 (page matches by refId only, not kind+refId) — not changed; ids come
    from distinct tables and piece/kit lines sharing a refId are the same dead
    product.

### Refactor

None. No checkpoint commits after RED, by the user's choice: the touched files
also carry another session's uncommitted channel-switch work, so GREEN is left
uncommitted for review alongside it.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A cart with a cancelled listing is refused before any proof is stored, and no order is written | `app/api/orders/unavailable-lines.test.ts: refuses before storing any payment proof` | integration | PASS |
| 2 | Every dead line is named in ONE response, in cart order | `…: names every one of them in a single response, in cart order` | integration | PASS |
| 3 | The refusal stays matchable by the previously deployed page | `…: keeps an error message the already-deployed checkout page can still match` | integration | PASS |
| 4 | A live cart still places and stores its proof; a stock shortfall is not flagged | `…: lines that are still sellable` | integration | PASS |
| 5 | The page removes all listed lines at once, keeps the rest | `app/checkout/unavailable-lines.test.tsx: removes every named line in one go` | component | PASS |
| 6 | The explanation persists, names each item, says "not placed", shows no raw ids | `…: explains on the page…`, `…: says the order was not placed…` | component | PASS |
| 7 | The attached proof survives, so placing again is one tap | `…: keeps the attached proof…` | component | PASS |
| 8 | The dead-line list parser trusts nothing malformed | `lib/checkout-error.test.ts: every dead line in one refusal` | unit | PASS |
| 9 | A closed kahati carrying an id is matched by id, never a re-seeded same-named line | `lib/checkout-error.test.ts: a closed kahati named by id` | unit | PASS |
| 10 | The preflight never flags a sellable line (Pasalo, rolled batch, on-channel) | `lib/checkout-preflight.test.ts` | integration | PASS |

## Coverage and known gaps

- `npx vitest run lib/checkout-preflight.test.ts app/api/orders/unavailable-lines.test.ts app/checkout/unavailable-lines.test.tsx lib/checkout-error.test.ts --coverage --coverage.include=lib/checkout-preflight.ts --coverage.include=lib/checkout-error.ts`
  → 38 passed; **95.12% statements, 89.55% branches** across the two files.
  Uncovered: `lib/checkout-error.ts` 13-17 (`friendlyCheckoutError`, another
  session's code) and 116.
- Full suite `npx vitest run`: **3529 passed, 15 failed (7 files)**. None are
  caused by this change:
  - `app/api/pasalo/e2e-refund.test.ts` (the only failing file that imports the
    orders route) — re-run alone: **31/31 passed**; known whole-suite flake.
  - `components/OrderProofSection.test.tsx` — re-run after a concurrent session's
    commit `17da410`: **19/19 passed**.
  - `app/api/groupbuys/route.test.ts` (2, failing at baseline before this work),
    `lib/kahati.test.ts`, `lib/pricing.test.ts`, `components/GroupBuyCard.test.tsx`,
    `lib/listing-sync-server.test.ts` — none import a changed module; they belong
    to other uncommitted kit-size work in the tree.
- `npx tsc --noEmit`: 13 errors, none in changed files (`app/api/groupbuys/route.test.ts`,
  `lib/kahati.test.ts`, `lib/pricing.test.ts`, `lib/product-board-bulk.ts`).
- Lint not run: `next lint` has no ESLint config in this repo and prompts to create one.
- Not built: Phase 2 remap to replacement listings; Phase 3 upload progress and a
  "check My Orders" path after a network failure. Nothing here is deployed —
  GREEN is uncommitted.

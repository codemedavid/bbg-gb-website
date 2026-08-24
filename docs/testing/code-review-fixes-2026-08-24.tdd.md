# TDD evidence — the six /code-review findings (2026-08-24)

**Source plan:** none. The work list is the six findings from the `/code-review`
run over the working tree on `feat/group-buy-page` (the kahati downpayment
feature). Journeys below were derived from those findings during this TDD run.

## User journeys

1. As a developer starting a dev server in a fresh worktree, I want the second
   server to be refused, so that two PGlite writers cannot diverge silently.
2. As a customer checking out a hatian, I want to never be asked for a proof of
   a payment the screen cannot quote, so that I am not stuck at a dead end.
3. As a customer whose hatian was cancelled, I want the email to tell me what
   actually happens to my deposit, so that I am not told it is forfeited on a
   condition that never happened.
4. As a customer committing to a hatian, I want the refund terms on the commit
   sheet to be the terms that actually apply, so that no surface contradicts
   another.
5. As a customer with a mixed cart, I want "due now" to name what the money is,
   so that I do not read on-hand stock I bought as a refundable deposit.
6. As a customer whose hatian was cancelled, I want to be told even if an
   unrelated settings read fails, so that a cancellation is never silent.

## Task report

### 1 — `lib/db/index.ts:31` (HIGH) — the first-run owner lock was never written

`recordPgliteOwner` ran on the line after `new PGlite(path)`. The constructor
only assigns `waitReady`; the data directory is created inside that async init,
so the function hit its own `if (!existsSync(pglitePath)) return;` guard and
no-opped. A fresh worktree's first server therefore left no lock and the second
was waved through — the exact failure `lib/db/pglite-lock.ts` exists to prevent.
The existing lock tests missed it because they `mkdtempSync` the directory
first, which the real call path never does.

- **Fix:** `await client.waitReady;` before recording.
- **RED:** `npx vitest run lib/db/pglite-first-run.test.ts` →
  `ENOENT: no such file or directory, open '…/.pglite/.owner-pid'`
- **GREEN:** same command → `1 passed`.
- **Guaranteed:** opening PGlite in a directory that does not exist yet leaves
  `.owner-pid` naming this process.

### 2 — `app/checkout/page.tsx:57` (MEDIUM) — unknown policy was a checkout dead end

With a kahati-only cart on a settled cycle and the `/settings` query not yet
successful, `confirmOnly` was false (correctly) but the fallback `packing_fee`
policy computed ₱0 due, so `needsFullPayment` was false too: no payment card, no
QR, no amount — yet the proof uploader rendered and `canPlace` required a file.
The customer had to attach an unrelated file, which the server then discarded.
The old comment claimed "unknown means ask for payment"; the payment card is
gated on an amount, so nothing was ever actually asked for.

- **Fix:** a third state, `awaitingDownpaymentPolicy`. While it holds, the screen
  renders a `role="status"` notice instead of any payment card or proof box, and
  `canPlace` is false. Also removes the wrong-figure flash on first paint.
- **RED:** `npx vitest run app/checkout/downpayment.test.tsx` → 3 failed
  (`expected <input …> to be null`, `Unable to find an accessible element with
  the role "status"`, and the QR-absence case).
- **GREEN:** same command → `15 passed`.

Note: this **rewrote** an existing test (`when the downpayment policy cannot be
loaded > asks for payment rather than assuming there is nothing to pay`). That
test asserted the dead end itself — `expect(document.querySelector('input[type="file"]')).not.toBeNull()`.
The spec changed, so the test changed with it.

### 3 — `lib/email.ts:195` (MEDIUM) — the cancellation email denied the refund

`refundNoticeFor` is written for the pre-commitment screens. Interpolated into
`kahatiCancelledEmail` its non-refundable branch read "This downpayment is
non-refundable **once the kahati is confirmed**" — in the email announcing that
the kahati was *cancelled*, i.e. never confirmed. The refundable branch was
conditional ("if the kahati is cancelled…") in a notice that it had been.

- **Fix:** `cancellationRefundNoticeFor` in `lib/kahati-downpayment.ts`, stated in
  the past tense the email needs. It deliberately ignores `policyNote`, which is
  storefront copy written to be read *before* the commitment.
- **RED:** `npx vitest run lib/kahati-downpayment.test.ts lib/kahati-cancellation-notice.test.ts`
  → `TypeError: cancellationRefundNoticeFor is not a function` (5) and
  `expected '…' not to match /once the kahati is confirmed/i` — the failure
  output printed the offending email body verbatim.
- **GREEN:** same command → `33 passed`.

### 4 — `components/JoinSheet.tsx:53` (MEDIUM) — the commit sheet hard-promised a refund

The board and the checkout card read the configured policy; the sheet the
customer reads at the moment of committing money still said "…and your
downpayment is refunded".

- **Fix:** `useKahatiDownpaymentPolicy()` + `refundNoticeFor`, defaulting to the
  refundable policy so an unanswered request keeps the historical promise.
- **RED:** `npx vitest run components/JoinSheet.test.tsx` → 2 failed.
- **GREEN:** same command → `14 passed`.

### 5 — `components/OrderSummary.tsx:116` (LOW) — mixed carts mislabelled

`downpaymentIsDeposit` is true for the whole summary, but `dueNow` is the deposit
**plus** the full price of every non-hatian line. A ₱195 kahati vial beside
₱2,000 of on-hand stock rendered "Downpayment due now ₱2,700".

- **Fix:** `dueOnOtherModes` exposed from `useOrderTotals`; the label falls back
  to a neutral "Due now" when both components are present.
- **RED / GREEN:** `npx vitest run components/OrderSummary.downpayment.test.tsx`
  → 1 failed (`expected <span>Downpayment due now</span> to be null`) → `6 passed`.

### 6 — `lib/kahati-server.ts:198` (LOW) — one settings read could silence a whole batch

`notifyKahatiCancellations` read the policy before the send loop. The
cancellations are already committed by then, so a transient failure meant *no*
customer was notified. It also fired on an empty batch.

- **Fix:** early return on `notices.length === 0`, and `.catch(() => DEFAULT_KAHATI_DOWNPAYMENT_POLICY)`.
- **RED:** 3 failures in `lib/kahati-cancellation-notice.test.ts`
  (`connection terminated unexpectedly` ×2, and the spy called once on an empty batch).
- **GREEN:** `5 passed`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A first PGlite open in a non-existent directory leaves `.owner-pid` naming this process | `lib/db/pglite-first-run.test.ts` | integration (faked PGlite) | PASS |
| 2 | An unknown deposit policy does not go confirm-only | `app/checkout/downpayment.test.tsx:does not assume there is nothing left to pay` | component | PASS |
| 3 | An unknown deposit policy shows no proof uploader | `…:does not demand a proof of a payment it cannot quote` | component | PASS |
| 4 | An unknown deposit policy says so and disables placing | `…:says so, and holds the order until it knows` | component | PASS |
| 5 | An unknown deposit policy shows no QR of either kind | `…:shows no payment QR at all…` | component | PASS |
| 6 | The cancellation notice never says "once the kahati is confirmed" | `lib/kahati-downpayment.test.ts:cancellationRefundNoticeFor` (5 cases) | unit | PASS |
| 7 | The cancellation email under a non-refundable policy carries no confirmation condition | `lib/kahati-cancellation-notice.test.ts` | integration | PASS |
| 8 | A failed settings read still sends every cancellation email, with the historical refund promise | `lib/kahati-cancellation-notice.test.ts` (2 cases) | integration | PASS |
| 9 | An empty cancellation batch reads no settings and sends nothing | `lib/kahati-cancellation-notice.test.ts` | integration | PASS |
| 10 | The commit sheet promises a refund only while the policy is refundable, states the admin's wording, and keeps the promise while unloaded | `components/JoinSheet.test.tsx:the refund terms on the commit sheet` (4 cases) | component | PASS |
| 11 | A mixed cart's total is not labelled a downpayment; a hatian-only one still is | `components/OrderSummary.downpayment.test.tsx:the "due now" label on a mixed cart` (2 cases) | component | PASS |

## Coverage and known gaps

- Full suite: `npm test` → **230 files passed, 2426 tests passed**, 173s
  (run at 10:53). An earlier run of the same tree reported 2 failures in
  `app/api/admin/report/refund/route.test.ts` — a 60s `beforeEach` hook timeout
  and the duplicate-key cascade behind it. That file passes alone (`11 passed`,
  4.9s) and passed in the clean full run; it is the under-load hook-timeout
  flake `vitest.config.ts` already documents, competing here with a concurrent
  `tsc`. Not related to these changes: nothing here touches that route.
- `npx tsc --noEmit` → clean.
- **Gap (1):** the PGlite first-run test uses a faithful fake of PGlite's
  constructor contract (directory created when `waitReady` resolves), not the
  real WASM build — running the real one against a temp directory would add
  seconds to the suite for the same guarantee. If PGlite ever creates the
  directory synchronously in the constructor, the fake would keep passing while
  the production line became unnecessary rather than wrong.
- **Gap (2):** the checkout wait state has no retry affordance. If `/settings`
  fails past React Query's retries, the customer waits rather than being asked
  to reload. Blocking beats the dead end it replaces, but a retry button is
  worth adding.
- **Gap (3):** `cancellationRefundNoticeFor` ignores `policyNote` by design. An
  admin who wants bespoke cancellation wording has no way to set it yet.

## Merge evidence

RED → GREEN → refactor summary for the squash commit / PR body:

- **RED** (`a7ee3a8 test: add reproducers for the six code-review findings`):
  15 failing assertions across 6 files, each failing for the intended reason —
  ENOENT on the missing lock file, `cancellationRefundNoticeFor is not a
  function`, the cancellation email body printed with the false sentence in it,
  the proof uploader present with no payment card, the refund promise under a
  non-refundable policy, and the mislabelled mixed-cart total.
- **GREEN:** every one of those assertions passes; `tsc --noEmit` clean.
- **Refactor:** none beyond the fixes themselves — the label logic in
  `OrderSummary` was lifted out of JSX into a named `dueNowLabel`, which is part
  of the fix rather than a separate step.

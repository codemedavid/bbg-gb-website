# TDD Evidence — why some customers could not check out

**Source plan**: none on disk. Journeys were derived during the `/ecc:plan`
investigation in this session, from reading the checkout path and querying the
live Supabase database.
**Branch**: `feat/group-buy-page`
**Date**: 2026-09-04

## What the investigation found

Orders were flowing throughout (13 on 09-04, 30 on 09-03), so this was never a
total outage — it was a set of partial failures, each of which strands a
particular customer completely.

Ruled out first, with evidence:

| Hypothesis | Verdict |
|---|---|
| Prod schema drift on checkout tables | Ruled out — `orders`, `order_items`, `payment_methods.purpose`, `order_payment_proofs` all match `lib/db/schema.ts` |
| Order-number collisions under load | Ruled out — `nextOrderNo` draws from `order_no_seq` (last_value 2822); `nextval` is atomic |
| Boards closed by the schedule | Ruled out — kahati orders landing at 13:02 UTC on the day of the investigation |
| Per-customer minimums set too high | Ruled out — all 98 open kahati have `min_vials = 1`; all 128 open campaigns `per_customer_min = 1` |
| Uncommitted on-hand-bulk work breaking prod | Ruled out — branch equalled `origin/main`; the diff is additive pricing only |

Traffic context that decides severity: **53 of the last 73 orders were kahati**,
so any block on the kahati path is a block on the dominant board.

## User journeys

1. As a customer with a Kahati item in my cart, I want to reach the Place button
   even if a background request drops, so that a network blip does not cost me
   the order.
2. As a signed-in customer, I want to stay signed in through checkout when a
   request fails, so that I am not thrown back to a login screen I do not need.
3. As a customer who does get signed out, I want to come back to my checkout
   afterwards, so that I do not rebuild the cart, address and screenshots.
4. As one of several customers checking out at the same instant, I want a
   momentary collision to resolve itself, so that concurrency does not cost me
   my order.
5. As an admin, I want to be stopped from configuring a deposit with no QR to
   pay it into, so that I do not take the busiest board offline unknowingly.
6. As a customer attaching a screenshot my phone produced, I want it accepted,
   so that I am not told my image is not an image.
7. As a customer whose order was placed, I want to be told it was placed, so
   that I do not order a second time.

## Task report

### 1. Kahati checkout stranded on an unrecoverable "please wait"

`awaitingDownpaymentPolicy` gated the Place button on `isSuccess` of
`useKahatiDownpaymentPolicy()`. The query client is `retry: 1,
refetchOnWindowFocus: false` (`app/providers.tsx:9`), so two failures left it in
error **permanently**, rendering "please wait a moment before sending anything"
with no spinner, no error and no retry. The only escape was the reload the copy
discourages. Three separate hooks hit `/api/settings` on this page, tripling the
chance one loses.

`useOrderTotals` now reports *why* the policy is missing, and a failed fetch gets
its own card with a `Try again` wired to `refetch`. The order still cannot be
placed while the rule is unknown — that guard was correct and is asserted.

- RED: `npx vitest run app/checkout/policy-recovery.test.tsx` — 3 failed (no
  alert, no Try again button, Place button not found).
- GREEN: same command — 5 passed.

### 2 & 3. A dropped `/auth/me` logging a customer out of checkout

`apiGet('/auth/me').catch(() => setUser(null))` treated every failure as a
logout; `app/checkout/page.tsx` redirected on `!user`, with no `?next=`.

`ApiClientError` now carries the HTTP status. `AuthProvider` distinguishes the
server's own 401/403/404 from a non-answer, retries a dropped or 5xx request at
400 ms and 1200 ms, and settles on `unknown` rather than asserting a logout it
never observed. Checkout redirects on `unauthenticated` alone and carries
`?next=/checkout`.

- RED: `npx vitest run lib/useAuth.test.tsx app/checkout/session-recovery.test.tsx`
  — 8 failed (no `status` field; redirect to bare `/login`; `unknown` still ejected).
- GREEN: same command — 11 passed.

### 4. Deadlocked checkout answered with a bare 500

Rows are locked in cart order, which the client controls, so two carts naming the
same counters in opposite order deadlock. SQLSTATE 40P01 is not an `ApiError`, so
`lib/api-response.ts` returned 500. A deadlock victim has rolled back whole — no
slots claimed, no stock drawn — which is what makes re-running safe.

`withTxRetry` retries 40P01 and 40001 only, with widening jittered gaps so two
victims do not re-collide in lockstep. Exhausted retries become a 409 naming the
one thing that works, rather than a generic failure that invites a reload and a
duplicate order.

- RED: `npx vitest run lib/db/tx-retry.test.ts` — module did not exist
  (compile-time RED; the test newly references the missing implementation).
- GREEN: same command — 11 passed.

### 5. A deposit policy with no QR to pay it into

Checkout blocks outright when a deposit is due and no active method has
`purpose = 'kahati_downpayment'` — correctly, since falling back to the
full-payment QR invites the whole-order payment on an unfilled kit that the
deposit exists to prevent. But policy and QR are configured on different admin
screens with nothing between them. **The live database is one save away from
this**: no policy row exists, and all four payment methods are `purpose='full'`.

`setKahatiDownpaymentPolicy` now refuses a real deposit while no active deposit
method exists. The packing-fee rule stays ungated — it collects no deposit, and
gating it would lock an admin out of the setting that undoes the mistake.

- RED: `npx vitest run lib/settings-downpayment-qr-guard.test.ts` — 4 failed
  ("promise resolved instead of rejecting").
- GREEN: same command — 7 passed.

### 6. Proofs the uploader invited and the route refused

`accept="image/*,application/pdf"` against a five-type allowlist. `isAcceptableProof`
now covers heif, avif, gif, bmp and `image/jpg`, and falls back to the file name
when the browser reports no type at all (Android file managers). A stated type
still settles it, so a video renamed `.png` is refused. The uploader applies the
same rules plus the 8 MB cap before the upload starts, naming the offending file.

This class of failure is invisible in the data by construction — a rejected
upload leaves no row, which is why the live proofs table shows only png, jpg,
jpeg, jfif and pdf.

- RED: `npx vitest run lib/proof-accept.test.ts` — `isAcceptableProof is not a function`.
- GREEN: same command — 8 passed.

### 7. A committed order reported as a failure

The receipt and analytics event run after commit but were awaited inside the
request, so a throw reached the customer as 500 for an order already in the
database. Both are now best-effort with a logged failure; both channels already
record their own fate (`email_log`, the posthog outcome).

- RED: `npx vitest run app/api/orders/notification-failure.test.ts` — 3 failed
  with `expected 500 to be 201`, while "leaves exactly one order behind" PASSED,
  proving the order really was committed.
- GREEN: same command — 5 passed.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A failed deposit-policy fetch says so instead of "please wait" | `app/checkout/policy-recovery.test.tsx` | component | PASS |
| 2 | A Try again button refetches the policy | `app/checkout/policy-recovery.test.tsx` | component | PASS |
| 3 | The order still cannot be placed while the rule is unknown | `app/checkout/policy-recovery.test.tsx` | component | PASS |
| 4 | An on-hand-only cart checks out even when the kahati rule is unreadable | `app/checkout/policy-recovery.test.tsx` | component | PASS |
| 5 | A 401 reports `unauthenticated`; a dropped request or 5xx retries | `lib/useAuth.test.tsx` | unit | PASS |
| 6 | Exhausted retries settle on `unknown`, never `unauthenticated` | `lib/useAuth.test.tsx` | unit | PASS |
| 7 | A 401 is not retried | `lib/useAuth.test.tsx` | unit | PASS |
| 8 | Only `unauthenticated` redirects, and it carries `?next=/checkout` | `app/checkout/session-recovery.test.tsx` | component | PASS |
| 9 | 40P01/40001 retry; 23505 and 42703 do not | `lib/db/tx-retry.test.ts` | unit | PASS |
| 10 | Retries are spaced, and the last error is rethrown when exhausted | `lib/db/tx-retry.test.ts` | unit | PASS |
| 11 | A deposit policy is refused with no active deposit QR, and stores nothing | `lib/settings-downpayment-qr-guard.test.ts` | integration | PASS |
| 12 | An inactive deposit method does not satisfy the guard | `lib/settings-downpayment-qr-guard.test.ts` | integration | PASS |
| 13 | The packing-fee rule stays saveable either way | `lib/settings-downpayment-qr-guard.test.ts` | integration | PASS |
| 14 | heic/heif/avif/gif/bmp/image-jpg are accepted; existing formats still are | `lib/proof-accept.test.ts` | unit | PASS |
| 15 | An untyped file falls back to its name; one with neither is refused | `lib/proof-accept.test.ts` | unit | PASS |
| 16 | A declared type outside the list is refused whatever the name says | `lib/proof-accept.test.ts` | unit | PASS |
| 17 | A failed receipt or analytics event still returns 201 with one order | `app/api/orders/notification-failure.test.ts` | integration | PASS |
| 18 | The happy path still sends both notifications | `app/api/orders/notification-failure.test.ts` | integration | PASS |

## Validation

```bash
npx vitest run     # 254 files, 2698 tests passed
npx tsc --noEmit   # exit 0
```

Nine pre-existing tests broke on the new deposit invariant — they configured a
deposit with no QR, which is the state now forbidden. They were updated to seed
one, as an admin would have to; `makePaymentMethod` gained `purpose` and
`makeDownpaymentMethod` wraps the common case. No assertion was weakened.

## Coverage and known gaps

The repo has no coverage script (`package.json` defines `test` only), so no
coverage number was produced; the suite is the project's own gate and it is
fully green.

Deliberately not covered:

- **The deadlock itself is not reproduced end-to-end.** `withTxRetry` is unit
  tested against synthesised driver errors. Provoking a real 40P01 needs two
  concurrent transactions against a shared database, and the suite runs on
  isolated in-memory PGlite per file. Worth a concurrency test against a real
  Postgres before relying on it heavily.
- **The `unknown` auth path is not exercised in a browser.** Recommended browser
  QA against PGlite + `STORAGE_DRIVER=local`: throttle or block `/api/settings`
  and `/api/auth/me` in devtools and confirm the retry card and that no redirect
  fires.
- **Proof acceptance is not verified against ImageKit.** Widening the allowlist
  means formats now reach `uploadToImageKit` that never did. ImageKit supports
  all of them, but a real upload of a `.heic` and an `.avif` against the
  configured account would confirm it.
- Findings 1–7 are fixes for causes found by reading the code and querying prod;
  no server-side log of actual customer failures was available to confirm which
  fired most often (no Vercel log access from this session).

## Merge evidence

RED → GREEN → refactor is preserved in six commits on `feat/group-buy-page`:

```
d2298e3 fix: accept the proofs customers actually send, and stop reporting a placed order as failed
5a948a7 test: add reproducers for the unusable proof refusal and the lying 500
1669fe4 fix: retry a deadlocked checkout, and refuse a deposit with no QR to pay it into
c77c7ce test: add reproducers for the deadlock 500 and the deposit-QR landmine
7b44019 fix: stop a dropped request from stranding a checkout
4bcab66 test: add reproducers for the two checkouts a dropped request strands
```

If these are squashed, this file is the surviving record of what was verified.

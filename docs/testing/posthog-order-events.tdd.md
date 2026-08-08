# TDD evidence — PostHog order events as the customer-email channel

**Source plan:** the `/ecc:plan` run of 2026-08-08 (inline, no `*.plan.md` written).
Direction chosen by the user: **PostHog Workflows sends the customer email**, from a
verified domain, with the domain set up **last**. `lib/email.ts` stays dormant
(`SMTP_HOST` unset) so there is never a double-send.

**Scope of this run.** The plan found the event-capture code already built and
committed on this branch — `lib/posthog.ts`, the four call sites, `lib/env.ts`
plumbing, `docs/posthog-events.md`, and 16 passing tests. There was no feature to
build. This run covers the one defect that audit turned up, plus the docs gap.

## User journey

> As a hatian customer who has just paid my final balance, I want the confirmation
> email to greet me by name, so that it reads like a message to me and not a
> mailing-list blast.

The app's own SMTP mail already honoured this. The PostHog path — which is the one
that will actually deliver — did not.

## Task report

### Task 1 — `settlement_placed` reached PostHog without the customer's name

**Summary.** `app/api/settlements/route.ts` selects `users.name` specifically so the
final-payment email can greet the customer; the comment at that line warns that
`"Salamat, ana@example.com!"` reads like a mailing-list blast. The `captureEvent`
call twelve lines below never passed it. PostHog resolves the greeting from `name`
via `$set`, so under the chosen direction every final-payment email would have gone
out addressed to an email address.

Not caught earlier because `route.test.ts:213` pins the guarantee for the SMTP mail
only, and SMTP is unset — so the assertion passed against a path that sends nothing.

**RED** — `npx vitest run app/api/settlements/events.test.ts`

```
× settlement events > carries the name so the email greets the customer, not their email address
  → expected undefined to be 'Test User' // Object.is equality
Tests  1 failed | 3 passed (4)
```

The other three passed, narrowing the defect to the name alone: the event does fire,
is addressed to the customer, and carries the totals.

**Fix** — `app/api/settlements/route.ts`: pass the already-fetched
`customer?.name` on the `captureEvent` call.

**GREEN** — `npx vitest run app/api/settlements/events.test.ts app/api/settlements/route.test.ts`

```
Test Files  2 passed (2)
     Tests  21 passed (21)
```

**Guaranteed:** the final-payment email can address the customer by name, and the
event carries the recipient, the settled order count and the totals.

### Task 2 — `settlement_placed` was undocumented

**Summary.** `docs/posthog-events.md` is what Phase 3 workflow authors build email
templates from. `settlement_placed` was missing from the event table and the
property list — a workflow author would not have known it exists.

Added: the table row, its property list (it is the one event not about a single
order, so it carries no `orderId`/`orderNo`/`status`), and an explicit note that
`order_status_changed` must get **no** workflow — it signals a status added without
a name in `ORDER_STATUS_EVENT` and needs a developer, not a customer email.

Docs only; no test.

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|---|---|---|---|
| 1 | `settlement_placed` fires on a successful final checkout, addressed to the customer | `app/api/settlements/events.test.ts:emits settlement_placed when the final checkout succeeds` | integration | PASS |
| 2 | The event carries the customer's name, so the email greets them rather than their address | `app/api/settlements/events.test.ts:carries the name so the email greets the customer` | integration | PASS |
| 3 | The event carries `orderCount` and a non-zero total | `app/api/settlements/events.test.ts:carries the totals the email has to state` | integration | PASS |
| 4 | A rejected settlement emits nothing — no email for a payment that did not happen | `app/api/settlements/events.test.ts:does not emit when the settlement is rejected` | integration | PASS |

Pre-existing coverage relied on and re-run: `lib/posthog.test.ts` (9 tests — skip
when unkeyed, `$set` shape, flush-per-capture, never-throws, one event name per
status) and `app/api/admin/orders/[id]/status/events.test.ts` (7 tests — per-status
emission, customer-not-admin identity, no emission on a rejected update).

## Coverage

Full suite: **1617 passed / 1617, 163 files** (`npx vitest run`, 149s) — up from
1613 before this run, no regressions.

Per-file coverage was not recomputed; this run added tests to an existing surface
and removed none. `npm run test:coverage` is not a defined script — the repo exposes
`npm test` (`vitest run`) with `@vitest/coverage-v8` available via `--coverage`.

## Known gaps

- **No test asserts an email is actually delivered.** Everything here stops at the
  event boundary. Delivery is PostHog-side config (Phases 2–4 of the plan) and is
  verifiable only against the live project.
- **The double-send trap is documented, not enforced.** Setting `SMTP_HOST` while
  workflows are live sends two emails per status change. Nothing in code prevents
  it. If that risk is worth closing, delete the send path from `lib/email.ts` and
  keep `email_log` as an audit trail — that is a behaviour change, so it is not
  bundled here.
- **`POSTHOG_KEY` is still unset**, so every capture logs `[posthog:skipped]`. That
  is the intended state until Phase 1 runs.

## Merge evidence

Checkpoint commits on `feat/group-buy-page`, in order:

- `9b1dc41` `test: add reproducer for the nameless settlement_placed event` (RED)
- `2d3a374` `fix: settlement_placed carries the customer's name` (GREEN)

No separate refactor commit — the fix was a single argument on an existing call.

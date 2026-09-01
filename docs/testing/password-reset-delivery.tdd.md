# Password reset delivery — TDD record

**Task:** *"Can you check our forgot password because its not working, no email is
sending and nothing is working."* (2026-09-02)

**Source plan:** none. The journeys below were derived during this TDD run from the
reported symptom and the code paths behind it.

## What was actually wrong

The token logic was never the problem. All 44 pre-existing tests across
`lib/password-reset.test.ts`, `app/api/auth/forgot-password/route.test.ts` and
`app/api/auth/reset-password/route.test.ts` passed untouched at the start of this
session. The failure was entirely in **delivery**, and it had three layers.

1. **Nothing transmitted the mail.** `lib/email.ts` listed `password_reset` in
   `SMTP_KINDS`, so the app would send it itself — but only when `env.smtpHost`
   is set, and `SMTP_HOST` is unset. Every reset went to `console.log`.

2. **The sender domain is dead.** `lib/env.ts:39` defaulted `MAIL_FROM` to
   `noreply@bbgpeptides.ph`. Verified by DNS lookup during this session:

   ```
   $ dig +short MX bbgpeptides.ph      # (empty)
   $ dig +short TXT bbgpeptides.ph     # (empty)
   $ dig +short A bbgpeptides.ph
   45.79.222.138                       # parking page
   ```

   No MX, no SPF, no DKIM. Mail claiming that origin fails DMARC alignment and is
   rejected or spam-binned by Gmail. `bbgph.org`, the real production host, also
   returns no MX and no TXT — so it is not a drop-in replacement either. This is
   now moot: PostHog sends from its own authenticated infrastructure.

3. **Both failures were invisible.** `sendEmail` caught every error and then wrote
   an `email_log` row with `sent_at = now()` regardless. A transmitted mail, a
   refused one, and one nothing would ever send produced identical rows. With no
   Vercel log access on this project, the `console.error` reached nobody. That is
   how 144 minted reset links between 2026-08-17 and 2026-08-31 read as 144
   successful sends while customers retried up to 13 times each.

## Decision taken

The operator chose **PostHog workflow delivery** for the reset (2026-09-02), and
"truthful log + admin view" for the visibility half.

A concern was raised before implementing and is recorded here rather than
silently worked around: `docs/posthog-events.md` documents that this event was
moved *off* PostHog on 2026-09-01 precisely because PostHog Workflows apply
re-entry rules and opt-out suppression — someone who entered the workflow once
could never enter again, which is what dropped the 144. Going back to PostHog
therefore works **only if that workflow allows unlimited re-entry and ignores
unsubscribe suppression.** The required settings are now written down as a table
in `docs/posthog-events.md`. The truthful log built here is what makes a repeat
visible instead of silent.

## User journeys

1. As a customer who forgot my password, I want the reset link to actually reach
   my inbox, so that I can get back into my account.
2. As a customer, I want a second attempt to work when the first mail never
   arrives, so that I am not locked out permanently.
3. As an admin, I want to see whether a notification was delivered, so that a
   broken email path is visible to me before customers complain.
4. As an admin, I want a notification that nothing is configured to send to be
   named as such, so that a missing workflow is a visible defect and not a
   silent one.

## Task report

| Task | Summary | Validation run | Result |
|---|---|---|---|
| Route delivery to PostHog | `SMTP_KINDS` emptied; `lib/email-delivery.ts` declares who delivers each kind | `npx vitest run lib/email-delivery.test.ts lib/email.delivery.test.ts` | RED → GREEN |
| Report the capture outcome | `captureEvent` returns `{ok, error?}` instead of `void`, still never throwing | `npx vitest run lib/posthog.test.ts` | RED → GREEN |
| Truthful audit row | `email_log` gains `delivered_by`, `status`, `error`; migration `0029` | `npx vitest run app/api/auth/forgot-password/route.test.ts` | RED → GREEN |
| Admin visibility | `GET /api/admin/emails` + `/admin/emails`, linked in the admin nav | `npx vitest run app/api/admin/emails/route.test.ts app/admin/emails/page.test.tsx` | RED → GREEN |

### RED evidence

```
$ npx vitest run lib/email-delivery.test.ts lib/email.delivery.test.ts \
    lib/posthog.test.ts app/api/auth/forgot-password/route.test.ts \
    app/api/admin/emails/route.test.ts app/admin/emails/page.test.tsx

 FAIL  lib/email-delivery.test.ts   Failed to load url ./email-delivery
 FAIL  app/api/admin/emails/route.test.ts   Failed to load url ./route
 FAIL  app/admin/emails/page.test.tsx   Failed to resolve import "./page"
 ❯ lib/posthog.test.ts (12 tests | 4 failed)
   × captureEvent outcome > reports success once the event has flushed
     AssertionError: expected undefined to deeply equal { ok: true }
 ❯ lib/email.delivery.test.ts (8 tests | 6 failed)
   × transmits nothing itself, even for the reset, even with SMTP configured
     AssertionError: expected "spy" to not be called at all, but actually been called 1 times
 ❯ app/api/auth/forgot-password/route.test.ts (15 tests | 3 failed)
   × records the reset as sent once PostHog accepted the event
     AssertionError: expected undefined to be 'posthog'

 Test Files  3 failed (3 unresolved) | 3 failed
      Tests  13 failed | 41 passed
```

Three modules did not exist (compile-time RED); the other ten failures were the
intended business-logic gaps. Checkpoint commit: `1b03578`.

### GREEN evidence

```
$ npx vitest run lib/email-delivery.test.ts lib/email.delivery.test.ts \
    lib/posthog.test.ts app/api/auth/forgot-password/route.test.ts \
    app/api/admin/emails/route.test.ts app/admin/emails/page.test.tsx
 Test Files  6 passed (6)
      Tests  54 passed (54)

$ npx tsc --noEmit --pretty false
(no output, exit 0)
```

The first full-suite run after the change failed two tests in
`lib/db/migrations-journal.test.ts` — the new `0029` SQL file had no entry in
`drizzle/meta/_journal.json`. That guard exists because exactly this omission
caused a production outage on migration 0013, so it was treated as a real
finding and the journal entry was added rather than the test relaxed.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | The password reset is delivered by PostHog, not transmitted by the app | `lib/email-delivery.test.ts:hands the password reset to PostHog` | unit | PASS |
| 2 | The app transmits nothing itself even when SMTP is configured, so nothing double-sends | `lib/email.delivery.test.ts:transmits nothing itself, even for the reset` | unit | PASS |
| 3 | A kind with no workflow behind it reports `none`, never a guessed `posthog` | `lib/email-delivery.test.ts:reports an unrecognised kind as undeliverable rather than guessing` | unit | PASS |
| 4 | `settlement_confirmed` is named undeliverable — nothing emits its event | `lib/email-delivery.test.ts:reports settlement_confirmed as undeliverable` | unit | PASS |
| 5 | A status added later stays deliverable via the `status_*` prefix | `lib/email-delivery.test.ts:hands any status_* kind to PostHog` | unit | PASS |
| 6 | `captureEvent` reports success, and reports failure with its reason, without throwing | `lib/posthog.test.ts:captureEvent outcome` (3 tests) | unit | PASS |
| 7 | A PostHog outage still cannot break a checkout | `lib/posthog.test.ts:never throws when PostHog is unreachable` | unit | PASS |
| 8 | A delivered reset is recorded `posthog`/`sent` | `app/api/auth/forgot-password/route.test.ts:records the reset as sent` | integration | PASS |
| 9 | A refused capture is recorded `failed` with the reason, not as a send | `.../route.test.ts:records the reset as failed, with the reason` | integration | PASS |
| 10 | Delivery failure still returns the generic answer and still issues the token | `.../route.test.ts:still answers generically and still issues the token` | integration | PASS |
| 11 | The event is captured before the audit row is written | `.../route.test.ts:captures the event before recording the audit row` | integration | PASS |
| 12 | The reset link still travels to PostHog as `resetUrl` | `.../route.test.ts:captures the reset event with the link` | integration | PASS |
| 13 | Admin can read each notification's delivery status | `app/api/admin/emails/route.test.ts:returns the delivery status` | integration | PASS |
| 14 | Admin can filter to failures alone, by kind, and by recipient | `.../route.test.ts` (3 tests) | integration | PASS |
| 15 | The list never returns the message body, which for a reset holds a live token | `.../route.test.ts:never returns the message body` | integration | PASS |
| 16 | The list is newest-first | `.../route.test.ts:puts the newest first` | integration | PASS |
| 17 | Only an admin can read the log | `.../route.test.ts:refuses a customer` / `refuses a signed-out caller` | integration | PASS |
| 18 | The screen leads with the count of unconfirmed deliveries | `app/admin/emails/page.test.tsx:leads with how many deliveries are not confirmed` | unit | PASS |
| 19 | A failure shows its reason on screen | `app/admin/emails/page.test.tsx:shows the reason a delivery failed` | unit | PASS |
| 20 | Every migration file has a journal entry | `lib/db/migrations-journal.test.ts` (6 tests) | unit | PASS |

## Coverage and known gaps

```
$ npx vitest run
 Test Files  247 passed (247)
      Tests  2651 passed (2651)

$ npx tsc --noEmit --pretty false
(no output, exit 0)
```

Deliberate gaps, none of them fixed here:

- **`queued` is the ceiling for the other kinds.** For the five call sites that
  emit their PostHog event separately, `sendEmail` records `queued` when
  `POSTHOG_KEY` is set and `skipped` when it is not. Threading the capture
  outcome through those routes the way `/api/auth/forgot-password` now does would
  upgrade them to `sent`/`failed`; it was left out to keep this change to the
  broken flow.
- **PostHog accepting an event is not proof the workflow sent the mail.** A
  `password_reset` row reading `sent` means the capture succeeded. If customers
  still report nothing arriving, the fault is in the workflow's re-entry or
  suppression settings, not in the app.
- **Two kinds nothing delivers at all.** `settlement_confirmed`
  (`app/api/admin/settlements/[id]/route.ts`) and the admin-side
  `order_receipt_updated` (`app/api/admin/orders/[id]/route.ts`) write an
  `email_log` row and fire no PostHog event. They now surface as `undeliverable`
  rather than looking sent, but neither is repaired.
- **The 144 historical rows stay `unknown`.** Backfilling them as `sent` would
  re-tell the exact lie these columns exist to end.
- **Production state unverified.** The Supabase MCP server failed to connect at
  session start, so no production data was read during this work. See below.

## Deployment

`drizzle/0029_email_log_delivery_status.sql` must be applied before this deploys,
or `npm run db:check` fails the Vercel prebuild on schema drift (the 5-7 second
"Error" symptom) and `/api/admin/emails` 503s on the missing columns.

// Who actually delivers each notification, and what the audit row is allowed to
// claim about it.
//
// Nothing in the code answered that question until now, and that is precisely
// how the password reset broke. Between 2026-08-17 and 2026-08-31 `email_log`
// gained 144 rows for `password_reset`, every one of them indistinguishable from
// a delivered mail, while nothing left the server at all. Customers retried up
// to 13 times each. A log that cannot tell "delivered" from "dropped on the
// floor" is worse than no log: it is what made a two-week outage invisible.
import { describe, it, expect } from 'vitest';
import { delivererFor, POSTHOG_KINDS } from './email-delivery';

describe('delivererFor', () => {
  // The operator's call on 2026-09-02: PostHog workflows send every customer
  // email, the reset included. See docs/posthog-events.md for the re-entry rule
  // that decision depends on.
  it('hands the password reset to PostHog', () => {
    expect(delivererFor('password_reset')).toBe('posthog');
  });

  it('hands every order notification to PostHog', () => {
    for (const kind of ['order_receipt', 'order_receipt_updated', 'settlement_placed', 'kahati_cancelled']) {
      expect(delivererFor(kind)).toBe('posthog');
    }
  });

  // The admin status route builds its kind as `status_${status}`, so a status
  // added later must not silently become undeliverable.
  it('hands any status_* kind to PostHog, including one added later', () => {
    expect(delivererFor('status_shipped')).toBe('posthog');
    expect(delivererFor('status_some_new_status')).toBe('posthog');
  });

  // Found while auditing the call sites: app/api/admin/settlements/[id] writes
  // an email_log row for settlement_confirmed and fires no PostHog event, so no
  // workflow can ever pick it up. Naming it 'none' is what puts it on screen.
  it('reports settlement_confirmed as undeliverable — nothing emits its event', () => {
    expect(delivererFor('settlement_confirmed')).toBe('none');
  });

  // Fail loud rather than assume. An unrecognised kind has no workflow behind
  // it by definition, and calling it 'posthog' would recreate the exact lie
  // this module exists to remove.
  it('reports an unrecognised kind as undeliverable rather than guessing', () => {
    expect(delivererFor('some_kind_nobody_wired_up')).toBe('none');
  });

  it('lists every PostHog-delivered kind so the set can be checked against the docs', () => {
    expect(POSTHOG_KINDS.has('password_reset')).toBe(true);
    expect(POSTHOG_KINDS.has('settlement_confirmed')).toBe(false);
  });
});

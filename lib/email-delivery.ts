// Who delivers each notification, and what an audit row is allowed to claim.
//
// Nothing in the code answered this until now, and the gap had a cost. Between
// 2026-08-17 and 2026-08-31 `email_log` gained 144 `password_reset` rows that
// were indistinguishable from delivered mail while nothing left the server;
// customers retried up to 13 times each. A row that cannot separate "delivered"
// from "dropped" is what makes an outage invisible, so delivery is named here
// once and both the writer (lib/email.ts) and the reader (Admin → Emails) use it.

/** Who is responsible for putting the mail in the customer's inbox. */
export type Deliverer = 'smtp' | 'posthog' | 'none';

/**
 * What actually became of one notification.
 *
 * - `sent`          the deliverer confirmed it
 * - `queued`        handed to PostHog; the workflow's own outcome is not visible here
 * - `failed`        the deliverer refused it — `error` says why
 * - `skipped`       nothing was configured to deliver it (a valid local/dev state)
 * - `undeliverable` no delivery route exists for this kind at all
 * - `unknown`       written before this column existed; genuinely not known
 */
export type DeliveryStatus = 'sent' | 'queued' | 'failed' | 'skipped' | 'undeliverable' | 'unknown';

/** Statuses that mean the customer may not have received the mail. */
export const PROBLEM_STATUSES: ReadonlySet<DeliveryStatus> = new Set<DeliveryStatus>([
  'failed', 'skipped', 'undeliverable', 'unknown',
]);

// Kinds this app transmits itself over SMTP.
//
// Deliberately empty. PostHog workflows deliver every customer email, the
// password reset included — the operator's call on 2026-09-02. Adding a kind
// here while its workflow is live puts two copies of the same mail in the inbox,
// so pause the workflow first. See docs/posthog-events.md.
const SMTP_KINDS: ReadonlySet<string> = new Set<string>();

// Kinds a live PostHog workflow picks up. A kind absent from here has nothing
// listening for it, which is a defect worth seeing rather than a default worth
// assuming.
export const POSTHOG_KINDS: ReadonlySet<string> = new Set([
  'password_reset',
  'order_receipt',
  'order_receipt_updated',
  'settlement_placed',
  'kahati_cancelled',
]);

// The admin status route builds its kind as `status_${status}` (app/api/admin/
// orders/[id]/status/route.ts), and lib/posthog.ts already emits a generic event
// for a status nobody named. Matching the prefix keeps a status added later
// deliverable instead of silently orphaning its mail.
const STATUS_KIND = /^status_/;

/**
 * Who delivers `kind`.
 *
 * Unrecognised kinds report `none`, not `posthog`. Guessing would recreate the
 * exact false confidence this module exists to remove: `settlement_confirmed`
 * writes a log row and emits no event, so no workflow can ever pick it up, and
 * that has to show on the screen rather than read as a successful send.
 */
export function delivererFor(kind: string): Deliverer {
  if (SMTP_KINDS.has(kind)) return 'smtp';
  if (POSTHOG_KINDS.has(kind) || STATUS_KIND.test(kind)) return 'posthog';
  return 'none';
}

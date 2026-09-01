// Server-side PostHog capture.
//
// PostHog is the delivery mechanism for customer notifications: a destination
// listens for each order event and sends the Gmail. That makes these events part
// of the product, not just telemetry — a dropped event is a customer who never
// hears from us, so every event carries the recipient's address and person
// properties needed to address the mail.
//
// Two rules follow from sitting in the checkout and admin paths:
//   1. Never throw. A PostHog outage must not fail an order.
//   2. Flush on every capture. Serverless invocations end before a batching
//      client would ever send.
//
// Never throwing used to mean never reporting either: the outcome was swallowed
// and the caller wrote an email_log row claiming a send it had not observed. So
// captureEvent returns what happened instead. Still no throw — the caller
// records the failure rather than propagating it.
import { PostHog } from 'posthog-node';
import { env } from './env';

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (!env.posthogKey) return null;
  if (!client) {
    client = new PostHog(env.posthogKey, {
      host: env.posthogHost,
      flushAt: 1,        // send on the first event…
      flushInterval: 0,  // …and never wait on a timer we won't live to see
    });
  }
  return client;
}

// One event name per order status, so a PostHog action can trigger the matching
// email on the event name alone. `status` is also sent as a property for anyone
// who would rather filter generically.
export const ORDER_STATUS_EVENT: Record<string, string> = {
  proof_review: 'order_proof_review',
  payment_confirmed: 'order_payment_confirmed',
  batch_filling: 'order_batch_filling',
  shipped: 'order_shipped',
  delivered: 'order_delivered',
  cancelled: 'order_cancelled',
};

// Unknown statuses still emit — a generic event is recoverable in PostHog,
// a silently dropped one is not.
export function orderStatusEvent(status: string): string {
  return ORDER_STATUS_EVENT[status] ?? 'order_status_changed';
}

export type CaptureInput = {
  event: string;
  distinctId: string;              // the customer's user id, never the admin's
  email: string;                   // recipient — PostHog addresses the mail with this
  name?: string;
  properties?: Record<string, unknown>;
};

/**
 * What became of a capture. `ok: false` is not an exception — the caller records
 * it on the email_log row so an undelivered notification can be seen later.
 */
export type CaptureOutcome = { ok: boolean; error?: string };

export async function captureEvent(
  { event, distinctId, email, name, properties }: CaptureInput,
): Promise<CaptureOutcome> {
  const posthog = getClient();
  if (!posthog) {
    // Unconfigured is a valid local/dev state, but it is not a delivery. Saying
    // so is what stops a dev-shaped production reading as a working one.
    console.log(`[posthog:skipped] ${event} -> ${email}`);
    return { ok: false, error: 'POSTHOG_KEY is not set, so nothing was sent.' };
  }
  try {
    posthog.capture({
      distinctId,
      event,
      properties: {
        ...properties,
        email,
        // $set writes person properties, which is how a PostHog email destination
        // resolves who to send to.
        $set: { email, ...(name ? { name } : {}) },
      },
    });
    await posthog.flush();
    return { ok: true };
  } catch (err) {
    console.error(`[posthog] capture failed for ${event}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

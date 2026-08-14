// What an order's status says to the person who placed it.
//
// The stored enum is operational vocabulary — 'proof_review', 'batch_filling' —
// written for whoever is packing the parcel. A customer reading "Batch filling"
// on their own order has to guess. These tests pin the customer-facing wording
// to the stored value so the two can never drift: the label is always DERIVED
// from what the backend holds, never set alongside it.
import { describe, it, expect } from 'vitest';
import { ORDER_STATUS_FLOW } from '@/lib/db/schema';
import {
  STATUS_FLOW, STATUS_LABEL, STATUS_BADGE,
  statusIndex, isCancelledStatus, statusSteps,
} from './order-status';

describe('customer-facing status labels', () => {
  it('names each stored status in words a customer can act on', () => {
    expect(STATUS_LABEL.proof_review).toBe('Payment Pending');
    expect(STATUS_LABEL.payment_confirmed).toBe('Payment Confirmed');
    expect(STATUS_LABEL.batch_filling).toBe('Processing');
    expect(STATUS_LABEL.shipped).toBe('Shipped');
    expect(STATUS_LABEL.delivered).toBe('Delivered');
    expect(STATUS_LABEL.cancelled).toBe('Cancelled');
  });

  // A status added to the enum without a label renders as blank in My Orders —
  // the customer is told nothing at all. Reading the enum from the schema means
  // that gap fails here instead of in production.
  it('labels and styles every value the schema can store', () => {
    for (const status of [...ORDER_STATUS_FLOW, 'cancelled']) {
      expect(STATUS_LABEL[status], `no label for "${status}"`).toBeTruthy();
      expect(STATUS_BADGE[status], `no badge for "${status}"`).toBeTruthy();
    }
  });

  it('keeps the trail in the order the enum declares it', () => {
    expect([...STATUS_FLOW]).toEqual([...ORDER_STATUS_FLOW]);
  });
});

describe('statusSteps', () => {
  it('marks everything before the current status done, and the rest pending', () => {
    const steps = statusSteps('shipped');

    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'active', 'pending']);
    expect(steps.find((s) => s.state === 'active')?.label).toBe('Shipped');
  });

  it('has no pending step left once the order is delivered', () => {
    const steps = statusSteps('delivered');

    expect(steps.at(-1)).toMatchObject({ key: 'delivered', state: 'active' });
    expect(steps.some((s) => s.state === 'pending')).toBe(false);
  });

  it('starts the trail at the first step for a brand-new order', () => {
    expect(statusSteps('proof_review').map((s) => s.state))
      .toEqual(['active', 'pending', 'pending', 'pending', 'pending']);
  });
});

// A cancelled order is not "at step -1". Indexing it into the flow drew every
// step as not-yet-reached, which is exactly how an untouched new order looks —
// so the screen said nothing had happened yet to an order that had been called
// off. Cancellation is its own state and has to be asked about separately.
describe('a cancelled order', () => {
  it('is reported as cancelled rather than as an unreached step', () => {
    expect(isCancelledStatus('cancelled')).toBe(true);
    expect(isCancelledStatus('proof_review')).toBe(false);
  });

  it('never claims a step of the flow is in progress', () => {
    const steps = statusSteps('cancelled');
    expect(steps.some((s) => s.state === 'active')).toBe(false);
    expect(steps.some((s) => s.state === 'done')).toBe(false);
  });
});

// Unknown values reach this code from legacy rows and from an enum extended on
// the server before the client redeploys. Neither may render as "delivered".
describe('an unrecognised status', () => {
  it('is not treated as a completed order', () => {
    expect(statusIndex('something_new')).toBe(-1);
    const steps = statusSteps('something_new');
    expect(steps.every((s) => s.state === 'pending')).toBe(true);
  });
});

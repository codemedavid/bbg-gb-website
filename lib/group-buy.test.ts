import { describe, it, expect } from 'vitest';
import {
  applyCampaignAction, canCommit, campaignOutcome,
  batchCapacity, isBatchFull, planBatchAllocation, nextBatchDeadline,
  MOQ_BATCH_MAX_KITS,
} from './group-buy';

describe('applyCampaignAction', () => {
  it('approves an open campaign', () => {
    expect(applyCampaignAction('open', 'approve')).toEqual({ ok: true, status: 'approved' });
  });
  it('cancels an open campaign', () => {
    expect(applyCampaignAction('open', 'cancel')).toEqual({ ok: true, status: 'cancelled' });
  });
  it('extends an open campaign, keeping it open', () => {
    expect(applyCampaignAction('open', 'extend')).toEqual({ ok: true, status: 'open' });
  });
  it('refuses to act on an already-approved campaign', () => {
    const r = applyCampaignAction('approved', 'cancel');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/approved/);
  });
  it('refuses to act on a cancelled campaign', () => {
    expect(applyCampaignAction('cancelled', 'approve').ok).toBe(false);
    expect(applyCampaignAction('cancelled', 'extend').ok).toBe(false);
  });
  // A completed batch is full and already proceeding, so approving or extending
  // it is meaningless — but a supplier can still fall through after the fact,
  // and the admin has to be able to cancel and refund it.
  it('lets the admin cancel a completed batch, but not approve or extend it', () => {
    expect(applyCampaignAction('completed', 'cancel')).toEqual({ ok: true, status: 'cancelled' });
    expect(applyCampaignAction('completed', 'approve').ok).toBe(false);
    expect(applyCampaignAction('completed', 'extend').ok).toBe(false);
  });
});

describe('canCommit', () => {
  it('allows commitments only while the campaign is open', () => {
    expect(canCommit('open')).toBe(true);
    expect(canCommit('approved')).toBe(false);
    expect(canCommit('cancelled')).toBe(false);
    // A completed batch is closed the moment it fills; the commitment belongs
    // in its successor, which the commit route opens.
    expect(canCommit('completed')).toBe(false);
  });
});

describe('campaignOutcome', () => {
  it('is refunded when cancelled, regardless of commitments', () => {
    expect(campaignOutcome('cancelled', 100, 10)).toBe('refunded');
  });
  it('is processing when admin-approved below MOQ', () => {
    expect(campaignOutcome('approved', 3, 10)).toBe('processing');
  });
  it('is processing when open and MOQ is reached', () => {
    expect(campaignOutcome('open', 10, 10)).toBe('processing');
    expect(campaignOutcome('open', 12, 10)).toBe('processing');
  });
  it('is awaiting_moq when open and below MOQ', () => {
    expect(campaignOutcome('open', 6, 10)).toBe('awaiting_moq');
  });
  it('is processing once the batch completed — a full batch is on its way', () => {
    expect(campaignOutcome('completed', 10, 10)).toBe('processing');
  });
});

describe('batchCapacity', () => {
  it('is the campaign MOQ when that sits at or under the 10-kit ceiling', () => {
    expect(batchCapacity(10)).toBe(10);
    expect(batchCapacity(6)).toBe(6);
  });
  it('clamps a legacy over-ceiling MOQ down to 10 — the cap is absolute', () => {
    expect(batchCapacity(25)).toBe(MOQ_BATCH_MAX_KITS);
    expect(MOQ_BATCH_MAX_KITS).toBe(10);
  });
  it('floors at 1 so a zero or negative MOQ cannot make a batch that accepts nothing', () => {
    expect(batchCapacity(0)).toBe(1);
    expect(batchCapacity(-4)).toBe(1);
  });
});

describe('isBatchFull', () => {
  it('is full at the capacity, and stays full above it', () => {
    expect(isBatchFull(9, 10)).toBe(false);
    expect(isBatchFull(10, 10)).toBe(true);
    // A legacy row written before the cap existed must never read as "still open".
    expect(isBatchFull(13, 10)).toBe(true);
  });
});

// The three worked examples from the spec. planBatchAllocation is the whole
// splitting rule as a pure function: given what the open batch already holds,
// how much of the order lands in it and in each batch opened after it.
describe('planBatchAllocation', () => {
  it('fills the open batch and rolls the overflow into a fresh one (8/10 + 5)', () => {
    expect(planBatchAllocation(5, 8, 10)).toEqual([
      { qty: 2, fills: true },
      { qty: 3, fills: false },
    ]);
  });

  it('starts a new batch when the current one is already complete (10/10 + 4)', () => {
    expect(planBatchAllocation(4, 10, 10)).toEqual([
      { qty: 4, fills: false },
    ]);
  });

  it('spans as many batches as the order needs (9/10 + 14)', () => {
    expect(planBatchAllocation(14, 9, 10)).toEqual([
      { qty: 1, fills: true },
      { qty: 10, fills: true },
      { qty: 3, fills: false },
    ]);
  });

  it('completes the batch without opening an empty one when the order fits exactly', () => {
    expect(planBatchAllocation(2, 8, 10)).toEqual([{ qty: 2, fills: true }]);
  });

  it('leaves the batch open when the order only partly fills it', () => {
    expect(planBatchAllocation(3, 0, 10)).toEqual([{ qty: 3, fills: false }]);
  });

  it('never plans a fragment larger than the capacity', () => {
    const plan = planBatchAllocation(37, 0, 10);
    expect(plan.every((f) => f.qty <= 10)).toBe(true);
    expect(plan.reduce((s, f) => s + f.qty, 0)).toBe(37);
  });

  it('allocates every ordered kit exactly once, for any starting fill', () => {
    for (let committed = 0; committed <= 10; committed++) {
      for (let qty = 1; qty <= 25; qty++) {
        const plan = planBatchAllocation(qty, committed, 10);
        expect(plan.reduce((s, f) => s + f.qty, 0)).toBe(qty);
        expect(plan.every((f) => f.qty > 0)).toBe(true);
      }
    }
  });

  it('plans nothing for a non-positive order', () => {
    expect(planBatchAllocation(0, 0, 10)).toEqual([]);
  });
});

describe('nextBatchDeadline', () => {
  const created = new Date('2026-07-01T00:00:00Z');
  const now = new Date('2026-07-08T00:00:00Z');

  it('gives the sibling the same window length, measured from now', () => {
    const deadline = new Date('2026-07-11T00:00:00Z'); // a 10-day window
    expect(nextBatchDeadline(created, deadline, now)).toEqual(new Date('2026-07-18T00:00:00Z'));
  });
  it('carries no deadline when the parent had none', () => {
    expect(nextBatchDeadline(created, null, now)).toBeNull();
  });
  it('never produces a window that runs backwards', () => {
    const past = new Date('2026-06-20T00:00:00Z'); // deadline before creation
    expect(nextBatchDeadline(created, past, now)).toEqual(now);
  });
});

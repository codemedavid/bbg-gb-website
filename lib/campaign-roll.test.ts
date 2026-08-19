// Ending a running batch and opening its successor — the lifecycle rule.
//
// "Approve" ends a batch and leaves the series with nothing open, which is why
// an admin who wanted the next batch had to hand-create a campaign — and got a
// fresh series #1 instead of batch #2, splitting the group buy in two on the
// board. `roll` is the action that ends one batch AND opens the next inside the
// same series. This file pins the rule; the write lives in moq-batch-server.
import { describe, it, expect } from 'vitest';
import { applyCampaignAction, canRollBatch } from './group-buy';

describe('applyCampaignAction — roll', () => {
  // A rolled batch reads as 'approved', the same as one the admin approved by
  // hand: it ran, it closed, and it proceeds to the supplier. The difference is
  // only that its successor opens in the same breath.
  it('ends a running batch as approved', () => {
    expect(applyCampaignAction('open', 'roll')).toEqual({ ok: true, status: 'approved' });
  });

  it('refuses to roll a batch that is not running', () => {
    expect(applyCampaignAction('approved', 'roll').ok).toBe(false);
    expect(applyCampaignAction('cancelled', 'roll').ok).toBe(false);
    expect(applyCampaignAction('scheduled', 'roll').ok).toBe(false);
  });

  // A completed batch already opened its successor when it filled. Rolling it
  // would mint a second one and split the series.
  it('refuses to roll a completed batch, which already has a successor', () => {
    const r = applyCampaignAction('completed', 'roll');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/complete/i);
  });
});

describe('canRollBatch', () => {
  it('allows rolling only a batch that is open', () => {
    expect(canRollBatch('open')).toBe(true);
    expect(canRollBatch('approved')).toBe(false);
    expect(canRollBatch('completed')).toBe(false);
    expect(canRollBatch('cancelled')).toBe(false);
    expect(canRollBatch('scheduled')).toBe(false);
  });
});

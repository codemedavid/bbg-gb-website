import { describe, it, expect } from 'vitest';
import { applyCampaignAction, canCommit, campaignOutcome } from './group-buy';

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
});

describe('canCommit', () => {
  it('allows commitments only while the campaign is open', () => {
    expect(canCommit('open')).toBe(true);
    expect(canCommit('approved')).toBe(false);
    expect(canCommit('cancelled')).toBe(false);
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
});

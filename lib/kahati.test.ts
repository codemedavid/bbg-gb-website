import { describe, it, expect } from 'vitest';
import {
  KAHATI_MAX_VIALS, isKahatiFull, resolveExpiredKahatiStatus, nextKahatiClosesAt,
  kahatiProgressPercent, kahatiBadge,
} from './kahati';

describe('KAHATI_MAX_VIALS', () => {
  it('caps a hatian counter at one kit (10 vials)', () => {
    expect(KAHATI_MAX_VIALS).toBe(10);
  });
});

describe('isKahatiFull', () => {
  it('is false below the cap', () => {
    expect(isKahatiFull(9, 10)).toBe(false);
  });
  it('is true exactly at the cap', () => {
    expect(isKahatiFull(10, 10)).toBe(true);
  });
  it('is true past the cap (defensive against over-count edits)', () => {
    expect(isKahatiFull(11, 10)).toBe(true);
  });
});

describe('resolveExpiredKahatiStatus', () => {
  it('closes a hatian that reached the cap', () => {
    expect(resolveExpiredKahatiStatus(10, 10)).toBe('closed');
  });
  it('cancels a hatian that fell short of the cap', () => {
    expect(resolveExpiredKahatiStatus(6, 10)).toBe('cancelled');
  });
});

describe('nextKahatiClosesAt', () => {
  it('gives the sibling the same window length measured from now', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const closesAt = new Date('2026-01-03T00:00:00Z'); // 2-day window
    const now = new Date('2026-01-05T12:00:00Z');
    expect(nextKahatiClosesAt(createdAt, closesAt, now)).toEqual(new Date('2026-01-07T12:00:00Z'));
  });
  it('carries no deadline when the parent has none', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    expect(nextKahatiClosesAt(createdAt, null, new Date('2026-01-05T00:00:00Z'))).toBeNull();
  });
  it('never yields a negative window when the parent is already expired', () => {
    const createdAt = new Date('2026-01-03T00:00:00Z');
    const closesAt = new Date('2026-01-01T00:00:00Z'); // closes before created (degenerate)
    const now = new Date('2026-01-10T00:00:00Z');
    expect(nextKahatiClosesAt(createdAt, closesAt, now)).toEqual(now);
  });
});

describe('kahatiProgressPercent', () => {
  it('reports 0% on a brand-new hatian (default 0 vials claimed)', () => {
    expect(kahatiProgressPercent(0, 10)).toBe(0);
  });
  it('scales linearly up to the cap', () => {
    expect(kahatiProgressPercent(3, 10)).toBe(30);
    expect(kahatiProgressPercent(10, 10)).toBe(100);
  });
  it('clamps past the cap so the bar never overflows', () => {
    expect(kahatiProgressPercent(12, 10)).toBe(100);
  });
  it('returns 0 — never NaN — when the cap is zero', () => {
    expect(kahatiProgressPercent(0, 0)).toBe(0);
  });
  it('never goes negative on a degenerate claimed count', () => {
    expect(kahatiProgressPercent(-5, 10)).toBe(0);
  });
});

describe('kahatiBadge', () => {
  it('marks a closed hatian regardless of its counts', () => {
    expect(kahatiBadge('closed', 4, 10)).toBe('CLOSED');
    expect(kahatiBadge('cancelled', 0, 10)).toBe('CLOSED');
  });
  it('shows OPEN on a fresh hatian rather than "10 VIALS LEFT"', () => {
    // Regression: the old `remaining <= 10` threshold was always true at a
    // 10-vial cap, so every hatian rendered as "N VIALS LEFT".
    expect(kahatiBadge('open', 0, 10)).toBe('OPEN');
  });
  it('warns that it is filling fast once half the kit is claimed', () => {
    expect(kahatiBadge('open', 5, 10)).toBe('FILLING FAST');
  });
  it('counts down the last few vials', () => {
    expect(kahatiBadge('open', 8, 10)).toBe('2 VIALS LEFT');
    expect(kahatiBadge('open', 9, 10)).toBe('1 VIAL LEFT');
  });
});

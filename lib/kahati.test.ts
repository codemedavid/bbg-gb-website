import { describe, it, expect } from 'vitest';
import {
  KAHATI_MAX_VIALS, KAHATI_MIN_VIABLE_VIALS, isKahatiFull, isKahatiViable,
  resolveExpiredKahatiStatus, nextKahatiClosesAt, kahatiProgressPercent, kahatiBadge,
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

describe('KAHATI_MIN_VIABLE_VIALS', () => {
  it('makes a hatian viable at 7 vials, below the 10-vial cap', () => {
    expect(KAHATI_MIN_VIABLE_VIALS).toBe(7);
    expect(KAHATI_MIN_VIABLE_VIALS).toBeLessThan(KAHATI_MAX_VIALS);
  });
});

describe('isKahatiViable', () => {
  it('is false one vial short of the minimum', () => {
    expect(isKahatiViable(6)).toBe(false);
  });
  it('is true exactly at the minimum — "Good to Go"', () => {
    expect(isKahatiViable(7)).toBe(true);
  });
  it('stays true between the minimum and the cap', () => {
    expect(isKahatiViable(8)).toBe(true);
    expect(isKahatiViable(10)).toBe(true);
  });
  it('is false on an empty hatian', () => {
    expect(isKahatiViable(0)).toBe(false);
  });
});

describe('resolveExpiredKahatiStatus', () => {
  it('closes a hatian that reached the cap', () => {
    expect(resolveExpiredKahatiStatus(10)).toBe('closed');
  });
  it('closes a hatian that met the 7-vial minimum without filling the kit', () => {
    // The rule that changed: 7-9 vials at expiry is a success, not a cancellation.
    expect(resolveExpiredKahatiStatus(7)).toBe('closed');
    expect(resolveExpiredKahatiStatus(9)).toBe('closed');
  });
  it('cancels a hatian that fell short of the minimum', () => {
    expect(resolveExpiredKahatiStatus(6)).toBe('cancelled');
    expect(resolveExpiredKahatiStatus(0)).toBe('cancelled');
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
  it('counts down what is still needed to reach the 7-vial minimum', () => {
    expect(kahatiBadge('open', 0, 10)).toBe('OPEN');
    expect(kahatiBadge('open', 5, 10)).toBe('2 MORE TO GO');
    expect(kahatiBadge('open', 6, 10)).toBe('1 MORE TO GO');
  });
  it('reads GOOD TO GO once the minimum is met but the kit is not full', () => {
    expect(kahatiBadge('open', 7, 10)).toBe('GOOD TO GO');
    expect(kahatiBadge('open', 9, 10)).toBe('GOOD TO GO');
  });
  it('reads FULL at the cap', () => {
    expect(kahatiBadge('open', 10, 10)).toBe('FULL');
  });
});

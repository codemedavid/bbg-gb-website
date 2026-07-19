import { describe, it, expect } from 'vitest';
import {
  KAHATI_MAX_VIALS, isKahatiFull, resolveExpiredKahatiStatus, nextKahatiClosesAt,
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

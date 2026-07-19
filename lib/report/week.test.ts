import { describe, it, expect } from 'vitest';
import {
  addDays, mondayOf, isoWeekNumber, formatRange, weekOptionLabel, weekFilename,
  weekBounds, mostRecentFullWeekMonday, recentWeekMondays, manilaYmd, isValidYmd,
} from './week';

describe('week math', () => {
  it('finds the Monday of any weekday', () => {
    expect(mondayOf('2026-05-25')).toBe('2026-05-25'); // Monday
    expect(mondayOf('2026-05-31')).toBe('2026-05-25'); // Sunday → same week's Monday
    expect(mondayOf('2026-05-27')).toBe('2026-05-25'); // Wednesday
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-05-31', 1)).toBe('2026-06-01');
    expect(addDays('2026-05-25', -7)).toBe('2026-05-18');
  });

  it('computes ISO week numbers', () => {
    expect(isoWeekNumber('2026-05-25')).toBe(22);
  });

  it('formats the Mon–Sun range', () => {
    expect(formatRange('2026-05-25')).toBe('Mon May 25 – Sun May 31');
  });

  it('builds dropdown label and filename', () => {
    expect(weekOptionLabel('2026-05-25')).toBe('Week 22 · Mon May 25 – Sun May 31');
    expect(weekFilename('2026-05-25')).toBe('BBG-Week-2026-05-25.pdf');
  });

  it('bounds a week as a half-open +08:00 interval', () => {
    const { start, end } = weekBounds('2026-05-25');
    expect(start.toISOString()).toBe('2026-05-24T16:00:00.000Z'); // Mon 00:00 Manila
    expect(end.toISOString()).toBe('2026-05-31T16:00:00.000Z');   // next Mon 00:00 Manila
  });

  it('reads the Manila calendar date across the UTC day boundary', () => {
    // 2026-05-25T20:00Z is 2026-05-26 04:00 in Manila.
    expect(manilaYmd(new Date('2026-05-25T20:00:00Z'))).toBe('2026-05-26');
  });

  it('picks the most recent fully completed week', () => {
    // Wed 2026-06-03 Manila → current week Mon = 06-01 → last full week Mon = 05-25.
    expect(mostRecentFullWeekMonday(new Date('2026-06-03T02:00:00Z'))).toBe('2026-05-25');
  });

  it('lists recent weeks newest-first', () => {
    const weeks = recentWeekMondays(new Date('2026-06-03T02:00:00Z'), 3);
    expect(weeks).toEqual(['2026-05-25', '2026-05-18', '2026-05-11']);
  });

  it('validates YYYY-MM-DD', () => {
    expect(isValidYmd('2026-05-25')).toBe(true);
    expect(isValidYmd('2026-13-40')).toBe(false);
    expect(isValidYmd('nope')).toBe(false);
  });
});

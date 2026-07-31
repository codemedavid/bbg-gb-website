// The hatian board leads with the counters closest to filling.
//
// Sorting by demand rather than by recency is what makes the board useful: a
// customer who wants their vial soon should see the 9/10 counter before the 0/10
// one that opened this morning. The rule is pure so the board, a report or a
// future admin view all order the list identically.
import { describe, it, expect } from 'vitest';
import { sortHatiansByDemand } from '@/lib/kahati';

type Row = { id: string; claimedSlots: number; createdAt: string };

const row = (id: string, claimedSlots: number, createdAt: string): Row => ({ id, claimedSlots, createdAt });

const idsOf = (rows: readonly Row[]): string[] => rows.map((r) => r.id);

describe('sortHatiansByDemand', () => {
  it('leads with the counter that has the most vials committed', () => {
    // Arrange — the worked example from the requirement, deliberately shuffled.
    const rows = [
      row('C', 6, '2026-08-01T00:00:00.000Z'),
      row('A', 9, '2026-08-01T00:00:00.000Z'),
      row('E', 0, '2026-08-01T00:00:00.000Z'),
      row('B', 8, '2026-08-01T00:00:00.000Z'),
      row('D', 3, '2026-08-01T00:00:00.000Z'),
    ];

    // Act
    const sorted = sortHatiansByDemand(rows);

    // Assert
    expect(idsOf(sorted)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('breaks a tie by putting the earliest-created counter first', () => {
    // The counter that has been waiting longest deserves to fill first —
    // otherwise two equal counters trade places on every reload.
    const rows = [
      row('newer', 5, '2026-08-05T00:00:00.000Z'),
      row('older', 5, '2026-08-01T00:00:00.000Z'),
    ];

    expect(idsOf(sortHatiansByDemand(rows))).toEqual(['older', 'newer']);
  });

  it('is stable and total: equal progress AND equal creation keep input order', () => {
    const rows = [row('first', 4, '2026-08-01T00:00:00.000Z'), row('second', 4, '2026-08-01T00:00:00.000Z')];
    expect(idsOf(sortHatiansByDemand(rows))).toEqual(['first', 'second']);
  });

  it('does not mutate the array it was given', () => {
    // The route maps the DB rows and then sorts; an in-place sort would reorder
    // a caller's array under it. Immutability is the house rule.
    const rows = [row('A', 1, '2026-08-01T00:00:00.000Z'), row('B', 9, '2026-08-01T00:00:00.000Z')];
    const before = idsOf(rows);

    sortHatiansByDemand(rows);

    expect(idsOf(rows)).toEqual(before);
  });

  it('handles an empty board', () => {
    expect(sortHatiansByDemand([])).toEqual([]);
  });

  it('sorts on the vials actually claimed, not on a percentage of differing caps', () => {
    // A legacy counter with a bigger cap can be a lower percentage while holding
    // more vials. The requirement is "most vials committed", so vials win.
    const rows = [
      row('half-of-100', 40, '2026-08-01T00:00:00.000Z'),
      row('nearly-full-10', 9, '2026-08-01T00:00:00.000Z'),
    ];

    expect(idsOf(sortHatiansByDemand(rows))).toEqual(['half-of-100', 'nearly-full-10']);
  });

  it('orders an unparseable creation date last among its tie group instead of throwing', () => {
    const rows = [
      row('bad-date', 5, 'not-a-date'),
      row('good-date', 5, '2026-08-01T00:00:00.000Z'),
    ];

    expect(idsOf(sortHatiansByDemand(rows))).toEqual(['good-date', 'bad-date']);
  });
});

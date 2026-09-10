// What is on a board, and what is in the archive.
//
// "Start new cycle should make everything go back to 0." A board after a cycle
// turns is this cycle's board: the listings still trading, plus whatever ended
// in this same cycle. Everything older is filed under the cycle it traded in.
import { describe, it, expect } from 'vitest';
import {
  isOnKahatiBoard, isOnCampaignBoard, summarizeCycles, cycleLabel,
} from './cycle-archive';

const NOW = '2026-09-11T20:00:00.000Z';
const LAST = '2026-09-05T14:00:00.000Z';

describe('isOnKahatiBoard', () => {
  it('keeps every trading counter, whatever cycle it was stamped with', () => {
    expect(isOnKahatiBoard({ status: 'open', cycleKey: LAST }, NOW)).toBe(true);
    expect(isOnKahatiBoard({ status: 'pasalo', cycleKey: LAST }, NOW)).toBe(true);
    expect(isOnKahatiBoard({ status: 'scheduled', cycleKey: null }, NOW)).toBe(true);
  });

  it('keeps a counter that ended in the current cycle', () => {
    expect(isOnKahatiBoard({ status: 'closed', cycleKey: NOW }, NOW)).toBe(true);
    expect(isOnKahatiBoard({ status: 'cancelled', cycleKey: NOW }, NOW)).toBe(true);
  });

  it('files a counter that ended in an earlier cycle', () => {
    expect(isOnKahatiBoard({ status: 'closed', cycleKey: LAST }, NOW)).toBe(false);
    expect(isOnKahatiBoard({ status: 'completed', cycleKey: LAST }, NOW)).toBe(false);
  });

  // A finished counter that never traded under a cycle is history from before
  // cycles were named; with no cycle to belong to, it is not this one's.
  it('files an ended counter with no cycle at all', () => {
    expect(isOnKahatiBoard({ status: 'closed', cycleKey: null }, NOW)).toBe(false);
  });

  it('shows only trading counters when no cycle has ever opened', () => {
    expect(isOnKahatiBoard({ status: 'open', cycleKey: null }, null)).toBe(true);
    expect(isOnKahatiBoard({ status: 'closed', cycleKey: null }, null)).toBe(false);
  });
});

describe('isOnCampaignBoard', () => {
  it('keeps open and scheduled batches', () => {
    expect(isOnCampaignBoard({ status: 'open', cycleKey: LAST }, NOW)).toBe(true);
    expect(isOnCampaignBoard({ status: 'scheduled', cycleKey: null }, NOW)).toBe(true);
  });

  // An approved batch is proceeding, not trading: it stays on the board only
  // for the cycle it was approved in, then goes to the archive with its kits.
  it('keeps an approved batch only for its own cycle', () => {
    expect(isOnCampaignBoard({ status: 'approved', cycleKey: NOW }, NOW)).toBe(true);
    expect(isOnCampaignBoard({ status: 'approved', cycleKey: LAST }, NOW)).toBe(false);
  });
});

describe('summarizeCycles', () => {
  it('lists one row per cycle, newest first, with what each holds', () => {
    const rows = summarizeCycles({
      orders: [
        { cycleKey: LAST, status: 'paid' },
        { cycleKey: LAST, status: 'cancelled' },
        { cycleKey: NOW, status: 'pending' },
        { cycleKey: null, status: 'paid' },
      ],
      kahatis: [
        { cycleKey: LAST, status: 'closed', claimedSlots: 7 },
        { cycleKey: LAST, status: 'cancelled', claimedSlots: 2 },
        { cycleKey: NOW, status: 'open', claimedSlots: 0 },
      ],
      campaigns: [
        { cycleKey: LAST, status: 'approved', committed: 4 },
      ],
    });

    expect(rows.map((r) => r.cycleKey)).toEqual([NOW, LAST]);
    expect(rows[1]).toEqual({
      cycleKey: LAST, orders: 2, cancelledOrders: 1, kahatis: 2, vials: 7, campaigns: 1, kits: 4,
    });
    expect(rows[0]).toEqual({
      cycleKey: NOW, orders: 1, cancelledOrders: 0, kahatis: 1, vials: 0, campaigns: 0, kits: 0,
    });
  });

  // Vials on a cancelled counter were refunded; they are not what the cycle
  // ordered. Kits on a cancelled batch likewise.
  it('does not count vials or kits that were refunded', () => {
    const [row] = summarizeCycles({
      orders: [],
      kahatis: [{ cycleKey: LAST, status: 'cancelled', claimedSlots: 5 }],
      campaigns: [{ cycleKey: LAST, status: 'cancelled', committed: 3 }],
    });
    expect(row.vials).toBe(0);
    expect(row.kits).toBe(0);
  });

  it('names a cycle that only has listings, and one that only has orders', () => {
    const rows = summarizeCycles({
      orders: [{ cycleKey: NOW, status: 'paid' }],
      kahatis: [{ cycleKey: LAST, status: 'closed', claimedSlots: 1 }],
      campaigns: [],
    });
    expect(rows.map((r) => r.cycleKey)).toEqual([NOW, LAST]);
  });
});

describe('cycleLabel', () => {
  // The key is the UTC instant the cycle opened; the team names a cycle by the
  // Manila date it opened on.
  it('names the cycle by its Manila opening date', () => {
    expect(cycleLabel('2026-09-05T14:00:00.000Z')).toBe('Cycle of 5 Sep 2026');
    expect(cycleLabel('2026-09-11T20:00:00.000Z')).toBe('Cycle of 12 Sep 2026');
  });
});

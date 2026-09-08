import { describe, it, expect } from 'vitest';
import { commitmentVerdict, groupOrdersIntoBatches, type BatchOrder, type CommitmentLine } from './order-batches';

const line = (o: Partial<CommitmentLine> = {}): CommitmentLine => ({
  kahatiName: 'Retatrutide', vials: 2, lineTotalPhp: 1800,
  counterStatus: 'open', claimedSlots: 3, minViableVials: 7,
  ...o,
});

const order = (o: Partial<BatchOrder> = {}): BatchOrder => ({
  orderId: 'o1', orderNo: 'KH-2418', status: 'payment_confirmed', buyType: 'kahati',
  cycleKey: '2026-08-29T14:00:00.000Z', totalPhp: 3120, downpaymentPhp: 150,
  placedAt: '2026-08-30T02:00:00.000Z', commitments: [line()],
  ...o,
});

// "Di kasi nila alam if pumasok ba ang na place nila or wala." One line per
// commitment answering exactly that, in the customer's terms.
describe('commitmentVerdict', () => {
  it('says a counter that reached its minimum got in', () => {
    expect(commitmentVerdict(line({ counterStatus: 'open', claimedSlots: 7 }))).toBe('in');
  });

  it('says a counter still short of its minimum is still filling', () => {
    expect(commitmentVerdict(line({ counterStatus: 'open', claimedSlots: 3 }))).toBe('waiting');
  });

  // A sealed counter is going ahead whatever its count says — an admin closed
  // it, or it filled its kit. Telling a customer their vials are "still
  // filling" on a batch that is already being ordered is the exact confusion
  // this screen exists to end.
  it('says a sealed counter got in', () => {
    for (const counterStatus of ['closed', 'shipped', 'completed'] as const) {
      expect(commitmentVerdict(line({ counterStatus, claimedSlots: 4 }))).toBe('in');
    }
  });

  it('says a cancelled counter did not get in', () => {
    expect(commitmentVerdict(line({ counterStatus: 'cancelled', claimedSlots: 3 }))).toBe('cancelled');
  });

  // Pasalo is the rescue window, so the batch is still live and the answer is
  // whether the COMBINED count has reached the minimum.
  it('judges a Pasalo counter on whether it has reached the minimum yet', () => {
    expect(commitmentVerdict(line({ counterStatus: 'pasalo', claimedSlots: 5 }))).toBe('waiting');
    expect(commitmentVerdict(line({ counterStatus: 'pasalo', claimedSlots: 8 }))).toBe('in');
  });

  // A counter capped below the minimum could never qualify, so it is judged by
  // its cap — the rule kahatiBadge and counterQuantities already apply.
  it('never leaves a counter permanently short of an unreachable minimum', () => {
    expect(commitmentVerdict(line({ counterStatus: 'open', claimedSlots: 3, minViableVials: 3 }))).toBe('in');
  });
});

describe('groupOrdersIntoBatches', () => {
  const AUG = '2026-08-29T14:00:00.000Z';
  const SEP = '2026-09-05T14:00:00.000Z';

  it('puts every order of one cycle in one batch', () => {
    const batches = groupOrdersIntoBatches([
      order({ orderId: 'a', cycleKey: AUG }),
      order({ orderId: 'b', cycleKey: AUG }),
      order({ orderId: 'c', cycleKey: SEP }),
    ]);
    expect(batches).toHaveLength(2);
    expect(batches[0].orders).toHaveLength(1);   // newest batch first
    expect(batches[1].orders).toHaveLength(2);
  });

  it('leads with the newest batch', () => {
    const batches = groupOrdersIntoBatches([
      order({ orderId: 'old', cycleKey: AUG }),
      order({ orderId: 'new', cycleKey: SEP }),
    ]);
    expect(batches[0].cycleKey).toBe(SEP);
  });

  // Orders placed before cycles were stamped belong to no batch. They are still
  // the customer's orders, so they are shown — grouped last, under no key.
  it('keeps orders that belong to no batch, last', () => {
    const batches = groupOrdersIntoBatches([
      order({ orderId: 'legacy', cycleKey: null }),
      order({ orderId: 'current', cycleKey: SEP }),
    ]);
    expect(batches[0].cycleKey).toBe(SEP);
    expect(batches[batches.length - 1].cycleKey).toBeNull();
  });

  // "Kasi inaantay lang nila magkano babayaran." One figure per batch.
  it('totals what the batch still owes', () => {
    const batches = groupOrdersIntoBatches([
      order({ orderId: 'a', cycleKey: AUG, totalPhp: 3120, downpaymentPhp: 150 }),
      order({ orderId: 'b', cycleKey: AUG, totalPhp: 1000, downpaymentPhp: 150 }),
    ]);
    expect(batches[0].amountDuePhp).toBe(3120 - 150 + 1000 - 150);
  });

  // A cancelled order owes nothing — chasing a customer for a batch that was
  // never ordered is the call this screen exists to stop.
  it('leaves a cancelled order out of what the batch owes', () => {
    const batches = groupOrdersIntoBatches([
      order({ orderId: 'a', cycleKey: AUG, totalPhp: 3120, downpaymentPhp: 150 }),
      order({ orderId: 'gone', cycleKey: AUG, status: 'cancelled', totalPhp: 9999, downpaymentPhp: 150 }),
    ]);
    expect(batches[0].amountDuePhp).toBe(3120 - 150);
  });

  it('counts the vials that got in, are still filling, and fell through', () => {
    const batches = groupOrdersIntoBatches([
      order({
        orderId: 'a', cycleKey: AUG,
        commitments: [
          line({ vials: 3, counterStatus: 'closed' }),
          line({ vials: 2, counterStatus: 'open', claimedSlots: 3 }),
          line({ vials: 4, counterStatus: 'cancelled' }),
        ],
      }),
    ]);
    expect(batches[0]).toMatchObject({ vialsIn: 3, vialsWaiting: 2, vialsCancelled: 4 });
  });

  it('carries the verdict onto every commitment it lists', () => {
    const batches = groupOrdersIntoBatches([
      order({ orderId: 'a', cycleKey: AUG, commitments: [line({ counterStatus: 'cancelled' })] }),
    ]);
    expect(batches[0].orders[0].commitments[0].verdict).toBe('cancelled');
  });

  it('does not mutate the caller’s orders', () => {
    const input = [order({ orderId: 'a', cycleKey: AUG })];
    groupOrdersIntoBatches(input);
    expect(input[0].commitments[0]).not.toHaveProperty('verdict');
  });
});

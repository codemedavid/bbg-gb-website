import { describe, it, expect } from 'vitest';
import {
  pasaloEligibility, pasaloOutcome, pasaloFailureReason, pasaloSecuredNotice,
} from './pasalo';
import { counterQuantities } from './kahati-quantity';

const q = (claimedSlots: number, kahatiVials: number | null = null, totalSlots = 10) =>
  counterQuantities({ claimedSlots, totalSlots, kahatiVials, minViableVials: 7 });

describe('pasaloEligibility — which counters enter the stage when Kahati closes', () => {
  it('opens Pasalo for a counter that fell short — the whole point', () => {
    expect(pasaloEligibility({ status: 'open', ...q(3) })).toBe('open_pasalo');
    expect(pasaloEligibility({ status: 'open', ...q(1) })).toBe('open_pasalo');
    expect(pasaloEligibility({ status: 'open', ...q(6) })).toBe('open_pasalo');
  });

  it('also opens Pasalo for a qualified counter, so it can still top up', () => {
    // 7-9 is already going ahead. It stays sellable through Pasalo because
    // three more vials of margin cost nothing to offer, and the batch closes
    // with everything else anyway.
    expect(pasaloEligibility({ status: 'open', ...q(7) })).toBe('open_pasalo');
    expect(pasaloEligibility({ status: 'open', ...q(9) })).toBe('open_pasalo');
  });

  it('skips a counter nobody joined', () => {
    // No customers, so no refund is owed and there is nothing to rescue. It
    // keeps running into the next cycle exactly as rollOpenKahatis leaves it.
    expect(pasaloEligibility({ status: 'open', ...q(0) })).toBe('skip_empty');
  });

  it('skips a full counter — a complete kit has nothing to sell', () => {
    expect(pasaloEligibility({ status: 'open', ...q(10) })).toBe('skip_full');
  });

  it('skips a counter that is not open', () => {
    // Closed, cancelled, scheduled and already-pasalo rows are not Kahati
    // counters awaiting a decision, so re-running the open is a no-op on them.
    for (const status of ['closed', 'cancelled', 'scheduled', 'pasalo', 'shipped', 'completed']) {
      expect(pasaloEligibility({ status, ...q(3) })).toBe('skip_not_open');
    }
  });
});

describe('pasaloOutcome — what closing the stage decides', () => {
  it('fulfils a counter that reached the minimum during Pasalo', () => {
    // 6 Kahati + 1 Pasalo = 7. Rescued: this is the batch that used to be
    // cancelled and refunded one vial short.
    expect(pasaloOutcome(q(7, 6))).toBe('fulfil');
  });
  it('fulfils a counter that was already qualified before Pasalo', () => {
    expect(pasaloOutcome(q(8, 8))).toBe('fulfil');
  });
  it('fulfils a full counter', () => {
    expect(pasaloOutcome(q(10, 3))).toBe('fulfil');
  });
  it('refunds a counter still short when the stage closed', () => {
    expect(pasaloOutcome(q(6, 5))).toBe('refund');
  });
  it('refunds a counter Pasalo did not move at all', () => {
    expect(pasaloOutcome(q(3, 3))).toBe('refund');
  });
  it('refunds a counter nobody ever joined', () => {
    // No lines means no refund ROWS, but the counter still failed. The two are
    // different questions and this one is only about the counter.
    expect(pasaloOutcome(q(0, 0))).toBe('refund');
  });
});

describe('pasaloFailureReason — the sentence on every refunded line', () => {
  it('states the combined total against the minimum', () => {
    expect(pasaloFailureReason(q(5, 3)))
      .toBe('Final combined quantity 5/7 minimum after Pasalo closed (3 Kahati + 2 Pasalo).');
  });
  it('reads correctly when Pasalo added nothing', () => {
    expect(pasaloFailureReason(q(3, 3)))
      .toBe('Final combined quantity 3/7 minimum after Pasalo closed (3 Kahati + 0 Pasalo).');
  });
});

describe('pasaloSecuredNotice — the customer-facing line on a live Pasalo', () => {
  it('asks for exactly the vials needed to qualify, never the gap to the cap', () => {
    // The defect this whole feature exists around: at 5/10 the batch needs TWO
    // more, not five. Saying five describes it as unreachable.
    expect(pasaloSecuredNotice(q(5, 3))).toBe('2 MORE NEEDED PARA TULOY ANG BATCH 🔥');
  });
  it('says the batch is secured once the minimum is reached, with slots left', () => {
    expect(pasaloSecuredNotice(q(7, 3))).toBe('BATCH SECURED ✅ · 3 slots pa bago mapuno');
  });
  it('drops the slot count when the batch is secured and full', () => {
    expect(pasaloSecuredNotice(q(10, 3))).toBe('FULL ✅ · sarado na ang batch na ito');
  });
  it('uses the singular for a one-vial gap', () => {
    expect(pasaloSecuredNotice(q(6, 3))).toBe('1 MORE NEEDED PARA TULOY ANG BATCH 🔥');
  });
  it('uses the singular for a single remaining slot', () => {
    expect(pasaloSecuredNotice(q(9, 3))).toBe('BATCH SECURED ✅ · 1 slot pa bago mapuno');
  });
});

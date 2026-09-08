import { describe, it, expect } from 'vitest';
import {
  attributeParticipantStages,
  summariseParticipantStages,
  type StageableCommitment,
} from './hatian-participants';
import { counterQuantities } from './kahati-quantity';

// A participant row reduced to the fields the stage walk actually reads.
const commitment = (o: Partial<StageableCommitment> = {}): StageableCommitment => ({
  orderId: 'o1', orderStatus: 'payment_confirmed', vials: 3,
  committedAt: '2026-08-01T10:00:00.000Z',
  ...o,
});

// Commit order is what the walk turns on, so fixtures state it explicitly
// rather than leaning on array position.
const at = (day: number): string => `2026-08-${String(day).padStart(2, '0')}T10:00:00.000Z`;

describe('attributeParticipantStages', () => {
  // Null kahati_vials means the admin has not closed Kahati on this counter, so
  // Pasalo has not happened and there is nobody it could have brought in.
  it('calls everyone a Kahati joiner while Kahati is still open', () => {
    const staged = attributeParticipantStages(
      [commitment({ orderId: 'a', committedAt: at(1) }), commitment({ orderId: 'b', committedAt: at(2) })],
      { kahatiVials: null },
    );
    expect(staged.map((s) => s.stage)).toEqual(['kahati', 'kahati']);
  });

  // The boundary is the frozen Kahati count, walked in commit order: the vials
  // that were on the counter when Kahati closed belong to Kahati, and every
  // vial after them was sold by the Pasalo window.
  it('splits participants at the frozen Kahati count, in commit order', () => {
    const staged = attributeParticipantStages([
      commitment({ orderId: 'a', vials: 3, committedAt: at(1) }),
      commitment({ orderId: 'b', vials: 2, committedAt: at(2) }),
      commitment({ orderId: 'c', vials: 3, committedAt: at(3) }),
    ], { kahatiVials: 5 });

    expect(staged.map((s) => [s.orderId, s.stage])).toEqual([
      ['a', 'kahati'], ['b', 'kahati'], ['c', 'pasalo'],
    ]);
  });

  // A commitment that began while Kahati was still running is a Kahati
  // commitment even if it carried the counter past the frozen figure. The
  // customer joined the first window; where their last vial landed is not a
  // second decision they made.
  it('keeps a commitment that straddles the boundary on the Kahati side', () => {
    const staged = attributeParticipantStages([
      commitment({ orderId: 'a', vials: 3, committedAt: at(1) }),
      commitment({ orderId: 'b', vials: 3, committedAt: at(2) }),
    ], { kahatiVials: 4 });

    expect(staged.map((s) => s.stage)).toEqual(['kahati', 'kahati']);
  });

  // A cancelled order holds no vials — the cancel released them back to the
  // counter (app/api/admin/orders/[id]/status). Letting it advance the walk
  // would push live participants across the boundary and file a Kahati joiner
  // under Pasalo.
  it('does not let a cancelled commitment move the boundary', () => {
    const staged = attributeParticipantStages([
      commitment({ orderId: 'gone', vials: 3, committedAt: at(1), orderStatus: 'cancelled' }),
      commitment({ orderId: 'b', vials: 3, committedAt: at(2) }),
      commitment({ orderId: 'c', vials: 2, committedAt: at(3) }),
      commitment({ orderId: 'd', vials: 4, committedAt: at(4) }),
    ], { kahatiVials: 5 });

    expect(staged.map((s) => [s.orderId, s.stage])).toEqual([
      ['gone', 'kahati'], ['b', 'kahati'], ['c', 'kahati'], ['d', 'pasalo'],
    ]);
  });

  // The walk depends on commit order, so it establishes that order itself
  // rather than trusting whatever order a caller happened to hand over.
  it('labels by commit time even when the input is out of order', () => {
    const staged = attributeParticipantStages([
      commitment({ orderId: 'late', vials: 3, committedAt: at(9) }),
      commitment({ orderId: 'early', vials: 5, committedAt: at(1) }),
    ], { kahatiVials: 5 });

    // Returned in INPUT order — the table decides how it sorts, not this walk.
    expect(staged.map((s) => [s.orderId, s.stage])).toEqual([
      ['late', 'pasalo'], ['early', 'kahati'],
    ]);
  });

  it('returns new rows and leaves the caller’s array untouched', () => {
    const rows = [commitment({ orderId: 'a', committedAt: at(1) })];
    const staged = attributeParticipantStages(rows, { kahatiVials: 5 });

    expect(staged[0]).not.toBe(rows[0]);
    expect(rows[0]).not.toHaveProperty('stage');
  });
});

describe('summariseParticipantStages', () => {
  it('counts the participants and vials on each side of the split', () => {
    const staged = attributeParticipantStages([
      commitment({ orderId: 'a', vials: 3, committedAt: at(1) }),
      commitment({ orderId: 'b', vials: 2, committedAt: at(2) }),
      commitment({ orderId: 'c', vials: 3, committedAt: at(3) }),
    ], { kahatiVials: 5 });

    expect(summariseParticipantStages(staged)).toEqual({
      kahatiVials: 5, pasaloVials: 3, kahatiParticipants: 2, pasaloParticipants: 1,
    });
  });

  // A cancelled order's vials are not on the counter, so they must not be
  // reported as vials either stage sold.
  it('leaves cancelled commitments out of both vial totals', () => {
    const staged = attributeParticipantStages([
      commitment({ orderId: 'gone', vials: 3, committedAt: at(1), orderStatus: 'cancelled' }),
      commitment({ orderId: 'b', vials: 3, committedAt: at(2) }),
    ], { kahatiVials: 3 });

    const split = summariseParticipantStages(staged);
    expect(split.kahatiVials).toBe(3);
    expect(split.pasaloVials).toBe(0);
  });
});

// The refund sheet, the Pasalo close and this panel all describe the same
// split. If they can disagree, a customer is told one thing and refunded on
// another — so the participant walk is pinned to counterQuantities, which is
// what actually judges the counter.
describe('the stage split agrees with the counter it describes', () => {
  it('reproduces the counter’s own Kahati/Pasalo figures', () => {
    const counter = { claimedSlots: 8, totalSlots: 10, kahatiVials: 5, minViableVials: 7 };
    const staged = attributeParticipantStages([
      commitment({ orderId: 'a', vials: 3, committedAt: at(1) }),
      commitment({ orderId: 'b', vials: 2, committedAt: at(2) }),
      commitment({ orderId: 'c', vials: 3, committedAt: at(3) }),
    ], counter);

    const split = summariseParticipantStages(staged);
    const q = counterQuantities(counter);
    expect(split.kahatiVials).toBe(q.kahatiVials);
    expect(split.pasaloVials).toBe(q.pasaloVials);
  });

  // A Kahati participant who cancels DURING Pasalo drops the live count below
  // the frozen figure. counterQuantities floors Pasalo at zero and absorbs the
  // shortfall on the Kahati side; the walk has to absorb it the same way, or
  // the panel and the refund sheet part company on the one counter where
  // somebody's money is actually in question.
  it('absorbs a cancel-during-Pasalo on the Kahati side, as the counter does', () => {
    const counter = { claimedSlots: 5, totalSlots: 10, kahatiVials: 6, minViableVials: 7 };
    const staged = attributeParticipantStages([
      commitment({ orderId: 'b', vials: 3, committedAt: at(2) }),
      commitment({ orderId: 'c', vials: 2, committedAt: at(3) }),
    ], counter);

    const split = summariseParticipantStages(staged);
    const q = counterQuantities(counter);
    expect(q.pasaloVials).toBe(0);
    expect(split.pasaloVials).toBe(q.pasaloVials);
    expect(split.kahatiVials).toBe(q.kahatiVials);
  });
});

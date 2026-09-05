import { describe, it, expect } from 'vitest';
import {
  neededToQualify, slotsRemaining, counterQuantities, qualificationState,
} from './kahati-quantity';

// The row shape the module reads, spelled out once so a test says only what it
// is actually varying.
const counter = (over: Partial<Parameters<typeof counterQuantities>[0]> = {}) => ({
  claimedSlots: 0, totalSlots: 10, kahatiVials: null, minViableVials: 7, ...over,
});

describe('neededToQualify', () => {
  it('is the gap to the minimum, not the gap to the cap', () => {
    // The whole point of the two figures: at 3/10 the batch needs FOUR more
    // vials to proceed, not seven. Telling a customer seven is what kills a
    // batch that was four vials from going ahead.
    expect(neededToQualify(3, 7)).toBe(4);
  });
  it('is 0 exactly at the minimum', () => {
    expect(neededToQualify(7, 7)).toBe(0);
  });
  it('never goes negative past the minimum', () => {
    expect(neededToQualify(9, 7)).toBe(0);
    expect(neededToQualify(10, 7)).toBe(0);
  });
});

describe('slotsRemaining', () => {
  it('is the gap to the FULL box, which keeps selling after qualifying', () => {
    // 3/10 qualifies with 4 more but still has 7 sellable slots. Both numbers
    // are true at once and the UI shows both.
    expect(slotsRemaining(3, 10)).toBe(7);
  });
  it('stays open above the minimum', () => {
    expect(slotsRemaining(7, 10)).toBe(3);
  });
  it('is 0 at the cap', () => {
    expect(slotsRemaining(10, 10)).toBe(0);
  });
  it('never goes negative for a legacy row stored over its cap', () => {
    expect(slotsRemaining(13, 10)).toBe(0);
  });
});

describe('qualificationState', () => {
  it('is empty when nobody has joined', () => {
    expect(qualificationState(0, 7, 10)).toBe('empty');
  });
  it('is short below the minimum — the Pasalo case', () => {
    expect(qualificationState(1, 7, 10)).toBe('short');
    expect(qualificationState(6, 7, 10)).toBe('short');
  });
  it('is qualified from the minimum up to one below the cap', () => {
    expect(qualificationState(7, 7, 10)).toBe('qualified');
    expect(qualificationState(8, 7, 10)).toBe('qualified');
    expect(qualificationState(9, 7, 10)).toBe('qualified');
  });
  it('is full at the cap', () => {
    expect(qualificationState(10, 7, 10)).toBe('full');
  });
  it('reads a legacy over-cap row as full rather than as a fifth state', () => {
    expect(qualificationState(13, 7, 10)).toBe('full');
  });
});

describe('counterQuantities', () => {
  it('attributes every vial to Kahati before Pasalo has been opened', () => {
    // kahatiVials is null until the admin closes Kahati and the split is frozen.
    const q = counterQuantities(counter({ claimedSlots: 5 }));
    expect(q.kahatiVials).toBe(5);
    expect(q.pasaloVials).toBe(0);
    expect(q.combinedVials).toBe(5);
  });

  it('splits Kahati from Pasalo once the Kahati figure is frozen', () => {
    // Frozen at 3 when Kahati closed; the counter has since climbed to 5, so
    // two of those vials were bought during Pasalo.
    const q = counterQuantities(counter({ claimedSlots: 5, kahatiVials: 3 }));
    expect(q.kahatiVials).toBe(3);
    expect(q.pasaloVials).toBe(2);
    expect(q.combinedVials).toBe(5);
  });

  it('never reports negative Pasalo vials when a Kahati joiner cancels', () => {
    // A cancellation during Pasalo takes the counter BELOW its frozen Kahati
    // figure. Subtracting blindly books -1 Pasalo vials, which then shows up in
    // the refund report as evidence — so the split is clamped and the Kahati
    // side absorbs the loss, which is where it actually happened.
    const q = counterQuantities(counter({ claimedSlots: 2, kahatiVials: 3 }));
    expect(q.pasaloVials).toBe(0);
    expect(q.kahatiVials).toBe(2);
    expect(q.combinedVials).toBe(2);
  });

  it('gives the two needed/remaining figures against the combined total', () => {
    const q = counterQuantities(counter({ claimedSlots: 5, kahatiVials: 3 }));
    expect(q.neededToQualify).toBe(2);
    expect(q.slotsRemaining).toBe(5);
    expect(q.state).toBe('short');
  });

  it('reports a qualified counter with slots still to sell', () => {
    // The state your mockup calls BATCH SECURED: proceeding, and still selling.
    const q = counterQuantities(counter({ claimedSlots: 7, kahatiVials: 3 }));
    expect(q.state).toBe('qualified');
    expect(q.neededToQualify).toBe(0);
    expect(q.slotsRemaining).toBe(3);
  });

  it('clamps the combined figure to the cap for a legacy over-cap row', () => {
    const q = counterQuantities(counter({ claimedSlots: 13 }));
    expect(q.combinedVials).toBe(10);
    expect(q.slotsRemaining).toBe(0);
    expect(q.state).toBe('full');
  });

  it('falls back to the default minimum when a counter sets none', () => {
    const q = counterQuantities(counter({ claimedSlots: 6, minViableVials: null }));
    expect(q.minRequired).toBe(7);
    expect(q.neededToQualify).toBe(1);
  });

  it('caps the minimum at the counter cap so a small counter is still winnable', () => {
    // A 5-vial counter can never reach 7. Left alone it would be permanently
    // "2 more needed" and permanently refundable — so the minimum bows to the
    // cap, exactly as kahatiBadge already does.
    const q = counterQuantities(counter({ claimedSlots: 5, totalSlots: 5 }));
    expect(q.minRequired).toBe(5);
    expect(q.state).toBe('full');
    expect(q.neededToQualify).toBe(0);
  });
});

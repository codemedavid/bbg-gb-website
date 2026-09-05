// The two numbers a hatian counter is judged by, and the difference between
// them — pure helpers, no I/O.
//
// A counter has a MINIMUM and a CAP, and they answer different questions:
//
//   minimum (7)  the batch is ordered at all. Below it nothing ships and every
//                participant is owed their money back.
//   cap    (10)  the kit is full and nothing more can be sold.
//
// Conflating them is expensive in one specific direction. A counter at 3/10
// needs FOUR more vials to proceed and has SEVEN slots left to sell. Telling
// anyone "7 more needed" — the gap to the cap — describes a batch as twice as
// far from happening as it is, and that is how a batch four vials short gets
// written off instead of finished.
//
// lib/kahati.ts already computes both figures correctly for the storefront
// card. This module is that arithmetic stated once, against the COMBINED
// Kahati+Pasalo total, so the admin dashboard, the refund export and the Pasalo
// board cannot drift from the card or from each other.
import { KAHATI_MAX_VIALS, KAHATI_MIN_VIABLE_VIALS } from './pricing';

export { KAHATI_MAX_VIALS, KAHATI_MIN_VIABLE_VIALS };

/**
 * Vials still needed for the batch to be ordered at all.
 *
 * The number a customer is shown to make their join feel decisive, and the
 * number the Pasalo close judges. Never the gap to the cap.
 */
export function neededToQualify(combinedVials: number, minRequired: number): number {
  return Math.max(minRequired - combinedVials, 0);
}

/** Vials that can still be sold before the kit is full. */
export function slotsRemaining(combinedVials: number, totalSlots: number): number {
  return Math.max(totalSlots - combinedVials, 0);
}

/**
 * Where a counter stands, as one word.
 *
 * 'empty' is separated from 'short' because they are different business events:
 * a counter nobody joined owes nobody a refund and is simply carried forward,
 * while a counter at 1-6 has real customers who need a Pasalo.
 */
export type QualificationState = 'empty' | 'short' | 'qualified' | 'full';

export function qualificationState(
  combinedVials: number,
  minRequired: number,
  totalSlots: number,
): QualificationState {
  if (combinedVials >= totalSlots) return 'full';
  if (combinedVials <= 0) return 'empty';
  return combinedVials >= minRequired ? 'qualified' : 'short';
}

/** The least a counter row must carry to be measured. */
export type MeasurableCounter = {
  claimedSlots: number;
  totalSlots: number;
  /**
   * Vials the counter held when Kahati closed, frozen at that moment. Null
   * until the admin closes Kahati — before then every vial on the counter is a
   * Kahati vial, because Pasalo has not happened yet.
   */
  kahatiVials: number | null;
  /** Per-counter minimum; falls back to the global 7 when unset. */
  minViableVials?: number | null;
};

export type CounterQuantities = {
  kahatiVials: number;
  pasaloVials: number;
  combinedVials: number;
  minRequired: number;
  maxVials: number;
  neededToQualify: number;
  slotsRemaining: number;
  state: QualificationState;
};

/**
 * Every figure the Pasalo surfaces quote, derived from one counter row.
 *
 * Three clamps, each for a state the database can genuinely hold:
 *
 *  - `combined` is clamped to the cap, because rows written before
 *    `group_buys_claimed_within_cap` existed can still read 13/10 and must not
 *    be published — the same rule kahatiClaimedDisplay applies to the card.
 *  - `pasaloVials` floors at zero. A Kahati participant who cancels DURING
 *    Pasalo drops the live count below the frozen Kahati figure, and a bare
 *    subtraction books negative Pasalo vials — which would then appear in a
 *    refund report as evidence for an amount. The Kahati side absorbs the
 *    shortfall instead, which is where the cancellation actually happened.
 *  - `minRequired` bows to the cap. A counter capped below 7 could otherwise
 *    never qualify, leaving it permanently short and permanently refundable;
 *    kahatiBadge already resolves it this way.
 */
export function counterQuantities(counter: MeasurableCounter): CounterQuantities {
  const maxVials = Math.max(counter.totalSlots, 0);
  const combinedVials = Math.min(Math.max(counter.claimedSlots, 0), maxVials);

  // Null means Kahati has not been closed yet, so nothing has been split off.
  const frozen = counter.kahatiVials;
  const kahatiVials = frozen == null
    ? combinedVials
    : Math.min(Math.max(frozen, 0), combinedVials);
  const pasaloVials = combinedVials - kahatiVials;

  const configured = counter.minViableVials ?? KAHATI_MIN_VIABLE_VIALS;
  const minRequired = Math.min(Math.max(configured, 0), maxVials);

  return {
    kahatiVials,
    pasaloVials,
    combinedVials,
    minRequired,
    maxVials,
    neededToQualify: neededToQualify(combinedVials, minRequired),
    slotsRemaining: slotsRemaining(combinedVials, maxVials),
    state: qualificationState(combinedVials, minRequired, maxVials),
  };
}

// Pasalo (Bunuan) — the stage between a hatian falling short and anybody being
// refunded. Pure decisions, no I/O and no clock.
//
// A hatian needs 7 vials to be worth ordering and holds 10. A counter that
// ended Kahati at 3 used to be CANCELLED outright: the batch was never placed
// and every participant was refunded, four vials short of a batch that would
// have gone ahead. Pasalo is the second selling window that gets asked for
// those four vials before any money goes back.
//
// Two admin actions bound it, both deliberate and both explicit. Opening the
// stage moves the short counters into it; closing the stage decides each one.
// Neither is a clock: the deadline on a counter stops new commitments, but
// what happens to a customer's money is settled by a person pressing a button.
import type { CounterQuantities } from './kahati-quantity';

/**
 * What opening the Pasalo stage does to one Kahati counter.
 *
 * 'skip_empty' and 'skip_full' are kept apart from each other and from
 * 'skip_not_open' because the admin is told what the action did NOT do, and
 * "4 counters skipped" is not an answer — "3 nobody joined, 1 already full" is.
 */
export type PasaloEligibility = 'open_pasalo' | 'skip_empty' | 'skip_full' | 'skip_not_open';

export function pasaloEligibility(
  counter: { status: string } & Pick<CounterQuantities, 'combinedVials' | 'state'>,
): PasaloEligibility {
  // Only a live Kahati counter is awaiting this decision. Everything else —
  // already in Pasalo, closed, cancelled, still scheduled — has either had it
  // or is not in the running, which is what makes re-opening the stage safe.
  if (counter.status !== 'open') return 'skip_not_open';
  // Nobody joined: no customer is owed anything and there is no batch to
  // rescue, so it keeps running into the next cycle. Same rule rollOpenKahatis
  // already applies, for the same reason.
  if (counter.combinedVials <= 0) return 'skip_empty';
  // A complete kit has no slots left to sell, so a second selling window would
  // be an empty offer.
  if (counter.state === 'full') return 'skip_full';
  // Everything from 1 to 9 enters — including the already-qualified 7-9. Those
  // batches are going ahead either way, and leaving them sellable through the
  // stage costs nothing: they close with everything else when the admin closes
  // Pasalo, and any vials they gain are margin that would otherwise be lost.
  return 'open_pasalo';
}

/**
 * Statuses a customer may still buy vials on.
 *
 * There are exactly two, and 'pasalo' is the whole reason this is a function
 * rather than `status === 'open'` written in nine places. Every one of those
 * nine — the board query, the card's disabled state, the badge, the checkout
 * guard, the slot release on cancel — reads as "is this counter alive", and
 * each one that kept asking about 'open' alone would silently take Pasalo off
 * the air in its own way.
 */
export const JOINABLE_KAHATI_STATUSES = ['open', 'pasalo'] as const;

export const isJoinableKahatiStatus = (status: string): boolean =>
  (JOINABLE_KAHATI_STATUSES as readonly string[]).includes(status);

/** Is this counter in the second stage, as opposed to its first? */
export const isPasaloStage = (status: string): boolean => status === 'pasalo';

/** What closing the stage decides for one counter. */
export type PasaloOutcome = 'fulfil' | 'refund';

export function pasaloOutcome(q: Pick<CounterQuantities, 'combinedVials' | 'minRequired'>): PasaloOutcome {
  return q.combinedVials >= q.minRequired ? 'fulfil' : 'refund';
}

/**
 * Why a line is being refunded, in one sentence, frozen onto the refund row.
 *
 * Names the split as well as the total. "5/7" says the batch fell short; "3
 * Kahati + 2 Pasalo" says the rescue was tried and by how much it missed,
 * which is the difference between an explanation and an assertion when a
 * customer asks why.
 */
export function pasaloFailureReason(
  q: Pick<CounterQuantities, 'combinedVials' | 'minRequired' | 'kahatiVials' | 'pasaloVials'>,
): string {
  return `Final combined quantity ${q.combinedVials}/${q.minRequired} minimum after Pasalo closed `
    + `(${q.kahatiVials} Kahati + ${q.pasaloVials} Pasalo).`;
}

const vials = (n: number): string => `${n} ${n === 1 ? 'vial' : 'vials'}`;

/**
 * The headline on a live Pasalo card.
 *
 * The number it asks for is neededToQualify and never slotsRemaining. At 5/10
 * the batch needs TWO more vials to proceed and has FIVE slots to sell; a card
 * that says "5 more needed" describes a batch as two and a half times further
 * from happening than it is, and that is how a batch two vials short gets
 * abandoned by the very customers who could finish it.
 */
export function pasaloSecuredNotice(
  q: Pick<CounterQuantities, 'neededToQualify' | 'slotsRemaining'>,
): string {
  if (q.neededToQualify > 0) {
    return `${q.neededToQualify} MORE NEEDED PARA TULOY ANG BATCH 🔥`;
  }
  if (q.slotsRemaining <= 0) return 'FULL ✅ · sarado na ang batch na ito';
  const slot = q.slotsRemaining === 1 ? 'slot' : 'slots';
  return `BATCH SECURED ✅ · ${q.slotsRemaining} ${slot} pa bago mapuno`;
}

export { vials as pasaloVialsLabel };

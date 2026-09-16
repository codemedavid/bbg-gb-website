// Pasalo tops up qualified kits. Opening cancels joined kits below their minimum.
import type { CounterQuantities } from './kahati-quantity';

/**
 * What opening the Pasalo stage does to one Kahati counter.
 *
 * 'skip_empty' and 'skip_full' are kept apart from each other and from
 * 'skip_not_open' because the admin is told what the action did NOT do, and
 * "4 counters skipped" is not an answer — "3 nobody joined, 1 already full" is.
 */
export type PasaloEligibility = 'open_pasalo' | 'cancel_short' | 'skip_empty' | 'skip_full' | 'skip_not_open';

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
  if (counter.state === 'short') return 'cancel_short';
  // Only qualified, incomplete kits enter Pasalo (7–9 of 10 vials).
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

/**
 * The date a counter's Kahati started — which is what decides the batch it
 * belongs to.
 *
 * `opens_at` is the scheduled start and the truthful answer whenever it is set:
 * a counter written weeks early for this cycle was CREATED in the last one, and
 * judging it by created_at would file it under a batch it never traded in.
 * Null means "already on the board" — every counter written before scheduling
 * existed — and those are exactly the old rows this filter has to keep out, so
 * created_at is the fallback rather than a reason to include them.
 */
export function counterStartedAt(counter: { opensAt: Date | null; createdAt: Date }): Date {
  return counter.opensAt ?? counter.createdAt;
}

/** The batch an admin has selected, as the half-open range dateRangeBounds returns. */
export type BatchWindow = { start: Date; end: Date; cycleKeys?: readonly string[] };

/**
 * Is this counter part of the batch the admin is acting on?
 *
 * `null` means no window was given and every counter qualifies — the unscoped
 * sweep both controls used to be, kept so a caller with no date range in hand
 * behaves as it always did.
 *
 * The end bound is EXCLUSIVE, matching dateRangeBounds: it is the next day's
 * midnight in Manila, so a counter opening at that instant belongs to the next
 * batch. A cycle opens at 22:00 Manila and no From/To a person types reproduces
 * one exactly, which is why the Reports page offers the batch picker — this
 * function is only as precise as the range it is handed.
 */
export function isCounterInBatchWindow(
  counter: { opensAt: Date | null; createdAt: Date; cycleKey?: string | null },
  window: BatchWindow | null | undefined,
): boolean {
  if (!window) return true;
  if (window.cycleKeys) return counter.cycleKey != null && window.cycleKeys.includes(counter.cycleKey);
  const startedAt = counterStartedAt(counter).getTime();
  return startedAt >= window.start.getTime() && startedAt < window.end.getTime();
}

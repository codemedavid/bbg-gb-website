// Which selling window each participant in a hatian committed in — pure, no
// database and no clock.
//
// A counter that fell short of its 7-vial minimum gets a second window, Pasalo
// (see lib/pasalo.ts). The counter records the split as ONE frozen number,
// kahati_vials: the vials it held the moment Kahati closed. Everything after
// that is Pasalo, derived rather than counted, so the two halves can never
// disagree with the counter itself (lib/kahati-quantity.ts).
//
// That answers "how many vials did Pasalo bring in" but not "who brought
// them", which is the question the admin actually gets asked — and the
// participants panel listed everyone with no way to tell the two windows
// apart. This module reconstructs the per-person split from the same frozen
// number, so the panel cannot drift from the refund sheet or from the close
// that will judge the same counter.
//
// There is no pasalo_opened_at timestamp to compare against, and adding one
// would answer for future batches only — it would be null on every counter
// already through the stage, which is exactly the batch someone asks about.
// Walking the frozen count instead works retroactively on every counter that
// has been through Pasalo.
import type { HatianCommitment } from './types';

export type ParticipantStage = 'kahati' | 'pasalo';

// The walk reads a strict subset of a participant row, so it stays usable from
// a test or a report without dragging in the whole feed contract — and any
// HatianCommitment satisfies it.
export type StageableCommitment = Pick<
  HatianCommitment, 'orderId' | 'orderStatus' | 'vials' | 'committedAt'
>;

export type StagedCommitment<T> = T & { stage: ParticipantStage };

const isCancelled = (c: Pick<StageableCommitment, 'orderStatus'>): boolean =>
  c.orderStatus === 'cancelled';

const vialsOf = (c: Pick<StageableCommitment, 'vials'>): number => Math.max(c.vials, 0);

/**
 * Labels each commitment with the window it was made in.
 *
 * Walks the participants in COMMIT order and hands out 'kahati' until the
 * running total reaches the frozen Kahati count; everyone from there on sold
 * into the Pasalo window.
 *
 * Three rules the counter forces, each matching how lib/kahati-quantity.ts
 * already resolves the same ambiguity in aggregate:
 *
 *  - A null frozen count means Kahati is still open on this counter. Pasalo
 *    has not happened, so there is nobody it could have brought in.
 *  - A commitment that STRADDLES the boundary stays on the Kahati side. It
 *    began while Kahati was still running; where its last vial landed is not a
 *    second decision the customer made.
 *  - A cancelled order does not advance the walk. Cancelling releases the
 *    vials back to the counter (app/api/admin/orders/[id]/status), so counting
 *    them would push live participants across the boundary and file a Kahati
 *    joiner under Pasalo.
 *
 * A Kahati participant who cancels DURING Pasalo leaves the live total short
 * of the frozen figure, and the tail of the list reads as Kahati rather than
 * Pasalo. That is the same shortfall counterQuantities absorbs on the Kahati
 * side, taken in the same direction on purpose: a panel that guessed
 * differently would describe a refund the refund sheet is not making.
 *
 * Commit order is established here rather than trusted from the caller — the
 * whole result turns on it. Rows come back in the order they went in, because
 * how the table sorts is the table's business.
 */
export function attributeParticipantStages<T extends StageableCommitment>(
  commitments: readonly T[],
  counter: { kahatiVials: number | null },
): StagedCommitment<T>[] {
  const frozen = counter.kahatiVials;
  if (frozen == null) return commitments.map((c) => ({ ...c, stage: 'kahati' as const }));
  const boundary = Math.max(frozen, 0);

  // Tie broken on input index so two commitments sharing a timestamp keep a
  // stable order instead of depending on Array#sort.
  const inCommitOrder = commitments
    .map((commitment, index) => ({ commitment, index }))
    .sort((a, b) =>
      a.commitment.committedAt.localeCompare(b.commitment.committedAt)
      || a.index - b.index);

  const stages = new Array<ParticipantStage>(commitments.length);
  let running = 0;
  for (const { commitment, index } of inCommitOrder) {
    stages[index] = running < boundary ? 'kahati' : 'pasalo';
    if (!isCancelled(commitment)) running += vialsOf(commitment);
  }

  return commitments.map((commitment, index) => ({ ...commitment, stage: stages[index] }));
}

export type ParticipantStageSplit = {
  kahatiVials: number;
  pasaloVials: number;
  kahatiParticipants: number;
  pasaloParticipants: number;
};

/**
 * The two windows as figures the panel can print beside the counter's own.
 *
 * Vials count only LIVE commitments — a cancelled order's vials went back to
 * the counter, so reporting them as vials a window sold would overstate both
 * the batch and the money. Participants are counted in full, cancellations
 * included, because the panel lists them and "3 joined in Pasalo, 1 of them
 * cancelled" is the honest reading of a table that shows four rows.
 */
export function summariseParticipantStages(
  staged: readonly StagedCommitment<StageableCommitment>[],
): ParticipantStageSplit {
  const vialsIn = (stage: ParticipantStage): number => staged
    .filter((s) => s.stage === stage && !isCancelled(s))
    .reduce((sum, s) => sum + vialsOf(s), 0);
  const countIn = (stage: ParticipantStage): number =>
    staged.filter((s) => s.stage === stage).length;

  return {
    kahatiVials: vialsIn('kahati'),
    pasaloVials: vialsIn('pasalo'),
    kahatiParticipants: countIn('kahati'),
    pasaloParticipants: countIn('pasalo'),
  };
}

// Group Buy (MOQ campaign) lifecycle — pure state machine.
//
// A campaign is 'open' while it accepts commitments. The admin may approve it
// (see below for the batching rules layered on top).
// (proceed below MOQ), extend it (new deadline, stays open), or cancel it (release
// commitments, refund). Only open campaigns can be acted on. Whether an order
// proceeds is derived from status + committed vs. MOQ (SRS §3.3, §7).
import { MOQ_BATCH_MAX_KITS, batchCapacity, groupBuyMoqStatus } from './pricing';

export type MoqCampaignStatus = 'scheduled' | 'open' | 'approved' | 'completed' | 'cancelled';
export type MoqCampaignAction = 'approve' | 'extend' | 'cancel' | 'roll';

const ACTION_RESULT: Record<MoqCampaignAction, MoqCampaignStatus> = {
  approve: 'approved',
  cancel: 'cancelled',
  extend: 'open', // deadline change is handled by the caller; status stays open
  // A rolled batch ends exactly as an approved one does — it ran, it closed, it
  // proceeds. What sets `roll` apart is not its status but the successor that
  // opens with it, and that is a write, so it belongs to the caller
  // (moq-batch-server rollBatch) rather than to this state machine.
  roll: 'approved',
};

/**
 * Whether a batch can be ended in favour of a fresh successor.
 *
 * Only a running batch can: an approved or cancelled one has already ended, and
 * a completed one opened its successor the moment it filled — rolling that
 * would mint a second successor and split the series in two.
 */
export function canRollBatch(status: MoqCampaignStatus): boolean {
  return status === 'open';
}

export function applyCampaignAction(
  current: MoqCampaignStatus,
  action: MoqCampaignAction,
): { ok: true; status: MoqCampaignStatus } | { ok: false; message: string } {
  // A completed batch is full and already proceeding, so approving it (it needs
  // no approval) or extending it (it accepts nothing) is meaningless. Cancelling
  // is not: a supplier can still fall through after the batch closed, and the
  // admin has to be able to refund it.
  if (current === 'completed') {
    if (action === 'cancel') return { ok: true, status: 'cancelled' };
    return { ok: false, message: `Batch is complete; it can only be cancelled, not ${action}d.` };
  }
  if (current !== 'open') {
    return { ok: false, message: `Campaign is ${current}; only open campaigns can be modified.` };
  }
  return { ok: true, status: ACTION_RESULT[action] };
}

// Customers may commit only while the batch is open. A completed batch is not a
// dead end for the customer — the commit route sends them to its successor —
// but it accepts nothing itself, which is what keeps it at its cap. A scheduled
// batch is not on the board yet, so nothing can reach it either.
export function canCommit(status: MoqCampaignStatus): boolean {
  return status === 'open';
}

// ---------------------------------------------------------------------------
// Batching
//
// A batch holds at most MOQ_BATCH_MAX_KITS kits. Filling it completes and closes
// it; anything beyond rolls into a successor batch of the same series. The rule
// is deliberately a pure function of (ordered, already committed, capacity) so
// the allocation the server performs is the allocation that can be tested.
// ---------------------------------------------------------------------------

// The cap and its clamp live with the other order rules in lib/pricing.ts, next
// to the hatian cap; they are re-exported here so the batching rules read as
// one module.
export { MOQ_BATCH_MAX_KITS, batchCapacity };

// `>=` rather than `===`, so a row that was over-committed before the cap
// existed can never read as "still has room".
export function isBatchFull(committed: number, capacity: number): boolean {
  return committed >= capacity;
}

// One batch's share of a commitment. `fills` marks the fragment that takes the
// batch to its cap — the point at which it completes and a successor opens.
export type BatchFragment = { qty: number; fills: boolean };

// Spread `qty` kits over the open batch and as many successors as it takes.
// Fragment 0 lands in the batch that already holds `committed`; each later
// fragment lands in the batch opened by the fragment before it.
export function planBatchAllocation(qty: number, committed: number, capacity: number): BatchFragment[] {
  const cap = batchCapacity(capacity);
  const plan: BatchFragment[] = [];
  let remaining = Math.floor(qty);
  // The first batch may be partly full — or already over-full, in which case it
  // takes nothing and the whole order starts in its successor.
  let room = Math.max(0, cap - committed);

  while (remaining > 0) {
    if (room > 0) {
      const take = Math.min(remaining, room);
      remaining -= take;
      plan.push({ qty: take, fills: take === room });
    }
    room = cap; // whatever is left continues in a fresh, empty batch
  }
  return plan;
}

// A batch as the storefront and admin boards read it: the stored row plus the
// derived numbers both surfaces need. Typed on the shape rather than the Drizzle
// row so the same helper serves the API and anything rendering its output.
type StoredBatch = {
  id: string;
  status: MoqCampaignStatus;
  committed: number;
  moq: number;
  seriesId: string | null;
  batchNo: number;
};

export function describeBatch<T extends StoredBatch>(c: T) {
  const status = groupBuyMoqStatus(c.committed, c.moq);
  return {
    ...c,
    // The clamped count — the board must never render 13/10, whatever a legacy
    // row happens to hold.
    committed: status.committed,
    capacity: status.capacity,
    progress: status.progress,
    remaining: status.remaining,
    reached: status.reached,
    full: status.full,
    // A row predating batching is batch #1 of a series of its own.
    seriesId: c.seriesId ?? c.id,
    outcome: campaignOutcome(c.status, c.committed, c.moq),
  };
}

// Deadline for a successor batch: the same window length as its parent, measured
// from `now`, so each batch gets the full run its customers were promised. A
// parent with no deadline yields a successor with none. Mirrors the hatian rule
// in lib/kahati.ts — the two boards are kept deliberately independent.
export function nextBatchDeadline(createdAt: Date, deadline: Date | null, now: Date): Date | null {
  if (!deadline) return null;
  const windowMs = Math.max(deadline.getTime() - createdAt.getTime(), 0);
  return new Date(now.getTime() + windowMs);
}

export type CampaignOutcome = 'awaiting_moq' | 'processing' | 'refunded';

// The customer-facing outcome for a campaign's held commitments.
export function campaignOutcome(
  status: MoqCampaignStatus,
  committed: number,
  moq: number,
): CampaignOutcome {
  if (status === 'cancelled') return 'refunded';
  // A completed batch is full by definition — it closed the moment it filled.
  if (status === 'approved' || status === 'completed') return 'processing';
  return committed >= moq ? 'processing' : 'awaiting_moq';
}

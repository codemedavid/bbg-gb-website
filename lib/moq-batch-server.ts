// Group Buy (MOQ) batching — database side effects.
//
// A batch is one `moq_campaigns` row and holds at most `batchCapacity(moq)`
// kits. Reaching that cap completes the batch and opens its successor, and a
// commitment larger than the room left is spread across as many batches as it
// takes (lib/group-buy.ts planBatchAllocation).
//
// Every claim is a guarded conditional UPDATE: the ceiling lives in the WHERE
// clause, so two customers committing at the same instant cannot both pass a
// stale read and push a batch past its cap. That is what makes 11/10
// unreachable rather than merely unlikely — no application-level check can
// promise the same under concurrency.
import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { getDb, moqCampaigns } from '@/lib/db';
import { MOQ_BATCH_MAX_KITS, batchCapacity, canRollBatch, isBatchFull, nextBatchDeadline } from './group-buy';
import { refreshEmptyCampaign } from './listing-sync-server';

type Db = Awaited<ReturnType<typeof getDb>>;
type BatchRow = typeof moqCampaigns.$inferSelect;

// The hard ceiling as a SQL literal, so a claim's guard reads "no batch may
// exceed the smaller of its own MOQ and the absolute cap" in one expression.
const HARD_CAP = sql.raw(String(MOQ_BATCH_MAX_KITS));

// The series a batch belongs to. Rows written before batching existed carry no
// series id; such a row is batch #1 of its own series (the migration backfills
// this, and the fallback keeps a stale row from stranding its successors).
export const seriesOf = (batch: BatchRow): string => batch.seriesId ?? batch.id;

// The batch a commitment aimed at `batch` should actually land in.
//
// A completed batch is full, not closed for business: the customer picked this
// group buy off the board, and the kits belong in whichever batch of the series
// is open. If the fill never opened one (a legacy row, an admin edit),
// allocation opens it — so this returns the completed row and lets
// allocateCommitment roll forward rather than refusing. Cancelled and approved
// campaigns are genuinely finished; the caller's canCommit check refuses those.
export async function resolveOpenBatch(db: Db, batch: BatchRow): Promise<BatchRow> {
  if (batch.status !== 'completed') return batch;
  const open = await findOpenBatch(db, seriesOf(batch));
  if (open) return open;
  // No open batch anywhere in the series. Answer with its LATEST batch rather
  // than the completed one the caller aimed at, so the caller's lifecycle check
  // sees how the series actually ended. Returning the completed row instead
  // reads as "full, roll into a successor" — and a cart line held since before
  // the admin cancelled batch #2 would mint an open batch #3 and take money for
  // a group buy that was deliberately shut down.
  return (await latestBatch(db, seriesOf(batch))) ?? batch;
}

// Put every batch whose scheduled open date has arrived on the board.
//
// The Kahati board has always resolved its lifecycle lazily on read; this gives
// the group buy board the one piece of that it needs, without introducing the
// scheduler process this app has done without. GET /api/campaigns calls it, so
// the admin list and the storefront both perform the flip.
//
// The isNotNull guard keeps a 'scheduled' row with no open date dark: it has no
// moment to arrive, and publishing an unscheduled campaign is the worse failure.
// RETURNING makes the result mean "this call opened it" — a repeat is a no-op.
export async function openDueBatches(db: Db, now: Date = new Date()): Promise<string[]> {
  const opened = await db.update(moqCampaigns).set({ status: 'open' })
    .where(and(
      eq(moqCampaigns.status, 'scheduled'),
      isNotNull(moqCampaigns.opensAt),
      lte(moqCampaigns.opensAt, now),
    ))
    .returning({ id: moqCampaigns.id });
  return opened.map((r) => r.id);
}

export type BatchRollover = { sealed: BatchRow; opened: BatchRow };

// The open batch of a series, if it has one. A series holds at most one — every
// path that opens a batch first completes the one it succeeds — but ordering by
// batch number keeps the answer deterministic if an admin ever hand-writes a row.
export async function findOpenBatch(db: Db, seriesId: string): Promise<BatchRow | null> {
  const [row] = await db.select().from(moqCampaigns)
    .where(and(eq(moqCampaigns.seriesId, seriesId), eq(moqCampaigns.status, 'open')))
    .orderBy(asc(moqCampaigns.batchNo))
    .limit(1);
  return row ?? null;
}

// Close a running batch under `status` and open its successor.
//
// The flip is guarded on 'open', so of two callers racing the same batch
// exactly one seals it and creates the successor; the loser gets null and
// re-reads the series. Returns both rows so a commitment that overflowed can
// continue straight into the batch it just opened.
async function sealAndSucceed(
  db: Db,
  batch: BatchRow,
  status: 'completed' | 'approved',
): Promise<BatchRollover | null> {
  const [sealed] = await db.update(moqCampaigns).set({ status })
    .where(and(eq(moqCampaigns.id, batch.id), eq(moqCampaigns.status, 'open')))
    .returning();
  if (!sealed) return null;
  return { sealed, opened: await openSuccessor(db, sealed) };
}

// Complete a filled batch and open its successor — the rollover a fill performs
// on its own, the moment the last kit lands.
export async function completeFullBatch(db: Db, batch: BatchRow): Promise<BatchRollover | null> {
  return sealAndSucceed(db, batch, 'completed');
}

// End a running batch early and open its successor — the same rollover, asked
// for by an admin instead of triggered by a fill.
//
// Approving a batch closes it and leaves the series with nothing open, so the
// next batch had to be hand-created — and a hand-created campaign is batch #1 of
// a NEW series, which is what splits one group buy into two entries on the
// board. Rolling keeps the successor inside the series, so the batches before it
// archive under the same card.
//
// Sealed as 'approved', not 'completed': the batch did not reach its cap, it was
// ended deliberately, and 'approved' is precisely "proceeding without having
// filled". Returns null if the batch was not open — nothing is written, and no
// second successor is minted.
export async function rollBatch(db: Db, batch: BatchRow): Promise<BatchRollover | null> {
  if (!canRollBatch(batch.status)) return null;
  return sealAndSucceed(db, batch, 'approved');
}

export type CycleRollover = {
  /** Every batch that was ended, with the successor opened for it. */
  rolled: BatchRollover[];
  /** Running batches nobody had joined, left open rather than rolled. */
  skippedEmpty: number;
  /**
   * Of the empty ones, how many carried terms the catalog had since moved and
   * were brought forward. Reported apart from `skippedEmpty` because the two
   * answer different questions: how many batches did NOT end, and how many
   * listings the cycle actually changed.
   */
  refreshed: number;
  /**
   * Campaigns whose every batch had ended — approved mid-cycle, with nothing
   * open behind it — given a fresh batch at 0 in the same series. A cycle
   * takes a campaign back to zero; it never takes it off the board.
   */
  reopened: number;
};

// Start a new cycle across the whole board: end every running batch that has
// commitments and open its successor.
//
// A batch with nothing committed is not SEALED. It is not running in any sense a
// customer would recognise — it is merely listed — so sealing it as 'approved'
// would record a supplier order nobody placed, and its successor would be an
// identical empty row.
//
// It is not left untouched either. "Identical empty row" holds only while the
// catalog stands still, and such a batch blocked its own replacement — the
// seeder will not list a product a live batch already carries — so it kept the
// terms it opened with indefinitely. Each one is RE-READ from its product in
// place (refreshEmptyCampaign) and counted as `refreshed`.
//
// The count of empties comes back in the result rather than being swallowed, so
// the caller can say what it did and did not do.
//
// Sequential, not concurrent: each roll is two writes against the same table and
// the batch count is in the tens, so the simple loop is fast enough and keeps
// the unique (series_id, batch_no) index from arbitrating writes it does not
// need to. A batch another request seals first simply returns null and is
// skipped — the cycle is safe to re-run.
export async function rollOpenBatches(db: Db, now: Date = new Date()): Promise<CycleRollover> {
  await openDueBatches(db, now);
  const running = await db.select().from(moqCampaigns)
    .where(eq(moqCampaigns.status, 'open'))
    .orderBy(asc(moqCampaigns.createdAt));

  const rolled: BatchRollover[] = [];
  let skippedEmpty = 0;
  let refreshed = 0;
  for (const batch of running) {
    if (batch.committed <= 0) {
      skippedEmpty += 1;
      // Nothing to end — but its terms are a cycle old, and nothing else was
      // ever going to correct them: the seeder will not open a replacement for
      // a product already carried by a live batch, so this row was blocking its
      // own successor. Re-read in place instead.
      if (await refreshEmptyCampaign(db, batch)) refreshed += 1;
      continue;
    }
    const result = await rollBatch(db, batch);
    if (result) rolled.push(result);
  }
  const reopened = await reopenApprovedSeries(db);
  return { rolled, skippedEmpty, refreshed, reopened };
}

// Approving a batch ends it and leaves its series with nothing open, and the
// seeder will not open another: an approved batch still carries its products
// (lib/campaign-seed-bulk.ts LIVE_STATUSES). Between cycles that is right —
// the campaign is proceeding — but on the NEXT cycle it would mean the campaign
// is simply gone from the board. A cycle takes every campaign back to 0; it
// does not remove one. So every series whose newest batch is approved and
// which has no open or scheduled batch gets the successor an admin's Roll
// would have given it. Cancelled series are left alone: that was a decision.
async function reopenApprovedSeries(db: Db): Promise<number> {
  const approved = await db.select().from(moqCampaigns)
    .where(eq(moqCampaigns.status, 'approved'))
    .orderBy(asc(moqCampaigns.createdAt));
  if (!approved.length) return 0;
  const stillOpen = await db.select({ seriesId: moqCampaigns.seriesId }).from(moqCampaigns)
    .where(inArray(moqCampaigns.status, ['open', 'scheduled']));
  const openSeries = new Set(stillOpen.map((b) => b.seriesId));

  // Newest batch per series, so the successor continues from the right number.
  const newestBySeries = new Map<string, BatchRow>();
  for (const batch of approved) {
    const key = seriesOf(batch);
    const seen = newestBySeries.get(key);
    if (!seen || batch.batchNo > seen.batchNo) newestBySeries.set(key, batch);
  }

  let reopened = 0;
  for (const [seriesId, batch] of newestBySeries) {
    if (openSeries.has(seriesId)) continue;
    await openSuccessor(db, batch);
    reopened += 1;
  }
  return reopened;
}

// Open the batch that follows a completed one. Successors inherit the terms
// customers were shown on the board — name, price, capacity, packing fee,
// included products — so joining batch #2 is the same offer as batch #1; only
// the deadline moves on. The unique (series_id, batch_no) index is what makes
// this safe under concurrency: two callers cannot mint the same batch number,
// and the loser joins the winner's batch instead.
export async function openSuccessor(db: Db, batch: BatchRow): Promise<BatchRow> {
  const [opened] = await db.insert(moqCampaigns).values({
    name: batch.name,
    pricePerKitPhp: batch.pricePerKitPhp,
    moq: batch.moq,
    committed: 0,
    perCustomerMin: batch.perCustomerMin,
    shippingPhp: batch.shippingPhp,
    status: 'open',
    // Not inherited: this batch opens because its parent filled, so its moment
    // has already arrived. Only the deadline moves on.
    opensAt: null,
    deadline: nextBatchDeadline(batch.createdAt, batch.deadline, new Date()),
    includedProducts: batch.includedProducts,
    arrivalGroup: batch.arrivalGroup,
    description: batch.description,
    seriesId: seriesOf(batch),
    batchNo: batch.batchNo + 1,
  }).returning();
  return opened;
}

// One batch's share of a commitment, resolved against the row that actually
// took it — the caller writes one order line per fragment.
export type CommittedFragment = { batch: BatchRow; qty: number };

// A commitment can only span as many batches as its size allows; this bound
// exists so a lost race can never spin. It is far above any real commitment.
const MAX_BATCHES_PER_COMMITMENT = 64;

export class BatchAllocationError extends Error {}

// Claim `qty` kits for this series, starting at `first` and continuing into
// successors as each batch fills. Returns which batch took what.
//
// The plan from planBatchAllocation is advisory: it decides the shape, but each
// claim is re-validated in SQL, so a concurrent commitment that took the room
// first simply moves this one into the next batch instead of overselling.
export async function allocateCommitment(
  db: Db,
  first: BatchRow,
  qty: number,
): Promise<CommittedFragment[]> {
  const fragments: CommittedFragment[] = [];
  let current = first;
  let remaining = Math.floor(qty);
  let guard = 0;

  while (remaining > 0) {
    if (++guard > MAX_BATCHES_PER_COMMITMENT) {
      throw new BatchAllocationError('This commitment could not be placed — please try again.');
    }

    const capacity = batchCapacity(current.moq);
    const room = Math.max(0, capacity - current.committed);

    // No room here (a full batch still marked open, or one an admin over-filled):
    // complete it and continue in its successor rather than claiming nothing.
    if (room <= 0 || current.status !== 'open') {
      current = await rollForward(db, current);
      continue;
    }

    const take = Math.min(remaining, room);
    const [claimed] = await db.update(moqCampaigns)
      .set({ committed: sql`${moqCampaigns.committed} + ${take}` })
      .where(and(
        eq(moqCampaigns.id, current.id),
        eq(moqCampaigns.status, 'open'),
        // The cap, enforced by the database itself.
        sql`${moqCampaigns.committed} + ${take} <= LEAST(${moqCampaigns.moq}, ${HARD_CAP})`,
      ))
      .returning();

    if (!claimed) {
      // Somebody else claimed the room between the read and the write. Re-read
      // and let the loop decide again — nothing is lost, it just lands later.
      current = await reread(db, current);
      continue;
    }

    fragments.push({ batch: claimed, qty: take });
    remaining -= take;

    if (isBatchFull(claimed.committed, capacity)) {
      const rolled = await completeFullBatch(db, claimed);
      if (remaining > 0) current = rolled?.opened ?? await rollForward(db, claimed);
    }
  }

  return fragments;
}

// Move to the batch that succeeds a full one — the single place a commitment
// crosses a batch boundary. Three cases, in the order they can happen:
//   1. the batch is still open: complete it, which opens its successor;
//   2. somebody else completed it: join whichever batch of the series is open;
//   3. it was completed with no successor (a legacy row, or an admin who closed
//      it by hand): open one now, so a customer never meets a dead series.
async function rollForward(db: Db, batch: BatchRow): Promise<BatchRow> {
  const rolled = await completeFullBatch(db, batch);
  if (rolled) return rolled.opened;

  const open = await findOpenBatch(db, seriesOf(batch));
  if (open) return open;

  return openSuccessor(db, await latestBatch(db, seriesOf(batch)) ?? batch);
}

// The highest-numbered batch of a series — the one a new batch must follow.
// Read rather than assumed, so a successor opened after an admin hand-added a
// batch still lands at the end of the series instead of colliding with it.
async function latestBatch(db: Db, seriesId: string): Promise<BatchRow | null> {
  const [row] = await db.select().from(moqCampaigns)
    .where(eq(moqCampaigns.seriesId, seriesId))
    .orderBy(desc(moqCampaigns.batchNo))
    .limit(1);
  return row ?? null;
}

// Re-read a batch after a claim was refused, so the next pass decides on
// current state rather than the state that lost.
async function reread(db: Db, batch: BatchRow): Promise<BatchRow> {
  const [fresh] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, batch.id));
  if (!fresh) throw new BatchAllocationError('This group buy is no longer available.');
  if (fresh.status !== 'open' || isBatchFull(fresh.committed, batchCapacity(fresh.moq))) {
    return rollForward(db, fresh);
  }
  return fresh;
}

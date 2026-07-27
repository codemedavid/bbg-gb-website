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
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, moqCampaigns } from '@/lib/db';
import { MOQ_BATCH_MAX_KITS, batchCapacity, isBatchFull, nextBatchDeadline } from './group-buy';

type Db = Awaited<ReturnType<typeof getDb>>;
type BatchRow = typeof moqCampaigns.$inferSelect;

// The hard ceiling as a SQL literal, so a claim's guard reads "no batch may
// exceed the smaller of its own MOQ and the absolute cap" in one expression.
const HARD_CAP = sql.raw(String(MOQ_BATCH_MAX_KITS));

// The series a batch belongs to. Rows written before batching existed carry no
// series id; such a row is batch #1 of its own series (the migration backfills
// this, and the fallback keeps a stale row from stranding its successors).
export const seriesOf = (batch: BatchRow): string => batch.seriesId ?? batch.id;

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

// Complete a filled batch and open its successor. The flip is guarded on
// 'open', so of two callers racing the same fill exactly one seals the batch
// and creates the successor; the loser gets null and re-reads the series.
// Returns both rows so a commitment that overflowed can continue straight into
// the batch it just opened.
export async function completeFullBatch(db: Db, batch: BatchRow): Promise<BatchRollover | null> {
  const [sealed] = await db.update(moqCampaigns).set({ status: 'completed' })
    .where(and(eq(moqCampaigns.id, batch.id), eq(moqCampaigns.status, 'open')))
    .returning();
  if (!sealed) return null;
  return { sealed, opened: await openSuccessor(db, sealed) };
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

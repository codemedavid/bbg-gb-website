// Admin: "Start new cycle" on the hatian board.
//
// The Group Buy campaigns board has had this control since batching landed
// (lib/moq-batch-server rollOpenBatches). The hatian board had no equivalent, so
// an admin ending a trading cycle had to press Close on every card in turn — and
// Close on its own opens no successor, so each counter simply left the board
// instead of reopening empty for the next cycle.
import { describe, it, expect, beforeEach } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { getDb, groupBuys } from '@/lib/db';
import { resetDb, makeGroupBuy } from '@/lib/test/harness';
import { rollOpenKahatis, sweepKahatis } from './kahati-server';

const load = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row;
};

// Every counter carrying one hatian's name, oldest first — a sealed counter and
// the sibling it opened share it.
const countersNamed = async (name: string) => {
  const db = await getDb();
  return db.select().from(groupBuys).where(eq(groupBuys.name, name)).orderBy(asc(groupBuys.createdAt));
};

beforeEach(async () => {
  await resetDb();
});

describe('rollOpenKahatis', () => {
  it('seals every counter that has vials claimed and opens a fresh successor', async () => {
    const db = await getDb();
    const counter = await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 4 });

    const result = await rollOpenKahatis(db);

    expect(result.rolled).toHaveLength(1);
    expect(result.rolled[0].sealed.id).toBe(counter.id);
    expect(result.rolled[0].sealed.status).toBe('closed');
    expect(result.rolled[0].sealed.claimedSlots).toBe(4);

    const [sealed, successor] = await countersNamed('KLOW 80mg');
    expect(sealed.status).toBe('closed');
    expect(successor).toBeDefined();
    expect(successor.status).toBe('open');
    // The successor starts empty — that is the whole point of a new cycle.
    expect(successor.claimedSlots).toBe(0);
  });

  // A counter nobody joined is not running in any sense a customer would
  // recognise. Sealing it would record a batch that was never ordered and leave
  // an identical empty row in its place.
  it('leaves counters nobody has joined open, minting no successor for them', async () => {
    const db = await getDb();
    const empty = await makeGroupBuy({ name: 'ARA-290 10mg', totalSlots: 10, claimedSlots: 0 });

    const result = await rollOpenKahatis(db);

    expect(result.rolled).toHaveLength(0);
    expect(result.skippedEmpty).toBe(1);
    expect((await load(empty.id)).status).toBe('open');
    expect(await countersNamed('ARA-290 10mg')).toHaveLength(1);
  });

  it('ignores counters that are not open', async () => {
    const db = await getDb();
    await makeGroupBuy({ name: 'Closed one', claimedSlots: 8, status: 'closed' });
    await makeGroupBuy({ name: 'Cancelled one', claimedSlots: 3, status: 'cancelled' });
    await makeGroupBuy({ name: 'Shipped one', claimedSlots: 10, status: 'shipped' });

    const result = await rollOpenKahatis(db);

    expect(result.rolled).toHaveLength(0);
    expect(result.skippedEmpty).toBe(0);
  });

  // Joining next cycle's counter has to be the same offer the sealed one
  // advertised, or the board silently reprices itself every cycle.
  it('carries price, cap, minimum and packing fee into each successor', async () => {
    const db = await getDb();
    await makeGroupBuy({
      name: 'ELORALINTIDE 10mg', totalSlots: 10, claimedSlots: 2,
      pricePerKitPhp: 9100, minVials: 2, repackFeePhp: 175,
    });

    await rollOpenKahatis(db);

    const [, successor] = await countersNamed('ELORALINTIDE 10mg');
    expect(Number(successor.pricePerKitPhp)).toBe(9100);
    expect(successor.totalSlots).toBe(10);
    expect(successor.minVials).toBe(2);
    expect(Number(successor.repackFeePhp)).toBe(175);
  });

  it('rolls each counter independently and reports how many it left alone', async () => {
    const db = await getDb();
    await makeGroupBuy({ name: 'Joined A', totalSlots: 10, claimedSlots: 1 });
    await makeGroupBuy({ name: 'Joined B', totalSlots: 10, claimedSlots: 6 });
    await makeGroupBuy({ name: 'Empty A', totalSlots: 10, claimedSlots: 0 });
    await makeGroupBuy({ name: 'Empty B', totalSlots: 10, claimedSlots: 0 });

    const result = await rollOpenKahatis(db);

    expect(result.rolled).toHaveLength(2);
    expect(result.skippedEmpty).toBe(2);
  });

  // The successor it just opened is empty, so a second run finds nothing with
  // vials on it. Re-running the control must not seal the fresh counters.
  it('is a no-op the second time, having left only empty counters running', async () => {
    const db = await getDb();
    await makeGroupBuy({ name: 'KLOW 80mg', totalSlots: 10, claimedSlots: 3 });

    await rollOpenKahatis(db);
    const second = await rollOpenKahatis(db);

    expect(second.rolled).toHaveLength(0);
    expect(await countersNamed('KLOW 80mg')).toHaveLength(2);
  });

  // A counter that has ALREADY expired below the 7-vial minimum is left alone.
  //
  // The sweep owes those participants a cancellation and a refund email
  // (expiredUnviable → cancelExpiredKahati). Sealing it 'closed' would take the
  // row out of that query's reach for good — status is no longer 'open' — so the
  // refund silently never happens and the customers are never told. Ending a
  // cycle must not quietly turn a pending refund into a kept payment.
  it('leaves an already-expired counter below the minimum for the cancel sweep', async () => {
    const db = await getDb();
    const thin = await makeGroupBuy({
      name: 'Thin counter', totalSlots: 10, claimedSlots: 2,
      closesAt: new Date(Date.now() - 60_000),
    });

    const result = await rollOpenKahatis(db);

    expect(result.rolled).toHaveLength(0);
    expect(result.leftForCancellation).toBe(1);
    expect((await load(thin.id)).status).toBe('open');

    // Still reachable by the sweep, which cancels and refunds it as designed.
    const sweep = await sweepKahatis(db);
    expect(sweep.cancelled).toContain(thin.id);
  });

  // A counter below the minimum whose deadline has NOT passed is a different
  // case: no refund is pending on it, so ending it is the admin's call and the
  // cycle takes it like any other.
  it('rolls a counter below the minimum that has not expired yet', async () => {
    const db = await getDb();
    const early = await makeGroupBuy({
      name: 'Early counter', totalSlots: 10, claimedSlots: 2,
      closesAt: new Date(Date.now() + 60_000),
    });

    const result = await rollOpenKahatis(db);

    expect(result.rolled).toHaveLength(1);
    expect(result.leftForCancellation).toBe(0);
    expect((await load(early.id)).status).toBe('closed');
  });

  // A counter with no deadline at all can never be expired, so it rolls.
  it('rolls a counter below the minimum that has no deadline', async () => {
    const db = await getDb();
    const open = await makeGroupBuy({ name: 'No deadline', totalSlots: 10, claimedSlots: 2, closesAt: null });

    const result = await rollOpenKahatis(db);

    expect(result.rolled).toHaveLength(1);
    expect((await load(open.id)).status).toBe('closed');
  });

  // An expired counter AT or above the minimum is viable — the sweep would only
  // close it, with no refund owed — so the cycle rolls it and gives it a
  // successor, which is strictly better than the sweep's bare close.
  it('rolls an expired counter that reached the viable minimum', async () => {
    const db = await getDb();
    const viable = await makeGroupBuy({
      name: 'Viable counter', totalSlots: 10, claimedSlots: 8,
      closesAt: new Date(Date.now() - 60_000),
    });

    const result = await rollOpenKahatis(db);

    expect(result.rolled).toHaveLength(1);
    expect(result.leftForCancellation).toBe(0);
    expect((await load(viable.id)).status).toBe('closed');
    expect(await countersNamed('Viable counter')).toHaveLength(2);
  });

  // Each counter's seal and its successor's insert are one atomic unit. Half of
  // that pair — sealed with no successor — is a counter permanently off the
  // board: closed, unjoinable, and out of the sweep's reach.
  it('never leaves a counter sealed without its successor', async () => {
    const db = await getDb();
    await makeGroupBuy({ name: 'Atomic A', totalSlots: 10, claimedSlots: 3 });
    await makeGroupBuy({ name: 'Atomic B', totalSlots: 10, claimedSlots: 4 });

    await rollOpenKahatis(db);

    for (const name of ['Atomic A', 'Atomic B']) {
      const rows = await countersNamed(name);
      expect(rows.filter((r) => r.status === 'closed')).toHaveLength(1);
      expect(rows.filter((r) => r.status === 'open')).toHaveLength(1);
    }
  });

  // One product may have only one OPEN counter (group_buys_one_open_per_product_idx).
  // Sealing before inserting the successor is what keeps that true; get the order
  // wrong and the whole cycle fails on a unique-index violation.
  it('keeps one open counter per product when the counter is linked to one', async () => {
    const db = await getDb();
    const { makeProduct } = await import('@/lib/test/harness');
    const product = await makeProduct({ name: 'Linked peptide' });
    await makeGroupBuy({ name: 'Linked peptide', totalSlots: 10, claimedSlots: 5, productId: product.id });

    const result = await rollOpenKahatis(db);

    expect(result.rolled).toHaveLength(1);
    const rows = await countersNamed('Linked peptide');
    expect(rows.filter((r) => r.status === 'open')).toHaveLength(1);
    expect(rows.find((r) => r.status === 'open')!.productId).toBe(product.id);
  });
});

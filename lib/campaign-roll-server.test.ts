// Ending a running batch and opening its successor — the database side.
//
// The rollover a fill performs automatically (completeFullBatch), performed on
// demand by an admin who wants to start the next batch before this one fills.
import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getDb, moqCampaigns, orders, orderItems } from '@/lib/db';
import { resetDb, makeMoqCampaign, makeUser } from '@/lib/test/harness';
import { rollBatch, rollOpenBatches, findOpenBatch } from './moq-batch-server';

const load = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
  return row;
};

const seriesRows = async (seriesId: string) => {
  const db = await getDb();
  return db.select().from(moqCampaigns).where(eq(moqCampaigns.seriesId, seriesId));
};

beforeEach(async () => {
  await resetDb();
});

describe('rollBatch', () => {
  it('ends the running batch and opens its successor in the same series', async () => {
    const db = await getDb();
    const batch = await makeMoqCampaign({ committed: 4 });

    const result = await rollBatch(db, await load(batch.id));

    expect(result).not.toBeNull();
    expect(result!.sealed.status).toBe('approved');
    expect(result!.sealed.committed).toBe(4);
    expect(result!.opened.status).toBe('open');
    expect(result!.opened.batchNo).toBe(2);
    expect(result!.opened.seriesId).toBe(batch.seriesId);
    // The successor starts empty — that is the whole point of starting a batch.
    expect(result!.opened.committed).toBe(0);
  });

  // The successor is the same offer: a customer joining batch #2 off the board
  // must see the terms batch #1 advertised.
  it('carries the batch terms into the successor', async () => {
    const db = await getDb();
    const batch = await makeMoqCampaign({ committed: 2, moq: 8, perCustomerMin: 3, pricePerKitPhp: 12345 });

    const { opened } = (await rollBatch(db, await load(batch.id)))!;

    expect(opened.name).toBe('Test Campaign');
    expect(opened.moq).toBe(8);
    expect(opened.perCustomerMin).toBe(3);
    expect(Number(opened.pricePerKitPhp)).toBe(12345);
  });

  it('leaves exactly one open batch in the series', async () => {
    const db = await getDb();
    const batch = await makeMoqCampaign({ committed: 1 });

    await rollBatch(db, await load(batch.id));

    const open = await seriesRows(batch.seriesId);
    expect(open.filter((b) => b.status === 'open')).toHaveLength(1);
    expect(await findOpenBatch(db, batch.seriesId)).not.toBeNull();
  });

  it('refuses a batch that is not open, minting no successor', async () => {
    const db = await getDb();
    const batch = await makeMoqCampaign({ committed: 3, status: 'approved' });

    expect(await rollBatch(db, await load(batch.id))).toBeNull();
    expect(await seriesRows(batch.seriesId)).toHaveLength(1);
  });

  // Two admins clicking at once, or a double-submit. The guarded flip plus the
  // unique (series_id, batch_no) index must leave one successor, not two.
  it('opens one successor when two rolls race the same batch', async () => {
    const db = await getDb();
    const batch = await makeMoqCampaign({ committed: 5 });
    const row = await load(batch.id);

    const [a, b] = await Promise.allSettled([rollBatch(db, row), rollBatch(db, row)]);
    const won = [a, b].filter((r) => r.status === 'fulfilled' && r.value !== null);

    expect(won).toHaveLength(1);
    const rows = await seriesRows(batch.seriesId);
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'open')).toHaveLength(1);
  });

  // The admins reconcile customer order statuses themselves; rolling a batch is
  // a campaign-lifecycle action and must not reach into anyone's order.
  it('does not touch the orders committed to the batch', async () => {
    const db = await getDb();
    const user = await makeUser({ role: 'customer' });
    const batch = await makeMoqCampaign({ committed: 2 });
    const [order] = await db.insert(orders).values({
      orderNo: 'GB-9001', userId: user.id, status: 'payment_confirmed', buyType: 'group_buy',
      subtotalPhp: '1000', totalPhp: '1000', shipName: 'A', shipPhone: '0900', shipAddress: 'B',
    }).returning();
    await db.insert(orderItems).values({
      orderId: order.id, kind: 'moq_campaign', moqCampaignId: batch.id,
      nameSnapshot: 'Test Campaign', unitPricePhp: '500', qty: 2, lineTotalPhp: '1000',
    });

    await rollBatch(db, await load(batch.id));

    const [after] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(after.status).toBe('payment_confirmed');
    // The line still points at the batch it was placed in — history, not a
    // pointer that moves when the campaign moves on.
    const [line] = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    expect(line.moqCampaignId).toBe(batch.id);
  });
});

describe('rollOpenBatches', () => {
  // The board-level "start a new cycle". A batch nobody joined is not running —
  // it is merely listed — so rolling it would seal an empty batch as 'approved'
  // and litter the board with an empty successor. Those are left alone.
  it('rolls every batch that has commitments and leaves empty ones open', async () => {
    const db = await getDb();
    const joined = await makeMoqCampaign({ committed: 3 });
    const empty = await makeMoqCampaign({ committed: 0 });

    const result = await rollOpenBatches(db);

    expect(result.rolled).toHaveLength(1);
    expect(result.rolled[0].sealed.id).toBe(joined.id);
    expect(result.skippedEmpty).toBe(1);
    expect((await load(empty.id)).status).toBe('open');
    expect(await seriesRows(empty.seriesId)).toHaveLength(1);
  });

  it('ignores batches that are not open', async () => {
    const db = await getDb();
    await makeMoqCampaign({ committed: 4, status: 'approved' });
    await makeMoqCampaign({ committed: 9, status: 'completed' });
    await makeMoqCampaign({ committed: 2, status: 'cancelled' });

    const result = await rollOpenBatches(db);

    expect(result.rolled).toHaveLength(0);
    expect(result.skippedEmpty).toBe(0);
  });

  it('is a no-op the second time, having left nothing running to roll', async () => {
    const db = await getDb();
    await makeMoqCampaign({ committed: 3 });

    await rollOpenBatches(db);
    const second = await rollOpenBatches(db);

    expect(second.rolled).toHaveLength(0);
  });

  it('rolls each series independently', async () => {
    const db = await getDb();
    const a = await makeMoqCampaign({ committed: 1 });
    const b = await makeMoqCampaign({ committed: 2 });

    const result = await rollOpenBatches(db);

    expect(result.rolled).toHaveLength(2);
    for (const seriesId of [a.seriesId, b.seriesId]) {
      const rows = await seriesRows(seriesId);
      expect(rows).toHaveLength(2);
      expect(rows.filter((r) => r.status === 'open')).toHaveLength(1);
      const [{ committed }] = rows.filter((r) => r.status === 'open');
      expect(committed).toBe(0);
    }
  });
});

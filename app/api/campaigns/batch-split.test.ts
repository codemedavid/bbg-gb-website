// Integration tests for MOQ batch auto-splitting.
//
// The rule these pin down: a batch holds at most its capacity (10 kits), it
// completes and closes the instant it fills, and anything the customer ordered
// beyond that lands in a freshly opened successor batch — however many that
// takes. 11/10 must be unreachable through any path, including two customers
// committing at the same moment.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const getSession = async () => session.current;
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  return {
    ApiError,
    getSession,
    requireSession,
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { POST: COMMIT } = await import('@/app/api/orders/route');
const { GET: LIST } = await import('./route');
const { getDb, moqCampaigns, orders, orderItems } = await import('@/lib/db');
const { resetDb, makeUser, makeMoqCampaign, commitRequest } = await import('@/lib/test/harness');

async function signIn(role: 'customer' | 'admin' = 'customer') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

// Every batch in a series, oldest first — the "batch #1, #2, #3" the board shows.
async function batchesOf(seriesId: string) {
  const db = await getDb();
  return db.select().from(moqCampaigns)
    .where(eq(moqCampaigns.seriesId, seriesId))
    .orderBy(asc(moqCampaigns.batchNo));
}

async function itemsOf(orderId: string) {
  const db = await getDb();
  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('a batch never exceeds its capacity', () => {
  it('caps at 10/10 and never records 11/10', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 9 });
    const res = await COMMIT(commitRequest(c.id, 2));
    expect(res.status).toBe(201);

    const rows = await batchesOf(c.id);
    expect(rows.every((b) => b.committed <= b.moq)).toBe(true);
    expect(rows.every((b) => b.committed <= 10)).toBe(true);
    expect(rows[0].committed).toBe(10);
  });

  it('holds the cap across a long run of commitments', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 0 });
    for (let i = 0; i < 7; i++) {
      const res = await COMMIT(commitRequest(c.id, 3));
      expect(res.status).toBe(201);
    }
    const rows = await batchesOf(c.id);
    // 21 kits over batches of 10 -> 10, 10, 1
    expect(rows.map((b) => b.committed)).toEqual([10, 10, 1]);
    expect(rows.map((b) => b.status)).toEqual(['completed', 'completed', 'open']);
  });
});

describe('example 1 — 8/10 batch receives an order of 5', () => {
  it('completes the batch at 10/10 and opens batch #2 holding the remaining 3', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 8 });

    const res = await COMMIT(commitRequest(c.id, 5));
    expect(res.status).toBe(201);

    const [first, second, ...rest] = await batchesOf(c.id);
    expect(rest).toHaveLength(0);
    expect(first).toMatchObject({ batchNo: 1, committed: 10, status: 'completed' });
    expect(second).toMatchObject({ batchNo: 2, committed: 3, status: 'open' });
    // The successor inherits the terms customers were shown.
    expect(second.name).toBe(first.name);
    expect(second.pricePerKitPhp).toBe(first.pricePerKitPhp);
    expect(second.moq).toBe(first.moq);
    expect(second.shippingPhp).toBe(first.shippingPhp);
  });

  it('links both fragments to one order, each to the batch that holds it', async () => {
    const user = await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 8, pricePerKitPhp: 10400 });
    await COMMIT(commitRequest(c.id, 5));

    const db = await getDb();
    const placed = await db.select().from(orders).where(eq(orders.userId, user.id));
    expect(placed).toHaveLength(1);

    const [batch1, batch2] = await batchesOf(c.id);
    const lines = await itemsOf(placed[0].id);
    expect(lines).toHaveLength(2);
    const byBatch = new Map(lines.map((l) => [l.moqCampaignId, l]));
    expect(byBatch.get(batch1.id)?.qty).toBe(2);
    expect(byBatch.get(batch2.id)?.qty).toBe(3);
    // The split is priced as one order of 5 kits carrying one packing fee —
    // splitting the batch must not split the bill.
    expect(Number(placed[0].subtotalPhp)).toBe(52000);
    expect(Number(placed[0].packingFeePhp)).toBe(300);
    expect(Number(placed[0].totalPhp)).toBe(52300);
  });

  it('names each line with its batch so order history shows where the kits went', async () => {
    const user = await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 8 });
    await COMMIT(commitRequest(c.id, 5));

    const db = await getDb();
    const [placed] = await db.select().from(orders).where(eq(orders.userId, user.id));
    const lines = await itemsOf(placed.id);
    expect(lines.map((l) => l.specSnapshot).sort()).toEqual(
      expect.arrayContaining([expect.stringContaining('Batch #1'), expect.stringContaining('Batch #2')]),
    );
  });
});

describe('example 2 — committing against a completed batch', () => {
  it('opens the successor and starts it at 4/10', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 10, status: 'completed' });

    const res = await COMMIT(commitRequest(c.id, 4));
    expect(res.status).toBe(201);

    const [first, second] = await batchesOf(c.id);
    expect(first).toMatchObject({ committed: 10, status: 'completed' });
    expect(second).toMatchObject({ batchNo: 2, committed: 4, status: 'open' });
  });

  it('routes into the series\' already-open batch rather than opening another', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 8 });
    await COMMIT(commitRequest(c.id, 5)); // completes #1, opens #2 at 3

    // Committing against the completed #1 again must land in #2, not #3.
    const res = await COMMIT(commitRequest(c.id, 2));
    expect(res.status).toBe(201);

    const rows = await batchesOf(c.id);
    expect(rows).toHaveLength(2);
    expect(rows[1].committed).toBe(5);
  });

  it('still refuses a commitment to a cancelled campaign', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 2, status: 'cancelled' });
    const res = await COMMIT(commitRequest(c.id, 1));
    expect(res.status).toBe(400);
    expect(await batchesOf(c.id)).toHaveLength(1);
  });

  it('still refuses a commitment to an admin-approved campaign', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 4, status: 'approved' });
    const res = await COMMIT(commitRequest(c.id, 1));
    expect(res.status).toBe(400);
    expect(await batchesOf(c.id)).toHaveLength(1);
  });
});

describe('example 3 — 9/10 batch receives an order of 14', () => {
  it('completes two batches and leaves batch #3 open at 3/10', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 9 });

    const res = await COMMIT(commitRequest(c.id, 14));
    expect(res.status).toBe(201);

    const rows = await batchesOf(c.id);
    expect(rows.map((b) => [b.batchNo, b.committed, b.status])).toEqual([
      [1, 10, 'completed'],
      [2, 10, 'completed'],
      [3, 3, 'open'],
    ]);
  });

  it('writes one line per batch, summing to the ordered quantity', async () => {
    const user = await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 9 });
    await COMMIT(commitRequest(c.id, 14));

    const db = await getDb();
    const [placed] = await db.select().from(orders).where(eq(orders.userId, user.id));
    const lines = await itemsOf(placed.id);
    expect(lines).toHaveLength(3);
    expect(lines.reduce((s, l) => s + l.qty, 0)).toBe(14);
  });
});

describe('concurrent commitments', () => {
  it('holds the cap when commitments are issued in parallel', async () => {
    const buyers = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
    const c = await makeMoqCampaign({ moq: 10, committed: 0 });

    // Four commitments of 4 kits (16 total) fired without waiting for each
    // other. The session mock is module state, so each request is issued with
    // its own buyer already in place — what races here is the claim itself.
    const responses = [];
    for (const buyer of buyers) {
      session.current = { sub: buyer.id, role: 'customer', email: buyer.email };
      responses.push(COMMIT(commitRequest(c.id, 4)));
    }
    const settled = await Promise.all(responses);
    expect(settled.map((r) => r.status)).toEqual([201, 201, 201, 201]);

    const rows = await batchesOf(c.id);
    // The invariant, whatever order the claims landed in: no batch over its cap,
    // and every ordered kit accounted for exactly once.
    expect(rows.every((r) => r.committed <= 10)).toBe(true);
    expect(rows.reduce((s, r) => s + r.committed, 0)).toBe(16);
    // Batch numbers stay unique — no two racers mint the same successor.
    expect(new Set(rows.map((r) => r.batchNo)).size).toBe(rows.length);
  });

  it('lets two customers race the last slots without overfilling or losing kits', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeMoqCampaign({ moq: 10, committed: 6 });

    // Two commitments of 3 against 4 remaining slots: one fits, the other has to
    // spill into the successor. Neither may be lost, and neither may push 11/10.
    session.current = { sub: a.id, role: 'customer', email: a.email };
    const first = await COMMIT(commitRequest(c.id, 3));
    session.current = { sub: b.id, role: 'customer', email: b.email };
    const second = await COMMIT(commitRequest(c.id, 3));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const rows = await batchesOf(c.id);
    expect(rows.every((r) => r.committed <= 10)).toBe(true);
    expect(rows.reduce((s, r) => s + r.committed, 0)).toBe(12);
  });
});

describe('the public board', () => {
  it('reports a capped count, the remaining slots and the batch number', async () => {
    await signIn();
    const c = await makeMoqCampaign({ moq: 10, committed: 8 });
    await COMMIT(commitRequest(c.id, 5));

    const body = await (await LIST()).json();
    const rows: Array<{ batchNo: number; committed: number; capacity: number; remaining: number; status: string }> =
      body.data;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.committed).toBeLessThanOrEqual(row.capacity);

    const done = rows.find((r) => r.batchNo === 1)!;
    const live = rows.find((r) => r.batchNo === 2)!;
    expect(done).toMatchObject({ committed: 10, capacity: 10, remaining: 0, status: 'completed' });
    expect(live).toMatchObject({ committed: 3, capacity: 10, remaining: 7, status: 'open' });
  });

  it('caps a legacy over-committed row at its capacity instead of showing 13/10', async () => {
    // Rows written before the cap existed must not render as 13/10.
    const c = await makeMoqCampaign({ moq: 10, committed: 13 });
    const body = await (await LIST()).json();
    const row = body.data.find((r: { id: string }) => r.id === c.id);
    expect(row.capacity).toBe(10);
    expect(row.committed).toBe(10);
    expect(row.remaining).toBe(0);
    expect(row.progress).toBe(1);
  });
});

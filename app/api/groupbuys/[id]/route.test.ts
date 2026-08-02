// The single-hatian detail endpoint. It reports the same clamped fill the board
// does: a counter never reads past its cap, `remaining` never goes negative, and
// progress cannot be NaN.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';

const { GET } = await import('./route');
const { getDb, groupBuys } = await import('@/lib/db');
const { resetDb, openBoards, makeGroupBuy } = await import('@/lib/test/harness');

const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDb();
  await openBoards();
});

describe('GET /api/groupbuys/[id]', () => {
  it('reports the fill, the vials left and the per-vial price', async () => {
    const g = await makeGroupBuy({ totalSlots: 10, claimedSlots: 4, pricePerKitPhp: 9000 });

    const body = await (await GET(new Request('http://localhost'), params(g.id))).json();

    expect(body.data.claimedSlots).toBe(4);
    expect(body.data.remaining).toBe(6);
    expect(body.data.progress).toBe(40);
    expect(body.data.perVialPhp).toBe(900);
  });

  it('reads a filled counter as 10/10 with nothing left', async () => {
    const g = await makeGroupBuy({ totalSlots: 10, claimedSlots: 10 });

    const body = await (await GET(new Request('http://localhost'), params(g.id))).json();

    expect(body.data.claimedSlots).toBe(10);
    expect(body.data.remaining).toBe(0);
    expect(body.data.progress).toBe(100);
  });

  it('never publishes a count past the cap, even for a row written before the constraint', async () => {
    const g = await makeGroupBuy({ totalSlots: 10, claimedSlots: 5 });
    // Reach around the CHECK constraint the way a pre-constraint row got there,
    // so the clamp is proved against real over-committed data rather than a mock.
    const db = await getDb();
    await db.execute(sql`ALTER TABLE "group_buys" DROP CONSTRAINT "group_buys_claimed_within_cap"`);
    await db.update(groupBuys).set({ claimedSlots: 13 }).where(eq(groupBuys.id, g.id));

    const body = await (await GET(new Request('http://localhost'), params(g.id))).json();

    expect(body.data.claimedSlots).toBe(10);
    expect(body.data.remaining).toBe(0);
    expect(body.data.progress).toBe(100);

    // Put the row back inside the cap before restoring the constraint — ADD
    // CONSTRAINT is refused outright while any row still violates it, which is
    // exactly why the migration clamps before it adds.
    await db.update(groupBuys).set({ claimedSlots: 5 }).where(eq(groupBuys.id, g.id));
    await db.execute(
      sql`ALTER TABLE "group_buys" ADD CONSTRAINT "group_buys_claimed_within_cap" CHECK ("claimed_slots" <= "total_slots")`,
    );
  });

  it('404s on an unknown hatian', async () => {
    const res = await GET(
      new Request('http://localhost'),
      params('00000000-0000-0000-0000-000000000000'),
    );

    expect(res.status).toBe(404);
  });
});

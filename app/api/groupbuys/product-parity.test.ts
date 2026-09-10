// Hatian reflects the active Group Buy product list on its own.
//
// `products.is_group_buy` is the permission — it says a product MAY be sold this
// way — and both boards are built from it. The campaign board is opened from it
// in bulk; until now the hatian board was too, by an operator running a script.
// That left a real gap: a product flagged on Monday did not appear in Hatian
// until somebody remembered to run something.
//
// So the board reconciles on read, exactly as it already sweeps on read. There
// is no cron and no queue to be behind: the counters that should exist are
// derived from the product list every time the board is asked for.
import { describe, it, expect, beforeEach } from 'vitest';

const { GET } = await import('./route');
const { getDb, groupBuys } = await import('@/lib/db');
const { resetDb, openBoards, makeProduct, makeGroupBuy } = await import('@/lib/test/harness');

const DAY = 24 * 60 * 60 * 1000;

const board = async (): Promise<{ name: string; productId: string | null }[]> =>
  (await (await GET()).json()).data;

const namesOf = async (): Promise<string[]> => (await board()).map((g) => g.name);

/** A catalog product cleared for group buy, priced so a counter can be seeded. */
const flagged = (name: string, extra: Record<string, unknown> = {}) =>
  makeProduct({ name, spec: '10mg', isGroupBuy: true, pricePhp: 9000, ...extra });

beforeEach(async () => {
  await resetDb();
  await openBoards();
});

describe('the hatian board mirrors the group buy product list', () => {
  it('lists a counter for a flagged product nobody has opened one for', async () => {
    await flagged('Retatrutide');

    expect(await namesOf()).toEqual(['Retatrutide 10mg']);
  });

  it('carries every flagged product, not just the first', async () => {
    await flagged('Retatrutide');
    await flagged('Tirzepatide');
    await flagged('Semaglutide');

    expect((await namesOf()).sort()).toEqual(['Retatrutide 10mg', 'Semaglutide 10mg', 'Tirzepatide 10mg']);
  });

  it('does not duplicate a product that already has an open counter', async () => {
    // Idempotence is the whole risk here: the board is read constantly, and a
    // reconcile that ran twice would stack duplicate counters for one product.
    //
    // Asserted on the ROW, not on the name. The counter was typed by hand but is
    // LINKED to a product, and a linked counter's name belongs to the catalog —
    // lib/listing-sync.ts has renamed one on a product edit all along, and the
    // cycle refresh now does the same on the first read of a cycle. Pinning the
    // hand-typed name here would pin that away, and this test is about counting
    // rows, not about who names them.
    const product = await flagged('Retatrutide');
    const made = await makeGroupBuy({
      name: 'Hand-made counter', totalSlots: 10, closesAt: new Date(Date.now() + DAY),
    });
    const db = await getDb();
    await db.update(groupBuys).set({ productId: product.id });

    await GET();
    await GET();
    await GET();

    const rows = await db.select().from(groupBuys);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(made.id);
  });

  // The other half of the rule above, stated outright rather than left as a
  // side effect of the test before it.
  it('gives a linked hand-made counter the catalog’s name and price', async () => {
    const product = await flagged('Retatrutide');
    await makeGroupBuy({
      name: 'Hand-made counter', pricePerKitPhp: 1234, totalSlots: 10,
      closesAt: new Date(Date.now() + DAY),
    });
    const db = await getDb();
    await db.update(groupBuys).set({ productId: product.id });
    // A stale counter is re-read on the first board read of a NEW cycle, and
    // openBoards records the cycle as already started. Forget that, so this
    // read is the one that starts it.
    const { settings } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const { BOARDS_REFRESHED_KEY } = await import('@/lib/cycle-boundary-server');
    await db.delete(settings).where(eq(settings.key, BOARDS_REFRESHED_KEY));

    await GET();

    const [row] = await db.select().from(groupBuys);
    expect(row.name).toBe('Retatrutide 10mg');
    expect(Number(row.pricePerKitPhp)).toBe(9000);
  });

  it('leaves an unflagged product off the board entirely', async () => {
    // The permission is what lists a product. An ordinary shop item is not a
    // group buy just because it exists.
    await makeProduct({ name: 'Shop only' });

    expect(await namesOf()).toEqual([]);
  });

  it('drops a delisted product from the board', async () => {
    // "Disabled or unavailable products do not appear in either module."
    await flagged('Retired peptide', { isActive: false });

    expect(await namesOf()).toEqual([]);
  });

  it('opens a counter priced from the product, never a free one', async () => {
    // A ₱0 kit on the board is worse than an absent one, so an unpriceable
    // product is skipped rather than seeded at zero.
    await flagged('Priced', { pricePhp: 9000 });

    const [counter] = await board() as unknown as { pricePerKitPhp: string }[];
    expect(Number(counter.pricePerKitPhp)).toBeGreaterThan(0);
  });

  it('links the counter to the product it came from', async () => {
    // The link is what makes the reconcile idempotent; without it every read
    // would open another counter.
    const product = await flagged('Retatrutide');

    await GET();

    const rows = await (await getDb()).select().from(groupBuys);
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe(product.id);
  });

  it('reopens a counter for a product whose previous batch is over', async () => {
    // One finished hatian must not delist a product forever — the product is
    // still flagged, so the board still owes it a counter to join.
    const product = await flagged('Retatrutide');
    await GET();
    const db = await getDb();
    await db.update(groupBuys).set({ status: 'completed' });

    expect(await namesOf()).toEqual(['Retatrutide 10mg']);
    const rows = await db.select().from(groupBuys);
    expect(rows.filter((r) => r.status === 'open')).toHaveLength(1);
    expect(rows.every((r) => r.productId === product.id)).toBe(true);
  });

  it('writes nothing while the boards are shut', async () => {
    // The gate comes first: a request to a closed board must not reconcile,
    // or an anonymous read would seed the catalog outside trading hours.
    const { closeBoards } = await import('@/lib/test/harness');
    await flagged('Retatrutide');
    await closeBoards();

    expect((await GET()).status).toBe(404);
    expect(await (await getDb()).select().from(groupBuys)).toHaveLength(0);
  });
});

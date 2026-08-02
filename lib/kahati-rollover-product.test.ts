// A rolled-over counter keeps the product its parent carried.
//
// closeFullKahati documents that the sibling "inherits the product", and every
// other seeded column is copied. product_id was not, which was invisible while
// nothing read it — and became load-bearing the moment the hatian board started
// reconciling itself against the product list (app/api/groupbuys/route.ts).
//
// With the link dropped, a counter that fills reopens as an unclaimed row, the
// product reads as unrepresented, and the next board request opens a SECOND
// counter for it. The board then shows the same product twice, and gains
// another duplicate every time one of them fills.
import { describe, it, expect, beforeEach } from 'vitest';

const { GET } = await import('@/app/api/groupbuys/route');
const { eq } = await import('drizzle-orm');
const { getDb, groupBuys } = await import('@/lib/db');
const { closeFullKahati } = await import('@/lib/kahati-server');
const { resetDb, openBoards, makeProduct } = await import('@/lib/test/harness');

beforeEach(async () => {
  await resetDb();
  await openBoards();
});

const flagged = () => makeProduct({ name: 'Retatrutide', spec: '10mg', isGroupBuy: true, pricePhp: 9000 });

describe('a filled counter hands its product to its successor', () => {
  it('copies product_id onto the sibling it opens', async () => {
    const product = await flagged();
    await GET(); // seeds the counter for the product
    const db = await getDb();
    const [counter] = await db.select().from(groupBuys);

    const rollover = await closeFullKahati(db, counter);

    expect(rollover).not.toBeNull();
    expect(rollover!.opened.productId).toBe(product.id);
  });

  it('does not let a rollover open a duplicate counter on the next board read', async () => {
    // The failure this whole file exists for.
    await flagged();
    await GET();
    const db = await getDb();
    const [counter] = await db.select().from(groupBuys);
    await closeFullKahati(db, counter);

    const board = (await (await GET()).json()).data;

    // One sealed parent, one open sibling, and no third row invented for it.
    expect(board).toHaveLength(1);
    expect(await db.select().from(groupBuys)).toHaveLength(2);
  });

  it('stays at one open counter however many times it rolls over', async () => {
    await flagged();
    await GET();
    const db = await getDb();

    for (let i = 0; i < 3; i++) {
      const [open] = await db.select().from(groupBuys).where(eq(groupBuys.status, 'open'));
      await closeFullKahati(db, open);
      await GET();
    }

    const rows = await db.select().from(groupBuys);
    expect(rows.filter((r) => r.status === 'open')).toHaveLength(1);
    // Four rows total: the original plus one sibling per fill. No duplicates.
    expect(rows).toHaveLength(4);
  });
});


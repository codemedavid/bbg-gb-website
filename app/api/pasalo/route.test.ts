// The public Pasalo (Bunuan) board.
//
// What matters here is the ranking and the two quantity figures. The board's
// job is to direct attention at the batches a vial can still rescue, so a
// counter needing one vial must lead one needing six, and a counter that is
// already secured must not sit above a batch that is about to fail.
import { describe, it, expect, beforeEach } from 'vitest';

const { GET } = await import('./route');
const { resetDb, makeGroupBuy, openBoards, closeBoards } = await import('@/lib/test/harness');

beforeEach(async () => {
  await resetDb();
  await openBoards();
});

const board = async () => {
  const res = await GET();
  return { status: res.status, rows: (await res.json()).data };
};

describe('GET /api/pasalo', () => {
  it('lists only counters in the stage', async () => {
    await makeGroupBuy({ name: 'In stage', totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo' });
    await makeGroupBuy({ name: 'Still Kahati', totalSlots: 10, claimedSlots: 4, status: 'open' });
    await makeGroupBuy({ name: 'Done', totalSlots: 10, claimedSlots: 8, status: 'closed' });

    const { rows } = await board();

    expect(rows.map((r: { name: string }) => r.name)).toEqual(['In stage']);
  });

  it('reports needed-to-qualify and slots-remaining as different numbers', async () => {
    // The figure the whole feature turns on. At 5/10 the batch needs TWO more
    // vials to proceed and has FIVE slots left to sell.
    await makeGroupBuy({ totalSlots: 10, claimedSlots: 5, kahatiVials: 3, status: 'pasalo' });

    const { rows } = await board();

    expect(rows[0].neededToQualify).toBe(2);
    expect(rows[0].slotsRemaining).toBe(5);
  });

  it('splits the total into its Kahati and Pasalo halves', async () => {
    await makeGroupBuy({ totalSlots: 10, claimedSlots: 5, kahatiVials: 3, status: 'pasalo' });

    const { rows } = await board();

    expect(rows[0].kahatiVials).toBe(3);
    expect(rows[0].pasaloVials).toBe(2);
    expect(rows[0].claimedSlots).toBe(5);
  });

  it('leads with the batch closest to rescue', async () => {
    await makeGroupBuy({ name: 'Needs six', totalSlots: 10, claimedSlots: 1, kahatiVials: 1, status: 'pasalo' });
    await makeGroupBuy({ name: 'Needs one', totalSlots: 10, claimedSlots: 6, kahatiVials: 6, status: 'pasalo' });
    await makeGroupBuy({ name: 'Needs three', totalSlots: 10, claimedSlots: 4, kahatiVials: 4, status: 'pasalo' });

    const { rows } = await board();

    expect(rows.map((r: { name: string }) => r.name))
      .toEqual(['Needs one', 'Needs three', 'Needs six']);
  });

  it('sinks the already-secured counters below the ones still at risk', async () => {
    // A secured batch is topping up, not being rescued. Putting it above a
    // batch two vials from failing wastes the attention this board directs.
    await makeGroupBuy({ name: 'Secured', totalSlots: 10, claimedSlots: 8, kahatiVials: 8, status: 'pasalo' });
    await makeGroupBuy({ name: 'At risk', totalSlots: 10, claimedSlots: 5, kahatiVials: 5, status: 'pasalo' });

    const { rows } = await board();

    expect(rows.map((r: { name: string }) => r.name)).toEqual(['At risk', 'Secured']);
  });

  it('is hidden entirely while the storefront window is shut', async () => {
    // Same gate as the Kahati board: a closed board is indistinguishable from
    // one that never existed.
    await makeGroupBuy({ totalSlots: 10, claimedSlots: 3, kahatiVials: 3, status: 'pasalo' });
    await closeBoards();

    expect((await board()).status).toBe(404);
  });

  it('returns an empty board when every batch reached its minimum', async () => {
    const { status, rows } = await board();
    expect(status).toBe(200);
    expect(rows).toEqual([]);
  });
});

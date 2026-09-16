// A delisted product leaves the vial boards too.
//
// Both counter boards already refuse a product whose Kahati switch is off, and
// that rule is retroactive — a counter opened before the switch was flipped
// stops being published. Being DELISTED (`is_active = false`) is the stronger
// statement: the shop does not sell the product at all, on any channel
// (lib/product-channels.ts isChannelEnabled refuses it outright).
//
// The seeder has honoured that all along — lib/kahati-seed-bulk.ts only opens
// counters for active products — but the boards did not, so a counter opened
// while the product was listed outlived the delisting. Prod carried exactly one
// of these: a Selank counter, 0/10, on the board with the product withdrawn.
import { describe, it, expect, beforeEach } from 'vitest';

const { GET: KAHATI } = await import('./route');
const { GET: PASALO } = await import('../pasalo/route');
const { resetDb, openBoards, makeProduct, makeGroupBuy } = await import('@/lib/test/harness');

const namesOn = async (route: () => Promise<Response>): Promise<string[]> =>
  ((await (await route()).json()).data as { name: string }[]).map((g) => g.name);

beforeEach(async () => {
  await resetDb();
  await openBoards();
});

describe('the vial boards drop a product the shop has delisted', () => {
  it('keeps a delisted product off the kahati board', async () => {
    // Kahati switch still ON, so only the delisting can explain its absence.
    const product = await makeProduct({ name: 'Selank', spec: '10mg vial', isKahati: true, isActive: false });
    await makeGroupBuy({ name: 'Selank 10mg vial', productId: product.id, status: 'open' });

    expect(await namesOn(KAHATI)).toEqual([]);
  });

  it('keeps a delisted product off the pasalo board', async () => {
    // The rescue board must not rescue a batch of something we no longer sell:
    // every vial pledged here would have to be refunded anyway.
    const product = await makeProduct({ name: 'Selank', spec: '10mg vial', isKahati: true, isActive: false });
    await makeGroupBuy({ name: 'Selank 10mg vial', productId: product.id, status: 'pasalo', kahatiVials: 4 });

    expect(await namesOn(PASALO)).toEqual([]);
  });

  it('still lists a counter whose product is listed and switched on', async () => {
    const product = await makeProduct({ name: 'Retatrutide', spec: '10mg', isKahati: true, pricePhp: 9000 });
    await makeGroupBuy({ name: 'Retatrutide 10mg', productId: product.id, status: 'open' });

    expect(await namesOn(KAHATI)).toEqual(['Retatrutide 10mg']);
  });

  it('still lists a free-text counter with no product behind it', async () => {
    // No product link, so no switch and no listing flag could refuse it. NULL
    // must not read as delisted.
    await makeGroupBuy({ name: 'Hand-made counter', productId: null, status: 'open' });

    expect(await namesOn(KAHATI)).toEqual(['Hand-made counter']);
  });
});

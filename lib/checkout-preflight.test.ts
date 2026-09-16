// The early "is anything in this cart dead?" check that runs before a checkout
// stores its payment proofs (lib/checkout-preflight.ts).
//
// Two ways for it to be wrong, and the second is the expensive one:
//   * missing a dead line — harmless, the transaction still refuses it;
//   * flagging a LIVE line — the page deletes it from the customer's cart and
//     the sale is lost. So most of what follows is about what must NOT be
//     flagged: a Pasalo counter, a filled batch that rolls into its successor,
//     a product still on its channel.
//
// And every refusal must end in the refId, or a browser still running the
// previous build cannot drop the line from the message alone.
import { describe, it, expect, beforeEach } from 'vitest';
import { getDb } from '@/lib/db';
import { findUnavailableLines } from '@/lib/checkout-preflight';
import { staleCheckoutLine } from '@/lib/checkout-error';
import {
  resetDb, makeProduct, makeGroupBuy, makeMoqCampaign, makeMoqProduct,
} from '@/lib/test/harness';

beforeEach(async () => {
  await resetDb();
});

const check = async (items: Parameters<typeof findUnavailableLines>[1]) =>
  findUnavailableLines(await getDb(), items);

/** The line the old client would drop, read from the message alone. */
const droppedByMessage = (message: string) => {
  const stale = staleCheckoutLine(message);
  return stale && 'refId' in stale ? stale.refId : null;
};

describe('on-hand products', () => {
  it('passes a product still sold on hand', async () => {
    const p = await makeProduct();
    expect(await check([{ kind: 'product', refId: p.id }])).toEqual([]);
  });

  it('flags a delisted product, with a message naming its id', async () => {
    const p = await makeProduct({ isActive: false });
    const [dead] = await check([{ kind: 'product', refId: p.id }]);
    expect(dead.refId).toBe(p.id);
    expect(droppedByMessage(dead.message)).toBe(p.id);
  });

  it('flags a product whose On-Hand switch is off, with a message naming its id', async () => {
    const p = await makeProduct({ isOnHand: false });
    const [dead] = await check([{ kind: 'product', refId: p.id }]);
    expect(droppedByMessage(dead.message)).toBe(p.id);
  });

  it('reports a product held by the piece and by the kit once', async () => {
    const p = await makeProduct({ isActive: false });
    const found = await check([{ kind: 'product', refId: p.id }, { kind: 'product', refId: p.id }]);
    expect(found).toHaveLength(1);
  });
});

describe('MOQ products', () => {
  it('flags an inactive MOQ product', async () => {
    const m = await makeMoqProduct({ isActive: false });
    const [dead] = await check([{ kind: 'moq_product', refId: m.id }]);
    expect(droppedByMessage(dead.message)).toBe(m.id);
  });

  it('passes an active one', async () => {
    const m = await makeMoqProduct();
    expect(await check([{ kind: 'moq_product', refId: m.id }])).toEqual([]);
  });
});

describe('group buy batches', () => {
  it('passes a filled batch whose series has an open successor — the kits roll forward', async () => {
    const first = await makeMoqCampaign({ status: 'completed', batchNo: 1 });
    await makeMoqCampaign({ status: 'open', seriesId: first.seriesId, batchNo: 2 });
    expect(await check([{ kind: 'moq_campaign', refId: first.id }])).toEqual([]);
  });

  it('flags a filled batch whose series was cancelled after it', async () => {
    const first = await makeMoqCampaign({ status: 'completed', batchNo: 1 });
    await makeMoqCampaign({ status: 'cancelled', seriesId: first.seriesId, batchNo: 2 });
    const [dead] = await check([{ kind: 'moq_campaign', refId: first.id }]);
    expect(droppedByMessage(dead.message)).toBe(first.id);
  });

  it('flags a batch whose every product has left the Group Buy channel', async () => {
    const p = await makeProduct({ isGroupBuy: false });
    const c = await makeMoqCampaign({ includedProducts: [{ productId: p.id, name: 'Retatrutide' }] });
    const [dead] = await check([{ kind: 'moq_campaign', refId: c.id }]);
    expect(droppedByMessage(dead.message)).toBe(c.id);
  });

  it('passes a batch that still carries one product on the channel', async () => {
    const off = await makeProduct({ isGroupBuy: false });
    const on = await makeProduct({ isGroupBuy: true });
    const c = await makeMoqCampaign({
      includedProducts: [{ productId: off.id, name: 'Off' }, { productId: on.id, name: 'On' }],
    });
    expect(await check([{ kind: 'moq_campaign', refId: c.id }])).toEqual([]);
  });

  it('flags a batch that no longer exists', async () => {
    const missing = '00000000-0000-4000-8000-000000000001';
    const [dead] = await check([{ kind: 'moq_campaign', refId: missing }]);
    expect(droppedByMessage(dead.message)).toBe(missing);
  });
});

describe('kahati counters', () => {
  it('passes a counter in its Pasalo stage — it still sells vials', async () => {
    const g = await makeGroupBuy({ status: 'pasalo' });
    expect(await check([{ kind: 'group_buy', refId: g.id }])).toEqual([]);
  });

  it('flags a cancelled counter by id, never by its (re-used) name', async () => {
    const g = await makeGroupBuy({ status: 'cancelled', name: 'Retatrutide (Salt Form) 20mg vial' });
    const [dead] = await check([{ kind: 'group_buy', refId: g.id }]);
    expect(dead).toMatchObject({ refId: g.id, kind: 'group_buy', name: 'Retatrutide (Salt Form) 20mg vial' });
    expect(droppedByMessage(dead.message)).toBe(g.id);
  });

  it('flags a counter whose product has left the Kahati channel', async () => {
    const p = await makeProduct({ isKahati: false });
    const g = await makeGroupBuy({ productId: p.id });
    const [dead] = await check([{ kind: 'group_buy', refId: g.id }]);
    expect(droppedByMessage(dead.message)).toBe(g.id);
  });

  it('passes a counter whose product is still on the Kahati channel', async () => {
    const p = await makeProduct({ isKahati: true });
    const g = await makeGroupBuy({ productId: p.id });
    expect(await check([{ kind: 'group_buy', refId: g.id }])).toEqual([]);
  });
});

// The Group Buy board honours the switch that put a product on it.
//
// `products.is_group_buy` is the permission, and every WRITE already respects
// it: the bulk seeder only opens batches for flagged products
// (lib/campaign-seed-bulk.ts), and the create route refuses a campaign carrying
// an unflagged one (lib/channel-guard.ts). The READ did not. So un-ticking the
// switch removed the product from every future batch and left the batch already
// on the board selling it — which is exactly what an admin means by "we
// unchecked it and it still appears".
//
// The Kahati board has filtered on its own switch all along
// (app/api/groupbuys/route.ts), and this is the same rule for the other board:
// retroactive, applied in the query, and not applied to the admin — who still
// has to see the batch in order to cancel it.
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

const { GET } = await import('./route');
const { resetDb, openBoards, makeUser, makeProduct, makeMoqCampaign } = await import('@/lib/test/harness');

const names = async (): Promise<string[]> =>
  ((await (await GET()).json()).data as { name: string }[]).map((c) => c.name);

async function signIn(role: 'customer' | 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

/**
 * A catalog product with the Group Buy switch OFF, priced so that nothing else
 * about it could explain a missing listing. Deliberately not seedable: the
 * board's own reconciler must not open a fresh batch for it either.
 */
const unflagged = (name: string, extra: Record<string, unknown> = {}) =>
  makeProduct({ name, spec: '10mg', isGroupBuy: false, isKahati: false, pricePhp: 9000, ...extra });

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('the group buy board honours the Group Buy switch', () => {
  it('drops a batch whose product has had Group Buy switched off', async () => {
    const product = await unflagged('Retatrutide (Pen Cartridge)');
    await makeMoqCampaign({
      name: 'Retatrutide (Pen Cartridge) 10mg',
      includedProducts: [{ productId: product.id, name: 'Retatrutide (Pen Cartridge)' }],
    });

    expect(await names()).toEqual([]);
  });

  it('drops a batch whose product has been delisted from the shop', async () => {
    // A delisted product is refused on every channel (lib/product-channels.ts),
    // switches notwithstanding: the shop does not sell it at all.
    const product = await unflagged('Selank', { isGroupBuy: true, isActive: false });
    await makeMoqCampaign({
      name: 'Selank 10mg vial',
      includedProducts: [{ productId: product.id, name: 'Selank' }],
    });

    expect(await names()).toEqual([]);
  });

  it('keeps a batch whose product is still on the channel', async () => {
    const product = await makeProduct({ name: 'Tirzepatide', spec: '30mg', isGroupBuy: true, pricePhp: 4913 });
    await makeMoqCampaign({
      name: 'Tirzepatide 30mg',
      includedProducts: [{ productId: product.id, name: 'Tirzepatide' }],
    });

    expect(await names()).toContain('Tirzepatide 30mg');
  });

  it('keeps a hand-composed batch that carries no product at all', async () => {
    // Ten live batches on the board are shaped like this. They have no product
    // whose switch could refuse them, so NULL must not read as off — the same
    // allowance the Kahati board makes for a free-text counter.
    await makeMoqCampaign({ name: 'Bac Water 10ml', includedProducts: [] });

    expect(await names()).toEqual(['Bac Water 10ml']);
  });

  it('keeps a multi-product batch while any one of its products is still sold', async () => {
    // Dropping the whole batch would delist the products still on the channel
    // along with it. The per-line `outOfStock` flag is how one item of a batch
    // is withdrawn; the batch itself leaves only when nothing in it is sold.
    const live = await makeProduct({ name: 'Glutathione', spec: '5g', isGroupBuy: true, pricePhp: 4000 });
    const gone = await unflagged('Vitamin C');
    await makeMoqCampaign({
      name: 'Skin Bundle',
      includedProducts: [
        { productId: gone.id, name: 'Vitamin C' },
        { productId: live.id, name: 'Glutathione' },
      ],
    });

    expect(await names()).toEqual(['Skin Bundle']);
  });

  it('still shows the admin an off-channel batch, so it can be cancelled', async () => {
    // Hiding it from the admin too would strand it: open, holding commitments,
    // and unreachable from the only screen that can end it. The batch is hidden
    // by AUDIENCE, exactly as a scheduled batch already is.
    const product = await unflagged('Retatrutide (Pen Cartridge)');
    await makeMoqCampaign({
      name: 'Retatrutide (Pen Cartridge) 10mg',
      includedProducts: [{ productId: product.id, name: 'Retatrutide (Pen Cartridge)' }],
    });
    await signIn('admin');

    expect(await names()).toEqual(['Retatrutide (Pen Cartridge) 10mg']);
  });
});

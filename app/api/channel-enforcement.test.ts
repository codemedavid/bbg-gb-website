// Sales channels are enforced on the server, not just hidden on the frontend.
//
// The requirement is explicit: "Do not rely only on frontend hiding … a
// customer must not be able to bypass the UI and manually submit an API request
// to add that product to a Kahati order." So these tests reach past every board
// and post ids straight to the routes, which is what an unhidden client, a
// persisted cart, or curl would do. Hiding a thing and refusing it are
// different guarantees, and only the second one holds when someone tries.
//
// Naming, because it is genuinely inverted: the client's "Kahati" is the table
// named `group_buys` (cart kind 'group_buy'), and the client's "Group Buy" is
// `moq_campaigns` (cart kind 'moq_campaign').
import { describe, it, expect, beforeEach, vi } from 'vitest';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  return {
    ApiError,
    getSession: async () => session.current,
    requireSession,
    requireAdmin: async () => requireSession(),
  };
});

const { POST: placeOrder } = await import('./orders/route');
const { GET: getKahatiBoard } = await import('./groupbuys/route');
const { GET: getCampaigns, POST: createCampaign } = await import('./campaigns/route');
const { GET: listProducts } = await import('./products/route');
const {
  resetDb, openBoards, makeUser, makeProduct, makeGroupBuy, makeMoqCampaign, checkoutRequest,
} = await import('@/lib/test/harness');
const { openKahatisForGroupBuyProducts } = await import('@/lib/kahati-seed-bulk');
const { openCampaignsForGroupBuyProducts } = await import('@/lib/campaign-seed-bulk');

async function signIn(role: 'customer' | 'admin' = 'customer') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

const boardNames = async (): Promise<string[]> => {
  const body = await (await getKahatiBoard()).json();
  return (body.data as { name: string }[]).map((g) => g.name);
};

const shopNames = async (): Promise<string[]> => {
  const res = await listProducts(new Request('http://localhost/api/products?onHand=true'));
  const body = await res.json();
  return (body.data as { name: string }[]).map((p) => p.name);
};

const campaignRequest = (included: { productId: string; name: string }[]) =>
  new Request('http://localhost/api/campaigns', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Campaign', pricePerKitPhp: 9000, moq: 10, perCustomerMin: 1,
      includedProducts: included.map((p) => ({ ...p, outOfStock: false })),
    }),
  });

// The requirement's headline case, stated as channels rather than as a
// category: sold on-hand and poolable as whole kits, but never splittable per
// vial. Nothing here says "Korean" — that is the point.
const makeUnsplittable = () => makeProduct({
  name: 'Rejuran i', spec: '1 prefilled syringe, 1ml',
  isOnHand: true, isGroupBuy: true, isKahati: false,
  pricePhp: 12000, gbPricePerKitPhp: 12000, gbMinVials: 1,
});

const makePeptide = () => makeProduct({
  name: 'Retatrutide', spec: '20mg vial',
  isOnHand: true, isGroupBuy: true, isKahati: true,
  pricePhp: 9000, gbPricePerKitPhp: 9000, gbMinVials: 1,
});

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
});

describe('Kahati channel — a product with Kahati off', () => {
  it('gets no hatian counter opened for it', async () => {
    await makeUnsplittable();

    const report = await openKahatisForGroupBuyProducts();

    expect(report.created).toBe(0);
    expect(await boardNames()).toEqual([]);
  });

  it('does not stop the rest of the board seeding', async () => {
    // The rule must be a filter, not a circuit breaker: one excluded product in
    // the catalogue must not take the whole board down with it.
    await makeUnsplittable();
    await makePeptide();

    await openKahatisForGroupBuyProducts();

    expect(await boardNames()).toEqual(['Retatrutide 20mg vial']);
  });

  it('loses a counter that was already open when the switch was turned off', async () => {
    // Un-ticking Kahati is retroactive. A counter opened while the switch was
    // still on must leave the board, not linger because it predates the change.
    const product = await makeUnsplittable();
    await makeGroupBuy({ name: 'Rejuran i 1ml', productId: product.id, minVials: 1 });

    expect(await boardNames()).toEqual([]);
  });

  it('keeps a free-text counter that has no product link', async () => {
    // A counter an admin typed by hand has no product whose switches could
    // refuse it. Excluding it would be reading NULL as "off".
    await makeGroupBuy({ name: 'Hand-made counter', productId: null, minVials: 1 });

    expect(await boardNames()).toEqual(['Hand-made counter']);
  });

  it('refuses a counter id posted straight to checkout, bypassing the board', async () => {
    // The requirement in full. The counter exists and is open; only the channel
    // switch stands between the customer and a purchase, and it has to hold
    // here or it holds nowhere.
    await signIn();
    const product = await makeUnsplittable();
    const counter = await makeGroupBuy({ productId: product.id, minVials: 1 });

    const res = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: counter.id, qty: 1 },
    ]));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Rejuran i');
    expect(body.error).toContain('Kahati');
  });

  it('refuses without naming any product category', async () => {
    // The rule is general. A message that still said "Korean" would be the
    // hardcoded rule surviving in the copy after leaving the code.
    await signIn();
    const product = await makeUnsplittable();
    const counter = await makeGroupBuy({ productId: product.id, minVials: 1 });

    const body = await (await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: counter.id, qty: 1 },
    ]))).json();

    expect(body.error).not.toMatch(/korean/i);
  });

  it('claims no vials on the counter it refused', async () => {
    // A rejection that still moved the counter would let a refused customer
    // consume someone else's slot.
    await signIn();
    const product = await makeUnsplittable();
    const counter = await makeGroupBuy({ productId: product.id, minVials: 1, claimedSlots: 3 });

    await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: counter.id, qty: 1 }]));

    const { getDb, groupBuys } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await (await getDb()).select().from(groupBuys).where(eq(groupBuys.id, counter.id));
    expect(row.claimedSlots).toBe(3);
  });

  it('rolls back the whole cart rather than part-filling it', async () => {
    // The customer uploaded proof for one total. Quietly dropping the refused
    // line would charge them for a different order than the one they reviewed.
    await signIn();
    const blocked = await makeUnsplittable();
    const blockedCounter = await makeGroupBuy({ productId: blocked.id, minVials: 1 });
    const peptide = await makePeptide();
    const goodCounter = await makeGroupBuy({ name: 'Retatrutide 20mg vial', productId: peptide.id, minVials: 1 });

    const res = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: goodCounter.id, qty: 1 },
      { kind: 'group_buy', refId: blockedCounter.id, qty: 1 },
    ]));

    expect(res.status).toBe(400);
    const { getDb, orders } = await import('@/lib/db');
    expect(await (await getDb()).select().from(orders)).toEqual([]);
  });

  it('still accepts a commitment on a product with Kahati on', async () => {
    // The guard must refuse the switched-off product and nothing else.
    await signIn();
    const peptide = await makePeptide();
    const counter = await makeGroupBuy({ productId: peptide.id, minVials: 1 });

    const res = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: counter.id, qty: 1 },
    ]));

    expect(res.status).toBe(201);
  });

  it('still accepts a free-text counter with no product link', async () => {
    await signIn();
    const counter = await makeGroupBuy({ productId: null, minVials: 1 });

    const res = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: counter.id, qty: 1 },
    ]));

    expect(res.status).toBe(201);
  });
});

describe('Group Buy channel — a product with Group Buy off', () => {
  it('gets no campaign seeded for it', async () => {
    await makeProduct({
      name: 'Kahati Only', isGroupBuy: false, isKahati: true,
      gbPricePerKitPhp: 9000, gbMinVials: 1,
    });

    const report = await openCampaignsForGroupBuyProducts();

    expect(report.created).toBe(0);
  });

  it('cannot be added to a campaign through the admin API', async () => {
    // §5: only Group Buy = ON products may be selected. Enforced on the write,
    // not merely filtered out of the picker the admin sees.
    await signIn('admin');
    const blocked = await makeProduct({
      name: 'Kahati Only', isGroupBuy: false, isKahati: true,
    });

    const res = await createCampaign(campaignRequest([{ productId: blocked.id, name: 'Kahati Only' }]));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Kahati Only');
    expect(body.error).toContain('Group Buy');
  });

  it('writes no campaign row when it refuses one', async () => {
    await signIn('admin');
    const blocked = await makeProduct({ name: 'Kahati Only', isGroupBuy: false, isKahati: true });

    await createCampaign(campaignRequest([{ productId: blocked.id, name: 'Kahati Only' }]));

    const { getDb, moqCampaigns } = await import('@/lib/db');
    expect(await (await getDb()).select().from(moqCampaigns)).toEqual([]);
  });

  it('refuses the whole campaign when only one included product is off-channel', async () => {
    // Partial acceptance would silently publish a campaign different from the
    // one the admin submitted.
    await signIn('admin');
    const allowed = await makePeptide();
    const blocked = await makeProduct({ name: 'Kahati Only', isGroupBuy: false, isKahati: true });

    const res = await createCampaign(campaignRequest([
      { productId: allowed.id, name: 'Retatrutide' },
      { productId: blocked.id, name: 'Kahati Only' },
    ]));

    expect(res.status).toBe(400);
  });

  it('accepts a campaign whose products all have Group Buy on', async () => {
    await signIn('admin');
    const allowed = await makePeptide();

    const res = await createCampaign(campaignRequest([{ productId: allowed.id, name: 'Retatrutide' }]));

    expect(res.status).toBe(201);
  });

  it('accepts a campaign that includes no products at all', async () => {
    // A free-text batch an admin composed by hand has no product to check.
    await signIn('admin');

    const res = await createCampaign(campaignRequest([]));

    expect(res.status).toBe(201);
  });
});

describe('Group Buy channel — a product with Group Buy on', () => {
  it('stays on the campaign board even with Kahati switched off', async () => {
    // The other half of the requirement, and the easier one to break by
    // accident: excluding a product from Kahati must not leak onto the board
    // that DOES sell it.
    await makeUnsplittable();
    await makeMoqCampaign({ moq: 10, perCustomerMin: 1 });

    const body = await (await getCampaigns()).json();

    expect(body.data).toHaveLength(1);
  });

  it('accepts a Group Buy commitment at checkout', async () => {
    await signIn();
    await makeUnsplittable();
    const campaign = await makeMoqCampaign({ moq: 10, perCustomerMin: 1 });

    const res = await placeOrder(checkoutRequest([
      { kind: 'moq_campaign', refId: campaign.id, qty: 1 },
    ]));

    expect(res.status).toBe(201);
  });
});

describe('On-Hand channel — a product with On-Hand off', () => {
  it('is absent from the shop listing', async () => {
    await makeProduct({ name: 'Group Buy Only', isOnHand: false, isGroupBuy: true, isKahati: true });
    await makePeptide();

    expect(await shopNames()).toEqual(['Retatrutide']);
  });

  it('is refused at checkout even when its id is posted directly', async () => {
    await signIn();
    const product = await makeProduct({
      name: 'Group Buy Only', isOnHand: false, isGroupBuy: true, isKahati: true,
      // Priced as if it were sellable, so the refusal can only come from the
      // channel switch and not from a missing price.
      onHandPiecePhp: 550, onHandKitPhp: 5000, stock: 100,
    });

    const res = await placeOrder(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('On-Hand');
  });

  it('draws down no stock on the product it refused', async () => {
    await signIn();
    const product = await makeProduct({
      name: 'Group Buy Only', isOnHand: false, onHandPiecePhp: 550, stock: 100,
    });

    await placeOrder(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));

    const { getDb, products } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const [row] = await (await getDb()).select().from(products).where(eq(products.id, product.id));
    expect(row.stock).toBe(100);
  });

  it('still accepts a product with On-Hand on', async () => {
    await signIn();
    const product = await makePeptide();

    const res = await placeOrder(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));

    expect(res.status).toBe(201);
  });
});

describe('the three switches are independent', () => {
  it('honours On-Hand + Group Buy without Kahati (the requirement\'s Example 1)', async () => {
    await signIn();
    const product = await makeUnsplittable();
    const counter = await makeGroupBuy({ productId: product.id, minVials: 1 });

    // On-Hand: sold. Kahati: refused. Group Buy: the campaign board still
    // carries it, asserted above.
    const onHand = await placeOrder(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));
    const kahati = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: counter.id, qty: 1 },
    ]));

    expect(onHand.status).toBe(201);
    expect(kahati.status).toBe(400);
  });

  it('honours all three switched on (Example 2)', async () => {
    await signIn();
    const product = await makePeptide();
    const counter = await makeGroupBuy({ productId: product.id, minVials: 1 });

    const onHand = await placeOrder(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));
    const kahati = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: counter.id, qty: 1 },
    ]));

    expect(onHand.status).toBe(201);
    expect(kahati.status).toBe(201);
    expect(await boardNames()).toContain('Retatrutide 20mg vial');
  });

  it('honours On-Hand + Kahati without Group Buy (Example 3)', async () => {
    // The combination the old single is_group_buy flag could not express at
    // all: one switch drove both boards, so this product could not exist.
    await signIn();
    const product = await makeProduct({
      name: 'Kahati Only', spec: '10mg vial',
      isOnHand: true, isGroupBuy: false, isKahati: true,
      gbPricePerKitPhp: 9000, gbMinVials: 1,
    });
    const counter = await makeGroupBuy({ productId: product.id, minVials: 1 });

    const onHand = await placeOrder(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));
    const kahati = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: counter.id, qty: 1 },
    ]));
    const campaigns = await openCampaignsForGroupBuyProducts();

    expect(onHand.status).toBe(201);
    expect(kahati.status).toBe(201);
    expect(campaigns.created).toBe(0);
  });

  it('refuses a delisted product through every channel', async () => {
    await signIn();
    const product = await makeProduct({
      name: 'Discontinued', isActive: false,
      isOnHand: true, isGroupBuy: true, isKahati: true,
    });
    const counter = await makeGroupBuy({ productId: product.id, minVials: 1 });

    const onHand = await placeOrder(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));
    const kahati = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: counter.id, qty: 1 },
    ]));

    expect(onHand.status).toBe(400);
    expect(kahati.status).toBe(400);
  });
});

// A cart holding listings the shop has stopped selling.
//
// Reported 2026-09-14: "Nag-attach ako ng payment, tapos naghang. Nawala ang
// Reta SF 20mg sa list ko" — and again on the next try. Every Group Buy and
// Kahati listing was cancelled on 2026-09-10 and re-seeded under new ids, while
// the customer's cart (persisted in the browser) still held the old ones.
//
// What the route did with that cart:
//   1. stored every payment proof FIRST — the long "hang" on mobile data;
//   2. then refused on the FIRST dead line only;
//   3. so the page dropped one line per attempt, each attempt a fresh upload,
//      and the order was never placed.
//
// The rules asserted here: a dead line is refused before any proof is stored,
// and every dead line in the cart is named in that one response.
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

// Wrapped, not replaced: the real validation and storage still run, the test
// only needs to know whether they were reached.
vi.mock('@/lib/proof', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/proof')>();
  return { ...actual, validateAndStoreProofs: vi.fn(actual.validateAndStoreProofs) };
});

const { POST: placeOrder } = await import('./route');
const { validateAndStoreProofs } = await import('@/lib/proof');
const {
  resetDb, openBoards, makeUser, makeProduct, makeGroupBuy, makeMoqCampaign, checkoutRequest,
} = await import('@/lib/test/harness');
const { staleCheckoutLine } = await import('@/lib/checkout-error');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

async function orderCount(): Promise<number> {
  const { getDb, orders } = await import('@/lib/db');
  const db = await getDb();
  return (await db.select().from(orders)).length;
}

type Body = {
  success: boolean;
  error: string | null;
  data: { unavailable?: { refId: string; kind: string; name: string }[] } | null;
};

beforeEach(async () => {
  session.current = null;
  vi.mocked(validateAndStoreProofs).mockClear();
  await resetDb();
  await openBoards();
});

describe('POST /api/orders — a cart holding a cancelled listing', () => {
  it('refuses before storing any payment proof', async () => {
    await signIn();
    const product = await makeProduct();
    const dead = await makeGroupBuy({ name: 'Retatrutide (Salt Form) 20mg vial', status: 'cancelled', minVials: 1 });

    const res = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: dead.id, qty: 1 },
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));

    expect(res.status).toBe(400);
    expect(validateAndStoreProofs).not.toHaveBeenCalled();
    expect(await orderCount()).toBe(0);
  });

  it('names the dead line by id, kind and name', async () => {
    await signIn();
    const product = await makeProduct();
    const dead = await makeGroupBuy({ name: 'Retatrutide (Salt Form) 20mg vial', status: 'cancelled', minVials: 1 });

    const res = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: dead.id, qty: 1 },
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));
    const body = await res.json() as Body;

    expect(body.data?.unavailable).toEqual([
      { refId: dead.id, kind: 'group_buy', name: 'Retatrutide (Salt Form) 20mg vial' },
    ]);
  });
});

describe('POST /api/orders — a cart holding several dead listings', () => {
  it('names every one of them in a single response, in cart order', async () => {
    // The loop the customer was stuck in: one line dropped per attempt.
    await signIn();
    const product = await makeProduct();
    const deadKahati = await makeGroupBuy({ name: 'Retatrutide (Salt Form) 20mg vial', status: 'cancelled', minVials: 1 });
    const deadBatch = await makeMoqCampaign({ name: 'Retatrutide 10mg vial', status: 'cancelled' });
    const missingKahati = '00000000-0000-4000-8000-000000000000';

    const res = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: deadKahati.id, qty: 1 },
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
      { kind: 'moq_campaign', refId: deadBatch.id, qty: 1 },
      { kind: 'group_buy', refId: missingKahati, qty: 1 },
    ]));
    const body = await res.json() as Body;

    expect(res.status).toBe(400);
    expect(body.data?.unavailable?.map((l) => l.refId)).toEqual([deadKahati.id, deadBatch.id, missingKahati]);
    expect(validateAndStoreProofs).not.toHaveBeenCalled();
  });

  it('keeps an error message the already-deployed checkout page can still match', async () => {
    // A browser holding the previous build reads only `error`. It must still
    // be able to drop at least the first dead line rather than loop on a
    // message it cannot parse.
    await signIn();
    const deadKahati = await makeGroupBuy({ name: 'Retatrutide (Salt Form) 20mg vial', status: 'cancelled', minVials: 1 });
    const deadBatch = await makeMoqCampaign({ status: 'cancelled' });

    const res = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: deadKahati.id, qty: 1 },
      { kind: 'moq_campaign', refId: deadBatch.id, qty: 1 },
    ]));
    const body = await res.json() as Body;

    expect(staleCheckoutLine(body.error ?? '')).not.toBeNull();
  });
});

describe('POST /api/orders — lines that are still sellable', () => {
  it('does not flag a live cart, which still places and stores its proof', async () => {
    await signIn();
    const product = await makeProduct();
    const live = await makeGroupBuy({ status: 'open', minVials: 1 });

    const res = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: live.id, qty: 1 },
      { kind: 'product', refId: product.id, qty: 1, unit: 'piece' },
    ]));

    expect(res.status).toBe(201);
    expect(validateAndStoreProofs).toHaveBeenCalledTimes(1);
  });

  it('does not flag a quantity shortfall — that is the customer’s to fix, not a dead line', async () => {
    await signIn();
    const product = await makeProduct();

    const res = await placeOrder(checkoutRequest([
      { kind: 'product', refId: product.id, qty: 100_000, unit: 'piece' },
    ]));
    const body = await res.json() as Body;

    expect(res.status).toBe(400);
    expect(body.data?.unavailable ?? []).toEqual([]);
  });
});

// Reported 2026-09-25 (KH-3075 / KH-3076): T30 SF sat in the cart on a counter
// that had since filled and sealed, with its successor already open. Checkout
// dropped the line as "no longer available", the customer re-placed without
// it, and the proof they had already sent covered vials no order held.
describe('POST /api/orders — a cart line on a kahati counter that has since filled', () => {
  async function filledWithSuccessor() {
    const product = await makeProduct({ isKahati: true });
    const filled = await makeGroupBuy({
      productId: product.id, status: 'closed', claimedSlots: 10, totalSlots: 10, minVials: 1,
    });
    const successor = await makeGroupBuy({ productId: product.id, status: 'open', minVials: 1 });
    return { filled, successor };
  }

  it('places the line on the open successor instead of refusing it', async () => {
    await signIn();
    const onHand = await makeProduct();
    const { filled, successor } = await filledWithSuccessor();

    const res = await placeOrder(checkoutRequest([
      { kind: 'group_buy', refId: filled.id, qty: 2 },
      { kind: 'product', refId: onHand.id, qty: 1, unit: 'piece' },
    ]));

    expect(res.status).toBe(201);
    const { getDb, orderItems, groupBuys } = await import('@/lib/db');
    const { eq } = await import('drizzle-orm');
    const db = await getDb();
    const kahatiLines = (await db.select().from(orderItems)).filter((l) => l.kind === 'group_buy');
    expect(kahatiLines).toHaveLength(1);
    expect(kahatiLines[0]).toMatchObject({ groupBuyId: successor.id, qty: 2 });
    const [after] = await db.select().from(groupBuys).where(eq(groupBuys.id, successor.id));
    expect(after.claimedSlots).toBe(2);
  });

  it('does not list it as unavailable', async () => {
    await signIn();
    const { filled } = await filledWithSuccessor();

    const res = await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: filled.id, qty: 1 }]));
    const body = await res.json() as Body;

    expect(body.data?.unavailable ?? []).toEqual([]);
    expect(res.status).toBe(201);
  });
});

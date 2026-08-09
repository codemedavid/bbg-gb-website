// The hatian final checkout takes several proofs too — and takes them later.
//
// A settlement is usually the LARGEST payment a customer makes: it clears the
// balance on every hatian they joined this cycle, plus the packing fee. That is
// exactly the amount a bank's per-transfer cap splits in two or three, so the
// single slot this flow had was worse here than at checkout.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

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

const { POST: settle } = await import('./route');
const { POST: addProofs } = await import('./[id]/proofs/route');
const { POST: checkout } = await import('../orders/route');
const {
  resetDb, openBoards, makeUser, makeGroupBuy, checkoutRequest, settlementRequest,
} = await import('@/lib/test/harness');
const { getDb, groupBuys, settlements, settlementPaymentProofs } = await import('@/lib/db');

async function signIn() {
  const user = await makeUser({ role: 'customer' });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

/** Commit to a hatian and close it, so the commitment is ready to settle. */
async function readyToSettle(qty = 3) {
  const gb = await makeGroupBuy({ minVials: 1, pricePerKitPhp: 9000, totalSlots: 100 });
  await checkout(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty }]));
  const db = await getDb();
  await db.update(groupBuys).set({ status: 'closed' }).where(eq(groupBuys.id, gb.id));
}

async function proofsOf(settlementId: string) {
  const { asc } = await import('drizzle-orm');
  return (await getDb()).select().from(settlementPaymentProofs)
    .where(eq(settlementPaymentProofs.settlementId, settlementId))
    .orderBy(asc(settlementPaymentProofs.sortOrder));
}

const addProofRequest = (count = 1): Request => {
  const form = new FormData();
  for (let i = 0; i < count; i++) {
    form.append('proof', new File([Buffer.from(`late-${i}`)], `late-${i}.png`, { type: 'image/png' }));
  }
  return new Request('http://localhost/x', { method: 'POST', body: form });
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Settle with `proofCount` proofs and return the settlement row. */
async function settleWith(proofCount: number) {
  await readyToSettle();
  const res = await settle(settlementRequest({ proofCount }));
  expect(res.status).toBe(201);
  const [row] = await (await getDb()).select().from(settlements);
  return row;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
  await openBoards();
  await signIn();
});

describe('POST /api/settlements — several proofs at once', () => {
  it('files one proof for a single-transfer settlement', async () => {
    const s = await settleWith(1);

    expect(await proofsOf(s.id)).toHaveLength(1);
  });

  it('files three for a settlement paid in three transfers', async () => {
    // ONE settlement, three proofs — the same guarantee §13 makes for orders.
    const s = await settleWith(3);

    expect(await (await getDb()).select().from(settlements)).toHaveLength(1);
    expect(await proofsOf(s.id)).toHaveLength(3);
  });

  it('numbers them in submission order', async () => {
    const s = await settleWith(3);

    expect((await proofsOf(s.id)).map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it('refuses a sixth', async () => {
    await readyToSettle();

    const res = await settle(settlementRequest({ proofCount: 6 }));

    expect(res.status).toBe(400);
  });

  it('creates no settlement when it refuses the proofs', async () => {
    await readyToSettle();

    await settle(settlementRequest({ proofCount: 6 }));

    expect(await (await getDb()).select().from(settlements)).toEqual([]);
  });

  it('still refuses a settlement with no proof at all', async () => {
    await readyToSettle();

    const res = await settle(settlementRequest({ withProof: false }));

    expect(res.status).toBe(400);
  });

  it('keeps the legacy single key pointing at the first proof', async () => {
    // The admin list still reads settlements.payment_proof_key.
    const s = await settleWith(3);

    expect(s.paymentProofKey).toBe((await proofsOf(s.id))[0].storageKey);
  });
});

describe('POST /api/settlements/[id]/proofs — a transfer made later', () => {
  it('attaches a proof to a settlement already submitted', async () => {
    const s = await settleWith(1);

    const res = await addProofs(addProofRequest(1), ctx(s.id));

    expect(res.status).toBe(201);
    expect(await proofsOf(s.id)).toHaveLength(2);
  });

  it('numbers it after the ones already filed', async () => {
    const s = await settleWith(2);

    await addProofs(addProofRequest(1), ctx(s.id));

    expect((await proofsOf(s.id)).map((p) => p.sortOrder)).toEqual([0, 1, 2]);
  });

  it('builds to five across separate visits', async () => {
    const s = await settleWith(2);

    await addProofs(addProofRequest(1), ctx(s.id));
    await addProofs(addProofRequest(2), ctx(s.id));

    expect(await proofsOf(s.id)).toHaveLength(5);
  });

  it('refuses the sixth even on its own visit', async () => {
    const s = await settleWith(5);

    const res = await addProofs(addProofRequest(1), ctx(s.id));

    expect(res.status).toBe(400);
    expect(await proofsOf(s.id)).toHaveLength(5);
  });

  it('refuses another customer\'s settlement', async () => {
    const s = await settleWith(1);
    await signIn(); // a different customer

    const res = await addProofs(addProofRequest(1), ctx(s.id));

    expect(res.status).toBe(403);
  });

  it('refuses a signed-out visitor', async () => {
    const s = await settleWith(1);
    session.current = null;

    const res = await addProofs(addProofRequest(1), ctx(s.id));

    expect(res.status).toBe(401);
  });

  it('404s an unknown settlement', async () => {
    const res = await addProofs(
      addProofRequest(1),
      ctx('00000000-0000-0000-0000-000000000000'),
    );

    expect(res.status).toBe(404);
  });

  it('refuses one on a settlement the admin already marked paid', async () => {
    // Verified and closed. Another screenshot against it is not a payment, and
    // accepting it would suggest the customer still owes something.
    const s = await settleWith(1);
    await (await getDb()).update(settlements).set({ status: 'paid' }).where(eq(settlements.id, s.id));

    const res = await addProofs(addProofRequest(1), ctx(s.id));

    expect(res.status).toBe(400);
  });

  it('refuses one on a cancelled settlement', async () => {
    const s = await settleWith(1);
    await (await getDb()).update(settlements).set({ status: 'cancelled' }).where(eq(settlements.id, s.id));

    const res = await addProofs(addProofRequest(1), ctx(s.id));

    expect(res.status).toBe(400);
  });

  it('leaves the legacy single key pointing at the original', async () => {
    const s = await settleWith(1);

    await addProofs(addProofRequest(1), ctx(s.id));

    const [after] = await (await getDb()).select().from(settlements).where(eq(settlements.id, s.id));
    expect(after.paymentProofKey).toBe(s.paymentProofKey);
  });
});

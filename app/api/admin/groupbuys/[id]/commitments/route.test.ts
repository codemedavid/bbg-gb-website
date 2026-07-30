// The participants feed and the admin panel that renders it are one contract.
//
// They drifted once: the feed renamed balancePhp to orderBalancePhp while the
// panel kept reading the old name, so every row formatted `undefined` as money,
// php() threw, React unmounted the tree and clicking "Participants & payments"
// showed the admin nothing but Next's client-side exception screen. Both sides
// now share the HatianCommitment type, and this file asserts the feed really
// produces it — against a live database, from a real checkout, not a fixture
// hand-written to agree with whichever side was edited last.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { HatianCommitment } from '@/lib/types';

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
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { GET } = await import('./route');
const { POST: placeOrder } = await import('@/app/api/orders/route');
const { PATCH: setOrderStatus } = await import('@/app/api/admin/orders/[id]/status/route');
const { resetDb, makeUser, makeGroupBuy, makePaymentMethod, checkoutRequest } = await import('@/lib/test/harness');

// Every field the panel reads off a row. Listed here rather than derived from a
// sample response: a feed that stops sending one of these must fail, and a
// response compared only against itself can never notice.
const PANEL_FIELDS: readonly (keyof HatianCommitment)[] = [
  'orderId', 'orderNo', 'orderStatus',
  'customerName', 'customerEmail', 'customerPhone',
  'contactPhone', 'shippingAddress',
  'vials', 'committedAt',
  'orderBalancePhp', 'spansOtherHatians', 'downpaymentPhp', 'amountPaidPhp',
  'downpayment', 'finalPayment', 'packingFee',
  'paymentMethod', 'proofUrl', 'settledAt',
];

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function signIn(role: 'customer' | 'admin' = 'admin', email?: string) {
  const user = await makeUser(email ? { role, email } : { role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

async function joinKahati(groupBuyId: string, qty: number) {
  const res = await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: groupBuyId, qty }]));
  const body = await res.json();
  if (res.status !== 201) throw new Error(`join failed: ${body.error}`);
  return body.data.order;
}

// Clears the reservation downpayment the way an admin does: by verifying the
// uploaded proof. Signs back in as the customer afterwards so a test can keep
// acting as one.
async function confirmPayment(orderId: string) {
  const customer = session.current;
  await signIn('admin');
  const res = await setOrderStatus(
    new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ status: 'payment_confirmed' }) }),
    ctx(orderId),
  );
  if (res.status !== 200) throw new Error(`confirm failed: ${(await res.json()).error}`);
  session.current = customer;
}

async function commitments(groupBuyId: string): Promise<HatianCommitment[]> {
  await signIn('admin');
  const res = await GET(new Request('http://localhost'), ctx(groupBuyId));
  const body = await res.json();
  expect(res.status).toBe(200);
  return body.data;
}

beforeEach(async () => {
  await resetDb();
  session.current = null;
});

describe('GET /admin/groupbuys/[id]/commitments', () => {
  it('sends every field the participants panel renders', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1, pricePerKitPhp: 10400 });
    await signIn('customer');
    await joinKahati(gb.id, 3);

    const [row] = await commitments(gb.id);

    expect(Object.keys(row).sort()).toEqual([...PANEL_FIELDS].sort());
  });

  it('reports the order balance as a number the money formatter can render', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1, pricePerKitPhp: 10400 });
    await signIn('customer');
    await joinKahati(gb.id, 3);

    const [row] = await commitments(gb.id);

    // The specific failure this file exists for: an absent or non-numeric
    // balance is what php() threw on.
    expect(typeof row.orderBalancePhp).toBe('number');
    expect(Number.isFinite(row.orderBalancePhp)).toBe(true);
  });

  it('timestamps commitments as ISO strings, not Date objects', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1 });
    await signIn('customer');
    await joinKahati(gb.id, 2);

    const [row] = await commitments(gb.id);

    // The panel calls new Date(committedAt).toLocaleString on this.
    expect(typeof row.committedAt).toBe('string');
    expect(Number.isNaN(new Date(row.committedAt).getTime())).toBe(false);
    expect(row.settledAt).toBeNull();
  });

  it('names each participant and how many vials they took from this counter', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1 });
    await signIn('customer', 'ana@example.com');
    await joinKahati(gb.id, 3);
    await signIn('customer', 'ben@example.com');
    await joinKahati(gb.id, 2);

    const rows = await commitments(gb.id);

    // Oldest commitment first — "who was first" is the question an
    // oversubscribed batch gets asked.
    expect(rows.map((r) => [r.customerEmail, r.vials])).toEqual([
      ['ana@example.com', 3],
      ['ben@example.com', 2],
    ]);
    expect(rows.every((r) => r.customerName.length > 0)).toBe(true);
  });

  it('returns nothing for a hatian nobody has joined', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1 });

    expect(await commitments(gb.id)).toEqual([]);
  });

  // Where the parcel is going, taken from the order's delivery snapshot rather
  // than from the user record: an address edited after committing must not
  // rewrite where an already-packed batch was shipped.
  describe('delivery details', () => {
    it('sends the contact number and shipping address captured at checkout', async () => {
      const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1 });
      await signIn('customer');
      await joinKahati(gb.id, 2);

      const [row] = await commitments(gb.id);

      expect(row.contactPhone.length).toBeGreaterThan(0);
      expect(row.shippingAddress.length).toBeGreaterThan(0);
    });
  });

  describe('what the customer has paid', () => {
    // A proof sitting in review is not money in the bank. Counting it would
    // overstate every batch summary built on this feed — and a fresh commitment
    // is exactly that state, so this is the common case, not the edge.
    it('counts nothing paid while the proof is still under review', async () => {
      const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1, pricePerKitPhp: 10400 });
      await signIn('customer');
      await joinKahati(gb.id, 3);

      const [row] = await commitments(gb.id);

      expect(row.downpayment).toBe('under_review');
      expect(row.amountPaidPhp).toBe(0);
      expect(row.downpaymentPhp).toBeGreaterThan(0);
    });

    it('counts a downpayment as received once the admin confirms it', async () => {
      const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1, pricePerKitPhp: 10400 });
      await signIn('customer');
      const order = await joinKahati(gb.id, 3);
      await confirmPayment(order.id);

      const [row] = await commitments(gb.id);

      // Committing charges the downpayment only; the balance follows at the
      // final checkout. Amount paid and remaining balance are therefore two
      // different figures, not one rendered twice.
      expect(row.amountPaidPhp).toBe(row.downpaymentPhp);
      expect(row.orderBalancePhp).toBeGreaterThan(0);
      expect(row.amountPaidPhp).not.toBe(row.orderBalancePhp);
    });
  });

  describe('proof of payment', () => {
    it('sends a fetchable URL for the uploaded proof, never the raw storage key', async () => {
      const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1 });
      await signIn('customer');
      await joinKahati(gb.id, 2);

      const [row] = await commitments(gb.id);

      // Proofs are private. A key would be useless to the browser and would
      // leak the storage layout; the panel needs something it can put in <img>.
      expect(row.proofUrl).toBeTruthy();
      expect(row.proofUrl).toMatch(/^(https?:)?\//);
    });

    it('sends null rather than a broken URL when no proof was uploaded', async () => {
      const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1 });
      await signIn('customer');
      const res = await placeOrder(
        checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }], { withProof: false }),
      );
      // Proof is mandatory at checkout, so this order should never exist. If the
      // rule ever relaxes, the feed must degrade to null instead of signing "".
      if (res.status === 201) {
        const [row] = await commitments(gb.id);
        expect(row.proofUrl).toBeNull();
      } else {
        expect(res.status).toBe(400);
      }
    });

    it('reports how the customer paid', async () => {
      const gb = await makeGroupBuy({ totalSlots: 10, minVials: 1 });
      // Checkout only accepts a registered, active method — an unknown label is
      // rejected rather than snapshotted onto the order.
      await makePaymentMethod({ label: 'GoTyme' });
      await signIn('customer');
      const res = await placeOrder(
        checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }], { paymentMethod: 'GoTyme' }),
      );
      expect(res.status).toBe(201);

      const [row] = await commitments(gb.id);

      expect(row.paymentMethod).toBe('GoTyme');
    });
  });
});

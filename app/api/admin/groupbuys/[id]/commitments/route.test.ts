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
const { resetDb, makeUser, makeGroupBuy, checkoutRequest } = await import('@/lib/test/harness');

// Every field the panel reads off a row. Listed here rather than derived from a
// sample response: a feed that stops sending one of these must fail, and a
// response compared only against itself can never notice.
const PANEL_FIELDS: readonly (keyof HatianCommitment)[] = [
  'orderId', 'orderNo', 'orderStatus',
  'customerName', 'customerEmail', 'customerPhone',
  'vials', 'committedAt',
  'orderBalancePhp', 'spansOtherHatians', 'downpaymentPhp',
  'downpayment', 'finalPayment', 'packingFee', 'settledAt',
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
});

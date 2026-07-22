// Admin hatian lifecycle policy:
//   * cancelling a hatian releases every participant (orders cancelled,
//     refund email, history note) — same flow the expiry sweep runs;
//   * closing an open hatian below the 7-vial minimum IS a cancellation —
//     the batch is never ordered, so "closed" would strand the participants;
//   * an admin edit that fills the kit closes it and auto-opens the sibling
//     batch, exactly as reaching the cap at checkout does;
//   * claimedSlots can never exceed totalSlots, on create or on edit;
//   * a hatian with participant orders cannot be deleted — only cancelled.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq, ne } from 'drizzle-orm';

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

const { PATCH, DELETE } = await import('./route');
const { POST } = await import('../route');
const { POST: placeOrder } = await import('@/app/api/orders/route');
const { getDb, groupBuys, orders, orderStatusHistory, emailLog } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy, checkoutRequest } = await import('@/lib/test/harness');

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patchReq = (body: Record<string, unknown>) =>
  new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) });
const postReq = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/admin/groupbuys', { method: 'POST', body: JSON.stringify(body) });

async function signIn(role: 'customer' | 'admin' = 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role: user.role, email: user.email };
  return user;
}

async function joinKahati(groupBuyId: string, qty: number): Promise<string> {
  await signIn('customer');
  const res = await placeOrder(checkoutRequest([{ kind: 'group_buy', refId: groupBuyId, qty }]));
  const body = await res.json();
  if (res.status !== 201) throw new Error(`join failed: ${body.error}`);
  return body.data.order.id as string;
}

async function gbRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row;
}

async function orderStatus(id: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row.status;
}

beforeEach(async () => {
  session.current = null;
  await resetDb();
});

describe('PATCH status=cancelled releases the participants', () => {
  it('cancels every live participant order', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const a = await joinKahati(gb.id, 2);
    const b = await joinKahati(gb.id, 3);

    await signIn('admin');
    const res = await PATCH(patchReq({ status: 'cancelled' }), ctx(gb.id));

    expect(res.status).toBe(200);
    expect((await gbRow(gb.id)).status).toBe('cancelled');
    expect(await orderStatus(a)).toBe('cancelled');
    expect(await orderStatus(b)).toBe('cancelled');
  });

  it('records why the order was cancelled and emails the refund notice', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1, name: 'Tesa Hatian' });
    const orderId = await joinKahati(gb.id, 2);

    await signIn('admin');
    await PATCH(patchReq({ status: 'cancelled' }), ctx(gb.id));

    const db = await getDb();
    const history = await db.select().from(orderStatusHistory)
      .where(and(eq(orderStatusHistory.orderId, orderId), eq(orderStatusHistory.status, 'cancelled')));
    expect(history).toHaveLength(1);
    expect(history[0].note).toMatch(/Tesa Hatian/);
    const sent = await db.select().from(emailLog).where(eq(emailLog.kind, 'kahati_cancelled'));
    expect(sent).toHaveLength(1);
  });

  it('is idempotent — a second cancel neither re-cancels nor re-emails', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const orderId = await joinKahati(gb.id, 2);

    await signIn('admin');
    await PATCH(patchReq({ status: 'cancelled' }), ctx(gb.id));
    await PATCH(patchReq({ status: 'cancelled' }), ctx(gb.id));

    const db = await getDb();
    const history = await db.select().from(orderStatusHistory)
      .where(and(eq(orderStatusHistory.orderId, orderId), eq(orderStatusHistory.status, 'cancelled')));
    expect(history).toHaveLength(1);
    const sent = await db.select().from(emailLog).where(eq(emailLog.kind, 'kahati_cancelled'));
    expect(sent).toHaveLength(1);
  });
});

describe('PATCH status=closed below the 7-vial minimum is a cancellation', () => {
  it('persists cancelled, releases the participants and reports what happened', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const orderId = await joinKahati(gb.id, 3);

    await signIn('admin');
    const res = await PATCH(patchReq({ status: 'closed' }), ctx(gb.id));

    expect(res.status).toBe(200);
    // The response must show what actually happened so the admin UI is honest.
    expect((await res.json()).data.status).toBe('cancelled');
    expect((await gbRow(gb.id)).status).toBe('cancelled');
    expect(await orderStatus(orderId)).toBe('cancelled');
    const db = await getDb();
    const sent = await db.select().from(emailLog).where(eq(emailLog.kind, 'kahati_cancelled'));
    expect(sent).toHaveLength(1);
  });

  it('keeps a plain close at or above the minimum', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    const orderId = await joinKahati(gb.id, 7);

    await signIn('admin');
    const res = await PATCH(patchReq({ status: 'closed' }), ctx(gb.id));

    expect(res.status).toBe(200);
    expect((await gbRow(gb.id)).status).toBe('closed');
    expect(await orderStatus(orderId)).toBe('proof_review');
  });
});

describe('PATCH auto-close on fill opens the sibling batch', () => {
  it('closes and clones exactly one fresh sibling when a count-only edit fills the kit', async () => {
    const gb = await makeGroupBuy({ name: 'FillMe', totalSlots: 10, claimedSlots: 9 });
    await signIn('admin');

    const res = await PATCH(patchReq({ claimedSlots: 10 }), ctx(gb.id));

    expect(res.status).toBe(200);
    expect((await gbRow(gb.id)).status).toBe('closed');
    const db = await getDb();
    const siblings = await db.select().from(groupBuys)
      .where(and(eq(groupBuys.name, 'FillMe'), ne(groupBuys.id, gb.id)));
    expect(siblings).toHaveLength(1);
    expect(siblings[0]).toMatchObject({ status: 'open', claimedSlots: 0, totalSlots: 10 });
  });

  it('closes and clones when the admin form (which always sends status) fills the kit', async () => {
    const gb = await makeGroupBuy({ name: 'FormFill', totalSlots: 10, claimedSlots: 9 });
    await signIn('admin');

    const res = await PATCH(patchReq({ claimedSlots: 10, status: 'open' }), ctx(gb.id));

    expect(res.status).toBe(200);
    expect((await gbRow(gb.id)).status).toBe('closed');
    const db = await getDb();
    const siblings = await db.select().from(groupBuys)
      .where(and(eq(groupBuys.name, 'FormFill'), ne(groupBuys.id, gb.id)));
    expect(siblings).toHaveLength(1);
    expect(siblings[0]).toMatchObject({ status: 'open', claimedSlots: 0 });
  });
});

describe('claimedSlots can never exceed totalSlots', () => {
  it('rejects an edit that pushes the count past the cap', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0 });
    await signIn('admin');
    const res = await PATCH(patchReq({ claimedSlots: 15 }), ctx(gb.id));
    expect(res.status).toBe(400);
  });

  it('rejects shrinking the cap below the vials already claimed', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 8 });
    await signIn('admin');
    const res = await PATCH(patchReq({ totalSlots: 5 }), ctx(gb.id));
    expect(res.status).toBe(400);
    expect((await gbRow(gb.id)).totalSlots).toBe(10);
  });

  it('rejects creating a hatian already over its own cap', async () => {
    await signIn('admin');
    const res = await POST(postReq({ name: 'Overfull', pricePerKitPhp: 9000, totalSlots: 10, claimedSlots: 15 }));
    expect(res.status).toBe(400);
  });

  it('rejects creating over the default cap when totalSlots is omitted', async () => {
    await signIn('admin');
    const res = await POST(postReq({ name: 'Overfull', pricePerKitPhp: 9000, claimedSlots: 15 }));
    expect(res.status).toBe(400);
  });
});

describe('DELETE with participant orders', () => {
  it('refuses with 409 and keeps the hatian so the admin can cancel it instead', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0, minVials: 1 });
    await joinKahati(gb.id, 2);

    await signIn('admin');
    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), ctx(gb.id));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/cancel/i);
    expect(await gbRow(gb.id)).toBeTruthy();
  });

  it('still deletes a hatian nobody has joined', async () => {
    const gb = await makeGroupBuy({ totalSlots: 10, claimedSlots: 0 });
    await signIn('admin');

    const res = await DELETE(new Request('http://localhost', { method: 'DELETE' }), ctx(gb.id));

    expect(res.status).toBe(200);
    expect(await gbRow(gb.id)).toBeUndefined();
  });
});

// The hatian deadline is authoritative at checkout. Expired counters are only
// resolved lazily (sweepExpiredKahatis runs on board reads), so a checkout can
// arrive while an expired hatian is still marked 'open' — the claim itself has
// to refuse it, and with a message that says "closed", not "N vials left".
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
    ApiError, getSession: async () => session.current, requireSession,
    requireAdmin: async () => requireSession(),
  };
});

const { POST } = await import('./route');
const { getDb, groupBuys } = await import('@/lib/db');
const { resetDb, makeUser, makeGroupBuy, checkoutRequest } = await import('@/lib/test/harness');

const HOUR = 60 * 60 * 1000;

beforeEach(async () => {
  session.current = null;
  const user = await resetDb().then(() => makeUser());
  session.current = { sub: user.id, role: 'customer', email: user.email };
});

describe('checkout on an expired-but-unswept hatian', () => {
  it('refuses the commit and leaves the counter untouched', async () => {
    const gb = await makeGroupBuy({
      totalSlots: 10, claimedSlots: 0, minVials: 1,
      closesAt: new Date(Date.now() - HOUR),
    });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }]));

    expect(res.status).toBe(400);
    const db = await getDb();
    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, gb.id));
    expect(row.claimedSlots).toBe(0);
  });

  it('says the hatian closed — not that vials ran out', async () => {
    const gb = await makeGroupBuy({
      totalSlots: 10, claimedSlots: 0, minVials: 1,
      closesAt: new Date(Date.now() - HOUR),
    });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }]));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(String(body.error)).toMatch(/closed/i);
    expect(String(body.error)).not.toMatch(/vials left/i);
  });

  it('still accepts a commit while the deadline is in the future', async () => {
    const gb = await makeGroupBuy({
      totalSlots: 10, claimedSlots: 0, minVials: 1,
      closesAt: new Date(Date.now() + HOUR),
    });

    const res = await POST(checkoutRequest([{ kind: 'group_buy', refId: gb.id, qty: 2 }]));

    expect(res.status).toBe(201);
  });
});

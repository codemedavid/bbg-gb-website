// Creating a row that opens later, and what a scheduled row refuses.
//
// The admin never picks the 'scheduled' status by hand — they set an open date,
// and the create routes derive the status from it. That keeps "scheduled" and
// "has a future open date" from drifting apart, which is the state where a row
// sits waiting for a moment that already passed.
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
    requireAdmin: async () => {
      const s = await requireSession();
      if (s.role !== 'admin') throw new ApiError(403, 'Admin access required.');
      return s;
    },
  };
});

const { POST: createCampaign } = await import('@/app/api/campaigns/route');
const { POST: createKahati } = await import('@/app/api/admin/groupbuys/route');
const { POST: checkout } = await import('@/app/api/orders/route');
const { getDb, moqCampaigns, groupBuys } = await import('@/lib/db');
const { resetDb, makeUser, commitRequest, checkoutRequest } = await import('@/lib/test/harness');

const DAY = 24 * 60 * 60 * 1000;
const isoFuture = (ms = DAY) => new Date(Date.now() + ms).toISOString();
const isoPast = (ms = DAY) => new Date(Date.now() - ms).toISOString();

const jsonReq = (body: unknown) =>
  new Request('http://localhost', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

async function signIn(role: 'customer' | 'admin') {
  const user = await makeUser({ role });
  session.current = { sub: user.id, role, email: user.email };
  return user;
}

const campaignBody = (extra: Record<string, unknown> = {}) => ({
  name: 'Scheduled Group Buy', pricePerKitPhp: 10400, moq: 10, ...extra,
});
const kahatiBody = (extra: Record<string, unknown> = {}) => ({
  name: 'Scheduled Hatian', pricePerKitPhp: 9000, ...extra,
});

beforeEach(async () => {
  await resetDb();
  session.current = null;
});

describe('POST /api/campaigns — scheduled creation', () => {
  it('creates a batch as scheduled when the open date is in the future', async () => {
    await signIn('admin');
    const opensAt = isoFuture();

    const res = await createCampaign(jsonReq(campaignBody({ opensAt })));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.status).toBe('scheduled');
    expect(new Date(body.data.opensAt).toISOString()).toBe(opensAt);
  });

  it('creates a batch open when no open date is given', async () => {
    await signIn('admin');

    const body = await (await createCampaign(jsonReq(campaignBody()))).json();

    expect(body.data.status).toBe('open');
    expect(body.data.opensAt).toBeNull();
  });

  // A date already behind us is not a schedule — it is now. Storing it as
  // scheduled would leave the batch waiting on a sweep to undo the admin's own
  // click, so it opens straight away.
  it('creates a batch open when the open date has already passed', async () => {
    await signIn('admin');

    const body = await (await createCampaign(jsonReq(campaignBody({ opensAt: isoPast() })))).json();

    expect(body.data.status).toBe('open');
  });

  it('rejects an open date at or after the deadline', async () => {
    await signIn('admin');

    const res = await createCampaign(jsonReq(campaignBody({
      opensAt: isoFuture(5 * DAY), deadline: isoFuture(2 * DAY),
    })));

    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/groupbuys — scheduled creation', () => {
  it('creates a counter as scheduled when the open date is in the future', async () => {
    await signIn('admin');

    const res = await createKahati(jsonReq(kahatiBody({ opensAt: isoFuture() })));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.status).toBe('scheduled');
  });

  it('creates a counter open when no open date is given', async () => {
    await signIn('admin');

    const body = await (await createKahati(jsonReq(kahatiBody()))).json();

    expect(body.data.status).toBe('open');
  });

  it('rejects an open date at or after the close date', async () => {
    await signIn('admin');

    const res = await createKahati(jsonReq(kahatiBody({
      opensAt: isoFuture(5 * DAY), closesAt: isoFuture(2 * DAY),
    })));

    expect(res.status).toBe(400);
  });
});

describe('a scheduled row accepts nothing', () => {
  it('refuses a commitment to a scheduled group buy', async () => {
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.insert(moqCampaigns).values({
      id, seriesId: id, batchNo: 1, name: 'Not open yet', pricePerKitPhp: '10400',
      moq: 10, committed: 0, status: 'scheduled', opensAt: new Date(Date.now() + DAY),
    });
    await signIn('customer');

    const res = await checkout(commitRequest(id, 1));

    expect(res.status).toBeGreaterThanOrEqual(400);
    const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
    expect(row.committed).toBe(0);
  });

  it('refuses a join on a scheduled kahati', async () => {
    const db = await getDb();
    const [kahati] = await db.insert(groupBuys).values({
      name: 'Not open yet', pricePerKitPhp: '9000', totalSlots: 10, claimedSlots: 0,
      minVials: 1, repackFeePhp: '150', status: 'scheduled', opensAt: new Date(Date.now() + DAY),
    }).returning();
    await signIn('customer');

    const res = await checkout(checkoutRequest([{ kind: 'group_buy', refId: kahati.id, qty: 1 }]));

    expect(res.status).toBeGreaterThanOrEqual(400);
    const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, kahati.id));
    expect(row.claimedSlots).toBe(0);
  });
});

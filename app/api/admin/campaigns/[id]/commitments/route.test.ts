import { describe, it, beforeEach, expect, vi } from 'vitest';
import { getDb, orders, orderItems } from '@/lib/db';
import { resetDb, makeUser, makeMoqCampaign, signToken } from '@/lib/test/harness';
import { GET } from './route';

// requireAdmin reads the session cookie; the harness signs tokens directly.
let cookieToken = '';
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cookieToken ? { value: cookieToken } : undefined), set: () => {} }),
}));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const call = async (id: string) => {
  const res = await GET(new Request('http://localhost/x'), ctx(id));
  return { status: res.status, body: await res.json() };
};

async function commit(opts: {
  userId: string; campaignId: string; orderNo: string; kits: number;
  packingFeePhp: number; totalPhp: number; createdAt?: Date;
}) {
  const db = await getDb();
  const [o] = await db.insert(orders).values({
    orderNo: opts.orderNo, userId: opts.userId, buyType: 'moq', status: 'proof_review',
    subtotalPhp: String(opts.totalPhp - opts.packingFeePhp), packingFeePhp: String(opts.packingFeePhp),
    totalPhp: String(opts.totalPhp),
    shipName: 'QA', shipPhone: '09171234567', shipAddress: '123 Mabini St',
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  }).returning();
  await db.insert(orderItems).values({
    orderId: o.id, kind: 'moq_campaign', moqCampaignId: opts.campaignId,
    nameSnapshot: 'QA campaign', unitPricePhp: '10400', qty: opts.kits, lineTotalPhp: String(10400 * opts.kits),
  });
  return o;
}

describe('GET /api/admin/campaigns/[id]/commitments', () => {
  beforeEach(async () => {
    await resetDb();
    const admin = await makeUser({ role: 'admin' });
    cookieToken = await signToken({ sub: admin.id, role: 'admin', email: admin.email });
  });

  it('refuses a caller who is not an admin', async () => {
    const customer = await makeUser({ role: 'customer' });
    cookieToken = await signToken({ sub: customer.id, role: 'customer', email: customer.email });
    const c = await makeMoqCampaign();
    const res = await call(c.id);
    expect(res.status).toBe(403);
  });

  it('404s for a campaign that does not exist', async () => {
    const res = await call('00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  it('returns no participants for a campaign nobody has committed to', async () => {
    const c = await makeMoqCampaign();
    const res = await call(c.id);
    expect(res.status).toBe(200);
    expect(res.body.data.participants).toEqual([]);
    expect(res.body.data.summary.participantCount).toBe(0);
  });

  it('lists a customer once however many orders they placed', async () => {
    const c = await makeMoqCampaign();
    const u = await makeUser();
    await commit({ userId: u.id, campaignId: c.id, orderNo: 'BBG-1', kits: 1, packingFeePhp: 300, totalPhp: 10700 });
    await commit({ userId: u.id, campaignId: c.id, orderNo: 'BBG-2', kits: 2, packingFeePhp: 0, totalPhp: 20800 });

    const res = await call(c.id);
    expect(res.body.data.participants).toHaveLength(1);
    expect(res.body.data.participants[0].orders.map((o: any) => o.orderNo)).toEqual(['BBG-1', 'BBG-2']);
  });

  it('reports the single packing fee the customer actually paid', async () => {
    const c = await makeMoqCampaign();
    const u = await makeUser();
    await commit({ userId: u.id, campaignId: c.id, orderNo: 'BBG-1', kits: 1, packingFeePhp: 300, totalPhp: 10700 });
    await commit({ userId: u.id, campaignId: c.id, orderNo: 'BBG-2', kits: 2, packingFeePhp: 0, totalPhp: 20800 });

    const [p] = (await call(c.id)).body.data.participants;
    expect(p.kits).toBe(3);
    expect(p.packingFeePhp).toBe(300);
    expect(p.chargedPackingFeeTwice).toBe(false);
  });

  it('flags a customer charged a packing fee twice in the same group buy', async () => {
    const c = await makeMoqCampaign();
    const u = await makeUser();
    await commit({ userId: u.id, campaignId: c.id, orderNo: 'BBG-1', kits: 1, packingFeePhp: 300, totalPhp: 10700 });
    await commit({ userId: u.id, campaignId: c.id, orderNo: 'BBG-2', kits: 1, packingFeePhp: 300, totalPhp: 10700 });

    const res = await call(c.id);
    expect(res.body.data.participants[0].chargedPackingFeeTwice).toBe(true);
    expect(res.body.data.summary.doubleChargedCount).toBe(1);
  });

  // A commitment bigger than the open batch fills it, seals it and continues in
  // the successor. Both batches belong to the campaign the admin opened, so both
  // must report here — under one participant, not two.
  it('reports commitments that overflowed into a successor batch', async () => {
    const first = await makeMoqCampaign({ moq: 10 });
    const second = await makeMoqCampaign({ seriesId: first.seriesId, batchNo: 2, moq: 10 });
    const u = await makeUser();
    const db = await getDb();
    const [o] = await db.insert(orders).values({
      orderNo: 'BBG-9', userId: u.id, buyType: 'moq', status: 'proof_review',
      subtotalPhp: '124800', packingFeePhp: '300', totalPhp: '125100',
      shipName: 'QA', shipPhone: '09171234567', shipAddress: '123 Mabini St',
    }).returning();
    await db.insert(orderItems).values([
      { orderId: o.id, kind: 'moq_campaign', moqCampaignId: first.id, nameSnapshot: 'b1', unitPricePhp: '10400', qty: 10, lineTotalPhp: '104000' },
      { orderId: o.id, kind: 'moq_campaign', moqCampaignId: second.id, nameSnapshot: 'b2', unitPricePhp: '10400', qty: 2, lineTotalPhp: '20800' },
    ]);

    const [p] = (await call(first.id)).body.data.participants;
    expect(p.kits).toBe(12);
    expect(p.orders).toHaveLength(1);
    expect(p.orders[0].batchNos).toEqual([1, 2]);
    // One order, one fee — counted once despite spanning two batches.
    expect(p.packingFeePhp).toBe(300);
    expect(p.totalPhp).toBe(125100);
  });

  it('keeps two customers in the same campaign apart', async () => {
    const c = await makeMoqCampaign();
    const a = await makeUser({ email: 'a@example.com' });
    const b = await makeUser({ email: 'b@example.com' });
    await commit({ userId: a.id, campaignId: c.id, orderNo: 'BBG-1', kits: 1, packingFeePhp: 300, totalPhp: 10700 });
    await commit({ userId: b.id, campaignId: c.id, orderNo: 'BBG-2', kits: 4, packingFeePhp: 300, totalPhp: 42000 });

    const { participants, summary } = (await call(c.id)).body.data;
    expect(participants).toHaveLength(2);
    expect(summary.participantCount).toBe(2);
    expect(summary.kits).toBe(5);
    expect(summary.packingFeesPhp).toBe(600);
    expect(summary.doubleChargedCount).toBe(0);
  });
});

import { describe, it, beforeEach, expect, vi } from 'vitest';
import { getDb, orders, orderItems, products, groupBuys } from '@/lib/db';
import { resetDb, makeUser, signToken } from '@/lib/test/harness';
import { POST } from './route';

// requireAdmin reads the session cookie; the harness signs tokens directly.
let cookieToken = '';
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => (cookieToken ? { value: cookieToken } : undefined), set: () => {} }),
}));

const call = async (body: unknown) => {
  const res = await POST(new Request('http://localhost/api/admin/report/refund', {
    method: 'POST', body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
};

const BATCH = { from: '2026-08-07', to: '2026-08-12' };

let buyerId = '';

/** A kahati order line for `code`, priced per vial, inside the batch window. */
async function kahatiLine(opts: {
  orderNo: string; productId: string; groupBuyId: string;
  qty: number; lineTotalPhp: number;
  shipName?: string; status?: 'payment_confirmed' | 'cancelled'; day?: string;
}) {
  const db = await getDb();
  const [o] = await db.insert(orders).values({
    orderNo: opts.orderNo, userId: buyerId, buyType: 'kahati',
    status: opts.status ?? 'payment_confirmed',
    subtotalPhp: String(opts.lineTotalPhp), totalPhp: String(opts.lineTotalPhp),
    shipName: opts.shipName ?? 'Christine', shipPhone: '09103572843', shipAddress: '1 Mabini St',
    createdAt: new Date(`${opts.day ?? '2026-08-08'}T04:00:00Z`),
  }).returning();
  await db.insert(orderItems).values({
    orderId: o.id, kind: 'group_buy', groupBuyId: opts.groupBuyId,
    nameSnapshot: 'BPC157 10mg vial — kahati',
    unitPricePhp: String(opts.lineTotalPhp / opts.qty), qty: opts.qty,
    lineTotalPhp: String(opts.lineTotalPhp),
  });
  return o;
}

/** A product plus the hatian counter that sells its vials. */
async function kahatiProduct(opts: { code: string; supplierCode?: string | null }) {
  const db = await getDb();
  const [p] = await db.insert(products).values({
    code: opts.code, supplierCode: opts.supplierCode ?? null,
    name: 'BPC157', spec: '10mg vial', pricePhp: '3750',
  }).returning();
  const [gb] = await db.insert(groupBuys).values({
    productId: p.id, name: 'BPC157 hatian', pricePerKitPhp: '3750',
  }).returning();
  return { productId: p.id, groupBuyId: gb.id };
}

describe('POST /api/admin/report/refund', () => {
  beforeEach(async () => {
    await resetDb();
    const admin = await makeUser({ role: 'admin' });
    cookieToken = await signToken({ sub: admin.id, role: 'admin', email: admin.email });
    const buyer = await makeUser({ role: 'customer', email: 'christine@example.com' });
    buyerId = buyer.id;
  });

  it('refuses a caller who is not an admin', async () => {
    const customer = await makeUser({ role: 'customer', email: 'nosy@example.com' });
    cookieToken = await signToken({ sub: customer.id, role: 'customer', email: customer.email });

    const res = await call({ ...BATCH, paste: 'BPC10\t0.4\t1500' });

    expect(res.status).toBe(403);
  });

  it('rejects a paste with no readable SKU rows rather than returning nothing', async () => {
    const res = await call({ ...BATCH, paste: 'TOTAL\t7.2\t36481.25' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No SKU rows/);
  });

  it('rejects a batch window that ends before it starts', async () => {
    const res = await call({ from: '2026-08-12', to: '2026-08-07', paste: 'BPC10\t0.4\t1500' });

    expect(res.status).toBe(400);
  });

  it('joins the sheet to real buyers, carrying name, phone and email', async () => {
    const { productId, groupBuyId } = await kahatiProduct({ code: 'BPC157', supplierCode: 'BPC10' });
    await kahatiLine({ orderNo: 'BBG-2472', productId, groupBuyId, qty: 4, lineTotalPhp: 1500 });

    const res = await call({ ...BATCH, paste: 'BPC10\t0.4\t1500' });

    expect(res.status).toBe(200);
    expect(res.body.data.rows).toHaveLength(1);
    expect(res.body.data.rows[0]).toMatchObject({
      tier: 'CONFIRMED',
      sku: 'BPC10',
      matchedBy: 'supplier_code',
      orderNo: 'BBG-2472',
      customer: 'Christine',
      phone: '09103572843',
      email: 'christine@example.com',
      refundDuePhp: 1500,
    });
  });

  it('reaches the supplier code through the hatian counter, not just direct lines', async () => {
    // A kahati item points at a group_buy, never at a product, so the code is
    // one join further out. Getting this wrong reads every hatian as unmapped.
    const { productId, groupBuyId } = await kahatiProduct({ code: 'BPC157', supplierCode: 'BPC10' });
    await kahatiLine({ orderNo: 'BBG-2472', productId, groupBuyId, qty: 4, lineTotalPhp: 1500 });

    const res = await call({ ...BATCH, paste: 'BPC10\t0.4\t1500' });

    expect(res.body.data.rows[0].matchedBy).toBe('supplier_code');
  });

  it('falls back to the per-vial price for a product with no supplier code', async () => {
    const { productId, groupBuyId } = await kahatiProduct({ code: 'BPC157', supplierCode: null });
    await kahatiLine({ orderNo: 'BBG-2472', productId, groupBuyId, qty: 2, lineTotalPhp: 750 });

    const res = await call({ ...BATCH, paste: 'BPC10\t0.4\t1500' });

    // ₱1500 over 4 vials is ₱375 a vial, which is what this line charges.
    expect(res.body.data.rows[0].matchedBy).toBe('unit_price');
  });

  it('leaves orders outside the batch window out of the join', async () => {
    const { productId, groupBuyId } = await kahatiProduct({ code: 'BPC157', supplierCode: 'BPC10' });
    await kahatiLine({ orderNo: 'BBG-2472', productId, groupBuyId, qty: 4, lineTotalPhp: 1500 });
    await kahatiLine({ orderNo: 'KH-9999', productId, groupBuyId, qty: 4, lineTotalPhp: 1500, day: '2026-08-20' });

    const res = await call({ ...BATCH, paste: 'BPC10\t0.4\t1500' });

    expect(res.body.data.rows.map((r: { orderNo: string }) => r.orderNo)).toEqual(['BBG-2472']);
  });

  it('flags a SKU as ALLOCATE and decides nobody when more was ordered than is short', async () => {
    const { productId, groupBuyId } = await kahatiProduct({ code: 'BPC157', supplierCode: 'BPC10' });
    await kahatiLine({ orderNo: 'BBG-2472', productId, groupBuyId, qty: 4, lineTotalPhp: 1500 });
    await kahatiLine({ orderNo: 'BBG-2521', productId, groupBuyId, qty: 4, lineTotalPhp: 1500, shipName: 'Raquel' });

    const res = await call({ ...BATCH, paste: 'BPC10\t0.4\t1500' });

    const rows = res.body.data.rows as { tier: string; refundDuePhp: number | null }[];
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.tier === 'ALLOCATE')).toBe(true);
    expect(rows.every((r) => r.refundDuePhp === null)).toBe(true);
    expect(res.body.data.summary.allocatePhp).toBe(1500);
    expect(res.body.data.summary.confirmedPhp).toBe(0);
  });

  it('surfaces a SKU it could not match instead of dropping it', async () => {
    await kahatiProduct({ code: 'BPC157', supplierCode: 'BPC10' });

    const res = await call({ ...BATCH, paste: 'NOSUCHSKU\t0.1\t250' });

    expect(res.body.data.rows[0]).toMatchObject({ tier: 'UNMATCHED', sku: 'NOSUCHSKU', skuRefundPhp: 250 });
    expect(res.body.data.summary.unmatchedSkus).toEqual(['NOSUCHSKU']);
  });

  it('hands back the rows it skipped so nothing vanishes without being seen', async () => {
    const { productId, groupBuyId } = await kahatiProduct({ code: 'BPC157', supplierCode: 'BPC10' });
    await kahatiLine({ orderNo: 'BBG-2472', productId, groupBuyId, qty: 4, lineTotalPhp: 1500 });

    const res = await call({ ...BATCH, paste: 'TOTAL\t7.2\t36481.25\nBPC10\t0.4\t1500' });

    expect(res.body.data.skipped).toEqual(['TOTAL\t7.2\t36481.25']);
  });

  it('searches only kahati orders unless told otherwise', async () => {
    const { productId, groupBuyId } = await kahatiProduct({ code: 'BPC157', supplierCode: 'BPC10' });
    const db = await getDb();
    const [o] = await db.insert(orders).values({
      orderNo: 'BBG-8888', userId: buyerId, buyType: 'group_buy', status: 'payment_confirmed',
      subtotalPhp: '1500', totalPhp: '1500',
      shipName: 'Campaign Buyer', shipPhone: '09170000000', shipAddress: '2 Rizal Ave',
      createdAt: new Date('2026-08-08T04:00:00Z'),
    }).returning();
    await db.insert(orderItems).values({
      orderId: o.id, kind: 'product', productId,
      nameSnapshot: 'BPC157 10mg vial', unitPricePhp: '375', qty: 4, lineTotalPhp: '1500',
    });
    await kahatiLine({ orderNo: 'BBG-2472', productId, groupBuyId, qty: 4, lineTotalPhp: 1500 });

    const kahatiOnly = await call({ ...BATCH, paste: 'BPC10\t0.4\t1500' });
    expect(kahatiOnly.body.data.rows.map((r: { orderNo: string }) => r.orderNo)).toEqual(['BBG-2472']);

    const both = await call({ ...BATCH, paste: 'BPC10\t0.4\t1500', buyTypes: ['kahati', 'group_buy'] });
    expect(both.body.data.rows).toHaveLength(2);
  });
});

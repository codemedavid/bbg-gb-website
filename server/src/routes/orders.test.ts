// Integration tests for checkout — the money path.
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { createApp } from '../app.js';
import { db, groupBuys, orders } from '../db/index.js';
import { resetDb, makeUser, makeProduct, makeGroupBuy, PROOF, SHIPPING } from '../test/harness.js';

const app = createApp();

function checkout(token: string, items: unknown) {
  return request(app)
    .post('/api/orders')
    .set('Cookie', [`bbg_token=${token}`])
    .field('items', JSON.stringify(items))
    .field('shipName', SHIPPING.shipName)
    .field('shipPhone', SHIPPING.shipPhone)
    .field('shipAddress', SHIPPING.shipAddress)
    .attach(PROOF.field, Buffer.from(PROOF.file), PROOF.name);
}

beforeEach(resetDb);

describe('POST /api/orders', () => {
  it('places a solo order and charges shipping once', async () => {
    const user = await makeUser();
    const product = await makeProduct({ pricePhp: 3200 });

    const res = await checkout(user.token, [{ kind: 'product', refId: product.id, qty: 2 }]);

    expect(res.status).toBe(201);
    expect(res.body.data.totals).toMatchObject({ subtotal: 6400, shipping: 180, repackFee: 0, total: 6580 });
  });

  it('rejects an order with no payment proof', async () => {
    const user = await makeUser();
    const product = await makeProduct();
    const res = await request(app)
      .post('/api/orders')
      .set('Cookie', [`bbg_token=${user.token}`])
      .field('items', JSON.stringify([{ kind: 'product', refId: product.id, qty: 1 }]))
      .field('shipName', SHIPPING.shipName)
      .field('shipPhone', SHIPPING.shipPhone)
      .field('shipAddress', SHIPPING.shipAddress);
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const product = await makeProduct();
    const res = await request(app)
      .post('/api/orders')
      .field('items', JSON.stringify([{ kind: 'product', refId: product.id, qty: 1 }]));
    expect(res.status).toBe(401);
  });

  it('enforces the group buy minVials at checkout', async () => {
    const user = await makeUser();
    const gb = await makeGroupBuy({ minVials: 20 });
    const res = await checkout(user.token, [{ kind: 'group_buy', refId: gb.id, qty: 7 }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('20');
  });

  it('charges the group buy repack fee', async () => {
    const user = await makeUser();
    const gb = await makeGroupBuy({ repackFeePhp: 200, pricePerKitPhp: 9000 });
    const res = await checkout(user.token, [{ kind: 'group_buy', refId: gb.id, qty: 7 }]);
    expect(res.status).toBe(201);
    expect(res.body.data.totals).toMatchObject({ repackFee: 200, shipping: 0, total: 900 * 7 + 200 });
  });
});

describe('checkout concurrency', () => {
  it('gives concurrent orders distinct order numbers', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const product = await makeProduct({ stock: 100 });
    const item = [{ kind: 'product', refId: product.id, qty: 1 }];

    const results = await Promise.all([checkout(a.token, item), checkout(b.token, item)]);

    expect(results.map((r) => r.status)).toEqual([201, 201]);
    const rows = await db.select({ orderNo: orders.orderNo }).from(orders);
    expect(new Set(rows.map((r) => r.orderNo)).size).toBe(2);
  });

  it('never oversells kahati slots under concurrent commits', async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    // 10 slots, min 7: exactly one of two concurrent 7-vial commits can fit.
    const gb = await makeGroupBuy({ totalSlots: 10, minVials: 7 });
    const item = [{ kind: 'group_buy', refId: gb.id, qty: 7 }];

    const results = await Promise.all([checkout(a.token, item), checkout(b.token, item)]);

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 400)).toHaveLength(1);
    const [row] = await db.select({ claimed: groupBuys.claimedSlots }).from(groupBuys).where(eq(groupBuys.id, gb.id));
    expect(row.claimed).toBe(7);
  });
});

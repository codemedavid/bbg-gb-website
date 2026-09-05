// Fixtures for the Kahati → Pasalo → Refund end-to-end tests.
//
// Everything here drives the REAL routes. A helper that inserted an order row
// directly would prove nothing about checkout — the guarded slot claim, the
// packing-fee cycle rule, the proof requirement and the payment status are all
// decided there, and those are exactly the things under test.
//
// Test data is tagged E2E-TEST-* so a stray row is identifiable, though the
// harness runs on an in-memory PGlite that is truncated between tests.
import { and, eq } from 'drizzle-orm';
import {
  getDb, groupBuys, orders, orderItems, orderItemRefunds, products, settlements,
} from '@/lib/db';
import { makeUser, makeProduct, makeGroupBuy, openBoards } from '@/lib/test/harness';

export const TEST_TAG = 'E2E-TEST-BBG';

/** The session the mocked `@/lib/session` reads. Test files own the mock. */
export type TestSession = { sub: string; role: 'customer' | 'admin'; email: string } | null;

/** A 1×1 PNG. Checkout refuses an order with no proof, so every join carries one. */
export function proofFile(): File {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  return new File([png], 'proof.png', { type: 'image/png' });
}

export type Customer = { id: string; email: string; role: 'customer' | 'admin' };

export async function makeCustomer(label: string): Promise<Customer> {
  return makeUser({ email: `${label}-${Math.random().toString(36).slice(2, 8)}@example.com` });
}

/**
 * A catalog product with an OPEN hatian counter, as the board would have made
 * it: one kit of 10 vials, minimum 7 to proceed, priced per kit.
 */
export async function makeKahatiProduct(
  name: string,
  opts: { pricePerKitPhp?: number; totalSlots?: number } = {},
): Promise<{ productId: string; counterId: string; perVialPhp: number }> {
  const pricePerKitPhp = opts.pricePerKitPhp ?? 5500;
  const product = await makeProduct({
    name: `${TEST_TAG} ${name}`, spec: '5mg', isKahati: true, isGroupBuy: true,
    gbPricePerKitPhp: pricePerKitPhp,
  });
  const counter = await makeGroupBuy({
    name: `${TEST_TAG} ${name} 5mg`,
    productId: product.id,
    pricePerKitPhp,
    totalSlots: opts.totalSlots ?? 10,
    claimedSlots: 0,
    minVials: 1,
  });
  return { productId: product.id, counterId: counter.id, perVialPhp: pricePerKitPhp / 10 };
}

/** The multipart body checkout actually parses. */
export function checkoutForm(
  items: { kind: string; refId: string; qty: number }[],
  opts: { shipName?: string; idempotencyKey?: string; withProof?: boolean } = {},
): FormData {
  const form = new FormData();
  form.set('items', JSON.stringify(items));
  form.set('shipName', opts.shipName ?? 'Test Buyer');
  form.set('shipPhone', '09171234567');
  form.set('shipAddress', '123 Test Street, Manila');
  if (opts.idempotencyKey) form.set('idempotencyKey', opts.idempotencyKey);
  if (opts.withProof !== false) form.set('proof', proofFile());
  return form;
}

export const checkoutRequest = (form: FormData): Request =>
  new Request('http://localhost/api/orders', { method: 'POST', body: form });

/** Boards must be trading before any hatian commitment is accepted. */
export const openStorefront = openBoards;

// ---- Reads -----------------------------------------------------------------

export async function counterRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row;
}

export async function orderRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  return row;
}

export async function itemsOfOrder(orderId: string) {
  const db = await getDb();
  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
}

export async function allRefunds() {
  const db = await getDb();
  return db.select().from(orderItemRefunds);
}

export async function allOrders() {
  const db = await getDb();
  return db.select().from(orders);
}

export async function productRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(products).where(eq(products.id, id));
  return row;
}

/**
 * Mark an order's balance settled, which is what makes its GOODS refundable.
 *
 * A hatian collects a deposit at checkout and settles the goods afterwards, so
 * without this an order's failed line refunds ₱0 — correctly, because the money
 * never came in. Scenarios that assert a goods refund have to have paid for the
 * goods first, and this is the state that says so.
 */
export async function settleOrder(orderId: string): Promise<void> {
  const db = await getDb();
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  const balance = Number(order.totalPhp) - Number(order.downpaymentPhp);
  const [settlement] = await db.insert(settlements).values({
    userId: order.userId,
    status: 'paid',
    packingFeePhp: '0',
    balancePhp: String(balance),
    totalPhp: String(balance),
    paidAt: new Date(),
  }).returning();
  await db.update(orders).set({ settlementId: settlement.id }).where(eq(orders.id, orderId));
}

/** Vials a counter holds that belong to orders an admin has actually verified. */
export async function paymentConfirmedVials(counterId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select({ qty: orderItems.qty, paymentStatus: orders.paymentStatus })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orderItems.groupBuyId, counterId), eq(orders.paymentStatus, 'confirmed')));
  return rows.reduce((sum, r) => sum + r.qty, 0);
}

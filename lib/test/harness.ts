// Integration-test harness for the Next.js route handlers: applies the generated
// schema to an isolated in-memory PGlite (PGLITE_PATH=memory:// from vitest.config.ts),
// then gives each test a clean database plus fixture builders.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { getDb, users, categories, products, groupBuys, moqCampaigns, moqProducts, paymentMethods } from '@/lib/db';
import { hashPassword, signToken } from '@/lib/auth';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

// Cleared between tests, children before parents.
const TABLES = [
  'order_status_history', 'order_items', 'orders', 'settlements',
  'email_log', 'coa_files', 'group_buys', 'moq_campaigns', 'moq_products', 'payment_methods', 'products', 'categories', 'users',
  'settings',
];

let migrated = false;

export async function migrateOnce(): Promise<void> {
  if (migrated) return;
  const db = await getDb();
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (!files.length) throw new Error(`No migration SQL in ${MIGRATIONS_DIR} — run: npm run db:generate`);
  for (const file of files) {
    const statements = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await db.execute(sql.raw(statement));
  }
  migrated = true;
}

export async function resetDb(): Promise<void> {
  await migrateOnce();
  const db = await getDb();
  await db.execute(sql.raw(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`));
}

/**
 * Opens the shared Group Buy + Hatian window around this instant.
 *
 * The gate fails closed, so a freshly reset database has BOTH boards shut —
 * which is the correct production posture but not the precondition of a test
 * about commitments, rollover or settlement. Those tests call this to say "the
 * storefront is trading", the same as a real admin would have configured.
 *
 * Deliberately not folded into resetDb(): "never configured" is a state the
 * schedule tests assert on, and seeding it here would make that unreachable.
 */
export async function openBoards(): Promise<void> {
  const { setScheduleRecurrence } = await import('@/lib/settings');
  const { phtCalendarDate } = await import('@/lib/schedule');
  // A cycle that opened at midnight today, Manila time, and runs the full week.
  // Anchored to today's weekday rather than a fixed one so the boards are open
  // whenever the suite happens to run, which is the precondition these tests
  // want — not a particular calendar day.
  const today = phtCalendarDate(new Date()).weekday;
  await setScheduleRecurrence({
    openDay: today, openTime: '00:00', closeDay: today, closeTime: '00:00',
  });
}

/**
 * Takes both boards dark by clearing the schedule.
 *
 * "Elapsed" and "not yet opened" are the same state to every caller — the
 * boards are shut — so there is one helper rather than two that differ only in
 * which side of the window they sit on.
 */
export async function closeBoards(): Promise<void> {
  const { setScheduleRecurrence } = await import('@/lib/settings');
  await setScheduleRecurrence({ openDay: null, openTime: null, closeDay: null, closeTime: null });
}

export async function makeUser(
  overrides: { email?: string; role?: 'customer' | 'admin' } = {},
): Promise<{ id: string; email: string; role: 'customer' | 'admin' }> {
  const db = await getDb();
  const email = overrides.email ?? `user-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const role = overrides.role ?? 'customer';
  const [row] = await db.insert(users).values({
    email, passwordHash: await hashPassword('password123'), name: 'Test User', role,
  }).returning();
  return { id: row.id, email, role };
}

export async function makeProduct(
  overrides: Partial<{
    pricePhp: number; stock: number; name: string; spec: string;
    isOnHand: boolean; onHandPiecePhp: number | null; onHandKitPhp: number | null;
    // The group buy permission and its terms. Off by default: most tests are
    // about the shop, and a flagged product auto-lists on both boards.
    // The two board channels, independent of each other: isGroupBuy is the
    // campaign board, isKahati the vial counters (lib/product-channels.ts).
    isGroupBuy: boolean; isKahati: boolean; isActive: boolean;
    gbPricePerKitPhp: number | null; gbMinVials: number | null; gbMaxVialsPerBatch: number | null;
  }> = {},
): Promise<{ id: string; pricePhp: number; onHandPiecePhp: number | null; onHandKitPhp: number | null }> {
  const db = await getDb();
  const [cat] = await db.insert(categories).values({
    name: 'Peptides', slug: `peptides-${Math.random().toString(36).slice(2, 8)}`,
  }).returning();
  const pricePhp = overrides.pricePhp ?? 3200;
  // Products default to on-hand: the shop sells ready stock, so that is the
  // common case tests care about.
  const onHandPiecePhp = overrides.onHandPiecePhp !== undefined ? overrides.onHandPiecePhp : 550;
  const onHandKitPhp = overrides.onHandKitPhp !== undefined ? overrides.onHandKitPhp : 5000;
  const [row] = await db.insert(products).values({
    name: overrides.name ?? 'Test Peptide', spec: overrides.spec ?? '10mg', categoryId: cat.id,
    pricePhp: String(pricePhp), stock: overrides.stock ?? 100,
    isActive: overrides.isActive ?? true,
    isOnHand: overrides.isOnHand ?? true,
    onHandPiecePhp: onHandPiecePhp != null ? String(onHandPiecePhp) : null,
    onHandKitPhp: onHandKitPhp != null ? String(onHandKitPhp) : null,
    isGroupBuy: overrides.isGroupBuy ?? false,
    // Defaults to the group buy flag, so the many tests written before channels
    // split still get the counter they expect from `isGroupBuy: true` alone.
    isKahati: overrides.isKahati ?? overrides.isGroupBuy ?? false,
    gbPricePerKitPhp: overrides.gbPricePerKitPhp != null ? String(overrides.gbPricePerKitPhp) : null,
    gbMinVials: overrides.gbMinVials ?? null,
    gbMaxVialsPerBatch: overrides.gbMaxVialsPerBatch ?? null,
  }).returning();
  return { id: row.id, pricePhp, onHandPiecePhp, onHandKitPhp };
}

export async function makeGroupBuy(
  overrides: Partial<{
    totalSlots: number; claimedSlots: number; minVials: number; repackFeePhp: number;
    pricePerKitPhp: number; name: string; closesAt: Date | null;
    // The catalog product this counter is for. A counter without one is a
    // free-text row an admin made by hand — which is why it is optional here.
    productId: string | null;
    status: 'open' | 'closed' | 'shipped' | 'completed' | 'cancelled';
  }> = {},
): Promise<{ id: string; totalSlots: number; minVials: number }> {
  const db = await getDb();
  const totalSlots = overrides.totalSlots ?? 100;
  const minVials = overrides.minVials ?? 7;
  const [row] = await db.insert(groupBuys).values({
    name: overrides.name ?? 'Test Kahati', pricePerKitPhp: String(overrides.pricePerKitPhp ?? 9000),
    totalSlots, claimedSlots: overrides.claimedSlots ?? 0, minVials,
    repackFeePhp: String(overrides.repackFeePhp ?? 150), status: overrides.status ?? 'open',
    closesAt: overrides.closesAt ?? null,
    productId: overrides.productId ?? null,
  }).returning();
  return { id: row.id, totalSlots, minVials };
}

export async function makeMoqCampaign(
  overrides: Partial<{
    moq: number; committed: number; perCustomerMin: number; pricePerKitPhp: number;
    status: 'open' | 'approved' | 'completed' | 'cancelled';
    // A batch later in an existing series; omitted, the campaign is batch #1 of
    // its own series, which is what the create route writes.
    seriesId: string; batchNo: number; deadline: Date | null;
  }> = {},
): Promise<{ id: string; moq: number; committed: number; perCustomerMin: number; seriesId: string }> {
  const db = await getDb();
  const moq = overrides.moq ?? 10;
  const committed = overrides.committed ?? 0;
  const perCustomerMin = overrides.perCustomerMin ?? 1;
  const id = randomUUID();
  const seriesId = overrides.seriesId ?? id;
  const [row] = await db.insert(moqCampaigns).values({
    id, seriesId, batchNo: overrides.batchNo ?? 1,
    name: 'Test Campaign', pricePerKitPhp: String(overrides.pricePerKitPhp ?? 10400),
    moq, committed, perCustomerMin, status: overrides.status ?? 'open',
    deadline: overrides.deadline ?? null,
  }).returning();
  return { id: row.id, moq, committed, perCustomerMin, seriesId };
}

export async function makeMoqProduct(
  overrides: Partial<{
    name: string; spec: string; pricePhp: number; priceUsd: number | null; stock: number;
    minOrderQty: number; packingFeePhp: number | null; imageKey: string | null;
    isActive: boolean; sortOrder: number;
  }> = {},
): Promise<{ id: string; name: string; pricePhp: number; stock: number; minOrderQty: number }> {
  const db = await getDb();
  const pricePhp = overrides.pricePhp ?? 4500;
  const stock = overrides.stock ?? 50;
  const minOrderQty = overrides.minOrderQty ?? 1;
  const name = overrides.name ?? 'Test MOQ Product';
  const [row] = await db.insert(moqProducts).values({
    name, spec: overrides.spec ?? '1500mg', pricePhp: String(pricePhp),
    priceUsd: overrides.priceUsd != null ? String(overrides.priceUsd) : null,
    stock, minOrderQty,
    packingFeePhp: overrides.packingFeePhp != null ? String(overrides.packingFeePhp) : null,
    imageKey: overrides.imageKey ?? null,
    isActive: overrides.isActive ?? true, sortOrder: overrides.sortOrder ?? 0,
  }).returning();
  return { id: row.id, name, pricePhp, stock, minOrderQty };
}

export const SHIPPING = { shipName: 'Ana Cruz', shipPhone: '09171234567', shipAddress: '123 Mabini St, Manila' } as const;

export async function makePaymentMethod(
  overrides: Partial<{ label: string; accountName: string; accountNumber: string; isActive: boolean }> = {},
): Promise<{ id: string; label: string }> {
  const db = await getDb();
  const label = overrides.label ?? 'GCash';
  const [row] = await db.insert(paymentMethods).values({
    label, accountName: overrides.accountName ?? 'BBG Peptides',
    accountNumber: overrides.accountNumber ?? '09171234567',
    isActive: overrides.isActive ?? true,
  }).returning();
  return { id: row.id, label };
}

// Builds the multipart Request a checkout route handler expects.
export function checkoutRequest(
  items: unknown,
  opts: { withProof?: boolean; paymentMethod?: string; courier?: string; idempotencyKey?: string; note?: string } = {},
): Request {
  const form = new FormData();
  form.set('items', JSON.stringify(items));
  form.set('shipName', SHIPPING.shipName);
  form.set('shipPhone', SHIPPING.shipPhone);
  form.set('shipAddress', SHIPPING.shipAddress);
  if (opts.note !== undefined) form.set('note', opts.note);
  if (opts.paymentMethod) form.set('paymentMethod', opts.paymentMethod);
  if (opts.courier) form.set('courier', opts.courier);
  if (opts.idempotencyKey) form.set('idempotencyKey', opts.idempotencyKey);
  if (opts.withProof !== false) {
    form.set('proof', new File([Buffer.from('fake-proof-image')], 'proof.png', { type: 'image/png' }));
  }
  return new Request('http://localhost/api/orders', { method: 'POST', body: form });
}

// Builds the multipart Request the hatian final-checkout route expects. The
// route picks the orders to settle itself, so the client sends payment details
// only — never a list of orders it could under- or over-report.
export function settlementRequest(
  opts: { withProof?: boolean; paymentMethod?: string; idempotencyKey?: string } = {},
): Request {
  const form = new FormData();
  if (opts.paymentMethod) form.set('paymentMethod', opts.paymentMethod);
  if (opts.idempotencyKey) form.set('idempotencyKey', opts.idempotencyKey);
  if (opts.withProof !== false) {
    form.set('proof', new File([Buffer.from('fake-proof-image')], 'proof.png', { type: 'image/png' }));
  }
  return new Request('http://localhost/api/settlements', { method: 'POST', body: form });
}

// Builds the checkout Request for a Group Buy (MOQ campaign) commitment.
//
// A commitment is an ordinary cart line now, so this is checkoutRequest with
// the single line filled in — kept as its own helper because most campaign
// tests commit kits and do not care about cart shape. There is no separate
// commit endpoint any more: /api/orders is the only route that takes payment.
export function commitRequest(
  campaignId: string,
  qty: number,
  opts: { withProof?: boolean; idempotencyKey?: string } = {},
): Request {
  return checkoutRequest([{ kind: 'moq_campaign', refId: campaignId, qty }], opts);
}

export { signToken };

// Integration-test harness for the Next.js route handlers: applies the generated
// schema to an isolated in-memory PGlite (PGLITE_PATH=memory:// from vitest.config.ts),
// then gives each test a clean database plus fixture builders.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { getDb, users, categories, products, groupBuys, moqCampaigns, paymentMethods } from '@/lib/db';
import { hashPassword, signToken } from '@/lib/auth';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

// Cleared between tests, children before parents.
const TABLES = [
  'order_status_history', 'order_items', 'orders',
  'email_log', 'coa_files', 'group_buys', 'moq_campaigns', 'payment_methods', 'products', 'categories', 'users',
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
    pricePhp: number; stock: number; name: string;
    isOnHand: boolean; onHandPiecePhp: number | null; onHandKitPhp: number | null;
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
    name: overrides.name ?? 'Test Peptide', spec: '10mg', categoryId: cat.id,
    pricePhp: String(pricePhp), stock: overrides.stock ?? 100, isActive: true,
    isOnHand: overrides.isOnHand ?? true,
    onHandPiecePhp: onHandPiecePhp != null ? String(onHandPiecePhp) : null,
    onHandKitPhp: onHandKitPhp != null ? String(onHandKitPhp) : null,
  }).returning();
  return { id: row.id, pricePhp, onHandPiecePhp, onHandKitPhp };
}

export async function makeGroupBuy(
  overrides: Partial<{
    totalSlots: number; claimedSlots: number; minVials: number; repackFeePhp: number;
    pricePerKitPhp: number; name: string; closesAt: Date | null;
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
  }).returning();
  return { id: row.id, totalSlots, minVials };
}

export async function makeMoqCampaign(
  overrides: Partial<{ moq: number; committed: number; perCustomerMin: number; pricePerKitPhp: number; status: 'open' | 'approved' | 'cancelled' }> = {},
): Promise<{ id: string; moq: number; committed: number; perCustomerMin: number }> {
  const db = await getDb();
  const moq = overrides.moq ?? 10;
  const committed = overrides.committed ?? 0;
  const perCustomerMin = overrides.perCustomerMin ?? 1;
  const [row] = await db.insert(moqCampaigns).values({
    name: 'Test Campaign', pricePerKitPhp: String(overrides.pricePerKitPhp ?? 10400),
    moq, committed, perCustomerMin, status: overrides.status ?? 'open',
  }).returning();
  return { id: row.id, moq, committed, perCustomerMin };
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
export function checkoutRequest(items: unknown, opts: { withProof?: boolean; paymentMethod?: string } = {}): Request {
  const form = new FormData();
  form.set('items', JSON.stringify(items));
  form.set('shipName', SHIPPING.shipName);
  form.set('shipPhone', SHIPPING.shipPhone);
  form.set('shipAddress', SHIPPING.shipAddress);
  if (opts.paymentMethod) form.set('paymentMethod', opts.paymentMethod);
  if (opts.withProof !== false) {
    form.set('proof', new File([Buffer.from('fake-proof-image')], 'proof.png', { type: 'image/png' }));
  }
  return new Request('http://localhost/api/orders', { method: 'POST', body: form });
}

// Builds the multipart Request a campaign-commit route handler expects.
export function commitRequest(qty: number, opts: { withProof?: boolean } = {}): Request {
  const form = new FormData();
  form.set('qty', String(qty));
  form.set('shipName', SHIPPING.shipName);
  form.set('shipPhone', SHIPPING.shipPhone);
  form.set('shipAddress', SHIPPING.shipAddress);
  if (opts.withProof !== false) {
    form.set('proof', new File([Buffer.from('fake-proof-image')], 'proof.png', { type: 'image/png' }));
  }
  return new Request('http://localhost/api/campaigns/x/commit', { method: 'POST', body: form });
}

export { signToken };

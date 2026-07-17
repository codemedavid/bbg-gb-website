// Integration-test harness: applies the generated schema to an isolated in-memory
// PGlite instance (PGLITE_PATH=memory:// comes from vitest.config.ts), then gives each
// test a clean database plus fixture builders.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { db, users, categories, products, groupBuys } from '../db/index.js';
import { hashPassword, signToken } from '../lib/auth.js';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');

// Tables to clear between tests, children before parents.
const TABLES = [
  'order_status_history', 'order_items', 'orders',
  'email_log', 'coa_files', 'group_buys', 'products', 'categories', 'users',
];

let migrated = false;

export async function migrateOnce(): Promise<void> {
  if (migrated) return;
  const file = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()[0];
  if (!file) throw new Error(`No migration SQL in ${MIGRATIONS_DIR} — run: npm run db:generate`);
  const statements = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await db.execute(sql.raw(statement));
  migrated = true;
}

export async function resetDb(): Promise<void> {
  await migrateOnce();
  await db.execute(sql.raw(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`));
}

export async function makeUser(
  overrides: { email?: string; role?: 'customer' | 'admin' } = {},
): Promise<{ id: string; email: string; token: string }> {
  const email = overrides.email ?? `user-${Math.random().toString(36).slice(2, 10)}@example.com`;
  const role = overrides.role ?? 'customer';
  const [row] = await db.insert(users).values({
    email, passwordHash: await hashPassword('password123'), name: 'Test User', role,
  }).returning();
  return { id: row.id, email, token: signToken({ sub: row.id, role, email }) };
}

export async function makeProduct(
  overrides: Partial<{ pricePhp: number; stock: number; name: string }> = {},
): Promise<{ id: string; pricePhp: number }> {
  const [cat] = await db.insert(categories).values({
    name: 'Peptides', slug: `peptides-${Math.random().toString(36).slice(2, 8)}`,
  }).returning();
  const pricePhp = overrides.pricePhp ?? 3200;
  const [row] = await db.insert(products).values({
    name: overrides.name ?? 'Test Peptide', spec: '10mg', categoryId: cat.id,
    pricePhp: String(pricePhp), stock: overrides.stock ?? 100, isActive: true,
  }).returning();
  return { id: row.id, pricePhp };
}

export async function makeGroupBuy(
  overrides: Partial<{ totalSlots: number; claimedSlots: number; minVials: number; repackFeePhp: number; pricePerKitPhp: number }> = {},
): Promise<{ id: string; totalSlots: number; minVials: number }> {
  const totalSlots = overrides.totalSlots ?? 100;
  const minVials = overrides.minVials ?? 7;
  const [row] = await db.insert(groupBuys).values({
    name: 'Test Kahati', pricePerKitPhp: String(overrides.pricePerKitPhp ?? 9000),
    totalSlots, claimedSlots: overrides.claimedSlots ?? 0, minVials,
    repackFeePhp: String(overrides.repackFeePhp ?? 150), status: 'open',
  }).returning();
  return { id: row.id, totalSlots, minVials };
}

export const PROOF = { field: 'proof', file: Buffer.from('fake-proof-image'), name: 'proof.png' } as const;
export const SHIPPING = { shipName: 'Ana Cruz', shipPhone: '09171234567', shipAddress: '123 Mabini St, Manila' } as const;

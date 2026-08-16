// The Accounts board's query.
//
// Admin → Accounts is the only place the shop can answer "who has signed up,
// and who is still using the account". Auth here is a stateless JWT, so nothing
// records a session — `users.last_login_at`, stamped at sign-in, is what makes
// "signed in" answerable at all. An account that never signed in must come back
// as null rather than as a date, so the screen can say "Never" instead of
// inventing activity.
import { describe, it, expect, beforeEach } from 'vitest';

const { listAccounts } = await import('./accounts');
const { resetDb, makeUser } = await import('@/lib/test/harness');
const { getDb, users, orders } = await import('@/lib/db');
const { eq } = await import('drizzle-orm');

const signedInAt = async (email: string, at: Date) => {
  const db = await getDb();
  await db.update(users).set({ lastLoginAt: at }).where(eq(users.email, email));
};

let orderSeq = 0;
const placeOrder = async (userId: string) => {
  const db = await getDb();
  orderSeq += 1;
  await db.insert(orders).values({
    orderNo: `BBG-T${String(orderSeq).padStart(4, '0')}`,
    userId,
    subtotalPhp: '1000', totalPhp: '1000',
    shipName: 'Test', shipPhone: '09171234567', shipAddress: 'Manila',
  });
};

beforeEach(async () => {
  await resetDb();
  orderSeq = 0;
});

describe('listAccounts', () => {
  it('returns every registered account, not only the ones that have ordered', async () => {
    await makeUser({ email: 'ana@bbg.test' });
    await makeUser({ email: 'ben@bbg.test' });

    const rows = await listAccounts();

    expect(rows.map((r) => r.email).sort()).toEqual(['ana@bbg.test', 'ben@bbg.test']);
  });

  it('counts how many orders each account has placed', async () => {
    const ana = await makeUser({ email: 'ana@bbg.test' });
    await makeUser({ email: 'ben@bbg.test' });
    await placeOrder(ana.id);
    await placeOrder(ana.id);

    const rows = await listAccounts();

    expect(rows.find((r) => r.email === 'ana@bbg.test')?.orderCount).toBe(2);
    // A left join, not an inner one: an account with no orders is still an
    // account, and dropping it would hide every customer who only browses.
    expect(rows.find((r) => r.email === 'ben@bbg.test')?.orderCount).toBe(0);
  });

  it('reports an account that has never signed in as null rather than a date', async () => {
    await makeUser({ email: 'ana@bbg.test' });

    const [row] = await listAccounts();

    expect(row.lastLoginAt).toBeNull();
  });

  it('reports the last sign-in of an account that has one', async () => {
    await makeUser({ email: 'ana@bbg.test' });
    await signedInAt('ana@bbg.test', new Date('2026-08-16T02:00:00Z'));

    const [row] = await listAccounts();

    expect(row.lastLoginAt).toBe(new Date('2026-08-16T02:00:00Z').toISOString());
  });

  it('puts the most recently signed-in accounts first, never-signed-in last', async () => {
    await makeUser({ email: 'stale@bbg.test' });
    await makeUser({ email: 'recent@bbg.test' });
    await makeUser({ email: 'never@bbg.test' });
    await signedInAt('stale@bbg.test', new Date('2026-01-01T00:00:00Z'));
    await signedInAt('recent@bbg.test', new Date('2026-08-16T00:00:00Z'));

    const rows = await listAccounts();

    expect(rows.map((r) => r.email)).toEqual(['recent@bbg.test', 'stale@bbg.test', 'never@bbg.test']);
  });

  it('narrows to accounts whose name or email matches the search, case-insensitively', async () => {
    await makeUser({ email: 'ana.cruz@bbg.test' });
    await makeUser({ email: 'ben@bbg.test' });

    expect((await listAccounts({ search: 'ANA.CRUZ' })).map((r) => r.email)).toEqual(['ana.cruz@bbg.test']);
  });

  it('matches on the account name too, not just the email', async () => {
    const db = await getDb();
    const ana = await makeUser({ email: 'a@bbg.test' });
    await db.update(users).set({ name: 'Marisol Reyes' }).where(eq(users.id, ana.id));
    await makeUser({ email: 'b@bbg.test' });

    expect((await listAccounts({ search: 'marisol' })).map((r) => r.email)).toEqual(['a@bbg.test']);
  });

  it('narrows to a single role when asked', async () => {
    await makeUser({ email: 'admin@bbg.test', role: 'admin' });
    await makeUser({ email: 'ana@bbg.test', role: 'customer' });

    expect((await listAccounts({ role: 'admin' })).map((r) => r.email)).toEqual(['admin@bbg.test']);
  });

  it('never hands back the password hash', async () => {
    await makeUser({ email: 'ana@bbg.test' });

    const [row] = await listAccounts();

    expect(row).not.toHaveProperty('passwordHash');
    expect(row).not.toHaveProperty('password_hash');
  });

  it('caps how many rows it returns so the table cannot grow unbounded', async () => {
    for (let i = 0; i < 5; i += 1) await makeUser({ email: `u${i}@bbg.test` });

    expect(await listAccounts({ limit: 2 })).toHaveLength(2);
  });
});

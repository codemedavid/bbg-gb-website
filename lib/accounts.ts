// Admin → Accounts: who has registered on the shop, and who is still using it.
//
// Every other admin screen reaches a customer through something they did — an
// order, a commitment, a settlement — so anyone who signed up and never bought
// was invisible. This is the one query that starts from the account itself.
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb, orders, users } from './db';

export type AccountRole = 'customer' | 'admin';

export type AccountRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: AccountRole;
  createdAt: string;
  // ISO string, or null for an account that has never signed in — see
  // users.last_login_at. The screen renders that null as "Never".
  lastLoginAt: string | null;
  orderCount: number;
};

export type ListAccountsOptions = {
  search?: string;
  role?: AccountRole;
  limit?: number;
};

// The table is read in full on every page load, so it is capped rather than
// paginated for now. Chosen high enough that the shop's whole customer list
// fits today, low enough that a runaway users table cannot take the screen out.
export const ACCOUNTS_LIMIT = 200;

export async function listAccounts(opts: ListAccountsOptions = {}): Promise<AccountRow[]> {
  const db = await getDb();
  const search = opts.search?.trim();

  // Explicit columns, never `select().from(users)` — that pulls password_hash
  // into a payload the admin UI would happily serialize.
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
      orderCount: sql<number>`count(${orders.id})::int`,
    })
    .from(users)
    // Left, so an account with no orders is still an account. An inner join here
    // would silently hide every customer who has only ever browsed — which is
    // precisely the group this screen exists to make visible.
    .leftJoin(orders, eq(orders.userId, users.id))
    .where(and(
      opts.role ? eq(users.role, opts.role) : undefined,
      search
        ? or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`))
        : undefined,
    ))
    .groupBy(users.id)
    // Most recently active first. `nulls last` keeps never-signed-in accounts at
    // the bottom instead of at the top, where Postgres puts NULLs by default on
    // a descending sort.
    .orderBy(sql`${users.lastLoginAt} desc nulls last`, desc(users.createdAt))
    .limit(opts.limit ?? ACCOUNTS_LIMIT);

  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
  }));
}

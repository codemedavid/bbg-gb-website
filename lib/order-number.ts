import { sql } from 'drizzle-orm';

// Order numbers come from a Postgres sequence: nextval is atomic, so concurrent
// checkouts can never derive the same BBG-#### the way a count(*) would.
// `query` is `any` to structurally match both a drizzle db and a transaction
// executor without depending on drizzle's generic execute signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Executor = { execute: (query: any) => Promise<unknown> };

export async function nextOrderNo(tx: Executor): Promise<string> {
  const result = await tx.execute(sql`select nextval('order_no_seq')::int as n`);
  // postgres-js returns the rows array; PGlite returns { rows }.
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { n: number }[];
  return `BBG-${rows[0].n}`;
}

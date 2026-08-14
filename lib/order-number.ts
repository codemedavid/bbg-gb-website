import { sql } from 'drizzle-orm';
import type { PurchaseMode } from './order-modes';

// Order numbers come from a Postgres sequence: nextval is atomic, so concurrent
// checkouts can never derive the same number the way a count(*) would.
// `query` is `any` to structurally match both a drizzle db and a transaction
// executor without depending on drizzle's generic execute signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Executor = { execute: (query: any) => Promise<unknown> };

// The reference prefix per purchasing system. Group Buy and Kahati are separate
// systems — separate lifecycles, separate packing fees, separate admin screens —
// so their references say so rather than making a customer or an admin look the
// order up to find out which board it came from.
//
// On-hand and the MOQ shelf stay on BBG-, which is the series the business has
// been quoting since before either board existed; renaming them would orphan
// every reference already printed on a receipt or pasted into a chat thread.
export const ORDER_NO_PREFIX: Record<PurchaseMode, string> = {
  solo: 'BBG',
  kahati: 'KH',
  group_buy: 'GB',
  moq: 'BBG',
};

/**
 * The next reference for an order in this mode.
 *
 * Every prefix draws from the SAME sequence. Giving each system its own counter
 * would produce KH-1 and GB-1 on day one and a genuine collision the moment
 * anything — a report, a settlement, an export — puts the two side by side.
 * One sequence, four labels: the number is unique across the business and the
 * prefix only says where it came from.
 *
 * Defaults to the solo prefix so a caller that has no mode (an admin flow, an
 * older path) still mints a valid BBG- reference rather than an undefined one.
 */
export async function nextOrderNo(tx: Executor, mode: PurchaseMode = 'solo'): Promise<string> {
  const result = await tx.execute(sql`select nextval('order_no_seq')::int as n`);
  // postgres-js returns the rows array; PGlite returns { rows }.
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { n: number }[];
  return `${ORDER_NO_PREFIX[mode]}-${rows[0].n}`;
}

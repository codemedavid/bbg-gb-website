// Reading what a customer has already paid for in one trading cycle.
//
// The rules that act on the result live in lib/packing-cycle.ts; this file only
// fetches the rows. The checkout route and the screen that previews it both call
// through here, so the fee the customer is shown is produced by the same query
// that decides what they are charged.
import { and, eq } from 'drizzle-orm';
import { getDb, orders } from '@/lib/db';
import type { CyclePayment } from './packing-cycle';
import type { OrderStatus } from './db/schema';

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Every order this customer placed in one cycle, with the status and packing fee
 * the waiver rule turns on.
 *
 * Only the two scheduled boards stamp a cycle key (see app/api/orders/route.ts),
 * so an on-hand or MOQ order can never appear here — those ship as their own
 * parcels and their fee pays for those, not for the cycle's.
 *
 * An absent cycle key means the boards are closed, in which case there is no
 * cycle to have paid for and no rows to fetch.
 */
export async function listCyclePayments(
  db: Db,
  userId: string,
  cycleKey: string | null,
): Promise<CyclePayment[]> {
  if (!cycleKey) return [];
  const rows = await db.select({
    orderStatus: orders.status,
    packingFeePhp: orders.packingFeePhp,
  })
    .from(orders)
    .where(and(eq(orders.userId, userId), eq(orders.cycleKey, cycleKey)));

  return rows.map((r) => ({
    orderStatus: r.orderStatus as OrderStatus,
    packingFeePhp: Number(r.packingFeePhp),
  }));
}

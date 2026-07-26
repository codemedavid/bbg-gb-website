// Hatian final checkout — database side.
//
// lib/settlement.ts holds the rules; this reads the orders they apply to. One
// query answers both "what may I settle?" (the preview) and "what am I settling
// right now?" (the POST), so the quote a customer accepts is computed by the
// same code that bills them.
import { and, eq, isNull, ne } from 'drizzle-orm';
import { getDb, groupBuys, orderItems, orders, settlements } from '@/lib/db';
import {
  isReadyToSettle, packingFeeState, settlementTotals,
  type SettleableOrder, type SettlementStatus, type SettlementTotals,
} from './settlement';

type Db = Awaited<ReturnType<typeof getDb>>;

export type ReadyOrder = SettleableOrder & {
  orderNo: string;
  createdAt: Date;
  hatianNames: string[];
  packingFee: ReturnType<typeof packingFeeState>;
};

// Every unsettled, live hatian order of one customer whose counters have all
// finished filling. Reads through order_items so an overflow commitment — one
// order spanning two counters — is judged on all of them, not just the first.
export async function readySettlementOrders(db: Db, userId: string): Promise<ReadyOrder[]> {
  const rows = await db.select({
    id: orders.id,
    orderNo: orders.orderNo,
    status: orders.status,
    totalPhp: orders.totalPhp,
    downpaymentPhp: orders.downpaymentPhp,
    packingFeePhp: orders.packingFeePhp,
    settlementId: orders.settlementId,
    createdAt: orders.createdAt,
    hatianStatus: groupBuys.status,
    hatianName: groupBuys.name,
    hatianFeePhp: groupBuys.repackFeePhp,
  })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(groupBuys, eq(groupBuys.id, orderItems.groupBuyId))
    .where(and(
      eq(orders.userId, userId),
      isNull(orders.settlementId),
      ne(orders.status, 'cancelled'),
    ))
    .orderBy(orders.createdAt);

  // One row per (order, hatian line); fold them back into one entry per order.
  const byOrder = new Map<string, {
    row: typeof rows[number];
    statuses: string[];
    names: string[];
    fees: number[];
  }>();
  for (const row of rows) {
    const entry = byOrder.get(row.id) ?? { row, statuses: [], names: [], fees: [] };
    entry.statuses.push(row.hatianStatus);
    if (!entry.names.includes(row.hatianName)) entry.names.push(row.hatianName);
    entry.fees.push(Number(row.hatianFeePhp));
    byOrder.set(row.id, entry);
  }

  const ready: ReadyOrder[] = [];
  for (const { row, statuses, names, fees } of byOrder.values()) {
    if (!isReadyToSettle({ status: row.status, settlementId: row.settlementId, groupBuyStatuses: statuses })) continue;
    const order: SettleableOrder = {
      id: row.id,
      status: row.status,
      totalPhp: Number(row.totalPhp),
      downpaymentPhp: Number(row.downpaymentPhp),
      packingFeePhp: Number(row.packingFeePhp),
      // Spanning counters with different fees costs what the priciest one costs.
      hatianPackingFeePhp: Math.max(...fees),
      settlementId: row.settlementId,
    };
    ready.push({
      ...order,
      orderNo: row.orderNo,
      createdAt: row.createdAt,
      hatianNames: names,
      packingFee: packingFeeState(order, null), // unsettled by definition
    });
  }
  return ready;
}

export type SettlementQuote = { orders: ReadyOrder[]; totals: SettlementTotals };

export async function quoteSettlement(db: Db, userId: string): Promise<SettlementQuote> {
  const ready = await readySettlementOrders(db, userId);
  return { orders: ready, totals: settlementTotals(ready) };
}

// The settlement a previous submission with this key already created, so a retry
// (double tap, two tabs, refresh mid-submit) hands back the original instead of
// charging a second packing fee. Null when the key has settled nothing yet.
export async function findReplayedSettlement(db: Db, userId: string, idempotencyKey: string) {
  const [row] = await db.select().from(settlements)
    .where(and(eq(settlements.userId, userId), eq(settlements.idempotencyKey, idempotencyKey)));
  return row ?? null;
}

export type SettlementRow = typeof settlements.$inferSelect;

// Status of a settlement, for deriving what an order's final payment and
// packing fee currently read as.
export const settlementStatusOf = (row: SettlementRow | null | undefined): SettlementStatus | null =>
  (row?.status as SettlementStatus | undefined) ?? null;

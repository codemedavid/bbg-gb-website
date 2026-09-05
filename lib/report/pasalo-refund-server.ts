// Reading a closed Pasalo back out of the database, for both the dashboard and
// the workbook.
//
// ONE loader, used by both, and that is the point. The requirement is that the
// exported numbers are reproducible and that the screen and the spreadsheet
// agree; two queries shaped separately is precisely how an admin comes to see
// ₱12,400 on a page and ₱12,750 in the file they send to accounting.
//
// Everything here is read from what the CLOSE decided, never re-derived. The
// refund rows carry their own amounts, their own line snapshots and the
// counter's closing arithmetic, so a product renamed or repriced afterwards
// cannot restate what somebody is owed.
import { and, asc, eq, gte, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import { getDb, groupBuys, orderItemRefunds, orderItems, orders, users } from '@/lib/db';
import { counterQuantities } from '../kahati-quantity';
import { isPaymentVerified } from '../payment-status';
import type { CollectedBasis, RefundStatus } from '../refund-status';
import type { CounterOutcome, RefundRecord, SuccessfulItem } from './pasalo-refund';
import { manilaYmd } from './week';

type Db = Awaited<ReturnType<typeof getDb>>;

export type RefundReportData = {
  refunds: RefundRecord[];
  successful: SuccessfulItem[];
  counters: CounterOutcome[];
};

/**
 * Everything the report needs for one closed batch.
 *
 * Scoped on the refund rows' own creation window, which is the moment the
 * stage was closed — one close is one batch. Scoping on ORDER dates instead
 * would straddle two batches whenever a cycle ran long, which is the mistake
 * lib/report/week.ts's callers already have to work around.
 */
export async function loadRefundReport(
  db: Db,
  range: { start: Date; end: Date },
): Promise<RefundReportData> {
  const refundRows = await db.select({
    refund: orderItemRefunds,
    orderNo: orders.orderNo,
    shipName: orders.shipName,
    shipPhone: orders.shipPhone,
    paymentMethod: orders.paymentMethod,
    orderedAt: orders.createdAt,
    customerName: users.name,
    customerEmail: users.email,
    customerPhone: users.phone,
  })
    .from(orderItemRefunds)
    .innerJoin(orders, eq(orders.id, orderItemRefunds.orderId))
    .innerJoin(users, eq(users.id, orderItemRefunds.userId))
    .where(and(
      gte(orderItemRefunds.createdAt, range.start),
      lt(orderItemRefunds.createdAt, range.end),
    ))
    .orderBy(asc(users.name), asc(orders.orderNo));

  const refunds: RefundRecord[] = refundRows.map((r) => ({
    id: r.refund.id,
    orderItemId: r.refund.orderItemId,
    orderId: r.refund.orderId,
    orderNo: r.orderNo,
    groupBuyId: r.refund.groupBuyId,
    userId: r.refund.userId,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    customerPhone: r.customerPhone ?? '',
    shipName: r.shipName,
    shipPhone: r.shipPhone,
    productName: r.refund.nameSnapshot,
    qty: r.refund.qty,
    unitPricePhp: Number(r.refund.unitPricePhp),
    lineTotalPhp: Number(r.refund.lineTotalPhp),
    goodsPhp: Number(r.refund.goodsPhp),
    depositPhp: Number(r.refund.depositPhp),
    amountPhp: Number(r.refund.amountPhp),
    collectedBasis: r.refund.collectedBasis as CollectedBasis,
    reason: r.refund.reason,
    kahatiVials: r.refund.kahatiVials,
    pasaloVials: r.refund.pasaloVials,
    combinedVials: r.refund.combinedVials,
    minRequired: r.refund.minRequired,
    status: r.refund.status as RefundStatus,
    reference: r.refund.reference,
    method: r.refund.method,
    refundAccount: r.refund.refundAccount,
    refundedAt: r.refund.refundedAt,
    notes: r.refund.notes,
    paymentMethod: r.paymentMethod,
    orderedOn: manilaYmd(r.orderedAt),
  }));

  if (!refunds.length) return { refunds: [], successful: [], counters: [] };

  const successful = await loadSuccessfulItems(db, refunds);
  const counters = await loadCounters(db, refunds, successful);
  return { refunds, successful, counters };
}

/**
 * What the refunded customers are STILL getting.
 *
 * Defined by absence: a kahati line of theirs that carries no refund row is a
 * line that survived. Reading it that way rather than from a status keeps the
 * two sheets in exact agreement — every line is on one of them and no line is
 * on both, which is what stops a customer's total being refunded whole.
 *
 * Cancelled orders are excluded: nothing on them ships either.
 */
async function loadSuccessfulItems(db: Db, refunds: RefundRecord[]): Promise<SuccessfulItem[]> {
  const userIds = [...new Set(refunds.map((r) => r.userId))];
  const refundedItemIds = new Set(refunds.map((r) => r.orderItemId));

  const rows = await db.select({
    userId: orders.userId,
    groupBuyId: orderItems.groupBuyId,
    orderItemId: orderItems.id,
    orderNo: orders.orderNo,
    orderStatus: orders.status,
    shipName: orders.shipName,
    shipPhone: orders.shipPhone,
    customerName: users.name,
    customerEmail: users.email,
    customerPhone: users.phone,
    productName: orderItems.nameSnapshot,
    qty: orderItems.qty,
    unitPricePhp: orderItems.unitPricePhp,
    lineTotalPhp: orderItems.lineTotalPhp,
    claimedSlots: groupBuys.claimedSlots,
    totalSlots: groupBuys.totalSlots,
    counterKahatiVials: groupBuys.kahatiVials,
    minViableVials: groupBuys.minViableVials,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(users, eq(users.id, orders.userId))
    .innerJoin(groupBuys, eq(groupBuys.id, orderItems.groupBuyId))
    .where(and(
      inArray(orders.userId, userIds),
      isNotNull(orderItems.groupBuyId),
      ne(orders.status, 'cancelled'),
      // Counters that went through a Pasalo — kahati_vials is written only when
      // the stage opens, so it is what marks a counter as belonging to a batch
      // that has been through this lifecycle rather than to the live board.
      isNotNull(groupBuys.kahatiVials),
    ))
    .orderBy(asc(users.name), asc(orders.orderNo));

  return rows
    .filter((r) => !refundedItemIds.has(r.orderItemId))
    .map((r) => {
      const q = counterQuantities({
        claimedSlots: r.claimedSlots,
        totalSlots: r.totalSlots,
        kahatiVials: r.counterKahatiVials,
        minViableVials: r.minViableVials,
      });
      return {
        userId: r.userId,
        groupBuyId: r.groupBuyId,
        customerName: r.shipName || r.customerName,
        customerEmail: r.customerEmail,
        customerPhone: r.shipPhone || r.customerPhone || '',
        orderNo: r.orderNo,
        orderItemId: r.orderItemId,
        productName: r.productName,
        qty: r.qty,
        unitPricePhp: Number(r.unitPricePhp),
        lineTotalPhp: Number(r.lineTotalPhp),
        kahatiVials: q.kahatiVials,
        pasaloVials: q.pasaloVials,
        combinedVials: q.combinedVials,
        minRequired: q.minRequired,
        fulfilmentStatus: r.orderStatus,
      };
    });
}

/**
 * The counters this batch was made of — the failed ones the refunds name, plus
 * the successful ones those same customers still have lines on.
 *
 * `paymentConfirmedVials` is the honesty column. Vials are counted at CHECKOUT,
 * before anyone verifies a peso (see app/api/orders/route.ts), so a counter can
 * qualify on money nobody has checked. The dashboard and Sheet 4 show it beside
 * the committed total rather than quietly judging one by the other, because
 * changing the counting basis would make every board read zero for days while
 * proofs queue — but an admin closing a stage still deserves to see the gap.
 */
async function loadCounters(
  db: Db,
  refunds: RefundRecord[],
  successful: SuccessfulItem[],
): Promise<CounterOutcome[]> {
  const ids = [...new Set([
    ...refunds.flatMap((r) => (r.groupBuyId ? [r.groupBuyId] : [])),
    ...successful.flatMap((s) => (s.groupBuyId ? [s.groupBuyId] : [])),
  ])];
  if (!ids.length) return [];

  const rows = await db.select().from(groupBuys)
    .where(inArray(groupBuys.id, ids))
    .orderBy(asc(groupBuys.name));

  const confirmed = await db.select({
    groupBuyId: orderItems.groupBuyId,
    qty: orderItems.qty,
    paymentStatus: orders.paymentStatus,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(
      inArray(orderItems.groupBuyId, ids),
      ne(orders.status, 'cancelled'),
    ));

  const confirmedByCounter = new Map<string, number>();
  for (const c of confirmed) {
    if (!c.groupBuyId || !isPaymentVerified(c.paymentStatus)) continue;
    confirmedByCounter.set(c.groupBuyId, (confirmedByCounter.get(c.groupBuyId) ?? 0) + c.qty);
  }

  return rows.map((row) => {
    const q = counterQuantities(row);
    return {
      groupBuyId: row.id,
      productName: row.name,
      kahatiVials: q.kahatiVials,
      pasaloVials: q.pasaloVials,
      combinedVials: q.combinedVials,
      minRequired: q.minRequired,
      maxVials: q.maxVials,
      neededToQualify: q.neededToQualify,
      slotsRemaining: q.slotsRemaining,
      status: row.status,
      paymentConfirmedVials: confirmedByCounter.get(row.id) ?? 0,
    };
  });
}

/**
 * The live Pasalo board, for the admin dashboard's "current batch" table.
 *
 * Every counter in the stage right now with the two figures that matter said
 * separately — needed to qualify, and slots remaining — because one column
 * cannot say both and conflating them is what makes a batch two vials short
 * look unreachable.
 */
export async function loadPasaloBoard(db: Db): Promise<CounterOutcome[]> {
  const rows = await db.select().from(groupBuys)
    .where(eq(groupBuys.status, 'pasalo'))
    .orderBy(asc(groupBuys.name));
  if (!rows.length) return [];

  return loadCounters(
    db,
    rows.map((r) => ({ groupBuyId: r.id } as RefundRecord)),
    [],
  );
}

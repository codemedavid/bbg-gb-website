// Pasalo (Bunuan) — the database side of the stage.
//
// Two admin actions, both explicit and both idempotent:
//
//   openPasaloStage   ends Kahati. Every counter with vials on it moves to
//                     'pasalo' and keeps selling on a second, admin-set clock.
//                     Nothing is cancelled and nobody is refunded.
//   closePasaloStage  decides every one of them. At or above the minimum the
//                     counter closes and is fulfilled; below it, the counter is
//                     cancelled and its LINES — not its customers' whole orders
//                     — become refunds.
//
// Neither is a sweep. There is no scheduler in this app (see lib/kahati-server.ts),
// and the outcome of a Pasalo moves customers' money, so it is settled by a
// person pressing a button rather than by a clock reaching a time.
//
// Every transition is a guarded conditional UPDATE whose WHERE re-checks the
// state it was decided on, with RETURNING deciding what this run actually did —
// the same pattern sweepKahatis uses, and what makes running either action
// twice a no-op rather than a second refund.
import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import {
  getDb, groupBuys, orders, orderItems, orderItemRefunds, orderStatusHistory, settlements, users,
} from '@/lib/db';
import { counterQuantities } from './kahati-quantity';
import {
  pasaloEligibility, pasaloOutcome, pasaloFailureReason, isCounterInBatchWindow,
  type BatchWindow,
} from './pasalo';
import {
  buildPasaloRefunds, pasaloRefundTotals,
  type BatchLine, type BatchOrderFacts, type PasaloRefundRow,
} from './pasalo-refund';
import { getKahatiDownpaymentPolicy } from './settings';
import { DEFAULT_KAHATI_DOWNPAYMENT_POLICY } from './kahati-downpayment';
import { round2 } from './pricing';

type Db = Awaited<ReturnType<typeof getDb>>;
type GroupBuyRow = typeof groupBuys.$inferSelect;

export type PasaloOpenResult = {
  /** Counter ids moved into the stage. */
  opened: string[];
  /** Open counters nobody had joined — left running, exactly as a cycle roll does. */
  skippedEmpty: number;
  /** Counters already holding a complete kit; a full box has nothing to sell. */
  skippedFull: number;
  /**
   * Counters left alone because their Kahati started outside the selected
   * batch. Reported rather than dropped: an admin who picked the wrong range
   * has to see that a counter they expected to move did not.
   */
  skippedOutOfRange: number;
};

/**
 * End Kahati and open Pasalo across the board.
 *
 * Every counter from 1 vial to one short of full enters, the already-qualified
 * 7-9 included: those batches are going ahead regardless, and leaving them
 * sellable is margin that would otherwise be thrown away when they close with
 * everything else.
 *
 * `kahati_vials` is frozen here and nowhere else. It is the only record that
 * survives of how the counter stood when Kahati ended — claimed_slots keeps
 * moving through the stage — and "3 Kahati + 2 Pasalo" on the dashboard and in
 * the refund sheet is read straight off it.
 *
 * Guarded on 'open', so a counter that another request has already moved is
 * skipped rather than re-frozen at a figure that now includes Pasalo vials.
 */
export async function openPasaloStage(
  db: Db,
  opts: { pasaloClosesAt?: Date | null; window?: BatchWindow | null } = {},
): Promise<PasaloOpenResult> {
  const running = await db.select().from(groupBuys).where(eq(groupBuys.status, 'open'));

  const opened: string[] = [];
  let skippedEmpty = 0;
  let skippedFull = 0;
  let skippedOutOfRange = 0;

  for (const counter of running) {
    // Judged before eligibility, and counted apart from it. A counter from
    // last cycle is not "empty" or "full" — it is not this batch's business at
    // all, and folding it into either figure would tell the admin the board
    // contains something it does not.
    if (!isCounterInBatchWindow(counter, opts.window)) { skippedOutOfRange += 1; continue; }
    const q = counterQuantities(counter);
    const verdict = pasaloEligibility({ status: counter.status, ...q });
    if (verdict === 'skip_empty') { skippedEmpty += 1; continue; }
    if (verdict === 'skip_full') { skippedFull += 1; continue; }
    if (verdict !== 'open_pasalo') continue;

    const [moved] = await db.update(groupBuys)
      .set({
        status: 'pasalo',
        // Frozen from the row we just read, not from claimed_slots in SQL: a
        // commitment landing between the read and this write belongs to Kahati
        // either way, and re-reading would be no more true. What matters is
        // that it is written once — the guard below is what enforces that.
        kahatiVials: q.combinedVials,
        pasaloClosesAt: opts.pasaloClosesAt ?? null,
      })
      .where(and(eq(groupBuys.id, counter.id), eq(groupBuys.status, 'open')))
      .returning({ id: groupBuys.id });
    if (moved) opened.push(moved.id);
  }

  return { opened, skippedEmpty, skippedFull, skippedOutOfRange };
}

export type PasaloCloseResult = {
  /** Counters that reached the minimum and go on to fulfilment. */
  fulfilled: string[];
  /** Counters still short; their lines are now refunds. */
  failed: string[];
  /** Refund rows written by THIS close. A repeat close writes none. */
  refundsWritten: number;
  refundTotalPhp: number;
  customersOwed: number;
  /** Orders cancelled outright because every line they held failed. */
  ordersCancelled: number;
  /**
   * Counters left in the stage because their Kahati started outside the
   * selected batch. Nobody on them was refunded and nothing of theirs was
   * decided — they are still waiting for the close that belongs to them, and
   * the panel says so rather than leaving them to be discovered next cycle.
   */
  skippedOutOfRange: number;
};

/**
 * Close the stage and decide every counter in it.
 *
 * The whole batch is evaluated in ONE transaction. A close that fulfilled half
 * the counters and then failed would leave the board in a state no second run
 * could reason about — some counters decided, some not, and refunds written for
 * a batch whose surviving lines are still unknown.
 */
export async function closePasaloStage(
  db: Db,
  opts: { window?: BatchWindow | null } = {},
): Promise<PasaloCloseResult> {
  // Read before the transaction: a settings failure must not roll back a close,
  // and the policy is one value for the whole batch — re-reading per counter
  // would let a mid-close edit refund two customers under different terms.
  const policy = await getKahatiDownpaymentPolicy().catch(() => DEFAULT_KAHATI_DOWNPAYMENT_POLICY);

  return db.transaction(async (tx) => {
    const inStage = await tx.select().from(groupBuys).where(eq(groupBuys.status, 'pasalo'));
    // Scoped BEFORE anything is decided, so an out-of-range counter is not
    // merely spared the status flip — its lines never reach the refund
    // arithmetic, and its customers' money is never part of this batch's sums.
    const staged = inStage.filter((c) => isCounterInBatchWindow(c, opts.window));
    const skippedOutOfRange = inStage.length - staged.length;
    if (!staged.length) {
      return {
        fulfilled: [], failed: [], refundsWritten: 0,
        refundTotalPhp: 0, customersOwed: 0, ordersCancelled: 0, skippedOutOfRange,
      };
    }

    // Decide every counter first, then act. The refund arithmetic needs to know
    // which of a customer's OTHER lines survived — that is what decides whether
    // their deposit is owed back — so no counter can be resolved until all of
    // them have been judged.
    const decided = staged.map((counter) => {
      const q = counterQuantities(counter);
      return { counter, q, outcome: pasaloOutcome(q) };
    });
    const failedCounters = decided.filter((d) => d.outcome === 'refund');
    const reasonFor = new Map(failedCounters.map((d) => [d.counter.id, pasaloFailureReason(d.q)]));
    const quantitiesFor = new Map(decided.map((d) => [d.counter.id, d.q]));

    const { lines, orderFacts } = await readBatchLines(tx, decided.map((d) => d.counter.id), reasonFor);
    const refunds = buildPasaloRefunds(lines, orderFacts, policy);

    const written = await writeRefundRows(tx, refunds, lines, quantitiesFor);
    const ordersCancelled = await releaseRefundedLines(tx, refunds, lines);

    // Flip the counters last, so a failure anywhere above leaves every one of
    // them in 'pasalo' — re-runnable — rather than closed with no refunds.
    const fulfilled: string[] = [];
    const failed: string[] = [];
    for (const d of decided) {
      const next = d.outcome === 'fulfil' ? 'closed' : 'cancelled';
      const [moved] = await tx.update(groupBuys).set({ status: next })
        .where(and(eq(groupBuys.id, d.counter.id), eq(groupBuys.status, 'pasalo')))
        .returning({ id: groupBuys.id });
      if (!moved) continue;
      (d.outcome === 'fulfil' ? fulfilled : failed).push(moved.id);
    }

    const totals = pasaloRefundTotals(refunds);
    return {
      fulfilled,
      failed,
      refundsWritten: written,
      refundTotalPhp: totals.totalPhp,
      customersOwed: totals.customers,
      ordersCancelled,
      skippedOutOfRange,
    };
  });
}

/**
 * Every kahati line held against the counters being closed, with the payment
 * state of each order behind them.
 *
 * Surviving lines are read too, and deliberately: a customer whose other vials
 * still ship is getting a parcel, so their packing deposit stays earned. Read
 * only the failed ones and every mixed-result customer is refunded a fee that
 * bought them something.
 *
 * Cancelled orders are excluded. Their vials were already released and their
 * money already dealt with; counting one would book a second refund against a
 * line that is not being fulfilled anyway.
 */
async function readBatchLines(
  tx: Db,
  counterIds: string[],
  reasonFor: Map<string, string>,
): Promise<{ lines: BatchLine[]; orderFacts: BatchOrderFacts[] }> {
  // Which orders this batch touches at all — anyone holding a line on a staged
  // counter.
  const touched = await tx.selectDistinct({ orderId: orderItems.orderId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(
      isNotNull(orderItems.groupBuyId),
      inArray(orderItems.groupBuyId, counterIds),
      ne(orders.status, 'cancelled'),
    ));
  const orderIds = touched.map((t) => t.orderId);
  if (!orderIds.length) return { lines: [], orderFacts: [] };

  // Then EVERY hatian line those orders hold, not only the ones on staged
  // counters. The deposit decision turns on "does this customer still have a
  // parcel coming", and a surviving line is easy to miss: a counter that filled
  // its kit seals itself the moment it hits ten (sealFullPasalo / closeFullKahati)
  // and is therefore no longer staged when the stage closes. Scoped to the
  // staged counters alone, a customer whose GOOD product filled looks like a
  // customer who lost everything — and gets back a packing fee for a parcel we
  // are in fact about to pack. Their best outcome funding a refund is the exact
  // inversion of the rule.
  const rows = await tx.select({
    orderItemId: orderItems.id,
    orderId: orders.id,
    userId: orders.userId,
    groupBuyId: orderItems.groupBuyId,
    nameSnapshot: orderItems.nameSnapshot,
    qty: orderItems.qty,
    unitPricePhp: orderItems.unitPricePhp,
    lineTotalPhp: orderItems.lineTotalPhp,
    downpaymentPhp: orders.downpaymentPhp,
    packingFeePhp: orders.packingFeePhp,
    cycleKey: orders.cycleKey,
    paymentStatus: orders.paymentStatus,
    settlementStatus: settlements.status,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .leftJoin(settlements, eq(settlements.id, orders.settlementId))
    .where(and(
      isNotNull(orderItems.groupBuyId),
      inArray(orderItems.orderId, orderIds),
      ne(orders.status, 'cancelled'),
    ));

  const lines: BatchLine[] = rows.map((r) => ({
    orderItemId: r.orderItemId,
    orderId: r.orderId,
    userId: r.userId,
    groupBuyId: r.groupBuyId!,
    lineTotalPhp: Number(r.lineTotalPhp),
    qty: r.qty,
    failed: reasonFor.has(r.groupBuyId!),
    failureReason: reasonFor.get(r.groupBuyId!) ?? null,
  }));

  // One entry per ORDER, however many lines it holds.
  const facts = new Map<string, BatchOrderFacts>();
  for (const r of rows) {
    if (facts.has(r.orderId)) continue;
    facts.set(r.orderId, {
      orderId: r.orderId,
      userId: r.userId,
      downpaymentPhp: Number(r.downpaymentPhp),
      packingFeePhp: Number(r.packingFeePhp),
      cycleKey: r.cycleKey,
      paymentStatus: r.paymentStatus,
      settlementStatus: r.settlementStatus ?? null,
    });
  }

  return { lines, orderFacts: [...facts.values()] };
}

/**
 * Persist the decided refunds.
 *
 * `onConflictDoNothing` against order_item_refunds_order_item_id_unique is what
 * makes a repeated close safe: a line already carrying a refund keeps the one
 * it has, at the amount and for the reason it was decided under. A second close
 * must never restate what a customer is owed.
 */
/**
 * Books refund rows for a set of failed lines.
 *
 * Exported because the Kahati expiry sweep owes the same rows for the same
 * reason (lib/kahati-server.ts). Two writers would be two chances to disagree
 * about what a customer is owed, on the one table where that is unaffordable.
 */
export async function writeRefundRows(
  tx: Db,
  refunds: PasaloRefundRow[],
  lines: BatchLine[],
  quantitiesFor: Map<string, ReturnType<typeof counterQuantities>>,
): Promise<number> {
  if (!refunds.length) return 0;

  const snapshotFor = new Map(lines.map((l) => [l.orderItemId, l]));
  const values = refunds.map((r) => {
    const q = quantitiesFor.get(r.groupBuyId);
    const line = snapshotFor.get(r.orderItemId)!;
    return {
      orderItemId: r.orderItemId,
      orderId: r.orderId,
      userId: r.userId,
      groupBuyId: r.groupBuyId,
      goodsPhp: String(r.goodsPhp),
      depositPhp: String(r.depositPhp),
      amountPhp: String(r.amountPhp),
      collectedBasis: r.collectedBasis,
      reason: r.reason,
      kahatiVials: q?.kahatiVials ?? 0,
      pasaloVials: q?.pasaloVials ?? 0,
      combinedVials: q?.combinedVials ?? 0,
      minRequired: q?.minRequired ?? 0,
      qty: line.qty,
      lineTotalPhp: String(round2(line.lineTotalPhp)),
      unitPricePhp: String(line.qty > 0 ? round2(line.lineTotalPhp / line.qty) : 0),
      nameSnapshot: '',
    };
  });

  // Names come from the line rows, which readBatchLines already has in hand;
  // fill them in without a second query.
  const nameById = new Map<string, string>();
  const named = await tx.select({ id: orderItems.id, name: orderItems.nameSnapshot })
    .from(orderItems)
    .where(inArray(orderItems.id, refunds.map((r) => r.orderItemId)));
  for (const n of named) nameById.set(n.id, n.name);
  for (const v of values) v.nameSnapshot = nameById.get(v.orderItemId) ?? '';

  const inserted = await tx.insert(orderItemRefunds).values(values)
    .onConflictDoNothing({ target: orderItemRefunds.orderItemId })
    .returning({ id: orderItemRefunds.id });
  return inserted.length;
}

/**
 * Release what the failed lines were holding — at ITEM granularity.
 *
 * This is the half that used to be wrong, and wrong in three separate ways.
 * `releaseKahatiOrders` cancelled the whole ORDER for any customer holding a
 * line on the failed counter, which:
 *
 *   1. took their SUCCESSFUL products down with it — a cart splits into one
 *      order per mode, not per product, so one kahati order routinely holds
 *      lines against three counters;
 *   2. left those other counters' claimed_slots untouched, so a batch was
 *      ordered from the supplier on vials belonging to a cancelled order;
 *   3. stamped payment_status='not_due' over a deposit we were actually
 *      holding, which is a refund quietly forgotten.
 *
 * So: the failed line's vials come off ITS counter and the order's money is
 * re-derived from what survives. The whole order is cancelled only when nothing
 * of it survives — which is the one case where cancelling it is true.
 */
async function releaseRefundedLines(
  tx: Db,
  refunds: PasaloRefundRow[],
  lines: BatchLine[],
): Promise<number> {
  if (!refunds.length) return 0;

  const refundedItemIds = new Set(refunds.map((r) => r.orderItemId));
  const touchedOrders = [...new Set(refunds.map((r) => r.orderId))];
  let ordersCancelled = 0;

  // EVERY line of the affected orders, not just the ones on counters this close
  // staged. `lines` is scoped to the staged counters, and an order can hold a
  // line on a counter that is not in this stage at all — one still filling on
  // the Kahati board, or one that filled its kit during Kahati and sealed
  // early. Judged against `lines` alone those lines are invisible, so an order
  // whose only VISIBLE line failed reads as an order where everything failed:
  // it gets cancelled outright and re-billed to zero, taking vials the customer
  // is still owed down with it. That is the same order-granularity mistake this
  // whole function was written to end, one level up.
  const allLines = await tx.select({
    id: orderItems.id,
    orderId: orderItems.orderId,
    qty: orderItems.qty,
    lineTotalPhp: orderItems.lineTotalPhp,
  })
    .from(orderItems)
    .where(inArray(orderItems.orderId, touchedOrders));

  for (const orderId of touchedOrders) {
    const held = allLines.filter((l) => l.orderId === orderId);
    const survivors = held.filter((l) => !refundedItemIds.has(l.id));

    // Every line of this order failed, so there is no parcel. Cancel it — and
    // leave payment_status alone. `orders.status` already says the order is
    // off; overwriting the payment fact is what forgot the deposit.
    if (!survivors.length) {
      const [cancelled] = await tx.update(orders)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), ne(orders.status, 'cancelled')))
        .returning({ id: orders.id });
      if (cancelled) {
        ordersCancelled += 1;
        await tx.insert(orderStatusHistory).values({
          orderId,
          status: 'cancelled',
          note: refunds.find((r) => r.orderId === orderId)?.reason ?? 'Pasalo closed below the minimum.',
        });
      }
      continue;
    }

    // A mixed result. The order lives, ships its survivors, and is re-billed
    // for those alone — a customer must never be charged for a vial that was
    // never ordered from the supplier. The packing fee is NOT re-derived: the
    // parcel is still being packed, and lib/order-edit-server.ts declines to
    // move it for exactly the same reason.
    const [row] = await tx.select({ packingFeePhp: orders.packingFeePhp })
      .from(orders).where(eq(orders.id, orderId));
    if (!row) continue;
    const subtotal = round2(survivors.reduce((sum, l) => sum + Number(l.lineTotalPhp), 0));
    await tx.update(orders).set({
      subtotalPhp: String(subtotal),
      totalPhp: String(round2(subtotal + Number(row.packingFeePhp))),
      updatedAt: new Date(),
    }).where(eq(orders.id, orderId));
  }

  // The vials go back to their own counters. Only an OPEN counter is
  // decremented — a counter being cancelled by this very close keeps its
  // historical count of the batch that was not ordered, which is what the
  // refund rows cite as evidence.
  for (const r of refunds) {
    const line = lines.find((l) => l.orderItemId === r.orderItemId);
    if (!line) continue;
    await tx.update(groupBuys)
      .set({ claimedSlots: sql`GREATEST(${groupBuys.claimedSlots} - ${line.qty}, 0)` })
      .where(and(eq(groupBuys.id, r.groupBuyId), eq(groupBuys.status, 'open')));
  }

  return ordersCancelled;
}

/** Customers to notify after a close, read back from what was actually written. */
export type PasaloRefundNotice = {
  userId: string; name: string; email: string;
  amountPhp: number; reason: string; orderNo: string;
};

export async function pasaloRefundNotices(db: Db, since: Date): Promise<PasaloRefundNotice[]> {
  const rows = await db.select({
    userId: orderItemRefunds.userId,
    name: users.name,
    email: users.email,
    amountPhp: orderItemRefunds.amountPhp,
    reason: orderItemRefunds.reason,
    orderNo: orders.orderNo,
  })
    .from(orderItemRefunds)
    .innerJoin(users, eq(users.id, orderItemRefunds.userId))
    .innerJoin(orders, eq(orders.id, orderItemRefunds.orderId))
    .where(sql`${orderItemRefunds.createdAt} >= ${since}`);

  return rows.map((r) => ({ ...r, amountPhp: Number(r.amountPhp) }));
}

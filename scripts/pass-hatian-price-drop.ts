// Pass a lowered hatian price on to commitments placed BEFORE the price fell,
// against a real database.
//
// DRY RUN BY DEFAULT. Lists every live commitment priced above its counter's
// current per-vial price and writes nothing.
//
//   DATABASE_URL="<url>" npx tsx scripts/pass-hatian-price-drop.ts
//   DATABASE_URL="<url>" npx tsx scripts/pass-hatian-price-drop.ts --apply <counterId>,<counterId>
//
// Admin counter edits and catalog repricings do this on their own from now on
// (lib/kahati-reprice-server.ts, covered by
// app/api/admin/groupbuys/reprice-commitments.test.ts). This exists for the
// lines that were overcharged before that fix — KH-2737 paid ₱630 a vial on a
// counter the next buyer joined at ₱450.
//
// --apply takes explicit counter ids and will not run without them. An order
// that was already paid ends up with a total below what it collected: that
// difference is money to send back, and the admin sees it on the order.
import 'dotenv/config';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { getDb, groupBuys, orders, orderItems, users } from '@/lib/db';
import { passPriceDropToCommitments } from '@/lib/kahati-reprice-server';
import { perVialPrice } from '@/lib/pricing';

const applyAt = process.argv.indexOf('--apply');
const APPLY = applyAt !== -1;
const counterIds = APPLY ? (process.argv[applyAt + 1] ?? '').split(',').map((s) => s.trim()).filter(Boolean) : [];

const peso = (n: number): string => `₱${n.toFixed(2)}`;

async function main() {
  if (APPLY && counterIds.length === 0) {
    console.error('--apply needs the counter ids to reprice, e.g. --apply eb7dc6d7-2826-4af3-aec8-1d23978e3392');
    process.exitCode = 1;
    return;
  }

  const db = await getDb();
  const rows = await db
    .select({
      orderNo: orders.orderNo, orderStatus: orders.status, paymentStatus: orders.paymentStatus,
      settlementId: orders.settlementId, orderTotal: orders.totalPhp, email: users.email,
      counterId: groupBuys.id, counterName: groupBuys.name, counterStatus: groupBuys.status,
      kitPrice: groupBuys.pricePerKitPhp, unitPrice: orderItems.unitPricePhp, qty: orderItems.qty,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(groupBuys, eq(groupBuys.id, orderItems.groupBuyId))
    .innerJoin(users, eq(users.id, orders.userId))
    .where(and(
      ne(orders.status, 'cancelled'),
      sql`${orderItems.unitPricePhp} > round(${groupBuys.pricePerKitPhp} / 10, 2)`,
    ));

  let totalOver = 0;
  console.log(`overpriced commitments: ${rows.length}`);
  for (const r of rows) {
    const vial = perVialPrice(Number(r.kitPrice));
    const over = (Number(r.unitPrice) - vial) * r.qty;
    totalOver += over;
    console.log([
      `  ${r.orderNo.padEnd(9)} ${r.qty} × ${peso(Number(r.unitPrice))} → ${peso(vial)}  over ${peso(over)}`,
      `order total ${peso(Number(r.orderTotal))} → ${peso(Number(r.orderTotal) - over)}`,
      `${r.orderStatus}/${r.paymentStatus}${r.settlementId ? ' (settled)' : ''}`,
      `counter ${r.counterId} "${r.counterName}" [${r.counterStatus}]`,
      r.email,
    ].join('  |  '));
  }
  console.log(`total overcharge: ${peso(totalOver)}`);

  if (!APPLY) { console.log('\nDRY RUN — pass --apply <counter ids> to reprice them.'); return; }

  const known = new Set(rows.map((r) => r.counterId));
  const unknown = counterIds.filter((id) => !known.has(id));
  if (unknown.length) {
    console.error(`not an overpriced counter, refusing: ${unknown.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const counters = await db.select().from(groupBuys).where(inArray(groupBuys.id, counterIds));
  for (const counter of counters) {
    const changed = await db.transaction((tx) => passPriceDropToCommitments(tx, counter.id, counter.pricePerKitPhp));
    console.log(`repriced ${changed} order(s) on counter ${counter.id} "${counter.name}"`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

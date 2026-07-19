// Hatian (kahati) lifecycle — database side effects.
//
// There is no scheduler in this app, so expired counters are resolved lazily:
// callers invoke sweepExpiredKahatis() when they read the board (public + admin).
// The auto-open on fill happens inside the checkout transaction (see the orders route).
import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { getDb, groupBuys } from '@/lib/db';

type Db = Awaited<ReturnType<typeof getDb>>;

// Resolve OPEN hatians whose close deadline has passed:
//   short of the cap -> 'cancelled'; already at/over the cap -> 'closed'.
// Idempotent: only rows still 'open' with an elapsed deadline are touched.
export async function sweepExpiredKahatis(db: Db, now: Date = new Date()): Promise<void> {
  const expiredAndOpen = and(
    eq(groupBuys.status, 'open'),
    isNotNull(groupBuys.closesAt),
    lt(groupBuys.closesAt, now),
  );
  // Under the cap → cancelled (never completed a kit).
  await db.update(groupBuys).set({ status: 'cancelled' }).where(and(
    expiredAndOpen,
    lt(groupBuys.claimedSlots, groupBuys.totalSlots),
  ));
  // At/over the cap but still open (e.g. an admin edit bumped claimed) → closed.
  await db.update(groupBuys).set({ status: 'closed' }).where(and(
    expiredAndOpen,
    sql`${groupBuys.claimedSlots} >= ${groupBuys.totalSlots}`,
  ));
}

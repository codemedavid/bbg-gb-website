import { eq, inArray, type SQL } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders } from '@/lib/db';
import { selectAdminOrders } from '@/lib/admin-orders-server';
import { SEGMENT_BUY_TYPES, isReportSegment, REPORT_SEGMENTS } from '@/lib/report/segment';
import { getLatestCycleKey } from '@/lib/settings';

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const params = new URL(req.url).searchParams;
  const status = params.get('status');
  const segment = params.get('segment');
  // A mistyped segment is rejected rather than ignored: an admin reading
  // "On-Hand orders" off the heading while the table quietly holds every order
  // is worse than a page that says it could not load.
  if (segment !== null && !isReportSegment(segment)) {
    throw new ApiError(400, `Unknown segment "${segment}". Expected one of: ${REPORT_SEGMENTS.join(', ')}.`);
  }
  const db = await getDb();
  const where: SQL[] = [];
  if (status) where.push(eq(orders.status, status as never));
  // Filtered here rather than in the browser — the list is unpaginated, so a
  // client-side split would still ship every order down the wire to discard
  // most of it.
  if (segment) where.push(inArray(orders.buyType, SEGMENT_BUY_TYPES[segment] as never));
  // `cycle=current` scopes the list to the cycle the team is working — the
  // latest to have opened, trading or not. Any other value is a cycle key from
  // the archive. Absent, every order is listed. Filtered here for the same
  // reason the segment is.
  const cycle = params.get('cycle');
  if (cycle === 'current') {
    const key = await getLatestCycleKey();
    if (key) where.push(eq(orders.cycleKey, key));
  } else if (cycle) {
    where.push(eq(orders.cycleKey, cycle));
  }
  return ok(await selectAdminOrders(db, where));
});

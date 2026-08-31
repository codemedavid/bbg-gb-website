import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, users } from '@/lib/db';
import { SEGMENT_BUY_TYPES, isReportSegment, REPORT_SEGMENTS } from '@/lib/report/segment';

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
  const base = db.select({
    id: orders.id, orderNo: orders.orderNo, status: orders.status, buyType: orders.buyType,
    totalPhp: orders.totalPhp, shipName: orders.shipName, shipPhone: orders.shipPhone,
    trackingNo: orders.trackingNo, createdAt: orders.createdAt, customerEmail: users.email,
  }).from(orders).leftJoin(users, eq(orders.userId, users.id)).orderBy(desc(orders.createdAt));
  return ok(where.length ? await base.where(and(...where)) : await base);
});

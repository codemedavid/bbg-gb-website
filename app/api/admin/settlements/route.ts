import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, orders, settlements, settlementPaymentProofs, users } from '@/lib/db';
import { signedUrl } from '@/lib/storage';
import { BUCKETS } from '@/lib/env';

// Admin: every hatian final checkout, newest first. `orderCount` is how many
// completed hatian orders the one packing fee covers — the figure that shows at
// a glance the fee was charged per parcel, not per commitment.
export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const status = new URL(req.url).searchParams.get('status');
  const db = await getDb();

  const base = db.select({
    id: settlements.id,
    status: settlements.status,
    packingFeePhp: settlements.packingFeePhp,
    balancePhp: settlements.balancePhp,
    totalPhp: settlements.totalPhp,
    paymentMethod: settlements.paymentMethod,
    paymentProofKey: settlements.paymentProofKey,
    createdAt: settlements.createdAt,
    paidAt: settlements.paidAt,
    customerName: users.name,
    customerEmail: users.email,
    orderCount: sql<number>`(select count(*)::int from ${orders} where ${orders.settlementId} = ${settlements.id})`,
  })
    .from(settlements)
    .leftJoin(users, eq(settlements.userId, users.id))
    .orderBy(desc(settlements.createdAt));

  const rows = status ? await base.where(eq(settlements.status, status as never)) : await base;

  // Every proof each settlement carries, signed. A settlement paid in three
  // transfers has three screenshots, and any one of them alone reads as
  // underpaid against the total — which is how an admin ends up chasing a
  // customer who has already paid in full.
  //
  // Batched into ONE query rather than one per row: this list is unpaginated
  // and a per-settlement lookup would be an N+1 that grows with the backlog.
  const ids = rows.map((r) => r.id);
  const proofRows = ids.length
    ? await db.select().from(settlementPaymentProofs)
        .where(inArray(settlementPaymentProofs.settlementId, ids))
        .orderBy(asc(settlementPaymentProofs.sortOrder))
    : [];
  const signed = await Promise.all(proofRows.map(async (p) => ({
    settlementId: p.settlementId,
    id: p.id,
    url: await signedUrl(BUCKETS.proofs, p.storageKey),
    sortOrder: p.sortOrder,
    amountPhp: p.amountPhp,
    reference: p.reference,
  })));

  return ok(rows.map((r) => ({
    ...r,
    proofs: signed.filter((p) => p.settlementId === r.id).map(({ settlementId: _s, ...p }) => p),
  })));
});

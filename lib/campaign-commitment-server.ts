// Reading a customer's live group buy commitments out of the database.
//
// The rules that act on the result live in lib/campaign-commitment.ts; this
// file only fetches the rows. Both the checkout route and the screen that
// previews it call through here, so the fee the customer is shown is produced
// by the same query that decides what they are charged — the same arrangement
// as lib/kahati-commitment-server.ts.
import { and, asc, eq } from 'drizzle-orm';
import { getDb, moqCampaigns, orderItems, orders } from '@/lib/db';
import type { CampaignCommitment } from './campaign-commitment';
import type { OrderStatus } from './db/schema';

type Db = Awaited<ReturnType<typeof getDb>>;

// Every group buy line the customer holds, with the order status and the
// packing fee that order carried — the two facts the waiver rule turns on.
export async function listCampaignCommitments(db: Db, userId: string): Promise<CampaignCommitment[]> {
  const rows = await db.select({
    orderId: orders.id,
    orderNo: orders.orderNo,
    orderStatus: orders.status,
    packingFeePhp: orders.packingFeePhp,
    campaignId: moqCampaigns.id,
    seriesId: moqCampaigns.seriesId,
    campaignName: moqCampaigns.name,
    qty: orderItems.qty,
    lineTotalPhp: orderItems.lineTotalPhp,
    placedAt: orders.createdAt,
  })
    .from(orders)
    .innerJoin(orderItems, eq(orderItems.orderId, orders.id))
    .innerJoin(moqCampaigns, eq(moqCampaigns.id, orderItems.moqCampaignId))
    .where(and(
      eq(orders.userId, userId),
      eq(orderItems.kind, 'moq_campaign'),
    ))
    .orderBy(asc(orders.createdAt));

  return rows.map((r) => ({
    orderId: r.orderId,
    orderNo: r.orderNo,
    // A batch written before batching existed carries no series id; it is
    // batch #1 of a series of its own (mirrors seriesOf in moq-batch-server).
    seriesId: r.seriesId ?? r.campaignId,
    campaignName: r.campaignName,
    orderStatus: r.orderStatus as OrderStatus,
    packingFeePhp: Number(r.packingFeePhp),
    qty: r.qty,
    lineTotalPhp: Number(r.lineTotalPhp),
    placedAt: r.placedAt.toISOString(),
  }));
}

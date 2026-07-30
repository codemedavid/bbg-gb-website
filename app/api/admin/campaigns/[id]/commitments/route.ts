import { asc, eq, inArray } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { ApiError } from '@/lib/session';
import { getDb, moqCampaigns, orderItems, orders, users } from '@/lib/db';
import { groupCampaignParticipants, summariseCampaignParticipants, type CampaignOrderRow } from '@/lib/campaign-participants';

// Admin: who is in this Group Buy campaign and what each of them paid.
//
// The kahati equivalent is /api/admin/groupbuys/:id/commitments. That route
// joins group_buys, so passing it a campaign id answers 200 with zero rows —
// which is why this one exists rather than the two sharing a handler.
//
// Scoped to the SERIES, not the batch. A batch that fills seals itself and opens
// a successor carrying the same terms; to the customer that is one group buy,
// and the packing fee follows the series (lib/campaign-commitment.ts). Reporting
// per batch would split one participant across two tables and make the
// single-fee guarantee unverifiable — the thing this screen exists to show.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const db = await getDb();

  const [campaign] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
  if (!campaign) throw new ApiError(404, 'Campaign not found.');

  // Every batch of this series, so a commitment that overflowed into a successor
  // still reports under the campaign the admin opened.
  const seriesId = campaign.seriesId ?? campaign.id;
  const batches = await db.select({ id: moqCampaigns.id, batchNo: moqCampaigns.batchNo })
    .from(moqCampaigns).where(eq(moqCampaigns.seriesId, seriesId));
  // A row written before series ids existed is its own series of one.
  const batchIds = batches.length ? batches.map((b) => b.id) : [campaign.id];
  const batchNoById = new Map(batches.map((b) => [b.id, b.batchNo]));

  const rows = await db.select({
    orderId: orders.id,
    orderNo: orders.orderNo,
    orderStatus: orders.status,
    userId: orders.userId,
    customerName: users.name,
    customerEmail: users.email,
    customerPhone: users.phone,
    shipPhone: orders.shipPhone,
    shipAddress: orders.shipAddress,
    moqCampaignId: orderItems.moqCampaignId,
    qty: orderItems.qty,
    lineTotalPhp: orderItems.lineTotalPhp,
    packingFeePhp: orders.packingFeePhp,
    totalPhp: orders.totalPhp,
    paymentMethod: orders.paymentMethod,
    placedAt: orders.createdAt,
  })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(users, eq(users.id, orders.userId))
    .where(inArray(orderItems.moqCampaignId, batchIds))
    .orderBy(asc(orders.createdAt));

  const participants = groupCampaignParticipants(rows.map((r): CampaignOrderRow => ({
    orderId: r.orderId,
    orderNo: r.orderNo,
    orderStatus: r.orderStatus,
    userId: r.userId,
    customerName: r.customerName,
    customerEmail: r.customerEmail,
    customerPhone: r.customerPhone,
    shipPhone: r.shipPhone,
    shipAddress: r.shipAddress,
    batchNo: batchNoById.get(r.moqCampaignId ?? '') ?? campaign.batchNo,
    kits: r.qty,
    lineTotalPhp: Number(r.lineTotalPhp),
    packingFeePhp: Number(r.packingFeePhp),
    totalPhp: Number(r.totalPhp),
    paymentMethod: r.paymentMethod,
    placedAt: r.placedAt.toISOString(),
  })));

  return ok({
    campaign: { id: campaign.id, name: campaign.name, seriesId, batchNo: campaign.batchNo, moq: campaign.moq, committed: campaign.committed },
    participants,
    summary: summariseCampaignParticipants(participants),
  });
});

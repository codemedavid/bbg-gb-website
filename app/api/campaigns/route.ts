import { desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, moqCampaigns } from '@/lib/db';
import { moqCampaignSchema } from '@/lib/moq-schemas';
import { groupBuyMoqStatus } from '@/lib/pricing';
import { campaignOutcome } from '@/lib/group-buy';

// Public: list campaigns with derived MOQ progress and lifecycle outcome.
export const GET = handler(async () => {
  const db = await getDb();
  const rows = await db.select().from(moqCampaigns).orderBy(desc(moqCampaigns.createdAt));
  const data = rows.map((c) => {
    const status = groupBuyMoqStatus(c.committed, c.moq);
    return {
      ...c,
      progress: status.progress,
      remaining: status.remaining,
      reached: status.reached,
      outcome: campaignOutcome(c.status, c.committed, c.moq),
    };
  });
  return ok(data);
});

// Admin: create a campaign.
export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const b = moqCampaignSchema.parse(await req.json());
  const db = await getDb();
  const [row] = await db.insert(moqCampaigns).values({
    name: b.name,
    pricePerKitPhp: String(b.pricePerKitPhp),
    moq: b.moq,
    perCustomerMin: b.perCustomerMin ?? 1,
    shippingPhp: String(b.shippingPhp ?? 180),
    status: b.status ?? 'open',
    deadline: b.deadline ? new Date(b.deadline) : null,
    includedProducts: b.includedProducts ?? [],
    arrivalGroup: b.arrivalGroup ?? 'white_powder',
    description: b.description ?? null,
  }).returning();
  return ok(row, 201);
});

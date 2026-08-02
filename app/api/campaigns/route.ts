import { randomUUID } from 'node:crypto';
import { desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, moqCampaigns } from '@/lib/db';
import { moqCampaignSchema } from '@/lib/moq-schemas';
import { getPackingFees } from '@/lib/settings';
import { describeBatch } from '@/lib/group-buy';
import { requireBoardsOpenOrAdmin } from '@/lib/schedule-gate';

// Public: list batches with derived MOQ progress and lifecycle outcome.
export const GET = handler(async () => {
  // The same shared window that gates the hatian board. The admin reads through
  // it — this endpoint backs the admin campaign list, and locking them out here
  // would leave no screen from which to open the next window.
  await requireBoardsOpenOrAdmin();
  const db = await getDb();
  const rows = await db.select().from(moqCampaigns).orderBy(desc(moqCampaigns.createdAt));
  return ok(rows.map(describeBatch));
});

// Admin: create a campaign — batch #1 of its own series.
export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const b = moqCampaignSchema.parse(await req.json());
  const db = await getDb();
  // New campaigns default to the global pasabay packing fee unless overridden.
  const defaultFee = (await getPackingFees()).group_buy;
  // The id is minted here rather than by the database so the row can point its
  // series at itself in the same INSERT: every batch of a series, including the
  // first, is reachable by one indexed read on series_id.
  const id = randomUUID();
  const [row] = await db.insert(moqCampaigns).values({
    id,
    seriesId: id,
    batchNo: 1,
    name: b.name,
    pricePerKitPhp: String(b.pricePerKitPhp),
    moq: b.moq,
    shippingPhp: String(b.shippingPhp ?? defaultFee),
    status: b.status ?? 'open',
    deadline: b.deadline ? new Date(b.deadline) : null,
    includedProducts: b.includedProducts ?? [],
    arrivalGroup: b.arrivalGroup ?? 'white_powder',
    description: b.description ?? null,
  }).returning();
  return ok(row, 201);
});

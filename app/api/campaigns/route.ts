import { randomUUID } from 'node:crypto';
import { desc, ne } from 'drizzle-orm';
import { requireAdmin, getSession } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, moqCampaigns } from '@/lib/db';
import { moqCampaignSchema } from '@/lib/moq-schemas';
import { getPackingFees } from '@/lib/settings';
import { describeBatch } from '@/lib/group-buy';
import { openDueBatches } from '@/lib/moq-batch-server';
import { openingStatus } from '@/lib/campaign-schedule';
import { requireBoardsOpenOrAdmin } from '@/lib/schedule-gate';
import { assertCampaignProductsAreGroupBuy } from '@/lib/channel-guard';

// Public: list batches with derived MOQ progress and lifecycle outcome.
//
// The admin board reads this same endpoint, so a scheduled batch is hidden by
// audience rather than by route: an unannounced campaign's name and price must
// not be fetchable before it opens, and the admin still has to see what they
// scheduled. Reading the board is also what opens the batches whose date has
// arrived — the Kahati board has resolved its lifecycle this way all along.
export const GET = handler(async () => {
  // The same shared window that gates the hatian board. The admin reads through
  // it — this endpoint backs the admin campaign list, and locking them out here
  // would leave no screen from which to open the next window.
  await requireBoardsOpenOrAdmin();
  const db = await getDb();
  await openDueBatches(db);
  const session = await getSession();
  const rows = await db.select().from(moqCampaigns)
    .where(session?.role === 'admin' ? undefined : ne(moqCampaigns.status, 'scheduled'))
    .orderBy(desc(moqCampaigns.createdAt));
  return ok(rows.map(describeBatch));
});

// Admin: create a campaign — batch #1 of its own series.
export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const b = moqCampaignSchema.parse(await req.json());
  // A campaign may only carry products the admin enabled for Group Buy. Checked
  // before anything is written, so a refused campaign leaves no row behind.
  await assertCampaignProductsAreGroupBuy(b.includedProducts ?? []);
  const db = await getDb();
  // New campaigns default to the global pasabay packing fee unless overridden.
  const defaultFee = (await getPackingFees()).group_buy;
  // The id is minted here rather than by the database so the row can point its
  // series at itself in the same INSERT: every batch of a series, including the
  // first, is reachable by one indexed read on series_id.
  const id = randomUUID();
  const opensAt = b.opensAt ? new Date(b.opensAt) : null;
  const [row] = await db.insert(moqCampaigns).values({
    id,
    seriesId: id,
    batchNo: 1,
    name: b.name,
    pricePerKitPhp: String(b.pricePerKitPhp),
    moq: b.moq,
    shippingPhp: String(b.shippingPhp ?? defaultFee),
    // The admin sets a date, not a status: 'scheduled' is derived so the two can
    // never disagree — no batch waits on a moment that already passed.
    status: b.status ?? openingStatus(opensAt),
    opensAt,
    deadline: b.deadline ? new Date(b.deadline) : null,
    includedProducts: b.includedProducts ?? [],
    arrivalGroup: b.arrivalGroup ?? 'white_powder',
    description: b.description ?? null,
  }).returning();
  return ok(row, 201);
});

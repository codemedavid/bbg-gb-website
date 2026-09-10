import { randomUUID } from 'node:crypto';
import { desc, eq, inArray, ne, or } from 'drizzle-orm';
import { requireAdmin, getSession } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, moqCampaigns } from '@/lib/db';
import { moqCampaignSchema } from '@/lib/moq-schemas';
import { getPackingFees, getLatestCycleKey } from '@/lib/settings';
import { LIVE_CAMPAIGN_STATUSES } from '@/lib/cycle-archive';
import { describeBatch } from '@/lib/group-buy';
import { openDueBatches } from '@/lib/moq-batch-server';
import { openCampaignsForGroupBuyProducts } from '@/lib/campaign-seed-bulk';
import { openingStatus } from '@/lib/campaign-schedule';
import { requireBoardsOpenOrAdmin } from '@/lib/schedule-gate';
import { assertCampaignProductsAreGroupBuy } from '@/lib/channel-guard';
import { refreshBoardsForNewCycle } from '@/lib/cycle-boundary-server';

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
  // The first read of a new cycle brings every batch nobody joined up to date
  // with the catalog — the mirror of what the hatian board does, and for the
  // same reason: a cycle opens on the schedule, and nothing presses the admin's
  // "Start new cycle" button when it does.
  await refreshBoardsForNewCycle(db);
  // Then open batch #1 for every flagged product not yet on the board — the
  // mirror of what the hatian board does on read. Nothing on any route did
  // this before; only a QA script did, so a board whose every batch had been
  // cancelled stayed empty until somebody remembered to run it. After the
  // cycle refresh, so a batch that exists is brought forward before a missing
  // one is opened.
  await openCampaignsForGroupBuyProducts();
  const session = await getSession();
  // A customer sees what can be joined. The admin sees THIS cycle's board:
  // every batch still trading, plus those that ended in the current cycle. A
  // batch that ended in an earlier cycle is in Admin → Cycle archives under
  // that cycle, kits and all — listing it here is what made "Start new cycle"
  // look as though it removed nothing.
  const onBoard = async () => {
    const cycleKey = await getLatestCycleKey();
    const live = inArray(moqCampaigns.status, [...LIVE_CAMPAIGN_STATUSES]);
    return cycleKey ? or(live, eq(moqCampaigns.cycleKey, cycleKey)) : live;
  };
  const rows = await db.select().from(moqCampaigns)
    .where(session?.role === 'admin' ? await onBoard() : ne(moqCampaigns.status, 'scheduled'))
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

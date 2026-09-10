import { desc, eq, inArray, or } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, groupBuys } from '@/lib/db';
import { groupBuySchema } from '@/lib/admin-schemas';
import { getPackingFees, getLatestCycleKey } from '@/lib/settings';
import { LIVE_KAHATI_STATUSES } from '@/lib/cycle-archive';
import { sweepKahatis } from '@/lib/kahati-server';
import { openKahatisForGroupBuyProducts } from '@/lib/kahati-seed-bulk';
import { KAHATI_MAX_VIALS } from '@/lib/kahati';
import { openingStatus } from '@/lib/campaign-schedule';

export const GET = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  // Resolve expired counters (cancel unfilled, close full) before listing so the
  // admin board reflects the real lifecycle state on load.
  await sweepKahatis(db);
  // Then open a counter for every flagged product that lacks one. The public
  // board does this on read too, but that read is gated shut outside trading
  // hours — and the admin's board is where the catalog gets looked over BEFORE
  // a cycle opens. A paused storefront with every counter cancelled used to
  // show the admin an empty board with no way to get the products back on it.
  await openKahatisForGroupBuyProducts();
  // This cycle's board: every counter still trading, plus the ones that ended
  // in the current cycle. A counter that ended in an earlier cycle is in
  // Admin → Cycle archives under that cycle, vials and all — listing it here
  // is what made "Start new cycle" look as though it removed nothing.
  const cycleKey = await getLatestCycleKey();
  const live = inArray(groupBuys.status, [...LIVE_KAHATI_STATUSES]);
  return ok(await db.select().from(groupBuys)
    .where(cycleKey ? or(live, eq(groupBuys.cycleKey, cycleKey)) : live)
    .orderBy(desc(groupBuys.createdAt)));
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const b = groupBuySchema.parse(await req.json());
  const db = await getDb();
  // New kahati listings default to the global hatian packing fee unless overridden.
  const defaultFee = (await getPackingFees()).kahati;
  const opensAt = b.opensAt ? new Date(b.opensAt) : null;
  const [row] = await db.insert(groupBuys).values({
    name: b.name, pricePerKitPhp: String(b.pricePerKitPhp),
    // A hatian fills one kit, so the cap defaults to — and is capped at — 10 vials.
    totalSlots: b.totalSlots ?? KAHATI_MAX_VIALS,
    claimedSlots: b.claimedSlots ?? 0, minVials: b.minVials ?? 1,
    // The admin sets a date, not a status: 'scheduled' is derived so a counter
    // can never sit waiting on a moment that already passed.
    repackFeePhp: String(b.repackFeePhp ?? defaultFee), status: b.status ?? openingStatus(opensAt),
    opensAt,
    closesAt: b.closesAt ? new Date(b.closesAt) : null, arrivalGroup: b.arrivalGroup ?? 'white_powder',
    description: b.description ?? null,
  }).returning();
  return ok(row, 201);
});

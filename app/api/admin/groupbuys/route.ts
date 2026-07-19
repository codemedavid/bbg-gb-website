import { desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, groupBuys } from '@/lib/db';
import { groupBuySchema } from '@/lib/admin-schemas';
import { getPackingFees } from '@/lib/settings';
import { sweepExpiredKahatis } from '@/lib/kahati-server';
import { KAHATI_MAX_VIALS } from '@/lib/kahati';

export const GET = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  // Resolve expired counters (cancel unfilled, close full) before listing so the
  // admin board reflects the real lifecycle state on load.
  await sweepExpiredKahatis(db);
  return ok(await db.select().from(groupBuys).orderBy(desc(groupBuys.createdAt)));
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const b = groupBuySchema.parse(await req.json());
  const db = await getDb();
  // New kahati listings default to the global hatian packing fee unless overridden.
  const defaultFee = (await getPackingFees()).kahati;
  const [row] = await db.insert(groupBuys).values({
    name: b.name, pricePerKitPhp: String(b.pricePerKitPhp),
    // A hatian fills one kit, so the cap defaults to — and is capped at — 10 vials.
    totalSlots: b.totalSlots ?? KAHATI_MAX_VIALS,
    claimedSlots: b.claimedSlots ?? 0, minVials: b.minVials ?? 1,
    repackFeePhp: String(b.repackFeePhp ?? defaultFee), status: b.status ?? 'open',
    closesAt: b.closesAt ? new Date(b.closesAt) : null, arrivalGroup: b.arrivalGroup ?? 'white_powder',
    description: b.description ?? null,
  }).returning();
  return ok(row, 201);
});

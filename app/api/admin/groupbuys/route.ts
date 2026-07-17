import { desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, groupBuys } from '@/lib/db';
import { groupBuySchema } from '@/lib/admin-schemas';

export const GET = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  return ok(await db.select().from(groupBuys).orderBy(desc(groupBuys.createdAt)));
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const b = groupBuySchema.parse(await req.json());
  const db = await getDb();
  const [row] = await db.insert(groupBuys).values({
    name: b.name, pricePerKitPhp: String(b.pricePerKitPhp), totalSlots: b.totalSlots,
    claimedSlots: b.claimedSlots ?? 0, minVials: b.minVials ?? 7,
    repackFeePhp: String(b.repackFeePhp ?? 150), status: b.status ?? 'open',
    closesAt: b.closesAt ? new Date(b.closesAt) : null, arrivalGroup: b.arrivalGroup ?? 'white_powder',
    description: b.description ?? null,
  }).returning();
  return ok(row, 201);
});

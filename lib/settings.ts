// Admin-editable global defaults, backed by the `settings` key/value table.
// Absent keys fall back to the code constants in PACKING_FEE_PHP, so an empty
// table yields the documented defaults (solo 200 / kahati 150 / group_buy 300).
import { inArray } from 'drizzle-orm';
import { getDb, settings } from '@/lib/db';
import { PACKING_FEE_PHP, type PackingMode, type PackingFees } from '@/lib/pricing';

export type { PackingFees };

const KEY: Record<PackingMode, string> = {
  solo: 'packing_fee_solo',
  kahati: 'packing_fee_kahati',
  group_buy: 'packing_fee_group_buy',
};

export async function getPackingFees(): Promise<PackingFees> {
  const db = await getDb();
  const rows = await db.select().from(settings).where(inArray(settings.key, Object.values(KEY)));
  const byKey = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const read = (mode: PackingMode): number => {
    const v = byKey.get(KEY[mode]);
    return v != null && Number.isFinite(v) && v >= 0 ? v : PACKING_FEE_PHP[mode];
  };
  return { solo: read('solo'), kahati: read('kahati'), group_buy: read('group_buy') };
}

// Upserts only the provided modes; returns the full resolved fee set.
export async function setPackingFees(patch: Partial<PackingFees>): Promise<PackingFees> {
  const db = await getDb();
  for (const mode of Object.keys(patch) as PackingMode[]) {
    const value = patch[mode];
    if (value == null) continue;
    await db.insert(settings)
      .values({ key: KEY[mode], value: String(value) })
      .onConflictDoUpdate({ target: settings.key, set: { value: String(value) } });
  }
  return getPackingFees();
}

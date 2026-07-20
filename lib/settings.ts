// Admin-editable global defaults, backed by the `settings` key/value table.
// Absent keys fall back to the code constants in PACKING_FEE_PHP, so an empty
// table yields the documented defaults (solo 200 / kahati 150 / group_buy 300).
import { eq, inArray } from 'drizzle-orm';
import { getDb, settings } from '@/lib/db';
import { KAHATI_DOWNPAYMENT_PHP, PACKING_FEE_PHP, type PackingMode, type PackingFees } from '@/lib/pricing';

export type { PackingFees };

const KEY: Record<PackingMode, string> = {
  solo: 'packing_fee_solo',
  kahati: 'packing_fee_kahati',
  group_buy: 'packing_fee_group_buy',
  moq: 'packing_fee_moq',
};

export async function getPackingFees(): Promise<PackingFees> {
  const db = await getDb();
  const rows = await db.select().from(settings).where(inArray(settings.key, Object.values(KEY)));
  const byKey = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const read = (mode: PackingMode): number => {
    const v = byKey.get(KEY[mode]);
    return v != null && Number.isFinite(v) && v >= 0 ? v : PACKING_FEE_PHP[mode];
  };
  return { solo: read('solo'), kahati: read('kahati'), group_buy: read('group_buy'), moq: read('moq') };
}

const DOWNPAYMENT_KEY = 'kahati_downpayment';

// Downpayment due at checkout for kahati orders; falls back to the code default.
export async function getKahatiDownpayment(): Promise<number> {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, DOWNPAYMENT_KEY));
  const v = row ? Number(row.value) : NaN;
  return Number.isFinite(v) && v >= 0 ? v : KAHATI_DOWNPAYMENT_PHP;
}

export async function setKahatiDownpayment(value: number): Promise<number> {
  const db = await getDb();
  await db.insert(settings)
    .values({ key: DOWNPAYMENT_KEY, value: String(value) })
    .onConflictDoUpdate({ target: settings.key, set: { value: String(value) } });
  return getKahatiDownpayment();
}

const MOQ_PAGE_KEY = 'moq_page_enabled';

// Whether the MOQ storefront page is live. This one flag gates the route, the
// public product API and the nav tab, so it fails closed: an absent or corrupt
// value reads as OFF. Only the exact string 'true' turns the page on, which
// means a half-configured deploy hides the page rather than exposing it.
export async function getMoqPageEnabled(): Promise<boolean> {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, MOQ_PAGE_KEY));
  return row?.value === 'true';
}

export async function setMoqPageEnabled(enabled: boolean): Promise<boolean> {
  const db = await getDb();
  const value = String(enabled);
  await db.insert(settings)
    .values({ key: MOQ_PAGE_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  return getMoqPageEnabled();
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

// Admin-editable global defaults, backed by the `settings` key/value table.
// Absent keys fall back to the code constants in PACKING_FEE_PHP, so an empty
// table yields the documented defaults (solo 200 / kahati 150 / group_buy 300).
import { eq, inArray } from 'drizzle-orm';
import { getDb, settings } from '@/lib/db';
import { KAHATI_DOWNPAYMENT_PHP, PACKING_FEE_PHP, type PackingMode, type PackingFees } from '@/lib/pricing';
import { isScheduleOpen, type GroupBuySchedule } from '@/lib/schedule';

export type { PackingFees, GroupBuySchedule };

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

// ---- The shared Group Buy + Hatian schedule ---------------------------------
//
// One window, two modules. The requirement is "configure it once and both boards
// follow it", which is only guaranteed if there is literally one pair of keys to
// read — a per-module override is exactly how two schedules quietly drift apart.
// So these are the only keys, and every consumer reads through isGroupBuyOpenNow.
const SCHEDULE_KEY = {
  opensAt: 'group_buy_schedule_opens_at',
  closesAt: 'group_buy_schedule_closes_at',
} as const;

/**
 * The configured window, or nulls when it has never been set.
 *
 * Values come back exactly as stored, without repair. A corrupt row is handed
 * to isScheduleOpen, which fails closed on it — validating here as well would
 * only hide the corruption from the one place that reports it.
 */
export async function getGroupBuySchedule(): Promise<GroupBuySchedule> {
  const db = await getDb();
  const rows = await db.select().from(settings)
    .where(inArray(settings.key, [SCHEDULE_KEY.opensAt, SCHEDULE_KEY.closesAt]));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const read = (key: string): string | null => {
    const v = byKey.get(key);
    return v != null && v !== '' ? v : null;
  };
  return { opensAt: read(SCHEDULE_KEY.opensAt), closesAt: read(SCHEDULE_KEY.closesAt) };
}

// Anything Date can parse is accepted and written back in one canonical ISO
// form, so two spellings of the same instant cannot compare as two windows.
function normaliseInstant(value: string | null | undefined, field: string): string | null {
  if (value == null || value === '') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${field} is not a valid date/time: ${value}`);
  return new Date(ms).toISOString();
}

/**
 * Stores the window and returns it as stored.
 *
 * A backwards window is refused at this boundary so the corrupt state never
 * reaches the database. Only a fully-specified window is checked: clearing one
 * end is how an admin unsets the schedule, not a mistake. Either end set to null
 * deletes its row rather than storing an empty string, which keeps "unset" a
 * single state instead of two.
 */
export async function setGroupBuySchedule(window: GroupBuySchedule): Promise<GroupBuySchedule> {
  const opensAt = normaliseInstant(window.opensAt, 'opensAt');
  const closesAt = normaliseInstant(window.closesAt, 'closesAt');
  if (opensAt && closesAt && Date.parse(opensAt) >= Date.parse(closesAt)) {
    throw new Error('The schedule must close after it opens.');
  }

  const db = await getDb();
  // Both ends move together or neither does. A half-written window reads as
  // CLOSED everywhere downstream, so a save that failed between the two
  // statements would take both boards dark as a side effect of an error the
  // admin sees as "nothing was applied".
  await db.transaction(async (tx) => {
    const write = async (key: string, value: string | null): Promise<void> => {
      if (value == null) {
        await tx.delete(settings).where(eq(settings.key, key));
        return;
      }
      await tx.insert(settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: settings.key, set: { value } });
    };
    await write(SCHEDULE_KEY.opensAt, opensAt);
    await write(SCHEDULE_KEY.closesAt, closesAt);
  });
  return getGroupBuySchedule();
}

/**
 * Whether both boards are live right now. The one question every gated route
 * and server component asks, so none of them can answer it differently.
 */
export async function isGroupBuyOpenNow(now: Date = new Date()): Promise<boolean> {
  return isScheduleOpen(await getGroupBuySchedule(), now);
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

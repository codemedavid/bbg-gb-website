// Admin-editable global defaults, backed by the `settings` key/value table.
// Absent keys fall back to the code constants in PACKING_FEE_PHP, so an empty
// table yields the documented defaults (solo 200 / kahati 150 / group_buy 300).
import { eq, inArray } from 'drizzle-orm';
import { getDb, settings } from '@/lib/db';
import { KAHATI_DOWNPAYMENT_PHP, PACKING_FEE_PHP, type PackingMode, type PackingFees } from '@/lib/pricing';
import { cycleAt, type Cycle, type ScheduleRecurrence } from '@/lib/schedule-recurrence';

export type { PackingFees, Cycle, ScheduleRecurrence };

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
// One recurrence, two modules. The requirement is "configure it once and both
// boards follow it", which is only guaranteed if there is literally one set of
// keys to read — a per-module override is exactly how two schedules quietly
// drift apart. So these are the only keys, and every consumer reads through
// getCurrentCycle or isGroupBuyOpenNow.
//
// A WEEKLY recurrence rather than a one-off window: the business trades every
// week, and an absolute window has to be re-entered by hand each time — a
// storefront one forgotten edit away from being dark.
const SCHEDULE_KEY = {
  openDay: 'schedule_open_day',
  openTime: 'schedule_open_time',
  closeDay: 'schedule_close_day',
  closeTime: 'schedule_close_time',
} as const;

const PAUSED_KEY = 'schedule_paused_until';

/**
 * The configured recurrence, or nulls when it has never been set.
 *
 * Values come back exactly as stored, without repair. A corrupt row is handed
 * to cycleAt, which fails closed on it — validating here as well would only
 * hide the corruption from the one place that reports it.
 */
export async function getScheduleRecurrence(): Promise<ScheduleRecurrence> {
  const db = await getDb();
  const rows = await db.select().from(settings)
    .where(inArray(settings.key, Object.values(SCHEDULE_KEY)));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const text = (key: string): string | null => {
    const v = byKey.get(key);
    return v != null && v !== '' ? v : null;
  };
  // A day that is not a number reads as absent, which is CLOSED — the same
  // answer cycleAt gives it, reached one step earlier.
  const day = (key: string): number | null => {
    const v = text(key);
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    openDay: day(SCHEDULE_KEY.openDay), openTime: text(SCHEDULE_KEY.openTime),
    closeDay: day(SCHEDULE_KEY.closeDay), closeTime: text(SCHEDULE_KEY.closeTime),
  };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Stores the recurrence and returns it as stored.
 *
 * A schedule this module cannot read back is refused at this boundary, so the
 * corrupt state never reaches the database. Clearing ALL FOUR fields is how an
 * admin unsets the schedule; clearing only some is refused, because a half-set
 * recurrence reads as CLOSED everywhere downstream — a save that kept one end
 * would take both boards dark while looking like it worked.
 */
export async function setScheduleRecurrence(r: ScheduleRecurrence): Promise<ScheduleRecurrence> {
  const entries = [r.openDay, r.openTime, r.closeDay, r.closeTime];
  const clearing = entries.every((v) => v == null || v === '');

  if (!clearing) {
    if (entries.some((v) => v == null || v === '')) {
      throw new Error('Set an opening day and time and a closing day and time — a half-set schedule closes both boards.');
    }
    for (const [label, day] of [['Opening', r.openDay], ['Closing', r.closeDay]] as const) {
      if (!Number.isInteger(day) || (day as number) < 0 || (day as number) > 6) {
        throw new Error(`${label} day must be a day of the week.`);
      }
    }
    for (const [label, time] of [['Opening', r.openTime], ['Closing', r.closeTime]] as const) {
      if (!TIME.test(time as string)) {
        throw new Error(`${label} time must be a 24-hour time such as 20:00.`);
      }
    }
  }

  const db = await getDb();
  // All four move together or none does, for the same reason a half-set
  // recurrence is refused above: a write that failed halfway would close both
  // boards as a side effect of an error the admin sees as "nothing applied".
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
    await write(SCHEDULE_KEY.openDay, clearing ? null : String(r.openDay));
    await write(SCHEDULE_KEY.openTime, clearing ? null : r.openTime);
    await write(SCHEDULE_KEY.closeDay, clearing ? null : String(r.closeDay));
    await write(SCHEDULE_KEY.closeTime, clearing ? null : r.closeTime);
  });
  return getScheduleRecurrence();
}

/**
 * The instant a pause runs until, or null when the boards are not paused.
 *
 * A pause is the one instruction editing the recurrence cannot express: take
 * THIS cycle dark and let the next one open on schedule as usual. An
 * unparseable value reads as "not paused" — the opposite of how a missing
 * schedule is treated, and deliberately so: failing closed on a corrupt pause
 * would keep the storefront dark indefinitely with nothing on screen to say why.
 */
export async function getSchedulePausedUntil(): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.key, PAUSED_KEY));
  const ms = row?.value ? Date.parse(row.value) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export async function setSchedulePausedUntil(until: string | null): Promise<string | null> {
  const db = await getDb();
  if (until == null) {
    await db.delete(settings).where(eq(settings.key, PAUSED_KEY));
    return null;
  }
  const ms = Date.parse(until);
  if (!Number.isFinite(ms)) throw new Error(`Not a valid date/time: ${until}`);
  const value = new Date(ms).toISOString();
  await db.insert(settings)
    .values({ key: PAUSED_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  return getSchedulePausedUntil();
}

/**
 * The cycle both boards are trading in right now, or null when they are closed.
 *
 * The one question every gated route, server component and checkout asks, so
 * none of them can answer it differently — and the source of the cycle key a
 * packing fee is charged against.
 */
export async function getCurrentCycle(now: Date = new Date()): Promise<Cycle | null> {
  const cycle = cycleAt(await getScheduleRecurrence(), now);
  if (!cycle) return null;
  const pausedUntil = await getSchedulePausedUntil();
  if (pausedUntil && now.getTime() < Date.parse(pausedUntil)) return null;
  return cycle;
}

/** Whether both boards are live right now. */
export async function isGroupBuyOpenNow(now: Date = new Date()): Promise<boolean> {
  return (await getCurrentCycle(now)) !== null;
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

import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import {
  getCurrentCycle, getMoqPageEnabled, getPackingFees,
  getSchedulePausedUntil, getScheduleRecurrence, setMoqPageEnabled,
  setPackingFees, setSchedulePausedUntil, setScheduleRecurrence,
} from '@/lib/settings';
import { nextCycle } from '@/lib/schedule-recurrence';

const feeSchema = z.number().nonnegative().finite();

// The shared Group Buy + Hatian schedule. Validated here rather than only in
// setScheduleRecurrence so a bad schedule is a 400 the admin form can show, not
// a 500 — and, because the whole body is parsed before anything is written, a
// rejected schedule leaves the previous one untouched. An admin's typo must
// never be able to take both boards down as a side effect.
const daySchema = z.number().int().min(0).max(6).nullable();
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be a 24-hour time such as 20:00').nullable();

const recurrenceSchema = z.object({
  openDay: daySchema,
  openTime: timeSchema,
  closeDay: daySchema,
  closeTime: timeSchema,
}).refine(
  // All four or none. Clearing every field is how the schedule is unset;
  // clearing some of it is a half-set schedule, which closes both boards.
  (s) => {
    const set = [s.openDay, s.openTime, s.closeDay, s.closeTime].filter((v) => v != null).length;
    return set === 0 || set === 4;
  },
  { message: 'Set an opening day and time and a closing day and time, or clear all four.' },
);

const instantSchema = z.string()
  .refine((v) => Number.isFinite(Date.parse(v)), 'must be a valid date and time')
  .nullable();

const patchSchema = z.object({
  packingFees: z.object({
    solo: feeSchema.optional(),
    kahati: feeSchema.optional(),
    group_buy: feeSchema.optional(),
    moq: feeSchema.optional(),
  }).optional(),
  moqPageEnabled: z.boolean().optional(),
  scheduleRecurrence: recurrenceSchema.optional(),
  schedulePausedUntil: instantSchema.optional(),
});

async function currentSettings() {
  const recurrence = await getScheduleRecurrence();
  const now = new Date();
  return {
    packingFees: await getPackingFees(),
    moqPageEnabled: await getMoqPageEnabled(),
    scheduleRecurrence: recurrence,
    schedulePausedUntil: await getSchedulePausedUntil(),
    // The instants the four fields actually resolve to — the running cycle, or
    // the next one when the boards are dark. Without this the admin cannot
    // check "Wednesday to Wednesday" against anything until customers either
    // can or cannot reach the boards.
    scheduleCycle: (await getCurrentCycle(now)) ?? nextCycle(recurrence, now),
  };
}

export const GET = handler(async () => {
  await requireAdmin();
  return ok(await currentSettings());
});

export const PATCH = handler(async (req: Request) => {
  await requireAdmin();
  const body = await req.json();
  const { packingFees, moqPageEnabled, scheduleRecurrence } =
    patchSchema.parse(body);
  if (packingFees) await setPackingFees(packingFees);
  if (moqPageEnabled != null) await setMoqPageEnabled(moqPageEnabled);
  // An all-null recurrence is a real instruction (clear the schedule), so this
  // checks for the key's presence rather than its truthiness.
  if (scheduleRecurrence != null) await setScheduleRecurrence(scheduleRecurrence);
  // A null pause is likewise a real instruction (lift the pause), which zod
  // cannot distinguish from an absent key on its own.
  if ('schedulePausedUntil' in body) {
    await setSchedulePausedUntil(patchSchema.parse(body).schedulePausedUntil ?? null);
  }
  return ok(await currentSettings());
});

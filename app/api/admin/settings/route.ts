import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import {
  getCurrentCycle, getKahatiDownpaymentPolicy, getMoqPageEnabled, getPackingFees,
  getSchedulePausedUntil, getScheduleRecurrence, setKahatiDownpaymentPolicy, setMoqPageEnabled,
  setPackingFees, setSchedulePausedUntil, setScheduleRecurrence,
} from '@/lib/settings';
import { nextCycle } from '@/lib/schedule-recurrence';
import { KAHATI_DOWNPAYMENT_MODES } from '@/lib/kahati-downpayment';

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

// The hatian downpayment. Validated here so a bad figure is a 400 the form can
// show; setKahatiDownpaymentPolicy re-checks the cross-field rules (a fixed
// policy needs a non-zero amount, a percent one a figure inside 0-100) that a
// per-field schema cannot express.
const downpaymentSchema = z.object({
  mode: z.enum(KAHATI_DOWNPAYMENT_MODES),
  amountPhp: z.number().nonnegative().finite(),
  percent: z.number().min(0).max(100).finite(),
  refundable: z.boolean(),
  policyNote: z.string().max(500).nullable(),
})
  // The cross-field rules a per-field schema cannot express, restated here so
  // they are refused as a ZodError -> 400 the form renders. Left to
  // setKahatiDownpaymentPolicy alone they surface as a plain Error, which
  // handler() answers with a generic 500 — an admin who typed 0 would be told
  // "Something went wrong" instead of what to type instead.
  .refine((p) => p.mode !== 'fixed' || p.amountPhp > 0, {
    message: 'A fixed downpayment must be more than zero — pick the packing-fee rule to collect only the fee.',
    path: ['amountPhp'],
  })
  .refine((p) => p.mode !== 'percent' || (p.percent > 0 && p.percent <= 100), {
    message: 'Downpayment percent must be more than zero and at most 100.',
    path: ['percent'],
  });

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
  kahatiDownpayment: downpaymentSchema.optional(),
});

async function currentSettings() {
  const recurrence = await getScheduleRecurrence();
  const now = new Date();
  return {
    packingFees: await getPackingFees(),
    kahatiDownpayment: await getKahatiDownpaymentPolicy(),
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
  const { packingFees, moqPageEnabled, scheduleRecurrence, kahatiDownpayment } =
    patchSchema.parse(body);
  if (packingFees) await setPackingFees(packingFees);
  if (kahatiDownpayment) await setKahatiDownpaymentPolicy(kahatiDownpayment);
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

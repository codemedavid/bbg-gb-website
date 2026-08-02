import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import {
  getGroupBuySchedule, getKahatiDownpayment, getMoqPageEnabled, getPackingFees,
  setGroupBuySchedule, setKahatiDownpayment, setMoqPageEnabled, setPackingFees,
} from '@/lib/settings';

const feeSchema = z.number().nonnegative().finite();

// The shared Group Buy + Hatian window. Validated here rather than only in
// setGroupBuySchedule so a bad window is a 400 the admin form can show, not a
// 500 — and, because the whole body is parsed before anything is written, a
// rejected window leaves the previous one untouched. An admin's typo must never
// be able to take both boards down as a side effect.
const instantSchema = z.string()
  .refine((v) => Number.isFinite(Date.parse(v)), 'must be a valid date and time')
  .nullable();

const scheduleSchema = z.object({
  opensAt: instantSchema,
  closesAt: instantSchema,
}).refine(
  // Only a fully-specified window is ordered; clearing one end is how the
  // schedule is unset, not a mistake.
  (s) => !(s.opensAt && s.closesAt) || Date.parse(s.opensAt) < Date.parse(s.closesAt),
  { message: 'The schedule must close after it opens.' },
);

const patchSchema = z.object({
  packingFees: z.object({
    solo: feeSchema.optional(),
    kahati: feeSchema.optional(),
    group_buy: feeSchema.optional(),
    moq: feeSchema.optional(),
  }).optional(),
  kahatiDownpayment: feeSchema.optional(),
  moqPageEnabled: z.boolean().optional(),
  groupBuySchedule: scheduleSchema.optional(),
});

async function currentSettings() {
  return {
    packingFees: await getPackingFees(),
    kahatiDownpayment: await getKahatiDownpayment(),
    moqPageEnabled: await getMoqPageEnabled(),
    groupBuySchedule: await getGroupBuySchedule(),
  };
}

export const GET = handler(async () => {
  await requireAdmin();
  return ok(await currentSettings());
});

export const PATCH = handler(async (req: Request) => {
  await requireAdmin();
  const { packingFees, kahatiDownpayment, moqPageEnabled, groupBuySchedule } =
    patchSchema.parse(await req.json());
  if (packingFees) await setPackingFees(packingFees);
  if (kahatiDownpayment != null) await setKahatiDownpayment(kahatiDownpayment);
  if (moqPageEnabled != null) await setMoqPageEnabled(moqPageEnabled);
  // An all-null window is a real instruction (clear the schedule), so this
  // checks for the key's presence rather than its truthiness.
  if (groupBuySchedule != null) await setGroupBuySchedule(groupBuySchedule);
  return ok(await currentSettings());
});

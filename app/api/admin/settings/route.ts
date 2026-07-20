import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import {
  getKahatiDownpayment, getMoqPageEnabled, getPackingFees,
  setKahatiDownpayment, setMoqPageEnabled, setPackingFees,
} from '@/lib/settings';

const feeSchema = z.number().nonnegative().finite();
const patchSchema = z.object({
  packingFees: z.object({
    solo: feeSchema.optional(),
    kahati: feeSchema.optional(),
    group_buy: feeSchema.optional(),
    moq: feeSchema.optional(),
  }).optional(),
  kahatiDownpayment: feeSchema.optional(),
  moqPageEnabled: z.boolean().optional(),
});

async function currentSettings() {
  return {
    packingFees: await getPackingFees(),
    kahatiDownpayment: await getKahatiDownpayment(),
    moqPageEnabled: await getMoqPageEnabled(),
  };
}

export const GET = handler(async () => {
  await requireAdmin();
  return ok(await currentSettings());
});

export const PATCH = handler(async (req: Request) => {
  await requireAdmin();
  const { packingFees, kahatiDownpayment, moqPageEnabled } = patchSchema.parse(await req.json());
  if (packingFees) await setPackingFees(packingFees);
  if (kahatiDownpayment != null) await setKahatiDownpayment(kahatiDownpayment);
  if (moqPageEnabled != null) await setMoqPageEnabled(moqPageEnabled);
  return ok(await currentSettings());
});

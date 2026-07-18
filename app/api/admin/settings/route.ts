import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getKahatiDownpayment, getPackingFees, setKahatiDownpayment, setPackingFees } from '@/lib/settings';

const feeSchema = z.number().nonnegative().finite();
const patchSchema = z.object({
  packingFees: z.object({
    solo: feeSchema.optional(),
    kahati: feeSchema.optional(),
    group_buy: feeSchema.optional(),
  }).optional(),
  kahatiDownpayment: feeSchema.optional(),
});

async function currentSettings() {
  return {
    packingFees: await getPackingFees(),
    kahatiDownpayment: await getKahatiDownpayment(),
  };
}

export const GET = handler(async () => {
  await requireAdmin();
  return ok(await currentSettings());
});

export const PATCH = handler(async (req: Request) => {
  await requireAdmin();
  const { packingFees, kahatiDownpayment } = patchSchema.parse(await req.json());
  if (packingFees) await setPackingFees(packingFees);
  if (kahatiDownpayment != null) await setKahatiDownpayment(kahatiDownpayment);
  return ok(await currentSettings());
});

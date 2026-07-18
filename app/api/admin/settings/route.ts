import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getPackingFees, setPackingFees } from '@/lib/settings';

const feeSchema = z.number().nonnegative().finite();
const patchSchema = z.object({
  packingFees: z.object({
    solo: feeSchema.optional(),
    kahati: feeSchema.optional(),
    group_buy: feeSchema.optional(),
  }),
});

export const GET = handler(async () => {
  await requireAdmin();
  return ok({ packingFees: await getPackingFees() });
});

export const PATCH = handler(async (req: Request) => {
  await requireAdmin();
  const { packingFees } = patchSchema.parse(await req.json());
  return ok({ packingFees: await setPackingFees(packingFees) });
});

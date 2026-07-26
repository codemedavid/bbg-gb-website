import { getDb } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession } from '@/lib/session';
import { quoteSettlement } from '@/lib/settlement-server';

// Customer: what the final checkout would cost right now — every completed
// hatian order still owing a balance, and the ONE packing fee that settles them
// all. Quoted by the same code that bills, so the figure shown is the figure
// charged.
export const GET = handler(async () => {
  const session = await requireSession();
  const quote = await quoteSettlement(await getDb(), session.sub);
  return ok(quote);
});

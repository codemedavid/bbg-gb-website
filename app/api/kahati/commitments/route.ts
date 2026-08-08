import { getDb } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession } from '@/lib/session';
import { getCurrentCycle } from '@/lib/settings';
import { cycleKeyOf } from '@/lib/schedule-recurrence';
import { listKahatiCommitments } from '@/lib/kahati-commitment-server';
import { summarizeKahatiCommitments } from '@/lib/kahati-commitment';
import { listCyclePayments } from '@/lib/packing-cycle-server';
import { hasPaidPackingFeeThisCycle } from '@/lib/packing-cycle';

// Customer: the kahati commitments they already hold, and whether this cycle's
// packing fee is already paid. Checkout reads this to decide whether to collect
// anything at all — answered by the same query the checkout route itself uses,
// so the screen and the charge cannot disagree.
export const GET = handler(async () => {
  const session = await requireSession();
  const db = await getDb();
  const commitments = await listKahatiCommitments(db, session.sub);
  const cycle = await getCurrentCycle();
  const payments = await listCyclePayments(db, session.sub, cycle ? cycleKeyOf(cycle) : null);
  return ok({
    commitments,
    summary: summarizeKahatiCommitments(commitments),
    paidThisCycle: hasPaidPackingFeeThisCycle(payments),
  });
});

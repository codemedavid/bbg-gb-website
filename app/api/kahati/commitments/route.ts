import { getDb } from '@/lib/db';
import { ok, handler } from '@/lib/api-response';
import { requireSession } from '@/lib/session';
import { listKahatiCommitments } from '@/lib/kahati-commitment-server';
import { hasOpenKahatiCommitment, summarizeKahatiCommitments } from '@/lib/kahati-commitment';

// Customer: the kahati commitments they already hold, and whether that means
// the reservation downpayment is already covered. Checkout reads this to decide
// whether to collect anything at all — answered by the same query the checkout
// route itself uses, so the screen and the charge cannot disagree.
export const GET = handler(async () => {
  const session = await requireSession();
  const commitments = await listKahatiCommitments(await getDb(), session.sub);
  return ok({
    commitments,
    summary: summarizeKahatiCommitments(commitments),
    downpaymentWaived: hasOpenKahatiCommitment(commitments),
  });
});

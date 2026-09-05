import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb } from '@/lib/db';
import { openPasaloStage } from '@/lib/pasalo-server';

// Admin: end Kahati and open Pasalo (Bunuan) across the board.
//
// The counterpart to POST /api/admin/groupbuys/cycle, and deliberately a
// SEPARATE control rather than a change to it. "Start a new cycle" seals every
// joined counter and opens a successor — the right move when the board is
// simply moving on. This one is the move when the board has counters that fell
// short: they go to Pasalo and get one more window instead of being cancelled
// and refunded four vials from the line.
//
// Every counter from 1 vial to one short of full enters, the already-qualified
// 7-9 included — those batches are going ahead regardless, and leaving them
// sellable is margin that would otherwise be thrown away. Counters nobody
// joined keep running; full ones have nothing left to sell. Both come back in
// the response, because an admin pressing this needs to see what it did NOT do.
//
// Not gated behind the trading window: this is a control that ENDS a stage, and
// an admin has to reach it whether the storefront is open or shut.
const bodySchema = z.object({
  // The Pasalo deadline shown to customers. Optional and, on its own, not a
  // decision: passing it stops new commitments once it elapses, but what
  // happens to anybody's money is settled by POST ./close. A stage with no
  // deadline simply runs until the admin closes it.
  closesAt: z.string().datetime().nullable().optional(),
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  // An empty body is a valid request — "open Pasalo, no deadline yet" — so a
  // missing or unparseable body must not be a 400.
  const raw = await req.json().catch(() => ({}));
  const { closesAt } = bodySchema.parse(raw ?? {});

  const db = await getDb();
  const result = await openPasaloStage(db, {
    pasaloClosesAt: closesAt ? new Date(closesAt) : null,
  });

  return ok({
    opened: result.opened.length,
    counterIds: result.opened,
    skippedEmpty: result.skippedEmpty,
    skippedFull: result.skippedFull,
  });
});

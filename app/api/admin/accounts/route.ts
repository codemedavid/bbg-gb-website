import { z } from 'zod';
import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { listAccounts } from '@/lib/accounts';

// The most PII-dense payload in the shop — every customer's name, email and
// phone in one response — so the admin gate is here on the server, not only on
// the screen that calls it.
const query = z.object({
  search: z.string().max(120).optional(),
  // Parsed rather than passed through: an unrecognised role must be a 400, not
  // a filter that quietly matches nothing and reads as "no accounts".
  role: z.enum(['customer', 'admin']).optional(),
});

export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const url = new URL(req.url);
  const { search, role } = query.parse({
    search: url.searchParams.get('search') ?? undefined,
    role: url.searchParams.get('role') ?? undefined,
  });
  return ok(await listAccounts({ search, role }));
});

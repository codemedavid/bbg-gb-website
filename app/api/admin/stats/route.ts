import { requireAdmin, ApiError } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { dashboardStats } from '@/lib/analytics';
import { statsRangeError } from '@/lib/analytics-range';

// GET /api/admin/stats[?from=YYYY-MM-DD&to=YYYY-MM-DD]
// Without the pair, the standing week/month/all-time dashboard. With it, the
// period figures narrow to that inclusive Manila-calendar range.
export const GET = handler(async (req: Request) => {
  await requireAdmin();
  const params = new URL(req.url).searchParams;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  if (!from && !to) return ok(await dashboardStats());

  const problem = statsRangeError(from, to);
  if (problem) throw new ApiError(400, problem);
  return ok(await dashboardStats({ from, to }));
});

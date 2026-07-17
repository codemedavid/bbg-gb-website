import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { dashboardStats } from '@/lib/analytics';

export const GET = handler(async () => {
  await requireAdmin();
  return ok(await dashboardStats());
});

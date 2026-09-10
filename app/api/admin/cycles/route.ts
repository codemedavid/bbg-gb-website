import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, groupBuys, moqCampaigns, orders } from '@/lib/db';
import { getLatestCycleKey } from '@/lib/settings';
import { summarizeCycles, cycleLabel } from '@/lib/cycle-archive';

// Admin: every trading cycle the shop has run, newest first, with what each
// holds. The archive's index page.
//
// Read off the rows themselves — orders.cycle_key, group_buys.cycle_key,
// moq_campaigns.cycle_key — never off the calendar: a cycle is named by the
// instant it opened, and that name survives the admin moving the schedule.
// Rows from before cycles were named belong to no cycle and are not listed.
export const GET = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  const [orderRows, kahatiRows, campaignRows, current] = await Promise.all([
    db.select({ cycleKey: orders.cycleKey, status: orders.status }).from(orders),
    db.select({ cycleKey: groupBuys.cycleKey, status: groupBuys.status, claimedSlots: groupBuys.claimedSlots }).from(groupBuys),
    db.select({ cycleKey: moqCampaigns.cycleKey, status: moqCampaigns.status, committed: moqCampaigns.committed }).from(moqCampaigns),
    getLatestCycleKey(),
  ]);
  const cycles = summarizeCycles({ orders: orderRows, kahatis: kahatiRows, campaigns: campaignRows });
  return ok(cycles.map((c) => ({ ...c, label: cycleLabel(c.cycleKey), current: c.cycleKey === current })));
});

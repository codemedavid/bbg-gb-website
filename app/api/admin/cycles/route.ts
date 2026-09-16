import { requireAdmin } from '@/lib/session';
import { ok, handler } from '@/lib/api-response';
import { getDb, groupBuys, moqCampaigns, orders } from '@/lib/db';
import { getLatestCycleKey } from '@/lib/settings';
import { summarizeCycles, cycleLabel } from '@/lib/cycle-archive';
import { startCycleNow } from '@/lib/cycle-start-server';

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

// Admin: start a new cycle NOW, on both boards, overriding the schedule.
//
// The one control behind the "Start new cycle" buttons on the hatian and the
// campaigns screens. It ends every joined listing (opening its successor),
// brings the empties forward from the catalog, files everything under the new
// cycle — and opens the boards to customers at once, lifting any pause. The
// schedule takes over again at its next opening. See lib/cycle-start-server.ts.
//
// Every count comes back so the admin sees what the cycle did rather than
// infer it. Customer order statuses are neither read nor written: closing a
// listing is a board decision, and reconciling the orders inside it is the
// admin's, on the orders screen.
//
// Deliberately not gated behind the trading window: this is the control that
// OPENS one.
export const POST = handler(async () => {
  await requireAdmin();
  const db = await getDb();
  const { cycle, kahati, campaigns } = await startCycleNow(db);
  return ok({
    cycle,
    kahati: {
      coverage: kahati.coverage,
      rolled: kahati.rolled.length,
      skippedEmpty: kahati.skippedEmpty,
      refreshed: kahati.refreshed,
      // Counters an expiry has already condemned: the sweep owes their
      // participants a refund, so the cycle steps around them rather than
      // sealing that refund away.
      leftForCancellation: kahati.leftForCancellation,
      failed: kahati.failed,
      counters: kahati.rolled.map((r) => ({
        id: r.opened.id,
        name: r.opened.name,
        endedCounterId: r.sealed.id,
        endedWithVials: r.sealed.claimedSlots,
      })),
    },
    campaigns: {
      coverage: campaigns.coverage,
      rolled: campaigns.rolled.length,
      skippedEmpty: campaigns.skippedEmpty,
      refreshed: campaigns.refreshed,
      reopened: campaigns.reopened,
      batches: campaigns.rolled.map((r) => ({
        seriesId: r.opened.seriesId,
        name: r.opened.name,
        endedBatchNo: r.sealed.batchNo,
        endedWithKits: r.sealed.committed,
        openedBatchNo: r.opened.batchNo,
      })),
    },
  });
});

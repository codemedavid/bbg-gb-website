// Scheduled opening, end to end on both boards.
//
// A row with a future open date is created 'scheduled': off the storefront,
// joinable by nobody. There is still no scheduler in this app, so the flip to
// 'open' rides the same lazy sweeps that already resolve deadlines — whoever
// reads the board first performs it. These tests pin that the flip happens, that
// it happens exactly once, and that a scheduled row is genuinely unreachable
// until it does.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';

const session = { current: null as { sub: string; role: 'customer' | 'admin'; email: string } | null };
vi.mock('@/lib/session', () => {
  class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  }
  const requireSession = async () => {
    if (!session.current) throw new ApiError(401, 'Authentication required.');
    return session.current;
  };
  const requireAdmin = async () => {
    const s = await requireSession();
    if (s.role !== 'admin') throw new ApiError(403, 'Admin only.');
    return s;
  };
  return { ApiError, getSession: async () => session.current, requireSession, requireAdmin };
});

const { sweepKahatis } = await import('./kahati-server');
const { openDueBatches } = await import('./moq-batch-server');
const { GET: listKahatis } = await import('@/app/api/groupbuys/route');
const { GET: listCampaigns } = await import('@/app/api/campaigns/route');
const { getDb, groupBuys, moqCampaigns } = await import('@/lib/db');
const { resetDb, makeUser, openBoards, closeBoards } = await import('@/lib/test/harness');

const HOUR = 60 * 60 * 1000;
// Both boards now sit behind one storefront window (lib/schedule-gate.ts). These
// tests are about the OTHER schedule — the per-campaign open date — so they run
// with the storefront window held open; the interaction between the two is
// pinned separately at the bottom of this file.
const openStorefront = () => openBoards();

const DAY = 24 * 60 * 60 * 1000;
const past = (ms = DAY) => new Date(Date.now() - ms);
const future = (ms = DAY) => new Date(Date.now() + ms);

// Written straight through drizzle rather than through the harness factories:
// these rows are the subject under test, so the test states every field that
// matters to the sweep instead of inheriting a default that could drift.
async function scheduledKahati(opensAt: Date | null, extra: Partial<typeof groupBuys.$inferInsert> = {}) {
  const db = await getDb();
  const [row] = await db.insert(groupBuys).values({
    name: 'Scheduled Kahati', pricePerKitPhp: '9000',
    totalSlots: 10, claimedSlots: 0, minVials: 1, repackFeePhp: '150',
    status: 'scheduled', opensAt, ...extra,
  }).returning();
  return row;
}

async function scheduledCampaign(opensAt: Date | null, extra: Partial<typeof moqCampaigns.$inferInsert> = {}) {
  const db = await getDb();
  const id = crypto.randomUUID();
  const [row] = await db.insert(moqCampaigns).values({
    id, seriesId: id, batchNo: 1, name: 'Scheduled Campaign', pricePerKitPhp: '10400',
    moq: 10, committed: 0, status: 'scheduled', opensAt, ...extra,
  }).returning();
  return row;
}

const statusOf = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(groupBuys).where(eq(groupBuys.id, id));
  return row.status;
};

const campaignStatusOf = async (id: string) => {
  const db = await getDb();
  const [row] = await db.select().from(moqCampaigns).where(eq(moqCampaigns.id, id));
  return row.status;
};

beforeEach(async () => {
  await resetDb();
  session.current = null;
  await openStorefront();
});

describe('Kahati scheduled opening', () => {
  it('opens a counter whose open date has passed', async () => {
    const db = await getDb();
    const kahati = await scheduledKahati(past());

    const result = await sweepKahatis(db);

    expect(result.opened).toEqual([kahati.id]);
    expect(await statusOf(kahati.id)).toBe('open');
  });

  it('leaves a counter whose open date is still ahead', async () => {
    const db = await getDb();
    const kahati = await scheduledKahati(future());

    const result = await sweepKahatis(db);

    expect(result.opened).toEqual([]);
    expect(await statusOf(kahati.id)).toBe('scheduled');
  });

  // The sweep runs on every board read, so "opened" has to mean "this sweep
  // opened it" — not "it is open now". A second sweep reporting the same id
  // would double-count every counter on every page load.
  it('reports an opening exactly once', async () => {
    const db = await getDb();
    await scheduledKahati(past());

    await sweepKahatis(db);
    const second = await sweepKahatis(db);

    expect(second.opened).toEqual([]);
  });

  // A scheduled row with no open date has no moment to arrive. Leaving it
  // scheduled keeps it off the board; opening it would publish a counter the
  // admin never scheduled to publish.
  it('never opens a scheduled counter with no open date', async () => {
    const db = await getDb();
    const kahati = await scheduledKahati(null);

    await sweepKahatis(db);

    expect(await statusOf(kahati.id)).toBe('scheduled');
  });

  // Opening is swept BEFORE expiry and fills, so a counter whose whole window
  // elapsed between two board reads resolves in one pass rather than sitting
  // open-but-expired until somebody loads the page again.
  it('opens and then resolves a counter whose window has fully elapsed', async () => {
    const db = await getDb();
    const kahati = await scheduledKahati(past(2 * DAY), { closesAt: past(DAY) });

    const result = await sweepKahatis(db);

    expect(result.opened).toEqual([kahati.id]);
    expect(result.cancelled).toEqual([kahati.id]);
    expect(await statusOf(kahati.id)).toBe('cancelled');
  });

  it('keeps a scheduled counter off the public board until it opens', async () => {
    const kahati = await scheduledKahati(future());

    const before = await (await listKahatis()).json();
    expect(before.data.map((g: { id: string }) => g.id)).not.toContain(kahati.id);

    const db = await getDb();
    await db.update(groupBuys).set({ opensAt: past() }).where(eq(groupBuys.id, kahati.id));

    const after = await (await listKahatis()).json();
    expect(after.data.map((g: { id: string }) => g.id)).toContain(kahati.id);
  });
});

describe('Group Buy scheduled opening', () => {
  it('opens a batch whose open date has passed', async () => {
    const db = await getDb();
    const campaign = await scheduledCampaign(past());

    const opened = await openDueBatches(db);

    expect(opened).toEqual([campaign.id]);
    expect(await campaignStatusOf(campaign.id)).toBe('open');
  });

  it('leaves a batch whose open date is still ahead', async () => {
    const db = await getDb();
    const campaign = await scheduledCampaign(future());

    expect(await openDueBatches(db)).toEqual([]);
    expect(await campaignStatusOf(campaign.id)).toBe('scheduled');
  });

  it('never opens a scheduled batch with no open date', async () => {
    const db = await getDb();
    const campaign = await scheduledCampaign(null);

    await openDueBatches(db);

    expect(await campaignStatusOf(campaign.id)).toBe('scheduled');
  });

  // Reading the board is what opens the due batches — the same contract the
  // Kahati board has had all along.
  it('opens due batches when the board is listed', async () => {
    const campaign = await scheduledCampaign(past());

    const body = await (await listCampaigns()).json();

    expect(await campaignStatusOf(campaign.id)).toBe('open');
    expect(body.data.map((c: { id: string }) => c.id)).toContain(campaign.id);
  });

  // The admin and the storefront read the same endpoint, so the row has to be
  // hidden by audience rather than by route: an unannounced campaign's name and
  // price must not be fetchable before it opens, and the admin still has to see
  // what they scheduled.
  it('hides a scheduled batch from the public board', async () => {
    const campaign = await scheduledCampaign(future());

    const body = await (await listCampaigns()).json();

    expect(body.data.map((c: { id: string }) => c.id)).not.toContain(campaign.id);
  });

  // The two schedules compose: the storefront window decides whether the board
  // is readable at all, and the per-campaign open date decides which batches are
  // on it. A due batch therefore does NOT open while the storefront is shut —
  // the sweep rides a board read, and there are no board reads. It opens on the
  // first read after the window reopens, which is the first moment anyone could
  // have seen it anyway.
  it('leaves a due batch closed while the storefront window is shut', async () => {
    await closeBoards();
    const campaign = await scheduledCampaign(past());

    await listCampaigns();

    expect(await campaignStatusOf(campaign.id)).toBe('scheduled');

    await openStorefront();
    await listCampaigns();

    expect(await campaignStatusOf(campaign.id)).toBe('open');
  });

  it('shows a scheduled batch to an admin', async () => {
    const campaign = await scheduledCampaign(future());
    const admin = await makeUser({ role: 'admin' });
    session.current = { sub: admin.id, role: 'admin', email: admin.email };

    const body = await (await listCampaigns()).json();

    expect(body.data.map((c: { id: string }) => c.id)).toContain(campaign.id);
  });
});

// End-to-end QA driver for board COVERAGE: is every product the shop sells
// actually on the two boards that sell it?
//
// The sibling of scripts/qa/e2e-groupbuy.ts, and deliberately the same shape —
// real HTTP against a running dev server, not vitest. The suite calls route
// handlers in-process against a fresh in-memory database, which cannot catch
// the failure this driver exists for: the boards reconcile ON READ
// (lib/kahati-seed-bulk.ts, lib/campaign-seed-bulk.ts), so "the products are
// there" is a claim about what a real GET returns from a PERSISTED database,
// after Next has served it, twice.
//
// It asserts three things, in order of how they actually broke:
//
//   1. Coverage    — every flagged, listed product has a live listing on both
//                    boards. This is the bug: the switches were ticked by hand,
//                    most never were, and the boards carried a fraction of the
//                    catalog.
//   2. Joinability — a listing that exists but cannot be joined is not
//                    coverage. Every seeded counter must be open, priced, under
//                    its cap, and carry a floor somebody can meet.
//   3. Idempotency — reading a board opens what is missing, so reading it twice
//                    must NOT open anything a second time. A seeder that is not
//                    idempotent turns every page load into another duplicate
//                    counter, which is worse than the gap it closed.
//
//   npx tsx scripts/qa/e2e-board-coverage.ts
//   QA_BASE_URL=http://localhost:3001 npx tsx scripts/qa/e2e-board-coverage.ts
// `export {}` makes this file a MODULE. Without it TypeScript treats a script
// with no imports as global scope, and every top-level name here would collide
// with the identically-named ones in scripts/qa/e2e-groupbuy.ts.
export {};

const BASE = process.env.QA_BASE_URL || 'http://localhost:3001';
const EMAIL = process.env.QA_ADMIN_EMAIL || 'admin@bbgpeptides.ph';
const PASSWORD = process.env.QA_ADMIN_PASSWORD || 'password123';

// Statuses that mean a product is represented on its board. Mirrors
// LIVE_STATUSES in the two seeders — a product is "covered" exactly when the
// seeder would decline to open it another listing.
const LIVE_KAHATI = new Set(['open', 'pasalo']);
const LIVE_CAMPAIGN = new Set(['open', 'approved', 'completed']);

let failures = 0;

function check(name: string, expected: string, actual: string, pass: boolean) {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  console.log(`     expected: ${expected}`);
  console.log(`     actual  : ${actual}`);
}

function makeClient() {
  const jar = new Map<string, string>();
  return async function call(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };
}

const listingName = (p: { name: string; spec: string }) => `${p.name} ${p.spec}`.trim();

async function main() {
  console.log(`Target: ${BASE}\n`);
  const call = makeClient();

  const login = await call('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check('admin signs in',
    'HTTP 200 and role=admin',
    `HTTP ${login.status} role=${login.body?.data?.user?.role}`,
    login.status === 200 && login.body?.data?.user?.role === 'admin');
  if (login.status !== 200) {
    console.log('\nCannot continue without an admin session.');
    process.exit(1);
  }

  const products = (await call('/api/admin/products')).body?.data ?? [];
  const listed = products.filter((p: any) => p.isActive);
  const kahatiWanted = listed.filter((p: any) => p.isKahati);
  const groupBuyWanted = listed.filter((p: any) => p.isGroupBuy);
  console.log(`\nCatalog: ${products.length} products, ${listed.length} listed, `
    + `${kahatiWanted.length} flagged Kahati, ${groupBuyWanted.length} flagged Group Buy\n`);

  // ---- 1. Coverage -------------------------------------------------------
  const counters = (await call('/api/admin/groupbuys')).body?.data ?? [];
  const coveredByCounter = new Set(counters
    .filter((g: any) => LIVE_KAHATI.has(g.status) && g.productId)
    .map((g: any) => g.productId));
  const missingCounter = kahatiWanted.filter((p: any) => !coveredByCounter.has(p.id));
  check('every Kahati product has a live counter',
    `0 of ${kahatiWanted.length} missing`,
    missingCounter.length === 0 ? '0 missing'
      : `${missingCounter.length} missing: ${missingCounter.slice(0, 8).map(listingName).join(', ')}`,
    missingCounter.length === 0);

  const campaigns = (await call('/api/campaigns')).body?.data ?? [];
  const coveredByCampaign = new Set(campaigns
    .filter((c: any) => LIVE_CAMPAIGN.has(c.status))
    .flatMap((c: any) => (c.includedProducts ?? []).map((e: any) => e.productId)));
  const missingCampaign = groupBuyWanted.filter((p: any) => !coveredByCampaign.has(p.id));
  check('every Group Buy product is carried by a live batch',
    `0 of ${groupBuyWanted.length} missing`,
    missingCampaign.length === 0 ? '0 missing'
      : `${missingCampaign.length} missing: ${missingCampaign.slice(0, 8).map(listingName).join(', ')}`,
    missingCampaign.length === 0);

  // ---- 2. Joinability ----------------------------------------------------
  // A counter on the board that nobody can join is not coverage. Each of these
  // is a constraint the seeder is supposed to hold on the way in.
  const live = counters.filter((g: any) => LIVE_KAHATI.has(g.status));
  const unpriced = live.filter((g: any) => !(Number(g.pricePerKitPhp) > 0));
  check('no live counter is unpriced',
    '0 at ₱0 — a free kit on a public board',
    unpriced.length === 0 ? '0' : `${unpriced.length}: ${unpriced.slice(0, 5).map((g: any) => g.name).join(', ')}`,
    unpriced.length === 0);

  const overCap = live.filter((g: any) => g.claimedSlots > g.totalSlots);
  check('no live counter is claimed beyond its cap',
    '0 reading more vials than it holds',
    overCap.length === 0 ? '0' : `${overCap.length}: ${overCap.slice(0, 5).map((g: any) => `${g.name} ${g.claimedSlots}/${g.totalSlots}`).join(', ')}`,
    overCap.length === 0);

  const unjoinable = live.filter((g: any) => g.minVials > g.totalSlots);
  check('no live counter sets a floor above its own cap',
    '0 that would reject every commitment',
    unjoinable.length === 0 ? '0' : `${unjoinable.length}: ${unjoinable.slice(0, 5).map((g: any) => `${g.name} min ${g.minVials} > cap ${g.totalSlots}`).join(', ')}`,
    unjoinable.length === 0);

  const duplicates = Object.entries(
    live.filter((g: any) => g.productId).reduce((acc: Record<string, number>, g: any) => {
      acc[g.productId] = (acc[g.productId] ?? 0) + 1;
      return acc;
    }, {}),
  ).filter(([, n]) => (n as number) > 1);
  check('no product carries two live counters at once',
    '0 products listed twice — that splits its own demand',
    duplicates.length === 0 ? '0' : `${duplicates.length} products with 2+ counters`,
    duplicates.length === 0);

  // ---- 3. Idempotency ----------------------------------------------------
  // The reconcile runs on every read. Reading again must find nothing to do.
  const countersAgain = (await call('/api/admin/groupbuys')).body?.data ?? [];
  const campaignsAgain = (await call('/api/campaigns')).body?.data ?? [];
  check('re-reading the hatian board opens nothing further',
    `still ${counters.length} counters`,
    `${countersAgain.length} counters`,
    countersAgain.length === counters.length);
  check('re-reading the campaign board opens nothing further',
    `still ${campaigns.length} batches`,
    `${campaignsAgain.length} batches`,
    campaignsAgain.length === campaigns.length);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

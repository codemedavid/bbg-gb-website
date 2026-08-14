// End-to-end QA driver for the Group Buy flow, over real HTTP against a running
// dev server (see docs/testing/groupbuy-e2e-qa.md for the run recipe).
//
// Deliberately not a vitest file: the suite calls route handlers in-process with
// a fresh in-memory database per file. That cannot catch a defect that only
// appears when Next serves the route, when a cookie has to survive a redirect,
// or when two checkouts run against the SAME persisted database in sequence —
// which is precisely what the packing-fee waiver turns on.
const BASE = process.env.QA_BASE_URL || 'http://localhost:3177';

type Case = { phase: string; name: string; expected: string; actual: string; pass: boolean };
const results: Case[] = [];
let failures = 0;

function check(phase: string, name: string, expected: string, actual: string, pass: boolean) {
  results.push({ phase, name, expected, actual, pass });
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'} [${phase}] ${name}\n     expected: ${expected}\n     actual  : ${actual}`);
}

// ---- a fetch that keeps cookies, one jar per actor -------------------------
function makeClient() {
  const jar = new Map<string, string>();
  return async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
    const headers = new Headers(init.headers);
    if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const text = await res.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* HTML or empty */ }
    return { status: res.status, body };
  };
}

const json = (method: string, data: unknown): RequestInit => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
});

// The checkout route takes multipart with a proof image.
function checkoutForm(items: unknown, opts: { paymentMethod?: string; idempotencyKey?: string; withProof?: boolean } = {}) {
  const form = new FormData();
  form.set('items', JSON.stringify(items));
  form.set('shipName', 'QA Customer');
  form.set('shipPhone', '09171234567');
  form.set('shipAddress', '123 Mabini St, Manila');
  if (opts.paymentMethod) form.set('paymentMethod', opts.paymentMethod);
  if (opts.idempotencyKey) form.set('idempotencyKey', opts.idempotencyKey);
  if (opts.withProof !== false) {
    form.set('proof', new File([Buffer.from('qa-proof-image')], 'proof.png', { type: 'image/png' }));
  }
  return { method: 'POST', body: form } as RequestInit;
}

const num = (v: unknown) => Number(v ?? 0);
const stamp = Date.now();
const manilaToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const manilaWeekday = new Date(Date.now() + 8 * 3_600_000).getUTCDay();

async function main() {
  const admin = makeClient();
  const cust = makeClient();

  // ================= Phase 2 — Group Buy product selector ==================
  const login = await admin('/api/admin/login', json('POST', { email: 'admin@bbgpeptides.ph', password: 'password123' }));
  check('2', 'admin can sign in', '200', String(login.status), login.status === 200);

  // Seed data intentionally has no trading schedule. Put this isolated QA DB
  // inside a deterministic open window so the customer journey does not
  // depend on what weekday/time the suite happens to run.
  const schedule = await admin('/api/admin/settings', json('PATCH', {
    scheduleRecurrence: {
      openDay: (manilaWeekday + 6) % 7,
      openTime: '00:00',
      closeDay: (manilaWeekday + 1) % 7,
      closeTime: '23:59',
    },
    schedulePausedUntil: null,
  }));
  check('2', 'QA opens the shared Group Buy schedule', '200 with an active cycle',
    `${schedule.status} cycle=${JSON.stringify(schedule.body?.data?.scheduleCycle ?? null)}`,
    schedule.status === 200 && schedule.body?.data?.scheduleCycle != null);

  const prods = await admin('/api/admin/products');
  const products: any[] = prods.body?.data ?? [];
  check('2', 'product selector loads Product Management catalog', '200 with >0 products',
    `${prods.status} with ${products.length}`, prods.status === 200 && products.length > 0);

  const byId = new Set(products.map((p) => p.id));
  check('2', 'no product id appears twice in the selector', `${products.length} unique ids`,
    `${byId.size} unique ids`, byId.size === products.length);

  const nameSpec = products.map((p) => `${p.name.trim().toLowerCase()}|${p.spec.trim().toLowerCase()}`);
  const dupNameSpec = nameSpec.filter((k, i) => nameSpec.indexOf(k) !== i);
  check('2', 'no product is listed twice under the same name + spec', 'no duplicates',
    dupNameSpec.length ? `${dupNameSpec.length}: ${[...new Set(dupNameSpec)].join(', ')}` : 'no duplicates',
    dupNameSpec.length === 0);

  const codes = products.map((p) => p.code).filter(Boolean);
  const dupCodes = codes.filter((c, i) => codes.indexOf(c) !== i);
  check('2', 'no CAT/Code is shared by two products', 'no duplicate codes',
    dupCodes.length ? [...new Set(dupCodes)].join(', ') : 'no duplicate codes', dupCodes.length === 0);

  const badPrice = products.filter((p) => !(num(p.pricePhp) > 0));
  check('2', 'every selectable product carries a price', 'all priced',
    badPrice.length ? `${badPrice.length} unpriced: ${badPrice.slice(0, 5).map((p) => p.name).join(', ')}` : 'all priced',
    badPrice.length === 0);

  // Product Management is the full catalog; a campaign may contain only rows
  // whose independent Group Buy channel is enabled.
  const groupBuyProducts = products.filter((p) => p.isGroupBuy);
  check('2', 'campaign selector has Group Buy-enabled products', '>0 enabled products',
    `${groupBuyProducts.length} enabled`, groupBuyProducts.length > 0);

  // ========== Phase 3 — create a campaign with every enabled product ======
  const PRICE_PER_KIT = 10400;
  const PACKING_FEE = 300;
  const created = await admin('/api/campaigns', json('POST', {
    name: `QA Group Buy ${stamp}`,
    pricePerKitPhp: PRICE_PER_KIT,
    moq: 10,
    shippingPhp: PACKING_FEE,
    arrivalGroup: 'white_powder',
    description: 'E2E QA campaign',
    includedProducts: groupBuyProducts.map((p) => ({ productId: p.id, name: p.name, outOfStock: false })),
  }));
  const campaign = created.body?.data;
  check('3', 'campaign is created successfully', '201',
    `${created.status} ${created.status === 201 ? '' : JSON.stringify(created.body).slice(0, 300)}`, created.status === 201);
  if (!campaign) { report(); return; }

  check('3', 'every Group Buy-enabled product is linked to the campaign',
    `${groupBuyProducts.length} Group Buy-enabled products included`, `${campaign.includedProducts?.length ?? 0} included`,
    campaign.includedProducts?.length === groupBuyProducts.length);

  const linkedIds = new Set((campaign.includedProducts ?? []).map((p: any) => p.productId));
  check('3', 'no product is linked to the campaign twice',
    `${campaign.includedProducts?.length ?? 0} unique`, `${linkedIds.size} unique`,
    linkedIds.size === (campaign.includedProducts?.length ?? -1));

  check('3', 'pricing loads from the campaign as configured', `₱${PRICE_PER_KIT}/kit, fee ₱${PACKING_FEE}, MOQ 10`,
    `₱${num(campaign.pricePerKitPhp)}/kit, fee ₱${num(campaign.shippingPhp)}, MOQ ${campaign.moq}`,
    num(campaign.pricePerKitPhp) === PRICE_PER_KIT && num(campaign.shippingPhp) === PACKING_FEE && campaign.moq === 10);

  const publicList = await cust('/api/campaigns');
  const onBoard = (publicList.body?.data ?? []).find((c: any) => c.id === campaign.id);
  check('3', 'campaign appears on the customer group buy board', 'present and open',
    onBoard ? `present, status=${onBoard.status}` : 'absent', !!onBoard && onBoard.status === 'open');

  // ================= Phase 4 — customer ordering flow ======================
  const email = `qa.customer.${stamp}@example.com`;
  const reg = await cust('/api/auth/register', json('POST', {
    name: 'QA Customer', email, password: 'password123', phone: '09171234567', address: '123 Mabini St, Manila',
  }));
  check('4', 'test customer account is created', '200/201', String(reg.status), reg.status < 300);

  const pmList = await cust('/api/payment-methods');
  const pm = (pmList.body?.data ?? [])[0]?.label;

  // ---- First order -------------------------------------------------------
  const o1 = await cust('/api/orders', checkoutForm(
    [{ kind: 'moq_campaign', refId: campaign.id, qty: 1 }],
    { paymentMethod: pm, idempotencyKey: `qa-first-${stamp}` },
  ));
  check('4', 'first order is created successfully', '201',
    `${o1.status} ${o1.status === 201 ? '' : JSON.stringify(o1.body).slice(0, 300)}`, o1.status === 201);
  const first = o1.body?.data;
  if (!first) { report(); return; }

  check('4', 'first order is charged the packing fee exactly once', `₱${PACKING_FEE}`,
    `₱${num(first.totals.packingFee)}`, num(first.totals.packingFee) === PACKING_FEE);
  check('4', 'first order total = kit price + one packing fee', `₱${PRICE_PER_KIT + PACKING_FEE}`,
    `₱${num(first.totals.total)}`, num(first.totals.total) === PRICE_PER_KIT + PACKING_FEE);
  check('4', 'one checkout produces one group buy order', '1 order',
    `${first.orders.length} order(s)`, first.orders.length === 1);

  // ---- Second order, same customer, same group buy -----------------------
  const o2 = await cust('/api/orders', checkoutForm(
    [{ kind: 'moq_campaign', refId: campaign.id, qty: 2 }],
    { paymentMethod: pm, idempotencyKey: `qa-second-${stamp}` },
  ));
  check('4', 'second order in the same group buy is accepted', '201',
    `${o2.status} ${o2.status === 201 ? '' : JSON.stringify(o2.body).slice(0, 300)}`, o2.status === 201);
  const second = o2.body?.data;
  if (!second) { report(); return; }

  check('4', 'second order is NOT charged another packing fee', '₱0',
    `₱${num(second.totals.packingFee)}`, num(second.totals.packingFee) === 0);
  check('4', 'second order charges product cost only', `₱${PRICE_PER_KIT * 2}`,
    `₱${num(second.totals.total)}`, num(second.totals.total) === PRICE_PER_KIT * 2);

  // ---- Third order, to prove the waiver is not a one-off -----------------
  const o3 = await cust('/api/orders', checkoutForm(
    [{ kind: 'moq_campaign', refId: campaign.id, qty: 1 }],
    { paymentMethod: pm, idempotencyKey: `qa-third-${stamp}` },
  ));
  check('4', 'third order in the same group buy is still fee-free', '₱0',
    `₱${num(o3.body?.data?.totals?.packingFee)}`, num(o3.body?.data?.totals?.packingFee) === 0);

  // ---- A different group buy in the same cycle shares the one cycle fee ---
  const other = await admin('/api/campaigns', json('POST', {
    name: `QA Other Group Buy ${stamp}`, pricePerKitPhp: 8000, moq: 10, shippingPhp: PACKING_FEE,
    includedProducts: groupBuyProducts.slice(0, 3).map((p) => ({ productId: p.id, name: p.name, outOfStock: false })),
  }));
  const o4 = await cust('/api/orders', checkoutForm(
    [{ kind: 'moq_campaign', refId: other.body?.data?.id, qty: 1 }],
    { paymentMethod: pm, idempotencyKey: `qa-other-${stamp}` },
  ));
  check('4', 'a different group buy in the same cycle charges no second fee', '₱0',
    `₱${num(o4.body?.data?.totals?.packingFee)}`, num(o4.body?.data?.totals?.packingFee) === 0);

  // ---- Idempotency: a resubmitted checkout must not double-charge --------
  const replay = await cust('/api/orders', checkoutForm(
    [{ kind: 'moq_campaign', refId: campaign.id, qty: 1 }],
    { paymentMethod: pm, idempotencyKey: `qa-first-${stamp}` },
  ));
  check('4', 'resubmitting a checkout replays it instead of charging again',
    `same order ${first.orderNo}`, `${replay.body?.data?.orderNo}`,
    replay.body?.data?.orderNo === first.orderNo);

  // ================= Phase 5 — order aggregation ===========================
  const mine = await cust('/api/orders');
  const myOrders: any[] = mine.body?.data ?? [];
  const gbOrders = myOrders.filter((o) => o.buyType === 'group_buy');
  const thisSeries = gbOrders.filter((o) => (o.items ?? []).some((i: any) => i.nameSnapshot?.includes(`QA Group Buy ${stamp}`)));

  check('5', 'every group buy order appears in the customer order history', '4 group buy orders',
    `${gbOrders.length}`, gbOrders.length === 4);

  const feesInSeries = thisSeries.map((o) => num(o.packingFeePhp));
  const paidFees = feesInSeries.filter((f) => f > 0);
  check('5', 'exactly one packing fee across all orders in the same group buy', '1 fee charged',
    `${paidFees.length} charged: [${feesInSeries.join(', ')}]`, paidFees.length === 1);

  const totalFee = feesInSeries.reduce((a, b) => a + b, 0);
  check('5', 'total packing fee paid for the group buy equals one fee', `₱${PACKING_FEE}`,
    `₱${totalFee}`, totalFee === PACKING_FEE);

  const kits = thisSeries.flatMap((o) => o.items ?? []).reduce((s: number, i: any) => s + i.qty, 0);
  check('5', 'all committed kits are recorded against the group buy', '4 kits',
    `${kits} kits`, kits === 4);

  // The customer's view of what they owe should show one tab, not four parcels.
  check('5', 'the customer sees all items under the same group buy',
    'all orders reference the same campaign series',
    `${thisSeries.length} orders reference "QA Group Buy ${stamp}"`, thisSeries.length === 3);

  // ================= Phase 6 — admin verification ==========================
  const adminOrders = await admin('/api/admin/orders');
  const adminList: any[] = adminOrders.body?.data ?? [];
  const adminMine = adminList.filter((o: any) => (o.customerEmail ?? '').toLowerCase() === email);
  check('6', 'orders appear in the admin dashboard', '>=4 orders for this customer',
    `${adminMine.length}`, adminMine.length >= 4);

  // The admin order LIST is a summary and does not carry the fee; the detail
  // endpoint is where an admin checks what a customer actually paid.
  const detail = await admin(`/api/admin/orders/${adminMine[0]?.id}`);
  check('6', 'admin order detail exposes the packing fee', 'a numeric packingFeePhp',
    JSON.stringify(detail.body?.data?.packingFeePhp ?? detail.body?.data?.order?.packingFeePhp),
    detail.status === 200
      && (detail.body?.data?.packingFeePhp ?? detail.body?.data?.order?.packingFeePhp) != null);

  // Phase 6's real question: can an admin see this campaign's participants and
  // their payments, the way /api/admin/groupbuys/:id/commitments does for a
  // hatian? A campaign id against that route returns 200 with zero rows — it
  // joins group_buys, so it can only ever answer for a kahati.
  const campaignCommits = await admin(`/api/admin/campaigns/${campaign.id}/commitments`);
  check('6', 'admin can list a Group Buy campaign\'s participants', '200 with participant rows',
    `${campaignCommits.status}`, campaignCommits.status === 200);

  const participants: any[] = campaignCommits.body?.data?.participants ?? [];
  const mineRows = participants.filter((p: any) => (p.customerEmail ?? '').toLowerCase() === email);
  check('6', 'the customer appears once for this group buy, not once per order',
    '1 row', `${mineRows.length} row(s)`, mineRows.length === 1);

  check('6', 'the customer\'s grouped row shows all their kits', '4 kits',
    `${num(mineRows[0]?.kits)} kits`, num(mineRows[0]?.kits) === 4);

  check('6', 'the grouped row shows exactly one packing fee', `₱${PACKING_FEE}`,
    `₱${num(mineRows[0]?.packingFeePhp)}`, num(mineRows[0]?.packingFeePhp) === PACKING_FEE);

  check('6', 'the grouped row lists every order under that customer', '3 orders',
    `${mineRows[0]?.orders?.length} order(s)`, mineRows[0]?.orders?.length === 3);

  const campaignAfter = await admin(`/api/campaigns/${campaign.id}`);
  check('6', 'the campaign reflects the committed kits', '4 kits committed',
    `${campaignAfter.body?.data?.committed} committed`, num(campaignAfter.body?.data?.committed) === 4);

  // ================= Phase 7 — regression sweep ============================
  const sweep: [string, string, (r: any) => boolean][] = [
    ['Product Management', '/api/admin/products', (r) => r.status === 200 && Array.isArray(r.body?.data)],
    ['Group Buy Management', '/api/campaigns', (r) => r.status === 200 && Array.isArray(r.body?.data)],
    ['Kahati Management', '/api/admin/groupbuys', (r) => r.status === 200],
    ['MOQ products', '/api/admin/moq-products', (r) => r.status === 200],
    ['Payment Methods', '/api/admin/payment-methods', (r) => r.status === 200],
    ['Settings', '/api/admin/settings', (r) => r.status === 200],
    ['Analytics / stats', '/api/admin/stats', (r) => r.status === 200],
    ['Reports (weekly)', '/api/admin/report/weekly', (r) => r.status === 200],
    ['Settlements', '/api/admin/settlements', (r) => r.status === 200],
    ['Categories', '/api/admin/categories', (r) => r.status === 200],
  ];
  for (const [label, path, okFn] of sweep) {
    const r = await admin(path);
    check('7', `${label} still responds`, '200 with a payload',
      `${r.status}${r.status === 200 ? '' : ' ' + JSON.stringify(r.body).slice(0, 200)}`, okFn(r));
  }

  const custSweep: [string, string][] = [
    ['Shop / products', '/api/products'],
    ['Kahati board', '/api/groupbuys'],
    ['Payment methods', '/api/payment-methods'],
    ['Settlement preview (cart/checkout)', '/api/settlements/preview'],
  ];
  for (const [label, path] of custSweep) {
    const r = await cust(path);
    check('7', `${label} still responds for a customer`, '200', String(r.status), r.status === 200);
  }

  // The MOQ shelf 404s while the page toggle is off — that is the documented
  // contract (app/api/moq-products/route.ts), so assert the toggle, not a 200.
  const moqOff = await cust('/api/moq-products');
  check('7', 'MOQ shelf stays hidden while its page toggle is off', '404',
    String(moqOff.status), moqOff.status === 404);
  const toggled = await admin('/api/admin/settings', json('PATCH', { moqPageEnabled: true }));
  check('7', 'admin can switch the MOQ page on', '200 with moqPageEnabled=true',
    `${toggled.status} moqPageEnabled=${toggled.body?.data?.moqPageEnabled}`,
    toggled.status === 200 && toggled.body?.data?.moqPageEnabled === true);
  const moqOn = await cust('/api/moq-products');
  check('7', 'MOQ shelf serves once the admin switches the page on', '200',
    String(moqOn.status), moqOn.status === 200);
  await admin('/api/admin/settings', json('PATCH', { moqPageEnabled: false }));

  // Use today's explicit Manila range so this run's new orders are guaranteed
  // to be in the payload, regardless of which completed week is the default.
  const weekly = await admin(`/api/admin/report/weekly?from=${manilaToday}&to=${manilaToday}`);
  const groupBuyReport = weekly.body?.data?.segments?.groupbuy;
  check('7', 'Excel export source returns the Group Buy report', '200 with Group Buy order rows',
    `${weekly.status} with ${groupBuyReport?.rows?.length ?? 0} Group Buy order(s)`,
    weekly.status === 200 && Array.isArray(groupBuyReport?.rows) && groupBuyReport.rows.length > 0);

  check('7', 'report payload includes its product summary', 'orders, products, units and USD totals',
    groupBuyReport
      ? `${groupBuyReport.orderCount} orders, ${groupBuyReport.productTotals?.rows?.length ?? 0} products, ${groupBuyReport.productTotals?.totals?.qty ?? 0} units, $${groupBuyReport.productTotals?.totals?.usd ?? 0}`
      : 'missing Group Buy report',
    num(groupBuyReport?.orderCount) > 0
      && num(groupBuyReport?.productTotals?.rows?.length) > 0
      && num(groupBuyReport?.productTotals?.totals?.qty) > 0);

  const productRows: any[] = groupBuyReport?.productTotals?.rows ?? [];
  const nonCanonicalRows = productRows.filter((row) =>
    !String(row.code ?? '').trim()
      || /(?:—\s*(?:kahati|group buy)|batch\s*#)/i.test(String(row.name ?? ''))
      || /(?:kahati|group buy|batch\s*#|proceeds at moq)/i.test(String(row.spec ?? '')),
  );
  check('7', 'report product summary uses canonical catalog columns',
    'clean Product, Variant / Code and Specs values with no channel or batch labels',
    nonCanonicalRows.length === 0
      ? `${productRows.length} clean catalog row(s)`
      : JSON.stringify(nonCanonicalRows.slice(0, 3)),
    productRows.length > 0 && nonCanonicalRows.length === 0);

  if (groupBuyReport) {
    const { buildWeeklyWorkbook, GROUP_BUY_PRODUCT_TOTALS_SHEET } = await import('../../lib/report/weekly-xlsx');
    const { default: ExcelJS } = await import('exceljs');
    const generated = await buildWeeklyWorkbook(groupBuyReport, manilaToday, 'groupbuy');
    const buffer = await generated.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer);
    const exportSheet = reopened.worksheets[0];
    const expectedSummary = `# Orders: ${groupBuyReport.orderCount}  Units: ${groupBuyReport.productTotals.totals.qty}`;

    check('7', 'Group Buy XLSX reopens with the Batch 6 sheet contract',
      `one ${GROUP_BUY_PRODUCT_TOTALS_SHEET} sheet`,
      `${reopened.worksheets.length} sheet(s), first=${exportSheet?.name}`,
      reopened.worksheets.length === 1 && exportSheet?.name === GROUP_BUY_PRODUCT_TOTALS_SHEET);

    check('7', 'Group Buy XLSX includes the report summary', expectedSummary,
      String(exportSheet?.getCell('A2').value ?? ''),
      exportSheet?.getCell('A2').value === expectedSummary);

    const exportedRows = Array.from({ length: productRows.length }, (_, index) => {
      const row = exportSheet?.getRow(index + 4);
      return [row?.getCell(2).value, row?.getCell(3).value, row?.getCell(4).value];
    });
    check('7', 'Group Buy XLSX writes the canonical product rows',
      JSON.stringify(productRows.map((row) => [row.name, row.code, row.spec])),
      JSON.stringify(exportedRows),
      JSON.stringify(exportedRows)
        === JSON.stringify(productRows.map((row) => [row.name, row.code, row.spec])));

    const totalRow = exportSheet?.getRow(exportSheet.rowCount);
    check('7', 'Group Buy XLSX summary totals match the live report payload',
      `${groupBuyReport.productTotals.totals.qty} units and $${groupBuyReport.productTotals.totals.usd}`,
      `${totalRow?.getCell(5).value} units and $${totalRow?.getCell(6).value}`,
      totalRow?.getCell(5).value === groupBuyReport.productTotals.totals.qty
        && totalRow?.getCell(6).value === groupBuyReport.productTotals.totals.usd);
  }

  report();
}

function report() {
  console.log('\n' + '='.repeat(72));
  console.log(`E2E RESULT: ${results.length - failures}/${results.length} passed, ${failures} failed`);
  console.log('='.repeat(72));
  if (failures) {
    console.log('\nFAILURES:');
    results.filter((r) => !r.pass).forEach((r) => {
      console.log(`  [Phase ${r.phase}] ${r.name}\n     expected: ${r.expected}\n     actual  : ${r.actual}`);
    });
  }
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });

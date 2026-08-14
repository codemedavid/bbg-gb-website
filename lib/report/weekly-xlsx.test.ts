// Client feedback #5: the weekly report downloads as .xlsx, properly formatted,
// with column headers and readable data.
//
// These assertions read the generated workbook back with ExcelJS rather than
// smoke-testing that "a file came out". A spreadsheet whose money columns are
// text, or whose headers are missing, is exactly the failure the client would
// see and a byte-length check would not.
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWeeklyReport, type ReportOrderInput } from './build';
import {
  buildWeeklyWorkbook,
  GROUP_BUY_PRODUCT_TOTALS_HEADERS,
  GROUP_BUY_PRODUCT_TOTALS_SHEET,
  PRODUCT_TOTALS_HEADERS,
  PRODUCT_TOTALS_SHEET,
  XLSX_HEADERS,
} from './weekly-xlsx';

type Header = (typeof XLSX_HEADERS)[number];
// 1-based column index of a header, so assertions name the column instead of
// hard-coding a position that shifts whenever the layout changes.
const columnOf = (name: Header): number => XLSX_HEADERS.indexOf(name) + 1;

const order = (o: Partial<ReportOrderInput>): ReportOrderInput => ({
  orderNo: 'BBG-0001', status: 'payment_confirmed', createdAt: '2026-05-27T02:00:00Z',
  shipName: 'Gelly Ramos', shipPhone: '09171234567', customerEmail: 'gelly@example.com',
  shipAddress: '12 Mabini St, Quezon City', courier: 'J&T', packedBy: 'Nova',
  paymentMethod: 'GCash', totalUsd: '10.00', totalPhp: '560.00',
  items: [{ nameSnapshot: 'Tirzepatide TR15', qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' }],
  ...o,
});

// Round-trip through a real .xlsx buffer so we assert on what the client opens.
async function roundTrip(orders: ReportOrderInput[], monday = '2026-05-25') {
  const report = buildWeeklyReport(monday, orders);
  const workbook = await buildWeeklyWorkbook(report, monday);
  const buffer = await workbook.xlsx.writeBuffer();

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  return { sheet: reopened.worksheets[0], workbook: reopened, report };
}

async function groupBuyRoundTrip(orders: ReportOrderInput[], monday = '2026-05-25') {
  const report = buildWeeklyReport(monday, orders);
  const workbook = await buildWeeklyWorkbook(report, monday, 'groupbuy');
  const buffer = await workbook.xlsx.writeBuffer();

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  return { sheet: reopened.worksheets[0], workbook: reopened, report };
}

describe('buildWeeklyWorkbook', () => {
  it('produces a file the spreadsheet apps can actually open', async () => {
    const { sheet } = await roundTrip([order({})]);
    expect(sheet).toBeDefined();
    expect(sheet.rowCount).toBeGreaterThan(1);
  });

  it('writes a header row naming every exported column', async () => {
    const { sheet } = await roundTrip([order({})]);

    const headerRow = sheet.getRow(1);
    const headers = XLSX_HEADERS.map((_, i) => headerRow.getCell(i + 1).value);

    expect(headers).toEqual([...XLSX_HEADERS]);
  });

  it('exports the buyer fields the client asked for', async () => {
    const { sheet } = await roundTrip([order({})]);
    const cell = (name: Header) => sheet.getRow(2).getCell(columnOf(name)).value;

    expect(cell('Buyer Name')).toBe('Gelly Ramos');
    expect(cell('Contact Number')).toBe('09171234567');
    expect(cell('Email')).toBe('gelly@example.com');
    expect(cell('Shipping Address')).toBe('12 Mabini St, Quezon City');
    expect(cell('Order Details')).toBe('Tirzepatide TR15 x5 @ $6.80');
    expect(cell('Payment Method')).toBe('GCash');
    expect(cell('Payment Status')).toBe('Paid');
    expect(cell('Order Status')).toBe('Payment Verified');
  });

  it('writes money as numbers with a currency format, not as text', async () => {
    const { sheet } = await roundTrip([order({})]);
    const phpCell = sheet.getRow(2).getCell(columnOf('PHP'));
    const usdCell = sheet.getRow(2).getCell(columnOf('USD'));

    expect(phpCell.value).toBe(560);
    expect(typeof phpCell.value).toBe('number');
    expect(phpCell.numFmt).toContain('0.00');
    expect(usdCell.value).toBe(10);
  });

  it('puts each line item on its own line within the order-details cell', async () => {
    const { sheet } = await roundTrip([order({
      items: [
        { nameSnapshot: 'Tirzepatide TR15', qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' },
        { nameSnapshot: 'BAC Water 3ml', qty: 2, unitPriceUsd: null, unitPricePhp: '55.00' },
      ],
    })]);

    const details = sheet.getRow(2).getCell(columnOf('Order Details'));
    expect(details.value).toBe('Tirzepatide TR15 x5 @ $6.80\nBAC Water 3ml x2');
    expect(details.alignment?.wrapText).toBe(true);
  });

  it('emits one data row per order, in report order', async () => {
    const { sheet } = await roundTrip([
      order({ orderNo: 'BBG-0001', shipName: 'Ana' }),
      order({ orderNo: 'BBG-0002', shipName: 'Ben' }),
      order({ orderNo: 'BBG-0003', shipName: 'Cara' }),
    ]);
    const col = columnOf('Buyer Name');

    expect([2, 3, 4].map((r) => sheet.getRow(r).getCell(col).value)).toEqual(['Ana', 'Ben', 'Cara']);
  });

  it('bolds and freezes the header so long reports stay readable', async () => {
    const { sheet } = await roundTrip([order({})]);

    expect(sheet.getRow(1).font?.bold).toBe(true);

    const view = sheet.views[0];
    expect(view?.state).toBe('frozen');
    // Narrow past the view union — ySplit only exists on the frozen variant.
    expect(view?.state === 'frozen' ? view.ySplit : undefined).toBe(1);
  });

  it('gives every column a width so nothing renders as ###', async () => {
    const { sheet } = await roundTrip([order({})]);

    for (let i = 1; i <= XLSX_HEADERS.length; i++) {
      expect(sheet.getColumn(i).width).toBeGreaterThan(0);
    }
  });

  it('closes with a totals row that excludes cancelled orders', async () => {
    const { sheet, report } = await roundTrip([
      order({ status: 'payment_confirmed', totalPhp: '560.00', totalUsd: '10.00' }),
      order({ status: 'cancelled', totalPhp: '9999.00', totalUsd: '99.00' }),
    ]);

    const totalRow = sheet.getRow(sheet.rowCount);
    expect(totalRow.getCell(columnOf('PHP')).value).toBe(report.totals.php);
    expect(report.totals.php).toBe(560);
  });

  it('includes the packing-fee total in the exported summary', async () => {
    const { sheet } = await roundTrip([
      order({ packingFeePhp: '150.00' }),
      order({ packingFeePhp: '200.00' }),
    ]);

    const totalRow = sheet.getRow(sheet.rowCount);
    expect(String(totalRow.getCell(columnOf('Order Status')).value)).toContain('Packing fees: ₱350.00');
  });

  it('names the sheet after the reporting week', async () => {
    const { sheet } = await roundTrip([order({})]);
    expect(sheet.name).toContain('22'); // ISO week of 2026-05-25
  });

  it('handles a week with no orders without throwing', async () => {
    const { sheet } = await roundTrip([]);
    expect(sheet.getRow(1).getCell(1).value).toBe(XLSX_HEADERS[0]);
  });
});

// The batch order is placed per product, not per buyer: the team needs "how many
// vials of TR30 do we owe the supplier this week" out of the same file they
// already download, so it ships as a second sheet rather than a second export.
describe('buildWeeklyWorkbook — Product Totals sheet', () => {
  const twoProducts = () => order({
    items: [
      { productId: 'p-ba5', nameSnapshot: 'Liquid Bacteriostatic Water', specSnapshot: '5ml', code: 'BA5', kitSize: 10, qty: 270, unitPriceUsd: '1.00', unitPricePhp: '56.00' },
      { productId: 'p-lb50', nameSnapshot: 'Lemon Bottle', specSnapshot: '50ml', code: 'LB50', kitSize: 1, qty: 33, unitPriceUsd: '18.00', unitPricePhp: '1000.00' },
    ],
  });

  const totalsSheet = async (orders: ReportOrderInput[]) => {
    const { workbook, report } = await roundTrip(orders);
    const sheet = workbook.getWorksheet(PRODUCT_TOTALS_SHEET);
    if (!sheet) throw new Error(`workbook has no "${PRODUCT_TOTALS_SHEET}" sheet`);
    return { sheet, report };
  };

  it('adds the product rollup as a second sheet, keeping the order sheet first', async () => {
    const { workbook } = await roundTrip([twoProducts()]);

    expect(workbook.worksheets).toHaveLength(2);
    expect(workbook.worksheets[1].name).toBe(PRODUCT_TOTALS_SHEET);
  });

  it('writes a header row naming every product column', async () => {
    const { sheet } = await totalsSheet([twoProducts()]);
    const headerRow = sheet.getRow(1);

    expect(PRODUCT_TOTALS_HEADERS.map((_, i) => headerRow.getCell(i + 1).value))
      .toEqual([...PRODUCT_TOTALS_HEADERS]);
  });

  it('emits one row per product, ranked by quantity', async () => {
    const { sheet } = await totalsSheet([twoProducts()]);
    const col = PRODUCT_TOTALS_HEADERS.indexOf('Variant / Code') + 1;

    expect([2, 3].map((r) => sheet.getRow(r).getCell(col).value)).toEqual(['BA5', 'LB50']);
  });

  it('carries name, specs, qty and kits for each product', async () => {
    const { sheet } = await totalsSheet([twoProducts()]);
    const cell = (row: number, name: (typeof PRODUCT_TOTALS_HEADERS)[number]) =>
      sheet.getRow(row).getCell(PRODUCT_TOTALS_HEADERS.indexOf(name) + 1).value;

    expect(cell(2, 'Product')).toBe('Liquid Bacteriostatic Water');
    expect(cell(2, 'Specs')).toBe('5ml');
    expect(cell(2, 'Total Qty')).toBe(270);
    expect(cell(2, 'Kits')).toBe(27);
    // Sold per piece, so its kit count matches its quantity.
    expect(cell(3, 'Kits')).toBe(33);
  });

  it('writes product USD as a number with a currency format', async () => {
    const { sheet } = await totalsSheet([twoProducts()]);
    const usd = sheet.getRow(2).getCell(PRODUCT_TOTALS_HEADERS.indexOf('Total USD') + 1);

    expect(usd.value).toBe(270);
    expect(typeof usd.value).toBe('number');
    expect(usd.numFmt).toContain('0.00');
  });

  it('closes with a TOTAL row summing USD and quantity', async () => {
    const { sheet, report } = await totalsSheet([twoProducts()]);
    const totalRow = sheet.getRow(sheet.rowCount);

    expect(totalRow.getCell(1).value).toBe('TOTAL');
    expect(totalRow.getCell(PRODUCT_TOTALS_HEADERS.indexOf('Total USD') + 1).value).toBe(report.productTotals.totals.usd);
    expect(totalRow.getCell(PRODUCT_TOTALS_HEADERS.indexOf('Total Qty') + 1).value).toBe(303);
  });

  it('still produces the sheet when the week has no orders', async () => {
    const { sheet } = await totalsSheet([]);
    expect(sheet.getRow(1).getCell(1).value).toBe(PRODUCT_TOTALS_HEADERS[0]);
  });
});

describe('buildWeeklyWorkbook — Batch 6 Group Buy format', () => {
  const twoProducts = () => order({
    items: [
      { productId: 'p-ba5', nameSnapshot: 'Liquid Bacteriostatic Water', specSnapshot: '5ml', code: 'BA5', kitSize: 10, qty: 270, unitPriceUsd: '1.00', unitPricePhp: '56.00' },
      { productId: 'p-lb50', nameSnapshot: 'Lemon Bottle', specSnapshot: '50ml', code: 'LB50', kitSize: 1, qty: 33, unitPriceUsd: '18.00', unitPricePhp: '1000.00' },
    ],
  });

  it('exports one BBG-ProductTotals worksheet instead of the order-detail workbook', async () => {
    const { workbook, sheet } = await groupBuyRoundTrip([twoProducts()]);

    expect(workbook.worksheets).toHaveLength(1);
    expect(sheet.name).toBe(GROUP_BUY_PRODUCT_TOTALS_SHEET);
  });

  it('places the title, summary and visible headers on the Batch 6 rows', async () => {
    const { sheet } = await groupBuyRoundTrip([twoProducts()]);

    expect(sheet.getCell('A1').value).toBe('# BBG Product Totals - Week 22 · Mon May 25 – Sun May 31');
    expect(sheet.getCell('A2').value).toBe('# Orders: 1  Units: 303');
    expect(GROUP_BUY_PRODUCT_TOTALS_HEADERS.map((_, i) => sheet.getRow(3).getCell(i + 1).value))
      .toEqual([...GROUP_BUY_PRODUCT_TOTALS_HEADERS]);
    expect(sheet.getCell('G3').value).toBeNull();
  });

  it('matches the Batch 6 column widths and hidden helper columns', async () => {
    const { sheet } = await groupBuyRoundTrip([twoProducts()]);

    // ExcelJS omits an explicit width of 9 when serializing because 9 is its
    // default; treat an omitted value as that same effective visual width.
    expect([1, 2, 3, 4, 5].map((i) => sheet.getColumn(i).width ?? 9))
      .toEqual([11.75, 26.75, 10.875, 10.375, 9]);
    expect(sheet.getColumn(6).hidden).toBe(true);
    expect(sheet.getColumn(7).hidden).toBe(true);
  });

  it('writes product rows as kits, USD and hidden raw units', async () => {
    const { sheet } = await groupBuyRoundTrip([twoProducts()]);

    expect([1, 2, 3, 4, 5, 6, 7].map((c) => sheet.getRow(4).getCell(c).value))
      .toEqual([1, 'Liquid Bacteriostatic Water', 'BA5', '5ml', 27, 270, 270]);
    expect([1, 2, 3, 4, 5, 6, 7].map((c) => sheet.getRow(5).getCell(c).value))
      .toEqual([2, 'Lemon Bottle', 'LB50', '50ml', 33, 594, 33]);
  });

  it('uses the reference black, white-bold table styling and borders', async () => {
    const { sheet } = await groupBuyRoundTrip([twoProducts()]);

    for (const address of ['A1', 'A2', 'A3', 'B4', 'F4', 'G4', 'A6']) {
      const cell = sheet.getCell(address);
      expect(cell.fill).toMatchObject({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF000000' } });
      expect(cell.font).toMatchObject({ name: 'Aptos Narrow', size: 11, bold: true, color: { argb: 'FFFFFFFF' } });
    }
    expect(sheet.getCell('A3').border).toMatchObject({
      left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' },
    });
    expect(sheet.getCell('B4').border).toMatchObject({
      left: { style: 'thin' }, right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' },
    });
    expect(sheet.getCell('A6').border).toEqual({});
  });

  it('closes with the Batch 6 TOTAL row and remains valid when empty', async () => {
    const populated = await groupBuyRoundTrip([twoProducts()]);
    const total = populated.sheet.getRow(populated.sheet.rowCount);
    expect([1, 2, 3, 4, 5, 6, 7].map((c) => total.getCell(c).value))
      .toEqual(['TOTAL', null, null, null, 303, 864, 303]);

    const empty = await groupBuyRoundTrip([]);
    expect(empty.sheet.getCell('A1').value).toContain('BBG Product Totals');
    expect(empty.sheet.getCell('A2').value).toBe('# Orders: 0  Units: 0');
    expect(empty.sheet.getRow(empty.sheet.rowCount).getCell(1).value).toBe('TOTAL');
  });
});

// On-hand and group buy download as two files rather than two tabs of one, so
// the batch-order workbook can be handed to whoever places the order without
// the on-hand sales in it at all.
describe('buildWeeklyWorkbook — per-segment workbooks', () => {
  const anOrder = () => order({
    items: [{ productId: 'p-tr15', nameSnapshot: 'Tirzepatide', specSnapshot: '15mg', code: 'TR15', kitSize: 10, qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' }],
  });

  it('uses the Batch 6 sheet name for the group-buy segment', async () => {
    const report = buildWeeklyReport('2026-05-25', [anOrder()]);
    const workbook = await buildWeeklyWorkbook(report, '2026-05-25', 'groupbuy');

    expect(workbook.worksheets[0].name).toBe(GROUP_BUY_PRODUCT_TOTALS_SHEET);
  });

  it('names the on-hand order sheet for its own segment', async () => {
    const report = buildWeeklyReport('2026-05-25', [anOrder()]);
    const workbook = await buildWeeklyWorkbook(report, '2026-05-25', 'onhand');

    expect(workbook.worksheets[0].name).toBe('On-Hand · Week 22');
  });

  it('keeps a segment sheet name legal and within the Excel length limit', async () => {
    // Excel rejects / \ ? * [ ] in a sheet name and truncates past 31 chars —
    // either one makes the workbook fail to open, so the display label
    // ("Group Buy / Kahati") cannot be used verbatim here.
    const report = buildWeeklyReport('2026-05-25', []);

    for (const segment of ['onhand', 'groupbuy'] as const) {
      const workbook = await buildWeeklyWorkbook(report, '2026-05-25', segment);
      for (const sheet of workbook.worksheets) {
        expect(sheet.name.length).toBeLessThanOrEqual(31);
        expect(sheet.name).not.toMatch(/[/\\?*[\]]/);
      }
    }
  });

  it('exports only the Batch 6 Product Totals sheet for group buy', async () => {
    const report = buildWeeklyReport('2026-05-25', [anOrder()]);
    const workbook = await buildWeeklyWorkbook(report, '2026-05-25', 'groupbuy');

    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0].name).toBe(GROUP_BUY_PRODUCT_TOTALS_SHEET);
  });

  it('keeps the current two-sheet On-Hand workbook unchanged', async () => {
    const report = buildWeeklyReport('2026-05-25', [anOrder()]);
    const workbook = await buildWeeklyWorkbook(report, '2026-05-25', 'onhand');

    expect(workbook.worksheets).toHaveLength(2);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'On-Hand · Week 22',
      PRODUCT_TOTALS_SHEET,
    ]);
  });

  it('falls back to the unsegmented sheet name when no segment is given', async () => {
    const report = buildWeeklyReport('2026-05-25', [anOrder()]);
    const workbook = await buildWeeklyWorkbook(report, '2026-05-25');

    expect(workbook.worksheets[0].name).toBe('Week 22');
  });
});

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
import { buildWeeklyWorkbook, XLSX_HEADERS } from './weekly-xlsx';

type Header = (typeof XLSX_HEADERS)[number];
// 1-based column index of a header, so assertions name the column instead of
// hard-coding a position that shifts whenever the layout changes.
const columnOf = (name: Header): number => XLSX_HEADERS.indexOf(name) + 1;

const order = (o: Partial<ReportOrderInput>): ReportOrderInput => ({
  orderNo: 'BBG-0001', status: 'payment_confirmed', createdAt: '2026-05-27T02:00:00Z',
  shipName: 'Gelly Ramos', shipPhone: '09171234567', customerEmail: 'gelly@example.com',
  shipAddress: '12 Mabini St, Quezon City', courier: 'J&T', packedBy: 'Nova',
  paymentMethod: 'GCash', totalUsd: '10.00', totalPhp: '560.00',
  packingFeePhp: '60.00',
  items: [{ code: 'TR15', nameSnapshot: 'Tirzepatide TR15', qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' }],
  ...o,
});

// Round-trip through a real .xlsx buffer so we assert on what the client opens.
async function roundTrip(orders: ReportOrderInput[], monday = '2026-05-25') {
  const report = buildWeeklyReport(monday, orders);
  const workbook = await buildWeeklyWorkbook(report, monday);
  const buffer = await workbook.xlsx.writeBuffer();

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  return { sheet: reopened.worksheets[0], report };
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

  it('stores the order range as a named Excel table ready for PivotTable use', async () => {
    const { sheet } = await roundTrip([
      order({ orderNo: 'BBG-0001' }),
      order({ orderNo: 'BBG-0002' }),
    ]);

    const table = sheet.getTable('WeeklyOrders');
    expect(table).toBeDefined();
    // ExcelJS deserializes the persisted range as tableRef rather than through
    // its ref accessor. P3 = header + two order rows; the totals row is row 4.
    const model = (table as unknown as {
      model: { tableRef: string; columns: { name: string }[] };
    }).model;
    expect(model.tableRef).toBe('A1:Q3');
    expect(model.columns.map((column) => column.name)).toEqual([...XLSX_HEADERS]);
  });

  it('exports the buyer fields the client asked for', async () => {
    const { sheet } = await roundTrip([order({})]);
    const cell = (name: Header) => sheet.getRow(2).getCell(columnOf(name)).value;

    expect(cell('Buyer Name')).toBe('Gelly Ramos');
    expect(cell('Contact Number')).toBe('09171234567');
    expect(cell('Email')).toBe('gelly@example.com');
    expect(cell('Shipping Address')).toBe('12 Mabini St, Quezon City');
    expect(cell('Product Codes')).toBe('TR15');
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

  it('exports each packing fee as a number and totals the column', async () => {
    const { sheet, report } = await roundTrip([
      order({ packingFeePhp: '60.00' }),
      order({ orderNo: 'BBG-0002', packingFeePhp: '40.00' }),
    ]);
    const headers = (sheet.getRow(1).values as unknown[]).map(String);
    const packingFeeCol = headers.indexOf('Packing Fee (PHP)');

    expect(packingFeeCol).toBeGreaterThan(0);
    expect(sheet.getRow(2).getCell(packingFeeCol).value).toBe(60);
    expect(sheet.getRow(sheet.rowCount).getCell(packingFeeCol).value).toBe(report.totals.packingFeePhp);
    expect(report.totals.packingFeePhp).toBe(100);
    expect(sheet.getColumn(packingFeeCol).numFmt).toContain('0.00');
  });

  it('puts each line item on its own line within the order-details cell', async () => {
    const { sheet } = await roundTrip([order({
      items: [
        { code: 'TR15', nameSnapshot: 'Tirzepatide TR15', qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' },
        { code: 'BA03', nameSnapshot: 'BAC Water 3ml', qty: 2, unitPriceUsd: null, unitPricePhp: '55.00' },
      ],
    })]);

    const details = sheet.getRow(2).getCell(columnOf('Order Details'));
    const codes = sheet.getRow(2).getCell(columnOf('Product Codes'));
    expect(codes.value).toBe('TR15\nBA03');
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

  it('names the sheet after the reporting week', async () => {
    const { sheet } = await roundTrip([order({})]);
    expect(sheet.name).toContain('22'); // ISO week of 2026-05-25
  });

  it('handles a week with no orders without throwing', async () => {
    const { sheet } = await roundTrip([]);
    expect(sheet.getRow(1).getCell(1).value).toBe(XLSX_HEADERS[0]);
  });
});

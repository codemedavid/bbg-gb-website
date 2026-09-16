import { expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import { buildSegmentedDateRangeReport, type ReportOrderInput } from './build';
import { buildKahatiCartWorkbook } from './kahati-cart-xlsx';
import { buildPasaloItems } from './pasalo-items';

const order = (overrides: Partial<ReportOrderInput> = {}): ReportOrderInput => ({
  orderNo: 'KH-1', status: 'payment_confirmed', buyType: 'kahati', createdAt: '2026-09-12T00:00:00Z',
  shipName: 'Buyer', shipPhone: '', customerEmail: '', shipAddress: '', courier: '', packedBy: '',
  paymentMethod: '', totalUsd: null, totalPhp: '450', packingFeePhp: '150',
  items: [{ productId: 'p1', nameSnapshot: 'Retatrutide', specSnapshot: '20mg vial', qty: 2,
    unitPriceUsd: '1', unitPricePhp: '150', groupBuyId: 'g1', kind: 'group_buy', counterKahatiVials: 2 }],
  ...overrides,
});

it('rolls up Kahati and Pasalo peso line prices, excludes cancelled orders and fees, and keeps variants separate', async () => {
  const original = order();
  const report = buildSegmentedDateRangeReport('2026-09-11', '2026-09-16', [original,
    order({ orderNo: 'KH-2', items: [{ ...original.items[0], qty: 1, unitPricePhp: '180' }] }),
    order({ orderNo: 'KH-3', items: [{ ...original.items[0], productId: 'p2', specSnapshot: '10mg vial', qty: 1 }] }),
    order({ orderNo: 'KH-CANCELLED', status: 'cancelled' }),
    order({ orderNo: 'SOLO', buyType: 'solo', items: [{ ...original.items[0], kind: 'product', groupBuyId: null }] }),
  ]).kahati;
  expect(report.kahatiCart).toEqual([
    { product: 'Retatrutide 20mg vial', qty: 3, amountPhp: 480, counterIds: ['g1'] },
    { product: 'Retatrutide 10mg vial', qty: 1, amountPhp: 150, counterIds: ['g1'] },
  ]);
  const book = await buildKahatiCartWorkbook(report.kahatiCart!, report.rangeLabel);
  const restored = new Workbook();
  await restored.xlsx.load(await book.xlsx.writeBuffer());
  const sheet = restored.getWorksheet('Kahati Cart')!;
  expect(sheet.getCell('A1').value).toBe('Kahati Cart Order');
  expect(sheet.getRow(3).values).toEqual([undefined, 'Product', 'Quantity', 'Total Amount (₱)', 'Unit Price (₱)']);
  expect(sheet.getCell('D4').value).toEqual({ formula: 'C4/B4', result: 160 });
  expect(sheet.getCell('B6').value).toEqual({ formula: 'SUM(B4:B5)', result: 4 });
  expect(sheet.getCell('C6').value).toEqual({ formula: 'SUM(C4:C5)', result: 630 });
});

it('handles an empty batch without invalid totals formulas', async () => {
  const sheet = (await buildKahatiCartWorkbook([], 'Empty batch')).getWorksheet('Kahati Cart')!;
  expect(sheet.getCell('B4').value).toBe(0);
  expect(sheet.getCell('C4').value).toBe(0);
  expect(sheet.getCell('D4').value).toBe(0);
});

it('combines cart prices with per-kit Pasalo notes and keeps unmatched cancelled kits in the detail sheet', async () => {
  const items = buildPasaloItems([
    { id: 'kit-short', name: 'Same product', status: 'pasalo', claimedSlots: 5, totalSlots: 10, kahatiVials: 5, code: null, spec: null },
    { id: 'kit-qualified', name: 'Same product', status: 'closed', claimedSlots: 8, totalSlots: 10, kahatiVials: 8, code: null, spec: null },
    { id: 'kit-cancelled', name: 'Cancelled product', status: 'cancelled', claimedSlots: 3, totalSlots: 10, kahatiVials: 3, code: null, spec: null },
  ]);
  const book = await buildKahatiCartWorkbook([
    { product: 'Same product', qty: 13, amountPhp: 1300, counterIds: ['kit-short', 'kit-qualified'] },
  ], 'Batch 10', items);
  const restored = new Workbook();
  await restored.xlsx.load(await book.xlsx.writeBuffer());
  const cart = restored.getWorksheet('Kahati Cart')!;
  expect(cart.getCell('E3').value).toBe('Pasalo / Bunuan Notes');
  expect(cart.getCell('E4').text).toBe('Closed: 2 vials unfilled.\nFor cancellation.');
  expect(cart.getCell('C4').value).toBe(1300);
  const detail = restored.getWorksheet('Pasalo and Bunuan')!;
  expect(detail.rowCount).toBe(6);
  expect(detail.getCell('A4').value).toBe('Cancelled product');
  expect(detail.getCell('I4').value).toBe('Cancelled — review before offering');
});

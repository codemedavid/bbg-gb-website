import { expect, it } from 'vitest';
import { Workbook } from 'exceljs';
import { buildPasaloItems, buildPasaloItemsWorkbook } from './pasalo-items';

it('exports numeric gaps using each kit minimum/cap and preserves review status', async () => {
  const items = buildPasaloItems([{ id: 'kit-1', name: 'Test kit', code: 'TEST', spec: '20mg',
    claimedSlots: 3, totalSlots: 5, minViableVials: 4, kahatiVials: 2, status: 'cancelled' }]);
  const original = await buildPasaloItemsWorkbook(items, 'Batch 8');
  const readBack = new Workbook();
  await readBack.xlsx.load(await original.xlsx.writeBuffer());
  const sheet = readBack.getWorksheet('Pasalo and Bunuan')!;
  expect(sheet.getCell('A1').value).toBe('Batch 8');
  expect(sheet.getRow(4).values).toEqual([
    undefined, 'Test kit', 'TEST', '20mg', 'kit-1', 'Pasalo', 3, 4, 5, 1, 2,
    'Cancelled — review before offering',
  ]);
});

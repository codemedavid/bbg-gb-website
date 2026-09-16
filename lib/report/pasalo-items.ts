import { counterQuantities, type MeasurableCounter } from '../kahati-quantity';
import type { Workbook } from 'exceljs';

export type PasaloItem = ReturnType<typeof buildPasaloItems>[number];

// Keep each kit separate: 5 + 5 on two counters is two short kits, not one full kit.
export function buildPasaloItems(counters: readonly (MeasurableCounter & {
  id: string; name: string; status: string; code: string | null; spec: string | null;
})[]) {
  return counters.flatMap(counter => {
    const q = counterQuantities(counter);
    if (q.combinedVials === 0 || q.slotsRemaining === 0
      || !['open', 'pasalo', 'closed', 'cancelled'].includes(counter.status)) return [];
    return [{
      id: counter.id, name: counter.name, code: counter.code ?? '', spec: counter.spec ?? '',
      status: counter.status, ...q,
      category: q.neededToQualify > 0 ? 'Cancel' as const : 'Pasalo' as const,
    }];
  }).sort((a, b) => b.neededToQualify - a.neededToQualify || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function pasaloItemStatus(item: Pick<PasaloItem, 'status'>) {
  switch (item.status) {
    case 'cancelled': return 'Cancelled — review before offering';
    case 'closed': return 'Closed — review before offering';
    case 'pasalo': return 'Pasalo stage';
    default: return 'Kahati stage';
  }
}

export async function buildPasaloItemsWorkbook(items: PasaloItem[], batchLabel: string) {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  addPasaloItemsSheet(book, items, batchLabel);
  return book;
}

export function addPasaloItemsSheet(book: Workbook, items: PasaloItem[], batchLabel: string) {
  const sheet = book.addWorksheet('Pasalo and Bunuan');
  sheet.addRow([batchLabel]);
  sheet.addRow(['Committed quantities; closed/cancelled counters require review before offering.']);
  sheet.addRow(['Product', 'Code', 'Spec', 'Counter', 'Type', 'Committed vials', 'Needed to qualify', 'Needed to complete kit', 'Stage']);
  for (const item of items) sheet.addRow([
    item.name, item.code, item.spec, item.id, item.category, item.combinedVials,
    item.neededToQualify, item.slotsRemaining, pasaloItemStatus(item),
  ]);
  sheet.columns.forEach((column, i) => { column.width = [35, 14, 20, 38, 12, 20, 22, 25, 42][i]; });
  sheet.getRow(3).font = { bold: true };
  sheet.autoFilter = { from: 'A3', to: `I${Math.max(3, sheet.rowCount)}` };
}

export async function downloadPasaloItems(items: PasaloItem[], batchLabel: string) {
  const book = await buildPasaloItemsWorkbook(items, batchLabel);
  const buffer = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `BBG-Pasalo-Bunuan-${batchLabel.replace(/[^a-zA-Z0-9_-]+/g, '-')}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

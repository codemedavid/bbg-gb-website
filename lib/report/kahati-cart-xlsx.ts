import type { KahatiCartRow } from './kahati-cart';
import { round2 } from './money';
import { addPasaloItemsSheet, type PasaloItem } from './pasalo-items';

export async function buildKahatiCartWorkbook(rows: KahatiCartRow[], rangeLabel: string, pasaloItems?: PasaloItem[]) {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  book.creator = 'BBG Peptides';
  const sheet = book.addWorksheet('Kahati Cart', { views: [{ state: 'frozen', ySplit: 3 }] });
  const lastColumn = pasaloItems ? 'E' : 'D';
  [60, 14, 24, 22, ...(pasaloItems ? [85] : [])].forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.mergeCells(`A1:${lastColumn}1`);
  sheet.getCell('A1').value = 'Kahati Cart Order';
  sheet.getCell('A1').font = { bold: true, size: 16 };
  sheet.mergeCells(`A2:${lastColumn}2`);
  sheet.getCell('A2').value = rangeLabel;
  sheet.addRow(['Product', 'Quantity', 'Total Amount (₱)', 'Unit Price (₱)', ...(pasaloItems ? ['Pasalo / Bunuan Notes'] : [])]);
  sheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } };
  for (const item of rows) {
    const row = sheet.addRow([item.product, item.qty, item.amountPhp]);
    row.getCell(4).value = { formula: `C${row.number}/B${row.number}`, result: item.amountPhp / item.qty };
    if (pasaloItems) {
      const kits = pasaloItems.filter(kit => item.counterIds?.includes(kit.id));
      const notes: string[] = [];
      const eligible = kits.filter(kit => kit.neededToQualify === 0 && kit.status !== 'cancelled');
      const available = eligible.filter(kit => kit.status !== 'closed').reduce((sum, kit) => sum + kit.slotsRemaining, 0);
      const closed = eligible.filter(kit => kit.status === 'closed').reduce((sum, kit) => sum + kit.slotsRemaining, 0);
      const vials = (count: number) => `${count} ${count === 1 ? 'vial' : 'vials'}`;
      if (available) notes.push(`Pasalo / Bunuan: ${vials(available)} to fill.`);
      if (closed) notes.push(`Closed: ${vials(closed)} unfilled.`);
      if (kits.some(kit => kit.neededToQualify > 0 && kit.status !== 'cancelled')) notes.push('For cancellation.');
      if (kits.some(kit => kit.status === 'cancelled')) notes.push('Cancelled.');
      row.getCell(5).value = notes.join('\n');
      row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
      row.height = Math.max(42, notes.length * 42);
    }
  }
  const qty = rows.reduce((sum, row) => sum + row.qty, 0);
  const amount = round2(rows.reduce((sum, row) => sum + row.amountPhp, 0));
  const total = sheet.addRow(['TOTAL']);
  total.getCell(2).value = rows.length ? { formula: `SUM(B4:B${total.number - 1})`, result: qty } : 0;
  total.getCell(3).value = rows.length ? { formula: `SUM(C4:C${total.number - 1})`, result: amount } : 0;
  total.getCell(4).value = qty ? { formula: `IFERROR(C${total.number}/B${total.number},0)`, result: amount / qty } : 0;
  total.font = { bold: true };
  sheet.getColumn(2).numFmt = '#,##0';
  sheet.getColumn(3).numFmt = '#,##0.00';
  sheet.getColumn(4).numFmt = '#,##0.00';
  sheet.autoFilter = { from: 'A3', to: `${lastColumn}${Math.max(3, total.number - 1)}` };
  const note = sheet.getRow(total.number + 3);
  sheet.mergeCells(`A${note.number}:${lastColumn}${note.number}`);
  note.getCell(1).value = 'Includes Kahati and Pasalo. Packing fees and cancelled/refunded lines are excluded. Unit price = total amount ÷ quantity (weighted average when prices differ).';
  note.getCell(1).alignment = { wrapText: true };
  note.height = 32;
  if (pasaloItems) addPasaloItemsSheet(book, pasaloItems, rangeLabel);
  return book;
}

export async function downloadKahatiCartXlsx(rows: KahatiCartRow[], rangeLabel: string, pasaloItems: PasaloItem[]) {
  const book = await buildKahatiCartWorkbook(rows, rangeLabel, pasaloItems);
  const buffer = await book.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `BBG-Kahati-Cart-Pasalo-${rangeLabel.replace(/[^a-zA-Z0-9_-]+/g, '-')}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

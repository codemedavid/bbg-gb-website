/**
 * @vitest-environment jsdom
 */
// The browser download path — the 27% of weekly-xlsx.ts that no test covered,
// and which held two real defects:
//
//   * ExcelJS was a static top-level import while the module comment claimed it
//     was dynamic, so ~22MB unpacked landed in the admin bundle on page load.
//     The jsPDF exporter this replaced did it correctly, inside the click handler.
//   * The object URL was revoked in the same tick as link.click(), which cancels
//     the download in Firefox before the blob is read.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWeeklyReport } from './build';
import { downloadWeeklyReportXlsx, weeklyXlsxFilename } from './weekly-xlsx';

const report = () => buildWeeklyReport('2026-05-25', [{
  orderNo: 'BBG-0001', status: 'payment_confirmed', createdAt: '2026-05-27T02:00:00Z',
  shipName: 'Gelly', shipPhone: '0912', customerEmail: 'g@x.com', shipAddress: 'Manila',
  courier: 'J&T', packedBy: 'Nova', paymentMethod: 'GCash', totalUsd: '10.00', totalPhp: '560.00',
  items: [{ nameSnapshot: 'Tirzepatide TR15', qty: 5, unitPriceUsd: '6.80', unitPricePhp: '380.00' }],
}]);

describe('ExcelJS stays out of the initial bundle', () => {
  it('does not import exceljs at module top level', () => {
    const source = readFileSync(join(__dirname, 'weekly-xlsx.ts'), 'utf8');

    // A static `import ... from 'exceljs'` is reachable from WeeklyReportButton's
    // own static import, so it lands in the admin page chunk. The dynamic form
    // `await import('exceljs')` only loads when someone actually exports.
    const staticImport = /^\s*import\s+[^;]*\bfrom\s+['"]exceljs['"]/m;
    const typeOnlyImport = /^\s*import\s+type\s+[^;]*\bfrom\s+['"]exceljs['"]/m;

    const hasValueImport = staticImport.test(source) && !typeOnlyImport.test(source);
    expect(hasValueImport).toBe(false);
  });

  it('loads exceljs through a dynamic import instead', () => {
    const source = readFileSync(join(__dirname, 'weekly-xlsx.ts'), 'utf8');

    expect(source).toMatch(/import\(\s*['"]exceljs['"]\s*\)/);
  });
});

describe('downloadWeeklyReportXlsx', () => {
  let created: string[];
  let revoked: string[];
  let clicked: { href: string; download: string; inDom: boolean }[];

  beforeEach(() => {
    created = [];
    revoked = [];
    clicked = [];
    // Deliberately NOT fake timers: ExcelJS's writeBuffer drives its zip stream
    // through real timers, so faking them deadlocks the workbook build.
    globalThis.URL.createObjectURL = vi.fn(() => {
      const url = `blob:mock-${created.length}`;
      created.push(url);
      return url;
    });
    globalThis.URL.revokeObjectURL = vi.fn((url: string) => { revoked.push(url); });

    // Record the anchor's state at click time, since the code may detach it after.
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({
        href: this.href,
        download: this.download,
        inDom: document.body.contains(this),
      });
    });
  });

  // Let any deferred revoke land, without assuming a specific delay.
  const settle = () => new Promise((r) => setTimeout(r, 20));

  afterEach(async () => {
    // Drain this test's pending cleanup timer before the next one starts.
    // Without this, a revoke scheduled here fires inside the following test and
    // lands in its freshly-reset arrays.
    await settle();
    vi.restoreAllMocks();
  });

  it('downloads under the week-stamped .xlsx filename', async () => {
    await downloadWeeklyReportXlsx(report(), '2026-05-25');

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('BBG-Week-2026-05-25.xlsx');
    expect(weeklyXlsxFilename('2026-05-25')).toBe('BBG-Week-2026-05-25.xlsx');
  });

  it('does not revoke the object URL in the same tick as the click', async () => {
    await downloadWeeklyReportXlsx(report(), '2026-05-25');

    // Firefox starts the download asynchronously; revoking synchronously here
    // invalidates the blob before it is read and the file never arrives.
    expect(clicked).toHaveLength(1);
    expect(revoked).toEqual([]);
  });

  it('still revokes the object URL once the download has started', async () => {
    await downloadWeeklyReportXlsx(report(), '2026-05-25');
    await settle();

    expect(revoked).toEqual(created);
    expect(revoked).toHaveLength(1);
  });

  it('attaches the anchor to the document so the synthetic click registers', async () => {
    await downloadWeeklyReportXlsx(report(), '2026-05-25');

    expect(clicked[0].inDom).toBe(true);
  });

  it('leaves no anchor behind in the document', async () => {
    const before = document.body.childElementCount;

    await downloadWeeklyReportXlsx(report(), '2026-05-25');
    await settle();

    expect(document.body.childElementCount).toBe(before);
  });
});

// The packing/address list, as a printable document.
//
// The .xlsx answers "what did the range sell". This answers "what goes in each
// parcel and where does it go" — the question asked while a box is open on the
// table. A spreadsheet is the wrong shape for it: an address wraps to three
// lines at a readable size, and a row that scrolls sideways cannot be packed
// from. So this renders one self-contained block per order and prints.
//
// It emits HTML for the browser's own print-to-PDF rather than pulling in a PDF
// library. jsPDF was removed from this project once already (see the header of
// weekly-xlsx.ts) and re-adding ~350kb to lay out text the browser lays out
// better is a poor trade — the print dialog saves a real PDF either way.
import type { WeeklyReport } from './build';

export type PackingListEntry = {
  /** Position on the printed sheet, 1-based — renumbered past cancelled orders. */
  index: number;
  invoice: string;
  date: string;
  buyer: string;
  phone: string;
  email: string;
  address: string;
  courier: string;
  items: string[];
  totalPhp: number;
};

export type PackingListMeta = {
  /** Which half of the range this is — "On-Hand" or "Group Buy". */
  title: string;
  rangeLabel: string;
};

const COURIER_UNASSIGNED = 'To be assigned';

/**
 * The report's rows, reduced to what a packer needs and renumbered.
 *
 * Cancelled orders are dropped rather than struck through: a printed sheet is
 * read at a glance, and a listed parcel gets made up. Renumbering follows, so
 * the sheet counts the parcels it actually describes.
 */
export function buildPackingList(report: WeeklyReport): PackingListEntry[] {
  return report.rows
    .filter((row) => !row.isCancelled)
    .map((row, i) => ({
      index: i + 1,
      invoice: row.invoice,
      date: row.date,
      buyer: row.customer,
      phone: row.phone,
      email: row.email,
      address: row.address,
      // Named as absent rather than left blank: an empty courier line reads as a
      // printing fault, and the packer cannot tell which it is.
      courier: row.courier || COURIER_UNASSIGNED,
      items: row.products,
      totalPhp: row.php,
    }));
}

// Buyer names, addresses and item snapshots are customer-supplied and this
// document is opened in a browser window. Interpolated raw, a name containing a
// script tag executes the moment the team prints the sheet.
const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const peso = (n: number): string =>
  '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const field = (label: string, value: string): string => `
  <div class="field">
    <div class="label">${escapeHtml(label)}</div>
    <div class="value">${escapeHtml(value)}</div>
  </div>`;

const entryBlock = (entry: PackingListEntry): string => `
  <article class="parcel">
    <header class="parcel-head">
      <span class="seq">${entry.index}</span>
      <span class="invoice">${escapeHtml(entry.invoice)}</span>
      <span class="date">${escapeHtml(entry.date)}</span>
      <span class="total">${escapeHtml(peso(entry.totalPhp))}</span>
    </header>
    <div class="grid">
      ${field('Buyer', entry.buyer)}
      ${field('Contact number', entry.phone)}
      ${field('Email', entry.email || '—')}
      ${field('Courier', entry.courier)}
    </div>
    ${field('Shipping address', entry.address)}
    <div class="field">
      <div class="label">Order details</div>
      <ul class="items">
        ${entry.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </div>
  </article>`;

/**
 * The whole printable document, as a standalone HTML string.
 *
 * Self-contained on purpose — it is written into a new window that shares no
 * stylesheet with the app, and a packing list that prints unstyled because a
 * CSS request lost a race is worse than no packing list.
 */
export function packingListHtml(entries: readonly PackingListEntry[], meta: PackingListMeta): string {
  const heading = `${meta.title} · ${meta.rangeLabel}`;
  const count = `${entries.length} ${entries.length === 1 ? 'parcel' : 'parcels'}`;

  const body = entries.length
    ? entries.map(entryBlock).join('')
    : '<p class="empty">No orders to pack in this range.</p>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(`BBG Packing List — ${heading}`)}</title>
<style>
  :root { --line: #d8ded6; --muted: #6b7a70; --ink: #1c2b26; }
  * { box-sizing: border-box; }
  body {
    font-family: Barlow, -apple-system, Segoe UI, Arial, sans-serif;
    color: var(--ink); margin: 0; padding: 18mm 14mm; font-size: 11pt; line-height: 1.35;
  }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  .meta { color: var(--muted); font-size: 9.5pt; margin: 0 0 8mm; }
  .parcel {
    border: 1px solid var(--line); border-radius: 3mm;
    padding: 5mm; margin-bottom: 5mm;
    /* A parcel split across two sheets is packed from half a description. */
    break-inside: avoid; page-break-inside: avoid;
  }
  .parcel-head {
    display: flex; gap: 4mm; align-items: baseline;
    border-bottom: 1px solid var(--line); padding-bottom: 2.5mm; margin-bottom: 3.5mm;
  }
  .seq {
    background: var(--ink); color: #fff; border-radius: 50%;
    width: 7mm; height: 7mm; display: inline-grid; place-items: center;
    font-size: 9pt; font-weight: 700; flex: none;
  }
  .invoice { font-weight: 700; font-size: 12.5pt; }
  .date { color: var(--muted); font-size: 9.5pt; }
  .total { margin-left: auto; font-weight: 700; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 6mm; }
  .field { margin-bottom: 2.5mm; }
  .label { color: var(--muted); font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; }
  .value { font-weight: 600; }
  .items { margin: 1mm 0 0; padding-left: 5mm; }
  .items li { margin-bottom: .8mm; }
  .empty { color: var(--muted); }
  @media print {
    body { padding: 0; }
    .parcel { break-inside: avoid; page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(`BBG Packing List — ${meta.title}`)}</h1>
  <p class="meta">${escapeHtml(`${meta.rangeLabel} · ${count}`)}</p>
  ${body}
</body>
</html>`;
}

/**
 * Open the packing list in a new window and raise the print dialog, where the
 * browser's own "Save as PDF" writes the file.
 *
 * Throws when the window cannot be opened. That is almost always a popup
 * blocker, and a button that silently does nothing is the worst version of
 * this — the caller surfaces the message as a toast.
 */
export function openPackingListPrint(
  entries: readonly PackingListEntry[],
  meta: PackingListMeta,
): void {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('Your browser blocked the print window. Allow pop-ups for this site and try again.');
  }

  printWindow.document.write(packingListHtml(entries, meta));
  printWindow.document.close();

  // Print after the document's own load settles: calling straight away prints a
  // blank sheet in Safari, which lays the written document out asynchronously.
  const print = () => printWindow.print();
  if (printWindow.document.readyState === 'complete') print();
  else printWindow.addEventListener('load', print, { once: true });
}

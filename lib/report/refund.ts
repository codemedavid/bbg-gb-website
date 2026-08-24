// Turning a supplier refund sheet into a list of people to pay back.
//
// When a batch arrives short, the supplier sends a sheet of what could not be
// filled — one row per SKU, a fraction of a kit, and a peso amount. That sheet
// carries no customer column, so it says what is owed without saying to whom,
// and the answer used to be reconstructed by hand against the order sheet.
//
// This module does that join. It is pure: no I/O, no clock. The route supplies
// the batch's order lines and the admin supplies the pasted sheet.
//
// Two rules it will not bend:
//
//  - The peso column is authoritative, never the KIT column. A "5 pairs" Skin
//    Repair variant is half a unit of the "10 pairs" one, so 0.1 kit is not
//    reliably one vial — but ₱395 is always ₱395.
//  - An amount is only ever DECIDED when the shortfall equals everything the
//    batch sold of that SKU. Anything else is handed to the admin with the
//    candidates listed. Splitting a partial shortfall is a judgement about
//    whose order goes unfilled, and guessing it moves someone's money.
import { round2 } from './money';

/** One row of the supplier's refund sheet. */
export type RefundShortfall = {
  /** The supplier's own SKU label, e.g. "BPC10" or "RT15 SF". */
  label: string;
  /** The KIT column — a fraction of a supplier kit. Informational only. */
  kits: number;
  /** The peso column. This is the figure everything is decided against. */
  php: number;
};

/** One order line from the batch being reconciled. */
export type RefundOrderLine = {
  orderNo: string;
  orderStatus: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  /** order_items.name_snapshot — what the customer actually bought. */
  productLabel: string;
  /** products.supplier_code, if the product has been mapped. */
  supplierCode: string | null;
  /** products.code — our own price-list code. */
  productCode: string | null;
  qty: number;
  lineTotalPhp: number;
  /** YYYY-MM-DD. */
  orderedOn: string;
};

export type RefundTier =
  /** Shortfall equals everything ordered — refund each buyer in full. */
  | 'CONFIRMED'
  /** More was ordered than the shortfall covers — the admin decides who. */
  | 'ALLOCATE'
  /** The sheet asks for more than the batch sold. Something is wrong upstream. */
  | 'SHORT'
  /** No line in the batch could be tied to this SKU. */
  | 'UNMATCHED';

export type RefundMatch = 'supplier_code' | 'product_code' | 'unit_price' | 'none';

export type RefundRow = {
  tier: RefundTier;
  sku: string;
  matchedBy: RefundMatch;
  product: string;
  orderNo: string;
  orderStatus: string;
  customer: string;
  phone: string;
  email: string;
  vialsOrdered: number;
  perVialPhp: number;
  skuRefundVials: number;
  skuRefundPhp: number;
  /** Null unless the tier is CONFIRMED. Blank in the CSV, never a zero. */
  refundDuePhp: number | null;
  orderedOn: string;
};

// Rows that are not SKUs. The sheet's own title, its column header and its
// total all paste in alongside the data, and a TOTAL row read as a SKU would
// double the whole export.
const NON_SKU_LABELS = new Set(['REFUND', 'PEPTIDE', 'KIT', 'TOTAL', 'SKU', 'ITEM']);

/** Compare codes by their letters and digits only: "rt15-sf" is "RT15 SF". */
const normalizeCode = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Read a money or quantity cell: strips ₱, spaces and thousands separators. */
function parseNumberCell(cell: string): number | null {
  const cleaned = cell.replace(/[₱,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Read a shortfall sheet pasted straight out of Excel.
 *
 * Tolerant on purpose — the admin copies a block of cells, and what lands on
 * the clipboard carries the sheet's empty leading column, its header and its
 * total. Anything unreadable comes back in `skipped` rather than being dropped:
 * a SKU that quietly failed to parse is a customer who quietly goes unpaid.
 */
export function parseShortfallPaste(text: string): { rows: RefundShortfall[]; skipped: string[] } {
  const rows: RefundShortfall[] = [];
  const skipped: string[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    // Tab first: an Excel paste is tab-separated, and a product label may
    // legitimately contain a comma. Only fall back to commas when there is no
    // tab at all, which is what a CSV export looks like.
    const cells = (rawLine.includes('\t') ? rawLine.split('\t') : rawLine.split(','))
      .map((c) => c.trim())
      .filter((c) => c !== '');

    if (cells.length === 0) continue;
    const [label, ...rest] = cells;
    if (NON_SKU_LABELS.has(label.toUpperCase())) { skipped.push(rawLine.trim()); continue; }

    // The last two readable numbers are the KIT and peso columns. Taken from
    // the end so an extra leading column cannot shift them.
    const numbers = rest.map(parseNumberCell).filter((n): n is number => n !== null);
    if (numbers.length < 2) { skipped.push(rawLine.trim()); continue; }

    rows.push({ label, kits: numbers[numbers.length - 2], php: numbers[numbers.length - 1] });
  }

  return { rows, skipped };
}

const perVialOf = (line: RefundOrderLine): number =>
  line.qty > 0 ? round2(line.lineTotalPhp / line.qty) : 0;

/**
 * Find the batch lines belonging to one sheet SKU, best signal first.
 *
 * The supplier's codes are not ours — BPC10 is our BPC157, NAD500 our NJ500 —
 * so an exact match is only possible once a product carries a supplier_code.
 * Until it does, the per-vial price stands in: it identified 24 of 27 SKUs on
 * the first batch reconciled this way, because the peso figure divided by the
 * vial count IS the kahati rate the line was billed at.
 *
 * The price fallback is a heuristic and is labelled as one in every row it
 * produces, so a wrong guess is visible on screen before any money moves.
 */
function matchLines(
  shortfall: RefundShortfall,
  lines: RefundOrderLine[],
): { lines: RefundOrderLine[]; matchedBy: RefundMatch } {
  const wanted = normalizeCode(shortfall.label);

  const bySupplier = lines.filter((l) => l.supplierCode && normalizeCode(l.supplierCode) === wanted);
  if (bySupplier.length) return { lines: bySupplier, matchedBy: 'supplier_code' };

  const byProduct = lines.filter((l) => l.productCode && normalizeCode(l.productCode) === wanted);
  if (byProduct.length) return { lines: byProduct, matchedBy: 'product_code' };

  const vials = Math.round(shortfall.kits * 10);
  if (vials > 0) {
    const perVial = round2(shortfall.php / vials);
    const byPrice = lines.filter((l) => perVialOf(l) === perVial);
    if (byPrice.length) return { lines: byPrice, matchedBy: 'unit_price' };
  }

  return { lines: [], matchedBy: 'none' };
}

/** The row that stands in for a SKU nothing could be matched to. */
function unmatchedRow(shortfall: RefundShortfall): RefundRow {
  return {
    tier: 'UNMATCHED', sku: shortfall.label, matchedBy: 'none', product: '',
    orderNo: '', orderStatus: '', customer: '', phone: '', email: '',
    vialsOrdered: 0, perVialPhp: 0,
    skuRefundVials: Math.round(shortfall.kits * 10), skuRefundPhp: shortfall.php,
    refundDuePhp: null, orderedOn: '',
  };
}

/**
 * Join a parsed shortfall sheet to a batch's order lines.
 *
 * Cancelled orders are left out for the same reason buildProductTotals leaves
 * them out: nobody is owed a refund on an order that was never going to ship,
 * and counting one would make a CONFIRMED total that does not reconcile.
 */
export function buildRefundRows(
  shortfalls: RefundShortfall[],
  lines: RefundOrderLine[],
): RefundRow[] {
  const live = lines.filter((l) => l.orderStatus !== 'cancelled');

  return shortfalls.flatMap((shortfall): RefundRow[] => {
    const { lines: matched, matchedBy } = matchLines(shortfall, live);
    if (!matched.length) return [unmatchedRow(shortfall)];

    const orderedPhp = round2(matched.reduce((sum, l) => sum + l.lineTotalPhp, 0));
    const refundPhp = round2(shortfall.php);
    // Compared after rounding to centavos, so three lines of ₱447.50 reconcile
    // against a sheet's ₱1,342.50 instead of missing it by a float's width.
    const tier: RefundTier =
      orderedPhp === refundPhp ? 'CONFIRMED' : orderedPhp > refundPhp ? 'ALLOCATE' : 'SHORT';

    return matched.map((l) => ({
      tier,
      sku: shortfall.label,
      matchedBy,
      product: l.productLabel,
      orderNo: l.orderNo,
      orderStatus: l.orderStatus,
      customer: l.customerName,
      phone: l.customerPhone,
      email: l.customerEmail,
      vialsOrdered: l.qty,
      perVialPhp: perVialOf(l),
      skuRefundVials: Math.round(shortfall.kits * 10),
      skuRefundPhp: refundPhp,
      // Only a CONFIRMED SKU has a decided amount: the shortfall is the whole
      // of what was sold, so each buyer's own line total is what they are owed.
      refundDuePhp: tier === 'CONFIRMED' ? round2(l.lineTotalPhp) : null,
      orderedOn: l.orderedOn,
    }));
  });
}

export type RefundSummary = {
  /** Money that can be sent today, with no allocation decision outstanding. */
  confirmedPhp: number;
  confirmedRows: number;
  /** Money whose recipients the admin still has to choose. */
  allocatePhp: number;
  allocateRows: number;
  /** Money the sheet asks for that the batch never sold. */
  shortPhp: number;
  /** Money against SKUs that could not be tied to any order line. */
  unmatchedPhp: number;
  unmatchedSkus: string[];
  /** What the sheet asks for in total, for tying back to its own TOTAL row. */
  sheetTotalPhp: number;
};

/** Per-tier totals, counting each SKU's peso figure once however many rows it made. */
export function refundSummary(rows: RefundRow[]): RefundSummary {
  const seen = new Set<string>();
  const summary: RefundSummary = {
    confirmedPhp: 0, confirmedRows: 0, allocatePhp: 0, allocateRows: 0,
    shortPhp: 0, unmatchedPhp: 0, unmatchedSkus: [], sheetTotalPhp: 0,
  };

  for (const row of rows) {
    if (row.tier === 'CONFIRMED') summary.confirmedRows += 1;
    if (row.tier === 'ALLOCATE') summary.allocateRows += 1;

    // A SKU spread over several buyers must not have its peso figure added once
    // per buyer, or the totals read several times what is actually owed.
    if (seen.has(row.sku)) continue;
    seen.add(row.sku);
    summary.sheetTotalPhp = round2(summary.sheetTotalPhp + row.skuRefundPhp);
    if (row.tier === 'CONFIRMED') summary.confirmedPhp = round2(summary.confirmedPhp + row.skuRefundPhp);
    if (row.tier === 'ALLOCATE') summary.allocatePhp = round2(summary.allocatePhp + row.skuRefundPhp);
    if (row.tier === 'SHORT') summary.shortPhp = round2(summary.shortPhp + row.skuRefundPhp);
    if (row.tier === 'UNMATCHED') {
      summary.unmatchedPhp = round2(summary.unmatchedPhp + row.skuRefundPhp);
      summary.unmatchedSkus.push(row.sku);
    }
  }

  return summary;
}

const CSV_HEADER = [
  'tier', 'sku', 'matched_by', 'product', 'order_no', 'order_status',
  'customer', 'phone', 'email', 'vials_ordered', 'per_vial_php',
  'sku_refund_vials', 'sku_refund_php', 'refund_due_php', 'ordered_on',
] as const;

// Names carry commas ("Cruz, Angelie") and product labels carry quotes, either
// of which shifts every column after it if written raw.
const csvCell = (v: string | number | null): string => {
  if (v === null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The refund list as CSV, ready to open in Excel and work through. */
export function refundCsv(rows: RefundRow[]): string {
  const body = rows.map((r) => [
    r.tier, r.sku, r.matchedBy, r.product, r.orderNo, r.orderStatus,
    r.customer, r.phone, r.email, r.vialsOrdered, r.perVialPhp,
    r.skuRefundVials, r.skuRefundPhp, r.refundDuePhp, r.orderedOn,
  ].map(csvCell).join(','));

  return [CSV_HEADER.join(','), ...body].join('\n');
}

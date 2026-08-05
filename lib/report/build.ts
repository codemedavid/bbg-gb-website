// Pure builder that turns a week's orders into the weekly-report structure the PDF
// renders. No I/O, no clock — fully testable.
import { PAID_STATUSES, PAYMENT_STATUS_LABEL, PENDING_STATUSES, REPORT_STATUS_LABEL } from './constants';
import { num } from './money';
import { buildProductTotals, type ProductTotals } from './product-totals';
import { formatRange, isoWeekNumber } from './week';

export type ReportItem = {
  nameSnapshot: string;
  qty: number;
  unitPriceUsd: string | null;
  unitPricePhp: string;
  // Product-rollup fields, joined from `products` at query time. All optional:
  // kahati and MOQ lines reference no product row and legitimately have none.
  productId?: string | null;
  specSnapshot?: string | null;
  /** Price-list code, e.g. "TR30". */
  code?: string | null;
  /** Vials per supplier kit; 1 for anything sold per piece. */
  kitSize?: number | null;
  /**
   * order_items.kind — 'product' for on-hand, otherwise a counter, campaign or
   * MOQ-shelf line. Optional: it is only needed to place the order on one side
   * of the on-hand / group-buy split (see segment.ts), and callers written
   * before that split omit it.
   */
  kind?: string | null;
};

export type ReportOrderInput = {
  orderNo: string;
  status: string;
  /**
   * orders.buy_type — 'solo' for the on-hand shop, 'kahati' / 'group_buy' /
   * 'moq' for anything ordered against a batch. Optional so callers predating
   * the report split keep compiling; segment.ts falls back to the item kinds.
   */
  buyType?: string;
  createdAt: string; // ISO instant
  shipName: string;
  shipPhone: string;
  customerEmail: string | null;
  shipAddress: string;
  courier: string | null;
  packedBy: string | null;
  paymentMethod: string | null;
  totalUsd: string | null;
  totalPhp: string;
  items: ReportItem[];
};

export type ReportRow = {
  index: number;
  invoice: string;
  date: string;
  customer: string;
  /** Kept for the legacy single-cell layout; spreadsheets use phone/email. */
  contact: string;
  phone: string;
  email: string;
  address: string;
  products: string[]; // one line per item, e.g. "Tirzepatide TR15 x5 @ $6.80"
  courier: string;
  packedBy: string;
  payment: string;
  /** Whether the money cleared: Pending / Paid / Refunded. */
  paymentStatus: string;
  /** Where the order sits in fulfilment: Payment Verification / Shipped / ... */
  orderStatus: string;
  /** @deprecated Use orderStatus — kept so older callers keep compiling. */
  status: string;
  usd: number;
  php: number;
};

export type WeeklyReport = {
  weekNo: number;
  rangeLabel: string; // "Mon May 25 – Sun May 31"
  orderCount: number;
  counts: { paid: number; pending: number; cancelled: number };
  totals: { usd: number; php: number };
  rows: ReportRow[];
  /** The same week's orders rolled up per product, for the batch order. */
  productTotals: ProductTotals;
};

// Manila-local M/D/YYYY for an ISO instant (report matches the +08:00 sample).
function manilaDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
}

function usdLine(item: ReportItem): string {
  const base = `${item.nameSnapshot} x${item.qty}`;
  const usd = num(item.unitPriceUsd);
  return usd > 0 ? `${base} @ $${usd.toFixed(2)}` : base;
}

export function buildWeeklyReport(mondayYmd: string, orders: ReportOrderInput[]): WeeklyReport {
  const rows: ReportRow[] = orders.map((o, i) => ({
    index: i + 1,
    invoice: o.orderNo,
    date: manilaDate(o.createdAt),
    customer: o.shipName,
    contact: [o.shipPhone, o.customerEmail].filter(Boolean).join('\n'),
    phone: o.shipPhone,
    email: o.customerEmail ?? '',
    address: o.shipAddress,
    products: o.items.map(usdLine),
    courier: o.courier || '',
    packedBy: o.packedBy || '',
    payment: o.paymentMethod || '',
    paymentStatus: PAYMENT_STATUS_LABEL[o.status] ?? o.status,
    orderStatus: REPORT_STATUS_LABEL[o.status] ?? o.status,
    status: REPORT_STATUS_LABEL[o.status] ?? o.status,
    usd: num(o.totalUsd),
    php: num(o.totalPhp),
  }));

  const counts = orders.reduce(
    (acc, o) => {
      if (o.status === 'cancelled') acc.cancelled += 1;
      else if (PAID_STATUSES.has(o.status)) acc.paid += 1;
      else if (PENDING_STATUSES.has(o.status)) acc.pending += 1;
      return acc;
    },
    { paid: 0, pending: 0, cancelled: 0 },
  );

  const totals = orders.reduce(
    (acc, o) => {
      // Cancelled orders don't contribute to the money totals.
      if (o.status !== 'cancelled') {
        acc.usd += num(o.totalUsd);
        acc.php += num(o.totalPhp);
      }
      return acc;
    },
    { usd: 0, php: 0 },
  );

  return {
    weekNo: isoWeekNumber(mondayYmd),
    rangeLabel: formatRange(mondayYmd),
    orderCount: orders.length,
    counts,
    totals,
    rows,
    productTotals: buildProductTotals(orders),
  };
}

// Which half of the weekly report an order belongs to.
//
// The batch order is sized off the Product Totals sheet, and that sheet used to
// mix on-hand sales — already fulfilled from stock in the stockroom — into the
// same kit counts as the vials still owed to the supplier. The two are separate
// reports because they answer separate questions: on-hand asks "what left the
// shelf", group buy asks "what do we order".
//
// Pure: no I/O, no clock. The ReportOrderInput type is a type-only import from
// build.ts, so the value dependency runs one way (build.ts → here) and there is
// no import cycle — the same arrangement product-totals.ts uses.
import type { ReportOrderInput } from './build';

export type ReportSegment = 'onhand' | 'groupbuy' | 'kahati';

/** Emit order for anything that renders both halves. */
export const REPORT_SEGMENTS: readonly ReportSegment[] = ['onhand', 'groupbuy', 'kahati'] as const;

export const SEGMENT_LABEL: Record<ReportSegment, string> = {
  onhand: 'On-Hand',
  groupbuy: 'Group Buy',
  kahati: 'Kahati',
};

// The short form, for worksheet tabs and buttons. Excel rejects / \ ? * [ ] in
// a worksheet name and truncates past 31 characters — a workbook carrying
// either fails to open — so SEGMENT_LABEL cannot be used verbatim there.
export const SEGMENT_SHORT_LABEL: Record<ReportSegment, string> = {
  onhand: 'On-Hand',
  groupbuy: 'Group Buy',
  kahati: 'Kahati',
};

// orders.buy_type, as written by checkout (lib/order-modes.ts), grouped by the
// segment it belongs to. 'solo' is the on-hand shop; the other three are all
// pre-ordered against a batch and belong on the supplier's side of the split.
//
// Exported because the admin orders board splits its list the same way, and two
// copies of this mapping would be one page-load away from disagreeing about
// where MOQ orders go.
export const SEGMENT_BUY_TYPES: Record<ReportSegment, readonly string[]> = {
  onhand: ['solo'],
  groupbuy: ['group_buy', 'moq'],
  kahati: ['kahati'],
};

/** Narrows an untrusted string — a query param, a route slug — to a segment. */
export function isReportSegment(value: unknown): value is ReportSegment {
  return typeof value === 'string' && (REPORT_SEGMENTS as readonly string[]).includes(value);
}

const GROUP_BUY_TYPES = new Set(SEGMENT_BUY_TYPES.groupbuy);

// order_items.kind, the second signal. 'product' is an on-hand line; everything
// else references a counter, a campaign or the MOQ shelf.
const GROUP_BUY_ITEM_KINDS = new Set(['group_buy', 'moq_campaign', 'moq_product']);

/**
 * The half of the report an order belongs to.
 *
 * Checkout splits a mixed cart into one order per mode (splitCartIntoOrders), so
 * no order straddles both halves and an order-level rule is sound.
 *
 * Both signals are consulted because `orders.buy_type` is NOT NULL with a 'solo'
 * default: a row written before that column was populated reads as on-hand even
 * when its lines are hatian vials, which would put those vials into the on-hand
 * report and drop them from the batch order entirely. The item kinds catch it.
 */
export function segmentOfOrder(order: ReportOrderInput): ReportSegment {
  if (order.buyType === 'kahati') return 'kahati';
  if (order.buyType && GROUP_BUY_TYPES.has(order.buyType)) return 'groupbuy';
  if (order.items.some((i) => i.kind === 'group_buy')) return 'kahati';
  if (order.items.some((i) => i.kind && GROUP_BUY_ITEM_KINDS.has(i.kind))) return 'groupbuy';
  return 'onhand';
}

/** Split a week's orders in two, preserving the incoming order within each half. */
export function partitionBySegment(
  orders: ReportOrderInput[],
): Record<ReportSegment, ReportOrderInput[]> {
  const halves: Record<ReportSegment, ReportOrderInput[]> = { onhand: [], groupbuy: [], kahati: [] };
  for (const order of orders) {
    halves[segmentOfOrder(order)].push(order);
  }
  return halves;
}

// Cart segmentation and the checkout order-split.
//
// Per the storefront SRS, the three purchasing modes are never combined in one
// order: a mixed cart checks out as one distinct order per mode, each with its
// own fees and lifecycle. This module maps items to modes and performs that split.

import { computeTotals, type OrderTotals, type PriceableItem } from './pricing';

export type PurchaseMode = 'solo' | 'kahati' | 'group_buy';

// Deterministic emit order for split orders and receipts.
export const PURCHASE_MODES: readonly PurchaseMode[] = ['solo', 'kahati', 'group_buy'] as const;

export function modeOf(item: PriceableItem): PurchaseMode {
  switch (item.kind) {
    case 'group_buy':
      return 'kahati';
    case 'moq_campaign':
      return 'group_buy';
    case 'product':
    default:
      return 'solo';
  }
}

export type CartSegments = Record<PurchaseMode, PriceableItem[]>;

export function segmentByMode(items: PriceableItem[]): CartSegments {
  const segments: CartSegments = { solo: [], kahati: [], group_buy: [] };
  for (const item of items) {
    segments[modeOf(item)].push(item);
  }
  return segments;
}

export type OrderDraft = {
  mode: PurchaseMode;
  items: PriceableItem[];
  totals: OrderTotals;
};

// Split a cart into one OrderDraft per non-empty mode, in PURCHASE_MODES order.
export function splitCartIntoOrders(items: PriceableItem[]): OrderDraft[] {
  const segments = segmentByMode(items);
  return PURCHASE_MODES.filter((mode) => segments[mode].length > 0).map((mode) => ({
    mode,
    items: segments[mode],
    totals: computeTotals(segments[mode]),
  }));
}

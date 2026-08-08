'use client';
import { php } from '@/lib/format';
import type { OrderItem } from '@/lib/types';

// Every line on an order — name, variant, quantity, unit price, line total.
//
// My Orders previously named the first item and appended "+N more", so a
// customer with a twelve-line order could not see what they had bought from
// their own order screen. Nothing here slices, caps or summarises the array it
// is given: a long order is capped in HEIGHT and scrolls, which keeps the whole
// order reachable while keeping the card a sane size.
//
// Presentational. Money comes from the order's stored snapshots and is never
// recomputed here — lib/pricing.ts owns that, and a second implementation is
// how a receipt gets to disagree with what was charged.

/**
 * Rows past which the list scrolls instead of growing.
 *
 * Six lines is roughly a phone screen's worth. Below it the list is short
 * enough to read at a glance and a scroll box would be pure friction.
 */
const SCROLL_AFTER = 6;

function ItemRow({ item }: { item: OrderItem }) {
  return (
    <li className="flex items-start gap-3 py-2">
      {/* min-w-0 is what lets a long peptide name wrap instead of forcing the
          row wider than the card — the horizontal-overflow failure on a 320px
          screen starts here. */}
      <div className="min-w-0 flex-1">
        <div className="break-words text-[13px] font-bold leading-snug text-ink">{item.nameSnapshot}</div>
        {item.specSnapshot && (
          <div className="break-words text-[11.5px] leading-snug text-ink-muted">{item.specSnapshot}</div>
        )}
        <div className="mt-0.5 text-[11.5px] text-ink-muted">
          <span className="font-semibold text-ink-body">Qty: {item.qty}</span>
          {' · '}
          {php(item.unitPricePhp)} each
        </div>
      </div>
      <strong className="flex-none text-right text-[13px] text-ink">{php(item.lineTotalPhp)}</strong>
    </li>
  );
}

export function OrderItemList({ items }: { items: OrderItem[] }) {
  const list = (
    <ul className="m-0 flex list-none flex-col divide-y divide-line-soft p-0">
      {items.map((i) => <ItemRow key={i.id} item={i} />)}
    </ul>
  );

  if (items.length <= SCROLL_AFTER) return list;

  // tabIndex makes the scroll box reachable without a pointer. A scrollable
  // region that only answers a mouse wheel hides the tail of the order from
  // keyboard and screen-reader users, which is the same truncation bug wearing
  // a different hat.
  return (
    <div
      role="region"
      aria-label={`Ordered items, ${items.length} items`}
      tabIndex={0}
      className="max-h-[280px] overflow-y-auto rounded-[10px] border border-line-soft px-3"
    >
      {list}
    </div>
  );
}

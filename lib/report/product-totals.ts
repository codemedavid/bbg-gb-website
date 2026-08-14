// Per-product rollup for the weekly report.
//
// The order sheet answers "what did each buyer order". The batch order asks the
// opposite question — "how many vials of TR30 do we owe the supplier this week" —
// and the team was re-deriving that by hand off the order sheet every week.
//
// Pure: no I/O, no clock. Types come from build.ts as type-only imports, so the
// value dependency runs one way (build.ts → here) and there is no import cycle.
import { num, round2 } from './money';
import type { ReportOrderInput } from './build';

export type ProductTotalRow = {
  /** Rank within the week, 1-based — highest quantity first. */
  index: number;
  name: string;
  /** Price-list code, e.g. "TR30". Empty for lines with no linked product. */
  code: string;
  spec: string;
  usd: number;
  qty: number;
  /** Supplier units: qty ÷ the product's kit size. May be fractional. */
  kits: number;
};

export type ProductTotals = {
  rows: ProductTotalRow[];
  totals: { usd: number; qty: number };
};

type Group = Omit<ProductTotalRow, 'index' | 'kits'> & { kitSize: number };

// Kahati and MOQ lines carry no product row, so there is no kit size to divide
// by. Falling back to 1 reports them one-kit-per-unit rather than inventing a
// division by 10 that would silently under-report what to order.
const kitSizeOf = (size: number | null | undefined): number =>
  typeof size === 'number' && size > 0 ? size : 1;

export function buildProductTotals(orders: ReportOrderInput[]): ProductTotals {
  const groups = new Map<string, Group>();

  for (const order of orders) {
    // Cancelled orders are excluded here for the same reason buildWeeklyReport
    // excludes them from its money totals: nobody is shipping those vials.
    if (order.status === 'cancelled') continue;

    for (const item of order.items) {
      // Two variants of one product (TR15, TR30) are distinct rows, so the key
      // is the product itself. Lines with no product row fall back to their
      // snapshots, which is the only identity they have.
      const key = item.productId ?? `${item.nameSnapshot}|${item.specSnapshot ?? ''}`;
      const usd = num(item.unitPriceUsd) * item.qty;
      const seen = groups.get(key);

      groups.set(key, seen
        ? { ...seen, usd: seen.usd + usd, qty: seen.qty + item.qty }
        : {
            name: item.nameSnapshot,
            code: item.code ?? '',
            spec: item.specSnapshot ?? '',
            kitSize: kitSizeOf(item.kitSize),
            usd,
            qty: item.qty,
          });
    }
  }

  // Quantity is what the batch order is sized by, so it leads. USD then name
  // break ties — without them, row order would follow insertion and shuffle
  // between runs of the same week.
  const rows = [...groups.values()]
    .sort((a, b) => b.qty - a.qty || b.usd - a.usd || a.name.localeCompare(b.name))
    .map((g, i) => ({
      index: i + 1,
      name: g.name,
      code: g.code,
      spec: g.spec,
      usd: round2(g.usd),
      qty: g.qty,
      kits: g.qty / g.kitSize,
    }));

  return {
    rows,
    totals: {
      usd: round2(rows.reduce((sum, r) => sum + r.usd, 0)),
      qty: rows.reduce((sum, r) => sum + r.qty, 0),
    },
  };
}

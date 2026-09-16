import type { ReportOrderInput } from './build';
import { num, round2 } from './money';
import { segmentOfOrder } from './segment';

export type KahatiCartRow = { product: string; qty: number; amountPhp: number; counterIds?: string[] };

export function buildKahatiCart(orders: readonly ReportOrderInput[]): KahatiCartRow[] {
  const groups = new Map<string, KahatiCartRow>();
  for (const order of orders) {
    if (order.status === 'cancelled' || segmentOfOrder(order) !== 'kahati') continue;
    for (const item of order.items) {
      if (item.qty <= 0) continue;
      const name = item.nameSnapshot.trim();
      const spec = item.specSnapshot?.trim() ?? '';
      const product = spec && !name.toLowerCase().endsWith(spec.toLowerCase()) ? `${name} ${spec}` : name;
      const key = item.productId ?? JSON.stringify([item.code ?? '', name, spec]);
      const previous = groups.get(key);
      groups.set(key, {
        product, qty: (previous?.qty ?? 0) + item.qty,
        amountPhp: (previous?.amountPhp ?? 0) + num(item.unitPricePhp) * item.qty,
        counterIds: [...new Set([...(previous?.counterIds ?? []), ...(item.groupBuyId ? [item.groupBuyId] : [])])],
      });
    }
  }
  return [...groups.values()].map(row => ({ ...row, amountPhp: round2(row.amountPhp) }))
    .sort((a, b) => b.qty - a.qty || a.product.localeCompare(b.product));
}

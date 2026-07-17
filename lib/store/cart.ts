import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CartItem = {
  key: string;                    // stable dedupe key (product:id / gb:id)
  kind: 'product' | 'group_buy';
  refId: string;
  name: string;
  spec: string;
  unitPricePhp: number;
  qty: number;
  minQty: number;                 // 1 for products, the group buy's minVials for kahati
  repackFeePhp?: number;          // kahati only — the group buy's admin-editable fee
};

type CartState = {
  items: CartItem[];
  add: (item: Omit<CartItem, 'qty'> & { qty?: number }) => void;
  setQty: (key: string, qty: number) => void;
  inc: (key: string) => void;
  dec: (key: string) => void;
  remove: (key: string) => void;
  clear: () => void;
  count: () => number;
  subtotal: () => number;
  hasSolo: () => boolean;
  hasKahati: () => boolean;
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item) => set((s) => {
        const existing = s.items.find((i) => i.key === item.key);
        const qty = item.qty ?? item.minQty ?? 1;
        if (existing) {
          return { items: s.items.map((i) => i.key === item.key ? { ...i, qty: i.qty + qty } : i) };
        }
        return { items: [...s.items, { ...item, qty }] };
      }),
      setQty: (key, qty) => set((s) => ({
        items: s.items.map((i) => i.key === key ? { ...i, qty: Math.max(i.minQty, qty) } : i),
      })),
      inc: (key) => set((s) => ({ items: s.items.map((i) => i.key === key ? { ...i, qty: i.qty + 1 } : i) })),
      dec: (key) => set((s) => {
        const item = s.items.find((i) => i.key === key);
        if (item && item.qty <= item.minQty) return { items: s.items.filter((i) => i.key !== key) };
        return { items: s.items.map((i) => i.key === key ? { ...i, qty: i.qty - 1 } : i) };
      }),
      remove: (key) => set((s) => ({ items: s.items.filter((i) => i.key !== key) })),
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((a, i) => a + i.qty, 0),
      subtotal: () => get().items.reduce((a, i) => a + i.qty * i.unitPricePhp, 0),
      hasSolo: () => get().items.some((i) => i.kind === 'product'),
      hasKahati: () => get().items.some((i) => i.kind === 'group_buy'),
    }),
    { name: 'bbg-cart' }
  )
);

export const SHIPPING_PHP = 180;
export const REPACK_FEE_PHP = 150;
export const shippingFor = (hasSolo: boolean) => (hasSolo ? SHIPPING_PHP : 0);

// Mirrors server/src/lib/pricing.ts: one repack fee per order, highest applies
// across kahati items. Carts persisted before repackFeePhp existed fall back to the default.
export const repackFor = (items: CartItem[]) => {
  const fees = items.filter((i) => i.kind === 'group_buy').map((i) => i.repackFeePhp ?? REPACK_FEE_PHP);
  return fees.length ? Math.max(...fees) : 0;
};

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PACKING_FEE_PHP, vialsFor, type OnHandUnit, type PackingFees } from '@/lib/pricing';

export type CartItem = {
  key: string;                    // stable dedupe key (product:id:unit / gb:id)
  kind: 'product' | 'group_buy';
  refId: string;
  name: string;
  spec: string;
  unitPricePhp: number;
  qty: number;
  minQty: number;                 // 1 for on-hand products, the group buy's minVials for kahati
  packingFeePhp?: number;         // kahati only — the group buy's admin-editable packing fee
  // On-hand only: which unit is being bought and how many vials are left. Stock
  // is counted in vials, so a kit line consumes VIALS_PER_KIT per qty.
  unit?: OnHandUnit;
  stock?: number;
};

// Largest qty of this line the remaining stock allows. Kahati lines and any line
// without a known stock figure are uncapped here — the server is the real gate.
export const maxQtyFor = (item: CartItem): number => {
  if (item.kind !== 'product' || item.stock == null) return Infinity;
  return Math.floor(item.stock / vialsFor(item.unit ?? 'piece', 1));
};

// Hold a line between its minimum and what stock allows, so the cart can never
// show a quantity checkout would reject.
const clampQty = (item: CartItem): CartItem => ({
  ...item,
  qty: Math.min(Math.max(item.minQty, item.qty), maxQtyFor(item)),
});

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
  hasOnHand: () => boolean;
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
          return { items: s.items.map((i) => i.key === item.key ? clampQty({ ...i, qty: i.qty + qty }) : i) };
        }
        return { items: [...s.items, clampQty({ ...item, qty })] };
      }),
      setQty: (key, qty) => set((s) => ({
        items: s.items.map((i) => i.key === key ? clampQty({ ...i, qty }) : i),
      })),
      inc: (key) => set((s) => ({ items: s.items.map((i) => i.key === key ? clampQty({ ...i, qty: i.qty + 1 }) : i) })),
      dec: (key) => set((s) => {
        const item = s.items.find((i) => i.key === key);
        if (item && item.qty <= item.minQty) return { items: s.items.filter((i) => i.key !== key) };
        return { items: s.items.map((i) => i.key === key ? { ...i, qty: i.qty - 1 } : i) };
      }),
      remove: (key) => set((s) => ({ items: s.items.filter((i) => i.key !== key) })),
      clear: () => set({ items: [] }),
      count: () => get().items.reduce((a, i) => a + i.qty, 0),
      subtotal: () => get().items.reduce((a, i) => a + i.qty * i.unitPricePhp, 0),
      hasOnHand: () => get().items.some((i) => i.kind === 'product'),
      hasKahati: () => get().items.some((i) => i.kind === 'group_buy'),
    }),
    { name: 'bbg-cart' }
  )
);

// Mirrors lib/pricing.ts packingFeeFor: one packing fee per fulfillment mode
// present (local shipping included, no admin fee). The cart only ever holds
// on-hand (product) and kahati (group_buy) items — MOQ campaigns commit through
// their own flow.
//
// `fees` is the admin-editable set fetched at display time. Both legs read from
// it: the kahati leg previously fell back to the PACKING_FEE_PHP constant, so
// editing the Hatian packing fee in the admin panel never reached the cart.
// A per-listing fee on a kahati item still wins over the global default.
export const packingFeeFor = (items: CartItem[], fees: PackingFees = PACKING_FEE_PHP): number => {
  let total = 0;
  if (items.some((i) => i.kind === 'product')) total += fees.solo;
  const kahatiFees = items.filter((i) => i.kind === 'group_buy').map((i) => i.packingFeePhp ?? fees.kahati);
  if (kahatiFees.length) total += Math.max(...kahatiFees);
  return total;
};

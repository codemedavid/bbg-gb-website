import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PACKING_FEE_PHP, vialsFor, type OnHandUnit, type PackingFees } from '@/lib/pricing';
import type { MoqProduct } from '@/lib/types';

// `kind` is the wire contract with POST /api/orders: app/checkout/page.tsx
// forwards it verbatim, so these values must stay identical to the route's
// accepted line kinds. They diverged once ('moq' here, 'moq_product' there) and
// broke every MOQ checkout — see app/api/orders/cart-contract.test.ts.
export type CartItem = {
  key: string;                    // stable dedupe key (product:id:unit / gb:id / moq:id)
  kind: 'product' | 'group_buy' | 'moq_product';
  refId: string;
  name: string;
  spec: string;
  unitPricePhp: number;
  qty: number;
  minQty: number;                 // 1 for on-hand, the group buy's minVials for kahati, the product's minOrderQty for MOQ
  packingFeePhp?: number;         // kahati and MOQ — the listing's admin-editable packing fee
  // How much is left. On-hand stock is counted in vials, so a kit line consumes
  // VIALS_PER_KIT per qty; an MOQ line consumes one per qty; a kahati line's
  // figure is the hatian's remaining open vials at join time.
  unit?: OnHandUnit;
  stock?: number;
};

// Largest qty of this line the remaining stock allows. A line without a known
// stock figure is uncapped here — the server is the real gate.
export const maxQtyFor = (item: CartItem): number => {
  if (item.stock == null) return Infinity;
  // MOQ lines are sold by the unit, so stock caps quantity directly.
  if (item.kind === 'moq_product') return item.stock;
  // Kahati lines cap at the hatian's remaining vials, so repeated Join taps
  // clamp instead of accumulating a commitment checkout would reject.
  if (item.kind === 'group_buy') return item.stock;
  if (item.kind !== 'product') return Infinity;
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
  hasMoq: () => boolean;
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
      hasMoq: () => get().items.some((i) => i.kind === 'moq_product'),
    }),
    {
      name: 'bbg-cart',
      // Do not read localStorage during store init. On the server there is no
      // cart, so SSR renders an empty one; syncing that read to import time would
      // let the client's first render show a filled cart against the server's
      // empty HTML — the mismatch React reports as #418. useHydrateCart()
      // rehydrates after mount instead.
      skipHydration: true,
    }
  )
);

// Mirrors lib/pricing.ts packingFeeFor: one packing fee per fulfillment mode
// present (local shipping included, no admin fee). The cart holds on-hand
// (product), kahati (group_buy) and MOQ-shelf (moq) items — Group Buy (MOQ
// campaign) commitments still go through their own flow.
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
  const moqFees = items.filter((i) => i.kind === 'moq_product').map((i) => i.packingFeePhp ?? fees.moq);
  if (moqFees.length) total += Math.max(...moqFees);
  return total;
};

// Builds the cart line for an MOQ product. Lives here rather than inline in the
// MOQ board so the cart->checkout contract test can exercise the exact line the
// storefront produces, instead of restating it and drifting from it.
export const moqCartLine = (p: MoqProduct): CartItem => ({
  key: `moq:${p.id}`,
  kind: 'moq_product',
  refId: p.id,
  name: p.name,
  spec: p.spec,
  unitPricePhp: Number(p.pricePhp),
  // MOQ lines start at the product's minimum: a line seeded at 1 would be
  // rejected by checkout.
  minQty: p.minOrderQty,
  qty: p.minOrderQty,
  stock: p.stock,
  packingFeePhp: p.packingFeePhp != null ? Number(p.packingFeePhp) : undefined,
});

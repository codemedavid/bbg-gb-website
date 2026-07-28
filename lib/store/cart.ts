import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PACKING_FEE_PHP, isDeferredPackingMode, vialsFor, type OnHandUnit, type PackingFees, type PackingMode } from '@/lib/pricing';
import type { MoqCampaign, MoqProduct } from '@/lib/types';

// `kind` is the wire contract with POST /api/orders: app/checkout/page.tsx
// forwards it verbatim, so these values must stay identical to the route's
// accepted line kinds. They diverged once ('moq' here, 'moq_product' there) and
// broke every MOQ checkout — see app/api/orders/cart-contract.test.ts.
export type CartItem = {
  key: string;                    // stable dedupe key (product:id:unit / gb:id / gbuy:id / moq:id)
  kind: 'product' | 'group_buy' | 'moq_campaign' | 'moq_product';
  refId: string;
  name: string;
  spec: string;
  unitPricePhp: number;
  qty: number;
  minQty: number;                 // 1 for on-hand, minVials for kahati, perCustomerMin for a group buy, minOrderQty for MOQ
  packingFeePhp?: number;         // kahati, group buy and MOQ — the listing's admin-editable packing fee
  // How much is left. On-hand stock is counted in vials, so a kit line consumes
  // VIALS_PER_KIT per qty; an MOQ line consumes one per qty. Kahati lines carry
  // none — they are uncapped (see maxQtyFor).
  unit?: OnHandUnit;
  stock?: number;
  // Group buy lines only: the batch series this commitment belongs to. The
  // packing fee is waived per SERIES, not per batch — a batch that fills seals
  // and opens a successor carrying the same terms, and to the customer that is
  // still one group buy. Carried on the line so the cart can price the waiver
  // the same way the server does (lib/campaign-commitment.ts).
  seriesId?: string;
};

// Largest qty of this line the remaining stock allows. A line without a known
// stock figure is uncapped here — the server is the real gate.
export const maxQtyFor = (item: CartItem): number => {
  // Kahati lines have no ceiling: vials are not drawn from a shelf. Checkout
  // fills the counter, seals it at 10, opens a fresh one and keeps rolling for
  // as many kits as the commitment needs — so any qty at or above the minimum is
  // valid. Checked before `stock` so a cart persisted while the line still
  // carried a kit cap stops clamping too.
  if (item.kind === 'group_buy') return Infinity;
  // A group buy line is uncapped for the same reason: a commitment beyond the
  // batch's room fills it, seals it and rolls into the successor the fill
  // opens, for as many batches as it takes. Checked before `stock` so a line
  // persisted with a stale figure stops clamping too.
  if (item.kind === 'moq_campaign') return Infinity;
  if (item.stock == null) return Infinity;
  // MOQ lines are sold by the unit, so stock caps quantity directly.
  if (item.kind === 'moq_product') return item.stock;
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
  hasGroupBuy: () => boolean;
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
      hasGroupBuy: () => get().items.some((i) => i.kind === 'moq_campaign'),
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

// Mirrors lib/pricing.ts packingFeeFor: one packing fee per charged-at-checkout
// mode present (each mode ships as its own parcel), local shipping included, no
// admin fee. Client rule — "packing fee per checkout, hindi per product": several
// different vials/products that ship together are one fee, not one each. Within a
// mode the largest listing fee applies, since the parcel costs at least its
// priciest item to pack. A cart mixing modes adds one fee per mode.
//
// Kahati lines add nothing: the hatian fee is deferred and charged once at the
// final checkout that settles the customer's completed hatian orders. This must
// stay in step with isDeferredPackingMode in lib/pricing.ts — the two rules
// diverging is what shows the customer a total the server then disagrees with.
//
// `fees` is the admin-editable set fetched at display time; a per-listing fee on
// a line still wins over its mode default.
const CART_KIND_MODE = { product: 'solo', group_buy: 'kahati', moq_campaign: 'group_buy', moq_product: 'moq' } as const;
export const packingFeeFor = (
  items: CartItem[],
  fees: PackingFees = PACKING_FEE_PHP,
  // Group buy series this customer already has a parcel going in. Lines in one
  // owe no fee — the parcel was paid for by the order that opened it. Mirrors
  // campaignPackingFeeDue in lib/campaign-commitment.ts, which is what the
  // server actually charges.
  paidSeriesIds: ReadonlySet<string> = new Set(),
): number => {
  const feeByMode = new Map<PackingMode, number>();
  for (const i of items) {
    const mode = CART_KIND_MODE[i.kind];
    if (isDeferredPackingMode(mode)) continue;
    if (i.kind === 'moq_campaign' && i.seriesId && paidSeriesIds.has(i.seriesId)) continue;
    const fee = i.packingFeePhp ?? fees[mode];
    feeByMode.set(mode, Math.max(feeByMode.get(mode) ?? 0, fee));
  }
  let total = 0;
  for (const fee of feeByMode.values()) total += fee;
  return total;
};

// Builds the cart line for a Group Buy (MOQ campaign) batch. Lives here for the
// same reason moqCartLine does: the cart->checkout contract test exercises the
// exact line the storefront produces instead of restating it.
//
// No `stock`: a group buy line has no ceiling for the cart to clamp to — see
// maxQtyFor. The fee shown is this campaign's; whether the customer actually
// owes it is the server's call (lib/campaign-commitment.ts), since a repeat
// order in the same series joins a parcel already paid for.
export const campaignCartLine = (c: MoqCampaign): CartItem => ({
  key: `gbuy:${c.id}`,
  kind: 'moq_campaign',
  refId: c.id,
  name: `${c.name} — group buy`,
  spec: `Group buy · batch #${c.batchNo}`,
  unitPricePhp: Number(c.pricePerKitPhp),
  // A campaign's admin-set per-customer minimum is the floor; a line seeded
  // below it would be rejected by checkout.
  minQty: Math.max(1, c.perCustomerMin ?? 1),
  qty: Math.max(1, c.perCustomerMin ?? 1),
  packingFeePhp: Number(c.shippingPhp),
  seriesId: c.seriesId,
});

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

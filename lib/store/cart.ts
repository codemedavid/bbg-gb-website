import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { PACKING_FEE_PHP, vialsFor, type OnHandUnit, type PackingFees, type PackingMode } from '@/lib/pricing';
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
  // An MOQ shelf line is uncapped too, and for the plainest reason of the three:
  // the shelf holds nothing. Its number is a target buyers are filling, so a
  // large order is the best thing that can happen to it, not an oversell.
  if (item.kind === 'moq_product') return Infinity;
  if (item.stock == null) return Infinity;
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
  // Free-text instructions the customer adds before checkout. Lives on the cart
  // rather than on the checkout form so it survives the walk back to a board to
  // add one more thing — and so it is written to every order the cart splits
  // into, not just the first.
  note: string;
  add: (item: Omit<CartItem, 'qty'> & { qty?: number }) => void;
  setQty: (key: string, qty: number) => void;
  setNote: (note: string) => void;
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
      note: '',
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
      setNote: (note) => set({ note }),
      inc: (key) => set((s) => ({ items: s.items.map((i) => i.key === key ? clampQty({ ...i, qty: i.qty + 1 }) : i) })),
      dec: (key) => set((s) => {
        const item = s.items.find((i) => i.key === key);
        if (item && item.qty <= item.minQty) return { items: s.items.filter((i) => i.key !== key) };
        return { items: s.items.map((i) => i.key === key ? { ...i, qty: i.qty - 1 } : i) };
      }),
      remove: (key) => set((s) => ({ items: s.items.filter((i) => i.key !== key) })),
      // The note goes with the items. Leaving it behind would attach this
      // checkout's instructions to whatever the customer buys next.
      clear: () => set({ items: [], note: '' }),
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
// The two scheduled boards share ONE fee: Group Buy and Hatian trade in the same
// weekly cycle and ship one parcel, so a cart holding both pays to have it packed
// once. This must stay in step with chargeCycleFeeOnce in lib/packing-cycle.ts —
// the two rules diverging is what shows the customer a total the server then
// disagrees with.
//
// `fees` is the admin-editable set fetched at display time; a per-listing fee on
// a line still wins over its mode default.
const CART_KIND_MODE = { product: 'solo', group_buy: 'kahati', moq_campaign: 'group_buy', moq_product: 'moq' } as const;

// How the cart presents each mode. The labels are the customer-facing names of
// the systems — "Kahati" and "Group Buy" are what the tabs say, so the cart
// must not invent third names for the same things.
export const CART_MODE_LABEL: Record<PackingMode, string> = {
  solo: 'On-hand',
  kahati: 'Kahati',
  group_buy: 'Group Buy',
  moq: 'MOQ',
};

// Fixed emit order, so the cart does not reshuffle its sections between visits
// depending on what the customer happened to add first. Mirrors PURCHASE_MODES
// in lib/order-modes.ts, which is the order checkout creates the orders in — so
// the cart's sections and the resulting order numbers run in the same sequence.
const CART_MODE_ORDER: readonly PackingMode[] = ['solo', 'kahati', 'group_buy', 'moq'] as const;

export type CartGroup = {
  mode: PackingMode;
  label: string;
  items: CartItem[];
  /** Units across the group's lines — what the customer is holding, not how many rows. */
  count: number;
  subtotal: number;
};

/**
 * Split the cart into one labelled group per mode present.
 *
 * Group Buy and Kahati are separate systems: separate lifecycles, separate
 * packing fees, and separate order references once checkout splits the cart
 * (lib/order-modes.ts splitCartIntoOrders). Listing them as one undifferentiated
 * pile invites the customer to read them as one order, which is precisely what
 * the success screen then contradicts. Grouping here is the cart telling the
 * truth about what checkout is going to do.
 *
 * Empty modes are omitted — a heading over nothing is noise.
 */
export const groupCartByMode = (items: readonly CartItem[]): CartGroup[] =>
  CART_MODE_ORDER
    .map((mode) => {
      const inMode = items.filter((i) => CART_KIND_MODE[i.kind] === mode);
      return {
        mode,
        label: CART_MODE_LABEL[mode],
        items: inMode,
        count: inMode.reduce((a, i) => a + i.qty, 0),
        subtotal: inMode.reduce((a, i) => a + i.qty * i.unitPricePhp, 0),
      };
    })
    .filter((g) => g.items.length > 0);
/** Cart kinds that belong to the shared trading cycle. */
const CYCLE_KINDS: readonly CartItem['kind'][] = ['group_buy', 'moq_campaign'];

export const packingFeeFor = (
  items: CartItem[],
  fees: PackingFees = PACKING_FEE_PHP,
  // Whether this customer has already paid to have this cycle's parcel packed.
  // Mirrors hasPaidPackingFeeThisCycle in lib/packing-cycle.ts, which is what
  // the server actually charges against.
  paidThisCycle = false,
): number => {
  const feeByMode = new Map<PackingMode, number>();
  // The cycle's own fee, charged once across BOTH boards rather than once per
  // mode: the parcel costs at least its priciest item to pack.
  let cycleFee = 0;
  for (const i of items) {
    const mode = CART_KIND_MODE[i.kind];
    const fee = i.packingFeePhp ?? fees[mode];
    if (CYCLE_KINDS.includes(i.kind)) {
      cycleFee = Math.max(cycleFee, fee);
      continue;
    }
    feeByMode.set(mode, Math.max(feeByMode.get(mode) ?? 0, fee));
  }
  let total = paidThisCycle ? 0 : cycleFee;
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
  // Seeded at the per-ORDER floor, which is 1 unless an admin raised it — NOT at
  // the shelf target. The target is what everyone reaches together; starting one
  // customer's line at 500 would ask them to fill the whole buy alone.
  minQty: Math.max(1, p.minOrderQty),
  qty: Math.max(1, p.minOrderQty),
  packingFeePhp: p.packingFeePhp != null ? Number(p.packingFeePhp) : undefined,
});

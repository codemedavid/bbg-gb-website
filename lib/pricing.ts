// Central order/pricing rules for BBG Peptides.
// One packing fee per order, priced by fulfillment mode. The packing fee already
// includes local shipping (SF) — there is no separate shipping or admin fee.
// A cart that mixes modes checks out as one order per mode, each carrying its own
// packing fee, so a mixed-cart total sums one packing fee per mode present.

// Per-mode packing-fee defaults (PHP, local shipping included). Admin-editable:
// these are the fallback defaults; a per-listing override on the item wins.
//   solo      -> On-hand  (pag onhand)
//   kahati    -> Hatian   (kapag hatian)
//   group_buy -> Pasabay  (pag pasabay)
//   moq       -> MOQ shelf (its own page; bulk minimum per product)
export const PACKING_FEE_PHP = { solo: 200, kahati: 150, group_buy: 300, moq: 300 } as const;
export type PackingMode = keyof typeof PACKING_FEE_PHP;
export type PackingFees = Record<PackingMode, number>;

// Default downpayment (PHP) a customer pays at checkout to reserve kahati slots.
// Deducted from the order total — the balance is collected after the kahati ends.
// Admin-editable via the `kahati_downpayment` settings key; this is the fallback.
export const KAHATI_DOWNPAYMENT_PHP = 150;

export const KAHATI_MIN_VIALS = 1;    // min vials one person may commit to a hatian
export const VIALS_PER_KIT = 10;      // 1 kit = 10 vials
export const KAHATI_MAX_VIALS = VIALS_PER_KIT; // a hatian counter caps at one kit
// Minimum vials a hatian must reach by its deadline to be worth ordering. Below
// this the batch is not placed and the hatian is cancelled; at or above it the
// hatian is "Good to Go" even if the kit never filled.
export const KAHATI_MIN_VIABLE_VIALS = 7;
export const GROUP_BUY_MIN_KITS = 1;  // group buy (MOQ campaign): default per-customer commitment

// The three purchasing modes carried by a cart item:
//   'product'      -> On-hand / ready stock (buy any qty, limited by stock, ₱200 packing)
//   'group_buy'    -> Kahati / Hatian    (shared single-product order, 10-vial cap, min 1 vial, ₱150 packing)
//   'moq_campaign' -> Group Buy / Pasabay (admin-set MOQ; ₱300 packing)
//   'moq_product'  -> MOQ shelf (own page; per-product minimum order qty, ₱300 packing)
export type PriceableItem = {
  kind: 'product' | 'group_buy' | 'moq_campaign' | 'moq_product';
  unitPricePhp: number;
  qty: number;
  // Admin-editable per-listing packing fee (local shipping included). When omitted,
  // the item's mode default from PACKING_FEE_PHP applies.
  packingFeePhp?: number;
  // Groups fragments of one customer placement so they count as a single fee. A
  // kahati commitment that rolls across two counters (overflow) emits one priced
  // line per counter, both sharing this key. Omitted = the item is its own placement.
  placementKey?: string;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function hasOnHand(items: PriceableItem[]): boolean {
  return items.some((i) => i.kind === 'product');
}
export function hasKahati(items: PriceableItem[]): boolean {
  return items.some((i) => i.kind === 'group_buy');
}
export function hasGroupBuy(items: PriceableItem[]): boolean {
  return items.some((i) => i.kind === 'moq_campaign');
}
export function hasMoq(items: PriceableItem[]): boolean {
  return items.some((i) => i.kind === 'moq_product');
}

export function subtotal(items: PriceableItem[]): number {
  return round2(items.reduce((sum, i) => sum + i.unitPricePhp * i.qty, 0));
}

const KIND_MODE: Record<PriceableItem['kind'], PackingMode> = {
  product: 'solo',
  group_buy: 'kahati',
  moq_campaign: 'group_buy',
  moq_product: 'moq',
};

// Total packing fee: one fee per placement (distinct listing the customer chose).
// Client rule — "bawat placement sa ibat ibang peps may sariling packing fee": two
// different hatians are two fees, two MOQ products are two fees, and so on. An
// item's per-listing override wins over its mode default. Overflow fragments that
// share a placementKey collapse to one fee, since they are one customer placement.
// Local shipping is already included in every packing fee; no separate shipping
// or admin fee is ever added.
export function packingFeeFor(items: PriceableItem[]): number {
  const counted = new Set<string>();
  let total = 0;
  items.forEach((item, index) => {
    const key = item.placementKey ?? `#${index}`;
    if (counted.has(key)) return;
    counted.add(key);
    total += item.packingFeePhp ?? PACKING_FEE_PHP[KIND_MODE[item.kind]];
  });
  return round2(total);
}

export type OrderTotals = {
  subtotal: number;
  packingFee: number; // one fee per mode present; local shipping included
  total: number;
  buyType: 'solo' | 'kahati' | 'group_buy' | 'moq';
};

export function computeTotals(items: PriceableItem[]): OrderTotals {
  const sub = subtotal(items);
  const packingFee = packingFeeFor(items);
  return {
    subtotal: sub,
    packingFee,
    total: round2(sub + packingFee),
    // Any kahati item dominates record-keeping (repack/split handling); otherwise a
    // group-buy campaign; otherwise the MOQ shelf; otherwise plain solo. Modes are
    // split before checkout, so a well-formed order segment is single-mode.
    buyType: hasKahati(items) ? 'kahati' : hasGroupBuy(items) ? 'group_buy' : hasMoq(items) ? 'moq' : 'solo',
  };
}

// Per-vial price for a kahati kit.
export function perVialPrice(pricePerKitPhp: number): number {
  return round2(pricePerKitPhp / VIALS_PER_KIT);
}

export type KahatiDownpaymentSplit = { downpayment: number; balance: number };

// Split a kahati order total into the downpayment due at checkout and the
// balance payable after the kahati ends. The downpayment is clamped to
// [0, total] so a small order never yields a negative balance.
export function splitKahatiDownpayment(
  total: number,
  downpaymentPhp: number = KAHATI_DOWNPAYMENT_PHP,
): KahatiDownpaymentSplit {
  const downpayment = round2(Math.min(Math.max(downpaymentPhp, 0), total));
  return { downpayment, balance: round2(total - downpayment) };
}

// Validate a kahati commitment against min vials and remaining slots.
// minVials comes from the group buy (admin-editable); falls back to KAHATI_MIN_VIALS.
export function validateKahatiCommit(
  qty: number,
  remainingSlots: number,
  minVials: number = KAHATI_MIN_VIALS,
): { ok: boolean; message?: string } {
  if (!Number.isInteger(qty) || qty < minVials) {
    return { ok: false, message: `Minimum kahati commitment is ${minVials} vials.` };
  }
  if (qty > remainingSlots) {
    return { ok: false, message: `Only ${remainingSlots} vials left in this kahati.` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// On-hand (ready stock)
//
// On-hand items are sold from stock we already hold, so there is no bulk
// minimum — the only ceiling is what is physically left. A customer buys either
// single pieces (vials) or whole kits; `stock` is counted in vials, so a kit
// draws VIALS_PER_KIT from it.
// ---------------------------------------------------------------------------

export type OnHandUnit = 'piece' | 'kit';

// Vials drawn from stock by `qty` of a given unit.
export function vialsFor(unit: OnHandUnit, qty: number): number {
  return unit === 'kit' ? qty * VIALS_PER_KIT : qty;
}

type OnHandPrices = { onHandPiecePhp: string | number | null; onHandKitPhp: string | number | null };

// Price for one unit of an on-hand product. Returns null when that unit is not
// offered — an unset or zero price means "not sold this way", never free.
export function onHandUnitPrice(p: OnHandPrices, unit: OnHandUnit): number | null {
  const raw = unit === 'kit' ? p.onHandKitPhp : p.onHandPiecePhp;
  if (raw == null) return null;
  const price = Number(raw);
  if (!Number.isFinite(price) || price <= 0) return null;
  return round2(price);
}

// Gate an on-hand purchase: whole positive quantities, never beyond stock.
export function validateOnHandQty(
  qty: number,
  unit: OnHandUnit,
  stock: number,
): { ok: boolean; message?: string } {
  if (!Number.isInteger(qty) || qty < 1) {
    return { ok: false, message: 'Quantity must be a whole number of at least 1.' };
  }
  if (stock <= 0) return { ok: false, message: 'Out of stock.' };
  const vials = vialsFor(unit, qty);
  if (vials > stock) {
    return unit === 'kit'
      ? { ok: false, message: `Only ${Math.floor(stock / VIALS_PER_KIT)} kit(s) left in stock (${stock} vials).` }
      : { ok: false, message: `Only ${stock} left in stock.` };
  }
  return { ok: true };
}

// Validate a group buy (MOQ campaign) commitment against the per-customer minimum.
// perCustomerMin is admin-configurable per campaign; falls back to GROUP_BUY_MIN_KITS.
export function validateGroupBuyCommit(
  qty: number,
  perCustomerMin: number = GROUP_BUY_MIN_KITS,
): { ok: boolean; message?: string } {
  if (!Number.isInteger(qty) || qty < perCustomerMin) {
    return { ok: false, message: `Minimum commitment is ${perCustomerMin} kit(s).` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// MOQ shelf
//
// An MOQ product is stocked like on-hand goods but sold in bulk: each carries an
// admin-set minimum order quantity a customer must meet or exceed. Stock is the
// ceiling, exactly as it is on-hand — the server remains the authoritative gate.
// ---------------------------------------------------------------------------
export const MOQ_MIN_ORDER_QTY = 1; // fallback when a product sets no minimum

export function validateMoqQty(
  qty: number,
  minOrderQty: number = MOQ_MIN_ORDER_QTY,
  stock: number = Infinity,
): { ok: boolean; message?: string } {
  if (!Number.isInteger(qty) || qty < 1) {
    return { ok: false, message: 'Quantity must be a whole number of at least 1.' };
  }
  if (stock <= 0) return { ok: false, message: 'Out of stock.' };
  if (qty < minOrderQty) {
    return { ok: false, message: `Minimum order for this item is ${minOrderQty}.` };
  }
  if (qty > stock) return { ok: false, message: `Only ${stock} left in stock.` };
  return { ok: true };
}

export type GroupBuyMoqStatus = {
  committed: number;
  moq: number;
  remaining: number;
  progress: number; // 0..1
  reached: boolean;
};

// MOQ progress for a group buy campaign. progress is clamped to [0, 1];
// remaining floors at 0 once MOQ is met or exceeded.
export function groupBuyMoqStatus(committed: number, moq: number): GroupBuyMoqStatus {
  const reached = committed >= moq;
  return {
    committed,
    moq,
    remaining: Math.max(0, moq - committed),
    progress: moq > 0 ? Math.min(1, committed / moq) : 0,
    reached,
  };
}

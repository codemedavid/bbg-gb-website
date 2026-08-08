// Central order/pricing rules for BBG Peptides.
// One packing fee per checkout parcel, priced by fulfillment mode. The packing fee
// already includes local shipping (SF) — there is no separate shipping or admin fee.
// A cart that mixes modes checks out as one order per mode (each ships as its own
// parcel), so a mixed-cart total sums one packing fee per mode present — never one
// per product. Buying several different vials/products in one parcel is one fee.
//
// One fee per TRADING CYCLE on the two scheduled boards. Group Buy and Hatian
// share one weekly cycle (lib/schedule-recurrence.ts) and one parcel, so a
// customer who joins a hatian and a group buy in the same week pays to have that
// parcel packed once. The rule lives in lib/packing-cycle.ts and reaches this
// module as a per-item fee of 0 on the orders it waives.
//
// The hatian fee is charged AT CHECKOUT, on top of the goods: ₱4,000 of product
// plus ₱150 to pack it is a ₱4,150 order, of which the ₱150 is paid now and the
// ₱4,000 is settled after the hatian ends. It is never taken out of the product
// total. Legacy orders placed while the fee was deferred to the final checkout
// are still settled that way — see settlementPackingFee and lib/settlement.ts.

// Per-mode packing-fee defaults (PHP, local shipping included). Admin-editable:
// these are the fallback defaults; a per-listing override on the item wins.
//   solo      -> On-hand  (pag onhand)
//   kahati    -> Hatian   (kapag hatian)
//   group_buy -> Pasabay  (pag pasabay)
//   moq       -> MOQ shelf (its own page; bulk minimum per product)
export const PACKING_FEE_PHP = { solo: 200, kahati: 150, group_buy: 300, moq: 300 } as const;
export type PackingMode = keyof typeof PACKING_FEE_PHP;
export type PackingFees = Record<PackingMode, number>;

export const KAHATI_MIN_VIALS = 1;    // min vials one person may commit to a hatian
export const VIALS_PER_KIT = 10;      // 1 kit = 10 vials
export const KAHATI_MAX_VIALS = VIALS_PER_KIT; // a hatian counter caps at one kit
// Minimum vials a hatian must reach by its deadline to be worth ordering. Below
// this the batch is not placed and the hatian is cancelled; at or above it the
// hatian is "Good to Go" even if the kit never filled.
export const KAHATI_MIN_VIABLE_VIALS = 7;

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

// Total packing fee due AT CHECKOUT: one fee per mode present (each mode ships
// as its own parcel). Client rule — "packing fee per checkout, hindi per
// product": buying several different vials/products that ship together is one
// fee, not one each. When listings within a mode carry different per-listing
// fees, the parcel is charged the largest — it costs at least its priciest item
// to pack. A line the cycle rule has waived arrives here carrying a fee of 0 and
// so adds nothing. Local shipping is already included in every packing fee; no
// separate shipping or admin fee is ever added.
export function packingFeeFor(items: PriceableItem[]): number {
  const feeByMode = new Map<PackingMode, number>();
  for (const item of items) {
    const mode = KIND_MODE[item.kind];
    const fee = item.packingFeePhp ?? PACKING_FEE_PHP[mode];
    feeByMode.set(mode, Math.max(feeByMode.get(mode) ?? 0, fee));
  }
  let total = 0;
  for (const fee of feeByMode.values()) total += fee;
  return round2(total);
}

// The single packing fee a settlement charges. `fees` holds the per-hatian
// packing fee of every order being settled; the parcel is charged the largest,
// on the same reasoning as packingFeeFor — it costs at least its priciest item
// to pack. Settling ten hatians is still exactly one fee. Nothing to settle, or
// only fees that were already charged at commit time (legacy orders, filtered by
// the caller), means no fee at all rather than a floor.
export function settlementPackingFee(fees: number[]): number {
  const usable = fees.filter((f) => Number.isFinite(f) && f > 0);
  if (!usable.length) return 0;
  return round2(Math.max(...usable));
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

// Validate a group buy (MOQ campaign) commitment. Group buys carry no
// per-customer minimum — any positive whole number of kits is allowed.
export function validateGroupBuyCommit(qty: number): { ok: boolean; message?: string } {
  if (!Number.isInteger(qty) || qty < 1) {
    return { ok: false, message: 'Commit at least 1 kit.' };
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

// ---------------------------------------------------------------------------
// Product-level group buy configuration
//
// The five settings below belong to the PRODUCT, not to any one listing. A
// hatian or a campaign that carries that product seeds its own fields from
// them, so an admin sets the terms once on the product instead of retyping them
// into every batch. Seeding is a starting value, never a lock: the listing's own
// figure wins once an admin has typed one, and nothing here reaches back into a
// live listing when the product is later edited.
//
// The product speaks in VIALS throughout — it is the unit a peptide is counted
// in. A hatian counts vials too, so it maps across untouched; a campaign counts
// whole KITS, so campaignDefaultsFor converts. Keeping the conversion in one
// place is what stops the two boards drifting into different arithmetic.
// ---------------------------------------------------------------------------

export type GroupBuyConfig = {
  gbPricePerKitPhp: string | number | null;
  gbPricePerPiecePhp: string | number | null;
  gbVialsPerKit: number | null;
  gbMinVials: number | null;
  gbMaxVialsPerBatch: number | null;
};

export type GroupBuyUnit = 'kit' | 'piece';

// A positive whole number, or null when the value is absent or unusable. Shared
// by every count below so "0 vials per kit" and "-3" fail the same way.
function positiveInt(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const n = Math.floor(raw);
  return n >= 1 ? n : null;
}

// A positive amount of money, or null. Mirrors onHandUnitPrice's contract: an
// unset or zero price means "not sold this way", never free.
function positiveMoney(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

// Vials in one kit of this product, falling back to the global kit size.
export function groupBuyVialsPerKit(c: GroupBuyConfig): number {
  return positiveInt(c.gbVialsPerKit) ?? VIALS_PER_KIT;
}

// Price for one unit of a product sold through a group buy. The per-piece price
// is derived from the kit when the admin has not set one explicitly — the same
// relationship perVialPrice expresses for a hatian, but against this product's
// own kit size rather than the global ten.
export function groupBuyUnitPrice(c: GroupBuyConfig, unit: GroupBuyUnit): number | null {
  const kit = positiveMoney(c.gbPricePerKitPhp);
  if (unit === 'kit') return kit;
  const piece = positiveMoney(c.gbPricePerPiecePhp);
  if (piece != null) return piece;
  return kit == null ? null : round2(kit / groupBuyVialsPerKit(c));
}

// The kit price a NEW listing starts at, on EITHER board.
//
// The admin's explicit group buy price when the product carries one; otherwise
// the product's shop price. That shop figure is already a PER-KIT price — the
// source workbook heads its money column "PER KIT (10 VIALS) PRICE" and it
// reaches products.price_php unchanged (see lib/db/data/catalog.ts) — so it is
// never scaled by the kit size. Scaling it listed every seeded campaign at ten
// times its real price.
//
// Both boards seed through this one function, so a kit cannot cost one thing on
// the Group Buy board and another on the hatian board.
export function seededKitPrice(
  c: GroupBuyConfig,
  shopPricePhp: string | number | null,
): number | null {
  return groupBuyUnitPrice(c, 'kit') ?? positiveMoney(shopPricePhp);
}

// What a NEW hatian starts at when it carries this product. A hatian is
// vial-native, so the product's figures apply directly — bounded by the rule
// that a hatian fills exactly one kit.
export type KahatiDefaults = { pricePerKitPhp: number | null; minVials: number; totalSlots: number };

export function kahatiDefaultsFor(c: GroupBuyConfig): KahatiDefaults {
  const totalSlots = Math.min(positiveInt(c.gbMaxVialsPerBatch) ?? KAHATI_MAX_VIALS, KAHATI_MAX_VIALS);
  // A minimum nobody could meet is worse than no minimum: a per-person floor
  // above the counter's own cap would reject every commitment, including the
  // first. Clamped to the cap so the seeded hatian is always joinable.
  const minVials = Math.min(positiveInt(c.gbMinVials) ?? KAHATI_MIN_VIALS, totalSlots);
  return { pricePerKitPhp: groupBuyUnitPrice(c, 'kit'), minVials, totalSlots };
}

// What a campaign starts at when this product is included. Campaigns count
// kits, so both vial figures convert:
//   batch size       = whole kits that fit in the batch, floored at one
//   per-customer min = kits needed to cover the minimum, rounded UP — a
//                      customer commits whole kits, so half a kit is one kit.
export type CampaignDefaults = { pricePerKitPhp: number | null; moq: number; perCustomerMin: number };

export function campaignDefaultsFor(c: GroupBuyConfig): CampaignDefaults {
  const vialsPerKit = groupBuyVialsPerKit(c);
  const maxVials = positiveInt(c.gbMaxVialsPerBatch);
  const minVials = positiveInt(c.gbMinVials);
  return {
    pricePerKitPhp: groupBuyUnitPrice(c, 'kit'),
    moq: maxVials == null
      ? MOQ_BATCH_MAX_KITS
      : batchCapacity(Math.max(1, Math.floor(maxVials / vialsPerKit))),
    perCustomerMin: minVials == null ? 1 : Math.max(1, Math.ceil(minVials / vialsPerKit)),
  };
}

// A group buy batch is one supplier consignment and holds at most this many
// kits. Not admin-editable: 10/10 is the largest a batch can ever read, and a
// commitment beyond it opens the next batch (see lib/moq-batch-server.ts).
export const MOQ_BATCH_MAX_KITS = 10;

// How many kits a batch accepts: its admin-set MOQ, bounded by the hard ceiling
// — a legacy row carrying moq = 25 still caps at 10 — and floored at 1, so a
// zero MOQ cannot make a batch nothing fits into.
export function batchCapacity(moq: number): number {
  if (!Number.isFinite(moq)) return MOQ_BATCH_MAX_KITS;
  return Math.max(1, Math.min(Math.floor(moq), MOQ_BATCH_MAX_KITS));
}

export type GroupBuyMoqStatus = {
  // Clamped to the capacity: no batch may report more kits than it can hold,
  // so a row over-committed before the cap existed still reads 10/10, not 13/10.
  committed: number;
  capacity: number;
  moq: number;
  remaining: number;
  progress: number; // 0..1
  reached: boolean;
  full: boolean;
};

// MOQ progress for one group buy batch. progress is clamped to [0, 1];
// remaining floors at 0 once the batch is full.
export function groupBuyMoqStatus(committed: number, moq: number): GroupBuyMoqStatus {
  const capacity = batchCapacity(moq);
  const held = Math.max(0, Math.min(committed, capacity));
  return {
    committed: held,
    capacity,
    moq,
    remaining: Math.max(0, capacity - held),
    progress: Math.min(1, held / capacity),
    reached: committed >= moq,
    full: held >= capacity,
  };
}

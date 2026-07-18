// Central order/pricing rules for BBG Peptides.
// Mirrors the imported design: solo orders pay LBC shipping; kahati orders pay a
// flat repack fee (shipping included). An order can contain both.

export const SHIPPING_PHP = 180;      // LBC, PH-wide, applied once when solo/group-buy items present
export const REPACK_FEE_PHP = 150;    // per kahati participant, shipping included
export const KAHATI_MIN_VIALS = 7;    // minimum kahati commitment
export const VIALS_PER_KIT = 10;      // 1 kit = 10 vials
export const SOLO_MIN_KITS = 10;      // solo buy: 10 kits of any peptide
export const SOLO_MIN_BAC = 10;       // + 10 BAC water
export const GROUP_BUY_MIN_KITS = 1;  // group buy (MOQ campaign): default per-customer commitment

// The three purchasing modes carried by a cart item:
//   'product'      -> Solo Buy   (min 10 kits + 10 BAC, LBC shipping)
//   'group_buy'    -> Kahati     (shared single-product order, min 7 vials, repack fee)
//   'moq_campaign' -> Group Buy  (admin-set MOQ; commitments held until MOQ met or approved)
export type PriceableItem = {
  kind: 'product' | 'group_buy' | 'moq_campaign';
  unitPricePhp: number;
  qty: number;
  // Kahati items carry the group buy's own admin-editable repack fee; omitted means REPACK_FEE_PHP.
  repackFeePhp?: number;
  // MOQ campaign items may override shipping per campaign terms; omitted means SHIPPING_PHP.
  shippingPhp?: number;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function hasSolo(items: PriceableItem[]): boolean {
  return items.some((i) => i.kind === 'product');
}
export function hasKahati(items: PriceableItem[]): boolean {
  return items.some((i) => i.kind === 'group_buy');
}
export function hasGroupBuy(items: PriceableItem[]): boolean {
  return items.some((i) => i.kind === 'moq_campaign');
}

export function subtotal(items: PriceableItem[]): number {
  return round2(items.reduce((sum, i) => sum + i.unitPricePhp * i.qty, 0));
}

// LBC shipping applies to solo and group-buy (MOQ) items. Kahati folds shipping
// into its repack fee. Group-buy campaigns may override the amount per their terms.
export function shippingFor(items: PriceableItem[]): number {
  if (hasSolo(items)) return SHIPPING_PHP;
  const campaignShip = items
    .filter((i) => i.kind === 'moq_campaign')
    .map((i) => i.shippingPhp ?? SHIPPING_PHP);
  return campaignShip.length ? round2(Math.max(...campaignShip)) : 0;
}
// One repack fee per order. When a cart joins several kahatis, the highest fee applies.
export function repackFeeFor(items: PriceableItem[]): number {
  const fees = items
    .filter((i) => i.kind === 'group_buy')
    .map((i) => i.repackFeePhp ?? REPACK_FEE_PHP);
  return fees.length ? round2(Math.max(...fees)) : 0;
}

export type OrderTotals = {
  subtotal: number;
  shipping: number;
  repackFee: number;
  total: number;
  buyType: 'solo' | 'kahati' | 'group_buy';
};

export function computeTotals(items: PriceableItem[]): OrderTotals {
  const sub = subtotal(items);
  const shipping = shippingFor(items);
  const repackFee = repackFeeFor(items);
  return {
    subtotal: sub,
    shipping,
    repackFee,
    total: round2(sub + shipping + repackFee),
    // Any kahati item dominates record-keeping (repack handling); otherwise a
    // group-buy campaign; otherwise plain solo. Modes are split before checkout,
    // so a well-formed order segment is single-mode.
    buyType: hasKahati(items) ? 'kahati' : hasGroupBuy(items) ? 'group_buy' : 'solo',
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

// Solo MOQ status (informational — surfaced to the user). kits counts peptide
// vials / 10; bac counts BAC water vials.
export function soloMoqStatus(peptideVials: number, bacVials: number) {
  const kits = peptideVials / VIALS_PER_KIT;
  return {
    kits,
    bacVials,
    meetsKits: kits >= SOLO_MIN_KITS,
    meetsBac: bacVials >= SOLO_MIN_BAC,
    met: kits >= SOLO_MIN_KITS && bacVials >= SOLO_MIN_BAC,
  };
}

// Hard gate for solo checkout (SRS V-1): blocked until the cart holds
// >= 10 peptide kits AND >= 10 BAC water.
export function validateSoloCheckout(
  peptideVials: number,
  bacVials: number,
): { ok: boolean; message?: string } {
  const s = soloMoqStatus(peptideVials, bacVials);
  if (!s.met) {
    return {
      ok: false,
      message: `Solo buy minimum is ${SOLO_MIN_KITS} kits + ${SOLO_MIN_BAC} BAC water. ` +
        `You have ${s.kits} kit(s) and ${bacVials} BAC.`,
    };
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

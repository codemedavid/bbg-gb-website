// Central order/pricing rules for BBG Peptides.
// Mirrors the imported design: solo orders pay LBC shipping; kahati orders pay a
// flat repack fee (shipping included). An order can contain both.

export const SHIPPING_PHP = 180;      // LBC, PH-wide, applied once when solo items present
export const REPACK_FEE_PHP = 150;    // per kahati participant, shipping included
export const KAHATI_MIN_VIALS = 7;    // minimum kahati commitment
export const VIALS_PER_KIT = 10;      // 1 kit = 10 vials
export const SOLO_MIN_KITS = 10;      // solo buy: 10 kits of any peptide
export const SOLO_MIN_BAC = 10;       // + 10 BAC water

export type PriceableItem = {
  kind: 'product' | 'group_buy';
  unitPricePhp: number;
  qty: number;
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function hasSolo(items: PriceableItem[]): boolean {
  return items.some((i) => i.kind === 'product');
}
export function hasKahati(items: PriceableItem[]): boolean {
  return items.some((i) => i.kind === 'group_buy');
}

export function subtotal(items: PriceableItem[]): number {
  return round2(items.reduce((sum, i) => sum + i.unitPricePhp * i.qty, 0));
}

export function shippingFor(items: PriceableItem[]): number {
  return hasSolo(items) ? SHIPPING_PHP : 0;
}
export function repackFeeFor(items: PriceableItem[]): number {
  return hasKahati(items) ? REPACK_FEE_PHP : 0;
}

export type OrderTotals = {
  subtotal: number;
  shipping: number;
  repackFee: number;
  total: number;
  buyType: 'solo' | 'kahati';
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
    // A mixed cart is treated as kahati for record-keeping (repack handling dominates).
    buyType: hasKahati(items) ? 'kahati' : 'solo',
  };
}

// Per-vial price for a kahati kit.
export function perVialPrice(pricePerKitPhp: number): number {
  return round2(pricePerKitPhp / VIALS_PER_KIT);
}

// Validate a kahati commitment against min vials and remaining slots.
export function validateKahatiCommit(qty: number, remainingSlots: number): { ok: boolean; message?: string } {
  if (!Number.isInteger(qty) || qty < KAHATI_MIN_VIALS) {
    return { ok: false, message: `Minimum kahati commitment is ${KAHATI_MIN_VIALS} vials.` };
  }
  if (qty > remainingSlots) {
    return { ok: false, message: `Only ${remainingSlots} vials left in this kahati.` };
  }
  return { ok: true };
}

// Solo MOQ status (informational — surfaced to the user, not hard-enforced at checkout,
// matching the design). kits counts peptide vials / 10; bac counts BAC water vials.
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

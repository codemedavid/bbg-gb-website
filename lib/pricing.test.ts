import { describe, it, expect } from 'vitest';
import {
  computeTotals, subtotal, packingFeeFor, perVialPrice,
  validateKahatiCommit, hasOnHand, hasKahati, hasGroupBuy,
  validateGroupBuyCommit, groupBuyMoqStatus, hasMoq, validateMoqQty,
  splitKahatiDownpayment, onHandUnitPrice, vialsFor, validateOnHandQty,
  settlementPackingFee,
  groupBuyUnitPrice, groupBuyVialsPerKit, kahatiDefaultsFor, campaignDefaultsFor,
  PACKING_FEE_PHP, KAHATI_MIN_VIALS, VIALS_PER_KIT, KAHATI_MAX_VIALS, MOQ_BATCH_MAX_KITS,
  type PriceableItem, type GroupBuyConfig,
} from './pricing';

const product = (price: number, qty = 1): PriceableItem => ({ kind: 'product', unitPricePhp: price, qty });
const kahati = (price: number, qty = 7): PriceableItem => ({ kind: 'group_buy', unitPricePhp: price, qty });
const moq = (price: number, qty = 1): PriceableItem => ({ kind: 'moq_campaign', unitPricePhp: price, qty });

describe('subtotal', () => {
  it('sums unit price times qty', () => {
    expect(subtotal([product(3200, 2), product(475, 1)])).toBe(6875);
  });
  it('is zero for empty cart', () => {
    expect(subtotal([])).toBe(0);
  });
});

describe('packing fee defaults (incl. local shipping, no admin fee)', () => {
  it('charges the on-hand fee for an on-hand-only cart', () => {
    expect(packingFeeFor([product(3200)])).toBe(PACKING_FEE_PHP.solo); // 200
  });
  it('charges the hatian fee for a kahati-only cart, at checkout', () => {
    expect(packingFeeFor([kahati(900)])).toBe(PACKING_FEE_PHP.kahati); // 150
  });
  it('charges the pasabay fee for a group-buy-only cart', () => {
    expect(packingFeeFor([moq(10400)])).toBe(PACKING_FEE_PHP.group_buy); // 300
  });
  it('is zero for an empty cart', () => {
    expect(packingFeeFor([])).toBe(0);
  });
  it('sums one packing fee per mode present (mixed cart)', () => {
    // Each mode checks out as its own order and ships as its own parcel, so
    // each carries its own packing fee. Collapsing the two scheduled boards
    // into ONE cycle fee happens a layer up, in chargeCycleFeeOnce — this
    // function prices the lines it is given.
    expect(packingFeeFor([product(3200), kahati(900, 7)])).toBe(
      PACKING_FEE_PHP.solo + PACKING_FEE_PHP.kahati, // 350
    );
    expect(packingFeeFor([product(3200), kahati(900), moq(10400)])).toBe(
      PACKING_FEE_PHP.solo + PACKING_FEE_PHP.kahati + PACKING_FEE_PHP.group_buy, // 650
    );
  });
});

// ---------------------------------------------------------------------------
// The hatian packing fee, charged at checkout and ADDED to the goods.
//
// Committing to a hatian collects the packing fee and nothing else: the goods
// are settled once the hatian ends. So a ₱6,300 commitment with a ₱150 fee is a
// ₱6,450 order, of which ₱150 is paid today — the fee is never taken out of the
// product total. One fee covers the whole trading cycle (lib/packing-cycle.ts),
// so joining five hatians in a week still costs one fee.
// ---------------------------------------------------------------------------
describe('the kahati packing fee at checkout', () => {
  it('charges the listing fee on a kahati commitment', () => {
    expect(packingFeeFor([{ kind: 'group_buy', unitPricePhp: 900, qty: 7, packingFeePhp: 250 }])).toBe(250);
  });
  it('adds the fee to the commitment total rather than taking it out', () => {
    const t = computeTotals([kahati(900, 7)]);
    expect(t).toMatchObject({
      subtotal: 6300, packingFee: PACKING_FEE_PHP.kahati, total: 6450, buyType: 'kahati',
    });
  });
  it('still charges the other modes their fee in a cart that also holds a hatian', () => {
    expect(packingFeeFor([product(3200), kahati(900, 7)]))
      .toBe(PACKING_FEE_PHP.solo + PACKING_FEE_PHP.kahati);
  });
});

describe('settlementPackingFee', () => {
  it('charges one fee for a settlement — the largest of the settled hatian fees', () => {
    expect(settlementPackingFee([150, 220, 180])).toBe(220);
  });
  it('charges a single fee no matter how many hatians are settled together', () => {
    expect(settlementPackingFee([150, 150, 150, 150, 150])).toBe(150);
  });
  it('charges nothing when there is nothing to settle', () => {
    expect(settlementPackingFee([])).toBe(0);
  });
  it('ignores negative or non-finite fees rather than crediting them', () => {
    expect(settlementPackingFee([-50, 150])).toBe(150);
    expect(settlementPackingFee([Number.NaN, 150])).toBe(150);
  });
  it('rounds to centavos', () => {
    expect(settlementPackingFee([150.005])).toBe(150.01);
  });
});

describe('admin-editable packing-fee overrides', () => {
  it('charges the item override over the mode default', () => {
    expect(packingFeeFor([{ kind: 'moq_product', unitPricePhp: 4500, qty: 1, packingFeePhp: 450 }])).toBe(450);
    expect(packingFeeFor([{ kind: 'moq_campaign', unitPricePhp: 10400, qty: 1, packingFeePhp: 400 }])).toBe(400);
  });
  it('charges one fee per mode even with several placements — the largest applies', () => {
    // Client rule: the packing fee is per checkout/parcel, not per product. Two
    // MOQ listings ship in one parcel, so they pay one packing fee — the larger
    // of the two, since the parcel costs at least its priciest item to pack.
    const items: PriceableItem[] = [
      { kind: 'moq_product', unitPricePhp: 4500, qty: 1, packingFeePhp: 300 },
      { kind: 'moq_product', unitPricePhp: 3800, qty: 1, packingFeePhp: 420 },
    ];
    expect(packingFeeFor(items)).toBe(420);
  });
  it('charges one fee for two distinct kahati placements — one parcel', () => {
    expect(packingFeeFor([kahati(900), kahati(800)])).toBe(PACKING_FEE_PHP.kahati);
  });
  it('charges one fee for kahati overflow fragments — they are one parcel', () => {
    // A commitment that rolls across two counters emits two kahati lines. They
    // ship together, so they are billed once.
    const items: PriceableItem[] = [
      { kind: 'group_buy', unitPricePhp: 900, qty: 3, packingFeePhp: 150 },
      { kind: 'group_buy', unitPricePhp: 900, qty: 2, packingFeePhp: 150 },
    ];
    expect(packingFeeFor(items)).toBe(150);
  });
  it('falls back to the mode default when an item sets no override', () => {
    expect(packingFeeFor([moq(10400)])).toBe(PACKING_FEE_PHP.group_buy);
  });
  it('bills each mode in a mixed cart', () => {
    const t = computeTotals([product(3200), { kind: 'group_buy', unitPricePhp: 900, qty: 7, packingFeePhp: 250 }]);
    expect(t.packingFee).toBe(PACKING_FEE_PHP.solo + 250);
    expect(t.total).toBe(3200 + 900 * 7 + PACKING_FEE_PHP.solo + 250);
  });
});

describe('computeTotals', () => {
  it('labels on-hand-only carts as solo', () => {
    expect(computeTotals([product(3200)]).buyType).toBe('solo');
  });
  it('labels any cart containing kahati as kahati', () => {
    expect(computeTotals([product(3200), kahati(900)]).buyType).toBe('kahati');
  });
  it('computes an on-hand total with the on-hand packing fee', () => {
    const t = computeTotals([product(3200, 2)]);
    expect(t).toMatchObject({ subtotal: 6400, packingFee: 200, total: 6600, buyType: 'solo' });
  });
  it('computes a kahati total with the packing fee added on top', () => {
    const t = computeTotals([kahati(900, 7)]);
    expect(t).toMatchObject({
      subtotal: 6300, packingFee: PACKING_FEE_PHP.kahati, total: 6450, buyType: 'kahati',
    });
  });
  it('computes a group-buy total with the pasabay packing fee', () => {
    const t = computeTotals([moq(10400, 2)]);
    expect(t).toMatchObject({ subtotal: 20800, packingFee: 300, total: 21100, buyType: 'group_buy' });
  });
  it('never adds a separate shipping or admin fee', () => {
    const t = computeTotals([product(3200)]);
    expect(t).not.toHaveProperty('shipping');
    expect(t).not.toHaveProperty('repackFee');
    expect(t).not.toHaveProperty('adminFee');
    expect(t.total).toBe(3200 + PACKING_FEE_PHP.solo);
  });
});

describe('mode predicates', () => {
  it('detects each mode', () => {
    expect(hasOnHand([product(1)])).toBe(true);
    expect(hasKahati([kahati(1)])).toBe(true);
    expect(hasGroupBuy([moq(1)])).toBe(true);
  });
});

describe('perVialPrice', () => {
  it('divides kit price by 10 vials', () => {
    expect(perVialPrice(9000)).toBe(900);
    expect(perVialPrice(6875)).toBe(687.5);
  });
});

describe('validateKahatiCommit', () => {
  it('rejects below the 7-vial minimum', () => {
    expect(validateKahatiCommit(KAHATI_MIN_VIALS - 1, 100).ok).toBe(false);
  });
  it('rejects commitments beyond remaining slots', () => {
    const r = validateKahatiCommit(20, 10);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('10');
  });
  it('accepts a valid commitment', () => {
    expect(validateKahatiCommit(7, 50).ok).toBe(true);
  });
  it('rejects non-integer quantities', () => {
    expect(validateKahatiCommit(7.5, 50).ok).toBe(false);
  });
  it('enforces the group buy minVials over the default 7', () => {
    expect(validateKahatiCommit(7, 100, 20).ok).toBe(false);
    expect(validateKahatiCommit(20, 100, 20).ok).toBe(true);
  });
});

describe('group buy (MOQ) mode', () => {
  it('labels a group-buy-only cart as group_buy', () => {
    expect(computeTotals([moq(10400, 2)])).toMatchObject({
      subtotal: 20800, packingFee: PACKING_FEE_PHP.group_buy, total: 20800 + PACKING_FEE_PHP.group_buy, buyType: 'group_buy',
    });
  });
});

describe('validateGroupBuyCommit', () => {
  it('accepts any positive whole number of kits — group buys have no minimum', () => {
    expect(validateGroupBuyCommit(1).ok).toBe(true);
    expect(validateGroupBuyCommit(5).ok).toBe(true);
    expect(validateGroupBuyCommit(42).ok).toBe(true);
  });
  it('rejects zero or negative commitments', () => {
    expect(validateGroupBuyCommit(0).ok).toBe(false);
    expect(validateGroupBuyCommit(-1).ok).toBe(false);
  });
  it('rejects non-integer commitments', () => {
    expect(validateGroupBuyCommit(2.5).ok).toBe(false);
  });
});

describe('groupBuyMoqStatus', () => {
  it('reports progress and not-yet-reached below MOQ', () => {
    const s = groupBuyMoqStatus(6, 10);
    expect(s.reached).toBe(false);
    expect(s.remaining).toBe(4);
    expect(s.progress).toBeCloseTo(0.6);
  });
  it('reports reached at or above MOQ and caps progress at 1', () => {
    const s = groupBuyMoqStatus(12, 10);
    expect(s.reached).toBe(true);
    expect(s.remaining).toBe(0);
    expect(s.progress).toBe(1);
  });
});

describe('onHandUnitPrice', () => {
  const p = { onHandPiecePhp: '550', onHandKitPhp: '5000' };

  it('prices a piece from onHandPiecePhp', () => {
    expect(onHandUnitPrice(p, 'piece')).toBe(550);
  });
  it('prices a kit from onHandKitPhp', () => {
    expect(onHandUnitPrice(p, 'kit')).toBe(5000);
  });
  it('returns null when the unit has no on-hand price set', () => {
    expect(onHandUnitPrice({ onHandPiecePhp: '550', onHandKitPhp: null }, 'kit')).toBeNull();
    expect(onHandUnitPrice({ onHandPiecePhp: null, onHandKitPhp: '5000' }, 'piece')).toBeNull();
  });
  it('treats a zero price as unset rather than free', () => {
    expect(onHandUnitPrice({ onHandPiecePhp: '0', onHandKitPhp: '5000' }, 'piece')).toBeNull();
  });
});

describe('vialsFor', () => {
  it('counts one vial per piece', () => {
    expect(vialsFor('piece', 3)).toBe(3);
  });
  it('counts ten vials per kit', () => {
    expect(vialsFor('kit', 2)).toBe(2 * VIALS_PER_KIT);
  });
});

describe('validateOnHandQty', () => {
  it('allows a single piece — on-hand has no bulk minimum', () => {
    expect(validateOnHandQty(1, 'piece', 100).ok).toBe(true);
  });
  it('rejects a non-positive or fractional quantity', () => {
    expect(validateOnHandQty(0, 'piece', 100).ok).toBe(false);
    expect(validateOnHandQty(1.5, 'piece', 100).ok).toBe(false);
  });
  it('rejects ordering more pieces than are in stock', () => {
    const r = validateOnHandQty(11, 'piece', 10);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('10');
  });
  it('counts a kit against stock as ten vials', () => {
    expect(validateOnHandQty(1, 'kit', 10).ok).toBe(true);
    expect(validateOnHandQty(2, 'kit', 10).ok).toBe(false);
  });
  it('rejects any quantity when stock is zero', () => {
    const r = validateOnHandQty(1, 'piece', 0);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Out of stock');
  });
});

describe('kahati downpayment split', () => {
  it('splits total into the default ₱150 downpayment and the balance', () => {
    expect(splitKahatiDownpayment(6450)).toEqual({ downpayment: 150, balance: 6300 });
  });
  it('honours an admin-set downpayment amount', () => {
    expect(splitKahatiDownpayment(6450, 500)).toEqual({ downpayment: 500, balance: 5950 });
  });
  it('caps the downpayment at the order total so balance never goes negative', () => {
    expect(splitKahatiDownpayment(100, 150)).toEqual({ downpayment: 100, balance: 0 });
  });
  it('floors a negative downpayment at zero', () => {
    expect(splitKahatiDownpayment(1000, -50)).toEqual({ downpayment: 0, balance: 1000 });
  });
  it('rounds to centavos', () => {
    expect(splitKahatiDownpayment(1000.505, 150.004)).toEqual({ downpayment: 150, balance: 850.51 });
  });
});

// ---------------------------------------------------------------------------
// MOQ (Minimum Order Quantity) — the fourth purchasing mode.
//
// MOQ products are a curated, admin-managed shelf sold on their own page with a
// per-product minimum order quantity. They never share an order with on-hand,
// kahati or group-buy items, so they carry their own packing fee.
// ---------------------------------------------------------------------------
describe('MOQ mode pricing', () => {
  const moqItem = (price: number, qty = 1): PriceableItem => ({ kind: 'moq_product', unitPricePhp: price, qty });

  it('exposes a dedicated MOQ packing-fee default', () => {
    expect(PACKING_FEE_PHP.moq).toBe(300);
  });

  it('charges the MOQ fee for an MOQ-only cart', () => {
    expect(packingFeeFor([moqItem(4500)])).toBe(PACKING_FEE_PHP.moq);
  });

  it('detects MOQ items with hasMoq and does not confuse them with group buys', () => {
    expect(hasMoq([moqItem(4500)])).toBe(true);
    expect(hasMoq([moq(10400)])).toBe(false);
    expect(hasGroupBuy([moqItem(4500)])).toBe(false);
  });

  it('adds one packing fee leg per mode in an all-modes cart', () => {
    expect(packingFeeFor([product(3200), kahati(900, 7), moq(10400), moqItem(4500)])).toBe(
      PACKING_FEE_PHP.solo + PACKING_FEE_PHP.kahati + PACKING_FEE_PHP.group_buy + PACKING_FEE_PHP.moq,
    );
  });

  it('honours a per-listing packing-fee override on an MOQ item', () => {
    expect(packingFeeFor([{ kind: 'moq_product', unitPricePhp: 4500, qty: 2, packingFeePhp: 450 }])).toBe(450);
  });

  it('reports buyType "moq" for an MOQ-only order segment', () => {
    expect(computeTotals([moqItem(4500, 3)])).toEqual({
      subtotal: 13500,
      packingFee: PACKING_FEE_PHP.moq,
      total: 13500 + PACKING_FEE_PHP.moq,
      buyType: 'moq',
    });
  });
});

describe('validateMoqQty', () => {
  it('accepts a quantity at the product minimum', () => {
    expect(validateMoqQty(5, 5, 100)).toEqual({ ok: true });
  });

  it('rejects a quantity below the minimum order quantity', () => {
    const r = validateMoqQty(4, 5, 100);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('5');
  });

  it('rejects a fractional quantity', () => {
    expect(validateMoqQty(5.5, 1, 100).ok).toBe(false);
  });

  it('rejects a quantity beyond available stock', () => {
    const r = validateMoqQty(20, 1, 12);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('12');
  });

  it('rejects any purchase when the product is out of stock', () => {
    const r = validateMoqQty(1, 1, 0);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/out of stock/i);
  });
});

// ---------------------------------------------------------------------------
// Product-level group buy configuration
//
// The five settings live on the product; a hatian or a campaign that includes
// that product SEEDS its own fields from them. These are the seeding rules —
// pure, so the same numbers hold whichever surface asks.
// ---------------------------------------------------------------------------

const gbConfig = (over: Partial<GroupBuyConfig> = {}): GroupBuyConfig => ({
  gbPricePerKitPhp: null, gbPricePerPiecePhp: null,
  gbVialsPerKit: null, gbMinVials: null, gbMaxVialsPerBatch: null,
  ...over,
});

describe('groupBuyVialsPerKit', () => {
  it('falls back to the global kit size when the product sets none', () => {
    expect(groupBuyVialsPerKit(gbConfig())).toBe(VIALS_PER_KIT);
  });

  it('uses the kit size the product itself declares', () => {
    expect(groupBuyVialsPerKit(gbConfig({ gbVialsPerKit: 6 }))).toBe(6);
  });

  it('refuses a kit of zero vials — nothing could ever fill it', () => {
    expect(groupBuyVialsPerKit(gbConfig({ gbVialsPerKit: 0 }))).toBe(VIALS_PER_KIT);
  });
});

describe('groupBuyUnitPrice', () => {
  it('returns the configured price per kit', () => {
    expect(groupBuyUnitPrice(gbConfig({ gbPricePerKitPhp: '4500' }), 'kit')).toBe(4500);
  });

  it('returns the explicit per-piece price when one is set', () => {
    const c = gbConfig({ gbPricePerKitPhp: '4500', gbPricePerPiecePhp: '480' });
    expect(groupBuyUnitPrice(c, 'piece')).toBe(480);
  });

  it('derives the per-piece price from the kit when none is set', () => {
    expect(groupBuyUnitPrice(gbConfig({ gbPricePerKitPhp: '4500' }), 'piece')).toBe(450);
  });

  it('derives against the kit size the product declares, not the global one', () => {
    const c = gbConfig({ gbPricePerKitPhp: '4500', gbVialsPerKit: 5 });
    expect(groupBuyUnitPrice(c, 'piece')).toBe(900);
  });

  it('returns null for a unit the product is not sold in', () => {
    expect(groupBuyUnitPrice(gbConfig(), 'kit')).toBeNull();
    expect(groupBuyUnitPrice(gbConfig(), 'piece')).toBeNull();
  });

  it('treats a zero price as "not sold this way", never as free', () => {
    expect(groupBuyUnitPrice(gbConfig({ gbPricePerKitPhp: '0' }), 'kit')).toBeNull();
    // A zero piece price falls through to the kit derivation rather than free.
    const c = gbConfig({ gbPricePerKitPhp: '4500', gbPricePerPiecePhp: '0' });
    expect(groupBuyUnitPrice(c, 'piece')).toBe(450);
  });
});

describe('kahatiDefaultsFor', () => {
  it('seeds price, minimum and vial cap straight from the product', () => {
    const c = gbConfig({ gbPricePerKitPhp: '4500', gbMinVials: 2, gbMaxVialsPerBatch: 8 });
    expect(kahatiDefaultsFor(c)).toEqual({ pricePerKitPhp: 4500, minVials: 2, totalSlots: 8 });
  });

  it('leaves the current hatian defaults alone when the product configures nothing', () => {
    expect(kahatiDefaultsFor(gbConfig())).toEqual({
      pricePerKitPhp: null, minVials: KAHATI_MIN_VIALS, totalSlots: KAHATI_MAX_VIALS,
    });
  });

  it('clamps a vial cap beyond one kit — a hatian fills exactly one', () => {
    expect(kahatiDefaultsFor(gbConfig({ gbMaxVialsPerBatch: 25 })).totalSlots).toBe(KAHATI_MAX_VIALS);
  });

  it('never seeds a per-person minimum larger than the cap it must fit inside', () => {
    const c = gbConfig({ gbMinVials: 9, gbMaxVialsPerBatch: 4 });
    expect(kahatiDefaultsFor(c).minVials).toBe(4);
  });
});

describe('campaignDefaultsFor', () => {
  it('converts the vial figures a product declares into the kits a campaign counts', () => {
    const c = gbConfig({ gbPricePerKitPhp: '4500', gbVialsPerKit: 10, gbMaxVialsPerBatch: 50, gbMinVials: 20 });
    expect(campaignDefaultsFor(c)).toEqual({ pricePerKitPhp: 4500, moq: 5, perCustomerMin: 2 });
  });

  it('rounds a part-kit minimum up — half a kit is still a whole kit to commit', () => {
    const c = gbConfig({ gbVialsPerKit: 10, gbMinVials: 11 });
    expect(campaignDefaultsFor(c).perCustomerMin).toBe(2);
  });

  it('leaves the current campaign defaults alone when the product configures nothing', () => {
    expect(campaignDefaultsFor(gbConfig())).toEqual({
      pricePerKitPhp: null, moq: MOQ_BATCH_MAX_KITS, perCustomerMin: 1,
    });
  });

  it('clamps a batch beyond the hard ceiling — bigger runs continue as batch #2', () => {
    const c = gbConfig({ gbVialsPerKit: 10, gbMaxVialsPerBatch: 500 });
    expect(campaignDefaultsFor(c).moq).toBe(MOQ_BATCH_MAX_KITS);
  });

  it('floors a batch smaller than one kit at one kit rather than at nothing', () => {
    const c = gbConfig({ gbVialsPerKit: 10, gbMaxVialsPerBatch: 4 });
    expect(campaignDefaultsFor(c).moq).toBe(1);
  });
});

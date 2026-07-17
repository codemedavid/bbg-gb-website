import { describe, it, expect } from 'vitest';
import { modeOf, segmentByMode, splitCartIntoOrders } from './order-modes';
import { SHIPPING_PHP, REPACK_FEE_PHP, type PriceableItem } from './pricing';

const solo = (price: number, qty = 1): PriceableItem => ({ kind: 'product', unitPricePhp: price, qty });
const kahati = (price: number, qty = 7): PriceableItem => ({ kind: 'group_buy', unitPricePhp: price, qty });
const moq = (price: number, qty = 1): PriceableItem => ({ kind: 'moq_campaign', unitPricePhp: price, qty });

describe('modeOf', () => {
  it('maps a plain product to solo', () => {
    expect(modeOf(solo(3200))).toBe('solo');
  });
  it('maps a group_buy item to kahati', () => {
    expect(modeOf(kahati(900))).toBe('kahati');
  });
  it('maps an moq_campaign item to group_buy', () => {
    expect(modeOf(moq(10400))).toBe('group_buy');
  });
});

describe('segmentByMode', () => {
  it('buckets a mixed cart into three named segments', () => {
    const seg = segmentByMode([solo(3200), kahati(900, 7), moq(10400, 2), solo(475)]);
    expect(seg.solo).toHaveLength(2);
    expect(seg.kahati).toHaveLength(1);
    expect(seg.group_buy).toHaveLength(1);
  });
  it('returns empty arrays for missing modes', () => {
    const seg = segmentByMode([solo(3200)]);
    expect(seg.kahati).toEqual([]);
    expect(seg.group_buy).toEqual([]);
  });
});

describe('splitCartIntoOrders', () => {
  it('returns no orders for an empty cart', () => {
    expect(splitCartIntoOrders([])).toEqual([]);
  });

  it('produces one order for a solo-only cart with LBC shipping', () => {
    const orders = splitCartIntoOrders([solo(3200, 2)]);
    expect(orders).toHaveLength(1);
    expect(orders[0].mode).toBe('solo');
    expect(orders[0].totals.shipping).toBe(SHIPPING_PHP);
    expect(orders[0].totals.total).toBe(6400 + SHIPPING_PHP);
  });

  it('never merges modes: a solo+kahati cart splits into two separate orders', () => {
    const orders = splitCartIntoOrders([solo(3200), kahati(900, 7)]);
    expect(orders).toHaveLength(2);
    const modes = orders.map((o) => o.mode).sort();
    expect(modes).toEqual(['kahati', 'solo']);
  });

  it('splits a one-of-each cart into three orders with the correct per-mode fees', () => {
    const orders = splitCartIntoOrders([solo(3200), kahati(900, 7), moq(10400, 1)]);
    expect(orders).toHaveLength(3);

    const soloOrder = orders.find((o) => o.mode === 'solo')!;
    expect(soloOrder.totals.shipping).toBe(SHIPPING_PHP);
    expect(soloOrder.totals.repackFee).toBe(0);
    expect(soloOrder.totals.total).toBe(3200 + SHIPPING_PHP);

    const kahatiOrder = orders.find((o) => o.mode === 'kahati')!;
    expect(kahatiOrder.totals.shipping).toBe(0);
    expect(kahatiOrder.totals.repackFee).toBe(REPACK_FEE_PHP);
    expect(kahatiOrder.totals.total).toBe(900 * 7 + REPACK_FEE_PHP);

    const groupBuyOrder = orders.find((o) => o.mode === 'group_buy')!;
    expect(groupBuyOrder.totals.shipping).toBe(SHIPPING_PHP);
    expect(groupBuyOrder.totals.repackFee).toBe(0);
    expect(groupBuyOrder.totals.total).toBe(10400 + SHIPPING_PHP);
  });

  it('keeps a stable order: solo, then kahati, then group_buy', () => {
    const orders = splitCartIntoOrders([moq(10400), kahati(900, 7), solo(3200)]);
    expect(orders.map((o) => o.mode)).toEqual(['solo', 'kahati', 'group_buy']);
  });
});
